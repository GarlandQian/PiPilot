import { randomUUID } from 'node:crypto'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  MessageChannelMain,
  MessagePortMain,
  UtilityProcess,
} from 'electron'
import {
  PI_HOST_MAX_ENVELOPE_BYTES,
  PI_HOST_PROTOCOL_VERSION,
  estimatePiHostDtoBytes,
  normalizePiHostError,
  piHostBootstrapEnvelopeSchema,
  piHostCreditEnvelopeSchema,
  piHostEnvelopeSchema,
  piHostRequestEnvelopeSchema,
  type PiHostCommand,
  type PiHostDto,
  type PiHostError,
  type PiHostEventEnvelope,
  type PiHostFailureEnvelope,
  type PiHostHandshakeEnvelope,
  type PiHostResponseEnvelope,
  type PiHostUiRequestEventEnvelope,
} from '../../shared/pi-host-protocol'

export const PI_HOST_EXPECTED_SDK_VERSION = '0.84.2'
export const DEFAULT_PI_HOST_HANDSHAKE_TIMEOUT_MS = 15_000
export const DEFAULT_PI_HOST_REQUEST_TIMEOUT_MS = 30_000
export const DEFAULT_PI_HOST_SHUTDOWN_TIMEOUT_MS = 2_000
export const DEFAULT_PI_HOST_MAX_PENDING_REQUESTS = 128
export const DEFAULT_PI_HOST_MAX_PENDING_BYTES = 8 * 1024 * 1024

const MAX_STDERR_CHARS = 8_192

export function resolvePiHostUtilityModulePath(moduleUrl = import.meta.url) {
  const moduleDirectory = dirname(fileURLToPath(moduleUrl))
  const mainDirectory = basename(moduleDirectory) === 'chunks'
    ? dirname(moduleDirectory)
    : moduleDirectory
  return join(mainDirectory, 'pi-host-utility.js')
}

export type PiHostControllerState =
  | 'stopped'
  | 'starting'
  | 'ready'
  | 'failed'
  | 'stopping'
  | 'disposed'

export type PiHostControllerErrorCode =
  | 'DISPOSED'
  | 'HANDSHAKE_FAILED'
  | 'HOST_EXITED'
  | 'HOST_REPORTED_FAILURE'
  | 'INVALID_CONFIGURATION'
  | 'PORT_CLOSED'
  | 'PROTOCOL_ERROR'
  | 'QUEUE_FULL'
  | 'REQUEST_FAILED'
  | 'START_FAILED'
  | 'TIMEOUT'

export class PiHostControllerError extends Error {
  constructor(
    readonly code: PiHostControllerErrorCode,
    message: string,
    readonly recoverable = true,
    readonly diagnostic?: PiHostError,
  ) {
    super(message)
    this.name = 'PiHostControllerError'
  }
}

export interface PiHostControllerSnapshot {
  state: PiHostControllerState
  hostEpoch: number
  pid: number | null
  cwd: string
  sdkVersion: string | null
  nodeVersion: string | null
  electronVersion: string | null
  capabilities: string[]
  stderr: string
  error: PiHostError | null
}

export interface PiHostElectronAdapter {
  waitUntilReady(): Promise<void>
  createMessageChannel(): MessageChannelMain
  forkUtility(
    modulePath: string,
    args: string[],
    options: {
      cwd: string
      env: NodeJS.ProcessEnv
      serviceName: string
      stdio: ['ignore', 'ignore', 'pipe']
    },
  ): UtilityProcess
}

export interface PiHostControllerOptions {
  cwd: string
  utilityModulePath?: string
  expectedSdkVersion?: string
  environment?: NodeJS.ProcessEnv
  handshakeTimeoutMs?: number
  requestTimeoutMs?: number
  shutdownTimeoutMs?: number
  maxPendingRequests?: number
  maxPendingBytes?: number
  createId?: () => string
  electron?: PiHostElectronAdapter
}

