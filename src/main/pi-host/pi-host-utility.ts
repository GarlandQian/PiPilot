import {
  VERSION as PI_SDK_VERSION,
  getAgentDir,
} from '@earendil-works/pi-coding-agent'
import {
  PI_HOST_INITIAL_CREDIT_WINDOW,
  PI_HOST_INITIAL_EVENT_SEQUENCE,
  PI_HOST_MAX_EVENT_TARGETS,
  PI_HOST_MAX_QUEUED_EVENT_BYTES,
  PI_HOST_MAX_QUEUED_EVENTS,
  estimatePiHostDtoBytes,
  normalizePiHostError,
  sanitizePiHostFailure,
  PI_HOST_PROTOCOL_VERSION,
  piHostBootstrapEnvelopeSchema,
  piHostCreditEnvelopeSchema,
  piHostEventEnvelopeSchema,
  piHostFailureEnvelopeSchema,
  piHostHandshakeEnvelopeSchema,
  piHostRequestEnvelopeSchema,
  piHostResponseEnvelopeSchema,
  piHostUiRequestEventEnvelopeSchema,
  type PiHostBootstrapEnvelope,
  type PiHostEventEnvelope,
  type PiHostRequestEnvelope,
  type PiHostResponseEnvelope,
  type PiHostUiRequestEventEnvelope,
} from '../../shared/pi-host-protocol'
import type { LocalPiRpcCommand } from '../../shared/local-pi'
import { projectPiHostDto } from './pi-host-dto'
import {
  RuntimeManager,
  RuntimeManagerError,
  type RuntimeCommandResult,
  type RuntimeDescriptor,
  type RuntimeExternalSubmitManagerResult,
  type RuntimeManagerOptions,
  type RuntimeEventRecord,
  type RuntimeUiRequestRecord,
  type RuntimeTarget,
} from './runtime-manager'
import type { RuntimeExternalSubmitCommand } from './runtime-command-dispatcher'
import { preparePiHostChildProcessEnvironment } from './pi-package-adapters'

const MAX_PENDING_REQUESTS = 256
export { PI_HOST_INITIAL_CREDIT_WINDOW, PI_HOST_INITIAL_EVENT_SEQUENCE }

export const PI_HOST_CAPABILITIES = [
  'message-port',
  'credit-window',
  'ping',
  'runtime.create',
  'runtime.bind',
  'runtime.reload',
  'runtime.command',
  'runtime.external-submit',
  'runtime.dispose',
  'runtime.new-session',
  'runtime.switch-session',
  'extension-ui',
  'shutdown',
] as const

export interface UtilityMessageEvent {
  data: unknown
  ports?: UtilityMessagePort[]
}

export interface UtilityMessagePort {
  on(event: 'message', listener: (event: UtilityMessageEvent) => void): this
  on(event: 'close', listener: () => void): this
  off(event: 'message', listener: (event: UtilityMessageEvent) => void): this
  off(event: 'close', listener: () => void): this
  postMessage(message: unknown): void
  start(): void
  close(): void
}

export interface UtilityParentPort {
  on(event: 'message', listener: (event: UtilityMessageEvent) => void): this
  off(event: 'message', listener: (event: UtilityMessageEvent) => void): this
}

