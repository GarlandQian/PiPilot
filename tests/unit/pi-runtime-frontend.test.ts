import { describe, expect, it, vi } from 'vitest'
import {
  PiRuntimeFrontend,
  type PiRuntimeFrontendOptions,
} from '../../src/main/pi-host/pi-runtime-frontend'
import {
  ProjectHostPoolError,
  type ProjectHostPool,
  type ProjectHostPoolSnapshot,
  type ProjectHostScope,
  type ProjectHostState,
  type ProjectRuntimeDescriptor,
  type ProjectRuntimeTarget,
} from '../../src/main/pi-host/project-host-pool'
import type { ConversationScope } from '../../src/shared/conversation-scope'
import type {
  LocalPiExtensionUiResponse,
  LocalPiRpcEvent,
  LocalPiRpcCommand,
  LocalPiRpcResponse,
  LocalPiSessionState,
} from '../../src/shared/local-pi'
import {
  PI_HOST_PROTOCOL_VERSION,
  type PiHostEventEnvelope,
  type PiHostUiRequestEventEnvelope,
} from '../../src/shared/pi-host-protocol'

const projectScope = {
  kind: 'project',
  workspaceId: '00000000-0000-4000-8000-000000000301',
} as const satisfies ConversationScope
const projectCwd = '/projects/active'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

function sessionState(
  sessionId: string,
  sessionFile: string,
): LocalPiSessionState {
  return {
    thinkingLevel: 'medium',
    isStreaming: false,
    isCompacting: false,
    steeringMode: 'one-at-a-time',
    followUpMode: 'one-at-a-time',
    sessionFile,
    sessionId,
    autoCompactionEnabled: true,
    messageCount: 0,
    pendingMessageCount: 0,
  }
}

class FakeFrontendPool {
  readonly commandCalls: Array<{
    runtimeId: string
    command: LocalPiRpcCommand
    expectedGeneration?: number
    timeoutMs?: number
  }> = []
  readonly disposeCalls: Array<{ runtimeId: string; generation?: number }> = []
  readonly externalSubmitCalls: Array<{
    runtimeId: string
    message: string
    mode: 'auto' | 'prompt' | 'follow_up' | 'steer'
    expectedGeneration: number
    timeoutMs?: number
  }> = []
  readonly restartCalls: ProjectHostScope[] = []
  readonly acknowledgedEvents: Array<
    PiHostEventEnvelope | PiHostUiRequestEventEnvelope
  > = []
  readonly eventOrder: string[] = []
  failNextHydration = false
  failHydrationsRemaining = 0
  createError: Error | null = null
  externalSubmitError: Error | null = null
  rebindOnPrompt = false
  promptDelay: Promise<void> | null = null
  rebindUiId: string | null = null
  waitForRebindUiResponse = false
  startupUiId: string | null = null
  waitForStartupUiResponse = false
  readonly uiResponses: Array<{
    runtimeId: string
    generation: number
    response: LocalPiExtensionUiResponse
  }> = []
  private resolveStartupUiResponse: (() => void) | null = null
  createCount = 0
  runtime: ProjectRuntimeDescriptor | null = null
  private readonly runtimeStates = new Map<string, {
    descriptor: ProjectRuntimeDescriptor
    state: LocalPiSessionState
  }>()
  private hostScope: ProjectHostScope | null = null
  private snapshot: ProjectHostPoolSnapshot = { state: 'ready', hosts: [] }
  private readonly snapshotListeners = new Set<(snapshot: ProjectHostPoolSnapshot) => void>()
  private readonly eventListeners = new Set<(event: PiHostEventEnvelope) => void>()
  private readonly uiListeners = new Set<(event: PiHostUiRequestEventEnvelope) => void>()

  subscribe(listener: (snapshot: ProjectHostPoolSnapshot) => void) {
    this.snapshotListeners.add(listener)
    return () => this.snapshotListeners.delete(listener)
  }

  getSnapshot(): ProjectHostPoolSnapshot {
    return structuredClone(this.snapshot)
  }

  subscribeEvents(listener: (event: PiHostEventEnvelope) => void) {
    this.eventListeners.add(listener)
    return () => this.eventListeners.delete(listener)
  }

  subscribeUiRequests(listener: (event: PiHostUiRequestEventEnvelope) => void) {
    this.uiListeners.add(listener)
    return () => this.uiListeners.delete(listener)
  }

  acknowledgeEvent(event: PiHostEventEnvelope | PiHostUiRequestEventEnvelope) {
    this.eventOrder.push('ack')
    this.acknowledgedEvents.push(structuredClone(event))
  }

  async createRuntime(
    scope: ProjectHostScope,
    target: ProjectRuntimeTarget,
  ): Promise<ProjectRuntimeDescriptor> {
    this.createCount += 1
    if (this.createError) throw this.createError
    this.hostScope = structuredClone(scope)
    const runtimeId = `rt_frontend_${this.createCount}`
    const sessionFile = target.sessionFile ?? `/sessions/${runtimeId}.jsonl`
    this.runtime = {
      runtimeId,
      generation: 1,
      cwd: scope.cwd,
      sessionFile,
      sessionId: `session-${this.createCount}`,
    }
    this.runtimeStates.set(runtimeId, {
      descriptor: this.runtime,
      state: sessionState(this.runtime.sessionId, sessionFile),
    })
    this.publishCurrentHost()
    return structuredClone(this.runtime)
  }

  async bindRuntime(
    runtimeId: string,
    expectedGeneration?: number,
  ): Promise<ProjectRuntimeDescriptor> {
    const runtimeState = this.runtimeStates.get(runtimeId)
    if (!runtimeState) throw new Error(`Runtime not found: ${runtimeId}`)
    if (
      expectedGeneration !== undefined &&
      expectedGeneration !== runtimeState.descriptor.generation
    ) {
      throw new Error(
        `Expected generation ${expectedGeneration}, received ${runtimeState.descriptor.generation}.`,
      )
    }
    if (this.startupUiId !== null) {
      const id = this.startupUiId
      const responseGate = this.waitForStartupUiResponse
        ? new Promise<void>((resolve) => {
            this.resolveStartupUiResponse = resolve
          })
        : null
      this.emitUiRequest({
        kind: 'ui_request',
        protocolVersion: PI_HOST_PROTOCOL_VERSION,
        hostEpoch: 1,
        runtimeId,
        runtimeGeneration: runtimeState.descriptor.generation,
        sequence: 1,
        request: {
          type: 'extension_ui_request',
          id,
          method: 'confirm',
          title: 'Startup confirmation',
          message: 'Continue starting the extension?',
        },
      })
      if (responseGate) await responseGate
    }
    return structuredClone(runtimeState.descriptor)
  }

