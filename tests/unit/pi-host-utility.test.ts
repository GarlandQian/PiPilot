import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import {
  PI_HOST_PROTOCOL_VERSION,
  piHostBootstrapEnvelopeSchema,
  piHostCreditEnvelopeSchema,
  piHostFailureEnvelopeSchema,
  piHostRequestEnvelopeSchema,
  piHostResponseEnvelopeSchema,
} from '../../src/shared/pi-host-protocol'
import {
  localPiRpcResponseSchema,
  type LocalPiExtensionUiResponse,
} from '../../src/shared/local-pi'
import { projectPiHostDto } from '../../src/main/pi-host/pi-host-dto'
import {
  PiHostUtility,
  type RuntimeManagerLike,
  type UtilityMessageEvent,
  type UtilityMessagePort,
  type UtilityParentPort,
} from '../../src/main/pi-host/pi-host-utility'
import type {
  RuntimeCommandResult,
  RuntimeDescriptor,
  RuntimeEventRecord,
  RuntimeTarget,
  RuntimeUiRequestRecord,
} from '../../src/main/pi-host/runtime-manager'
import { RuntimeManagerError } from '../../src/main/pi-host/runtime-manager'

class FakeMessagePort implements UtilityMessagePort {
  readonly sent: unknown[] = []
  readonly emitter = new EventEmitter()
  started = false
  closed = false

  on(event: 'message', listener: (event: UtilityMessageEvent) => void): this
  on(event: 'close', listener: () => void): this
  on(event: 'message' | 'close', listener: (...args: any[]) => void): this {
    this.emitter.on(event, listener)
    return this
  }

  off(event: 'message', listener: (event: UtilityMessageEvent) => void): this
  off(event: 'close', listener: () => void): this
  off(event: 'message' | 'close', listener: (...args: any[]) => void): this {
    this.emitter.off(event, listener)
    return this
  }

  postMessage(message: unknown): void {
    this.sent.push(structuredClone(message))
  }

  start(): void {
    this.started = true
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.emitter.emit('close')
  }

  receive(data: unknown): void {
    this.emitter.emit('message', { data })
  }
}

class FakeParentPort implements UtilityParentPort {
  readonly emitter = new EventEmitter()

  on(event: 'message', listener: (event: UtilityMessageEvent) => void): this {
    this.emitter.on(event, listener)
    return this
  }

  off(event: 'message', listener: (event: UtilityMessageEvent) => void): this {
    this.emitter.off(event, listener)
    return this
  }

  bootstrap(data: unknown, port: UtilityMessagePort): void {
    this.emitter.emit('message', { data, ports: [port] })
  }
}

class FakeRuntimeManager implements RuntimeManagerLike {
  private readonly runtimes = new Map<string, RuntimeDescriptor>()
  private readonly eventListeners = new Set<(record: RuntimeEventRecord) => void>()
  private readonly uiListeners = new Set<(record: RuntimeUiRequestRecord) => void>()
  private readonly fatalListeners = new Set<(error: unknown) => void>()
  readonly uiResponses: LocalPiExtensionUiResponse[] = []
  readonly externalSubmissions: Array<{
    runtimeId: string
    message: string
    mode: 'auto' | 'prompt' | 'follow_up' | 'steer'
    expectedGeneration?: number
  }> = []
  disposeCount = 0

  renameSession(sessionFile: string, name: string) {
    return {
      renamed: true as const,
      sessionFile,
      sessionId: 'session-renamed',
      name,
    }
  }

  subscribeEvents(listener: (record: RuntimeEventRecord) => void): () => boolean {
    this.eventListeners.add(listener)
    return () => this.eventListeners.delete(listener)
  }

  emitEvent(record: RuntimeEventRecord): void {
    for (const listener of this.eventListeners) listener(record)
  }

  subscribeUiRequests(listener: (record: RuntimeUiRequestRecord) => void): () => boolean {
    this.uiListeners.add(listener)
    return () => this.uiListeners.delete(listener)
  }

