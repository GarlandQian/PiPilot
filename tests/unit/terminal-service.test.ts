import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TerminalService } from '../../src/main/terminal/terminal-service'
import { PIPILOT_VERSION } from '../../src/shared/build-info'
import type { ConversationScope } from '../../src/shared/conversation-scope'

const firstWorkspaceId = '00000000-0000-4000-8000-000000000101'
const secondWorkspaceId = '00000000-0000-4000-8000-000000000102'
const thirdWorkspaceId = '00000000-0000-4000-8000-000000000103'
const firstScope = { kind: 'project', workspaceId: firstWorkspaceId } as const
const secondScope = { kind: 'project', workspaceId: secondWorkspaceId } as const
const thirdScope = { kind: 'project', workspaceId: thirdWorkspaceId } as const
const projectlessScope = { kind: 'projectless' } as const

function scopeKey(scope: ConversationScope) {
  return scope.kind === 'project'
    ? `project:${scope.workspaceId}`
    : 'projectless'
}

class FakePty {
  readonly pid = 42
  cols: number
  rows: number
  readonly writes: Array<string | Buffer> = []
  readonly resizes: Array<{ cols: number; rows: number }> = []
  readonly kills: Array<string | undefined> = []
  pauses = 0
  resumes = 0
  private readonly dataListeners = new Set<(data: string) => void>()
  private readonly exitListeners = new Set<(
    event: { exitCode: number; signal?: number },
  ) => void>()

  constructor(cols: number, rows: number) {
    this.cols = cols
    this.rows = rows
  }

  onData(listener: (data: string) => void) {
    this.dataListeners.add(listener)
    return { dispose: () => this.dataListeners.delete(listener) }
  }

  onExit(listener: (event: { exitCode: number; signal?: number }) => void) {
    this.exitListeners.add(listener)
    return { dispose: () => this.exitListeners.delete(listener) }
  }

  write(data: string | Buffer) {
    this.writes.push(data)
  }

  resize(cols: number, rows: number) {
    this.cols = cols
    this.rows = rows
    this.resizes.push({ cols, rows })
  }

  kill(signal?: string) {
    this.kills.push(signal)
    queueMicrotask(() => this.emitExit(0))
  }

  pause() {
    this.pauses += 1
  }

  resume() {
    this.resumes += 1
  }

  emitData(data: string) {
    for (const listener of this.dataListeners) listener(data)
  }

  emitExit(exitCode: number, signal?: number) {
    for (const listener of [...this.exitListeners]) {
      listener({ exitCode, ...(signal === undefined ? {} : { signal }) })
    }
  }
}

const temporaryDirectories: string[] = []

async function temporaryDirectory(name: string) {
  const root = await mkdtemp(join(tmpdir(), `pipilot-${name}-`))
  temporaryDirectories.push(root)
  return root
}

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

