import { realpathSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import {
  type AgentSessionEvent,
  type AgentSessionRuntime,
  type CreateAgentSessionRuntimeFactory,
  type CreateAgentSessionServicesOptions,
  SessionManager,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
} from '@earendil-works/pi-coding-agent'
import type {
  LocalPiExtensionUiRequest,
  LocalPiExtensionUiResponse,
  LocalPiRpcCommand,
  LocalPiRpcEvent,
  LocalPiRpcResponse,
} from '../../shared/local-pi'
import {
  dispatchExternalSubmit,
  dispatchRuntimeCommand,
  type RuntimeExternalSubmitCommand,
  type RuntimeExternalSubmitResult,
} from './runtime-command-dispatcher'
import { projectRuntimeEvent } from './runtime-event-projector'
import { RuntimeExtensionUiBridge } from './runtime-extension-ui-bridge'

const DEFAULT_OPERATION_TIMEOUT_MS = 30_000

export type RuntimeManagerErrorCode =
  | 'RUNTIME_MANAGER_DISPOSED'
  | 'RUNTIME_ALREADY_EXISTS'
  | 'RUNTIME_NOT_FOUND'
  | 'RUNTIME_TARGET_INVALID'
  | 'RUNTIME_SCOPE_MISMATCH'
  | 'RUNTIME_STALE_GENERATION'
  | 'RUNTIME_NOT_BOUND'
  | 'RUNTIME_OPERATION_TIMEOUT'
  | 'RUNTIME_EXTENSION_SHUTDOWN_REQUESTED'

export class RuntimeManagerError extends Error {
  readonly code: RuntimeManagerErrorCode

  constructor(code: RuntimeManagerErrorCode, message: string) {
    super(message)
    this.name = 'RuntimeManagerError'
    this.code = code
  }
}

export interface RuntimeTarget {
  runtimeId: string
  /** Optional; the SDK derives the default session directory for cwd. */
  sessionDir?: string
  sessionFile?: string
  forkSessionFile?: string
}

export interface RuntimeDescriptor {
  runtimeId: string
  generation: number
  cwd: string
  sessionFile: string | null
  sessionId: string
}

export interface RuntimeCommandResult {
  runtime: RuntimeDescriptor
  response: LocalPiRpcResponse
}

export interface RuntimeExternalSubmitManagerResult
  extends RuntimeExternalSubmitResult {
  runtime: RuntimeDescriptor
}

export interface RuntimeEventRecord {
  runtimeId: string
  generation: number
  sequence: number
  event: LocalPiRpcEvent
}

export interface RuntimeUiRequestRecord {
  runtimeId: string
  generation: number
  sequence: number
  request: LocalPiExtensionUiRequest
}

export interface RuntimeManagerOptions {
  cwd: string
  agentDir: string
  operationTimeoutMs?: number
  resourceLoaderOptions?: CreateAgentSessionServicesOptions['resourceLoaderOptions']
}

interface RuntimeEntry {
  generation: number
  runtime: AgentSessionRuntime
  extensionsBound: boolean
  operationTail: Promise<void>
  disposing: boolean
  sequence: number
  unsubscribeSession: (() => void) | null
  uiBridge: RuntimeExtensionUiBridge
}

function requireAbsolutePath(name: string, value: string): string {
  if (!value || !isAbsolute(value)) {
    throw new RuntimeManagerError(
      'RUNTIME_TARGET_INVALID',
      `${name} must be a non-empty absolute path.`,
    )
  }
  return value
}

function requireTimeout(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RuntimeManagerError(
      'RUNTIME_TARGET_INVALID',
      'operationTimeoutMs must be a positive number.',
    )
  }
  return value
}

function comparablePath(value: string): string {
  let canonical: string
  try {
    canonical = realpathSync.native(value)
  } catch {
    canonical = resolve(value)
  }
  return process.platform === 'win32' ? canonical.toLowerCase() : canonical
}

function describeRuntime(
  runtimeId: string,
  entry: RuntimeEntry,
  cwd: string,
): RuntimeDescriptor {
  return {
    runtimeId,
    generation: entry.generation,
    cwd,
    sessionFile: entry.runtime.session.sessionFile ?? null,
    sessionId: entry.runtime.session.sessionId,
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operation: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new RuntimeManagerError(
        'RUNTIME_OPERATION_TIMEOUT',
        `${operation} did not finish within ${timeoutMs} ms.`,
      ))
    }, timeoutMs)
    timeout.unref?.()
  })

  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
  }
}