export interface RuntimeManagerLike {
  renameSession(
    sessionFile: string,
    name: string,
  ): {
    renamed: true
    sessionFile: string
    sessionId: string
    name: string
  }
  create(target: RuntimeTarget): Promise<RuntimeDescriptor>
  createWithTimeout?(
    target: RuntimeTarget,
    timeoutMs: number,
  ): Promise<RuntimeDescriptor>
  get(runtimeId: string): RuntimeDescriptor | null
  bindRuntime(
    runtimeId: string,
    expectedGeneration?: number,
    timeoutMs?: number,
  ): Promise<RuntimeDescriptor>
  reloadRuntime(
    runtimeId: string,
    expectedGeneration?: number,
    timeoutMs?: number,
  ): Promise<RuntimeDescriptor>
  command(
    runtimeId: string,
    command: LocalPiRpcCommand,
    expectedGeneration?: number,
    timeoutMs?: number,
  ): Promise<RuntimeCommandResult>
  externalSubmit(
    runtimeId: string,
    command: RuntimeExternalSubmitCommand,
    expectedGeneration?: number,
    timeoutMs?: number,
  ): Promise<RuntimeExternalSubmitManagerResult>
  disposeRuntime(
    runtimeId: string,
    expectedGeneration?: number,
    timeoutMs?: number,
  ): Promise<RuntimeDescriptor | null>
  respondToExtensionUi(
    response: import('../../shared/local-pi').LocalPiExtensionUiResponse,
    runtimeId?: string,
    runtimeGeneration?: number,
  ): void
  dispose(): Promise<void>
  subscribeEvents?(
    listener: (record: RuntimeEventRecord) => void,
  ): () => void
  subscribeUiRequests?(
    listener: (record: RuntimeUiRequestRecord) => void,
  ): () => void
  subscribeFatalErrors?(listener: (error: unknown) => void): () => void
}

export interface PiHostUtilityOptions {
  parentPort: UtilityParentPort
  createRuntimeManager?: (options: RuntimeManagerOptions) => RuntimeManagerLike
  cwd?: string
  agentDir?: string
  sdkVersion?: string
  nodeVersion?: string
  electronVersion?: string
  maxPendingRequests?: number
  exit?: (code: number) => void
}

class PiHostUtilityProtocolError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'PiHostUtilityProtocolError'
    this.code = code
  }
}

interface RequestResult {
  result: unknown
  runtime?: RuntimeDescriptor
  closeAfterResponse?: boolean
}

type PiHostFlowEnvelope = PiHostEventEnvelope | PiHostUiRequestEventEnvelope

interface PendingHostEvent {
  envelope: PiHostFlowEnvelope
  bytes: number
}

interface EventFlow {
  acknowledgedSequence: number
  pending: PendingHostEvent[]
  inFlight: Map<number, number>
  bytes: number
}

export class PiHostUtility {
  private readonly parentPort: UtilityParentPort
  private readonly createRuntimeManager: (
    options: RuntimeManagerOptions,
  ) => RuntimeManagerLike
  private readonly cwd: string
  private readonly agentDir: string
  private readonly sdkVersion: string
  private readonly nodeVersion: string
  private readonly electronVersion: string
  private readonly maxPendingRequests: number
  private readonly exit: (code: number) => void
  private port: UtilityMessagePort | null = null
  private runtimeManager: RuntimeManagerLike | null = null
  private bootstrap: PiHostBootstrapEnvelope | null = null
  private pendingRequests = 0
  private readonly acknowledgedSequences = new Map<string, number>()
  private readonly eventFlows = new Map<string, EventFlow>()
  private detachRuntimeEvents: (() => void) | null = null
  private detachRuntimeUiRequests: (() => void) | null = null
  private detachRuntimeFatalErrors: (() => void) | null = null
  private acceptingRequests = false
  private closing: Promise<void> | null = null
  private hostFailurePosted = false

  constructor(options: PiHostUtilityOptions) {
    preparePiHostChildProcessEnvironment()
    this.parentPort = options.parentPort
    this.createRuntimeManager = options.createRuntimeManager ?? (
      (managerOptions) => new RuntimeManager(managerOptions)
    )
    this.cwd = options.cwd ?? process.cwd()
    this.agentDir = options.agentDir ?? getAgentDir()
    this.sdkVersion = options.sdkVersion ?? PI_SDK_VERSION
    this.nodeVersion = options.nodeVersion ?? process.versions.node
    this.electronVersion = options.electronVersion ??
      process.versions.electron ?? 'unavailable'
    this.maxPendingRequests = options.maxPendingRequests ?? MAX_PENDING_REQUESTS
    if (
      !Number.isSafeInteger(this.maxPendingRequests) ||
      this.maxPendingRequests < 1
    ) {
      throw new RangeError('maxPendingRequests must be a positive safe integer.')
    }
    this.exit = options.exit ?? ((code) => process.exit(code))
  }