  async reloadRuntime(
    runtimeId: string,
    expectedGeneration?: number,
  ): Promise<ProjectRuntimeDescriptor> {
    const runtimeState = this.runtimeStates.get(runtimeId)
    if (!runtimeState) throw new Error(`Runtime not found: ${runtimeId}`)
    if (
      expectedGeneration !== undefined &&
      runtimeState.descriptor.generation !== expectedGeneration
    ) {
      throw new Error(
        `Expected generation ${expectedGeneration}, received ${runtimeState.descriptor.generation}.`,
      )
    }
    runtimeState.descriptor = {
      ...runtimeState.descriptor,
      generation: runtimeState.descriptor.generation + 1,
    }
    this.runtimeStates.set(runtimeId, runtimeState)
    if (this.runtime?.runtimeId === runtimeId) {
      this.runtime = runtimeState.descriptor
    }
    this.publishCurrentHost()
    return structuredClone(runtimeState.descriptor)
  }

  async command(
    runtimeId: string,
    command: LocalPiRpcCommand,
    expectedGeneration?: number,
    timeoutMs?: number,
  ): Promise<{ runtime: ProjectRuntimeDescriptor; response: LocalPiRpcResponse }> {
    this.commandCalls.push({
      runtimeId,
      command: structuredClone(command),
      ...(expectedGeneration === undefined ? {} : { expectedGeneration }),
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    })
    const runtimeState = this.runtimeStates.get(runtimeId)
    if (!runtimeState) {
      throw new Error(`Runtime not found: ${runtimeId}`)
    }
    if (
      expectedGeneration !== undefined &&
      expectedGeneration !== runtimeState.descriptor.generation
    ) {
      throw new Error(
        `Expected generation ${expectedGeneration}, received ${runtimeState.descriptor.generation}.`,
      )
    }

    let response: LocalPiRpcResponse
    switch (command.type) {
      case 'get_state':
        response = {
          type: 'response',
          command: 'get_state',
          success: true,
          data: structuredClone(runtimeState.state),
        }
        break
      case 'get_commands':
        if (this.failNextHydration || this.failHydrationsRemaining > 0) {
          this.failNextHydration = false
          this.failHydrationsRemaining = Math.max(0, this.failHydrationsRemaining - 1)
          response = {
            type: 'response',
            command: 'get_commands',
            success: false,
            error: 'The command catalog failed to load.',
          }
        } else {
          response = {
            type: 'response',
            command: 'get_commands',
            success: true,
            data: { commands: [] },
          }
        }
        break
      case 'new_session': {
        const generation = runtimeState.descriptor.generation + 1
        const sessionFile = `/sessions/new-${generation}.jsonl`
        runtimeState.descriptor = {
          ...runtimeState.descriptor,
          generation,
          sessionFile,
          sessionId: `session-${generation}`,
        }
        runtimeState.state = sessionState(runtimeState.descriptor.sessionId, sessionFile)
        this.runtimeStates.set(runtimeId, runtimeState)
        if (this.runtime?.runtimeId === runtimeId) {
          this.runtime = runtimeState.descriptor
        }
        this.publishCurrentHost()
        response = {
          type: 'response',
          command: 'new_session',
          success: true,
          data: { cancelled: false },
        }
        break
      }
      case 'prompt':
        if (this.promptDelay) await this.promptDelay
        if (this.rebindOnPrompt) {
          const generation = runtimeState.descriptor.generation + 1
          const sessionFile = `/sessions/extension-rebind-${generation}.jsonl`
          runtimeState.descriptor = {
            ...runtimeState.descriptor,
            generation,
            sessionFile,
            sessionId: `extension-session-${generation}`,
          }
          runtimeState.state = sessionState(
            runtimeState.descriptor.sessionId,
            sessionFile,
          )
          this.runtimeStates.set(runtimeId, runtimeState)
          if (this.runtime?.runtimeId === runtimeId) {
            this.runtime = runtimeState.descriptor
          }
          this.publishCurrentHost()
          if (this.rebindUiId !== null) {
            const responseGate = this.waitForRebindUiResponse
              ? new Promise<void>((resolve) => {
                  this.resolveStartupUiResponse = resolve
                })
              : null
            this.emitUiRequest({
              kind: 'ui_request',
              protocolVersion: PI_HOST_PROTOCOL_VERSION,
              hostEpoch: 1,
              runtimeId,
              runtimeGeneration: generation,
              sequence: 1,
              request: {
                type: 'extension_ui_request',
                id: this.rebindUiId,
                method: 'confirm',
                title: 'Rebind confirmation',
                message: 'Continue the new Session?',
              },
            })
            if (responseGate) await responseGate
          }
        }
        response = {
          type: 'response',
          command: 'prompt',
          success: true,
        }
        break
      case 'abort':
        response = {
          type: 'response',
          command: 'abort',
          success: true,
        }
        break
      default:
        response = {
          type: 'response',
          command: command.type,
          success: false,
          error: `Unsupported fake command: ${command.type}`,
        } as LocalPiRpcResponse
    }
    return {
      runtime: structuredClone(runtimeState.descriptor),
      response,
    }
  }

  async externalSubmit(
    runtimeId: string,
    message: string,
    mode: 'auto' | 'prompt' | 'follow_up' | 'steer',
    expectedGeneration: number,
    timeoutMs?: number,
  ) {
    this.externalSubmitCalls.push({
      runtimeId,
      message,
      mode,
      expectedGeneration,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    })
    if (this.externalSubmitError) throw this.externalSubmitError
    const runtimeState = this.runtimeStates.get(runtimeId)
    if (!runtimeState) throw new Error(`Runtime not found: ${runtimeId}`)
    if (runtimeState.descriptor.generation !== expectedGeneration) {
      throw new ProjectHostPoolError(
        'RUNTIME_STALE_GENERATION',
        'The Runtime generation is stale.',
      )
    }
    const acceptedMode = mode === 'auto'
      ? runtimeState.state.isStreaming ? 'follow_up' : 'prompt'
      : mode
    return {
      runtime: structuredClone(runtimeState.descriptor),
      acceptedMode,
    }
  }

