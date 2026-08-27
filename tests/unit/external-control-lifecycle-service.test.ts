import { describe, expect, it, vi } from 'vitest'
import {
  externalControlOperationSchema,
  type ExternalControlOperation,
  type ExternalControlSettingsSnapshot,
} from '../../src/shared/external-control'
import {
  ExternalControlLifecycleService,
  type ExternalControlMcpConfiguration,
  type ExternalControlLifecycleSession,
  type ExternalControlLifecycleSessionCallbacks,
} from '../../src/main/external-control/lifecycle-service'

interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

class FakePreferences {
  readonly writes: boolean[] = []

  constructor(public enabled = false) {}

  get = vi.fn(() => this.enabled)

  set = vi.fn((enabled: boolean) => {
    this.writes.push(enabled)
    this.enabled = enabled
    return enabled
  })
}

class FakeSession implements ExternalControlLifecycleSession {
  readonly operations = new Set<(operation: ExternalControlOperation) => void>()
  readonly order: string[]
  startGate: Promise<void> = Promise.resolve()

  constructor(
    readonly callbacks: ExternalControlLifecycleSessionCallbacks,
    order: string[],
  ) {
    this.order = order
  }

  start = vi.fn(async () => {
    this.order.push('start')
    await this.startGate
  })

  closeBridge = vi.fn(async () => {
    this.order.push('close-bridge')
    this.callbacks.onClientCountChanged(0)
  })

  disposeControl = vi.fn(async () => {
    this.order.push('dispose-control')
  })

  getConversationLabel = vi.fn(() => 'Planning session')

  subscribeOperations = vi.fn((listener: (operation: ExternalControlOperation) => void) => {
    this.operations.add(listener)
    return () => this.operations.delete(listener)
  })

  emitOperation(operation: ExternalControlOperation) {
    for (const listener of this.operations) listener(structuredClone(operation))
  }
}

const configuration = {
  command: 'pipilot-mcp',
  args: [],
} satisfies ExternalControlMcpConfiguration

function completedOperation() {
  return externalControlOperationSchema.parse({
    operationId: `op_${'o'.repeat(43)}`,
    conversationId: `conv_${'c'.repeat(43)}`,
    kind: 'send_prompt',
    status: 'completed',
    receivedAt: '2026-08-22T00:00:00.000Z',
    updatedAt: '2026-08-22T00:00:01.000Z',
    completedAt: '2026-08-22T00:00:01.000Z',
    finalResponse: 'private final response',
  })
}

function createHarness(enabled = false) {
  const preferences = new FakePreferences(enabled)
  const sessions: FakeSession[] = []
  const order: string[] = []
  const startGates: Promise<void>[] = []
  const service = new ExternalControlLifecycleService({
    preferenceRepository: preferences,
    configuration,
    createSession(callbacks) {
      const session = new FakeSession(callbacks, order)
      session.startGate = startGates.shift() ?? Promise.resolve()
      sessions.push(session)
      return session
    },
  })
  return { order, preferences, service, sessions, startGates }
}

describe('ExternalControlLifecycleService', () => {
  it('enables a generation, exposes metadata only, and closes bridge first', async () => {
    const { order, preferences, service, sessions } = createHarness()
    expect(await service.initialize()).toMatchObject({
      enabled: false,
      state: 'disabled',
      connectedClients: 0,
    })
    expect(sessions).toHaveLength(0)

    expect(await service.setEnabled(true)).toMatchObject({
      enabled: true,
      state: 'ready',
    })
    const first = sessions[0]!
    first.callbacks.onClientCountChanged(2)
    first.emitOperation(completedOperation())
    const ready = service.getSnapshot()
    expect(ready.connectedClients).toBe(2)
    expect(ready.recentOperations[0]).toMatchObject({
      conversationLabel: 'Planning session',
      action: 'send_prompt',
      status: 'completed',
      timestamp: '2026-08-22T00:00:01.000Z',
    })
    expect(ready.recentOperations[0]).not.toHaveProperty('operationId')
    expect(ready.recentOperations[0]).not.toHaveProperty('conversationId')
    expect(JSON.stringify(ready)).not.toContain('private final response')

    expect(await service.setEnabled(false)).toMatchObject({
      enabled: false,
      state: 'disabled',
      connectedClients: 0,
    })
    expect(order.slice(-2)).toEqual(['close-bridge', 'dispose-control'])
    expect(preferences.enabled).toBe(false)

    await service.setEnabled(true)
    expect(sessions).toHaveLength(2)
    expect(service.getSnapshot().recentOperations).toEqual([])
    first.callbacks.onClientCountChanged(3)
    first.emitOperation(completedOperation())
    expect(service.getSnapshot().connectedClients).toBe(0)
    expect(service.getSnapshot().recentOperations).toEqual([])
    await service.dispose()
  })

  it('starts from persisted enablement and retries a failed generation', async () => {
    const preferences = new FakePreferences(true)
    const sessions: FakeSession[] = []
    const service = new ExternalControlLifecycleService({
      preferenceRepository: preferences,
      configuration,
      createSession(callbacks) {
        const session = new FakeSession(callbacks, [])
        if (sessions.length === 0) {
          session.startGate = Promise.reject(new Error('private socket failure'))
        }
        sessions.push(session)
        return session
      },
    })

    expect(await service.initialize()).toMatchObject({
      enabled: true,
      state: 'error',
      error: { code: 'internal_error' },
    })
    expect(JSON.stringify(service.getSnapshot())).not.toContain('private socket failure')
    expect(await service.setEnabled(true)).toMatchObject({
      enabled: true,
      state: 'ready',
    })
    expect(sessions).toHaveLength(2)
    await service.dispose()
    expect(preferences.enabled).toBe(true)
  })

  it('does not publish ready when disable supersedes an enabling generation', async () => {
    const { service, sessions, startGates } = createHarness()
    await service.initialize()
    const states: ExternalControlSettingsSnapshot['state'][] = []
    service.subscribe((snapshot) => states.push(snapshot.state))
    const gate = deferred<void>()
    startGates.push(gate.promise)

    const enabling = service.setEnabled(true)
    await vi.waitFor(() => expect(sessions).toHaveLength(1))
    await vi.waitFor(() => expect(sessions[0]!.start).toHaveBeenCalledOnce())
    const disabling = service.setEnabled(false)
    gate.resolve()
    await Promise.all([enabling, disabling])

    expect(service.getSnapshot()).toMatchObject({ enabled: false, state: 'disabled' })
    expect(states).not.toContain('ready')
    expect(sessions[0]!.closeBridge).toHaveBeenCalledOnce()
    expect(sessions[0]!.disposeControl).toHaveBeenCalledOnce()
    await service.dispose()
  })

  it('reports unpackaged configuration as unavailable without a session', async () => {
    const preferences = new FakePreferences()
    const createSession = vi.fn()
    const service = new ExternalControlLifecycleService({
      preferenceRepository: preferences,
      configuration: null,
      createSession,
    })

    expect(await service.initialize()).toMatchObject({
      enabled: false,
      state: 'unavailable',
      error: { code: 'pipilot_unavailable' },
    })
    await expect(service.setEnabled(true)).rejects.toMatchObject({
      code: 'pipilot_unavailable',
    })
    expect(createSession).not.toHaveBeenCalled()
    await service.dispose()
  })
})