export interface PiHostRequestOptions {
  runtimeId?: string
  runtimeGeneration?: number
  timeoutMs?: number
}

interface PendingRequest {
  command: PiHostCommand['type']
  createdRuntimeId?: string
  hostEpoch: number
  requestId: string
  runtimeId?: string
  runtimeGeneration?: number
  estimatedBytes: number
  resolve(value: PiHostDto): void
  reject(error: Error): void
  timer: NodeJS.Timeout
}

interface PendingHandshake {
  hostEpoch: number
  requestId: string
  resolve(value: PiHostHandshakeEnvelope): void
  reject(error: Error): void
  timer: NodeJS.Timeout
}

interface ActiveFailure {
  hostEpoch: number
  error: PiHostControllerError
  promise: Promise<void>
}

type SnapshotListener = (snapshot: PiHostControllerSnapshot) => void
type EventListener = (event: PiHostEventEnvelope) => void
type UiRequestListener = (event: PiHostUiRequestEventEnvelope) => void

function positiveInteger(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new PiHostControllerError(
      'INVALID_CONFIGURATION',
      `${name} must be a positive safe integer.`,
      false,
    )
  }
  return value
}

async function loadDefaultElectronAdapter(): Promise<PiHostElectronAdapter> {
  const electron = await import('electron')
  return {
    waitUntilReady: async () => {
      await electron.app.whenReady()
    },
    createMessageChannel: () => new electron.MessageChannelMain(),
    forkUtility: (modulePath, args, options) =>
      electron.utilityProcess.fork(modulePath, args, options),
  }
}

function controllerError(
  code: PiHostControllerErrorCode,
  message: string,
  cause?: unknown,
) {
  const diagnostic = cause === undefined
    ? undefined
    : normalizePiHostError(cause, code)
  return new PiHostControllerError(code, message, true, diagnostic)
}

function responseFailure(response: Extract<PiHostResponseEnvelope, { ok: false }>) {
  return new PiHostControllerError(
    'REQUEST_FAILED',
    response.error.message,
    true,
    response.error,
  )
}

export class PiHostController {
  private readonly cwd: string
  private readonly utilityModulePath: string
  private readonly expectedSdkVersion: string
  private readonly environment: NodeJS.ProcessEnv
  private readonly handshakeTimeoutMs: number
  private readonly requestTimeoutMs: number
  private readonly shutdownTimeoutMs: number
  private readonly maxPendingRequests: number
  private readonly maxPendingBytes: number
  private readonly createId: () => string
  private readonly configuredElectron?: PiHostElectronAdapter
  private readonly pendingRequests = new Map<string, PendingRequest>()
  private readonly snapshotListeners = new Set<SnapshotListener>()
  private readonly eventListeners = new Set<EventListener>()
  private readonly uiRequestListeners = new Set<UiRequestListener>()
  private pendingHandshake: PendingHandshake | null = null
  private utility: UtilityProcess | null = null
  private port: MessagePortMain | null = null
  private hostEpoch = 0
  private pendingBytes = 0
  private startPromise: Promise<PiHostControllerSnapshot> | null = null
  private lifecycle = Promise.resolve()
  private intentionalClose = false
  private activeFailure: ActiveFailure | null = null
  private snapshot: PiHostControllerSnapshot