  async disposeRuntime(runtimeId: string, generation?: number) {
    this.disposeCalls.push({
      runtimeId,
      ...(generation === undefined ? {} : { generation }),
    })
    const runtimeState = this.runtimeStates.get(runtimeId)
    const descriptor = runtimeState
      ? structuredClone(runtimeState.descriptor)
      : null
    if (descriptor) {
      this.runtimeStates.delete(runtimeId)
      if (this.runtime?.runtimeId === runtimeId) {
        this.runtime = [...this.runtimeStates.values()].pop()?.descriptor ?? null
      }
      this.publishCurrentHost()
    }
    return descriptor
  }

  async respondToExtensionUi(
    runtimeId: string,
    response: LocalPiExtensionUiResponse,
    generation: number,
  ) {
    this.uiResponses.push({
      runtimeId,
      generation,
      response: structuredClone(response),
    })
    this.resolveStartupUiResponse?.()
    this.resolveStartupUiResponse = null
  }

  async renameSession(
    _scope: ProjectHostScope,
    sessionFile: string,
    name: string,
  ) {
    const runtime = this.runtimeForSession(sessionFile)
    return {
      sessionId: runtime?.sessionId ?? 'inactive-session',
      name,
    }
  }

  rebindRuntime(runtimeId: string, sessionFile: string) {
    const runtimeState = this.runtimeStates.get(runtimeId)
    if (!runtimeState) throw new Error(`Runtime not found: ${runtimeId}`)
    runtimeState.descriptor = {
      ...runtimeState.descriptor,
      generation: runtimeState.descriptor.generation + 1,
      sessionFile,
      sessionId: `background-${runtimeState.descriptor.generation + 1}`,
    }
    runtimeState.state = sessionState(
      runtimeState.descriptor.sessionId,
      sessionFile,
    )
    this.runtimeStates.set(runtimeId, runtimeState)
    if (this.runtime?.runtimeId === runtimeId) {
      this.runtime = runtimeState.descriptor
    }
    this.publishCurrentHost()
  }

  runtimeForSession(sessionFile: string) {
    return [...this.runtimeStates.values()].find(
      (entry) => entry.descriptor.sessionFile === sessionFile,
    )?.descriptor ?? null
  }

  setRuntimeSessionState(
    runtimeId: string,
    update: Partial<LocalPiSessionState>,
  ) {
    const runtimeState = this.runtimeStates.get(runtimeId)
    if (!runtimeState) throw new Error(`Runtime not found: ${runtimeId}`)
    runtimeState.state = { ...runtimeState.state, ...update }
  }

  get runtimeCount() {
    return this.runtimeStates.size
  }

  async restart(scope: ProjectHostScope) {
    this.restartCalls.push(structuredClone(scope))
    this.hostScope = structuredClone(scope)
    this.runtimeStates.clear()
    this.runtime = null
    const host = this.hostSnapshot(scope, 'ready', null)
    this.emitSnapshot({
      state: 'ready',
      hosts: [host],
    })
    return host
  }

  emitEvent(event: PiHostEventEnvelope) {
    for (const listener of this.eventListeners) listener(structuredClone(event))
  }

  emitUiRequest(event: PiHostUiRequestEventEnvelope) {
    for (const listener of this.uiListeners) listener(structuredClone(event))
  }

  emitSnapshot(snapshot: ProjectHostPoolSnapshot) {
    this.snapshot = structuredClone(snapshot)
    for (const listener of this.snapshotListeners) listener(structuredClone(snapshot))
  }

  hostSnapshot(
    scope: ProjectHostScope,
    state: ProjectHostState,
    runtime: ProjectRuntimeDescriptor | ProjectRuntimeDescriptor[] | null,
  ): ProjectHostPoolSnapshot['hosts'][number] {
    const runtimes = runtime === null
      ? []
      : Array.isArray(runtime)
        ? runtime
        : [runtime]
    return {
      hostKey: `${scope.kind}:${scope.cwd}`,
      scope: structuredClone(scope),
      cwd: scope.cwd,
      state,
      controller: {
        state: state === 'crashed' ? 'failed' : 'ready',
        hostEpoch: 1,
        pid: state === 'crashed' ? null : 1_001,
        cwd: scope.cwd,
        sdkVersion: '0.84.2',
        nodeVersion: '24.18.1',
        electronVersion: '43.4.1',
        capabilities: [],
        stderr: '',
        error: state === 'crashed'
          ? { name: 'Error', message: 'Host crashed.', code: 'HOST_EXITED' }
          : null,
      },
      runtimes: runtimes.map((entry) => ({
            ...structuredClone(entry),
            state: state === 'crashed' ? 'crashed' : 'ready',
            leaseKey: entry.sessionFile,
          })),
      error: state === 'crashed'
        ? { name: 'Error', message: 'Host crashed.', code: 'HOST_EXITED' }
        : null,
    }
  }

  private publishCurrentHost() {
    if (!this.hostScope) return
    this.emitSnapshot({
      state: 'ready',
      hosts: [this.hostSnapshot(
        this.hostScope,
        'ready',
        [...this.runtimeStates.values()].map((entry) => entry.descriptor),
      )],
    })
  }
}

function createHarness(options: PiRuntimeFrontendOptions = {}) {
  const pool = new FakeFrontendPool()
  const frontend = new PiRuntimeFrontend(
    pool as unknown as ProjectHostPool,
    {
      prepare: vi.fn(async (scope: ConversationScope) => ({
        scope,
        cwd: projectCwd,
        label: 'Active project',
      })),
    },
    options,
  )
  return { frontend, pool }
}

function uiRequest(
  runtimeId: string,
  runtimeGeneration: number,
  id: string,
  method: 'notify' | 'confirm' = 'notify',
): PiHostUiRequestEventEnvelope {
  return {
    kind: 'ui_request',
    protocolVersion: PI_HOST_PROTOCOL_VERSION,
    hostEpoch: 1,
    runtimeId,
    runtimeGeneration,
    sequence: 1,
    request: method === 'confirm'
      ? {
          type: 'extension_ui_request',
          id,
          method,
          title: id,
          message: id,
        }
      : {
          type: 'extension_ui_request',
          id,
          method,
          message: id,
        },
  }
}

function runtimeEvent(
  runtimeId: string,
  runtimeGeneration: number,
  event: Extract<LocalPiRpcEvent, { type: 'agent_start' | 'agent_settled' }>,
): PiHostEventEnvelope {
  return {
    kind: 'event',
    protocolVersion: PI_HOST_PROTOCOL_VERSION,
    hostEpoch: 1,
    runtimeId,
    runtimeGeneration,
    sequence: 1,
    event,
  }
}