  start(): void {
    this.parentPort.on('message', this.handleBootstrap)
  }

  private readonly handleBootstrap = (event: UtilityMessageEvent): void => {
    if (this.bootstrap !== null || this.closing !== null) return
    const parsed = piHostBootstrapEnvelopeSchema.safeParse(event.data)
    const port = event.ports?.[0]
    if (!parsed.success || !port || event.ports?.length !== 1) {
      this.parentPort.off('message', this.handleBootstrap)
      this.scheduleExit(1)
      return
    }

    this.bootstrap = parsed.data
    this.port = port
    this.parentPort.off('message', this.handleBootstrap)
    port.on('message', this.handlePortMessage)
    port.on('close', this.handlePortClose)
    port.start()

    if (parsed.data.expectedSdkVersion !== this.sdkVersion) {
      const error = new PiHostUtilityProtocolError(
        'SDK_VERSION_MISMATCH',
        `Expected Pi SDK ${parsed.data.expectedSdkVersion}, received ${this.sdkVersion}.`,
      )
      this.postHandshake({ ok: false, error: normalizePiHostError(error) })
      void this.shutdown(1)
      return
    }

    try {
      this.runtimeManager = this.createRuntimeManager({
        cwd: this.cwd,
        agentDir: this.agentDir,
      })
      this.detachRuntimeEvents = this.runtimeManager.subscribeEvents?.(
        (record) => this.enqueueRuntimeEvent(record),
      ) ?? null
      this.detachRuntimeUiRequests =
        this.runtimeManager.subscribeUiRequests?.((record) => {
          this.enqueueUiRequest(record)
        }) ?? null
      this.detachRuntimeFatalErrors =
        this.runtimeManager.subscribeFatalErrors?.((error) => {
          this.postHostFailureAndShutdown(error, 'HOST_RUNTIME_FATAL')
        }) ?? null
      this.acceptingRequests = true
      this.postHandshake({
        ok: true,
        sdkVersion: this.sdkVersion,
        nodeVersion: this.nodeVersion,
        electronVersion: this.electronVersion,
        capabilities: [...PI_HOST_CAPABILITIES],
      })
    } catch (error) {
      this.postHandshake({
        ok: false,
        error: normalizePiHostError(error, 'HOST_INITIALIZATION_FAILED'),
      })
      void this.shutdown(1)
    }
  }

  private postHandshake(
    result:
      | { ok: true; sdkVersion: string; nodeVersion: string; electronVersion: string; capabilities: string[] }
      | { ok: false; error: ReturnType<typeof normalizePiHostError> },
  ): void {
    const bootstrap = this.bootstrap
    const port = this.port
    if (!bootstrap || !port) return
    const envelope = piHostHandshakeEnvelopeSchema.parse({
      kind: 'handshake',
      protocolVersion: PI_HOST_PROTOCOL_VERSION,
      hostEpoch: bootstrap.hostEpoch,
      requestId: bootstrap.requestId,
      ...result,
    })
    port.postMessage(envelope)
  }

  private readonly handlePortMessage = (event: UtilityMessageEvent): void => {
    if (!this.acceptingRequests) return
    const parsed = piHostRequestEnvelopeSchema.safeParse(event.data)
    if (!parsed.success) {
      const credit = piHostCreditEnvelopeSchema.safeParse(event.data)
      if (credit.success) {
        this.acceptCredit(credit.data)
        return
      }
      this.postHostFailureAndShutdown(
        parsed.error,
        'HOST_PROTOCOL_ERROR',
      )
      return
    }
    if (this.pendingRequests >= this.maxPendingRequests) {
      this.postFailure(
        parsed.data,
        new PiHostUtilityProtocolError(
          'HOST_REQUEST_QUEUE_FULL',
          'The Pi Host request queue is full.',
        ),
      )
      return
    }

    this.pendingRequests += 1
    void this.handleRequest(parsed.data).finally(() => {
      this.pendingRequests -= 1
    })
  }

