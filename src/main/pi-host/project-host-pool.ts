import { realpathSync, statSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { z } from 'zod'
import {
  externalControlAcceptedModeSchema,
  type ExternalControlRequestedMode,
} from '../../shared/external-control-mode'
import {
  localPiRpcResponseSchema,
  type LocalPiExtensionUiResponse,
  type LocalPiRpcCommand,
  type LocalPiRpcResponse,
} from '../../shared/local-pi'
import {
  normalizePiHostError,
  type PiHostCommand,
  type PiHostDto,
  type PiHostError,
  type PiHostEventEnvelope,
  type PiHostUiRequestEventEnvelope,
} from '../../shared/pi-host-protocol'
import {
  PiHostController,
  type PiHostControllerSnapshot,
  type PiHostRequestOptions,
} from './pi-host-controller'

export type ProjectHostScopeKind = 'project' | 'projectless'

export interface ProjectHostScope {
  kind: ProjectHostScopeKind
  /** The selected project directory, or the fixed projectless workspace. */
  cwd: string
}

export type ProjectHostState =
  | 'starting'
  | 'ready'
  | 'crashed'
  | 'stopping'
  | 'stopped'

export type ProjectHostPoolErrorCode =
  | 'POOL_DISPOSED'
  | 'HOST_NOT_FOUND'
  | 'HOST_CRASHED'
  | 'HOST_RECOVERY_FAILED'
  | 'HOST_STOPPED'
  | 'HOST_START_FAILED'
  | 'HOST_SCOPE_INVALID'
  | 'RUNTIME_NOT_FOUND'
  | 'RUNTIME_ALREADY_EXISTS'
  | 'RUNTIME_SESSION_IN_USE'
  | 'RUNTIME_STALE_GENERATION'
  | 'RUNTIME_TARGET_INVALID'
  | 'RUNTIME_RESPONSE_INVALID'

export class ProjectHostPoolError extends Error {
  readonly code: ProjectHostPoolErrorCode
  readonly diagnostic?: PiHostError

  constructor(
    code: ProjectHostPoolErrorCode,
    message: string,
    diagnostic?: PiHostError,
  ) {
    super(message)
    this.name = 'ProjectHostPoolError'
    this.code = code
    this.diagnostic = diagnostic
  }
}

export interface ProjectRuntimeTarget {
  sessionDir?: string
  sessionFile?: string
  forkSessionFile?: string
}

export interface ProjectRuntimeDescriptor {
  runtimeId: string
  generation: number
  cwd: string
  sessionFile: string | null
  sessionId: string
}

export type ProjectRuntimeState = 'starting' | 'ready' | 'crashed' | 'stopping' | 'stopped'

export interface ProjectRuntimeSummary extends ProjectRuntimeDescriptor {
  state: ProjectRuntimeState
  leaseKey: string | null
}

export interface ProjectHostSummary {
  hostKey: string
  scope: ProjectHostScope
  cwd: string
  state: ProjectHostState
  controller: PiHostControllerSnapshot
  runtimes: ProjectRuntimeSummary[]
  error: PiHostError | null
}

export interface ProjectHostPoolSnapshot {
  state: 'ready' | 'stopping' | 'stopped' | 'disposed'
  hosts: ProjectHostSummary[]
}

export interface ProjectHostControllerLike {
  start(): Promise<PiHostControllerSnapshot>
  request(command: PiHostCommand, options?: PiHostRequestOptions): Promise<PiHostDto>
  stop(): Promise<PiHostControllerSnapshot>
  dispose(): Promise<void>
  getSnapshot(): PiHostControllerSnapshot
  subscribe(listener: (snapshot: PiHostControllerSnapshot) => void): () => boolean
  subscribeEvents?(
    listener: (event: PiHostEventEnvelope) => void,
  ): () => boolean
  subscribeUiRequests?(
    listener: (event: PiHostUiRequestEventEnvelope) => void,
  ): () => boolean
  acknowledgeEvent?(
    event: PiHostEventEnvelope | PiHostUiRequestEventEnvelope,
  ): void
}

export interface ProjectHostPoolOptions {
  createHost?: (scope: ProjectHostScope, hostKey: string) => ProjectHostControllerLike
  canonicalizeCwd?: (cwd: string) => string
  createRuntimeId?: () => string
  onHostDiagnostic?: (code: string) => void
}

interface RuntimeEntry {
  descriptor: ProjectRuntimeDescriptor
  state: ProjectRuntimeState
  leaseKey: string | null
}

interface HostEntry {
  hostKey: string
  scope: ProjectHostScope
  cwd: string
  controller: ProjectHostControllerLike
  state: ProjectHostState
  error: PiHostError | null
  runtimes: Map<string, RuntimeEntry>
  ready: Promise<void>
  resolveReady: () => void
  rejectReady: (error: unknown) => void
  detachController: (() => boolean) | null
  detachUiRequests: (() => boolean) | null
  detachEvents: (() => boolean) | null
}

const runtimeDescriptorSchema = z.object({
  runtimeId: z.string().min(1),
  generation: z.number().int().positive(),
  cwd: z.string().min(1),
  sessionFile: z.string().min(1).nullable(),
  sessionId: z.string().min(1),
}).strict()

const runtimeCreateResultSchema = z.object({
  runtime: runtimeDescriptorSchema,
}).strict()

const runtimeBindResultSchema = z.object({
  bound: z.literal(true),
  runtime: runtimeDescriptorSchema,
}).strict()

const runtimeReloadResultSchema = z.object({
  reloaded: z.literal(true),
  runtime: runtimeDescriptorSchema,
}).strict()

const runtimeCommandResultSchema = z.object({
  runtime: runtimeDescriptorSchema,
  rpc: z.unknown(),
}).strict()

const runtimeExternalSubmitResultSchema = z.object({
  runtime: runtimeDescriptorSchema,
  acceptedMode: externalControlAcceptedModeSchema,
}).strict()

const runtimeDisposeResultSchema = z.object({
  disposed: z.literal(true),
  runtime: runtimeDescriptorSchema,
}).strict()

const sessionRenameResultSchema = z.object({
  renamed: z.literal(true),
  sessionFile: z.string().min(1),
  sessionId: z.string().min(1),
  name: z.string().min(1).max(256),
}).strict()

function normalizePath(value: string, name: string): string {
  if (!value || !isAbsolute(value)) {
    throw new ProjectHostPoolError(
      'RUNTIME_TARGET_INVALID',
      `${name} must be a non-empty absolute path.`,
    )
  }
  return resolve(value)
}

function defaultCanonicalizeCwd(value: string): string {
  const candidate = normalizePath(value, 'cwd')
  try {
    const details = statSync(candidate)
    if (!details.isDirectory()) throw new Error('not a directory')
    return realpathSync.native(candidate)
  } catch (error) {
    throw new ProjectHostPoolError(
      'HOST_SCOPE_INVALID',
      `Project Host cwd is not an existing directory: ${candidate}.`,
      normalizePiHostError(error, 'HOST_SCOPE_INVALID'),
    )
  }
}

function canonicalLease(value: string): string {
  const candidate = normalizePath(value, 'sessionFile')
  try {
    return realpathSync.native(candidate)
  } catch {
    // A new Session file is created by Pi after the request. Resolve its
    // intended identity now so two overlapping creates cannot claim it twice.
    return candidate
  }
}

function scopeKey(scope: ProjectHostScope): string {
  return `${scope.kind}:${process.platform === 'win32' ? scope.cwd.toLowerCase() : scope.cwd}`
}

function runtimeSummary(entry: RuntimeEntry): ProjectRuntimeSummary {
  return {
    ...entry.descriptor,
    state: entry.state,
    leaseKey: entry.leaseKey,
  }
}

function hostStateFromController(snapshot: PiHostControllerSnapshot): ProjectHostState {
  switch (snapshot.state) {
    case 'starting': return 'starting'
    case 'ready': return 'ready'
    case 'stopping': return 'stopping'
    case 'failed': return 'crashed'
    case 'disposed': return 'stopped'
    case 'stopped': return 'stopped'
  }
}

function errorFromUnknown(error: unknown, fallbackCode: string): PiHostError {
  return normalizePiHostError(error, fallbackCode)
}

/**
 * Main-owned registry of project-scoped embedded Pi Hosts.
 *
 * The pool deliberately does not expose a caller-provided runtime identity.
 * It allocates opaque IDs, validates every returned Runtime descriptor, and
 * owns the session-file lease map across all project Hosts.
 */
export class ProjectHostPool {
  private readonly createHost: (scope: ProjectHostScope, hostKey: string) => ProjectHostControllerLike
  private readonly canonicalizeCwd: (cwd: string) => string
  private readonly createRuntimeId: () => string
  private readonly onHostDiagnostic: (code: string) => void
  private readonly hosts = new Map<string, HostEntry>()
  private readonly hostRecoveries = new Map<string, Promise<HostEntry>>()
  private readonly runtimeOwners = new Map<string, HostEntry>()
  private readonly sessionLeases = new Map<string, string>()
  private readonly pendingRuntimeOwners = new Map<string, HostEntry>()
  private readonly pendingSessionLeases = new Map<string, string>()
  private readonly listeners = new Set<(snapshot: ProjectHostPoolSnapshot) => void>()
  private readonly uiRequestListeners = new Set<
    (event: PiHostUiRequestEventEnvelope) => void
  >()
  private readonly eventListeners = new Set<
    (event: PiHostEventEnvelope) => void
  >()
  private disposed = false
  private stopping = false

  constructor(options: ProjectHostPoolOptions = {}) {
    this.canonicalizeCwd = options.canonicalizeCwd ?? defaultCanonicalizeCwd
    this.createRuntimeId = options.createRuntimeId ?? (() => `rt_${crypto.randomUUID()}`)
    this.createHost = options.createHost ?? ((scope) => new PiHostController({ cwd: scope.cwd }))
    this.onHostDiagnostic = options.onHostDiagnostic ?? (() => undefined)
  }

  getSnapshot(): ProjectHostPoolSnapshot {
    return structuredClone({
      state: this.disposed
        ? 'disposed'
        : this.stopping
          ? 'stopping'
          : 'ready',
      hosts: [...this.hosts.values()].map((entry) => this.hostSummary(entry)),
    } satisfies ProjectHostPoolSnapshot)
  }

  subscribe(listener: (snapshot: ProjectHostPoolSnapshot) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * Aggregated extension UI requests from every Host, tagged by Runtime
   * identity. Host crash/replacement publishes terminal state through the
   * snapshot channel; Runtime-scoped liveness is owned by the Host.
   */
  subscribeUiRequests(
    listener: (event: PiHostUiRequestEventEnvelope) => void,
  ): () => boolean {
    this.uiRequestListeners.add(listener)
    return () => this.uiRequestListeners.delete(listener)
  }

  /**
   * Aggregated Runtime events from every Host. Events carry hostEpoch,
   * Runtime identity, generation, and sequence; Main consumers apply them
   * and credit the owning controller so the Host can continue streaming.
   */
  subscribeEvents(
    listener: (event: PiHostEventEnvelope) => void,
  ): () => boolean {
    this.eventListeners.add(listener)
    return () => this.eventListeners.delete(listener)
  }

  /**
   * Forwards an event credit to the Host that owns the event's Runtime
   * target. No-op for unknown Hosts; the controller re-validates hostEpoch
   * and Runtime generation.
   */
  acknowledgeEvent(
    event: PiHostEventEnvelope | PiHostUiRequestEventEnvelope,
  ): void {
    const entry = this.runtimeOwners.get(event.runtimeId)
    if (!entry) return
    entry.controller.acknowledgeEvent?.(event)
  }

  /**
   * Forwards a Renderer extension UI answer to the Runtime that owns the
   * dialog. Late or unknown responses are ignored by the Host bridge so a
   * dismissed dialog can never resurface.
   */
  async respondToExtensionUi(
    runtimeId: string,
    response: LocalPiExtensionUiResponse,
    expectedGeneration?: number,
  ): Promise<void> {
    this.assertActive()
    const entry = this.runtimeOwners.get(runtimeId)
    if (!entry) return
    const runtime = entry.runtimes.get(runtimeId)
    if (!runtime) return
    if (
      expectedGeneration !== undefined &&
      runtime.descriptor.generation !== expectedGeneration
    ) {
      return
    }
    await this.requestHost(
      entry,
      { type: 'runtime.extension_ui_response', response },
      {
        runtimeId,
        ...(expectedGeneration === undefined
          ? { runtimeGeneration: runtime.descriptor.generation }
          : { runtimeGeneration: expectedGeneration }),
      },
    )
  }

  listHosts(): ProjectHostSummary[] {
    return this.getSnapshot().hosts
  }

  getHost(scope: ProjectHostScope): ProjectHostSummary | null {
    const canonical = this.canonicalizeCwd(scope.cwd)
    const entry = this.hosts.get(scopeKey({ ...scope, cwd: canonical }))
    return entry ? structuredClone(this.hostSummary(entry)) : null
  }

  async createRuntime(scope: ProjectHostScope, target: ProjectRuntimeTarget): Promise<ProjectRuntimeDescriptor> {
    this.assertActive()
    const normalizedScope = this.normalizeScope(scope)
    const entry = await this.acquireHostForSession(normalizedScope)
    const sessionDir = target.sessionDir === undefined
      ? undefined
      : normalizePath(target.sessionDir, 'sessionDir')
    if (target.sessionFile !== undefined && target.forkSessionFile !== undefined) {
      throw new ProjectHostPoolError(
        'RUNTIME_TARGET_INVALID',
        'Runtime session and fork sources are mutually exclusive.',
      )
    }
    const sessionFile = target.sessionFile === undefined
      ? undefined
      : normalizePath(target.sessionFile, 'sessionFile')
    const forkSessionFile = target.forkSessionFile === undefined
      ? undefined
      : normalizePath(target.forkSessionFile, 'forkSessionFile')
    const requestedLease = sessionFile === undefined ? null : canonicalLease(sessionFile)
    if (requestedLease !== null && this.leaseOwner(requestedLease) !== undefined) {
      throw new ProjectHostPoolError(
        'RUNTIME_SESSION_IN_USE',
        `The Pi session file is already leased: ${requestedLease}.`,
      )
    }

    const runtimeId = this.allocateRuntimeId()
    this.pendingRuntimeOwners.set(runtimeId, entry)
    if (requestedLease !== null) {
      this.pendingSessionLeases.set(requestedLease, runtimeId)
    }
    try {
      const descriptor = await this.requestRuntimeCreate(
        entry,
        runtimeId,
        sessionDir,
        sessionFile,
        forkSessionFile,
      )
      const actualLease = descriptor.sessionFile === null
        ? requestedLease
        : canonicalLease(descriptor.sessionFile)
      const owner = actualLease === null ? undefined : this.leaseOwner(actualLease)
      if (owner !== undefined && owner !== runtimeId) {
        // The utility already created the runtime; dispose it before reporting
        // a lease collision so it cannot continue mutating the shared Session.
        await this.disposeRuntimeOnCollision(entry, descriptor)
        throw new ProjectHostPoolError(
          'RUNTIME_SESSION_IN_USE',
          `The Pi session file is already leased: ${actualLease}.`,
        )
      }

      const runtime: RuntimeEntry = {
        descriptor,
        state: 'starting',
        leaseKey: actualLease,
      }
      entry.runtimes.set(runtimeId, runtime)
      this.runtimeOwners.set(runtimeId, entry)
      if (actualLease !== null) this.sessionLeases.set(actualLease, runtimeId)
      this.publish()
      return structuredClone(descriptor)
    } finally {
      if (this.pendingRuntimeOwners.get(runtimeId) === entry) {
        this.pendingRuntimeOwners.delete(runtimeId)
      }
      if (
        requestedLease !== null &&
        this.pendingSessionLeases.get(requestedLease) === runtimeId
      ) {
        this.pendingSessionLeases.delete(requestedLease)
      }
    }
  }

  async bindRuntime(
    runtimeId: string,
    expectedGeneration?: number,
  ): Promise<ProjectRuntimeDescriptor> {
    this.assertActive()
    const entry = this.runtimeOwners.get(runtimeId)
    if (!entry) {
      throw new ProjectHostPoolError('RUNTIME_NOT_FOUND', `Runtime not found: ${runtimeId}.`)
    }
    const runtime = entry.runtimes.get(runtimeId)
    if (!runtime) {
      throw new ProjectHostPoolError('RUNTIME_NOT_FOUND', `Runtime not found: ${runtimeId}.`)
    }
    if (entry.state === 'crashed') {
      throw new ProjectHostPoolError('HOST_CRASHED', `Project Host crashed for ${entry.cwd}.`, entry.error ?? undefined)
    }
    if (entry.state !== 'ready' || !['starting', 'ready'].includes(runtime.state)) {
      throw new ProjectHostPoolError('HOST_STOPPED', `Runtime ${runtimeId} is ${runtime.state}.`)
    }
    if (expectedGeneration !== undefined && runtime.descriptor.generation !== expectedGeneration) {
      throw new ProjectHostPoolError(
        'RUNTIME_STALE_GENERATION',
        `Runtime ${runtimeId} is generation ${runtime.descriptor.generation}, not ${expectedGeneration}.`,
      )
    }
    if (runtime.state === 'ready') return structuredClone(runtime.descriptor)

    const result = await this.requestHost(entry, { type: 'runtime.bind' }, {
      runtimeId,
      runtimeGeneration: runtime.descriptor.generation,
    })
    const parsed = runtimeBindResultSchema.safeParse(result)
    if (!parsed.success) {
      throw new ProjectHostPoolError(
        'RUNTIME_RESPONSE_INVALID',
        `Runtime ${runtimeId} returned an invalid bind result.`,
        errorFromUnknown(parsed.error, 'RUNTIME_RESPONSE_INVALID'),
      )
    }
    this.updateRuntimeDescriptor(entry, runtimeId, parsed.data.runtime)
    runtime.state = 'ready'
    this.publish()
    return structuredClone(runtime.descriptor)
  }

  async command(
    runtimeId: string,
    command: LocalPiRpcCommand,
    expectedGeneration?: number,
    timeoutMs?: number,
  ): Promise<{ runtime: ProjectRuntimeDescriptor; response: LocalPiRpcResponse }> {
    this.assertActive()
    const entry = this.runtimeOwners.get(runtimeId)
    if (!entry) throw new ProjectHostPoolError('RUNTIME_NOT_FOUND', `Runtime not found: ${runtimeId}.`)
    const runtime = entry.runtimes.get(runtimeId)
    if (!runtime) throw new ProjectHostPoolError('RUNTIME_NOT_FOUND', `Runtime not found: ${runtimeId}.`)
    if (entry.state === 'crashed') {
      throw new ProjectHostPoolError('HOST_CRASHED', `Project Host crashed for ${entry.cwd}.`, entry.error ?? undefined)
    }
    if (entry.state !== 'ready' || runtime.state !== 'ready') {
      throw new ProjectHostPoolError('HOST_STOPPED', `Runtime ${runtimeId} is ${runtime.state}.`)
    }
    if (expectedGeneration !== undefined && runtime.descriptor.generation !== expectedGeneration) {
      throw new ProjectHostPoolError(
        'RUNTIME_STALE_GENERATION',
        `Runtime ${runtimeId} is generation ${runtime.descriptor.generation}, not ${expectedGeneration}.`,
      )
    }

    const pendingLease = command.type === 'switch_session'
      ? canonicalLease(command.sessionPath)
      : null
    if (pendingLease !== null && pendingLease !== runtime.leaseKey) {
      const owner = this.leaseOwner(pendingLease)
      if (owner !== undefined && owner !== runtimeId) {
        throw new ProjectHostPoolError(
          'RUNTIME_SESSION_IN_USE',
          `The Pi session file is already leased: ${pendingLease}.`,
        )
      }
      this.pendingSessionLeases.set(pendingLease, runtimeId)
    }
    try {
      const result = await this.requestHost(entry, {
        type: 'runtime.command',
        rpc: command,
      }, {
        runtimeId,
        runtimeGeneration: runtime.descriptor.generation,
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
      })
      const parsed = runtimeCommandResultSchema.safeParse(result)
      if (!parsed.success) {
        throw new ProjectHostPoolError(
          'RUNTIME_RESPONSE_INVALID',
          `Runtime ${runtimeId} returned an invalid command result.`,
          errorFromUnknown(parsed.error, 'RUNTIME_RESPONSE_INVALID'),
        )
      }
      const response = localPiRpcResponseSchema.safeParse(parsed.data.rpc)
      if (!response.success) {
        throw new ProjectHostPoolError(
          'RUNTIME_RESPONSE_INVALID',
          `Runtime ${runtimeId} returned an invalid RPC response.`,
          errorFromUnknown(response.error, 'RUNTIME_RESPONSE_INVALID'),
        )
      }
      this.updateRuntimeDescriptor(entry, runtimeId, parsed.data.runtime)
      this.publish()
      return {
        runtime: structuredClone(runtime.descriptor),
        response: response.data,
      }
    } finally {
      if (
        pendingLease !== null &&
        this.pendingSessionLeases.get(pendingLease) === runtimeId
      ) {
        this.pendingSessionLeases.delete(pendingLease)
      }
    }
  }

  async externalSubmit(
    runtimeId: string,
    message: string,
    mode: ExternalControlRequestedMode,
    expectedGeneration: number,
    timeoutMs?: number,
  ): Promise<{
    runtime: ProjectRuntimeDescriptor
    acceptedMode: 'prompt' | 'follow_up' | 'steer'
  }> {
    this.assertActive()
    const entry = this.runtimeOwners.get(runtimeId)
    if (!entry) {
      throw new ProjectHostPoolError('RUNTIME_NOT_FOUND', `Runtime not found: ${runtimeId}.`)
    }
    const runtime = entry.runtimes.get(runtimeId)
    if (!runtime) {
      throw new ProjectHostPoolError('RUNTIME_NOT_FOUND', `Runtime not found: ${runtimeId}.`)
    }
    if (entry.state === 'crashed') {
      throw new ProjectHostPoolError(
        'HOST_CRASHED',
        `Project Host crashed for ${entry.cwd}.`,
        entry.error ?? undefined,
      )
    }
    if (entry.state !== 'ready' || runtime.state !== 'ready') {
      throw new ProjectHostPoolError('HOST_STOPPED', `Runtime ${runtimeId} is ${runtime.state}.`)
    }
    if (runtime.descriptor.generation !== expectedGeneration) {
      throw new ProjectHostPoolError(
        'RUNTIME_STALE_GENERATION',
        `Runtime ${runtimeId} is generation ${runtime.descriptor.generation}, not ${expectedGeneration}.`,
      )
    }

    const result = await this.requestHost(entry, {
      type: 'runtime.external_submit',
      message,
      mode,
    }, {
      runtimeId,
      runtimeGeneration: expectedGeneration,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    })
    const parsed = runtimeExternalSubmitResultSchema.safeParse(result)
    if (!parsed.success) {
      throw new ProjectHostPoolError(
        'RUNTIME_RESPONSE_INVALID',
        `Runtime ${runtimeId} returned an invalid external-submit result.`,
        errorFromUnknown(parsed.error, 'RUNTIME_RESPONSE_INVALID'),
      )
    }
    this.updateRuntimeDescriptor(entry, runtimeId, parsed.data.runtime)
    this.publish()
    return {
      runtime: structuredClone(runtime.descriptor),
      acceptedMode: parsed.data.acceptedMode,
    }
  }

  async reloadRuntime(
    runtimeId: string,
    expectedGeneration?: number,
    timeoutMs?: number,
  ): Promise<ProjectRuntimeDescriptor> {
    this.assertActive()
    const entry = this.runtimeOwners.get(runtimeId)
    if (!entry) {
      throw new ProjectHostPoolError('RUNTIME_NOT_FOUND', `Runtime not found: ${runtimeId}.`)
    }
    const runtime = entry.runtimes.get(runtimeId)
    if (!runtime) {
      throw new ProjectHostPoolError('RUNTIME_NOT_FOUND', `Runtime not found: ${runtimeId}.`)
    }
    if (entry.state === 'crashed') {
      throw new ProjectHostPoolError(
        'HOST_CRASHED',
        `Project Host crashed for ${entry.cwd}.`,
        entry.error ?? undefined,
      )
    }
    if (entry.state !== 'ready' || runtime.state !== 'ready') {
      throw new ProjectHostPoolError('HOST_STOPPED', `Runtime ${runtimeId} is ${runtime.state}.`)
    }
    if (
      expectedGeneration !== undefined &&
      runtime.descriptor.generation !== expectedGeneration
    ) {
      throw new ProjectHostPoolError(
        'RUNTIME_STALE_GENERATION',
        `Runtime ${runtimeId} is generation ${runtime.descriptor.generation}, not ${expectedGeneration}.`,
      )
    }

    const result = await this.requestHost(
      entry,
      { type: 'runtime.reload' },
      {
        runtimeId,
        runtimeGeneration: runtime.descriptor.generation,
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
      },
    )
    const parsed = runtimeReloadResultSchema.safeParse(result)
    if (!parsed.success) {
      throw new ProjectHostPoolError(
        'RUNTIME_RESPONSE_INVALID',
        `Runtime ${runtimeId} returned an invalid reload result.`,
        errorFromUnknown(parsed.error, 'RUNTIME_RESPONSE_INVALID'),
      )
    }
    this.updateRuntimeDescriptor(entry, runtimeId, parsed.data.runtime)
    this.publish()
    return structuredClone(runtime.descriptor)
  }

  async renameSession(
    scope: ProjectHostScope,
    sessionFile: string,
    name: string,
  ): Promise<{ sessionId: string; name: string }> {
    this.assertActive()
    const normalizedScope = this.normalizeScope(scope)
    const normalizedFile = normalizePath(sessionFile, 'sessionFile')
    const lease = canonicalLease(normalizedFile)
    const runtimeId = this.leaseOwner(lease)
    if (runtimeId !== undefined) {
      const entry = this.runtimeOwners.get(runtimeId)
      const runtime = entry?.runtimes.get(runtimeId)
      if (!entry || !runtime) {
        throw new ProjectHostPoolError(
          'RUNTIME_NOT_FOUND',
          `Runtime not found: ${runtimeId}.`,
        )
      }
      if (
        entry.scope.kind !== normalizedScope.kind ||
        entry.cwd !== normalizedScope.cwd
      ) {
        throw new ProjectHostPoolError(
          'HOST_SCOPE_INVALID',
          'The Pi session belongs to another Project Host.',
        )
      }
      const result = await this.command(
        runtimeId,
        { type: 'set_session_name', name },
        runtime.descriptor.generation,
      )
      if (!result.response.success) {
        throw new ProjectHostPoolError(
          'RUNTIME_RESPONSE_INVALID',
          result.response.error || 'Pi could not rename the session.',
        )
      }
      return {
        sessionId: result.runtime.sessionId,
        name: name.trim(),
      }
    }

    const entry = this.getOrCreateHost(normalizedScope)
    await entry.ready
    if (entry.state !== 'ready') {
      throw new ProjectHostPoolError(
        entry.state === 'crashed' ? 'HOST_CRASHED' : 'HOST_STOPPED',
        `Project Host is ${entry.state}.`,
        entry.error ?? undefined,
      )
    }
    const result = await this.requestHost(entry, {
      type: 'session.rename',
      sessionFile: normalizedFile,
      name,
    })
    const parsed = sessionRenameResultSchema.safeParse(result)
    if (
      !parsed.success ||
      canonicalLease(parsed.data.sessionFile) !== lease
    ) {
      throw new ProjectHostPoolError(
        'RUNTIME_RESPONSE_INVALID',
        'The Project Host returned an invalid session rename result.',
        parsed.success
          ? undefined
          : errorFromUnknown(parsed.error, 'RUNTIME_RESPONSE_INVALID'),
      )
    }
    return {
      sessionId: parsed.data.sessionId,
      name: parsed.data.name,
    }
  }

  async disposeRuntime(runtimeId: string, expectedGeneration?: number): Promise<ProjectRuntimeDescriptor | null> {
    this.assertActive()
    const entry = this.runtimeOwners.get(runtimeId)
    if (!entry) {
      if (expectedGeneration === undefined) return null
      throw new ProjectHostPoolError('RUNTIME_NOT_FOUND', `Runtime not found: ${runtimeId}.`)
    }
    const runtime = entry.runtimes.get(runtimeId)
    if (!runtime) return null
    if (expectedGeneration !== undefined && runtime.descriptor.generation !== expectedGeneration) {
      throw new ProjectHostPoolError(
        'RUNTIME_STALE_GENERATION',
        `Runtime ${runtimeId} is generation ${runtime.descriptor.generation}, not ${expectedGeneration}.`,
      )
    }
    if (entry.state === 'crashed') {
      const descriptor = structuredClone(runtime.descriptor)
      this.removeRuntime(entry, runtimeId)
      this.publish()
      return descriptor
    }
    runtime.state = 'stopping'
    this.publish()
    try {
      const result = await this.requestHost(entry, {
        type: 'runtime.dispose',
      }, {
        runtimeId,
        runtimeGeneration: runtime.descriptor.generation,
      })
      const parsed = runtimeDisposeResultSchema.safeParse(result)
      if (!parsed.success) {
        throw new ProjectHostPoolError(
          'RUNTIME_RESPONSE_INVALID',
          `Runtime ${runtimeId} returned an invalid dispose result.`,
          errorFromUnknown(parsed.error, 'RUNTIME_RESPONSE_INVALID'),
        )
      }
      const descriptor = structuredClone(runtime.descriptor)
      this.removeRuntime(entry, runtimeId)
      this.publish()
      return descriptor
    } catch (error) {
      if (this.isHostCrashed(entry)) {
        const descriptor = structuredClone(runtime.descriptor)
        this.removeRuntime(entry, runtimeId)
        this.publish()
        return descriptor
      }
      runtime.state = 'ready'
      this.publish()
      throw error
    }
  }

  async stop(scope: ProjectHostScope): Promise<ProjectHostSummary | null> {
    this.assertActive()
    const normalizedScope = this.normalizeScope(scope)
    const entry = this.hosts.get(scopeKey(normalizedScope))
    if (!entry) return null
    if (entry.state === 'stopped') return this.hostSummary(entry)
    await this.stopEntry(entry)
    return this.hostSummary(entry)
  }

  async stopAll(): Promise<ProjectHostPoolSnapshot> {
    this.assertActive()
    this.stopping = true
    this.publish()
    const entries = [...this.hosts.values()]
    await Promise.allSettled(entries.map((entry) => this.stopEntry(entry)))
    this.stopping = false
    this.publish()
    return this.getSnapshot()
  }

  async restart(scope: ProjectHostScope): Promise<ProjectHostSummary> {
    this.assertActive()
    const normalizedScope = this.normalizeScope(scope)
    const key = scopeKey(normalizedScope)
    const current = this.hosts.get(key)
    if (current) await this.stopEntry(current)
    const entry = this.getOrCreateHost(normalizedScope)
    await entry.ready
    return this.hostSummary(entry)
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.stopping = true
    const entries = [...this.hosts.values()]
    await Promise.allSettled(entries.map((entry) => this.stopEntry(entry)))
    for (const entry of entries) {
      entry.detachController?.()
      entry.detachUiRequests?.()
      entry.detachEvents?.()
    }
    this.hosts.clear()
    this.hostRecoveries.clear()
    this.runtimeOwners.clear()
    this.sessionLeases.clear()
    this.pendingRuntimeOwners.clear()
    this.pendingSessionLeases.clear()
    this.listeners.clear()
    this.uiRequestListeners.clear()
    this.eventListeners.clear()
    this.stopping = false
  }

  private normalizeScope(scope: ProjectHostScope): ProjectHostScope {
    if (scope.kind !== 'project' && scope.kind !== 'projectless') {
      throw new ProjectHostPoolError('HOST_SCOPE_INVALID', 'Unknown Project Host scope kind.')
    }
    const cwd = this.canonicalizeCwd(scope.cwd)
    return { kind: scope.kind, cwd }
  }

  private async acquireHostForSession(
    scope: ProjectHostScope,
  ): Promise<HostEntry> {
    const key = scopeKey(scope)
    const activeRecovery = this.hostRecoveries.get(key)
    if (activeRecovery) return activeRecovery

    const existing = this.hosts.get(key)
    if (existing?.state === 'crashed') {
      return this.recoverCrashedHost(scope, existing)
    }

    const entry = this.getOrCreateHost(scope)
    await entry.ready
    if (this.hosts.get(key) !== entry) {
      throw new ProjectHostPoolError(
        'HOST_START_FAILED',
        'Project Host start was superseded.',
      )
    }
    if (entry.state === 'crashed') {
      throw new ProjectHostPoolError(
        'HOST_START_FAILED',
        'Project Host failed to start.',
        entry.error ?? undefined,
      )
    }
    if (entry.state !== 'ready') {
      throw new ProjectHostPoolError(
        'HOST_STOPPED',
        `Project Host is ${entry.state}.`,
      )
    }
    return entry
  }

  private recoverCrashedHost(
    scope: ProjectHostScope,
    crashedEntry: HostEntry,
  ): Promise<HostEntry> {
    const key = crashedEntry.hostKey
    const activeRecovery = this.hostRecoveries.get(key)
    if (activeRecovery) return activeRecovery

    let tracked!: Promise<HostEntry>
    tracked = this.replaceCrashedHost(scope, crashedEntry).finally(() => {
      if (this.hostRecoveries.get(key) === tracked) {
        this.hostRecoveries.delete(key)
      }
    })
    this.hostRecoveries.set(key, tracked)
    return tracked
  }

  private async replaceCrashedHost(
    scope: ProjectHostScope,
    crashedEntry: HostEntry,
  ): Promise<HostEntry> {
    const key = crashedEntry.hostKey
    try {
      const current = this.hosts.get(key)
      if (current !== crashedEntry) {
        if (!current) {
          throw new ProjectHostPoolError(
            'HOST_RECOVERY_FAILED',
            'Project Host recovery was superseded.',
          )
        }
        await current.ready
        if (current.state !== 'ready') {
          throw new ProjectHostPoolError(
            'HOST_RECOVERY_FAILED',
            'Project Host recovery did not become ready.',
            current.error ?? undefined,
          )
        }
        return current
      }

      this.retireCrashedEntry(crashedEntry)
      try {
        await crashedEntry.controller.dispose()
      } catch {
        // The crashed Utility is already the reclamation boundary.
      }
      this.assertActive()
      if (this.stopping) {
        throw new ProjectHostPoolError(
          'HOST_STOPPED',
          'Project Host pool is stopping.',
        )
      }

      const replacement = this.getOrCreateHost(scope)
      await replacement.ready
      if (
        this.hosts.get(key) !== replacement ||
        replacement.state !== 'ready'
      ) {
        throw new ProjectHostPoolError(
          'HOST_RECOVERY_FAILED',
          'Project Host recovery did not become ready.',
          replacement.error ?? undefined,
        )
      }
      return replacement
    } catch (error) {
      if (
        error instanceof ProjectHostPoolError &&
        (error.code === 'POOL_DISPOSED' || error.code === 'HOST_STOPPED')
      ) {
        throw error
      }
      if (
        error instanceof ProjectHostPoolError &&
        error.code === 'HOST_RECOVERY_FAILED'
      ) {
        throw error
      }
      throw new ProjectHostPoolError(
        'HOST_RECOVERY_FAILED',
        'Project Host recovery failed.',
        error instanceof ProjectHostPoolError && error.diagnostic
          ? error.diagnostic
          : errorFromUnknown(error, 'HOST_RECOVERY_FAILED'),
      )
    }
  }

  private retireCrashedEntry(entry: HostEntry): void {
    if (this.hosts.get(entry.hostKey) !== entry) return
    entry.detachController?.()
    entry.detachEvents?.()
    entry.detachUiRequests?.()
    entry.detachController = null
    entry.detachEvents = null
    entry.detachUiRequests = null
    this.hosts.delete(entry.hostKey)
    this.dropRuntimeOwnership(entry)

    const pendingRuntimeIds = new Set<string>()
    for (const [runtimeId, owner] of this.pendingRuntimeOwners) {
      if (owner !== entry) continue
      pendingRuntimeIds.add(runtimeId)
      this.pendingRuntimeOwners.delete(runtimeId)
    }
    for (const [leaseKey, runtimeId] of this.pendingSessionLeases) {
      if (pendingRuntimeIds.has(runtimeId)) {
        this.pendingSessionLeases.delete(leaseKey)
      }
    }
    entry.runtimes.clear()
    this.publish()
  }

  private getOrCreateHost(scope: ProjectHostScope): HostEntry {
    const key = scopeKey(scope)
    const existing = this.hosts.get(key)
    if (existing) {
      if (existing.state === 'crashed') {
        throw new ProjectHostPoolError('HOST_CRASHED', `Project Host crashed for ${scope.cwd}.`, existing.error ?? undefined)
      }
      if (existing.state === 'stopped') {
        this.hosts.delete(key)
      } else {
        return existing
      }
    }
    let controller: ProjectHostControllerLike
    try {
      controller = this.createHost(scope, key)
    } catch (error) {
      throw new ProjectHostPoolError(
        'HOST_START_FAILED',
        `Project Host could not be allocated for ${scope.cwd}.`,
        errorFromUnknown(error, 'HOST_START_FAILED'),
      )
    }
    let resolveReady!: () => void
    let rejectReady!: (error: unknown) => void
    const ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve
      rejectReady = reject
    })
    // Avoid an unhandled rejection when lifecycle shutdown races the caller
    // that is awaiting this Host. The original waiter still receives the error.
    void ready.catch(() => undefined)
    const entry: HostEntry = {
      hostKey: key,
      scope,
      cwd: scope.cwd,
      controller,
      state: 'starting',
      error: null,
      runtimes: new Map(),
      ready,
      resolveReady,
      rejectReady,
      detachController: null,
      detachUiRequests: null,
      detachEvents: null,
    }
    entry.detachController = controller.subscribe((snapshot) => this.handleControllerSnapshot(entry, snapshot))
    entry.detachUiRequests = controller.subscribeUiRequests?.((event) => {
      for (const listener of this.uiRequestListeners) {
        try { listener(event) } catch { /* isolate Main consumers */ }
      }
    }) ?? null
    entry.detachEvents = controller.subscribeEvents?.((event) => {
      for (const listener of this.eventListeners) {
        try { listener(event) } catch { /* isolate Main consumers */ }
      }
    }) ?? null
    this.hosts.set(key, entry)
    this.startHost(entry)
    this.publish()
    return entry
  }

  private startHost(entry: HostEntry): void {
    if (this.disposed || entry.state !== 'starting') return
    this.publish()
    void Promise.resolve().then(() => entry.controller.start()).then((snapshot) => {
      if (this.hosts.get(entry.hostKey) !== entry || this.disposed) return
      this.handleControllerSnapshot(entry, snapshot)
      if (entry.state === 'ready') entry.resolveReady()
      else entry.rejectReady(new ProjectHostPoolError('HOST_START_FAILED', `Project Host did not become ready for ${entry.cwd}.`, entry.error ?? undefined))
    }).catch((error: unknown) => {
      if (this.hosts.get(entry.hostKey) !== entry) return
      const firstCrash = entry.state !== 'crashed'
      entry.state = 'crashed'
      if (firstCrash) {
        entry.error = errorFromUnknown(error, 'HOST_START_FAILED')
      }
      this.markRuntimesCrashed(entry)
      entry.rejectReady(new ProjectHostPoolError('HOST_START_FAILED', `Project Host failed to start for ${entry.cwd}.`, entry.error ?? undefined))
      if (firstCrash) this.recordHostDiagnostic(entry.error)
      this.publish()
    })
  }

  private handleControllerSnapshot(entry: HostEntry, snapshot: PiHostControllerSnapshot): void {
    if (this.hosts.get(entry.hostKey) !== entry) return
    const previousState = entry.state
    const nextState = hostStateFromController(snapshot)
    entry.state = nextState
    entry.error = snapshot.error
    if (nextState === 'crashed') {
      this.markRuntimesCrashed(entry)
      if (previousState !== 'crashed') this.recordHostDiagnostic(entry.error)
    }
    if (nextState === 'stopped') {
      for (const runtime of entry.runtimes.values()) runtime.state = 'stopped'
      this.dropRuntimeOwnership(entry)
    }
    this.publish()
  }

  private markRuntimesCrashed(entry: HostEntry): void {
    for (const runtime of entry.runtimes.values()) runtime.state = 'crashed'
    this.releaseAllRuntimeLeases(entry)
  }

  private recordHostDiagnostic(error: PiHostError | null): void {
    const code = typeof error?.code === 'string' &&
        /^[A-Z][A-Z0-9_]*$/u.test(error.code) &&
        error.code.length <= 64
      ? error.code
      : 'HOST_CRASHED'
    try {
      this.onHostDiagnostic(code)
    } catch {
      // Diagnostics must never interfere with Host lifecycle ownership.
    }
  }

  private releaseAllRuntimeLeases(entry: HostEntry): void {
    for (const runtime of entry.runtimes.values()) {
      if (runtime.leaseKey !== null && this.sessionLeases.get(runtime.leaseKey) === runtime.descriptor.runtimeId) {
        this.sessionLeases.delete(runtime.leaseKey)
      }
    }
  }

  private updateRuntimeDescriptor(entry: HostEntry, runtimeId: string, descriptor: ProjectRuntimeDescriptor): void {
    const runtime = entry.runtimes.get(runtimeId)
    if (!runtime) throw new ProjectHostPoolError('RUNTIME_NOT_FOUND', `Runtime not found: ${runtimeId}.`)
    if (descriptor.runtimeId !== runtimeId || descriptor.cwd !== entry.cwd) {
      throw new ProjectHostPoolError('RUNTIME_RESPONSE_INVALID', `Runtime ${runtimeId} returned an invalid identity.`)
    }
    if (descriptor.generation < runtime.descriptor.generation) {
      throw new ProjectHostPoolError('RUNTIME_STALE_GENERATION', `Runtime ${runtimeId} returned an older generation.`)
    }
    if (descriptor.sessionFile !== null) {
      const nextLease = canonicalLease(descriptor.sessionFile)
      if (runtime.leaseKey !== nextLease) {
        const owner = this.sessionLeases.get(nextLease)
        if (owner !== undefined && owner !== runtimeId) {
          throw new ProjectHostPoolError('RUNTIME_SESSION_IN_USE', `The Pi session file is already leased: ${nextLease}.`)
        }
        if (runtime.leaseKey !== null && this.sessionLeases.get(runtime.leaseKey) === runtimeId) this.sessionLeases.delete(runtime.leaseKey)
        runtime.leaseKey = nextLease
        this.sessionLeases.set(nextLease, runtimeId)
      }
    } else if (runtime.leaseKey !== null) {
      if (this.sessionLeases.get(runtime.leaseKey) === runtimeId) {
        this.sessionLeases.delete(runtime.leaseKey)
      }
      runtime.leaseKey = null
    }
    runtime.descriptor = descriptor
  }

  private async requestRuntimeCreate(
    entry: HostEntry,
    runtimeId: string,
    sessionDir: string | undefined,
    sessionFile?: string,
    forkSessionFile?: string,
  ): Promise<ProjectRuntimeDescriptor> {
    const result = await this.requestHost(entry, {
      type: 'runtime.create',
      runtimeId,
      ...(sessionDir === undefined ? {} : { sessionDir }),
      ...(sessionFile === undefined ? {} : { sessionFile }),
      ...(forkSessionFile === undefined ? {} : { forkSessionFile }),
    })
    if (this.hosts.get(entry.hostKey) !== entry || entry.state !== 'ready') {
      throw new ProjectHostPoolError(
        'HOST_CRASHED',
        'Project Host was replaced while creating a Runtime.',
        entry.error ?? undefined,
      )
    }
    const parsed = runtimeCreateResultSchema.safeParse(result)
    if (!parsed.success) {
      throw new ProjectHostPoolError(
        'RUNTIME_RESPONSE_INVALID',
        `Runtime ${runtimeId} returned an invalid create result.`,
        errorFromUnknown(parsed.error, 'RUNTIME_RESPONSE_INVALID'),
      )
    }
    const descriptor = parsed.data.runtime
    if (descriptor.runtimeId !== runtimeId || descriptor.cwd !== entry.cwd) {
      throw new ProjectHostPoolError('RUNTIME_RESPONSE_INVALID', `Runtime ${runtimeId} returned an invalid identity.`)
    }
    return descriptor
  }

  private async requestHost(
    entry: HostEntry,
    command: PiHostCommand,
    options?: PiHostRequestOptions,
  ): Promise<PiHostDto> {
    try {
      return await entry.controller.request(command, options)
    } catch (error) {
      if (
        this.hosts.get(entry.hostKey) !== entry ||
        entry.state === 'crashed'
      ) {
        throw new ProjectHostPoolError(
          'HOST_CRASHED',
          'Project Host crashed while processing a Runtime operation.',
          entry.error ?? errorFromUnknown(error, 'HOST_CRASHED'),
        )
      }
      throw error
    }
  }

  private async disposeRuntimeOnCollision(entry: HostEntry, descriptor: ProjectRuntimeDescriptor): Promise<void> {
    try {
      await this.requestHost(entry, { type: 'runtime.dispose' }, {
        runtimeId: descriptor.runtimeId,
        runtimeGeneration: descriptor.generation,
      })
    } catch {
      // Host crash cleanup is authoritative; do not hide the lease collision.
    }
  }

  private removeRuntime(entry: HostEntry, runtimeId: string): void {
    const runtime = entry.runtimes.get(runtimeId)
    if (!runtime) return
    if (runtime.leaseKey !== null && this.sessionLeases.get(runtime.leaseKey) === runtimeId) this.sessionLeases.delete(runtime.leaseKey)
    entry.runtimes.delete(runtimeId)
    this.runtimeOwners.delete(runtimeId)
  }

  private allocateRuntimeId(): string {
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const value = this.createRuntimeId()
      if (
        value &&
        !this.runtimeOwners.has(value) &&
        !this.pendingRuntimeOwners.has(value)
      ) {
        return value
      }
    }
    throw new ProjectHostPoolError('RUNTIME_ALREADY_EXISTS', 'Could not allocate a unique Runtime identity.')
  }

  private async stopEntry(entry: HostEntry): Promise<void> {
    if (entry.state === 'stopped') return
    entry.state = 'stopping'
    for (const runtime of entry.runtimes.values()) runtime.state = 'stopping'
    this.publish()
    try {
      await entry.controller.stop()
    } catch (error) {
      entry.error = errorFromUnknown(error, 'HOST_STOP_FAILED')
    } finally {
      try { await entry.controller.dispose() } catch { /* continue clearing ownership */ }
      this.dropRuntimeOwnership(entry)
      for (const runtime of entry.runtimes.values()) runtime.state = 'stopped'
      entry.state = 'stopped'
      entry.detachController?.()
      entry.detachEvents?.()
      entry.detachUiRequests?.()
      entry.detachController = null
      entry.detachUiRequests = null
      entry.detachEvents = null
      entry.rejectReady(new ProjectHostPoolError('HOST_STOPPED', 'Project Host was stopped.'))
      this.publish()
    }
  }

  private leaseOwner(leaseKey: string): string | undefined {
    return this.sessionLeases.get(leaseKey) ??
      this.pendingSessionLeases.get(leaseKey)
  }

  private dropRuntimeOwnership(entry: HostEntry): void {
    this.releaseAllRuntimeLeases(entry)
    for (const runtimeId of entry.runtimes.keys()) {
      this.runtimeOwners.delete(runtimeId)
    }
  }

  private isHostCrashed(entry: HostEntry): boolean {
    return entry.state === 'crashed'
  }

  private hostSummary(entry: HostEntry): ProjectHostSummary {
    return {
      hostKey: entry.hostKey,
      scope: structuredClone(entry.scope),
      cwd: entry.cwd,
      state: entry.state,
      controller: entry.controller.getSnapshot(),
      runtimes: [...entry.runtimes.values()].map(runtimeSummary),
      error: entry.error,
    }
  }

  private publish(): void {
    const snapshot = this.getSnapshot()
    for (const listener of this.listeners) {
      try { listener(snapshot) } catch { /* isolate Main consumers */ }
    }
  }

  private assertActive(): void {
    if (this.disposed) throw new ProjectHostPoolError('POOL_DISPOSED', 'Project Host pool is disposed.')
  }
}