export class RuntimeManager {
  private readonly cwd: string
  private readonly agentDir: string
  private readonly operationTimeoutMs: number
  private readonly resourceLoaderOptions:
    | CreateAgentSessionServicesOptions['resourceLoaderOptions']
    | undefined
  private readonly runtimes = new Map<string, RuntimeEntry>()
  private readonly creatingRuntimeIds = new Set<string>()
  private readonly pendingCreations = new Set<Promise<RuntimeDescriptor>>()
  private readonly eventListeners = new Set<(record: RuntimeEventRecord) => void>()
  private readonly fatalErrorListeners = new Set<(error: unknown) => void>()
  private readonly uiRequestListeners = new Set<(record: RuntimeUiRequestRecord) => void>()
  private disposed = false

  constructor(options: RuntimeManagerOptions) {
    this.cwd = requireAbsolutePath('cwd', options.cwd)
    this.agentDir = requireAbsolutePath('agentDir', options.agentDir)
    this.operationTimeoutMs = requireTimeout(
      options.operationTimeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS,
    )
    this.resourceLoaderOptions = options.resourceLoaderOptions
  }

  get size(): number {
    return this.runtimes.size
  }

  list(): RuntimeDescriptor[] {
    return [...this.runtimes].map(([runtimeId, entry]) => (
      describeRuntime(runtimeId, entry, this.cwd)
    ))
  }

  get(runtimeId: string): RuntimeDescriptor | null {
    const entry = this.runtimes.get(runtimeId)
    return entry ? describeRuntime(runtimeId, entry, this.cwd) : null
  }

  subscribeEvents(listener: (record: RuntimeEventRecord) => void) {
    this.eventListeners.add(listener)
    return () => this.eventListeners.delete(listener)
  }

  subscribeFatalErrors(listener: (error: unknown) => void) {
    this.fatalErrorListeners.add(listener)
    return () => this.fatalErrorListeners.delete(listener)
  }

  subscribeUiRequests(listener: (record: RuntimeUiRequestRecord) => void) {
    this.uiRequestListeners.add(listener)
    return () => this.uiRequestListeners.delete(listener)
  }

  /**
   * Delivers a Renderer extension UI response to the Runtime that owns the
   * dialog id. Callers may scope by Runtime identity; the bridge ignores late
   * or unknown responses so a dismissed dialog can never resurface.
   */
  respondToExtensionUi(
    response: LocalPiExtensionUiResponse,
    runtimeId?: string,
    runtimeGeneration?: number,
  ): void {
    this.assertActive()
    this.runtimes.forEach((entry, id) => {
      if (runtimeId !== undefined && runtimeId !== id) return
      if (
        runtimeGeneration !== undefined &&
        entry.generation !== runtimeGeneration
      ) {
        return
      }
      entry.uiBridge.respond(response)
    })
  }

  async create(target: RuntimeTarget): Promise<RuntimeDescriptor> {
    return this.createWithTimeout(target, this.operationTimeoutMs)
  }

  renameSession(sessionFile: string, name: string) {
    this.assertActive()
    const normalizedSessionFile = requireAbsolutePath('sessionFile', sessionFile)
    const normalizedName = name.replace(/[\r\n]+/gu, ' ').trim()
    if (!normalizedName) {
      throw new RuntimeManagerError(
        'RUNTIME_TARGET_INVALID',
        'Session name cannot be empty.',
      )
    }
    this.assertSessionCwd(normalizedSessionFile)
    const sessionManager = SessionManager.open(normalizedSessionFile)
    sessionManager.appendSessionInfo(normalizedName)
    return {
      renamed: true as const,
      sessionFile: normalizedSessionFile,
      sessionId: sessionManager.getSessionId(),
      name: sessionManager.getSessionName() ?? normalizedName,
    }
  }