  private async handleRequest(request: PiHostRequestEnvelope): Promise<void> {
    try {
      const bootstrap = this.requireBootstrap()
      if (request.hostEpoch !== bootstrap.hostEpoch) {
        throw new PiHostUtilityProtocolError(
          'HOST_STALE_EPOCH',
          `Request targeted Host epoch ${request.hostEpoch}; current epoch is ${bootstrap.hostEpoch}.`,
        )
      }
      const handled = await this.dispatchRequest(request)
      this.postSuccess(request, handled)
      if (handled.closeAfterResponse) await this.shutdown(0)
    } catch (error) {
      this.postFailure(request, error)
      if (
        error instanceof RuntimeManagerError &&
        error.code === 'RUNTIME_OPERATION_TIMEOUT'
      ) {
        // The operation already timed out or disposal itself failed. Do not
        // enqueue another SDK disposal behind the stuck work; process exit is
        // the authoritative reclamation boundary.
        this.postHostFailureAndShutdown(error, 'HOST_RUNTIME_TIMEOUT')
        await this.closing
      } else if (request.command.type === 'shutdown') {
        await this.shutdown(1, { disposeRuntimes: false })
      }
    }
  }

  private async dispatchRequest(
    request: PiHostRequestEnvelope,
  ): Promise<RequestResult> {
    const manager = this.requireRuntimeManager()
    switch (request.command.type) {
      case 'ping':
        return { result: { type: 'pong' } }
      case 'session.rename':
        return {
          result: manager.renameSession(
            request.command.sessionFile,
            request.command.name,
          ),
        }
      case 'runtime.create': {
        const target = {
          runtimeId: request.command.runtimeId,
          sessionDir: request.command.sessionDir,
          ...(request.command.sessionFile === undefined
            ? {}
            : { sessionFile: request.command.sessionFile }),
          ...(request.command.forkSessionFile === undefined
            ? {}
            : { forkSessionFile: request.command.forkSessionFile }),
        }
        const runtime = manager.createWithTimeout
          ? await manager.createWithTimeout(target, request.timeoutMs)
          : await manager.create(target)
        return { result: { runtime }, runtime }
      }
      case 'runtime.bind': {
        const runtimeId = request.runtimeId!
        const runtime = await manager.bindRuntime(
          runtimeId,
          request.runtimeGeneration!,
          request.timeoutMs,
        )
        return { result: { bound: true, runtime }, runtime }
      }
      case 'runtime.reload': {
        const runtimeId = request.runtimeId!
        const runtime = await manager.reloadRuntime(
          runtimeId,
          request.runtimeGeneration!,
          request.timeoutMs,
        )
        return { result: { reloaded: true, runtime }, runtime }
      }
      case 'runtime.command': {
        const runtimeId = request.runtimeId!
        const result = await manager.command(
          runtimeId,
          request.command.rpc,
          request.runtimeGeneration!,
          request.timeoutMs,
        )
        return {
          result: { runtime: result.runtime, rpc: result.response },
          runtime: result.runtime,
        }
      }
      case 'runtime.external_submit': {
        const runtimeId = request.runtimeId!
        const result = await manager.externalSubmit(
          runtimeId,
          { message: request.command.message, mode: request.command.mode },
          request.runtimeGeneration!,
          request.timeoutMs,
        )
        return {
          result: {
            runtime: result.runtime,
            acceptedMode: result.acceptedMode,
          },
          runtime: result.runtime,
        }
      }
      case 'runtime.extension_ui_response': {
        const runtimeId = request.runtimeId!
        manager.respondToExtensionUi(
          request.command.response,
          runtimeId,
          request.runtimeGeneration,
        )
        const runtime = manager.get(runtimeId)
        return {
          result: { delivered: true, runtime },
          runtime: runtime ?? undefined,
        }
      }
      case 'runtime.dispose': {
        const runtimeId = request.runtimeId!
        const runtime = await manager.disposeRuntime(
          runtimeId,
          request.runtimeGeneration!,
          request.timeoutMs,
        )
        if (!runtime) {
          throw new PiHostUtilityProtocolError(
            'RUNTIME_NOT_FOUND',
            `Runtime not found: ${runtimeId}`,
          )
        }
        this.acknowledgedSequences.delete(
          this.creditTargetKey(runtime.runtimeId, runtime.generation),
        )
        return { result: { disposed: true, runtime }, runtime }
      }
      case 'shutdown': {
        this.acceptingRequests = false
        await manager.dispose()
        this.runtimeManager = null
        return { result: { shutdown: true }, closeAfterResponse: true }
      }
    }
    throw new PiHostUtilityProtocolError(
      'HOST_PROTOCOL_ERROR',
      'Unsupported Pi Host command.',
    )
  }