  constructor(options: PiHostControllerOptions) {
    if (!isAbsolute(options.cwd)) {
      throw new PiHostControllerError(
        'INVALID_CONFIGURATION',
        'Pi Host cwd must be an absolute path.',
        false,
      )
    }
    const utilityModulePath = options.utilityModulePath ??
      resolvePiHostUtilityModulePath()
    if (!isAbsolute(utilityModulePath)) {
      throw new PiHostControllerError(
        'INVALID_CONFIGURATION',
        'Pi Host utility module path must be absolute.',
        false,
      )
    }

    this.cwd = options.cwd
    this.utilityModulePath = utilityModulePath
    this.expectedSdkVersion = options.expectedSdkVersion ?? PI_HOST_EXPECTED_SDK_VERSION
    this.environment = { ...(options.environment ?? process.env) }
    this.handshakeTimeoutMs = positiveInteger(
      options.handshakeTimeoutMs ?? DEFAULT_PI_HOST_HANDSHAKE_TIMEOUT_MS,
      'handshakeTimeoutMs',
    )
    this.requestTimeoutMs = positiveInteger(
      options.requestTimeoutMs ?? DEFAULT_PI_HOST_REQUEST_TIMEOUT_MS,
      'requestTimeoutMs',
    )
    this.shutdownTimeoutMs = positiveInteger(
      options.shutdownTimeoutMs ?? DEFAULT_PI_HOST_SHUTDOWN_TIMEOUT_MS,
      'shutdownTimeoutMs',
    )
    this.maxPendingRequests = positiveInteger(
      options.maxPendingRequests ?? DEFAULT_PI_HOST_MAX_PENDING_REQUESTS,
      'maxPendingRequests',
    )
    this.maxPendingBytes = positiveInteger(
      options.maxPendingBytes ?? DEFAULT_PI_HOST_MAX_PENDING_BYTES,
      'maxPendingBytes',
    )
    if (this.maxPendingBytes > PI_HOST_MAX_ENVELOPE_BYTES * this.maxPendingRequests) {
      throw new PiHostControllerError(
        'INVALID_CONFIGURATION',
        'maxPendingBytes exceeds the configured request envelope capacity.',
        false,
      )
    }
    this.createId = options.createId ?? randomUUID
    this.configuredElectron = options.electron
    this.snapshot = {
      state: 'stopped',
      hostEpoch: 0,
      pid: null,
      cwd: this.cwd,
      sdkVersion: null,
      nodeVersion: null,
      electronVersion: null,
      capabilities: [],
      stderr: '',
      error: null,
    }
  }

  getSnapshot() {
    return structuredClone(this.snapshot)
  }

  subscribe(listener: SnapshotListener) {
    this.snapshotListeners.add(listener)
    return () => this.snapshotListeners.delete(listener)
  }

  subscribeEvents(listener: EventListener) {
    this.eventListeners.add(listener)
    return () => this.eventListeners.delete(listener)
  }

  subscribeUiRequests(listener: UiRequestListener) {
    this.uiRequestListeners.add(listener)
    return () => this.uiRequestListeners.delete(listener)
  }

  start() {
    if (this.snapshot.state === 'disposed') {
      return Promise.reject(
        new PiHostControllerError('DISPOSED', 'Pi Host controller is disposed.', false),
      )
    }
    if (this.snapshot.state === 'ready') return Promise.resolve(this.getSnapshot())
    if (this.startPromise) return this.startPromise

    const operation = this.enqueue(async () => this.startInternal())
    const tracked = operation.finally(() => {
      if (this.startPromise === tracked) this.startPromise = null
    })
    this.startPromise = tracked
    return tracked
  }

  restart() {
    return this.enqueue(async () => {
      this.assertNotDisposed()
      await this.stopInternal()
      return this.startInternal()
    })
  }

  request(command: PiHostCommand, options: PiHostRequestOptions = {}) {
    return this.sendRequest(command, options, false)
  }

  grantCredit(
    throughSequence: number,
    target: Pick<PiHostRequestOptions, 'runtimeId' | 'runtimeGeneration'> = {},
  ) {
    this.assertReady()
    const envelope = piHostCreditEnvelopeSchema.parse({
      kind: 'credit',
      protocolVersion: PI_HOST_PROTOCOL_VERSION,
      hostEpoch: this.hostEpoch,
      ...(target.runtimeId === undefined ? {} : { runtimeId: target.runtimeId }),
      ...(target.runtimeGeneration === undefined
        ? {}
        : { runtimeGeneration: target.runtimeGeneration }),
      throughSequence,
    })
    this.postEnvelope(envelope)
  }