  emitUiRequest(record: RuntimeUiRequestRecord): void {
    for (const listener of this.uiListeners) listener(record)
  }

  subscribeFatalErrors(listener: (error: unknown) => void): () => boolean {
    this.fatalListeners.add(listener)
    return () => this.fatalListeners.delete(listener)
  }

  emitFatalError(error: unknown): void {
    for (const listener of this.fatalListeners) listener(error)
  }

  async create(target: RuntimeTarget): Promise<RuntimeDescriptor> {
    const runtime = {
      runtimeId: target.runtimeId,
      generation: 1,
      cwd: '/tmp/pipilot-project',
      sessionFile: target.sessionFile ?? `${target.sessionDir}/session.jsonl`,
      sessionId: 'session-1',
    }
    this.runtimes.set(target.runtimeId, runtime)
    return runtime
  }

  get(runtimeId: string): RuntimeDescriptor | null {
    return this.runtimes.get(runtimeId) ?? null
  }

  async bindRuntime(
    runtimeId: string,
    expectedGeneration?: number,
  ): Promise<RuntimeDescriptor> {
    const runtime = this.runtimes.get(runtimeId)
    if (!runtime) throw new Error('Runtime not found.')
    if (
      expectedGeneration !== undefined &&
      runtime.generation !== expectedGeneration
    ) {
      const error = new Error('The Runtime generation is stale.')
      Object.assign(error, { code: 'RUNTIME_STALE_GENERATION' })
      throw error
    }
    return runtime
  }

  async reloadRuntime(
    runtimeId: string,
    expectedGeneration?: number,
  ): Promise<RuntimeDescriptor> {
    const current = this.runtimes.get(runtimeId)
    if (!current) throw new Error('Runtime not found.')
    if (
      expectedGeneration !== undefined &&
      current.generation !== expectedGeneration
    ) {
      const error = new Error('The Runtime generation is stale.')
      Object.assign(error, { code: 'RUNTIME_STALE_GENERATION' })
      throw error
    }
    const runtime = { ...current, generation: current.generation + 1 }
    this.runtimes.set(runtimeId, runtime)
    return runtime
  }

  async command(
    runtimeId: string,
    command: Parameters<RuntimeManagerLike['command']>[1],
    expectedGeneration?: number,
  ): Promise<RuntimeCommandResult> {
    const current = this.runtimes.get(runtimeId)!
    if (current.generation !== expectedGeneration) {
      const error = new Error('The Runtime generation is stale.')
      Object.assign(error, { code: 'RUNTIME_STALE_GENERATION' })
      throw error
    }
    const runtime = command.type === 'new_session'
      ? { ...current, generation: current.generation + 1, sessionId: 'session-2' }
      : current
    this.runtimes.set(runtimeId, runtime)
    return {
      runtime,
      response: command.type === 'new_session'
        ? localPiRpcResponseSchema.parse({
            type: 'response',
            command: 'new_session',
            success: true,
            data: { cancelled: false },
          })
        : localPiRpcResponseSchema.parse({
            type: 'response',
            command: command.type,
            success: false,
            error: 'Not implemented in the fake.',
          }),
    }
  }

  async externalSubmit(
    runtimeId: string,
    command: Parameters<RuntimeManagerLike['externalSubmit']>[1],
    expectedGeneration?: number,
  ): ReturnType<RuntimeManagerLike['externalSubmit']> {
    const runtime = this.runtimes.get(runtimeId)
    if (!runtime) throw new Error('Runtime not found.')
    if (runtime.generation !== expectedGeneration) {
      const error = new Error('The Runtime generation is stale.')
      Object.assign(error, { code: 'RUNTIME_STALE_GENERATION' })
      throw error
    }
    this.externalSubmissions.push({
      runtimeId,
      message: command.message,
      mode: command.mode,
      expectedGeneration,
    })
    return {
      runtime,
      acceptedMode: command.mode === 'auto' ? 'prompt' : command.mode,
    }
  }