  private postSuccess(
    request: PiHostRequestEnvelope,
    handled: RequestResult,
  ): void {
    const runtime = handled.runtime
    this.postResponse(piHostResponseEnvelopeSchema.parse({
      kind: 'response',
      protocolVersion: PI_HOST_PROTOCOL_VERSION,
      hostEpoch: request.hostEpoch,
      requestId: request.requestId,
      ...(runtime === undefined
        ? {}
        : {
            runtimeId: runtime.runtimeId,
            runtimeGeneration: runtime.generation,
          }),
      ok: true,
      result: projectPiHostDto(handled.result),
    }))
  }

  private postFailure(request: PiHostRequestEnvelope, error: unknown): void {
    this.postResponse(piHostResponseEnvelopeSchema.parse({
      kind: 'response',
      protocolVersion: PI_HOST_PROTOCOL_VERSION,
      hostEpoch: request.hostEpoch,
      requestId: request.requestId,
      ...(request.runtimeId === undefined
        ? {}
        : {
            runtimeId: request.runtimeId,
            runtimeGeneration: request.runtimeGeneration,
          }),
      ok: false,
      error: normalizePiHostError(error, 'HOST_REQUEST_FAILED'),
    }))
  }

  private postResponse(response: PiHostResponseEnvelope): void {
    try {
      this.port?.postMessage(response)
    } catch (error) {
      this.postHostFailureAndShutdown(
        error,
        'HOST_RESPONSE_TRANSPORT_FAILED',
      )
    }
  }

  private readonly handlePortClose = (): void => {
    void this.shutdown(0)
  }

  private acceptCredit(
    credit: ReturnType<typeof piHostCreditEnvelopeSchema.parse>,
  ): void {
    const bootstrap = this.bootstrap
    if (!bootstrap || credit.hostEpoch !== bootstrap.hostEpoch) return
    if (credit.runtimeId !== undefined) {
      const runtime = this.runtimeManager?.get(credit.runtimeId)
      if (!runtime || runtime.generation !== credit.runtimeGeneration) return
    }

    const key = this.creditTargetKey(
      credit.runtimeId,
      credit.runtimeGeneration,
    )
    const acknowledged = this.acknowledgedSequences.get(key) ?? 0
    if (credit.throughSequence <= acknowledged) return
    if (
      !this.acknowledgedSequences.has(key) &&
      this.acknowledgedSequences.size >= PI_HOST_MAX_EVENT_TARGETS
    ) {
      const oldest = this.acknowledgedSequences.keys().next().value
      if (oldest !== undefined) this.acknowledgedSequences.delete(oldest)
    }
    this.acknowledgedSequences.set(key, credit.throughSequence)
    const flow = this.eventFlows.get(key)
    if (!flow) return
    flow.acknowledgedSequence = credit.throughSequence
    for (const [sequence, bytes] of flow.inFlight) {
      if (sequence > credit.throughSequence) continue
      flow.inFlight.delete(sequence)
      flow.bytes = Math.max(0, flow.bytes - bytes)
    }
    this.flushEventFlow(key, flow)
    this.deleteSettledEventFlow(key, flow)
  }