  /**
   * Acknowledges an event only after the Main consumer has applied it. The
   * controller deliberately does not auto-credit from the MessagePort callback:
   * catalog observation and renderer projection may finish asynchronously.
   * Phase 1 emits no streaming events; enabling them later requires the Utility
   * queue to start with a bounded window and stop beyond the last acknowledged
   * sequence.
   */
  acknowledgeEvent(event: PiHostEventEnvelope | PiHostUiRequestEventEnvelope) {
    if (event.hostEpoch !== this.hostEpoch) {
      throw new PiHostControllerError(
        'PROTOCOL_ERROR',
        'Cannot acknowledge an event from a stale Pi Host epoch.',
      )
    }
    this.grantCredit(event.sequence, {
      runtimeId: event.runtimeId,
      runtimeGeneration: event.runtimeGeneration,
    })
  }

  stop() {
    return this.enqueue(async () => this.stopInternal())
  }

  async dispose() {
    if (this.snapshot.state === 'disposed') return
    await this.stop()
    this.publish({
      ...this.snapshot,
      state: 'disposed',
      pid: null,
      capabilities: [],
    })
    this.snapshotListeners.clear()
    this.eventListeners.clear()
    this.uiRequestListeners.clear()
  }

  private async startInternal() {
    this.assertNotDisposed()
    if (this.snapshot.state === 'ready') return this.getSnapshot()

    const activeFailure = this.activeFailure
    if (activeFailure?.hostEpoch === this.hostEpoch) {
      await activeFailure.promise
    }
    await this.cleanupActive(true)
    this.hostEpoch += 1
    const epoch = this.hostEpoch
    this.activeFailure = null
    this.intentionalClose = false
    this.publish({
      state: 'starting',
      hostEpoch: epoch,
      pid: null,
      cwd: this.cwd,
      sdkVersion: null,
      nodeVersion: null,
      electronVersion: null,
      capabilities: [],
      stderr: '',
      error: null,
    })

    try {
      const electron = this.configuredElectron ?? await loadDefaultElectronAdapter()
      await electron.waitUntilReady()
      if (epoch !== this.hostEpoch || this.snapshot.state !== 'starting') {
        throw new PiHostControllerError('START_FAILED', 'Pi Host start was superseded.')
      }

      const utility = electron.forkUtility(this.utilityModulePath, [], {
        cwd: this.cwd,
        env: this.environment,
        serviceName: 'PiPilot Pi Host',
        stdio: ['ignore', 'ignore', 'pipe'],
      })
      this.utility = utility
      await this.waitForSpawn(utility, epoch)
      this.attachUtility(utility, epoch)

      const channel = electron.createMessageChannel()
      this.port = channel.port1
      this.attachPort(channel.port1, epoch)
      channel.port1.start()

      const requestId = this.createId()
      const bootstrap = piHostBootstrapEnvelopeSchema.parse({
        kind: 'bootstrap',
        protocolVersion: PI_HOST_PROTOCOL_VERSION,
        hostEpoch: epoch,
        requestId,
        expectedSdkVersion: this.expectedSdkVersion,
      })
      const handshake = this.waitForHandshake(epoch, requestId)
      try {
        utility.postMessage(bootstrap, [channel.port2])
      } catch (error) {
        const pending = this.pendingHandshake
        if (pending?.requestId === requestId) {
          this.pendingHandshake = null
          clearTimeout(pending.timer)
          pending.reject(error instanceof Error ? error : new Error(String(error)))
        }
        await handshake.catch(() => undefined)
        throw error
      }
      const result = await handshake

      if (!result.ok) {
        throw new PiHostControllerError(
          'HANDSHAKE_FAILED',
          result.error.message,
          true,
          result.error,
        )
      }
      if (result.sdkVersion !== this.expectedSdkVersion) {
        throw new PiHostControllerError(
          'HANDSHAKE_FAILED',
          `Pi Host SDK version ${result.sdkVersion} does not match ${this.expectedSdkVersion}.`,
          false,
        )
      }

      this.publish({
        ...this.snapshot,
        state: 'ready',
        pid: utility.pid ?? null,
        sdkVersion: result.sdkVersion,
        nodeVersion: result.nodeVersion,
        electronVersion: result.electronVersion,
        capabilities: [...result.capabilities],
        error: null,
      })
      return this.getSnapshot()
    } catch (error) {
      const failure = error instanceof PiHostControllerError
        ? error
        : controllerError('START_FAILED', 'Pi Host failed to start.', error)
      await this.failActive(failure, true)
      throw failure
    }
  }