  async createWithTimeout(
    target: RuntimeTarget,
    timeoutMs: number,
  ): Promise<RuntimeDescriptor> {
    this.assertActive()
    const effectiveTimeoutMs = requireTimeout(timeoutMs)
    if (!target.runtimeId.trim()) {
      throw new RuntimeManagerError(
        'RUNTIME_TARGET_INVALID',
        'runtimeId must be a non-empty string.',
      )
    }
    if (
      this.runtimes.has(target.runtimeId) ||
      this.creatingRuntimeIds.has(target.runtimeId)
    ) {
      throw new RuntimeManagerError(
        'RUNTIME_ALREADY_EXISTS',
        `Runtime already exists: ${target.runtimeId}`,
      )
    }
    const sessionDir = target.sessionDir === undefined
      ? undefined
      : requireAbsolutePath('sessionDir', target.sessionDir)
    if (target.sessionFile !== undefined && target.forkSessionFile !== undefined) {
      throw new RuntimeManagerError(
        'RUNTIME_TARGET_INVALID',
        'Runtime session and fork sources are mutually exclusive.',
      )
    }
    const sessionFile = target.sessionFile === undefined
      ? undefined
      : requireAbsolutePath('sessionFile', target.sessionFile)
    const forkSessionFile = target.forkSessionFile === undefined
      ? undefined
      : requireAbsolutePath('forkSessionFile', target.forkSessionFile)
    this.creatingRuntimeIds.add(target.runtimeId)
    const creation = this.createReservedRuntime({
      runtimeId: target.runtimeId,
      sessionDir,
      ...(sessionFile === undefined ? {} : { sessionFile }),
      ...(forkSessionFile === undefined ? {} : { forkSessionFile }),
    }, effectiveTimeoutMs)
    this.pendingCreations.add(creation)
    try {
      return await creation
    } finally {
      this.pendingCreations.delete(creation)
      this.creatingRuntimeIds.delete(target.runtimeId)
    }
  }

  private async createReservedRuntime(
    target: RuntimeTarget,
    timeoutMs: number,
  ): Promise<RuntimeDescriptor> {
    if (target.sessionFile !== undefined) {
      this.assertSessionCwd(target.sessionFile)
    }
    // Recovery forks intentionally accept a source whose recorded cwd no
    // longer exists. SessionManager.forkFrom() writes the child for this
    // Host's canonical cwd; Main validates both the source capability and the
    // resulting child before exposing the activation.
    const sessionManager = target.sessionFile !== undefined
      ? SessionManager.open(target.sessionFile, target.sessionDir)
      : target.forkSessionFile !== undefined
        ? SessionManager.forkFrom(target.forkSessionFile, this.cwd, target.sessionDir)
        : SessionManager.create(this.cwd, target.sessionDir)
    const createRuntime: CreateAgentSessionRuntimeFactory = async ({
      cwd,
      agentDir,
      sessionManager: nextSessionManager,
      sessionStartEvent,
    }) => {
      const services = await createAgentSessionServices({
        cwd,
        agentDir,
        resourceLoaderOptions: this.resourceLoaderOptions,
      })
      const result = await createAgentSessionFromServices({
        services,
        sessionManager: nextSessionManager,
        sessionStartEvent,
      })
      return {
        ...result,
        services,
        diagnostics: services.diagnostics,
      }
    }
    const runtimeCreation = createAgentSessionRuntime(createRuntime, {
      cwd: this.cwd,
      agentDir: this.agentDir,
      sessionManager,
    })
    let runtime: AgentSessionRuntime
    try {
      runtime = await withTimeout(
        runtimeCreation,
        timeoutMs,
        `Creating runtime ${target.runtimeId}`,
      )
    } catch (error) {
      void runtimeCreation.then(async (lateRuntime) => {
        try {
          await withTimeout(
            lateRuntime.dispose(),
            timeoutMs,
            `Disposing late runtime ${target.runtimeId}`,
          )
        } catch {
          // The utility-process owner is the final reclamation boundary.
        }
      }, () => undefined)
      throw error
    }

    if (this.disposed) {
      await withTimeout(
        runtime.dispose(),
        timeoutMs,
        `Disposing runtime ${target.runtimeId}`,
      )
      throw new RuntimeManagerError(
        'RUNTIME_MANAGER_DISPOSED',
        'Runtime manager was disposed while the runtime was being created.',
      )
    }

    const entry: RuntimeEntry = {
      generation: 1,
      runtime,
      extensionsBound: false,
      operationTail: Promise.resolve(),
      disposing: false,
      sequence: 0,
      unsubscribeSession: null,
      uiBridge: new RuntimeExtensionUiBridge(
        (request) => {
          entry.sequence += 1
          const record: RuntimeUiRequestRecord = {
            runtimeId: target.runtimeId,
            generation: entry.generation,
            sequence: entry.sequence,
            request,
          }
          for (const listener of this.uiRequestListeners) {
            try { listener(record) } catch { /* isolate utility consumers */ }
          }
        },
        {
          onFatal: (error) => {
            for (const listener of this.fatalErrorListeners) {
              try { listener(error) } catch { /* isolate utility consumers */ }
            }
          },
        },
      ),
    }
    this.runtimes.set(target.runtimeId, entry)
    runtime.setBeforeSessionInvalidate(() => {
      this.cancelUiRequests(entry)
    })
    runtime.setRebindSession(async () => {
      if (entry.disposing || this.disposed) return
      entry.generation += 1
      entry.sequence = 0
      entry.extensionsBound = false
      this.bindSessionEvents(target.runtimeId, entry)
      await this.bindSessionExtensions(target.runtimeId, entry)
      entry.extensionsBound = true
    })
    this.bindSessionEvents(target.runtimeId, entry)
    return describeRuntime(target.runtimeId, entry, this.cwd)
  }