  private creditTargetKey(
    runtimeId: string | undefined,
    runtimeGeneration: number | undefined,
  ): string {
    return runtimeId === undefined
      ? 'host'
      : `${runtimeId}:${runtimeGeneration}`
  }

  private enqueueUiRequest(record: RuntimeUiRequestRecord): void {
    const bootstrap = this.bootstrap
    if (!bootstrap || !this.port || this.closing) return
    let envelope
    try {
      envelope = piHostUiRequestEventEnvelopeSchema.parse({
        kind: 'ui_request',
        protocolVersion: PI_HOST_PROTOCOL_VERSION,
        hostEpoch: bootstrap.hostEpoch,
        runtimeId: record.runtimeId,
        runtimeGeneration: record.generation,
        sequence: record.sequence,
        request: record.request,
      })
    } catch (error) {
      this.postHostFailureAndShutdown(error, 'HOST_UI_PROJECTION_FAILED')
      return
    }
    const bytes = estimatePiHostDtoBytes(envelope)
    if (bytes === null) {
      this.postHostFailureAndShutdown(
        new PiHostUtilityProtocolError(
          'HOST_EVENT_INVALID',
          'An extension UI request could not be projected as a bounded Host DTO.',
        ),
        'HOST_UI_PROJECTION_FAILED',
      )
      return
    }
    this.enqueueFlowEnvelope(envelope, bytes)
  }


  private enqueueRuntimeEvent(record: RuntimeEventRecord): void {
    const bootstrap = this.bootstrap
    if (!bootstrap || !this.port || this.closing) return
    let envelope: PiHostEventEnvelope
    try {
      envelope = piHostEventEnvelopeSchema.parse({
        kind: 'event',
        protocolVersion: PI_HOST_PROTOCOL_VERSION,
        hostEpoch: bootstrap.hostEpoch,
        runtimeId: record.runtimeId,
        runtimeGeneration: record.generation,
        sequence: record.sequence,
        event: record.event,
      })
    } catch (error) {
      this.postHostFailureAndShutdown(error, 'HOST_EVENT_PROJECTION_FAILED')
      return
    }
    const bytes = estimatePiHostDtoBytes(envelope)
    if (bytes === null) {
      this.postHostFailureAndShutdown(
        new PiHostUtilityProtocolError(
          'HOST_EVENT_INVALID',
          'A Runtime event could not be projected as a bounded Host DTO.',
        ),
        'HOST_EVENT_PROJECTION_FAILED',
      )
      return
    }
    this.enqueueFlowEnvelope(envelope, bytes)
  }

  private enqueueFlowEnvelope(
    envelope: PiHostFlowEnvelope,
    bytes: number,
  ): void {
    const key = this.creditTargetKey(
      envelope.runtimeId,
      envelope.runtimeGeneration,
    )
    let flow = this.eventFlows.get(key)
    if (!flow) {
      if (this.eventFlows.size >= PI_HOST_MAX_EVENT_TARGETS) {
        this.postHostFailureAndShutdown(
          new PiHostUtilityProtocolError(
            'HOST_EVENT_TARGET_LIMIT',
            'The Pi Host event target limit was reached.',
          ),
          'HOST_EVENT_TARGET_LIMIT',
        )
        return
      }
      flow = {
        acknowledgedSequence: this.acknowledgedSequences.get(key) ?? 0,
        pending: [],
        inFlight: new Map(),
        bytes: 0,
      }
      this.eventFlows.set(key, flow)
    }
    if (
      flow.pending.length + flow.inFlight.size >=
        PI_HOST_MAX_QUEUED_EVENTS ||
      flow.bytes + bytes > PI_HOST_MAX_QUEUED_EVENT_BYTES
    ) {
      this.postHostFailureAndShutdown(
        new PiHostUtilityProtocolError(
          'HOST_EVENT_QUEUE_FULL',
          'The Pi Host event queue exceeded its bounded capacity.',
        ),
        'HOST_EVENT_QUEUE_FULL',
      )
      return
    }
    flow.pending.push({ envelope, bytes })
    flow.bytes += bytes
    this.flushEventFlow(key, flow)
  }