  async disposeRuntime(
    runtimeId: string,
    expectedGeneration?: number,
  ): Promise<RuntimeDescriptor | null> {
    const runtime = this.runtimes.get(runtimeId) ?? null
    if (runtime && runtime.generation !== expectedGeneration) {
      const error = new Error('The Runtime generation is stale.')
      Object.assign(error, { code: 'RUNTIME_STALE_GENERATION' })
      throw error
    }
    this.runtimes.delete(runtimeId)
    return runtime
  }

  async dispose(): Promise<void> {
    this.disposeCount += 1
    this.runtimes.clear()
  }

  respondToExtensionUi(
    response: LocalPiExtensionUiResponse,
    _runtimeId?: string,
    _runtimeGeneration?: number,
  ): void {
    this.uiResponses.push(structuredClone(response))
  }
}

function requestMetadata(requestId: string) {
  return {
    protocolVersion: PI_HOST_PROTOCOL_VERSION,
    hostEpoch: 4,
    requestId,
  }
}

function runtimeRequestMetadata(requestId: string) {
  return { ...requestMetadata(requestId), timeoutMs: 500 }
}

describe('Pi Host utility entry', () => {
  it('handshakes, accepts credit, routes Runtime operations, and shuts down', async () => {
    const parent = new FakeParentPort()
    const port = new FakeMessagePort()
    const manager = new FakeRuntimeManager()
    const exits: number[] = []
    const utility = new PiHostUtility({
      parentPort: parent,
      cwd: '/tmp/pipilot-project',
      agentDir: '/tmp/pipilot-agent',
      sdkVersion: '0.84.2',
      nodeVersion: '24.14.0',
      electronVersion: '43.4.1',
      createRuntimeManager: () => manager,
      exit: (code) => exits.push(code),
    })
    utility.start()

    parent.bootstrap(piHostBootstrapEnvelopeSchema.parse({
      kind: 'bootstrap',
      ...requestMetadata('bootstrap-1'),
      expectedSdkVersion: '0.84.2',
    }), port)

    expect(port.started).toBe(true)
    expect(port.sent[0]).toMatchObject({
      kind: 'handshake',
      ok: true,
      sdkVersion: '0.84.2',
    })

    port.receive(piHostRequestEnvelopeSchema.parse({
      kind: 'request',
      ...runtimeRequestMetadata('create-1'),
      command: {
        type: 'runtime.create',
        runtimeId: 'rt_primary',
        sessionDir: '/tmp/pipilot-sessions',
      },
    }))
    await vi.waitFor(() => expect(port.sent).toHaveLength(2))
    expect(port.sent[1]).toMatchObject({
      kind: 'response',
      requestId: 'create-1',
      runtimeId: 'rt_primary',
      runtimeGeneration: 1,
      ok: true,
    })

    port.receive(piHostRequestEnvelopeSchema.parse({
      kind: 'request',
      ...runtimeRequestMetadata('bind-1'),
      runtimeId: 'rt_primary',
      runtimeGeneration: 1,
      command: { type: 'runtime.bind' },
    }))
    await vi.waitFor(() => expect(port.sent).toHaveLength(3))
    expect(port.sent[2]).toMatchObject({
      kind: 'response',
      requestId: 'bind-1',
      runtimeId: 'rt_primary',
      runtimeGeneration: 1,
      ok: true,
      result: { bound: true },
    })

    port.receive(piHostRequestEnvelopeSchema.parse({
      kind: 'request',
      ...runtimeRequestMetadata('external-submit-1'),
      runtimeId: 'rt_primary',
      runtimeGeneration: 1,
      command: {
        type: 'runtime.external_submit',
        message: 'Continue this exact conversation.',
        mode: 'auto',
      },
    }))
    await vi.waitFor(() => expect(port.sent).toHaveLength(4))
    expect(port.sent[3]).toMatchObject({
      kind: 'response',
      requestId: 'external-submit-1',
      runtimeId: 'rt_primary',
      runtimeGeneration: 1,
      ok: true,
      result: { acceptedMode: 'prompt' },
    })

    port.receive(piHostRequestEnvelopeSchema.parse({
      kind: 'request',
      ...runtimeRequestMetadata('rename-1'),
      command: {
        type: 'session.rename',
        sessionFile: '/tmp/pipilot-sessions/session.jsonl',
        name: 'Renamed session',
      },
    }))
    await vi.waitFor(() => expect(port.sent).toHaveLength(5))
    expect(port.sent[4]).toMatchObject({
      kind: 'response',
      requestId: 'rename-1',
      ok: true,
      result: {
        renamed: true,
        sessionId: 'session-renamed',
        name: 'Renamed session',
      },
    })

    port.receive(piHostCreditEnvelopeSchema.parse({
      kind: 'credit',
      protocolVersion: PI_HOST_PROTOCOL_VERSION,
      hostEpoch: 4,
      runtimeId: 'rt_primary',
      runtimeGeneration: 1,
      throughSequence: 12,
    }))
    expect(port.closed).toBe(false)

    port.receive(piHostRequestEnvelopeSchema.parse({
      kind: 'request',
      ...runtimeRequestMetadata('new-1'),
      runtimeId: 'rt_primary',
      runtimeGeneration: 1,
      command: { type: 'runtime.command', rpc: { type: 'new_session' } },
    }))
    await vi.waitFor(() => expect(port.sent).toHaveLength(6))
    expect(port.sent[5]).toMatchObject({
      kind: 'response',
      requestId: 'new-1',
      runtimeId: 'rt_primary',
      runtimeGeneration: 2,
      ok: true,
      result: {
        runtime: { sessionId: 'session-2', generation: 2 },
        rpc: { command: 'new_session', success: true },
      },
    })

    port.receive(piHostRequestEnvelopeSchema.parse({
      kind: 'request',
      ...runtimeRequestMetadata('stale-1'),
      runtimeId: 'rt_primary',
      runtimeGeneration: 1,
      command: { type: 'runtime.command', rpc: { type: 'get_state' } },
    }))
    await vi.waitFor(() => expect(port.sent).toHaveLength(7))
    expect(port.sent[6]).toMatchObject({
      kind: 'response',
      requestId: 'stale-1',
      ok: false,
      error: { code: 'RUNTIME_STALE_GENERATION' },
    })

    port.receive(piHostRequestEnvelopeSchema.parse({
      kind: 'request',
      ...runtimeRequestMetadata('dispose-1'),
      runtimeId: 'rt_primary',
      runtimeGeneration: 2,
      command: { type: 'runtime.dispose' },
    }))
    await vi.waitFor(() => expect(port.sent).toHaveLength(8))
    expect(port.sent[7]).toMatchObject({
      kind: 'response',
      requestId: 'dispose-1',
      runtimeId: 'rt_primary',
      runtimeGeneration: 2,
      ok: true,
      result: { disposed: true },
    })

    port.receive(piHostRequestEnvelopeSchema.parse({
      kind: 'request',
      ...runtimeRequestMetadata('shutdown-1'),
      command: { type: 'shutdown' },
    }))
    await vi.waitFor(() => {
      expect(port.sent).toHaveLength(9)
      expect(port.closed).toBe(true)
      expect(exits).toEqual([0])
    })
    expect(manager.disposeCount).toBe(1)
    expect(piHostResponseEnvelopeSchema.parse(port.sent[8])).toMatchObject({
      requestId: 'shutdown-1',
      ok: true,
      result: { shutdown: true },
    })
  })

  it('projects extension UI requests and delivers responses to the owning Runtime', async () => {
    const parent = new FakeParentPort()
    const port = new FakeMessagePort()
    const manager = new FakeRuntimeManager()
    const exits: number[] = []
    const utility = new PiHostUtility({
      parentPort: parent,
      cwd: '/tmp/pipilot-project',
      agentDir: '/tmp/pipilot-agent',
      sdkVersion: '0.84.2',
      createRuntimeManager: () => manager,
      exit: (code) => exits.push(code),
    })
    utility.start()
    parent.bootstrap(piHostBootstrapEnvelopeSchema.parse({
      kind: 'bootstrap',
      ...requestMetadata('bootstrap-ui'),
      expectedSdkVersion: '0.84.2',
    }), port)
    port.receive(piHostRequestEnvelopeSchema.parse({
      kind: 'request',
      ...runtimeRequestMetadata('create-ui'),
      command: {
        type: 'runtime.create',
        runtimeId: 'rt_ui',
        sessionDir: '/tmp/pipilot-sessions',
      },
    }))
    await vi.waitFor(() => expect(port.sent).toHaveLength(2))

    manager.emitUiRequest({
      runtimeId: 'rt_ui',
      generation: 1,
      sequence: 1,
      request: {
        type: 'extension_ui_request',
        id: 'dialog-1',
        method: 'confirm',
        title: 'Allow bash?',
        message: 'Run rm -rf out?',
      },
    })
    await vi.waitFor(() => expect(port.sent).toHaveLength(3))
    expect(port.sent[2]).toMatchObject({
      kind: 'ui_request',
      runtimeId: 'rt_ui',
      runtimeGeneration: 1,
      sequence: 1,
      request: { id: 'dialog-1', method: 'confirm' },
    })

    port.receive(piHostRequestEnvelopeSchema.parse({
      kind: 'request',
      ...runtimeRequestMetadata('ui-resp-1'),
      runtimeId: 'rt_ui',
      runtimeGeneration: 1,
      command: {
        type: 'runtime.extension_ui_response',
        response: {
          type: 'extension_ui_response',
          id: 'dialog-1',
          confirmed: true,
        },
      },
    }))
    await vi.waitFor(() => expect(manager.uiResponses).toHaveLength(1))
    expect(manager.uiResponses[0]).toMatchObject({
      id: 'dialog-1',
      confirmed: true,
    })
    expect(port.sent[3]).toMatchObject({
      kind: 'response',
      requestId: 'ui-resp-1',
      ok: true,
      result: { delivered: true },
    })
    expect(exits).toEqual([])
  })

  it('projects Runtime events with a bounded credit window', async () => {
    const parent = new FakeParentPort()
    const port = new FakeMessagePort()
    const manager = new FakeRuntimeManager()
    const exits: number[] = []
    const utility = new PiHostUtility({
      parentPort: parent,
      cwd: '/tmp/pipilot-project',
      agentDir: '/tmp/pipilot-agent',
      sdkVersion: '0.84.2',
      createRuntimeManager: () => manager,
      exit: (code) => exits.push(code),
    })
    utility.start()
    parent.bootstrap(piHostBootstrapEnvelopeSchema.parse({
      kind: 'bootstrap',
      ...requestMetadata('bootstrap-events'),
      expectedSdkVersion: '0.84.2',
    }), port)
    port.receive(piHostRequestEnvelopeSchema.parse({
      kind: 'request',
      ...runtimeRequestMetadata('create-events'),
      command: {
        type: 'runtime.create',
        runtimeId: 'rt_events',
        sessionDir: '/tmp/pipilot-sessions',
      },
    }))
    await vi.waitFor(() => expect(port.sent).toHaveLength(2))

    for (let sequence = 1; sequence <= 65; sequence += 1) {
      manager.emitEvent({
        runtimeId: 'rt_events',
        generation: 1,
        sequence,
        event: { type: 'agent_start' },
      })
    }
    await vi.waitFor(() => expect(port.sent).toHaveLength(66))
    // port.sent[0] is the bootstrap response and port.sent[1] is the
    // runtime.create response, so the first projected event starts at index 2.
    expect(port.sent[2]).toMatchObject({ kind: 'event', sequence: 1 })
    expect(port.sent[65]).toMatchObject({ kind: 'event', sequence: 64 })

    port.receive(piHostCreditEnvelopeSchema.parse({
      kind: 'credit',
      protocolVersion: PI_HOST_PROTOCOL_VERSION,
      hostEpoch: 4,
      runtimeId: 'rt_events',
      runtimeGeneration: 1,
      throughSequence: 64,
    }))
    await vi.waitFor(() => expect(port.sent).toHaveLength(67))
    expect(port.sent[66]).toMatchObject({ kind: 'event', sequence: 65 })
    expect(exits).toEqual([])
  })

  it('applies the same bounded credit window to extension UI traffic', async () => {
    const parent = new FakeParentPort()
    const port = new FakeMessagePort()
    const manager = new FakeRuntimeManager()
    const utility = new PiHostUtility({
      parentPort: parent,
      cwd: '/tmp/pipilot-project',
      agentDir: '/tmp/pipilot-agent',
      sdkVersion: '0.84.2',
      createRuntimeManager: () => manager,
      exit: () => undefined,
    })
    utility.start()
    parent.bootstrap(piHostBootstrapEnvelopeSchema.parse({
      kind: 'bootstrap',
      ...requestMetadata('bootstrap-ui-credit'),
      expectedSdkVersion: '0.84.2',
    }), port)
    port.receive(piHostRequestEnvelopeSchema.parse({
      kind: 'request',
      ...runtimeRequestMetadata('create-ui-credit'),
      command: {
        type: 'runtime.create',
        runtimeId: 'rt_ui_credit',
        sessionDir: '/tmp/pipilot-sessions',
      },
    }))
    await vi.waitFor(() => expect(port.sent).toHaveLength(2))

    for (let sequence = 1; sequence <= 65; sequence += 1) {
      manager.emitUiRequest({
        runtimeId: 'rt_ui_credit',
        generation: 1,
        sequence,
        request: {
          type: 'extension_ui_request',
          id: `notice-${sequence}`,
          method: 'notify',
          message: `Notice ${sequence}`,
        },
      })
    }
    await vi.waitFor(() => expect(port.sent).toHaveLength(66))
    expect(port.sent[2]).toMatchObject({ kind: 'ui_request', sequence: 1 })
    expect(port.sent[65]).toMatchObject({ kind: 'ui_request', sequence: 64 })

    port.receive(piHostCreditEnvelopeSchema.parse({
      kind: 'credit',
      protocolVersion: PI_HOST_PROTOCOL_VERSION,
      hostEpoch: 4,
      runtimeId: 'rt_ui_credit',
      runtimeGeneration: 1,
      throughSequence: 64,
    }))
    await vi.waitFor(() => expect(port.sent).toHaveLength(67))
    expect(port.sent[66]).toMatchObject({ kind: 'ui_request', sequence: 65 })
  })

  it('closes the Host after a Runtime operation timeout', async () => {
    class TimeoutRuntimeManager extends FakeRuntimeManager {
      override async command(): Promise<RuntimeCommandResult> {
        throw new RuntimeManagerError(
          'RUNTIME_OPERATION_TIMEOUT',
          'The Runtime operation timed out.',
        )
      }

      override async dispose(): Promise<void> {
        return new Promise(() => undefined)
      }
    }

    const parent = new FakeParentPort()
    const port = new FakeMessagePort()
    const manager = new TimeoutRuntimeManager()
    const exits: number[] = []
    new PiHostUtility({
      parentPort: parent,
      cwd: '/tmp/pipilot-project',
      agentDir: '/tmp/pipilot-agent',
      sdkVersion: '0.84.2',
      createRuntimeManager: () => manager,
      exit: (code) => exits.push(code),
    }).start()

    parent.bootstrap(piHostBootstrapEnvelopeSchema.parse({
      kind: 'bootstrap',
      ...requestMetadata('bootstrap-timeout'),
      expectedSdkVersion: '0.84.2',
    }), port)
    await manager.create({
      runtimeId: 'rt_timeout',
      sessionDir: '/tmp/pipilot-sessions',
    })

    port.receive(piHostRequestEnvelopeSchema.parse({
      kind: 'request',
      ...runtimeRequestMetadata('timeout-1'),
      runtimeId: 'rt_timeout',
      runtimeGeneration: 1,
      command: { type: 'runtime.command', rpc: { type: 'get_state' } },
    }))

    await vi.waitFor(() => {
      expect(port.sent.find((message) =>
        piHostResponseEnvelopeSchema.safeParse(message).success &&
        (message as { requestId?: string }).requestId === 'timeout-1',
      )).toMatchObject({
        kind: 'response',
        requestId: 'timeout-1',
        ok: false,
        error: { code: 'RUNTIME_OPERATION_TIMEOUT' },
      })
      expect(port.sent[port.sent.length - 1]).toMatchObject({
        kind: 'host_failure',
        error: { code: 'RUNTIME_OPERATION_TIMEOUT' },
      })
      expect(port.closed).toBe(true)
      expect(exits).toEqual([1])
    })
  })

  it('posts one sanitized first-fault envelope before fatal shutdown', async () => {
    const parent = new FakeParentPort()
    const port = new FakeMessagePort()
    const manager = new FakeRuntimeManager()
    const exits: number[] = []
    new PiHostUtility({
      parentPort: parent,
      cwd: '/tmp/pipilot-project',
      agentDir: '/tmp/pipilot-agent',
      sdkVersion: '0.84.2',
      createRuntimeManager: () => manager,
      exit: (code) => exits.push(code),
    }).start()

    parent.bootstrap(piHostBootstrapEnvelopeSchema.parse({
      kind: 'bootstrap',
      ...requestMetadata('bootstrap-fatal'),
      expectedSdkVersion: '0.84.2',
    }), port)
    manager.emitFatalError(Object.assign(
      new Error('token=secret /Users/private/session.jsonl prompt contents'),
      {
        code: 'RUNTIME_EXTENSION_SHUTDOWN_REQUESTED',
        stack: 'at /Users/private/extension.ts:10:2',
      },
    ))

    await vi.waitFor(() => {
      expect(port.closed).toBe(true)
      expect(exits).toEqual([1])
    })
    const failures = port.sent.filter((message) =>
      piHostFailureEnvelopeSchema.safeParse(message).success,
    )
    expect(failures).toHaveLength(1)
    expect(piHostFailureEnvelopeSchema.parse(failures[0])).toMatchObject({
      kind: 'host_failure',
      hostEpoch: 4,
      error: {
        code: 'RUNTIME_EXTENSION_SHUTDOWN_REQUESTED',
        message: 'The embedded Pi Host reported a fatal internal failure.',
      },
    })
    expect(JSON.stringify(failures[0])).not.toContain('secret')
    expect(JSON.stringify(failures[0])).not.toContain('/Users/private')

    manager.emitFatalError(new Error('later failure'))
    expect(port.sent.filter((message) =>
      piHostFailureEnvelopeSchema.safeParse(message).success,
    )).toHaveLength(1)
  })

  it('projects only bounded plain DTOs and never silently drops unsafe values', () => {
    const shared = { value: 1, omitted: undefined }
    expect(projectPiHostDto({ first: shared, second: shared })).toEqual({
      first: { value: 1 },
      second: { value: 1 },
    })

    const circular: Record<string, unknown> = {}
    circular.self = circular
    for (const invalid of [() => undefined, new Error('raw'), circular]) {
      expect(() => projectPiHostDto(invalid)).toThrowError(
        expect.objectContaining({ code: 'HOST_DTO_UNCLONEABLE' }),
      )
    }
  })

  it('returns a failed handshake when the bundled SDK pin differs', async () => {
    const parent = new FakeParentPort()
    const port = new FakeMessagePort()
    const exits: number[] = []
    new PiHostUtility({
      parentPort: parent,
      cwd: '/tmp/pipilot-project',
      agentDir: '/tmp/pipilot-agent',
      sdkVersion: '0.84.2',
      exit: (code) => exits.push(code),
    }).start()

    parent.bootstrap(piHostBootstrapEnvelopeSchema.parse({
      kind: 'bootstrap',
      ...requestMetadata('bootstrap-mismatch'),
      expectedSdkVersion: '0.84.1',
    }), port)

    await vi.waitFor(() => expect(exits).toEqual([1]))
    expect(port.sent[0]).toMatchObject({
      kind: 'handshake',
      ok: false,
      error: { code: 'SDK_VERSION_MISMATCH' },
    })
  })
})