  private async stopInternal() {
    if (this.snapshot.state === 'disposed') return this.getSnapshot()
    if (!this.utility && !this.port) {
      this.publish({
        ...this.snapshot,
        state: 'stopped',
        pid: null,
        sdkVersion: null,
        nodeVersion: null,
        electronVersion: null,
        capabilities: [],
        error: null,
      })
      return this.getSnapshot()
    }

    this.intentionalClose = true
    this.publish({ ...this.snapshot, state: 'stopping' })
    this.rejectPending(
      new PiHostControllerError('HOST_EXITED', 'Pi Host is stopping.'),
    )

    const utility = this.utility
    if (this.port && utility) {
      try {
        await this.sendRequest(
          { type: 'shutdown' },
          { timeoutMs: this.shutdownTimeoutMs },
          true,
        )
      } catch {
        // The bounded exit wait and kill fallback below remain authoritative.
      }
    }

    this.port?.close()
    if (utility) {
      const exited = await this.waitForExit(utility, this.shutdownTimeoutMs)
      if (!exited && utility.pid !== undefined) utility.kill()
    }
    await this.cleanupActive(false)
    this.intentionalClose = false
    this.publish({
      ...this.snapshot,
      state: 'stopped',
      pid: null,
      sdkVersion: null,
      nodeVersion: null,
      electronVersion: null,
      capabilities: [],
      error: null,
    })
    return this.getSnapshot()
  }