describe('PiRuntimeFrontend', () => {
  it('activates Runtime identity before binding startup extension UI', async () => {
    const { frontend, pool } = createHarness()
    pool.startupUiId = 'startup-confirm'
    pool.waitForStartupUiResponse = true
    const observedStates: string[] = []
    frontend.subscribe((snapshot) => observedStates.push(snapshot.state))
    frontend.subscribeUiRequests(async (event) => {
      expect(frontend.getSnapshot()).toMatchObject({
        state: 'starting',
        generation: event.runtimeGeneration,
      })
      await frontend.respondToExtensionUi({
        type: 'extension_ui_response',
        id: event.request.id,
        confirmed: true,
      }, event.runtimeGeneration)
    })

    await expect(frontend.start({ scope: projectScope })).resolves.toMatchObject({
      state: 'ready',
      generation: 1,
    })

    expect(pool.uiResponses).toEqual([
      expect.objectContaining({
        runtimeId: 'rt_frontend_1',
        generation: 1,
        response: expect.objectContaining({
          id: 'startup-confirm',
          confirmed: true,
        }),
      }),
    ])
    expect(observedStates).toContain('starting')
    expect(observedStates[observedStates.length - 1]).toBe('ready')
    await frontend.dispose()
  })

  it('adopts the descriptor returned by a session-changing command before hydration', async () => {
    const { frontend, pool } = createHarness()
    await frontend.start({ scope: projectScope })

    await expect(frontend.request({ type: 'new_session' }, 90_000)).resolves.toMatchObject({
      command: 'new_session',
      success: true,
    })

    expect(frontend.getSnapshot()).toMatchObject({
      state: 'ready',
      generation: 2,
      sessionFile: '/sessions/new-2.jsonl',
      sessionState: { sessionId: 'session-2' },
    })
    expect(pool.commandCalls).toEqual(expect.arrayContaining([
      expect.objectContaining({
        command: { type: 'new_session' },
        expectedGeneration: 1,
        timeoutMs: 90_000,
      }),
      expect.objectContaining({
        command: { type: 'get_state' },
        expectedGeneration: 2,
      }),
    ]))
    await frontend.dispose()
  })

  it('matches the selected Runtime by exact conversation scope and session file', async () => {
    const { frontend } = createHarness()
    await frontend.start({
      scope: projectScope,
      sessionFile: '/sessions/selected.jsonl',
    })

    expect(frontend.isActiveSession(
      projectScope,
      '/sessions/selected.jsonl',
    )).toBe(true)
    expect(frontend.isActiveSession(
      projectScope,
      '/sessions/other.jsonl',
    )).toBe(false)
    expect(frontend.isActiveSession(
      { kind: 'projectless' },
      '/sessions/selected.jsonl',
    )).toBe(false)

    await frontend.dispose()
  })

  it('acquires and submits to a background Runtime without changing selection', async () => {
    const { frontend, pool } = createHarness()
    await frontend.start({
      scope: projectScope,
      sessionFile: '/sessions/selected.jsonl',
    })
    const selected = frontend.getActiveRuntimeIdentity()
    const selectedSnapshot = frontend.getSnapshot()

    const handle = await frontend.acquireControlRuntime({
      scope: projectScope,
      sessionFile: '/sessions/background.jsonl',
    })

    expect(frontend.getActiveRuntimeIdentity()).toEqual(selected)
    expect(frontend.getSnapshot()).toEqual(selectedSnapshot)
    expect(handle).toMatchObject({
      runtimeId: 'rt_frontend_2',
      generation: 1,
      sessionFile: '/sessions/background.jsonl',
      sessionId: 'session-2',
    })
    expect(frontend.listControlRuntimes()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        runtimeId: 'rt_frontend_1', selected: true, lifecycle: 'idle',
      }),
      expect.objectContaining({
        runtimeId: 'rt_frontend_2', selected: false, lifecycle: 'idle',
      }),
    ]))

    await expect(frontend.submitControlPrompt(
      handle,
      'Continue this exact conversation.',
      'auto',
      90_000,
    )).resolves.toMatchObject({ acceptedMode: 'prompt' })
    expect(pool.externalSubmitCalls).toEqual([{
      runtimeId: handle.runtimeId,
      message: 'Continue this exact conversation.',
      mode: 'auto',
      expectedGeneration: handle.generation,
      timeoutMs: 90_000,
    }])
    expect(frontend.getActiveRuntimeIdentity()).toEqual(selected)
    expect(frontend.getSnapshot()).toEqual(selectedSnapshot)
    await frontend.dispose()
  })

  it('pins cold and cached control acquisitions until each lease is released', async () => {
    const { frontend, pool } = createHarness({
      maxRetainedIdleRuntimesPerHost: 0,
      isPersistedSessionFile: () => true,
    })
    const coldLease = await frontend.acquireControlRuntime({
      scope: projectScope,
      sessionFile: '/sessions/pinned.jsonl',
    })
    const cachedLease = await frontend.acquireControlRuntime({
      scope: projectScope,
      sessionFile: '/sessions/pinned.jsonl',
    })

    expect(pool.createCount).toBe(1)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(pool.runtimeForSession('/sessions/pinned.jsonl')).not.toBeNull()

    expect(frontend.releaseControlRuntime(coldLease)).toBe(true)
    expect(frontend.releaseControlRuntime(coldLease)).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(pool.runtimeForSession('/sessions/pinned.jsonl')).not.toBeNull()

    expect(frontend.releaseControlRuntime(cachedLease)).toBe(true)
    await vi.waitFor(() => {
      expect(pool.runtimeForSession('/sessions/pinned.jsonl')).toBeNull()
    })
    await frontend.dispose()
  })

  it('does not let a stale lease release a replacement generation pin', async () => {
    const { frontend, pool } = createHarness({
      maxRetainedIdleRuntimesPerHost: 0,
      isPersistedSessionFile: () => true,
    })
    const staleLease = await frontend.acquireControlRuntime({
      scope: projectScope,
      sessionFile: '/sessions/original.jsonl',
    })
    pool.rebindRuntime(staleLease.runtimeId, '/sessions/rebound.jsonl')
    const replacementLease = await frontend.acquireControlRuntime({
      scope: projectScope,
      sessionFile: '/sessions/rebound.jsonl',
    })

    expect(frontend.releaseControlRuntime(staleLease)).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(pool.runtimeForSession('/sessions/rebound.jsonl')).not.toBeNull()

    expect(frontend.releaseControlRuntime(replacementLease)).toBe(true)
    await vi.waitFor(() => {
      expect(pool.runtimeForSession('/sessions/rebound.jsonl')).toBeNull()
    })
    await frontend.dispose()
  })

  it('keeps an acquired Runtime through the submit handoff and accepted turn', async () => {
    const { frontend, pool } = createHarness({
      maxRetainedIdleRuntimesPerHost: 0,
      isPersistedSessionFile: () => true,
    })
    const lease = await frontend.acquireControlRuntime({
      scope: projectScope,
      sessionFile: '/sessions/handoff.jsonl',
    })

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(pool.runtimeForSession('/sessions/handoff.jsonl')).not.toBeNull()
    await expect(frontend.submitControlPrompt(
      lease,
      'Keep the target alive.',
      'prompt',
    )).resolves.toMatchObject({ acceptedMode: 'prompt' })
    expect(frontend.releaseControlRuntime(lease)).toBe(true)

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(pool.runtimeForSession('/sessions/handoff.jsonl')).not.toBeNull()
    pool.emitEvent(runtimeEvent(
      lease.runtimeId,
      lease.generation,
      { type: 'agent_settled' },
    ))
    await vi.waitFor(() => {
      expect(pool.runtimeForSession('/sessions/handoff.jsonl')).toBeNull()
    })
    await frontend.dispose()
  })

  it('allows a failed submission finally block to release its acquisition', async () => {
    const { frontend, pool } = createHarness({
      maxRetainedIdleRuntimesPerHost: 0,
      isPersistedSessionFile: () => true,
    })
    const lease = await frontend.acquireControlRuntime({
      scope: projectScope,
      sessionFile: '/sessions/rejected.jsonl',
    })
    pool.externalSubmitError = new Error('Pi rejected the submission.')

    try {
      await expect(frontend.submitControlPrompt(
        lease,
        'Reject this prompt.',
        'prompt',
      )).rejects.toMatchObject({ code: 'PI_RUNTIME_OPERATION_FAILED' })
    } finally {
      expect(frontend.releaseControlRuntime(lease)).toBe(true)
    }

    await vi.waitFor(() => {
      expect(pool.runtimeForSession('/sessions/rejected.jsonl')).toBeNull()
    })
    await frontend.dispose()
  })

  it('reads control state only for the exact leased Runtime generation', async () => {
    const { frontend, pool } = createHarness()
    const lease = await frontend.acquireControlRuntime({
      scope: projectScope,
      sessionFile: '/sessions/control-state.jsonl',
    })
    pool.setRuntimeSessionState(lease.runtimeId, {
      isStreaming: true,
      pendingMessageCount: 2,
    })

    await expect(frontend.getControlRuntimeState(lease)).resolves.toMatchObject({
      sessionId: lease.sessionId,
      isStreaming: true,
      pendingMessageCount: 2,
    })
    pool.rebindRuntime(lease.runtimeId, '/sessions/replaced-state.jsonl')
    await expect(frontend.getControlRuntimeState(lease)).rejects.toMatchObject({
      code: 'PI_RUNTIME_STALE_GENERATION',
    })
    await frontend.dispose()
  })

  it('rejects a stale control handle after exact Runtime replacement', async () => {
    const { frontend, pool } = createHarness()
    const handle = await frontend.acquireControlRuntime({
      scope: projectScope,
      sessionFile: '/sessions/background.jsonl',
    })
    pool.rebindRuntime(handle.runtimeId, '/sessions/rebound.jsonl')

    await expect(frontend.submitControlPrompt(
      handle,
      'Must not reach the replacement.',
      'prompt',
    )).rejects.toMatchObject({ code: 'PI_RUNTIME_STALE_GENERATION' })
    expect(pool.externalSubmitCalls).toEqual([])
    await frontend.dispose()
  })

  it('observes background events before credit without projecting them as selected', async () => {
    const { frontend, pool } = createHarness()
    await frontend.start({
      scope: projectScope,
      sessionFile: '/sessions/selected.jsonl',
    })
    const background = await frontend.acquireControlRuntime({
      scope: projectScope,
      sessionFile: '/sessions/background.jsonl',
    })
    const allGate = deferred()
    const allEvents: string[] = []
    const selectedEvents: string[] = []
    frontend.subscribeAllEvents(async (event, handle) => {
      allEvents.push(`${handle.runtimeId}:${event.type}`)
      pool.eventOrder.push('all-listener')
      await allGate.promise
    })
    frontend.subscribeEvents((event) => {
      selectedEvents.push(event.type)
    })

    pool.emitEvent(runtimeEvent(
      background.runtimeId,
      background.generation,
      { type: 'agent_start' },
    ))

    expect(allEvents).toEqual([`${background.runtimeId}:agent_start`])
    expect(selectedEvents).toEqual([])
    expect(pool.eventOrder).toEqual(['all-listener'])
    allGate.resolve()
    await vi.waitFor(() => expect(pool.eventOrder).toEqual(['all-listener', 'ack']))
    await frontend.dispose()
  })

  it('lets Main cancel blocking UI while a background Runtime binds', async () => {
    const { frontend, pool } = createHarness()
    await frontend.start({
      scope: projectScope,
      sessionFile: '/sessions/selected.jsonl',
    })
    const selected = frontend.getActiveRuntimeIdentity()
    const selectedUi: string[] = []
    frontend.subscribeUiRequests((event) => {
      selectedUi.push(event.request.id)
    })
    pool.startupUiId = 'background-confirm'
    pool.waitForStartupUiResponse = true
    frontend.subscribeAllUiRequests(async (event, handle) => {
      if (event.request.id !== 'background-confirm') return
      await frontend.respondToControlExtensionUi(handle, {
        type: 'extension_ui_response',
        id: event.request.id,
        cancelled: true,
      })
    })

    await expect(frontend.acquireControlRuntime({
      scope: projectScope,
      sessionFile: '/sessions/background.jsonl',
    })).resolves.toMatchObject({ runtimeId: 'rt_frontend_2' })
    expect(selectedUi).toEqual([])
    expect(frontend.getActiveRuntimeIdentity()).toEqual(selected)
    expect(pool.uiResponses).toEqual([
      expect.objectContaining({
        runtimeId: 'rt_frontend_2',
        response: {
          type: 'extension_ui_response',
          id: 'background-confirm',
          cancelled: true,
        },
      }),
    ])
    await frontend.dispose()
  })

  it('does not forward active blocking UI after a Main consumer cancels it', async () => {
    const { frontend, pool } = createHarness()
    await frontend.start({
      scope: projectScope,
      sessionFile: '/sessions/selected.jsonl',
    })
    const runtime = pool.runtime!
    const selectedUi: string[] = []
    frontend.subscribeUiRequests((event) => {
      selectedUi.push(event.request.id)
    })
    frontend.subscribeAllUiRequests(async (event, handle) => {
      await frontend.respondToControlExtensionUi(handle, {
        type: 'extension_ui_response',
        id: event.request.id,
        cancelled: true,
      })
    })

    pool.emitUiRequest(uiRequest(
      runtime.runtimeId,
      runtime.generation,
      'active-confirm',
      'confirm',
    ))

    await vi.waitFor(() => {
      expect(pool.uiResponses).toEqual([
        expect.objectContaining({
          runtimeId: runtime.runtimeId,
          response: {
            type: 'extension_ui_response',
            id: 'active-confirm',
            cancelled: true,
          },
        }),
      ])
    })
    expect(selectedUi).toEqual([])
    await vi.waitFor(() => {
      expect(pool.eventOrder[pool.eventOrder.length - 1]).toBe('ack')
    })
    await frontend.dispose()
  })

  it('refreshes after an extension rebinds the Runtime inside a normal prompt', async () => {
    const { frontend, pool } = createHarness()
    await frontend.start({ scope: projectScope })
    pool.rebindOnPrompt = true

    await expect(frontend.request({
      type: 'prompt',
      message: 'Run an extension command.',
    })).resolves.toMatchObject({ command: 'prompt', success: true })

    expect(frontend.getSnapshot()).toMatchObject({
      state: 'ready',
      generation: 2,
      sessionFile: '/sessions/extension-rebind-2.jsonl',
      sessionState: { sessionId: 'extension-session-2' },
    })
    expect(pool.commandCalls).toEqual(expect.arrayContaining([
      expect.objectContaining({
        command: { type: 'get_state' },
        expectedGeneration: 2,
      }),
    ]))
    await frontend.dispose()
  })

  it('routes extension UI from the next generation while a command rebinds', async () => {
    const { frontend, pool } = createHarness()
    await frontend.start({ scope: projectScope })
    pool.rebindOnPrompt = true
    pool.rebindUiId = 'rebind-confirm'
    pool.waitForRebindUiResponse = true
    const observed: Array<{ id: string; generation: number; state: string }> = []
    frontend.subscribeUiRequests(async (event) => {
      observed.push({
        id: event.request.id,
        generation: event.runtimeGeneration,
        state: frontend.getSnapshot().state,
      })
      await frontend.respondToExtensionUi({
        type: 'extension_ui_response',
        id: event.request.id,
        confirmed: true,
      }, event.runtimeGeneration)
    })

    await expect(frontend.request({
      type: 'prompt',
      message: 'Rebind with extension UI.',
    })).resolves.toMatchObject({ command: 'prompt', success: true })

    expect(observed).toEqual([{
      id: 'rebind-confirm',
      generation: 2,
      state: 'replacing',
    }])
    expect(frontend.getSnapshot()).toMatchObject({
      state: 'ready',
      generation: 2,
      sessionFile: '/sessions/extension-rebind-2.jsonl',
    })
    await frontend.dispose()
  })

  it('restarts inside one lifecycle operation instead of enqueueing itself', async () => {
    const { frontend, pool } = createHarness()
    await frontend.start({ scope: projectScope })

    await expect(frontend.restart()).resolves.toMatchObject({ state: 'ready' })

    expect(pool.createCount).toBe(2)
    expect(pool.restartCalls).toEqual([{ kind: 'project', cwd: projectCwd }])
    expect(pool.disposeCalls).toHaveLength(0)
    await frontend.dispose()
  }, 1_000)

  it('reloads active Runtime resources and publishes the hydrated generation', async () => {
    const { frontend } = createHarness()
    const states: Array<{ state: string; generation: number }> = []
    frontend.subscribe((snapshot) => states.push({
      state: snapshot.state,
      generation: snapshot.generation,
    }))
    await frontend.start({ scope: projectScope })
    const generation = frontend.getSnapshot().generation

    await frontend.reloadRuntimes(projectCwd)

    expect(frontend.getSnapshot()).toMatchObject({
      state: 'ready',
      generation: generation + 1,
    })
    expect(states).toEqual(expect.arrayContaining([
      { state: 'replacing', generation: generation + 1 },
      { state: 'ready', generation: generation + 1 },
    ]))
    await expect(frontend.request({ type: 'get_state' })).resolves.toMatchObject({
      command: 'get_state',
      success: true,
    })
    await frontend.dispose()
  })

  it('keeps opened Session Runtimes and reselects them without recreation', async () => {
    const { frontend, pool } = createHarness()
    await frontend.start({
      scope: projectScope,
      sessionFile: '/sessions/one.jsonl',
    })
    const firstRuntimeId = pool.runtime!.runtimeId
    await frontend.replace({
      scope: projectScope,
      sessionFile: '/sessions/two.jsonl',
    })

    expect(pool.createCount).toBe(2)
    expect(pool.runtimeCount).toBe(2)
    expect(pool.disposeCalls).toHaveLength(0)

    await frontend.replace({
      scope: projectScope,
      sessionFile: '/sessions/one.jsonl',
    })

    expect(pool.createCount).toBe(2)
    expect(pool.runtimeCount).toBe(2)
    expect(frontend.getSnapshot()).toMatchObject({
      state: 'ready',
      sessionFile: '/sessions/one.jsonl',
    })
    expect(pool.commandCalls.slice(-2).every(
      (call) => call.runtimeId === firstRuntimeId,
    )).toBe(true)
    await frontend.dispose()
  })

  it('switches immediately while a command continues on the background Runtime', async () => {
    const { frontend, pool } = createHarness()
    await frontend.start({
      scope: projectScope,
      sessionFile: '/sessions/running.jsonl',
    })
    const runningRuntimeId = pool.runtime!.runtimeId
    const promptGate = deferred()
    pool.promptDelay = promptGate.promise

    const prompt = frontend.request({
      type: 'prompt',
      message: 'Continue in the background.',
    })
    await vi.waitFor(() => {
      expect(pool.commandCalls).toContainEqual(expect.objectContaining({
        runtimeId: runningRuntimeId,
        command: { type: 'prompt', message: 'Continue in the background.' },
      }))
    })

    await expect(frontend.replace({
      scope: projectScope,
      sessionFile: '/sessions/selected.jsonl',
    })).resolves.toMatchObject({
      state: 'ready',
      sessionFile: '/sessions/selected.jsonl',
    })
    expect(pool.runtimeForSession('/sessions/running.jsonl')?.runtimeId)
      .toBe(runningRuntimeId)

    promptGate.resolve()
    await expect(prompt).resolves.toMatchObject({
      command: 'prompt',
      success: true,
    })
    expect(frontend.getSnapshot().sessionFile).toBe('/sessions/selected.jsonl')
    await frontend.dispose()
  })

  it('rolls back only the exact selected Runtime transaction', async () => {
    const { frontend } = createHarness()
    await frontend.start({
      scope: projectScope,
      sessionFile: '/sessions/one.jsonl',
    })
    await frontend.replace({
      scope: projectScope,
      sessionFile: '/sessions/two.jsonl',
    })
    const second = frontend.getActiveRuntimeIdentity()
    if (!second) throw new Error('Expected the second Runtime identity.')

    await expect(frontend.rollbackSelection(second)).resolves.toBe(true)
    expect(frontend.getSnapshot().sessionFile).toBe('/sessions/one.jsonl')
    await expect(frontend.rollbackSelection(second)).resolves.toBe(false)
    expect(frontend.getSnapshot().sessionFile).toBe('/sessions/one.jsonl')
    await frontend.dispose()
  })

  it('reconciles a background Runtime generation before reselecting it', async () => {
    const { frontend, pool } = createHarness()
    await frontend.start({
      scope: projectScope,
      sessionFile: '/sessions/one.jsonl',
    })
    const firstRuntimeId = pool.runtime!.runtimeId
    await frontend.replace({
      scope: projectScope,
      sessionFile: '/sessions/two.jsonl',
    })
    pool.rebindRuntime(firstRuntimeId, '/sessions/rebound.jsonl')

    await frontend.replace({
      scope: projectScope,
      sessionFile: '/sessions/rebound.jsonl',
    })

    expect(pool.createCount).toBe(2)
    expect(frontend.getSnapshot()).toMatchObject({
      state: 'ready',
      generation: 2,
      sessionFile: '/sessions/rebound.jsonl',
      sessionState: { sessionId: 'background-2' },
    })
    await frontend.dispose()
  })

  it('retains idle and running background Runtimes while the idle cache has room', async () => {
    const { frontend, pool } = createHarness()
    await frontend.start({
      scope: projectScope,
      sessionFile: '/sessions/running.jsonl',
    })
    const runningRuntime = pool.runtime!
    await frontend.replace({
      scope: projectScope,
      sessionFile: '/sessions/idle.jsonl',
    })
    pool.emitEvent(runtimeEvent(
      runningRuntime.runtimeId,
      runningRuntime.generation,
      { type: 'agent_start' },
    ))

    await frontend.replace({
      scope: projectScope,
      sessionFile: '/sessions/new.jsonl',
    })

    expect(pool.runtimeCount).toBe(3)
    expect(pool.runtimeForSession('/sessions/running.jsonl')).not.toBeNull()
    expect(pool.runtimeForSession('/sessions/idle.jsonl')).not.toBeNull()
    expect(pool.runtimeForSession('/sessions/new.jsonl')).not.toBeNull()
    expect(pool.disposeCalls).toEqual([])

    await frontend.stop()
    expect(pool.runtimeCount).toBe(2)
    expect(pool.runtimeForSession('/sessions/running.jsonl')).not.toBeNull()
    expect(pool.runtimeForSession('/sessions/idle.jsonl')).not.toBeNull()
    await frontend.dispose()
  })

  it('reclaims only the least-recently-used persisted idle Runtime above the idle cache', async () => {
    let clock = 0
    const { frontend, pool } = createHarness({
      maxRetainedIdleRuntimesPerHost: 1,
      now: () => ++clock,
      isPersistedSessionFile: () => true,
    })
    await frontend.start({
      scope: projectScope,
      sessionFile: '/sessions/one.jsonl',
    })
    const firstRuntimeId = pool.runtime!.runtimeId
    await frontend.replace({
      scope: projectScope,
      sessionFile: '/sessions/two.jsonl',
    })
    const secondRuntimeId = pool.runtime!.runtimeId
    await frontend.replace({
      scope: projectScope,
      sessionFile: '/sessions/three.jsonl',
    })

    await vi.waitFor(() => {
      expect(pool.disposeCalls).toEqual([{
        runtimeId: firstRuntimeId,
        generation: 1,
      }])
    })
    expect(pool.runtimeForSession('/sessions/one.jsonl')).toBeNull()
    expect(pool.runtimeForSession('/sessions/two.jsonl')?.runtimeId).toBe(secondRuntimeId)
    expect(pool.runtimeForSession('/sessions/three.jsonl')).not.toBeNull()
    await frontend.dispose()
  })

  it('never reclaims a running Runtime and reconsiders it only after settlement', async () => {
    const { frontend, pool } = createHarness({
      maxRetainedIdleRuntimesPerHost: 0,
      isPersistedSessionFile: () => true,
    })
    await frontend.start({
      scope: projectScope,
      sessionFile: '/sessions/running.jsonl',
    })
    const running = pool.runtime!
    pool.emitEvent(runtimeEvent(
      running.runtimeId,
      running.generation,
      { type: 'agent_start' },
    ))
    await frontend.replace({
      scope: projectScope,
      sessionFile: '/sessions/selected.jsonl',
    })

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(pool.runtimeForSession('/sessions/running.jsonl')).not.toBeNull()
    expect(pool.disposeCalls).toEqual([])

    pool.emitEvent(runtimeEvent(
      running.runtimeId,
      running.generation,
      { type: 'agent_settled' },
    ))
    await vi.waitFor(() => {
      expect(pool.runtimeForSession('/sessions/running.jsonl')).toBeNull()
    })
    expect(pool.runtimeForSession('/sessions/selected.jsonl')).not.toBeNull()
    await frontend.dispose()
  })

  it('retains an idle Runtime until its Session file is durably persisted', async () => {
    const { frontend, pool } = createHarness({
      maxRetainedIdleRuntimesPerHost: 0,
      isPersistedSessionFile: (sessionFile) => sessionFile !== '/sessions/draft.jsonl',
    })
    await frontend.start({
      scope: projectScope,
      sessionFile: '/sessions/draft.jsonl',
    })
    await frontend.replace({
      scope: projectScope,
      sessionFile: '/sessions/persisted.jsonl',
    })

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(pool.runtimeForSession('/sessions/draft.jsonl')).not.toBeNull()
    expect(pool.disposeCalls).toEqual([])
    await frontend.dispose()
  })

  it('keeps an event-stale candidate when authoritative get_state reports work', async () => {
    const { frontend, pool } = createHarness({
      maxRetainedIdleRuntimesPerHost: 0,
      isPersistedSessionFile: () => true,
    })
    await frontend.start({
      scope: projectScope,
      sessionFile: '/sessions/authoritative-running.jsonl',
    })
    const running = pool.runtime!
    pool.setRuntimeSessionState(running.runtimeId, { isStreaming: true })
    await frontend.replace({
      scope: projectScope,
      sessionFile: '/sessions/selected.jsonl',
    })

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(pool.runtimeForSession('/sessions/authoritative-running.jsonl')).not.toBeNull()
    expect(pool.disposeCalls).toEqual([])
    await frontend.dispose()
  })

  it('forwards extension UI only for the active Runtime generation', async () => {
    const { frontend, pool } = createHarness()
    await frontend.start({ scope: projectScope })
    const runtime = pool.runtime!
    const received: string[] = []
    const listenerGate = deferred()
    frontend.subscribeUiRequests(async (event) => {
      received.push(event.request.id)
      pool.eventOrder.push(`ui:${event.request.id}`)
      await listenerGate.promise
    })

    pool.emitUiRequest(uiRequest('rt_background', runtime.generation, 'background'))
    pool.emitUiRequest(uiRequest(runtime.runtimeId, runtime.generation + 1, 'stale'))
    pool.emitUiRequest(uiRequest(runtime.runtimeId, runtime.generation, 'active'))

    expect(received).toEqual(['active'])
    expect(pool.eventOrder).toEqual(['ack', 'ack', 'ui:active'])
    listenerGate.resolve()
    await vi.waitFor(() => {
      expect(pool.eventOrder).toEqual(['ack', 'ack', 'ui:active', 'ack'])
    })
    await frontend.dispose()
  })

  it('matches Host snapshots by scope kind and canonical cwd', async () => {
    const { frontend, pool } = createHarness()
    await frontend.start({ scope: projectScope })
    const runtime = pool.runtime!
    const activeHostScope = { kind: 'project', cwd: projectCwd } as const
    const otherHostScope = { kind: 'project', cwd: '/projects/other' } as const

    pool.emitSnapshot({
      state: 'ready',
      hosts: [
        pool.hostSnapshot(otherHostScope, 'crashed', null),
        pool.hostSnapshot(activeHostScope, 'ready', runtime),
      ],
    })
    expect(frontend.getSnapshot().state).toBe('ready')

    pool.emitSnapshot({
      state: 'ready',
      hosts: [pool.hostSnapshot(activeHostScope, 'crashed', runtime)],
    })
    expect(frontend.getSnapshot().state).toBe('crashed')
    await frontend.dispose()
  })

  it('acknowledges active events only after synchronous Main consumers return', async () => {
    const { frontend, pool } = createHarness()
    await frontend.start({ scope: projectScope })
    const runtime = pool.runtime!
    const listenerGate = deferred()
    frontend.subscribeEvents(async () => {
      pool.eventOrder.push('listener')
      await listenerGate.promise
    })

    pool.emitEvent(runtimeEvent(runtime.runtimeId, runtime.generation, { type: 'agent_start' }))

    expect(pool.eventOrder).toEqual(['listener'])
    listenerGate.resolve()
    await vi.waitFor(() => {
      expect(pool.eventOrder).toEqual(['listener', 'ack'])
    })
    expect(pool.acknowledgedEvents).toHaveLength(1)
    await frontend.dispose()
  })

  it('returns a terminal selection error while restoring the previous healthy Runtime', async () => {
    const { frontend, pool } = createHarness()
    const snapshots: string[] = []
    frontend.subscribe((snapshot) => snapshots.push(snapshot.state))
    await frontend.start({ scope: projectScope })
    pool.failHydrationsRemaining = 2

    await expect(frontend.replace({
      scope: projectScope,
      sessionFile: '/sessions/replacement.jsonl',
    })).rejects.toMatchObject({ code: 'PI_RUNTIME_CONFIRMATION_FAILED' })

    expect(frontend.getSnapshot()).toMatchObject({
      state: 'ready',
      sessionFile: '/sessions/rt_frontend_1.jsonl',
      sessionState: { sessionId: 'session-1' },
    })
    expect(snapshots).toEqual(expect.arrayContaining(['replacing', 'starting', 'ready']))
    expect(snapshots[snapshots.length - 1]).toBe('ready')
    expect(pool.disposeCalls).toHaveLength(2)
    await frontend.dispose()
    expect(pool.disposeCalls).toHaveLength(3)
  })

  it('retries a transient session hydration failure without requiring a second click', async () => {
    const { frontend, pool } = createHarness()
    await frontend.start({ scope: projectScope, sessionFile: '/sessions/one.jsonl' })
    pool.failNextHydration = true

    await expect(frontend.replace({
      scope: projectScope,
      sessionFile: '/sessions/two.jsonl',
    })).resolves.toMatchObject({
      state: 'ready',
      sessionFile: '/sessions/two.jsonl',
    })

    expect(pool.createCount).toBe(3)
    expect(pool.disposeCalls).toEqual([{
      runtimeId: 'rt_frontend_2',
      generation: 1,
    }])
    await frontend.dispose()
  })

  it('maps Host recovery failure to one non-recoverable activation error', async () => {
    const { frontend, pool } = createHarness()
    pool.createError = new ProjectHostPoolError(
      'HOST_RECOVERY_FAILED',
      'Project Host recovery failed.',
    )

    await expect(frontend.start({
      scope: projectScope,
      sessionFile: '/sessions/recovery.jsonl',
    })).rejects.toMatchObject({
      code: 'PI_RUNTIME_HOST_RECOVERY_FAILED',
      recoverable: false,
    })
    expect(pool.createCount).toBe(1)
    expect(frontend.getSnapshot()).toMatchObject({
      state: 'error',
      diagnostics: [{ code: 'PI_RUNTIME_HOST_RECOVERY_FAILED' }],
    })
    await frontend.dispose()
  })
})