describe('TerminalService', () => {
  it('starts and reuses one terminal at the Main-resolved scope cwd', async () => {
    const root = await temporaryDirectory('terminal-cwd')
    let activeScope: ConversationScope = firstScope
    const roots = new Map([[scopeKey(firstScope), root]])
    const spawned: Array<{
      file: string
      args: string[]
      options: { cols?: number; rows?: number; cwd?: string; env?: Record<string, string | undefined> }
      process: FakePty
    }> = []
    const service = new TerminalService(
      () => activeScope,
      async (scope) => ({ scope, cwd: roots.get(scopeKey(scope))! }),
      {
        environment: {
          PATH: '/usr/bin:/bin',
          AWS_ACCESS_KEY_ID: 'inherited-terminal-credential',
        },
        resolveShell: () => ({ file: '/bin/test-shell', args: ['-l'], label: 'test-shell' }),
        spawnPty: (file, args, options) => {
          const process = new FakePty(options.cols ?? 80, options.rows ?? 24)
          spawned.push({ file, args, options, process })
          return process
        },
      },
    )

    const [created, concurrent] = await Promise.all([
      service.create(firstScope, 80, 24),
      service.create(firstScope, 80, 24),
    ])
    const canonicalRoot = await realpath(root)
    expect(created).toMatchObject({
      scope: firstScope,
      shell: 'test-shell',
      cols: 80,
      rows: 24,
      replay: '',
      sequence: 0,
      reused: false,
    })
    expect(JSON.stringify(created)).not.toContain(root)
    expect(concurrent).toMatchObject({ terminalId: created.terminalId, reused: true })
    expect(spawned).toHaveLength(1)
    expect(spawned[0]).toMatchObject({
      file: '/bin/test-shell',
      args: ['-l'],
      options: {
        cwd: canonicalRoot,
        cols: 80,
        rows: 24,
        env: {
          PATH: '/usr/bin:/bin',
          AWS_ACCESS_KEY_ID: 'inherited-terminal-credential',
          PWD: canonicalRoot,
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor',
          TERM_PROGRAM: 'PiPilot',
          TERM_PROGRAM_VERSION: PIPILOT_VERSION,
        },
      },
    })

    const reused = await service.create(firstScope, 91, 17)
    expect(reused).toMatchObject({
      terminalId: created.terminalId,
      cols: 91,
      rows: 17,
      reused: true,
    })
    await service.input(firstScope, created.terminalId, 'printf ok\r')
    await service.resize(firstScope, created.terminalId, 100, 30)
    expect(spawned[0].process.writes).toEqual(['printf ok\r'])
    expect(spawned[0].process.resizes[spawned[0].process.resizes.length - 1])
      .toEqual({ cols: 100, rows: 30 })

    activeScope = projectlessScope
    await expect(service.input(firstScope, created.terminalId, 'stale'))
      .rejects.toMatchObject({ code: 'TERMINAL_STALE_SCOPE' })
    await service.disposeScope(firstScope)
    expect(spawned[0].process.kills).toEqual([undefined])
  })

  it('supports the private projectless cwd without exposing its path', async () => {
    const projectlessRoot = await temporaryDirectory('terminal-projectless')
    let launchedCwd: string | undefined
    const service = new TerminalService(
      () => projectlessScope,
      async (scope) => ({ scope, cwd: projectlessRoot }),
      {
        resolveShell: () => ({ file: '/bin/sh', args: [], label: 'sh' }),
        spawnPty: (_file, _args, options) => {
          launchedCwd = options.cwd
          return new FakePty(options.cols ?? 80, options.rows ?? 24)
        },
      },
    )

    const session = await service.create(projectlessScope, 80, 24)
    expect(session.scope).toEqual(projectlessScope)
    expect(JSON.stringify(session)).not.toContain(projectlessRoot)
    expect(launchedCwd).toBe(await realpath(projectlessRoot))
    await service.dispose()
  })

  it('emits ordered bounded PTY data and exit events for the active scope', async () => {
    vi.useFakeTimers()
    const root = await temporaryDirectory('terminal-events')
    let process: FakePty | undefined
    const service = new TerminalService(
      () => firstScope,
      async (scope) => ({ scope, cwd: root }),
      {
        resolveShell: () => ({ file: '/bin/sh', args: [], label: 'sh' }),
        spawnPty: (_file, _args, options) => {
          process = new FakePty(options.cols ?? 80, options.rows ?? 24)
          return process
        },
      },
    )
    const events: unknown[] = []
    service.subscribe((event) => events.push(event))
    const created = await service.create(firstScope, 80, 24)

    process!.emitData('hello\r\n')
    const replayed = await service.create(firstScope, 80, 24)
    expect(replayed).toMatchObject({ replay: 'hello\r\n', sequence: 1, reused: true })
    await vi.advanceTimersByTimeAsync(20)
    expect(events).toEqual([
      expect.objectContaining({
        type: 'data',
        scope: firstScope,
        terminalId: created.terminalId,
        sequence: 1,
        data: 'hello\r\n',
      }),
    ])

    process!.emitExit(7, 15)
    expect(events).toHaveLength(2)
    expect(events[1]).toEqual(expect.objectContaining({
      type: 'exit',
      scope: firstScope,
      sequence: 2,
      exitCode: 7,
      signal: 15,
    }))
    expect(service.hasActiveTerminals()).toBe(false)
  })

  it('applies backpressure and bounds output events', async () => {
    vi.useFakeTimers()
    const root = await temporaryDirectory('terminal-backpressure')
    let process: FakePty | undefined
    const events: Array<{ type: string; data?: string; truncated?: boolean }> = []
    const service = new TerminalService(
      () => firstScope,
      async (scope) => ({ scope, cwd: root }),
      {
        resolveShell: () => ({ file: '/bin/sh', args: [], label: 'sh' }),
        spawnPty: (_file, _args, options) => {
          process = new FakePty(options.cols ?? 80, options.rows ?? 24)
          return process
        },
      },
    )
    service.subscribe((event) => events.push(event))
    await service.create(firstScope, 80, 24)

    process!.emitData('x'.repeat(1024 * 1024 + 100))
    expect(process!.pauses).toBe(1)
    await vi.advanceTimersByTimeAsync(20)
    expect(events[0]).toMatchObject({ type: 'data', truncated: true })
    expect(events[0].data!.length).toBeLessThanOrEqual(64 * 1024)
    process!.emitExit(0)
  })

  it('caps native terminals across scopes and uses the platform shell', async () => {
    const roots = new Map([
      [scopeKey(firstScope), await temporaryDirectory('terminal-cap-a')],
      [scopeKey(secondScope), await temporaryDirectory('terminal-cap-b')],
      [scopeKey(thirdScope), await temporaryDirectory('terminal-cap-c')],
    ])
    let activeScope: ConversationScope = firstScope
    const launches: Array<{ file: string; args: string[]; process: FakePty }> = []
    const service = new TerminalService(
      () => activeScope,
      async (scope) => ({ scope, cwd: roots.get(scopeKey(scope))! }),
      {
        environment: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
        maxTerminals: 2,
        platform: 'win32',
        spawnPty: (file, args, options) => {
          const process = new FakePty(options.cols ?? 80, options.rows ?? 24)
          launches.push({ file, args, process })
          return process
        },
      },
    )

    const first = await service.create(firstScope, 80, 24)
    activeScope = secondScope
    await service.create(secondScope, 80, 24)
    activeScope = thirdScope
    await expect(service.create(thirdScope, 80, 24))
      .rejects.toMatchObject({ code: 'TERMINAL_LIMIT_REACHED' })
    expect(launches.map(({ file, args }) => ({ file, args }))).toEqual([
      { file: 'C:\\Windows\\System32\\cmd.exe', args: [] },
      { file: 'C:\\Windows\\System32\\cmd.exe', args: [] },
    ])

    activeScope = firstScope
    await service.kill(firstScope, first.terminalId)
    expect(launches[0].process.kills).toEqual([undefined])
    await service.dispose()
  })

  it.each(['darwin', 'linux'] as const)(
    'uses the configured executable Unix shell on %s',
    async (platform) => {
      const root = await temporaryDirectory(`terminal-shell-${platform}`)
      const launches: Array<{ file: string; args: string[] }> = []
      const service = new TerminalService(
        () => firstScope,
        async (scope) => ({ scope, cwd: root }),
        {
          environment: { SHELL: '/bin/sh' },
          platform,
          spawnPty: (file, args, options) => {
            launches.push({ file, args })
            return new FakePty(options.cols ?? 80, options.rows ?? 24)
          },
        },
      )

      const created = await service.create(firstScope, 80, 24)
      const canonicalShell = await realpath('/bin/sh')
      const shellParts = canonicalShell.split('/')
      expect(created.shell).toBe(shellParts[shellParts.length - 1])
      expect(launches).toEqual([{ file: canonicalShell, args: ['-l'] }])
      await service.dispose()
    },
  )

  it('reports native terminal launch failure without retaining a session', async () => {
    const root = await temporaryDirectory('terminal-unavailable')
    const service = new TerminalService(
      () => firstScope,
      async (scope) => ({ scope, cwd: root }),
      {
        resolveShell: () => ({ file: '/bin/sh', args: [], label: 'sh' }),
        spawnPty: () => {
          throw new Error('native module failed')
        },
      },
    )

    await expect(service.create(firstScope, 80, 24)).rejects.toMatchObject({
      code: 'TERMINAL_START_FAILED',
    })
    expect(service.hasActiveTerminals()).toBe(false)
  })
})
