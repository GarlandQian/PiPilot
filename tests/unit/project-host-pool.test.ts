import { describe, expect, it } from 'vitest'
import type {
  PiHostCommand,
  PiHostDto,
} from '../../src/shared/pi-host-protocol'
import type {
  PiHostControllerSnapshot,
  PiHostRequestOptions,
} from '../../src/main/pi-host/pi-host-controller'
import { projectPiHostDto } from '../../src/main/pi-host/pi-host-dto'
import {
  ProjectHostPool,
  type ProjectHostControllerLike,
  type ProjectHostScope,
  type ProjectRuntimeDescriptor,
} from '../../src/main/pi-host/project-host-pool'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

class FakeProjectHostController implements ProjectHostControllerLike {
  private readonly listeners = new Set<(snapshot: PiHostControllerSnapshot) => void>()
  private readonly runtimes = new Map<string, ProjectRuntimeDescriptor>()
  readonly requests: Array<{ command: PiHostCommand; options?: PiHostRequestOptions }> = []
  createDelay: Promise<void> | null = null
  startError: Error | null = null
  disposeCount = 0
  private snapshot: PiHostControllerSnapshot

  constructor(readonly cwd: string) {
    this.snapshot = {
      state: 'stopped',
      hostEpoch: 0,
      pid: null,
      cwd,
      sdkVersion: null,
      nodeVersion: null,
      electronVersion: null,
      capabilities: [],
      stderr: '',
      error: null,
    }
  }

  async start(): Promise<PiHostControllerSnapshot> {
    if (this.startError) throw this.startError
    this.publish({
      ...this.snapshot,
      state: 'ready',
      hostEpoch: this.snapshot.hostEpoch + 1,
      pid: 1_001,
      sdkVersion: '0.84.2',
      nodeVersion: '24.18.1',
      electronVersion: '43.4.1',
      capabilities: ['runtime.create', 'runtime.bind', 'runtime.reload', 'runtime.command', 'runtime.dispose'],
    })
    return this.getSnapshot()
  }

  async request(
    command: PiHostCommand,
    options?: PiHostRequestOptions,
  ): Promise<PiHostDto> {
    this.requests.push({ command: structuredClone(command), options })
    switch (command.type) {
      case 'runtime.create': {
        if (this.createDelay) await this.createDelay
        const runtime: ProjectRuntimeDescriptor = {
          runtimeId: command.runtimeId,
          generation: 1,
          cwd: this.cwd,
          sessionFile: command.sessionFile ??
            `${command.sessionDir ?? '/sessions/default'}/${command.runtimeId}.jsonl`,
          sessionId: `session-${command.runtimeId}`,
        }
        this.runtimes.set(command.runtimeId, runtime)
        return projectPiHostDto({ runtime })
      }
      case 'runtime.bind': {
        const runtimeId = options?.runtimeId
        if (!runtimeId) throw new Error('Missing Runtime target.')
        const runtime = this.runtimes.get(runtimeId)
        if (!runtime) throw new Error('Runtime not found.')
        return projectPiHostDto({ bound: true, runtime })
      }
      case 'runtime.reload': {
        const runtimeId = options?.runtimeId
        if (!runtimeId) throw new Error('Missing Runtime target.')
        const current = this.runtimes.get(runtimeId)
        if (!current) throw new Error('Runtime not found.')
        const runtime = { ...current, generation: current.generation + 1 }
        this.runtimes.set(runtimeId, runtime)
        return projectPiHostDto({ reloaded: true, runtime })
      }
      case 'runtime.command': {
        const runtimeId = options?.runtimeId
        if (!runtimeId) throw new Error('Missing Runtime target.')
        const current = this.runtimes.get(runtimeId)
        if (!current) throw new Error('Runtime not found.')
        const runtime = command.rpc.type === 'switch_session'
          ? {
              ...current,
              generation: current.generation + 1,
              sessionFile: command.rpc.sessionPath,
              sessionId: `session-${command.rpc.sessionPath}`,
            }
          : current
        this.runtimes.set(runtimeId, runtime)
        const rpc = command.rpc.type === 'switch_session'
          ? {
              type: 'response' as const,
              command: 'switch_session' as const,
              success: true as const,
              data: { cancelled: false },
            }
          : {
              type: 'response' as const,
              command: command.rpc.type,
              success: false as const,
              error: 'The fake command is not implemented.',
            }
        return projectPiHostDto({ runtime, rpc })
      }
      case 'runtime.external_submit': {
        const runtimeId = options?.runtimeId
        if (!runtimeId) throw new Error('Missing Runtime target.')
        const runtime = this.runtimes.get(runtimeId)
        if (!runtime) throw new Error('Runtime not found.')
        return projectPiHostDto({
          runtime,
          acceptedMode: command.mode === 'auto' ? 'prompt' : command.mode,
        })
      }
      case 'runtime.dispose': {
        const runtimeId = options?.runtimeId
        if (!runtimeId) throw new Error('Missing Runtime target.')
        const runtime = this.runtimes.get(runtimeId)
        if (!runtime) throw new Error('Runtime not found.')
        this.runtimes.delete(runtimeId)
        return projectPiHostDto({ disposed: true, runtime })
      }
      case 'session.rename':
        return projectPiHostDto({
          renamed: true,
          sessionFile: command.sessionFile,
          sessionId: 'session-renamed',
          name: command.name,
        })
      case 'ping':
        return { type: 'pong' }
      case 'runtime.extension_ui_response':
        return { delivered: true }
      case 'shutdown':
        return { shutdown: true }
    }
    throw new Error('Unhandled fake Host command.')
  }