  private flushEventFlow(key: string, flow: EventFlow): void {
    const allowedThrough = flow.acknowledgedSequence +
      PI_HOST_INITIAL_CREDIT_WINDOW
    while (
      flow.pending.length > 0 &&
      flow.pending[0]!.envelope.sequence <= allowedThrough
    ) {
      const next = flow.pending.shift()!
      try {
        this.port?.postMessage(next.envelope)
      } catch (error) {
        this.postHostFailureAndShutdown(
          error,
          'HOST_EVENT_TRANSPORT_FAILED',
        )
        return
      }
      flow.inFlight.set(next.envelope.sequence, next.bytes)
    }
    this.deleteSettledEventFlow(key, flow)
  }

  private deleteSettledEventFlow(key: string, flow: EventFlow): void {
    if (flow.pending.length === 0 && flow.inFlight.size === 0) {
      this.eventFlows.delete(key)
    }
  }

  private postHostFailureAndShutdown(
    error: unknown,
    fallbackCode: string,
  ): void {
    if (this.closing || this.hostFailurePosted) return
    this.hostFailurePosted = true
    const bootstrap = this.bootstrap
    const port = this.port
    if (bootstrap && port) {
      try {
        port.postMessage(piHostFailureEnvelopeSchema.parse({
          kind: 'host_failure',
          protocolVersion: PI_HOST_PROTOCOL_VERSION,
          hostEpoch: bootstrap.hostEpoch,
          error: sanitizePiHostFailure(error, fallbackCode),
        }))
      } catch {
        // The terminal envelope is best-effort; shutdown remains authoritative.
      }
    }
    void this.shutdown(1, { disposeRuntimes: false })
  }

  private requireBootstrap(): PiHostBootstrapEnvelope {
    if (!this.bootstrap) {
      throw new PiHostUtilityProtocolError(
        'HOST_NOT_BOOTSTRAPPED',
        'The Pi Host has not completed bootstrap.',
      )
    }
    return this.bootstrap
  }

  private requireRuntimeManager(): RuntimeManagerLike {
    if (!this.runtimeManager) {
      throw new PiHostUtilityProtocolError(
        'HOST_NOT_READY',
        'The Pi Host RuntimeManager is unavailable.',
      )
    }
    return this.runtimeManager
  }

  private shutdown(
    exitCode: number,
    options: { disposeRuntimes?: boolean } = {},
  ): Promise<void> {
    if (this.closing) return this.closing
    this.acceptingRequests = false
    this.closing = (async () => {
      try {
        if (options.disposeRuntimes !== false) {
          await this.runtimeManager?.dispose()
        }
      } finally {
        this.detachRuntimeEvents?.()
        this.detachRuntimeUiRequests?.()
        this.detachRuntimeFatalErrors?.()
        this.detachRuntimeEvents = null
        this.detachRuntimeUiRequests = null
        this.detachRuntimeFatalErrors = null
        const port = this.port
        if (port) {
          port.off('message', this.handlePortMessage)
          port.off('close', this.handlePortClose)
          port.close()
        }
        this.port = null
        this.runtimeManager = null
        this.acknowledgedSequences.clear()
        this.eventFlows.clear()
        this.scheduleExit(exitCode)
      }
    })()
    return this.closing
  }

  private scheduleExit(code: number): void {
    setImmediate(() => this.exit(code)).unref?.()
  }
}

const utilityParentPort = (
  process as NodeJS.Process & { parentPort?: UtilityParentPort }
).parentPort

if (utilityParentPort) {
  new PiHostUtility({ parentPort: utilityParentPort }).start()
}