  private sendRequest(
    command: PiHostCommand,
    options: PiHostRequestOptions,
    allowStopping: boolean,
  ): Promise<PiHostDto> {
    if (allowStopping) {
      if (!this.port || !['ready', 'stopping'].includes(this.snapshot.state)) {
        return Promise.reject(
          new PiHostControllerError('HOST_EXITED', 'Pi Host is not connected.'),
        )
      }
    } else {
      this.assertReady()
    }

    if (this.pendingRequests.size >= this.maxPendingRequests) {
      return Promise.reject(
        new PiHostControllerError(
          'QUEUE_FULL',
          'Pi Host pending request limit was reached.',
        ),
      )
    }

    const requestId = this.createId()
    const timeoutMs = positiveInteger(
      options.timeoutMs ?? this.requestTimeoutMs,
      'timeoutMs',
    )
    const envelope = piHostRequestEnvelopeSchema.parse({
      kind: 'request',
      protocolVersion: PI_HOST_PROTOCOL_VERSION,
      hostEpoch: this.hostEpoch,
      requestId,
      ...(options.runtimeId === undefined ? {} : { runtimeId: options.runtimeId }),
      ...(options.runtimeGeneration === undefined
        ? {}
        : { runtimeGeneration: options.runtimeGeneration }),
      timeoutMs,
      command,
    })
    const estimatedBytes = estimatePiHostDtoBytes(envelope)
    if (estimatedBytes === null || this.pendingBytes + estimatedBytes > this.maxPendingBytes) {
      return Promise.reject(
        new PiHostControllerError(
          'QUEUE_FULL',
          'Pi Host pending request byte limit was reached.',
        ),
      )
    }

    return new Promise<PiHostDto>((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = this.takePending(requestId)
        if (!pending) return
        const error = new PiHostControllerError(
          'TIMEOUT',
          `Pi Host request ${requestId} timed out.`,
        )
        pending.reject(error)
        // The SDK does not expose a generic cancellation primitive for an
        // arbitrary stuck extension/tool operation. The utility process is
        // therefore the hard reclamation boundary for request timeouts.
        void this.failActive(error, true)
      }, timeoutMs)
      timer.unref()

      this.pendingBytes += estimatedBytes
      this.pendingRequests.set(requestId, {
        command: command.type,
        ...(command.type === 'runtime.create'
          ? { createdRuntimeId: command.runtimeId }
          : {}),
        hostEpoch: this.hostEpoch,
        requestId,
        ...(options.runtimeId === undefined ? {} : { runtimeId: options.runtimeId }),
        ...(options.runtimeGeneration === undefined
          ? {}
          : { runtimeGeneration: options.runtimeGeneration }),
        estimatedBytes,
        resolve,
        reject,
        timer,
      })

      try {
        this.postEnvelope(envelope)
      } catch (error) {
        const pending = this.takePending(requestId)
        pending?.reject(controllerError(
          'PROTOCOL_ERROR',
          'Pi Host request could not be cloned or posted.',
          error,
        ))
      }
    })
  }

  private attachUtility(utility: UtilityProcess, epoch: number) {
    utility.on('exit', (code) => {
      if (utility !== this.utility || epoch !== this.hostEpoch) return
      if (this.intentionalClose || this.snapshot.state === 'stopping') return
      void this.failActive(
        new PiHostControllerError(
          'HOST_EXITED',
          `Pi Host exited unexpectedly with code ${code}.`,
        ),
        false,
      )
    })
    utility.on('error', (type, location) => {
      if (utility !== this.utility || epoch !== this.hostEpoch) return
      if (this.intentionalClose || this.snapshot.state === 'stopping') return
      void this.failActive(
        new PiHostControllerError(
          'HOST_EXITED',
          `Pi Host fatal error ${type} at ${location}.`,
        ),
        true,
      )
    })
    utility.stderr?.on('data', (chunk: unknown) => {
      if (utility !== this.utility || epoch !== this.hostEpoch) return
      const value = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
      this.publish({
        ...this.snapshot,
        stderr: `${this.snapshot.stderr}${value}`.slice(-MAX_STDERR_CHARS),
      })
    })
  }

  private attachPort(port: MessagePortMain, epoch: number) {
    port.on('message', (messageEvent) => {
      if (port !== this.port || epoch !== this.hostEpoch) return
      this.handleMessage(messageEvent.data)
    })
    port.on('close', () => {
      if (port !== this.port || epoch !== this.hostEpoch) return
      if (this.intentionalClose || this.snapshot.state === 'stopping') return
      void this.failActive(
        new PiHostControllerError('PORT_CLOSED', 'Pi Host message port closed.'),
        true,
      )
    })
  }

  private handleMessage(rawEnvelope: unknown) {
    const parsed = piHostEnvelopeSchema.safeParse(rawEnvelope)
    if (!parsed.success) {
      void this.failActive(
        controllerError(
          'PROTOCOL_ERROR',
          'Pi Host sent an invalid protocol envelope.',
          parsed.error,
        ),
        true,
      )
      return
    }

    const envelope = parsed.data
    if (envelope.hostEpoch !== this.hostEpoch) return

    switch (envelope.kind) {
      case 'host_failure':
        this.handleHostFailure(envelope)
        return
      case 'handshake':
        this.handleHandshake(envelope)
        return
      case 'response':
        this.handleResponse(envelope)
        return
      case 'event':
        for (const listener of this.eventListeners) {
          try {
            listener(envelope)
          } catch {
            // One Main consumer must not break Host transport delivery.
          }
        }
        return
      case 'ui_request':
        for (const listener of this.uiRequestListeners) {
          try {
            listener(envelope)
          } catch {
            // One Main consumer must not break Host transport delivery.
          }
        }
        return
      case 'bootstrap':
      case 'request':
      case 'credit':
        void this.failActive(
          new PiHostControllerError(
            'PROTOCOL_ERROR',
            `Pi Host sent unexpected ${envelope.kind} traffic to Main.`,
          ),
          true,
        )
    }
  }

  private handleHostFailure(envelope: PiHostFailureEnvelope) {
    if (this.intentionalClose || this.snapshot.state === 'stopping') return
    void this.failActive(
      new PiHostControllerError(
        'HOST_REPORTED_FAILURE',
        envelope.error.message,
        true,
        envelope.error,
      ),
      true,
    )
  }

  private handleHandshake(envelope: PiHostHandshakeEnvelope) {
    const pending = this.pendingHandshake
    if (
      !pending ||
      pending.hostEpoch !== envelope.hostEpoch ||
      pending.requestId !== envelope.requestId
    ) {
      return
    }
    this.pendingHandshake = null
    clearTimeout(pending.timer)
    pending.resolve(envelope)
  }

  private handleResponse(envelope: PiHostResponseEnvelope) {
    const pending = this.pendingRequests.get(envelope.requestId)
    if (!pending) return
    if (pending.hostEpoch !== envelope.hostEpoch) return
    if (!this.matchesResponseTarget(pending, envelope)) {
      void this.failActive(
        new PiHostControllerError(
          'PROTOCOL_ERROR',
          'Pi Host response Runtime identity did not match its request.',
        ),
        true,
      )
      return
    }

    const current = this.takePending(envelope.requestId)
    if (!current) return
    if (envelope.ok) current.resolve(envelope.result)
    else current.reject(responseFailure(envelope))
  }

  private matchesResponseTarget(
    pending: PendingRequest,
    response: PiHostResponseEnvelope,
  ) {
    switch (pending.command) {
      case 'ping':
      case 'shutdown':
        return response.runtimeId === undefined &&
          response.runtimeGeneration === undefined
      case 'runtime.create':
        if (!response.ok) {
          return response.runtimeId === undefined &&
            response.runtimeGeneration === undefined
        }
        return response.runtimeId === pending.createdRuntimeId &&
          response.runtimeGeneration !== undefined
      case 'runtime.bind':
      case 'runtime.reload':
      case 'runtime.command':
      case 'runtime.extension_ui_response':
      case 'runtime.dispose':
        return response.runtimeId === pending.runtimeId &&
          response.runtimeGeneration !== undefined &&
          pending.runtimeGeneration !== undefined &&
          response.runtimeGeneration >= pending.runtimeGeneration
    }
  }

  private waitForHandshake(hostEpoch: number, requestId: string) {
    return new Promise<PiHostHandshakeEnvelope>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingHandshake?.requestId !== requestId) return
        this.pendingHandshake = null
        reject(
          new PiHostControllerError(
            'TIMEOUT',
            'Pi Host handshake timed out.',
          ),
        )
      }, this.handshakeTimeoutMs)
      timer.unref()
      this.pendingHandshake = { hostEpoch, requestId, resolve, reject, timer }
    })
  }

  private waitForSpawn(utility: UtilityProcess, epoch: number) {
    if (utility.pid !== undefined) return Promise.resolve()
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup()
        reject(new PiHostControllerError('TIMEOUT', 'Pi Host spawn timed out.'))
      }, this.handshakeTimeoutMs)
      timer.unref()
      const cleanup = () => {
        clearTimeout(timer)
        utility.off('spawn', onSpawn)
        utility.off('exit', onExit)
      }
      const onSpawn = () => {
        cleanup()
        if (utility !== this.utility || epoch !== this.hostEpoch) {
          reject(new PiHostControllerError('START_FAILED', 'Pi Host spawn was superseded.'))
          return
        }
        resolve()
      }
      const onExit = (code: number) => {
        cleanup()
        reject(
          new PiHostControllerError(
            'HOST_EXITED',
            `Pi Host exited before spawn completed with code ${code}.`,
          ),
        )
      }
      utility.once('spawn', onSpawn)
      utility.once('exit', onExit)
    })
  }

  private waitForExit(utility: UtilityProcess, timeoutMs: number) {
    if (utility.pid === undefined) return Promise.resolve(true)
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        utility.off('exit', onExit)
        resolve(false)
      }, timeoutMs)
      timer.unref()
      const onExit = () => {
        clearTimeout(timer)
        resolve(true)
      }
      utility.once('exit', onExit)
    })
  }

  private postEnvelope(envelope: unknown) {
    if (!this.port) {
      throw new PiHostControllerError('HOST_EXITED', 'Pi Host message port is unavailable.')
    }
    this.port.postMessage(envelope)
  }

  private takePending(requestId: string) {
    const pending = this.pendingRequests.get(requestId)
    if (!pending) return null
    this.pendingRequests.delete(requestId)
    clearTimeout(pending.timer)
    this.pendingBytes = Math.max(0, this.pendingBytes - pending.estimatedBytes)
    return pending
  }

  private rejectPending(error: Error) {
    for (const requestId of [...this.pendingRequests.keys()]) {
      this.takePending(requestId)?.reject(error)
    }
    const handshake = this.pendingHandshake
    if (handshake) {
      this.pendingHandshake = null
      clearTimeout(handshake.timer)
      handshake.reject(error)
    }
  }

  private async failActive(error: PiHostControllerError, kill: boolean) {
    if (this.snapshot.state === 'disposed') return
    const existing = this.activeFailure
    if (existing?.hostEpoch === this.hostEpoch) return existing.promise

    const failure: ActiveFailure = {
      hostEpoch: this.hostEpoch,
      error,
      promise: Promise.resolve(),
    }
    this.activeFailure = failure
    failure.promise = this.failActiveInternal(failure, kill)
    return failure.promise
  }

  private async failActiveInternal(
    failure: ActiveFailure,
    kill: boolean,
  ) {
    if (
      this.snapshot.state === 'disposed' ||
      failure.hostEpoch !== this.hostEpoch ||
      this.activeFailure !== failure
    ) {
      return
    }
    const utility = this.utility
    this.intentionalClose = true
    this.publish({
      ...this.snapshot,
      state: 'failed',
      pid: null,
      sdkVersion: null,
      nodeVersion: null,
      electronVersion: null,
      capabilities: [],
      error: failure.error.diagnostic ?? normalizePiHostError(
        failure.error,
        failure.error.code,
      ),
    })
    this.rejectPending(failure.error)
    this.port?.close()
    if (kill && utility?.pid !== undefined) utility.kill()
    await this.cleanupActive(false)
    if (
      failure.hostEpoch !== this.hostEpoch ||
      this.activeFailure !== failure
    ) {
      return
    }
    this.intentionalClose = false
  }

  private async cleanupActive(kill: boolean) {
    const utility = this.utility
    this.port?.close()
    this.port = null
    this.utility = null
    this.rejectPending(
      new PiHostControllerError('HOST_EXITED', 'Pi Host connection was replaced.'),
    )
    if (kill && utility?.pid !== undefined) utility.kill()
  }

  private assertReady() {
    this.assertNotDisposed()
    if (this.snapshot.state !== 'ready' || !this.port || !this.utility) {
      throw new PiHostControllerError('HOST_EXITED', 'Pi Host is not ready.')
    }
  }

  private assertNotDisposed() {
    if (this.snapshot.state === 'disposed') {
      throw new PiHostControllerError('DISPOSED', 'Pi Host controller is disposed.', false)
    }
  }

  private publish(snapshot: PiHostControllerSnapshot) {
    this.snapshot = snapshot
    const cloned = this.getSnapshot()
    for (const listener of this.snapshotListeners) {
      try {
        listener(cloned)
      } catch {
        // One listener must not interrupt process ownership.
      }
    }
  }

  private enqueue<T>(operation: () => Promise<T>) {
    const next = this.lifecycle.then(operation, operation)
    this.lifecycle = next.then(() => undefined, () => undefined)
    return next
  }
}
