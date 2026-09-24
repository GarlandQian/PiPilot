import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TerminalService } from '../../src/main/terminal/terminal-service'
import { wslWorkingDirectory } from '../../src/main/terminal/terminal-profile-discovery'
import { PIPILOT_VERSION } from '../../src/shared/build-info'
import type { ConversationScope } from '../../src/shared/conversation-scope'
import { DEFAULT_SETTINGS, type TerminalSettings } from '../../src/shared/settings'

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
  it('retains background output across project switches without allowing background control', async () => {
    vi.useFakeTimers()
    const firstRoot = await temporaryDirectory('terminal-background-first')
    const secondRoot = await temporaryDirectory('terminal-background-second')
    let activeScope: ConversationScope = firstScope
    const processes: FakePty[] = []
    const service = new TerminalService(
      () => activeScope,
      async (scope) => ({ scope, cwd: scopeKey(scope) === scopeKey(firstScope) ? firstRoot : secondRoot }),
      {
        resolveShell: () => ({ file: '/bin/sh', args: [], label: 'sh' }),
        spawnPty: (_file, _args, options) => {
          const process = new FakePty(options.cols ?? 80, options.rows ?? 24)
          processes.push(process)
          return process
        },
      },
    )
    const events: unknown[] = []
    service.subscribe((event) => events.push(event))
    const first = await service.create(firstScope, 80, 24)
    activeScope = secondScope
    const second = await service.create(secondScope, 80, 24)
    processes[0].emitData('background build complete\r\n')
    await vi.advanceTimersByTimeAsync(25)
    expect(events).toEqual([expect.objectContaining({ scope: firstScope, type: 'data', data: 'background build complete\r\n' })])
    expect(processes[0].kills).toEqual([])
    for (const operation of [
      () => service.create(firstScope, 80, 24),
      () => service.restart(firstScope, first.terminalId, 80, 24),
      () => service.list(firstScope),
      () => service.attach(firstScope, first.terminalId, 80, 24),
      () => service.rename(firstScope, first.terminalId, 'Renamed'),
      () => service.clear(firstScope, first.terminalId),
      () => service.close(firstScope, first.terminalId),
      () => service.input(firstScope, first.terminalId, 'stale input'),
      () => service.resize(firstScope, first.terminalId, 100, 30),
      () => service.kill(firstScope, first.terminalId),
    ]) await expect(operation()).rejects.toMatchObject({ code: 'TERMINAL_STALE_SCOPE' })
    await expect(service.input(secondScope, first.terminalId, 'wrong identity'))
      .rejects.toMatchObject({ code: 'TERMINAL_NOT_FOUND' })

    activeScope = firstScope
    const resumed = await service.attach(firstScope, first.terminalId, 90, 30)
    expect(resumed).toMatchObject({ terminalId: first.terminalId, reused: true, replay: 'background build complete\r\n', sequence: 1 })
    expect(processes).toHaveLength(2)
    await service.kill(firstScope, first.terminalId)
    expect(processes[0].kills).toEqual([undefined])
    expect(processes[1].kills).toEqual([])
    activeScope = secondScope
    expect((await service.attach(secondScope, second.terminalId, 80, 24)).terminalId).toBe(second.terminalId)
    await service.dispose()
    expect(processes[1].kills).toEqual([undefined])
    expect(service.hasActiveTerminals()).toBe(false)
  })

  it('creates independent terminal tabs and attaches without spawning at the Main-resolved cwd', async () => {
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
      status: 'running',
      title: 'test-shell 1',
    })
    expect(JSON.stringify(created)).not.toContain(root)
    expect(concurrent.terminalId).not.toBe(created.terminalId)
    expect(concurrent.reused).toBe(false)
    expect(concurrent.title).toBe('test-shell 2')
    expect(spawned).toHaveLength(2)
    expect((await service.list(firstScope)).map((terminal) => terminal.terminalId))
      .toEqual([created.terminalId, concurrent.terminalId])
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

    const reused = await service.attach(firstScope, created.terminalId, 91, 17)
    expect(reused).toMatchObject({
      terminalId: created.terminalId,
      cols: 91,
      rows: 17,
      reused: true,
    })
    await service.input(firstScope, created.terminalId, 'printf ok\r')
    expect(await service.rename(firstScope, created.terminalId, '  Build server  '))
      .toMatchObject({ terminalId: created.terminalId, title: 'Build server' })
    await service.resize(firstScope, created.terminalId, 100, 30)
    expect(spawned[0].process.writes).toEqual(['printf ok\r'])
    expect(spawned[0].process.resizes[spawned[0].process.resizes.length - 1])
      .toEqual({ cols: 100, rows: 30 })

    activeScope = projectlessScope
    await expect(service.input(firstScope, created.terminalId, 'stale'))
      .rejects.toMatchObject({ code: 'TERMINAL_STALE_SCOPE' })
    await service.disposeScope(firstScope)
    expect(spawned[0].process.kills).toEqual([undefined])
    expect(spawned[1].process.kills).toEqual([undefined])
    activeScope = firstScope
    expect(await service.list(firstScope)).toEqual([])
    await expect(service.attach(firstScope, created.terminalId, 80, 24))
      .rejects.toMatchObject({ code: 'TERMINAL_NOT_FOUND' })
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

  it('closes a running terminal by stopping only its process and removes exited tabs without another kill', async () => {
    const root = await temporaryDirectory('terminal-close')
    const processes: FakePty[] = []
    const service = new TerminalService(
      () => firstScope,
      async (scope) => ({ scope, cwd: root }),
      {
        resolveShell: () => ({ file: '/bin/sh', args: [], label: 'sh' }),
        spawnPty: () => {
          const process = new FakePty(80, 24)
          processes.push(process)
          return process
        },
      },
    )
    const first = await service.create(firstScope, 80, 24)
    const second = await service.create(firstScope, 80, 24)
    const third = await service.create(firstScope, 80, 24)
    const events: unknown[] = []
    service.subscribe((event) => events.push(event))
    await service.close(firstScope, second.terminalId)
    expect(processes.map((process) => process.kills)).toEqual([[], [undefined], []])
    expect(events).toEqual([expect.objectContaining({ type: 'exit', terminalId: second.terminalId })])
    expect((await service.list(firstScope)).map(({ terminalId, status }) => ({ terminalId, status }))).toEqual([
      { terminalId: first.terminalId, status: 'running' },
      { terminalId: third.terminalId, status: 'running' },
    ])
    await expect(service.attach(firstScope, second.terminalId, 80, 24)).rejects.toMatchObject({ code: 'TERMINAL_NOT_FOUND' })
    await service.input(firstScope, first.terminalId, 'still running')
    expect(processes[0].writes).toEqual(['still running'])
    processes[2].emitExit(3)
    await service.close(firstScope, third.terminalId)
    expect(processes[2].kills).toEqual([])
    expect(await service.list(firstScope)).toEqual([expect.objectContaining({ terminalId: first.terminalId, status: 'running' })])
    await service.dispose()
  })

  it('numbers successful creations per project without reusing retained or renamed titles', async () => {
    const root = await temporaryDirectory('terminal-titles')
    let activeScope: ConversationScope = firstScope
    let failLaunch = true
    const service = new TerminalService(
      () => activeScope,
      async (scope) => ({ scope, cwd: root }),
      {
        resolveShell: () => ({ file: '/bin/sh', args: [], label: 'sh' }),
        spawnPty: () => {
          if (failLaunch) throw new Error('Launch failed')
          return new FakePty(80, 24)
        },
      },
    )
    await expect(service.create(firstScope, 80, 24)).rejects.toMatchObject({ code: 'TERMINAL_START_FAILED' })
    failLaunch = false
    const first = await service.create(firstScope, 80, 24)
    expect(first.title).toBe('sh 1')
    await service.kill(firstScope, first.terminalId)
    const second = await service.create(firstScope, 80, 24)
    expect(second.title).toBe('sh 2')
    await service.rename(firstScope, first.terminalId, 'sh 3')
    const fourth = await service.create(firstScope, 80, 24)
    expect(fourth.title).toBe('sh 4')
    await service.close(firstScope, first.terminalId)
    const fifth = await service.create(firstScope, 80, 24)
    expect(fifth.title).toBe('sh 5')
    activeScope = secondScope
    expect((await service.create(secondScope, 80, 24)).title).toBe('sh 1')
    await service.disposeScope(firstScope)
    activeScope = firstScope
    expect((await service.create(firstScope, 80, 24)).title).toBe('sh 1')
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
    const replayed = await service.attach(firstScope, created.terminalId, 80, 24)
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
    expect(await service.attach(firstScope, created.terminalId, 100, 30)).toMatchObject({
      status: 'exited', exitCode: 7, signal: 15, replay: 'hello\r\n', sequence: 2,
    })
    expect(await service.list(firstScope)).toEqual([expect.objectContaining({ terminalId: created.terminalId, status: 'exited', exitCode: 7 })])
    await expect(service.input(firstScope, created.terminalId, 'no'))
      .rejects.toMatchObject({ code: 'TERMINAL_EXITED' })
    await expect(service.resize(firstScope, created.terminalId, 100, 30))
      .rejects.toMatchObject({ code: 'TERMINAL_EXITED' })
    await service.close(firstScope, created.terminalId)
    expect(await service.list(firstScope)).toEqual([])
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

  it('returns an authoritative exited snapshot when a shell exits during creation', async () => {
    const root = await temporaryDirectory('terminal-immediate-exit')
    const process = new FakePty(80, 24)
    const originalOnExit = process.onExit.bind(process)
    process.onExit = (listener) => {
      const disposable = originalOnExit(listener)
      process.emitData('launch failed\r\n')
      listener({ exitCode: 127 })
      return disposable
    }
    const service = new TerminalService(
      () => firstScope,
      async (scope) => ({ scope, cwd: root }),
      {
        resolveShell: () => ({ file: '/bin/sh', args: [], label: 'sh' }),
        spawnPty: () => process,
      },
    )
    const events: unknown[] = []
    service.subscribe((event) => events.push(event))
    const created = await service.create(firstScope, 80, 24)
    expect(created).toMatchObject({ status: 'exited', exitCode: 127, replay: 'launch failed\r\n', sequence: 2, reused: false })
    expect(service.hasActiveTerminals()).toBe(false)
    process.emitData('late data')
    process.emitExit(0)
    expect(events).toHaveLength(2)
    expect((await service.attach(firstScope, created.terminalId, 80, 24)).exitCode).toBe(127)
    await service.disposeScope(firstScope)
    expect(await service.list(firstScope)).toEqual([])
    expect(process.kills).toEqual([])
  })

  it('bounds replay and clears it without restarting or resetting event order', async () => {
    const root = await temporaryDirectory('terminal-clear')
    const process = new FakePty(80, 24)
    const service = new TerminalService(
      () => firstScope,
      async (scope) => ({ scope, cwd: root }),
      {
        resolveShell: () => ({ file: '/bin/sh', args: [], label: 'sh' }),
        spawnPty: () => process,
      },
    )
    const created = await service.create(firstScope, 80, 24)
    process.emitData('x'.repeat(1024 * 1024))
    const full = await service.attach(firstScope, created.terminalId, 80, 24)
    expect(full.replay).toHaveLength(1024 * 1024)
    expect(process.pauses).toBe(1)
    expect(process.resumes).toBe(1)
    process.emitData('tail')
    const bounded = await service.attach(firstScope, created.terminalId, 80, 24)
    expect(bounded.replay).toHaveLength(1024 * 1024)
    expect(bounded.replay.endsWith('tail')).toBe(true)
    process.emitData('pending before clear')
    await service.clear(firstScope, created.terminalId)
    const cleared = await service.attach(firstScope, created.terminalId, 80, 24)
    expect(cleared.replay).toBe('')
    expect(cleared.sequence).toBeGreaterThan(bounded.sequence)
    expect(cleared.status).toBe('running')
    expect(process.kills).toEqual([])
    process.emitData('after clear')
    process.emitExit(4)
    expect(await service.attach(firstScope, created.terminalId, 80, 24))
      .toMatchObject({ replay: 'after clear', status: 'exited', exitCode: 4, sequence: cleared.sequence + 2 })
    await service.clear(firstScope, created.terminalId)
    expect(await service.attach(firstScope, created.terminalId, 80, 24))
      .toMatchObject({ replay: '', status: 'exited', exitCode: 4 })
    await service.dispose()
  })

  it('creates more than four concurrent terminals without evicting existing processes or spawning on attach', async () => {
    const root = await temporaryDirectory('terminal-concurrent-create')
    const spawn = vi.fn((_file: string, _args: string[], options: { cols?: number; rows?: number }) =>
      new FakePty(options.cols ?? 80, options.rows ?? 24))
    const service = new TerminalService(
      () => firstScope,
      async (scope) => ({ scope, cwd: root }),
      {
        resolveShell: () => ({ file: '/bin/sh', args: [], label: 'sh' }),
        spawnPty: spawn,
      },
    )
    const created = await Promise.all(Array.from({ length: 12 }, () => service.create(firstScope, 80, 24)))
    expect(new Set(created.map((session) => session.terminalId)).size).toBe(12)
    expect(new Set(created.map((session) => session.title)).size).toBe(12)
    expect(spawn).toHaveBeenCalledTimes(12)
    for (const [index, session] of created.entries()) {
      const process = spawn.mock.results[index].value as FakePty
      process.emitData(`terminal ${index} remains live\r\n`)
      expect(await service.attach(firstScope, session.terminalId, 80, 24))
        .toMatchObject({ status: 'running', replay: `terminal ${index} remains live\r\n` })
      expect(process.kills).toEqual([])
    }
    await service.kill(firstScope, created[4].terminalId)
    expect((await service.list(firstScope)).filter((session) => session.status === 'running')).toHaveLength(11)
    expect((await service.attach(firstScope, created[4].terminalId, 80, 24)).status).toBe('exited')
    await expect(service.attach(firstScope, '00000000-0000-4000-8000-000000000999', 80, 24))
      .rejects.toMatchObject({ code: 'TERMINAL_NOT_FOUND' })
    expect(spawn).toHaveBeenCalledTimes(12)
    await service.dispose()
  })

  it('removes exited records and cancels queued creation when a project is disposed', async () => {
    const root = await temporaryDirectory('terminal-disposal-race')
    const process = new FakePty(80, 24)
    let beginShellResolution: () => void = () => undefined
    let finishShellResolution: (value: { file: string; args: string[]; label: string }) => void = () => undefined
    const shellResolutionStarted = new Promise<void>((resolve) => { beginShellResolution = resolve })
    const pendingShell = new Promise<{ file: string; args: string[]; label: string }>((resolve) => { finishShellResolution = resolve })
    const shell = { file: '/bin/sh', args: [], label: 'sh' }
    let shouldWait = false
    const spawn = vi.fn(() => process)
    const service = new TerminalService(
      () => firstScope,
      async (scope) => ({ scope, cwd: root }),
      {
        resolveShell: () => {
          if (!shouldWait) return shell
          beginShellResolution()
          return pendingShell
        },
        spawnPty: spawn,
      },
    )
    await service.create(firstScope, 80, 24)
    process.emitExit(3)
    shouldWait = true
    const creations = Promise.allSettled([
      service.create(firstScope, 80, 24),
      service.create(firstScope, 80, 24),
    ])
    await shellResolutionStarted
    const disposal = service.disposeScope(firstScope)
    finishShellResolution(shell)
    expect(await creations).toEqual([
      expect.objectContaining({ status: 'rejected', reason: expect.objectContaining({ code: 'TERMINAL_UNAVAILABLE' }) }),
      expect.objectContaining({ status: 'rejected', reason: expect.objectContaining({ code: 'TERMINAL_UNAVAILABLE' }) }),
    ])
    await disposal
    expect(await service.list(firstScope)).toEqual([])
    expect(spawn).toHaveBeenCalledTimes(1)
    expect(process.kills).toEqual([])
    await service.dispose()
  })

  it('keeps more than four native terminals across scopes and uses the platform shell', async () => {
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
        platform: 'win32',
        resolveExecutable: async (candidate) => candidate === 'C:\\Windows\\System32\\cmd.exe' ? candidate : undefined,
        spawnPty: (file, args, options) => {
          const process = new FakePty(options.cols ?? 80, options.rows ?? 24)
          launches.push({ file, args, process })
          return process
        },
      },
    )

    const first = await service.create(firstScope, 80, 24)
    await Promise.all(Array.from({ length: 4 }, () => service.create(firstScope, 80, 24)))
    activeScope = secondScope
    await service.create(secondScope, 80, 24)
    activeScope = thirdScope
    await service.create(thirdScope, 80, 24)
    expect(launches).toHaveLength(7)
    expect(launches.map(({ file, args }) => ({ file, args }))).toEqual(
      Array.from({ length: 7 }, () => ({ file: 'C:\\Windows\\System32\\cmd.exe', args: [] })),
    )
    expect(launches.every(({ process }) => process.kills.length === 0)).toBe(true)

    activeScope = firstScope
    await service.kill(firstScope, first.terminalId)
    expect(launches[0].process.kills).toEqual([undefined])
    expect(await service.list(firstScope)).toHaveLength(5)
    expect(await service.attach(firstScope, first.terminalId, 80, 24)).toMatchObject({ status: 'exited' })
    expect(launches.slice(1).every(({ process }) => process.kills.length === 0)).toBe(true)
    const replacement = await service.create(firstScope, 80, 24)
    expect(replacement.terminalId).not.toBe(first.terminalId)
    expect(await service.list(firstScope)).toHaveLength(6)
    await service.dispose()
  })

  it('discovers installed Windows CMD, Windows PowerShell and PowerShell profiles and launches the selected executable', async () => {
    const root = await temporaryDirectory('terminal-windows-profiles')
    const cmd = 'C:\\Windows\\System32\\cmd.exe'
    const powershell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
    const pwsh = 'D:\\Tools\\PowerShell\\pwsh.exe'
    const installed = new Set([cmd, powershell, pwsh])
    const launches: Array<{ file: string; args: string[]; process: FakePty }> = []
    const service = new TerminalService(
      () => firstScope,
      async (scope) => ({ scope, cwd: root }),
      {
        platform: 'win32',
        environment: { ComSpec: cmd, Path: 'relative-folder;D:\\Tools\\PowerShell' },
        resolveExecutable: async (candidate) => installed.has(candidate) ? candidate : undefined,
        spawnPty: (file, args) => {
          const process = new FakePty(80, 24)
          launches.push({ file, args, process })
          return process
        },
      },
    )
    const profiles = await service.listShellProfiles()
    expect(profiles).toEqual([
      expect.objectContaining({ id: expect.stringMatching(/^detected:/), label: 'Command Prompt (CMD)', isDefault: true, executable: cmd, available: true }),
      expect.objectContaining({ id: expect.stringMatching(/^detected:/), label: 'Windows PowerShell', isDefault: false, executable: powershell, available: true }),
      expect.objectContaining({ id: expect.stringMatching(/^detected:/), label: 'PowerShell', isDefault: false, executable: pwsh, available: true }),
    ])
    await service.create(firstScope, 80, 24)
    await service.create(firstScope, 80, 24, profiles[1].id)
    await service.create(firstScope, 80, 24, profiles[0].id)
    await service.create(firstScope, 80, 24, profiles[2].id)
    expect(launches.map(({ file, args }) => ({ file, args }))).toEqual([
      { file: cmd, args: [] },
      { file: powershell, args: [] },
      { file: cmd, args: [] },
      { file: pwsh, args: [] },
    ])
    expect(launches.every(({ process }) => process.kills.length === 0)).toBe(true)
    installed.delete(powershell)
    await expect(service.create(firstScope, 80, 24, profiles[1].id)).rejects.toMatchObject({ code: 'TERMINAL_SHELL_UNAVAILABLE' })
    expect((await service.listShellProfiles()).map(({ id }) => id)).toEqual([profiles[0].id, profiles[2].id])
    await expect(service.create(firstScope, 80, 24, 'bash')).rejects.toMatchObject({ code: 'TERMINAL_SHELL_UNAVAILABLE' })
    expect(launches).toHaveLength(4)
    await service.dispose()
  })

  it('does not advertise missing Unix shells and revalidates a selected shell before creating', async () => {
    const root = await temporaryDirectory('terminal-unix-profiles')
    const configuredShell = '/tools/test-shell'
    let shInstalled = true
    const spawnPty = vi.fn(() => new FakePty(80, 24))
    const service = new TerminalService(
      () => firstScope,
      async (scope) => ({ scope, cwd: root }),
      {
        platform: 'linux',
        environment: { SHELL: configuredShell, PATH: '' },
        resolveExecutable: async (candidate) => candidate === configuredShell || candidate === '/bin/sh' && shInstalled ? candidate : undefined,
        spawnPty,
      },
    )
    const profiles = await service.listShellProfiles()
    expect(profiles).toEqual([
      expect.objectContaining({ id: expect.stringMatching(/^detected:/), label: 'test-shell', isDefault: true }),
      expect.objectContaining({ id: expect.stringMatching(/^detected:/), label: 'sh', isDefault: false }),
    ])
    await service.create(firstScope, 80, 24, profiles[1].id)
    expect(spawnPty.mock.calls[0]).toEqual(['/bin/sh', ['-l'], expect.objectContaining({ cwd: await realpath(root) })])
    shInstalled = false
    await expect(service.create(firstScope, 80, 24, profiles[1].id)).rejects.toMatchObject({ code: 'TERMINAL_SHELL_UNAVAILABLE' })
    expect(spawnPty).toHaveBeenCalledTimes(1)
    await service.dispose()
  })

  it.each(['darwin', 'linux'] as const)(
    'uses the configured executable Unix shell on %s',
    async (platform) => {
      const root = await temporaryDirectory(`terminal-shell-${platform}`)
      const configuredShell = '/tools/test-shell'
      const launches: Array<{ file: string; args: string[] }> = []
      const service = new TerminalService(
        () => firstScope,
        async (scope) => ({ scope, cwd: root }),
        {
          environment: { SHELL: configuredShell },
          platform,
          resolveExecutable: async (candidate) => candidate === configuredShell ? configuredShell : undefined,
          spawnPty: (file, args, options) => {
            launches.push({ file, args })
            return new FakePty(options.cols ?? 80, options.rows ?? 24)
          },
        },
      )

      const created = await service.create(firstScope, 80, 24)
      expect(created.shell).toBe('test-shell')
      expect(launches).toEqual([{ file: configuredShell, args: ['-l'] }])
      await service.dispose()
    },
  )

  it('uses the latest global default for new tabs and the original resolved launch when restarting', async () => {
    const root = await temporaryDirectory('terminal-global-restart')
    const original = { id: 'custom:work', name: 'Work shell', executable: 'fish', args: ['--interactive', 'literal;argument'], env: { PATH: '/tools', MODE: 'original', REMOVE: null } }
    let settings: TerminalSettings = { ...DEFAULT_SETTINGS.terminal, defaultProfileId: original.id, profiles: [original] }
    const environment = { PATH: '/bin', MODE: 'inherited', REMOVE: 'remove-me' }
    const installed = new Set(['/tools/fish', '/tools/nu'])
    const launches: Array<{ file: string; args: string[]; env: NodeJS.ProcessEnv; process: FakePty }> = []
    const service = new TerminalService(() => firstScope, async (scope) => ({ scope, cwd: root }), {
      platform: 'linux', environment, getTerminalSettings: () => settings, readShellsFile: async () => '',
      resolveExecutable: async (candidate) => installed.has(candidate) ? candidate : undefined,
      spawnPty: (file, args, options) => {
        const process = new FakePty(options.cols ?? 80, options.rows ?? 24)
        launches.push({ file, args, env: { ...options.env }, process })
        return process
      },
    })
    const first = await service.create(firstScope, 80, 24)
    await service.rename(firstScope, first.terminalId, 'Long-running work')
    await expect(service.restart(firstScope, first.terminalId, 90, 30)).rejects.toMatchObject({ code: 'TERMINAL_STILL_RUNNING' })
    settings = { ...settings, defaultProfileId: 'custom:new', profiles: [{ id: 'custom:new', name: 'New shell', executable: '/tools/nu', args: ['--login'], env: { MODE: 'new' } }] }
    environment.MODE = 'changed-parent'
    const second = await service.create(firstScope, 80, 24)
    launches[0].process.emitExit(4)
    const restarted = await service.restart(firstScope, first.terminalId, 100, 35)
    expect(restarted).toMatchObject({ shell: 'Work shell', title: 'Long-running work', cols: 100, rows: 35, replay: '', sequence: 0, reused: false })
    expect(restarted.terminalId).not.toBe(first.terminalId)
    expect(launches.map(({ file }) => file)).toEqual(['/tools/fish', '/tools/nu', '/tools/fish'])
    expect(launches[2].args).toEqual(['--interactive', 'literal;argument'])
    expect(launches[2].env).toEqual(launches[0].env)
    expect(launches[2].env).toMatchObject({ MODE: 'original', PATH: '/tools', PWD: await realpath(root), TERM_PROGRAM: 'PiPilot' })
    expect(launches[2].env).not.toHaveProperty('REMOVE')
    expect(launches[1].process.kills).toEqual([])
    expect((await service.list(firstScope)).map(({ terminalId }) => terminalId)).toEqual([second.terminalId, restarted.terminalId])
    await service.dispose()
  })

  it('preserves the exited terminal when restart validation or spawning fails', async () => {
    const root = await temporaryDirectory('terminal-restart-failure')
    let installed = true
    let failSpawn = false
    const processes: FakePty[] = []
    const service = new TerminalService(() => firstScope, async (scope) => ({ scope, cwd: root }), {
      platform: 'linux', environment: { SHELL: '/tools/fish' },
      resolveExecutable: async (candidate) => installed && candidate === '/tools/fish' ? candidate : undefined,
      spawnPty: () => {
        if (failSpawn) throw new Error('Launch failed')
        const process = new FakePty(80, 24)
        processes.push(process)
        return process
      },
    })
    const first = await service.create(firstScope, 80, 24)
    await service.kill(firstScope, first.terminalId)
    installed = false
    await expect(service.restart(firstScope, first.terminalId, 80, 24)).rejects.toMatchObject({ code: 'TERMINAL_SHELL_UNAVAILABLE' })
    installed = true
    failSpawn = true
    await expect(service.restart(firstScope, first.terminalId, 80, 24)).rejects.toMatchObject({ code: 'TERMINAL_START_FAILED' })
    expect(await service.list(firstScope)).toEqual([expect.objectContaining({ terminalId: first.terminalId, status: 'exited' })])
    failSpawn = false
    const replacement = await service.restart(firstScope, first.terminalId, 80, 24)
    expect(replacement.terminalId).not.toBe(first.terminalId)
    expect(processes[0].kills).toEqual([undefined])
    await service.dispose()
  })

  it('keeps missing explicit defaults visible and never silently falls back', async () => {
    const root = await temporaryDirectory('terminal-missing-default')
    let settings: TerminalSettings = { ...DEFAULT_SETTINGS.terminal, defaultProfileId: 'detected:removed', profiles: [] }
    const spawnPty = vi.fn(() => new FakePty(80, 24))
    const service = new TerminalService(() => firstScope, async (scope) => ({ scope, cwd: root }), {
      platform: 'linux', environment: { SHELL: '/bin/sh' }, getTerminalSettings: () => settings,
      resolveExecutable: async (candidate) => candidate === '/bin/sh' ? candidate : undefined,
      readShellsFile: async () => '', spawnPty,
    })
    expect(await service.listShellProfiles()).toContainEqual(expect.objectContaining({ id: 'detected:removed', isDefault: true, available: false, unavailableReason: 'executable-not-found' }))
    await expect(service.create(firstScope, 80, 24)).rejects.toMatchObject({ code: 'TERMINAL_SHELL_UNAVAILABLE' })
    settings = { ...settings, defaultProfileId: 'custom:removed', profiles: [{ id: 'custom:removed', name: 'Missing', executable: '/missing/shell', args: [], env: {} }] }
    await expect(service.create(firstScope, 80, 24)).rejects.toMatchObject({ code: 'TERMINAL_SHELL_UNAVAILABLE' })
    expect(spawnPty).not.toHaveBeenCalled()
    settings = { ...settings, defaultProfileId: null }
    await service.create(firstScope, 80, 24)
    expect(spawnPty).toHaveBeenCalledTimes(1)
    await service.dispose()
  })

  it.each(['linux', 'win32'] as const)('launches only the selected custom profile without unrelated shell discovery on %s', async (platform) => {
    const root = await temporaryDirectory('terminal-direct-custom')
    const executable = platform === 'win32' ? 'D:\\Tools\\shell.exe' : '/tools/shell'
    const settings: TerminalSettings = {
      ...DEFAULT_SETTINGS.terminal, defaultProfileId: 'custom:work',
      profiles: [
        { id: 'custom:work', name: 'Work', executable, args: ['--login'], env: {} },
        { id: 'custom:other', name: 'Other', executable: '/unrelated/shell', args: [], env: {} },
      ],
    }
    let available = true
    const resolveExecutable = vi.fn(async (candidate: string) => available && candidate === executable ? candidate : undefined)
    const readDirectory = vi.fn(async () => [])
    const readShellsFile = vi.fn(async () => '')
    const probeProcess = vi.fn(async () => { throw new Error('Unrelated WSL timeout') })
    const spawnPty = vi.fn(() => new FakePty(80, 24))
    const service = new TerminalService(() => firstScope, async (scope) => ({ scope, cwd: root }), {
      platform, environment: {}, getTerminalSettings: () => settings,
      resolveExecutable, readDirectory, readShellsFile, probeProcess, spawnPty,
    })
    await service.create(firstScope, 80, 24)
    await service.create(firstScope, 80, 24, 'custom:work')
    available = false
    await expect(service.create(firstScope, 80, 24)).rejects.toMatchObject({ code: 'TERMINAL_SHELL_UNAVAILABLE' })
    await expect(service.create(firstScope, 80, 24, 'custom:removed')).rejects.toMatchObject({ code: 'TERMINAL_SHELL_UNAVAILABLE' })
    expect(resolveExecutable.mock.calls).toEqual([[executable], [executable], [executable]])
    expect(spawnPty).toHaveBeenCalledTimes(2)
    expect(readDirectory).not.toHaveBeenCalled()
    expect(readShellsFile).not.toHaveBeenCalled()
    expect(probeProcess).not.toHaveBeenCalled()
    await service.dispose()
  })

  it('applies Windows environment overrides case-insensitively and protects terminal identity', async () => {
    const root = await temporaryDirectory('terminal-windows-env')
    const settings: TerminalSettings = { ...DEFAULT_SETTINGS.terminal, defaultProfileId: 'custom:cmd', profiles: [{ id: 'custom:cmd', name: 'Custom CMD', executable: 'cmd', args: ['/Q'], env: { PATH: 'D:\\Tools', token: null, pwd: 'fake', term: 'fake', term_program: 'fake' } }] }
    let launched: NodeJS.ProcessEnv = {}
    const service = new TerminalService(() => firstScope, async (scope) => ({ scope, cwd: root }), {
      platform: 'win32', environment: { Path: 'C:\\Tools', TOKEN: 'inherited', PWD: 'old', TERM: 'old', TERM_PROGRAM: 'old' }, getTerminalSettings: () => settings,
      readDirectory: async () => [], resolveExecutable: async (candidate) => candidate === 'D:\\Tools\\cmd.exe' ? candidate : undefined,
      spawnPty: (_file, _args, options) => { launched = { ...options.env }; return new FakePty(80, 24) },
    })
    await service.create(firstScope, 80, 24)
    expect(launched).toMatchObject({ PATH: 'D:\\Tools', PWD: await realpath(root), TERM: 'xterm-256color', TERM_PROGRAM: 'PiPilot' })
    expect(Object.keys(launched).filter((key) => /^(path|pwd|term|term_program)$/i.test(key))).toEqual(['PATH', 'PWD', 'TERM', 'TERM_PROGRAM'])
    expect(Object.keys(launched).some((key) => key.toLowerCase() === 'token')).toBe(false)
    await service.dispose()
  })

  it('maps host working directories for WSL and rejects unmappable ones before launching', async () => {
    const root = await temporaryDirectory('terminal-wsl-cwd')
    let settings: TerminalSettings = { ...DEFAULT_SETTINGS.terminal, defaultProfileId: null, profiles: [] }
    const launches: Array<{ file: string; args: string[] }> = []
    const spawnPty = vi.fn((file: string, args: string[]) => {
      launches.push({ file, args })
      return new FakePty(80, 24)
    })
    const service = new TerminalService(() => firstScope, async (scope) => ({ scope, cwd: root }), {
      platform: 'win32', environment: {}, getTerminalSettings: () => settings, readDirectory: async () => [],
      resolveExecutable: async (candidate) => candidate === 'C:\\Windows\\System32\\wsl.exe' ? candidate : undefined,
      probeProcess: async () => Buffer.from('Ubuntu\r\n', 'utf16le'), spawnPty,
    })
    const profile = (await service.listShellProfiles()).find(({ source }) => source === 'wsl')!
    settings = { ...settings, defaultProfileId: profile.id }
    const linuxCwd = wslWorkingDirectory(await realpath(root), 'Ubuntu')
    if (linuxCwd) {
      const created = await service.create(firstScope, 80, 24)
      expect(created.shell).toBe('Ubuntu (WSL)')
      expect(launches).toEqual([{ file: profile.executable, args: [...profile.args, '--cd', linuxCwd] }])
    } else {
      await expect(service.create(firstScope, 80, 24)).rejects.toMatchObject({ code: 'TERMINAL_CWD_UNAVAILABLE' })
      expect(launches).toEqual([])
    }
    await service.dispose()
  })

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