  async bindRuntime(
    runtimeId: string,
    expectedGeneration?: number,
    timeoutMs = this.operationTimeoutMs,
  ): Promise<RuntimeDescriptor> {
    this.assertActive()
    const effectiveTimeoutMs = requireTimeout(timeoutMs)
    const entry = this.requireEntry(runtimeId)
    return withTimeout(
      this.enqueue(entry, async () => {
        if (entry.disposing) {
          throw new RuntimeManagerError(
            'RUNTIME_NOT_FOUND',
            `Runtime is being disposed: ${runtimeId}`,
          )
        }
        if (
          expectedGeneration !== undefined &&
          entry.generation !== expectedGeneration
        ) {
          throw new RuntimeManagerError(
            'RUNTIME_STALE_GENERATION',
            `Runtime ${runtimeId} is generation ${entry.generation}, not ${expectedGeneration}.`,
          )
        }
        if (!entry.extensionsBound) {
          await this.bindSessionExtensions(runtimeId, entry)
          entry.extensionsBound = true
        }
        return describeRuntime(runtimeId, entry, this.cwd)
      }),
      effectiveTimeoutMs,
      `Binding runtime ${runtimeId}`,
    )
  }

  async command(
    runtimeId: string,
    command: LocalPiRpcCommand,
    expectedGeneration?: number,
    timeoutMs = this.operationTimeoutMs,
  ): Promise<RuntimeCommandResult> {
    this.assertActive()
    const effectiveTimeoutMs = requireTimeout(timeoutMs)
    const entry = this.requireEntry(runtimeId)
    return withTimeout(
      this.enqueue(entry, async () => {
        if (entry.disposing) {
          throw new RuntimeManagerError(
            'RUNTIME_NOT_FOUND',
            `Runtime is being disposed: ${runtimeId}`,
          )
        }
        if (
          expectedGeneration !== undefined &&
          entry.generation !== expectedGeneration
        ) {
          throw new RuntimeManagerError(
            'RUNTIME_STALE_GENERATION',
            `Runtime ${runtimeId} is generation ${entry.generation}, not ${expectedGeneration}.`,
          )
        }
        if (!entry.extensionsBound) {
          throw new RuntimeManagerError(
            'RUNTIME_NOT_BOUND',
            `Runtime extensions are not bound: ${runtimeId}`,
          )
        }
        if (command.type === 'switch_session') {
          this.assertSessionCwd(command.sessionPath)
        }
        const generationBefore = entry.generation
        const result = await dispatchRuntimeCommand(entry.runtime, command, {
          emitEvent: (event) => this.emitRuntimeEvent(runtimeId, entry, event),
        })
        if (result.replaced && entry.generation === generationBefore) {
          this.cancelUiRequests(entry)
          entry.generation += 1
          entry.extensionsBound = false
          this.bindSessionEvents(runtimeId, entry)
          await this.bindSessionExtensions(runtimeId, entry)
          entry.extensionsBound = true
        }
        return {
          runtime: describeRuntime(runtimeId, entry, this.cwd),
          response: result.response,
        }
      }),
      effectiveTimeoutMs,
      `Runtime ${runtimeId} command ${command.type}`,
    )
  }