  async stop(): Promise<PiHostControllerSnapshot> {
    this.runtimes.clear()
    this.publish({
      ...this.snapshot,
      state: 'stopped',
      pid: null,
      sdkVersion: null,
      nodeVersion: null,
      electronVersion: null,
      capabilities: [],
    })
    return this.getSnapshot()
  }

  async dispose(): Promise<void> {
    this.disposeCount += 1
    await this.stop()
    this.publish({ ...this.snapshot, state: 'disposed' })
  }

  getSnapshot(): PiHostControllerSnapshot {
    return structuredClone(this.snapshot)
  }

  subscribe(listener: (snapshot: PiHostControllerSnapshot) => void): () => boolean {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  crash(code = 'HOST_EXITED'): void {
    this.publish({
      ...this.snapshot,
      state: 'failed',
      pid: null,
      error: {
        name: 'Error',
        message: 'The fake Host crashed.',
        code,
      },
    })
  }

  private publish(snapshot: PiHostControllerSnapshot): void {
    this.snapshot = snapshot
    for (const listener of this.listeners) listener(this.getSnapshot())
  }
}

function createHarness(options: {
  createDelay?: Promise<void>
  failStartAt?: number[]
} = {}) {
  const controllers: FakeProjectHostController[] = []
  const diagnostics: string[] = []
  let runtimeSequence = 0
  const pool = new ProjectHostPool({
    canonicalizeCwd: (cwd) => cwd,
    createRuntimeId: () => `rt_${++runtimeSequence}`,
    onHostDiagnostic: (code) => diagnostics.push(code),
    createHost: (scope) => {
      const controller = new FakeProjectHostController(scope.cwd)
      controller.createDelay = options.createDelay ?? null
      if (options.failStartAt?.includes(controllers.length)) {
        controller.startError = Object.assign(
          new Error('The replacement Host failed.'),
          { code: 'REPLACEMENT_START_FAILED' },
        )
      }
      controllers.push(controller)
      return controller
    },
  })
  return { controllers, diagnostics, pool }
}

const projectA: ProjectHostScope = { kind: 'project', cwd: '/projects/a' }
const projectB: ProjectHostScope = { kind: 'project', cwd: '/projects/b' }

describe('ProjectHostPool', () => {
  it('omits an absent custom session directory from the strict Host DTO', async () => {
    const { pool, controllers } = createHarness()

    await pool.createRuntime(projectA, {})

    const createRequest = controllers[0]?.requests.find(
      (request) => request.command.type === 'runtime.create',
    )
    expect(createRequest?.command).toEqual(expect.objectContaining({
      type: 'runtime.create',
    }))
    expect(createRequest?.command).not.toHaveProperty('sessionDir')
    await pool.dispose()
  })

  it('allocates protocol-valid Runtime IDs with the production default factory', async () => {
    const controllers: FakeProjectHostController[] = []
    const pool = new ProjectHostPool({
      canonicalizeCwd: (cwd) => cwd,
      createHost: (scope) => {
        const controller = new FakeProjectHostController(scope.cwd)
        controllers.push(controller)
        return controller
      },
    })

    const runtime = await pool.createRuntime(projectA, {
      sessionDir: '/sessions/a',
    })

    expect(runtime.runtimeId).toMatch(/^rt_[A-Za-z0-9_-]+$/)
    expect(pool.getHost(projectA)?.runtimes[0]?.state).toBe('starting')
    expect(controllers[0].requests[0]).toMatchObject({
      command: { type: 'runtime.create', runtimeId: runtime.runtimeId },
    })
    await expect(pool.bindRuntime(runtime.runtimeId, runtime.generation))
      .resolves.toEqual(runtime)
    expect(pool.getHost(projectA)?.runtimes[0]?.state).toBe('ready')
    expect(controllers[0].requests[1]).toMatchObject({
      command: { type: 'runtime.bind' },
      options: {
        runtimeId: runtime.runtimeId,
        runtimeGeneration: runtime.generation,
      },
    })
    await pool.dispose()
  })

  it('surfaces a real Host allocation failure instead of a capacity error', async () => {
    const pool = new ProjectHostPool({
      canonicalizeCwd: (cwd) => cwd,
      createHost: () => {
        const error = new Error('The operating system refused the utility process allocation.')
        Object.assign(error, { code: 'ENOMEM' })
        throw error
      },
    })

    await expect(pool.createRuntime(projectA, {
      sessionDir: '/sessions/a',
    })).rejects.toMatchObject({
      code: 'HOST_START_FAILED',
      diagnostic: { code: 'ENOMEM' },
    })
    await pool.dispose()
  })

  it('reuses one Host for multiple conversations in the same project', async () => {
    const { controllers, pool } = createHarness()
    const first = await pool.createRuntime(projectA, {
      sessionDir: '/sessions/a',
      sessionFile: '/sessions/a/one.jsonl',
    })
    const second = await pool.createRuntime(projectA, {
      sessionDir: '/sessions/a',
      sessionFile: '/sessions/a/two.jsonl',
    })
    await pool.createRuntime(projectB, {
      sessionDir: '/sessions/b',
      sessionFile: '/sessions/b/one.jsonl',
    })

    expect(controllers).toHaveLength(2)
    expect(first.runtimeId).not.toBe(second.runtimeId)
    expect(pool.getHost(projectA)?.runtimes).toHaveLength(2)
    expect(pool.getSnapshot().hosts).toHaveLength(2)
    await pool.dispose()
  })

  it('starts every requested project Host without a fixed count limit', async () => {
    const { controllers, pool } = createHarness()
    const scopes = Array.from({ length: 9 }, (_, index): ProjectHostScope => ({
      kind: 'project',
      cwd: `/projects/unbounded-${index}`,
    }))

    const runtimes = await Promise.all(scopes.map((scope, index) =>
      pool.createRuntime(scope, { sessionDir: `/sessions/${index}` }),
    ))

    expect(controllers).toHaveLength(scopes.length)
    expect(runtimes).toHaveLength(scopes.length)
    expect(pool.getSnapshot().hosts).toHaveLength(scopes.length)
    expect(pool.getSnapshot().hosts.every((host) => host.state === 'ready')).toBe(true)
    await pool.dispose()
  })

  it('allows concurrent Runtime creation while reserving pending Session leases', async () => {
    const gate = deferred()
    const { pool } = createHarness({ createDelay: gate.promise })
    const first = pool.createRuntime(projectA, {
      sessionDir: '/sessions/a',
      sessionFile: '/sessions/a/shared.jsonl',
    })
    const second = pool.createRuntime(projectA, {
      sessionDir: '/sessions/a',
      sessionFile: '/sessions/a/other.jsonl',
    })
    await expect(pool.createRuntime(projectA, {
      sessionDir: '/sessions/a',
      sessionFile: '/sessions/a/shared.jsonl',
    })).rejects.toMatchObject({ code: 'RUNTIME_SESSION_IN_USE' })

    gate.resolve()
    await expect(Promise.all([first, second])).resolves.toHaveLength(2)
    expect(pool.getHost(projectA)?.runtimes).toHaveLength(2)
    await pool.dispose()
  })

  it('rejects switching a second Runtime onto an already leased Session', async () => {
    const { pool } = createHarness()
    const first = await pool.createRuntime(projectA, {
      sessionDir: '/sessions/a',
      sessionFile: '/sessions/a/one.jsonl',
    })
    const second = await pool.createRuntime(projectA, {
      sessionDir: '/sessions/a',
      sessionFile: '/sessions/a/two.jsonl',
    })
    await pool.bindRuntime(second.runtimeId, second.generation)

    await expect(pool.command(second.runtimeId, {
      type: 'switch_session',
      sessionPath: first.sessionFile!,
    })).rejects.toMatchObject({ code: 'RUNTIME_SESSION_IN_USE' })
    await pool.dispose()
  })

  it('forwards an explicit Runtime command timeout to the Host controller', async () => {
    const { controllers, pool } = createHarness()
    const runtime = await pool.createRuntime(projectA, {
      sessionDir: '/sessions/a',
      sessionFile: '/sessions/a/one.jsonl',
    })
    await pool.bindRuntime(runtime.runtimeId, runtime.generation)

    await pool.command(runtime.runtimeId, { type: 'get_state' }, runtime.generation, 90_000)

    expect(controllers[0].requests[controllers[0].requests.length - 1]?.options).toMatchObject({
      runtimeId: runtime.runtimeId,
      runtimeGeneration: runtime.generation,
      timeoutMs: 90_000,
    })
    await pool.dispose()
  })

  it('routes external submission to the exact Runtime generation', async () => {
    const { controllers, pool } = createHarness()
    const runtime = await pool.createRuntime(projectA, {
      sessionDir: '/sessions/a',
      sessionFile: '/sessions/a/one.jsonl',
    })
    await pool.bindRuntime(runtime.runtimeId, runtime.generation)

    await expect(pool.externalSubmit(
      runtime.runtimeId,
      'Continue the exact conversation.',
      'auto',
      runtime.generation,
      90_000,
    )).resolves.toEqual({ runtime, acceptedMode: 'prompt' })
    expect(controllers[0].requests[controllers[0].requests.length - 1]).toMatchObject({
      command: {
        type: 'runtime.external_submit',
        message: 'Continue the exact conversation.',
        mode: 'auto',
      },
      options: {
        runtimeId: runtime.runtimeId,
        runtimeGeneration: runtime.generation,
        timeoutMs: 90_000,
      },
    })
    await expect(pool.externalSubmit(
      runtime.runtimeId,
      'Stale submission.',
      'prompt',
      runtime.generation + 1,
    )).rejects.toMatchObject({ code: 'RUNTIME_STALE_GENERATION' })
    await pool.dispose()
  })

  it('reloads a retained Runtime without changing its Session lease', async () => {
    const { controllers, pool } = createHarness()
    const runtime = await pool.createRuntime(projectA, {
      sessionDir: '/sessions/a',
      sessionFile: '/sessions/a/one.jsonl',
    })
    await pool.bindRuntime(runtime.runtimeId, runtime.generation)

    const reloaded = await pool.reloadRuntime(
      runtime.runtimeId,
      runtime.generation,
      90_000,
    )

    expect(reloaded).toMatchObject({
      runtimeId: runtime.runtimeId,
      generation: runtime.generation + 1,
      sessionFile: runtime.sessionFile,
    })
    expect(controllers[0].requests[controllers[0].requests.length - 1]).toMatchObject({
      command: { type: 'runtime.reload' },
      options: {
        runtimeId: runtime.runtimeId,
        runtimeGeneration: runtime.generation,
        timeoutMs: 90_000,
      },
    })
    expect(pool.getHost(projectA)?.runtimes[0]?.leaseKey).toBe(runtime.sessionFile)
    await pool.dispose()
  })

  it('renames an inactive persisted Session through its project Host', async () => {
    const { controllers, pool } = createHarness()

    await expect(pool.renameSession(
      projectA,
      '/sessions/a/inactive.jsonl',
      'Renamed session',
    )).resolves.toEqual({
      sessionId: 'session-renamed',
      name: 'Renamed session',
    })
    expect(
      controllers[0]?.requests[controllers[0].requests.length - 1],
    ).toMatchObject({
      command: {
        type: 'session.rename',
        sessionFile: '/sessions/a/inactive.jsonl',
        name: 'Renamed session',
      },
    })
    await pool.dispose()
  })

  it('marks every Runtime crashed and rejects further commands after Host failure', async () => {
    const { controllers, pool } = createHarness()
    const runtime = await pool.createRuntime(projectA, {
      sessionDir: '/sessions/a',
      sessionFile: '/sessions/a/one.jsonl',
    })

    controllers[0].crash()

    expect(pool.getHost(projectA)).toMatchObject({
      state: 'crashed',
      runtimes: [{ runtimeId: runtime.runtimeId, state: 'crashed' }],
    })
    await expect(pool.command(runtime.runtimeId, { type: 'get_state' }))
      .rejects.toMatchObject({ code: 'HOST_CRASHED' })
    await pool.dispose()
  })

  it('recovers a crashed project Host on one explicit Session open and isolates other projects', async () => {
    const { controllers, diagnostics, pool } = createHarness()
    const original = await pool.createRuntime(projectA, {
      sessionDir: '/sessions/a',
      sessionFile: '/sessions/a/one.jsonl',
    })
    const healthy = await pool.createRuntime(projectB, {
      sessionDir: '/sessions/b',
      sessionFile: '/sessions/b/one.jsonl',
    })

    controllers[0].crash('RUNTIME_EXTENSION_SHUTDOWN_REQUESTED')
    const recovered = await pool.createRuntime(projectA, {
      sessionDir: '/sessions/a',
      sessionFile: original.sessionFile!,
    })

    expect(controllers).toHaveLength(3)
    expect(controllers[0].disposeCount).toBe(1)
    expect(recovered.runtimeId).not.toBe(original.runtimeId)
    expect(pool.getHost(projectA)).toMatchObject({
      state: 'ready',
      runtimes: [{ runtimeId: recovered.runtimeId }],
    })
    expect(pool.getHost(projectB)).toMatchObject({
      state: 'ready',
      runtimes: [{ runtimeId: healthy.runtimeId }],
    })
    expect(diagnostics).toEqual(['RUNTIME_EXTENSION_SHUTDOWN_REQUESTED'])

    controllers[0].crash('STALE_OLD_CONTROLLER_FAILURE')
    expect(pool.getHost(projectA)?.state).toBe('ready')
    await pool.dispose()
  })

  it('joins concurrent same-scope Session opens to one Host recovery', async () => {
    const { controllers, pool } = createHarness()
    await pool.createRuntime(projectA, {
      sessionDir: '/sessions/a',
      sessionFile: '/sessions/a/original.jsonl',
    })
    controllers[0].crash()

    const [first, second] = await Promise.all([
      pool.createRuntime(projectA, {
        sessionDir: '/sessions/a',
        sessionFile: '/sessions/a/first.jsonl',
      }),
      pool.createRuntime(projectA, {
        sessionDir: '/sessions/a',
        sessionFile: '/sessions/a/second.jsonl',
      }),
    ])

    expect(controllers).toHaveLength(2)
    expect(first.runtimeId).not.toBe(second.runtimeId)
    expect(pool.getHost(projectA)?.runtimes).toHaveLength(2)
    await pool.dispose()
  })

  it('settles a failed replacement once and permits a later explicit recovery', async () => {
    const { controllers, pool } = createHarness({ failStartAt: [1] })
    await pool.createRuntime(projectA, {
      sessionDir: '/sessions/a',
      sessionFile: '/sessions/a/original.jsonl',
    })
    controllers[0].crash()

    await expect(pool.createRuntime(projectA, {
      sessionDir: '/sessions/a',
      sessionFile: '/sessions/a/retry.jsonl',
    })).rejects.toMatchObject({ code: 'HOST_RECOVERY_FAILED' })
    expect(controllers).toHaveLength(2)

    await expect(pool.createRuntime(projectA, {
      sessionDir: '/sessions/a',
      sessionFile: '/sessions/a/retry.jsonl',
    })).resolves.toMatchObject({ sessionFile: '/sessions/a/retry.jsonl' })
    expect(controllers).toHaveLength(3)
    await pool.dispose()
  })

  it('uses the same demand-driven recovery for projectless Sessions', async () => {
    const { controllers, pool } = createHarness()
    const projectless: ProjectHostScope = {
      kind: 'projectless',
      cwd: '/projects/projectless',
    }
    await pool.createRuntime(projectless, {
      sessionDir: '/sessions/projectless',
      sessionFile: '/sessions/projectless/one.jsonl',
    })
    controllers[0].crash()

    await expect(pool.createRuntime(projectless, {
      sessionDir: '/sessions/projectless',
      sessionFile: '/sessions/projectless/one.jsonl',
    })).resolves.toMatchObject({
      sessionFile: '/sessions/projectless/one.jsonl',
    })
    expect(controllers).toHaveLength(2)
    await pool.dispose()
  })
})