  async externalSubmit(
    runtimeId: string,
    command: RuntimeExternalSubmitCommand,
    expectedGeneration?: number,
    timeoutMs = this.operationTimeoutMs,
  ): Promise<RuntimeExternalSubmitManagerResult> {
    this.assertActive()
    const effectiveTimeoutMs = requireTimeout(timeoutMs)
    const entry = this.requireEntry(runtimeId)
    return withTimeout(
      this.enqueue(entry, async () => {
        if (entry.disposing) {
          throw new RuntimeManagerError(
            'RUNTIME_NOT_FOUND',
            `Runtime is being disposed: ${runtimeId}`,
          )
        }
        if (
          expectedGeneration !== undefined &&
          entry.generation !== expectedGeneration
        ) {
          throw new RuntimeManagerError(
            'RUNTIME_STALE_GENERATION',
            `Runtime ${runtimeId} is generation ${entry.generation}, not ${expectedGeneration}.`,
          )
        }
        if (!entry.extensionsBound) {
          throw new RuntimeManagerError(
            'RUNTIME_NOT_BOUND',
            `Runtime extensions are not bound: ${runtimeId}`,
          )
        }
        const result = await dispatchExternalSubmit(entry.runtime, command)
        return {
          runtime: describeRuntime(runtimeId, entry, this.cwd),
          acceptedMode: result.acceptedMode,
        }
      }),
      effectiveTimeoutMs,
      `Runtime ${runtimeId} external submit`,
    )
  }

  async reloadRuntime(
    runtimeId: string,
    expectedGeneration?: number,
    timeoutMs = this.operationTimeoutMs,
  ): Promise<RuntimeDescriptor> {
    this.assertActive()
    const effectiveTimeoutMs = requireTimeout(timeoutMs)
    const entry = this.requireEntry(runtimeId)
    return withTimeout(
      this.enqueue(entry, async () => {
        if (entry.disposing) {
          throw new RuntimeManagerError(
            'RUNTIME_NOT_FOUND',
            `Runtime is being disposed: ${runtimeId}`,
          )
        }
        if (
          expectedGeneration !== undefined &&
          entry.generation !== expectedGeneration
        ) {
          throw new RuntimeManagerError(
            'RUNTIME_STALE_GENERATION',
            `Runtime ${runtimeId} is generation ${entry.generation}, not ${expectedGeneration}.`,
          )
        }
        if (!entry.extensionsBound) {
          throw new RuntimeManagerError(
            'RUNTIME_NOT_BOUND',
            `Runtime extensions are not bound: ${runtimeId}`,
          )
        }

        entry.uiBridge.reload()
        await entry.runtime.session.reload({
          // Pi performs this callback after resources and the new extension
          // runner are ready but before `session_start`. Advance identity here
          // so every new extension surface is tagged with the new generation,
          // while early reload failures leave the old Runtime identity intact.
          beforeSessionStart: () => {
            entry.generation += 1
            entry.sequence = 0
          },
        })
        return describeRuntime(runtimeId, entry, this.cwd)
      }),
      effectiveTimeoutMs,
      `Reloading runtime ${runtimeId}`,
    )
  }

  async disposeRuntime(
    runtimeId: string,
    expectedGeneration?: number,
    timeoutMs = this.operationTimeoutMs,
  ): Promise<RuntimeDescriptor | null> {
    const effectiveTimeoutMs = requireTimeout(timeoutMs)
    const entry = this.runtimes.get(runtimeId)
    if (!entry) {
      if (expectedGeneration === undefined) return null
      throw new RuntimeManagerError(
        'RUNTIME_NOT_FOUND',
        `Runtime not found: ${runtimeId}`,
      )
    }
    entry.disposing = true
    try {
      return await withTimeout(
        this.enqueue(entry, async () => {
          if (
            expectedGeneration !== undefined &&
            entry.generation !== expectedGeneration
          ) {
            throw new RuntimeManagerError(
              'RUNTIME_STALE_GENERATION',
              `Runtime ${runtimeId} is generation ${entry.generation}, not ${expectedGeneration}.`,
            )
          }
          const descriptor = describeRuntime(runtimeId, entry, this.cwd)
          this.runtimes.delete(runtimeId)
          entry.unsubscribeSession?.()
          entry.unsubscribeSession = null
          this.cancelUiRequests(entry)
          await entry.runtime.dispose()
          return descriptor
        }),
        effectiveTimeoutMs,
        `Disposing runtime ${runtimeId}`,
      )
    } catch (error) {
      if (this.runtimes.get(runtimeId) === entry) entry.disposing = false
      throw error
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    await Promise.allSettled([...this.pendingCreations])
    const runtimeIds = [...this.runtimes.keys()]
    const results = await Promise.allSettled(
      runtimeIds.map((runtimeId) => this.disposeRuntime(runtimeId)),
    )
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    )
    if (failure) throw failure.reason
    this.eventListeners.clear()
    this.fatalErrorListeners.clear()
    this.uiRequestListeners.clear()
  }

  private assertActive(): void {
    if (this.disposed) {
      throw new RuntimeManagerError(
        'RUNTIME_MANAGER_DISPOSED',
        'Runtime manager has been disposed.',
      )
    }
  }

  private requireEntry(runtimeId: string): RuntimeEntry {
    const entry = this.runtimes.get(runtimeId)
    if (!entry) {
      throw new RuntimeManagerError(
        'RUNTIME_NOT_FOUND',
        `Runtime not found: ${runtimeId}`,
      )
    }
    return entry
  }

  private enqueue<T>(entry: RuntimeEntry, operation: () => Promise<T>): Promise<T> {
    const result = entry.operationTail.then(operation)
    entry.operationTail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  private assertSessionCwd(sessionFile: string): void {
    const sessionManager = SessionManager.open(sessionFile)
    if (comparablePath(sessionManager.getCwd()) === comparablePath(this.cwd)) {
      return
    }
    throw new RuntimeManagerError(
      'RUNTIME_SCOPE_MISMATCH',
      'The Pi session cwd does not match its utility Host cwd.',
    )
  }

  private async bindSessionExtensions(
    runtimeId: string,
    entry: RuntimeEntry,
  ): Promise<void> {
    try {
      await entry.runtime.session.bindExtensions({
        uiContext: entry.uiBridge.uiContext,
        mode: 'rpc',
        commandContextActions: {
          waitForIdle: () => entry.runtime.session.waitForIdle(),
          newSession: (options) => entry.runtime.newSession(options),
          fork: async (entryId, options) => {
            const result = await entry.runtime.fork(entryId, options)
            return { cancelled: result.cancelled }
          },
          navigateTree: async (targetId, options) => {
            const result = await entry.runtime.session.navigateTree(targetId, {
              summarize: options?.summarize,
              customInstructions: options?.customInstructions,
              replaceInstructions: options?.replaceInstructions,
              label: options?.label,
            })
            return { cancelled: result.cancelled }
          },
          switchSession: (sessionPath, options) =>
            entry.runtime.switchSession(sessionPath, options),
          reload: () => entry.runtime.session.reload(),
        },
        abortHandler: () => {
          void entry.runtime.session.abort()
        },
        shutdownHandler: () => {
          const error = new RuntimeManagerError(
            'RUNTIME_EXTENSION_SHUTDOWN_REQUESTED',
            `An extension requested shutdown of Runtime ${runtimeId}.`,
          )
          for (const listener of this.fatalErrorListeners) {
            try { listener(error) } catch { /* isolate utility consumers */ }
          }
        },
        onError: (error) => {
          this.emitRuntimeEvent(runtimeId, entry, {
            type: 'extension_error',
            extensionPath: error.extensionPath,
            event: error.event,
            error: error.error,
          })
        },
      })
    } catch (error) {
      for (const listener of this.fatalErrorListeners) {
        try { listener(error) } catch { /* isolate utility consumers */ }
      }
      throw error
    }
  }

  private cancelUiRequests(entry: RuntimeEntry): void {
    entry.uiBridge.cancelAll()
  }

  private bindSessionEvents(runtimeId: string, entry: RuntimeEntry): void {
    entry.unsubscribeSession?.()
    entry.unsubscribeSession = entry.runtime.session.subscribe(
      (event: AgentSessionEvent) => {
        try {
          this.emitRuntimeEvent(
            runtimeId,
            entry,
            projectRuntimeEvent(event),
          )
        } catch (error) {
          for (const listener of this.fatalErrorListeners) {
            try { listener(error) } catch { /* isolate utility consumers */ }
          }
        }
      },
    )
  }

  private emitRuntimeEvent(
    runtimeId: string,
    entry: RuntimeEntry,
    event: LocalPiRpcEvent,
  ): void {
    if (this.runtimes.get(runtimeId) !== entry || entry.disposing) return
    entry.sequence += 1
    const record: RuntimeEventRecord = {
      runtimeId,
      generation: entry.generation,
      sequence: entry.sequence,
      event,
    }
    for (const listener of this.eventListeners) {
      try { listener(record) } catch { /* isolate utility consumers */ }
    }
  }
}
