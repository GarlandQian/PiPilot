import { realpathSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ExternalControlRequestedMode } from '../../shared/external-control-mode'
import {
  localPiRuntimeSnapshotSchema,
  localPiSessionStateSchema,
  type LocalPiExtensionUiResponse,
  type LocalPiRendererRpcCommand,
  type LocalPiRpcEvent,
  type LocalPiRpcResponse,
  type LocalPiRuntimeSnapshot,
  type LocalPiSessionState,
} from '../../shared/local-pi'
import { parsePiHostEventPayload } from '../../shared/pi-host-messages'
import type { ConversationScope } from '../../shared/conversation-scope'
import type {
  PiHostEventEnvelope,
  PiHostUiRequestEventEnvelope,
} from '../../shared/pi-host-protocol'
import type { ConversationScopeResolver } from '../conversations/conversation-scope-resolver'
import {
  ProjectHostPool,
  ProjectHostPoolError,
  type ProjectHostPoolSnapshot,
  type ProjectHostScope,
  type ProjectRuntimeDescriptor,
} from './project-host-pool'

export type PiRuntimeFrontendErrorCode =
  | 'PI_RUNTIME_DISPOSED'
  | 'PI_RUNTIME_INACTIVE'
  | 'PI_RUNTIME_STALE_GENERATION'
  | 'PI_RUNTIME_INVALID_TARGET'
  | 'PI_RUNTIME_CONFIRMATION_FAILED'
  | 'PI_RUNTIME_HOST_RECOVERY_FAILED'
  | 'PI_RUNTIME_OPERATION_FAILED'

export class PiRuntimeFrontendError extends Error {
  constructor(
    readonly code: PiRuntimeFrontendErrorCode,
    message: string,
    readonly recoverable = true,
  ) {
    super(message)
    this.name = 'PiRuntimeFrontendError'
  }
}

export interface PiRuntimeFrontendTarget {
  scope: ConversationScope
  sessionFile?: string
  forkSessionFile?: string
}

type SnapshotListener = (snapshot: LocalPiRuntimeSnapshot) => void
type EventListener = (
  event: LocalPiRpcEvent,
  generation: number,
  runtimeId?: string,
) => void | Promise<void>
type UiListener = (event: PiHostUiRequestEventEnvelope) => void | Promise<void>

export interface PiRuntimeControlHandle {
  hostEpoch: number
  runtimeId: string
  generation: number
  scope: ConversationScope
  sessionFile: string | null
  sessionId: string
}

export interface PiRuntimeControlLease extends PiRuntimeControlHandle {
  readonly leaseId: symbol
}

export interface PiRuntimeControlSummary extends PiRuntimeControlHandle {
  selected: boolean
  lifecycle: 'idle' | 'accepting' | 'running' | 'queued'
  queueCount: number
  activity?: 'prompt' | 'tool' | 'retry' | 'compaction' | 'summarization' | 'interaction'
}

type AllEventListener = (
  event: LocalPiRpcEvent,
  handle: PiRuntimeControlHandle,
) => void | Promise<void>
type AllUiListener = (
  event: PiHostUiRequestEventEnvelope,
  handle: PiRuntimeControlHandle,
) => void | Promise<void>
type ControlRuntimeListener = (summaries: PiRuntimeControlSummary[]) => void

export interface PiRuntimeSelectionIdentity {
  runtimeId: string
  generation: number
  selectionRevision: number
  scope: ConversationScope
  sessionFile: string | null
  sessionId: string | null
}

interface ActiveRuntime {
  runtimeId: string
  hostScope: ProjectHostScope
  scope: ConversationScope
  descriptor: ProjectRuntimeDescriptor
  snapshot: LocalPiRuntimeSnapshot
  lastCredibleSessionFile: string | null
  lastUsedAt: number
  activity: RuntimeActivity
}

interface RuntimeActivity {
  revision: number
  controlPins: number
  pendingCommands: number
  agentRunning: boolean
  compactionRunning: boolean
  retryRunning: boolean
  summarizationRunning: boolean
  queuedMessages: number
  activeToolCalls: Set<string>
  pendingUiRequests: Set<string>
}

export interface PiRuntimeFrontendOptions {
  /**
   * Idle cache size only. Running Runtimes never count toward this value and
   * are never evicted to satisfy it.
   */
  maxRetainedIdleRuntimesPerHost?: number
  now?: () => number
  isPersistedSessionFile?: (sessionFile: string) => boolean
}

const DEFAULT_MAX_RETAINED_IDLE_RUNTIMES_PER_HOST = 4
const BLOCKING_EXTENSION_UI_METHODS = new Set(['select', 'confirm', 'input', 'editor'])

function requireIdleCacheSize(value: number): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError('maxRetainedIdleRuntimesPerHost must be a non-negative integer.')
  }
  return value
}

function defaultIsPersistedSessionFile(sessionFile: string): boolean {
  try {
    return statSync(sessionFile).isFile()
  } catch {
    return false
  }
}

function emptyRuntimeActivity(snapshot?: LocalPiRuntimeSnapshot): RuntimeActivity {
  return {
    revision: 0,
    controlPins: 0,
    pendingCommands: 0,
    agentRunning: snapshot?.sessionState?.isStreaming ?? false,
    compactionRunning: snapshot?.sessionState?.isCompacting ?? false,
    retryRunning: false,
    summarizationRunning: false,
    queuedMessages: snapshot?.sessionState?.pendingMessageCount ?? 0,
    activeToolCalls: new Set(),
    pendingUiRequests: new Set(),
  }
}

function isRuntimeIdle(activity: RuntimeActivity): boolean {
  return activity.controlPins === 0 &&
    activity.pendingCommands === 0 &&
    !activity.agentRunning &&
    !activity.compactionRunning &&
    !activity.retryRunning &&
    !activity.summarizationRunning &&
    activity.queuedMessages === 0 &&
    activity.activeToolCalls.size === 0 &&
    activity.pendingUiRequests.size === 0
}

const stoppedSnapshot = (generation = 0): LocalPiRuntimeSnapshot => ({
  state: 'stopped',
  generation,
  cwd: null,
  sessionFile: null,
  sessionState: null,
  commands: [],
  stderr: '',
  diagnostics: [],
})

function scopeKindFor(scope: ConversationScope): ProjectHostScope['kind'] {
  return scope.kind === 'project' ? 'project' : 'projectless'
}

function pathIdentity(value: string): string {
  const candidate = resolve(value)
  let normalized = candidate
  try {
    normalized = realpathSync.native(candidate)
  } catch {
    // A just-created Pi Session may not have been flushed yet. Its resolved
    // intended path is still the stable lease identity used by the Host pool.
  }
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function sameHostScope(left: ProjectHostScope, right: ProjectHostScope): boolean {
  return left.kind === right.kind && left.cwd === right.cwd
}

function sameConversationScope(
  left: ConversationScope,
  right: ConversationScope,
): boolean {
  return left.kind === right.kind && (
    left.kind === 'projectless' ||
    (right.kind === 'project' && left.workspaceId === right.workspaceId)
  )
}

/**
 * Main-owned primary embedded Pi runtime.
 *
 * Replaces the removed LocalPiRuntimeHost as the single runtime seam for
 * conversation activation, catalog selection, MCP/model configuration, and
 * package integration services. It projects Host/Runtime state into the
 * unchanged shared snapshot shape (the SDK is bundled), forwards Host events
 * with credit, and keeps late/stale generations rejected.
 */
export class PiRuntimeFrontend {
  private disposed = false
  private lifecycle: Promise<void> = Promise.resolve()
  private active: ActiveRuntime | null = null
  private publishedSnapshot = stoppedSnapshot()
  private readonly runtimes = new Map<string, ActiveRuntime>()
  private readonly maxRetainedIdleRuntimesPerHost: number
  private readonly now: () => number
  private readonly isPersistedSessionFile: (sessionFile: string) => boolean
  private readonly pendingIdleReclaims = new Set<string>()
  private readonly inFlightRuntimeCommands = new Map<
    string,
    Map<symbol, number>
  >()
  private readonly controlLeases = new Map<symbol, {
    runtime: ActiveRuntime
    generation: number
  }>()
  private selectionRevision = 0
  private previousSelection: {
    selectedRuntimeId: string
    previousRuntimeId: string | null
    selectionRevision: number
  } | null = null
  /** Non-zero while a session replacement is allowed to transiently remove the active Runtime. */
  private activationDepth = 0
  private readonly snapshotListeners = new Set<SnapshotListener>()
  private readonly eventListeners = new Set<EventListener>()
  private readonly uiListeners = new Set<UiListener>()
  private readonly allEventListeners = new Set<AllEventListener>()
  private readonly allUiListeners = new Set<AllUiListener>()
  private readonly controlRuntimeListeners = new Set<ControlRuntimeListener>()
  private readonly detachEvents: () => boolean
  private readonly detachUiRequests: () => boolean
  private readonly detachHostSnapshots: () => boolean

  constructor(
    private readonly pool: ProjectHostPool,
    private readonly scopeResolver: Pick<ConversationScopeResolver, 'prepare'>,
    options: PiRuntimeFrontendOptions = {},
  ) {
    this.maxRetainedIdleRuntimesPerHost = requireIdleCacheSize(
      options.maxRetainedIdleRuntimesPerHost ??
        DEFAULT_MAX_RETAINED_IDLE_RUNTIMES_PER_HOST,
    )
    this.now = options.now ?? Date.now
    this.isPersistedSessionFile = options.isPersistedSessionFile ??
      defaultIsPersistedSessionFile
    this.detachEvents = pool.subscribeEvents((envelope) => {
      void this.forwardEvent(envelope)
    })
    this.detachUiRequests = pool.subscribeUiRequests((envelope) => {
      void this.forwardUiRequest(envelope)
    })
    this.detachHostSnapshots = pool.subscribe((snapshot) => {
      this.reconcileInactiveRuntimes(snapshot)
      const active = this.active
      if (!active) {
        this.publishControlRuntimes()
        return
      }
      // During replacement the old active Runtime can be intentionally
      // detached while the new one is being bound/hydrated. Do not mistake
      // that short-lived absence for a Host crash and evict the healthy
      // cached sessions in the same Host.
      if (this.activationDepth > 0) {
        return
      }
      const host = snapshot.hosts.find((entry) =>
        entry.scope.kind === active.hostScope.kind &&
        entry.cwd === active.hostScope.cwd,
      )
      const runtime = host?.runtimes.find((entry) => entry.runtimeId === active.runtimeId)
      if ((!host || !runtime || host.state === 'crashed' || runtime.state === 'crashed') && active.snapshot.state !== 'crashed') {
        /*
         * Host crash is the authoritative runtime-failure boundary: the
         * renderer treats a crashed snapshot as the terminal state for
         * every in-flight dialog and conversation of that generation. A
         * crashed primary runtime can never emit live events, so without
         * this synthesized snapshot stale dialogs stay open forever (R5).
         */
        this.dropCachedHost(active.hostScope)
        this.publish({
          ...active.snapshot,
          state: 'crashed',
          diagnostics: [
            ...active.snapshot.diagnostics,
            {
              code: 'PI_RUNTIME_OPERATION_FAILED',
              message: 'The embedded Pi host crashed; this conversation is no longer active.',
              timestamp: Date.now(),
            },
          ].slice(-20),
        })
      }
      this.publishControlRuntimes()
    })
  }

  getSnapshot(): LocalPiRuntimeSnapshot {
    return structuredClone(this.publishedSnapshot)
  }

  getActiveRuntimeIdentity(): PiRuntimeSelectionIdentity | null {
    const active = this.active
    if (!active) return null
    return {
      runtimeId: active.runtimeId,
      generation: active.descriptor.generation,
      selectionRevision: this.selectionRevision,
      scope: structuredClone(active.scope),
      sessionFile: active.descriptor.sessionFile ??
        active.lastCredibleSessionFile,
      sessionId: active.descriptor.sessionId ||
        active.snapshot.sessionState?.sessionId ||
        null,
    }
  }

  /**
   * Returns whether the exact scope/session file is owned by the selected
   * Runtime. This is deliberately Main-only: session deletion must not infer
   * active ownership from renderer navigation or a generation cache that may
   * lag a successful session-changing command.
   */
  isActiveSession(scope: ConversationScope, sessionFile: string): boolean {
    const active = this.active
    if (!active || !sameConversationScope(active.scope, scope)) return false
    const activeSessionFile = active.descriptor.sessionFile ??
      active.lastCredibleSessionFile
    return activeSessionFile !== null &&
      pathIdentity(activeSessionFile) === pathIdentity(sessionFile)
  }

  subscribe(listener: SnapshotListener) {
    this.snapshotListeners.add(listener)
    return () => this.snapshotListeners.delete(listener)
  }

  /** Events of the active primary runtime, projected to the shared DTO shape. */
  subscribeEvents(listener: EventListener) {
    this.eventListeners.add(listener)
    return () => this.eventListeners.delete(listener)
  }

  subscribeUiRequests(listener: UiListener) {
    this.uiListeners.add(listener)
    return () => this.uiListeners.delete(listener)
  }

  /** Main-only observation of every retained Runtime before Host credit. */
  subscribeAllEvents(listener: AllEventListener) {
    this.allEventListeners.add(listener)
    return () => this.allEventListeners.delete(listener)
  }

  /** Main-only extension UI observation for background control operations. */
  subscribeAllUiRequests(listener: AllUiListener) {
    this.allUiListeners.add(listener)
    return () => this.allUiListeners.delete(listener)
  }

  subscribeControlRuntimes(listener: ControlRuntimeListener) {
    this.controlRuntimeListeners.add(listener)
    return () => this.controlRuntimeListeners.delete(listener)
  }

  listControlRuntimes(): PiRuntimeControlSummary[] {
    this.assertNotDisposed()
    return this.collectControlRuntimes()
  }

  private collectControlRuntimes(): PiRuntimeControlSummary[] {
    const summaries: PiRuntimeControlSummary[] = []
    for (const runtime of this.runtimes.values()) {
      try {
        summaries.push({
          ...this.controlHandleFor(runtime),
          selected: runtime.runtimeId === this.active?.runtimeId,
          lifecycle: this.controlLifecycle(runtime),
          queueCount: runtime.activity.queuedMessages,
          ...this.controlActivity(runtime),
        })
      } catch {
        // A Host snapshot can replace a Runtime between observation and this
        // read. The next inventory refresh will publish the replacement.
      }
    }
    return summaries
  }

  /**
   * Acquire and hydrate an exact Runtime without changing Renderer selection.
   * Cold startup shares the same Host and Runtime registry as desktop use.
   */
  acquireControlRuntime(
    target: PiRuntimeFrontendTarget,
  ): Promise<PiRuntimeControlLease> {
    return this.enqueue(async () => {
      this.assertNotDisposed()
      const prepared = await this.prepareTarget(target)
      const cached = this.findCachedRuntime(prepared.scope, prepared.sessionFile)
      if (cached) {
        cached.scope = target.scope
        this.touchActivity(cached)
        return this.pinControlRuntime(cached)
      }

      let runtime: ActiveRuntime | null = null
      try {
        let descriptor = await this.pool.createRuntime(prepared.scope, {
          ...(prepared.sessionFile === undefined
            ? {}
            : { sessionFile: prepared.sessionFile }),
          ...(prepared.forkSessionFile === undefined
            ? {}
            : { forkSessionFile: prepared.forkSessionFile }),
        })
        const startingSnapshot: LocalPiRuntimeSnapshot = {
          state: 'starting',
          generation: descriptor.generation,
          cwd: descriptor.cwd,
          sessionFile: descriptor.sessionFile,
          sessionState: null,
          commands: [],
          stderr: '',
          diagnostics: [],
        }
        runtime = {
          runtimeId: descriptor.runtimeId,
          hostScope: prepared.scope,
          scope: target.scope,
          descriptor,
          snapshot: startingSnapshot,
          lastCredibleSessionFile: descriptor.sessionFile,
          lastUsedAt: this.now(),
          activity: emptyRuntimeActivity(startingSnapshot),
        }
        this.runtimes.set(runtime.runtimeId, runtime)
        const token = this.markCommandStart(runtime, descriptor.generation)
        try {
          descriptor = await this.pool.bindRuntime(
            descriptor.runtimeId,
            descriptor.generation,
          )
          this.setRuntimeDescriptor(runtime, descriptor)
          runtime.snapshot = await this.hydrate(descriptor, prepared)
          runtime.lastCredibleSessionFile = runtime.snapshot.sessionFile
          this.mergeSnapshotActivity(runtime, runtime.snapshot)
          return this.pinControlRuntime(runtime)
        } finally {
          this.markCommandEnd(runtime, token)
        }
      } catch (error) {
        if (runtime) {
          await this.pool.disposeRuntime(
            runtime.runtimeId,
            runtime.descriptor.generation,
          ).catch(() => undefined)
          this.dropCachedRuntime(runtime.runtimeId)
        }
        throw this.toFrontendError(error)
      }
    })
  }

  /** Release one exact acquisition lease. Replays and stale leases are no-ops. */
  releaseControlRuntime(handle: PiRuntimeControlLease): boolean {
    const lease = this.controlLeases.get(handle.leaseId)
    if (!lease) return false
    this.controlLeases.delete(handle.leaseId)

    const runtime = this.runtimes.get(lease.runtime.runtimeId)
    if (
      runtime !== lease.runtime ||
      runtime.descriptor.generation !== lease.generation
    ) {
      return false
    }

    runtime.activity.controlPins = Math.max(
      0,
      runtime.activity.controlPins - 1,
    )
    this.touchActivity(runtime)
    if (runtime.runtimeId !== this.active?.runtimeId && isRuntimeIdle(runtime.activity)) {
      this.scheduleIdleReclaim(runtime.hostScope)
    }
    return true
  }

  async submitControlPrompt(
    handle: PiRuntimeControlHandle,
    message: string,
    mode: ExternalControlRequestedMode,
    timeoutMs?: number,
  ) {
    this.assertNotDisposed()
    const runtime = this.requireControlRuntime(handle)
    const token = this.markCommandStart(runtime, handle.generation)
    try {
      const result = await this.pool.externalSubmit(
        handle.runtimeId,
        message,
        mode,
        handle.generation,
        timeoutMs,
      )
      if (this.runtimes.get(runtime.runtimeId) !== runtime) {
        throw new PiRuntimeFrontendError(
          'PI_RUNTIME_STALE_GENERATION',
          'The controlled Pi runtime was replaced during submission.',
        )
      }
      this.setRuntimeDescriptor(runtime, result.runtime)
      if (result.acceptedMode === 'prompt') {
        runtime.activity.agentRunning = true
      } else {
        runtime.activity.queuedMessages = Math.max(1, runtime.activity.queuedMessages)
      }
      this.touchActivity(runtime)
      return {
        handle: this.controlHandleFor(runtime),
        acceptedMode: result.acceptedMode,
      }
    } catch (error) {
      throw this.toFrontendError(error)
    } finally {
      this.markCommandEnd(runtime, token)
    }
  }

  async getControlRuntimeState(
    handle: PiRuntimeControlHandle,
  ): Promise<LocalPiSessionState> {
    this.assertNotDisposed()
    const runtime = this.requireControlRuntime(handle)
    const token = this.markCommandStart(runtime, handle.generation)
    try {
      const result = await this.pool.command(
        handle.runtimeId,
        { type: 'get_state' },
        handle.generation,
      )
      if (this.runtimes.get(runtime.runtimeId) !== runtime) {
        throw new PiRuntimeFrontendError(
          'PI_RUNTIME_STALE_GENERATION',
          'The controlled Pi runtime was replaced while reading state.',
        )
      }
      this.setRuntimeDescriptor(runtime, result.runtime)
      this.requireControlRuntime(handle)
      const state = this.parseStateResponse(result.response)
      runtime.activity.agentRunning = state.isStreaming
      runtime.activity.compactionRunning = state.isCompacting
      runtime.activity.queuedMessages = state.pendingMessageCount
      this.touchActivity(runtime)
      return structuredClone(state)
    } catch (error) {
      throw this.toFrontendError(error)
    } finally {
      this.markCommandEnd(runtime, token)
    }
  }

  async abortControlRuntime(
    handle: PiRuntimeControlHandle,
    timeoutMs?: number,
  ): Promise<PiRuntimeControlHandle> {
    this.assertNotDisposed()
    const runtime = this.requireControlRuntime(handle)
    const token = this.markCommandStart(runtime, handle.generation)
    try {
      const result = await this.pool.command(
        handle.runtimeId,
        { type: 'abort' },
        handle.generation,
        timeoutMs,
      )
      if (!result.response.success) {
        throw new PiRuntimeFrontendError(
          'PI_RUNTIME_OPERATION_FAILED',
          result.response.error || 'Pi rejected the abort request.',
        )
      }
      this.setRuntimeDescriptor(runtime, result.runtime)
      return this.controlHandleFor(runtime)
    } catch (error) {
      throw this.toFrontendError(error)
    } finally {
      this.markCommandEnd(runtime, token)
    }
  }

  async respondToControlExtensionUi(
    handle: PiRuntimeControlHandle,
    response: LocalPiExtensionUiResponse,
  ): Promise<void> {
    this.assertNotDisposed()
    const runtime = this.requireControlRuntime(handle, true)
    await this.pool.respondToExtensionUi(
      runtime.runtimeId,
      response,
      runtime.descriptor.generation,
    )
    runtime.activity.pendingUiRequests.delete(response.id)
    this.touchActivity(runtime)
  }

  start(target: PiRuntimeFrontendTarget) {
    return this.enqueue(() => this.activate(target))
  }

  replace(target: PiRuntimeFrontendTarget) {
    return this.enqueue(() => this.activate(target))
  }

  rollbackSelection(identity: Pick<
    PiRuntimeSelectionIdentity,
    'generation' | 'runtimeId' | 'selectionRevision'
  >): Promise<boolean> {
    return this.enqueue(async () => {
      const active = this.active
      const current = this.getActiveRuntimeIdentity()
      if (
        !active ||
        !current ||
        current.runtimeId !== identity.runtimeId ||
        current.generation !== identity.generation ||
        current.selectionRevision !== identity.selectionRevision
      ) {
        return false
      }
      const transaction = this.previousSelection
      const previous = transaction &&
        transaction.selectedRuntimeId === active.runtimeId &&
        transaction.selectionRevision === identity.selectionRevision &&
        transaction.previousRuntimeId !== null
        ? this.runtimes.get(transaction.previousRuntimeId) ?? null
        : null
      if (previous && previous.runtimeId !== active.runtimeId) {
        this.active = previous
        this.touchActivity(previous)
        this.publish(previous.snapshot)
      } else if (!previous) {
        this.active = null
        this.publish(stoppedSnapshot(active.descriptor.generation))
      }
      this.previousSelection = null
      return true
    })
  }

  async renameSession(
    scope: ConversationScope,
    sessionFile: string,
    name: string,
  ) {
    const prepared = await this.prepareTarget({ scope, sessionFile })
    return this.pool.renameSession(prepared.scope, sessionFile, name)
  }

  restart() {
    return this.enqueue(async () => {
      this.assertNotDisposed()
      const active = this.active
      if (!active) {
        throw new PiRuntimeFrontendError(
          'PI_RUNTIME_INACTIVE',
          'No Pi runtime is active.',
        )
      }
      return this.activate(
        {
          scope: active.scope,
          ...(active.lastCredibleSessionFile === null
            ? {}
            : { sessionFile: active.lastCredibleSessionFile }),
        },
        { restartHost: true },
      )
    })
  }

  /** Reload package/resources in every retained Runtime for an affected Host set. */
  reloadRuntimes(cwd?: string): Promise<void> {
    return this.enqueue(async () => {
      this.assertNotDisposed()
      const readyRuntimeIds = new Set(this.pool.getSnapshot().hosts
        .filter((host) => host.state === 'ready' && (cwd === undefined || host.cwd === cwd))
        .flatMap((host) => host.runtimes)
        .filter((runtime) => runtime.state === 'ready')
        .map((runtime) => runtime.runtimeId))
      const targets = [...this.runtimes.values()].filter((runtime) =>
        readyRuntimeIds.has(runtime.runtimeId))

      for (const runtime of targets) {
        const baseGeneration = runtime.descriptor.generation
        const commandToken = this.markCommandStart(runtime, baseGeneration)
        let descriptor: ProjectRuntimeDescriptor
        try {
          descriptor = await this.pool.reloadRuntime(
            runtime.runtimeId,
            baseGeneration,
          )
        } catch (error) {
          throw this.toFrontendError(error)
        } finally {
          this.markCommandEnd(runtime, commandToken)
        }

        this.setRuntimeDescriptor(runtime, descriptor)
        runtime.lastCredibleSessionFile = descriptor.sessionFile ??
          runtime.lastCredibleSessionFile
        if (runtime.runtimeId !== this.active?.runtimeId) continue

        runtime.snapshot = {
          ...runtime.snapshot,
          state: 'replacing',
          generation: descriptor.generation,
          cwd: descriptor.cwd,
          sessionFile: descriptor.sessionFile,
        }
        this.publish(runtime.snapshot)
        const hydrated = await this.hydrate(descriptor, {
          scope: runtime.hostScope,
          ...(descriptor.sessionFile === null
            ? {}
            : { sessionFile: descriptor.sessionFile }),
        })
        runtime.snapshot = hydrated
        runtime.lastCredibleSessionFile = hydrated.sessionFile
        this.publish(hydrated)
      }
    })
  }

  stop() {
    return this.enqueue(async () => {
      if (!this.active) {
        const snapshot = stoppedSnapshot(this.publishedSnapshot.generation)
        this.publish(snapshot)
        return snapshot
      }
      const generation = this.active.snapshot.generation
      await this.disposeActive().catch(() => undefined)
      const snapshot = stoppedSnapshot(generation)
      this.publish(snapshot)
      return snapshot
    })
  }

  /**
   * Release a cached Runtime that owns the selected persisted Session.
   *
   * Session deletion can target a conversation that is no longer selected but
   * is still cached inside its project Host. The file must not be moved or
   * unlinked while that Runtime still owns it. Active Sessions are stopped by
   * the activation service first; treating an active match as an error keeps
   * the activation scope and published snapshot from drifting apart.
   */
  releaseSession(sessionFile: string): Promise<boolean> {
    return this.enqueue(async () => {
      this.assertNotDisposed()
      const identity = pathIdentity(sessionFile)
      const matches = [...this.runtimes.values()].filter((runtime) => {
        const cachedSessionFile = runtime.descriptor.sessionFile ??
          runtime.lastCredibleSessionFile
        return cachedSessionFile !== null &&
          pathIdentity(cachedSessionFile) === identity
      })
      if (matches.some((runtime) => runtime.runtimeId === this.active?.runtimeId)) {
        throw new PiRuntimeFrontendError(
          'PI_RUNTIME_OPERATION_FAILED',
          'The active Pi session must be stopped before it can be released.',
          false,
        )
      }

      for (const runtime of matches) {
        try {
          await this.pool.disposeRuntime(
            runtime.runtimeId,
            runtime.descriptor.generation,
          )
        } catch (error) {
          if (
            !(error instanceof ProjectHostPoolError) ||
            error.code !== 'RUNTIME_NOT_FOUND'
          ) {
            throw this.toFrontendError(error)
          }
        }
        this.dropCachedRuntime(runtime.runtimeId)
      }
      return matches.length > 0
    })
  }

  async request(
    command: LocalPiRendererRpcCommand,
    timeoutMs?: number,
  ): Promise<LocalPiRpcResponse> {
    this.assertNotDisposed()
    const runtime = this.requireActive()
    const expectedGeneration = runtime.descriptor.generation
    const commandToken = this.markCommandStart(runtime, expectedGeneration)
    let result: Awaited<ReturnType<ProjectHostPool['command']>>
    try {
      result = await this.pool.command(
        runtime.runtimeId,
        command,
        expectedGeneration,
        timeoutMs,
      )
    } finally {
      this.markCommandEnd(runtime, commandToken)
    }
    const response = result.response
    const cached = this.runtimes.get(runtime.runtimeId)
    if (cached !== runtime) return response
    const runtimeRebound = result.runtime.generation !== expectedGeneration
    if (
      runtime.descriptor.generation !== expectedGeneration &&
      runtime.descriptor.generation !== result.runtime.generation
    ) {
      if (runtimeRebound || this.isSessionChanging(command.type)) {
        throw new PiRuntimeFrontendError(
          'PI_RUNTIME_STALE_GENERATION',
          'The Pi runtime was replaced while the session command completed.',
        )
      }
      return response
    }
    this.setRuntimeDescriptor(runtime, result.runtime)
    if (runtimeRebound || (this.isSessionChanging(command.type) && response.success)) {
      const refreshed = await this.refreshSession(runtime)
      runtime.snapshot = refreshed.snapshot
      this.setRuntimeDescriptor(runtime, refreshed.descriptor)
      runtime.lastCredibleSessionFile = refreshed.snapshot.sessionFile
      if (this.active?.runtimeId === runtime.runtimeId) {
        this.publish(refreshed.snapshot)
      }
    }
    return response
  }

  async respondToExtensionUi(
    response: LocalPiExtensionUiResponse,
    generation: number,
  ): Promise<void> {
    this.assertNotDisposed()
    const active = this.active
    if (!active) {
      throw new PiRuntimeFrontendError(
        'PI_RUNTIME_INACTIVE',
        'No Pi runtime is active.',
      )
    }
    if (generation !== active.descriptor.generation) {
      throw new PiRuntimeFrontendError(
        'PI_RUNTIME_STALE_GENERATION',
        'The extension UI response targets a stale Pi runtime.',
      )
    }
    const commandToken = this.markCommandStart(active, generation)
    try {
      await this.pool.respondToExtensionUi(active.runtimeId, response, generation)
      if (active.descriptor.generation === generation) {
        active.activity.pendingUiRequests.delete(response.id)
        this.touchActivity(active)
      }
    } finally {
      this.markCommandEnd(active, commandToken)
    }
  }

  async getState(): Promise<LocalPiSessionState> {
    const active = this.requireActive()
    const result = await this.pool.command(
      active.runtimeId,
      { type: 'get_state' },
      active.descriptor.generation,
    )
    const parsed = this.parseStateResponse(result.response)
    const current = this.active
    if (current?.runtimeId === active.runtimeId) {
      this.setRuntimeDescriptor(current, result.runtime)
    }
    if (current?.runtimeId === active.runtimeId) {
      current.snapshot = {
        ...current.snapshot,
        sessionState: { ...parsed, sessionFile: parsed.sessionFile ?? current.snapshot.sessionFile ?? undefined },
        sessionFile: parsed.sessionFile ?? current.snapshot.sessionFile ?? null,
      }
      current.lastCredibleSessionFile = current.snapshot.sessionFile
      this.publish(current.snapshot)
    }
    return parsed
  }

  async dispose() {
    if (this.disposed) return
    this.disposed = true
    await this.enqueue(async () => {
      const runtimes = [...this.runtimes.values()]
      this.active = null
      this.runtimes.clear()
      this.pendingIdleReclaims.clear()
      this.inFlightRuntimeCommands.clear()
      this.controlLeases.clear()
      this.previousSelection = null
      await Promise.allSettled(runtimes.map((runtime) =>
        this.pool.disposeRuntime(
          runtime.runtimeId,
          runtime.descriptor.generation,
        ),
      ))
    })
    this.detachEvents()
    this.detachUiRequests()
    this.detachHostSnapshots()
    this.snapshotListeners.clear()
    this.eventListeners.clear()
    this.uiListeners.clear()
    this.allEventListeners.clear()
    this.allUiListeners.clear()
    this.controlRuntimeListeners.clear()
  }

  private isSessionChanging(command: string) {
    return [
      'new_session',
      'switch_session',
      'fork',
      'clone',
      'set_session_name',
      'import_session',
    ].includes(command)
  }

  private async activate(
    target: PiRuntimeFrontendTarget,
    options: { restartHost?: boolean } = {},
    attempt = 0,
  ): Promise<LocalPiRuntimeSnapshot> {
    this.activationDepth += 1
    try {
      return await this.activateAttempt(target, options, attempt)
    } finally {
      this.activationDepth = Math.max(0, this.activationDepth - 1)
    }
  }

  private async activateAttempt(
    target: PiRuntimeFrontendTarget,
    options: { restartHost?: boolean } = {},
    attempt = 0,
  ): Promise<LocalPiRuntimeSnapshot> {
    this.assertNotDisposed()
    const prepared = await this.prepareTarget(target)
    const previous = this.getSnapshot()
    const previousActive = this.active
    if (this.active) {
      this.publish({ ...this.active.snapshot, state: 'replacing' }, false)
    } else {
      this.publish({
        ...stoppedSnapshot(previous.generation),
        state: 'starting',
        cwd: prepared.scope.cwd,
        sessionFile: prepared.sessionFile ?? null,
      })
    }

    let descriptor: ProjectRuntimeDescriptor | null = null
    let selected: ActiveRuntime | null = null
    let createdRuntime = false
    try {
      if (previousActive) {
        if (options.restartHost) {
          this.active = null
          this.dropCachedHost(previousActive.hostScope)
          await this.pool.restart(previousActive.hostScope)
        }
      }
      const cached = options.restartHost
        ? null
        : this.findCachedRuntime(prepared.scope, prepared.sessionFile)
      descriptor = cached?.descriptor ?? await this.pool.createRuntime(prepared.scope, {
        ...(prepared.sessionFile === undefined ? {} : { sessionFile: prepared.sessionFile }),
        ...(prepared.forkSessionFile === undefined ? {} : { forkSessionFile: prepared.forkSessionFile }),
      })
      selected = cached
      if (!selected) {
        createdRuntime = true
        const startingSnapshot: LocalPiRuntimeSnapshot = {
          state: 'starting',
          generation: descriptor.generation,
          cwd: descriptor.cwd,
          sessionFile: descriptor.sessionFile,
          sessionState: null,
          commands: [],
          stderr: '',
          diagnostics: [],
        }
        selected = {
          runtimeId: descriptor.runtimeId,
          hostScope: prepared.scope,
          scope: target.scope,
          descriptor,
          snapshot: startingSnapshot,
          lastCredibleSessionFile: descriptor.sessionFile,
          lastUsedAt: this.now(),
          activity: emptyRuntimeActivity(startingSnapshot),
        }
        this.active = selected
        this.runtimes.set(descriptor.runtimeId, selected)
        this.publish(startingSnapshot)
        descriptor = await this.pool.bindRuntime(
          descriptor.runtimeId,
          descriptor.generation,
        )
        this.setRuntimeDescriptor(selected, descriptor)
      }
      const snapshot = await this.hydrate(descriptor, prepared)
      this.active = selected
      this.active.scope = target.scope
      this.setRuntimeDescriptor(this.active, descriptor)
      this.active.snapshot = snapshot
      this.active.lastCredibleSessionFile = snapshot.sessionFile
      this.active.lastUsedAt = this.now()
      this.mergeSnapshotActivity(this.active, snapshot)
      this.runtimes.set(descriptor.runtimeId, this.active)
      this.publish(snapshot)
      this.selectionRevision += 1
      this.previousSelection = {
        selectedRuntimeId: this.active.runtimeId,
        previousRuntimeId: previousActive?.runtimeId ?? null,
        selectionRevision: this.selectionRevision,
      }
      if (previousActive && previousActive.runtimeId !== this.active.runtimeId) {
        this.scheduleIdleReclaim(previousActive.hostScope)
      }
      return this.getSnapshot()
    } catch (error) {
      const failure = this.toFrontendError(error)
      const failedRuntime = selected
      const shouldDisposeFailedRuntime = Boolean(
        descriptor &&
        failedRuntime &&
        failedRuntime !== previousActive,
      ) || Boolean(descriptor && createdRuntime && !failedRuntime)
      if (descriptor && shouldDisposeFailedRuntime) {
        await this.pool.disposeRuntime(descriptor.runtimeId, descriptor.generation).catch(() => undefined)
        this.dropCachedRuntime(descriptor.runtimeId)
      }

      /*
       * A failed replacement must not destroy the last healthy conversation.
       * This is especially important for a cached Runtime: hydration can race
       * with Host reconciliation, and disposing the cached descriptor here
       * used to leave the renderer with an empty/error screen until a second
       * click happened to recreate it.
       */
      const canRestorePrevious = Boolean(
        previousActive &&
        this.runtimes.get(previousActive.runtimeId) === previousActive,
      )
      if (canRestorePrevious && previousActive) {
        this.active = previousActive
        this.publish(previousActive.snapshot)
      } else {
        this.active = null
        this.publish({
          state: 'error',
          generation: descriptor?.generation ?? previous.generation,
          cwd: prepared.scope.cwd,
          sessionFile: prepared.sessionFile ?? null,
          sessionState: null,
          commands: [],
          stderr: '',
          diagnostics: [{
            code: failure.code,
            message: failure.message,
            timestamp: Date.now(),
          }],
        })
      }

      /*
       * One bounded retry absorbs transient Host/runtime races (stale cached
       * descriptor, a just-finished replacement, or a delayed command
       * catalog). It runs through the same serialized lifecycle, so a real
       * protocol/target error still terminates promptly after two attempts.
       */
      if (
        attempt === 0 &&
        failure.recoverable &&
        (failure.code === 'PI_RUNTIME_CONFIRMATION_FAILED' ||
          failure.code === 'PI_RUNTIME_OPERATION_FAILED' ||
          failure.code === 'PI_RUNTIME_STALE_GENERATION')
      ) {
        return this.activate(target, options, attempt + 1)
      }
      throw failure
    }
  }

  private async forwardUiRequest(envelope: PiHostUiRequestEventEnvelope): Promise<void> {
    const active = this.active
    const activeAccepted = Boolean(active && this.adoptInFlightGeneration(
      active,
      envelope.runtimeId,
      envelope.runtimeGeneration,
    ))
    const tracked = this.runtimes.get(envelope.runtimeId)
    if (
      tracked &&
      tracked.descriptor.generation === envelope.runtimeGeneration
    ) {
      this.applyUiActivity(tracked, envelope)
    }

    const pendingMainConsumers: Promise<void>[] = []
    if (tracked && tracked.descriptor.generation === envelope.runtimeGeneration) {
      const handle = this.controlHandleFor(tracked, true)
      for (const listener of this.allUiListeners) {
        try {
          pendingMainConsumers.push(Promise.resolve(listener(envelope, handle)))
        } catch {
          // Isolate Main consumers while still returning bounded Host credit.
        }
      }
    }
    if (pendingMainConsumers.length > 0) {
      await Promise.allSettled(pendingMainConsumers)
    }

    const consumedByMain = Boolean(
      tracked &&
      tracked.descriptor.generation === envelope.runtimeGeneration &&
      BLOCKING_EXTENSION_UI_METHODS.has(envelope.request.method) &&
      !tracked.activity.pendingUiRequests.has(envelope.request.id),
    )
    const pendingSelectedConsumers: Promise<void>[] = []
    if (activeAccepted && !consumedByMain) {
      for (const listener of this.uiListeners) {
        try {
          pendingSelectedConsumers.push(Promise.resolve(listener(envelope)))
        } catch {
          // Isolate Main consumers while still returning bounded Host credit.
        }
      }
    }
    if (pendingSelectedConsumers.length > 0) {
      await Promise.allSettled(pendingSelectedConsumers)
    }
    this.pool.acknowledgeEvent(envelope)
  }

  private async forwardEvent(envelope: PiHostEventEnvelope): Promise<void> {
    const event = parsePiHostEventPayload(envelope.event)
    if (!event) {
      this.pool.acknowledgeEvent(envelope)
      return
    }
    const active = this.active
    const activeAccepted = Boolean(active && this.adoptInFlightGeneration(
      active,
      envelope.runtimeId,
      envelope.runtimeGeneration,
    ))
    const tracked = this.runtimes.get(envelope.runtimeId)
    if (
      tracked &&
      tracked.descriptor.generation === envelope.runtimeGeneration
    ) {
      this.applyRuntimeActivityEvent(tracked, event)
    }

    const pending: Promise<void>[] = []
    if (tracked && tracked.descriptor.generation === envelope.runtimeGeneration) {
      const handle = this.controlHandleFor(tracked, true)
      for (const listener of this.allEventListeners) {
        try {
          pending.push(Promise.resolve(listener(event, handle)))
        } catch {
          // Isolate Main consumers while still returning bounded Host credit.
        }
      }
    }
    if (activeAccepted) {
      for (const listener of this.eventListeners) {
        try {
          pending.push(Promise.resolve(listener(
            event,
            envelope.runtimeGeneration,
            envelope.runtimeId,
          )))
        } catch {
          // Isolate Main consumers while still returning bounded Host credit.
        }
      }
    }
    if (pending.length > 0) await Promise.allSettled(pending)
    this.pool.acknowledgeEvent(envelope)
  }

  private adoptInFlightGeneration(
    active: ActiveRuntime,
    runtimeId: string,
    generation: number,
  ): boolean {
    if (runtimeId !== active.runtimeId) return false
    if (generation === active.descriptor.generation) return true
    const pending = this.inFlightRuntimeCommands.get(runtimeId)
    if (
      !pending ||
      ![...pending.values()].some((baseGeneration) =>
        generation > baseGeneration) ||
      generation < active.descriptor.generation
    ) {
      return false
    }
    this.setRuntimeDescriptor(active, {
      ...active.descriptor,
      generation,
    })
    active.snapshot = {
      ...active.snapshot,
      state: 'replacing',
      generation,
    }
    this.publish(active.snapshot)
    return true
  }

  private touchActivity(runtime: ActiveRuntime): void {
    runtime.activity.revision += 1
    runtime.lastUsedAt = this.now()
  }

  private pinControlRuntime(runtime: ActiveRuntime): PiRuntimeControlLease {
    const handle = this.controlHandleFor(runtime)
    const leaseId = Symbol(runtime.runtimeId)
    this.controlLeases.set(leaseId, {
      runtime,
      generation: runtime.descriptor.generation,
    })
    runtime.activity.controlPins += 1
    this.touchActivity(runtime)
    return { ...handle, leaseId }
  }

  private setRuntimeDescriptor(
    runtime: ActiveRuntime,
    descriptor: ProjectRuntimeDescriptor,
  ): void {
    const generationChanged =
      runtime.descriptor.generation !== descriptor.generation
    if (generationChanged) {
      this.clearControlLeases(runtime)
    }
    runtime.descriptor = descriptor
    if (!generationChanged) return

    this.touchActivity(runtime)
    if (runtime.runtimeId !== this.active?.runtimeId && isRuntimeIdle(runtime.activity)) {
      this.scheduleIdleReclaim(runtime.hostScope)
    }
  }

  private clearControlLeases(runtime: ActiveRuntime): void {
    for (const [leaseId, lease] of this.controlLeases) {
      if (lease.runtime === runtime) {
        this.controlLeases.delete(leaseId)
      }
    }
    runtime.activity.controlPins = 0
  }

  private markCommandStart(
    runtime: ActiveRuntime,
    baseGeneration = runtime.descriptor.generation,
  ): symbol {
    const token = Symbol(runtime.runtimeId)
    const commands = this.inFlightRuntimeCommands.get(runtime.runtimeId) ??
      new Map<symbol, number>()
    commands.set(token, baseGeneration)
    this.inFlightRuntimeCommands.set(runtime.runtimeId, commands)
    runtime.activity.pendingCommands += 1
    this.touchActivity(runtime)
    return token
  }

  private markCommandEnd(runtime: ActiveRuntime, token?: symbol): void {
    if (token) {
      const commands = this.inFlightRuntimeCommands.get(runtime.runtimeId)
      commands?.delete(token)
      if (commands?.size === 0) {
        this.inFlightRuntimeCommands.delete(runtime.runtimeId)
      }
    }
    runtime.activity.pendingCommands = Math.max(
      0,
      runtime.activity.pendingCommands - 1,
    )
    this.touchActivity(runtime)
    if (runtime.runtimeId !== this.active?.runtimeId && isRuntimeIdle(runtime.activity)) {
      this.scheduleIdleReclaim(runtime.hostScope)
    }
  }

  private mergeSnapshotActivity(
    runtime: ActiveRuntime,
    snapshot: LocalPiRuntimeSnapshot,
  ): void {
    const state = snapshot.sessionState
    if (state) {
      runtime.activity.agentRunning = state.isStreaming
      runtime.activity.compactionRunning = state.isCompacting
      runtime.activity.queuedMessages = state.pendingMessageCount
    }
    this.touchActivity(runtime)
  }

  private applyRuntimeActivityEvent(
    runtime: ActiveRuntime,
    event: LocalPiRpcEvent,
  ): void {
    switch (event.type) {
      case 'agent_start':
      case 'turn_start':
        runtime.activity.agentRunning = true
        break
      case 'agent_end':
        if (event.willRetry) runtime.activity.retryRunning = true
        break
      case 'agent_settled':
        runtime.activity.agentRunning = false
        runtime.activity.activeToolCalls.clear()
        break
      case 'tool_execution_start':
      case 'tool_execution_update':
        runtime.activity.activeToolCalls.add(event.toolCallId)
        break
      case 'tool_execution_end':
        runtime.activity.activeToolCalls.delete(event.toolCallId)
        break
      case 'queue_update':
        runtime.activity.queuedMessages =
          event.steering.length + event.followUp.length
        break
      case 'compaction_start':
        runtime.activity.compactionRunning = true
        break
      case 'compaction_end':
        runtime.activity.compactionRunning = false
        if (event.willRetry) runtime.activity.retryRunning = true
        break
      case 'auto_retry_start':
        runtime.activity.retryRunning = true
        break
      case 'auto_retry_end':
        runtime.activity.retryRunning = false
        break
      case 'summarization_retry_scheduled':
      case 'summarization_retry_attempt_start':
        runtime.activity.summarizationRunning = true
        break
      case 'summarization_retry_finished':
        runtime.activity.summarizationRunning = false
        break
      default:
        break
    }
    this.touchActivity(runtime)
    if (runtime.runtimeId !== this.active?.runtimeId && isRuntimeIdle(runtime.activity)) {
      this.scheduleIdleReclaim(runtime.hostScope)
    }
  }

  private applyUiActivity(
    runtime: ActiveRuntime,
    envelope: PiHostUiRequestEventEnvelope,
  ): void {
    const request = envelope.request
    if (request.method === 'dismiss') {
      runtime.activity.pendingUiRequests.delete(request.id)
    } else if (BLOCKING_EXTENSION_UI_METHODS.has(request.method)) {
      runtime.activity.pendingUiRequests.add(request.id)
    }
    this.touchActivity(runtime)
    if (runtime.runtimeId !== this.active?.runtimeId && isRuntimeIdle(runtime.activity)) {
      this.scheduleIdleReclaim(runtime.hostScope)
    }
  }

  private scheduleIdleReclaim(scope: ProjectHostScope): void {
    const key = `${scope.kind}:${scope.cwd}`
    if (this.disposed || this.pendingIdleReclaims.has(key)) return
    this.pendingIdleReclaims.add(key)
    queueMicrotask(() => {
      void this.enqueue(async () => {
        this.pendingIdleReclaims.delete(key)
        if (this.disposed) return
        await this.reclaimIdleRuntimeCache(scope)
      })
    })
  }

  private async reclaimIdleRuntimeCache(scope: ProjectHostScope): Promise<void> {
    const candidates = [...this.runtimes.values()]
      .filter((runtime) => {
        if (
          runtime.runtimeId === this.active?.runtimeId ||
          !sameHostScope(runtime.hostScope, scope) ||
          !isRuntimeIdle(runtime.activity)
        ) {
          return false
        }
        const sessionFile = runtime.descriptor.sessionFile ??
          runtime.lastCredibleSessionFile
        return sessionFile !== null && this.isPersistedSessionFile(sessionFile)
      })
      .sort((left, right) => left.lastUsedAt - right.lastUsedAt)

    let remainingToReclaim = Math.max(
      0,
      candidates.length - this.maxRetainedIdleRuntimesPerHost,
    )
    for (const candidate of candidates) {
      if (remainingToReclaim === 0) break
      if (await this.reclaimRuntimeIfStillIdle(candidate)) {
        remainingToReclaim -= 1
      }
    }
  }

  private async reclaimRuntimeIfStillIdle(
    candidate: ActiveRuntime,
  ): Promise<boolean> {
    const current = this.runtimes.get(candidate.runtimeId)
    if (
      current !== candidate ||
      current.runtimeId === this.active?.runtimeId ||
      !isRuntimeIdle(current.activity)
    ) {
      return false
    }
    const sessionFile = current.descriptor.sessionFile ??
      current.lastCredibleSessionFile
    if (sessionFile === null || !this.isPersistedSessionFile(sessionFile)) {
      return false
    }

    const activityRevision = current.activity.revision
    const generation = current.descriptor.generation
    try {
      const result = await this.pool.command(
        current.runtimeId,
        { type: 'get_state' },
        generation,
      )
      if (!result.response.success || result.response.command !== 'get_state') {
        return false
      }
      const parsed = localPiSessionStateSchema.safeParse(result.response.data)
      const latest = this.runtimes.get(current.runtimeId)
      if (
        !parsed.success ||
        latest !== current ||
        current.runtimeId === this.active?.runtimeId ||
        current.descriptor.generation !== generation ||
        result.runtime.generation !== generation ||
        current.activity.revision !== activityRevision ||
        !isRuntimeIdle(current.activity) ||
        parsed.data.isStreaming ||
        parsed.data.isCompacting ||
        parsed.data.pendingMessageCount > 0
      ) {
        return false
      }
      const confirmedSessionFile = result.runtime.sessionFile ??
        parsed.data.sessionFile ?? sessionFile
      if (!this.isPersistedSessionFile(confirmedSessionFile)) return false

      await this.pool.disposeRuntime(current.runtimeId, generation)
      if (this.runtimes.get(current.runtimeId) === current) {
        this.dropCachedRuntime(current.runtimeId)
      }
      return true
    } catch {
      // Automatic reclamation is best-effort. A failed revalidation must keep
      // the Runtime rather than turn cache cleanup into a user-visible error.
      return false
    }
  }

  private parseStateResponse(response: LocalPiRpcResponse): LocalPiSessionState {
    if (!response.success) {
      throw new PiRuntimeFrontendError(
        'PI_RUNTIME_CONFIRMATION_FAILED',
        response.error || 'Pi did not return its session state.',
      )
    }
    const parsed = localPiSessionStateSchema.safeParse(response.data)
    if (!parsed.success) {
      throw new PiRuntimeFrontendError(
        'PI_RUNTIME_CONFIRMATION_FAILED',
        'Pi returned an invalid session state.',
      )
    }
    return parsed.data
  }

  private async hydrate(
    descriptor: ProjectRuntimeDescriptor,
    _prepared: { scope: ProjectHostScope; sessionFile?: string; forkSessionFile?: string },
  ): Promise<LocalPiRuntimeSnapshot> {
    const [stateResult, commandsResult] = await Promise.all([
      this.pool.command(descriptor.runtimeId, { type: 'get_state' }, descriptor.generation),
      this.pool.command(descriptor.runtimeId, { type: 'get_commands' }, descriptor.generation),
    ])
    const state = this.parseStateResponse(stateResult.response)
    if (!commandsResult.response.success) {
      throw new PiRuntimeFrontendError(
        'PI_RUNTIME_CONFIRMATION_FAILED',
        commandsResult.response.error || 'Pi did not return its command catalog.',
      )
    }
    const commandsData = commandsResult.response.data as { commands?: unknown } | undefined
    const snapshot = localPiRuntimeSnapshotSchema.safeParse({
      state: 'ready',
      generation: descriptor.generation,
      cwd: descriptor.cwd,
      sessionFile: descriptor.sessionFile ?? state.sessionFile ?? null,
      sessionState: {
        ...state,
        ...(descriptor.sessionFile ?? state.sessionFile
          ? { sessionFile: descriptor.sessionFile ?? state.sessionFile }
          : {}),
      },
      commands: Array.isArray(commandsData?.commands) ? commandsData.commands : [],
      stderr: '',
      diagnostics: [],
    })
    if (!snapshot.success) {
      throw new PiRuntimeFrontendError(
        'PI_RUNTIME_CONFIRMATION_FAILED',
        'Pi returned an invalid runtime snapshot.',
      )
    }
    return snapshot.data
  }

  private async refreshSession(active: ActiveRuntime) {
    const result = await this.pool.command(
      active.runtimeId,
      { type: 'get_state' },
      active.descriptor.generation,
    )
    const state = this.parseStateResponse(result.response)
    const descriptor = result.runtime
    const parsed = localPiRuntimeSnapshotSchema.safeParse({
      ...active.snapshot,
      state: 'ready',
      generation: descriptor.generation,
      sessionFile: descriptor.sessionFile ?? state.sessionFile ?? null,
      sessionState: {
        ...state,
        ...(descriptor.sessionFile ?? state.sessionFile
          ? { sessionFile: descriptor.sessionFile ?? state.sessionFile }
          : {}),
      },
    })
    if (!parsed.success) {
      throw new PiRuntimeFrontendError(
        'PI_RUNTIME_CONFIRMATION_FAILED',
        'Pi changed the session but did not confirm its new state.',
      )
    }
    return { descriptor, snapshot: parsed.data }
  }

  private async prepareTarget(target: PiRuntimeFrontendTarget) {
    if (target.sessionFile !== undefined && target.forkSessionFile !== undefined) {
      throw new PiRuntimeFrontendError(
        'PI_RUNTIME_INVALID_TARGET',
        'Pi session and fork sources are mutually exclusive.',
        false,
      )
    }
    const resolved = await this.scopeResolver.prepare(target.scope)
    return {
      scope: {
        kind: scopeKindFor(target.scope),
        cwd: resolved.cwd,
      } satisfies ProjectHostScope,
      ...(target.sessionFile === undefined ? {} : { sessionFile: target.sessionFile }),
      ...(target.forkSessionFile === undefined ? {} : { forkSessionFile: target.forkSessionFile }),
    }
  }

  private controlHandleFor(
    runtime: ActiveRuntime,
    allowStarting = false,
  ): PiRuntimeControlHandle {
    const host = this.pool.getSnapshot().hosts.find((entry) =>
      entry.scope.kind === runtime.hostScope.kind &&
      entry.cwd === runtime.hostScope.cwd,
    )
    const summary = host?.runtimes.find((entry) =>
      entry.runtimeId === runtime.runtimeId,
    )
    if (
      !host ||
      host.state !== 'ready' ||
      !summary ||
      (summary.state !== 'ready' && !(allowStarting && summary.state === 'starting')) ||
      summary.generation !== runtime.descriptor.generation
    ) {
      throw new PiRuntimeFrontendError(
        'PI_RUNTIME_STALE_GENERATION',
        'The controlled Pi runtime is no longer current.',
      )
    }
    return {
      hostEpoch: host.controller.hostEpoch,
      runtimeId: runtime.runtimeId,
      generation: runtime.descriptor.generation,
      scope: structuredClone(runtime.scope),
      sessionFile: runtime.descriptor.sessionFile ??
        runtime.lastCredibleSessionFile,
      sessionId: runtime.descriptor.sessionId,
    }
  }

  private requireControlRuntime(
    handle: PiRuntimeControlHandle,
    allowStarting = false,
  ): ActiveRuntime {
    const runtime = this.runtimes.get(handle.runtimeId)
    if (
      !runtime ||
      runtime.descriptor.generation !== handle.generation ||
      runtime.descriptor.sessionId !== handle.sessionId ||
      !sameConversationScope(runtime.scope, handle.scope)
    ) {
      throw new PiRuntimeFrontendError(
        'PI_RUNTIME_STALE_GENERATION',
        'The controlled Pi runtime was replaced.',
      )
    }
    const current = this.controlHandleFor(runtime, allowStarting)
    if (
      current.hostEpoch !== handle.hostEpoch ||
      current.sessionFile !== handle.sessionFile
    ) {
      throw new PiRuntimeFrontendError(
        'PI_RUNTIME_STALE_GENERATION',
        'The controlled Pi Host or Session was replaced.',
      )
    }
    return runtime
  }

  private controlLifecycle(runtime: ActiveRuntime): PiRuntimeControlSummary['lifecycle'] {
    if (runtime.activity.pendingCommands > 0) return 'accepting'
    if (runtime.activity.queuedMessages > 0) return 'queued'
    if (runtime.activity.agentRunning) return 'running'
    return 'idle'
  }

  private controlActivity(
    runtime: ActiveRuntime,
  ): Pick<PiRuntimeControlSummary, 'activity'> {
    if (runtime.activity.pendingUiRequests.size > 0) return { activity: 'interaction' }
    if (runtime.activity.summarizationRunning) return { activity: 'summarization' }
    if (runtime.activity.compactionRunning) return { activity: 'compaction' }
    if (runtime.activity.retryRunning) return { activity: 'retry' }
    if (runtime.activity.activeToolCalls.size > 0) return { activity: 'tool' }
    if (runtime.activity.agentRunning) return { activity: 'prompt' }
    return {}
  }

  private requireActive(): ActiveRuntime {
    const active = this.active
    if (!active || active.snapshot.state !== 'ready') {
      throw new PiRuntimeFrontendError(
        'PI_RUNTIME_INACTIVE',
        'No ready Pi runtime is active.',
      )
    }
    return active
  }

  private async disposeActive() {
    const active = this.active
    this.active = null
    if (!active) return
    this.dropCachedRuntime(active.runtimeId)
    try {
      await this.pool.disposeRuntime(active.runtimeId, active.descriptor.generation)
    } catch (error) {
      if (
        error instanceof ProjectHostPoolError &&
        error.code !== 'RUNTIME_NOT_FOUND'
      ) {
        throw new PiRuntimeFrontendError(
          'PI_RUNTIME_OPERATION_FAILED',
          error.message,
        )
      }
    }
  }

  private publish(snapshot: LocalPiRuntimeSnapshot, updateActive = true) {
    const cloned = structuredClone(snapshot)
    this.publishedSnapshot = cloned
    if (
      updateActive &&
      this.active &&
      this.active.snapshot.generation === cloned.generation
    ) {
      this.active.snapshot = structuredClone(cloned)
    }
    for (const listener of this.snapshotListeners) {
      try { listener(cloned) } catch { /* isolate Main consumers */ }
    }
  }

  private publishControlRuntimes(): void {
    const summaries = this.collectControlRuntimes()
    for (const listener of this.controlRuntimeListeners) {
      try { listener(structuredClone(summaries)) } catch { /* isolate Main consumers */ }
    }
  }

  private toFrontendError(error: unknown): PiRuntimeFrontendError {
    if (error instanceof PiRuntimeFrontendError) return error
    if (error instanceof ProjectHostPoolError) {
      if (
        error.code === 'HOST_CRASHED' ||
        error.code === 'HOST_RECOVERY_FAILED' ||
        error.code === 'HOST_START_FAILED'
      ) {
        return new PiRuntimeFrontendError(
          'PI_RUNTIME_HOST_RECOVERY_FAILED',
          'The embedded Pi Host could not be started or recovered.',
          false,
        )
      }
      if (error.code === 'RUNTIME_STALE_GENERATION') {
        return new PiRuntimeFrontendError('PI_RUNTIME_STALE_GENERATION', error.message)
      }
      if (error.code === 'RUNTIME_TARGET_INVALID' || error.code === 'HOST_SCOPE_INVALID') {
        return new PiRuntimeFrontendError('PI_RUNTIME_INVALID_TARGET', error.message, false)
      }
      return new PiRuntimeFrontendError('PI_RUNTIME_OPERATION_FAILED', error.message)
    }
    return new PiRuntimeFrontendError(
      'PI_RUNTIME_OPERATION_FAILED',
      error instanceof Error ? error.message : 'The embedded Pi runtime operation failed.',
    )
  }

  private findCachedRuntime(
    scope: ProjectHostScope,
    sessionFile: string | undefined,
  ): ActiveRuntime | null {
    if (!sessionFile) return null
    const identity = pathIdentity(sessionFile)
    for (const runtime of this.runtimes.values()) {
      const cachedSessionFile = runtime.descriptor.sessionFile ??
        runtime.lastCredibleSessionFile
      if (
        sameHostScope(runtime.hostScope, scope) &&
        cachedSessionFile &&
        pathIdentity(cachedSessionFile) === identity
      ) {
        return runtime
      }
    }
    return null
  }

  private dropCachedHost(scope: ProjectHostScope): void {
    for (const runtime of [...this.runtimes.values()]) {
      if (sameHostScope(runtime.hostScope, scope)) {
        this.dropCachedRuntime(runtime.runtimeId)
      }
    }
  }

  private reconcileInactiveRuntimes(snapshot: ProjectHostPoolSnapshot): void {
    for (const runtime of [...this.runtimes.values()]) {
      if (runtime.runtimeId === this.active?.runtimeId) continue
      const host = snapshot.hosts.find((entry) =>
        entry.scope.kind === runtime.hostScope.kind &&
        entry.cwd === runtime.hostScope.cwd,
      )
      const summary = host?.runtimes.find(
        (entry) => entry.runtimeId === runtime.runtimeId,
      )
      if (
        !host ||
        host.state === 'crashed' ||
        host.state === 'stopped' ||
        !summary ||
        summary.state === 'crashed' ||
        summary.state === 'stopped'
      ) {
        this.dropCachedRuntime(runtime.runtimeId)
        continue
      }
      if (host.state !== 'ready' || summary.state !== 'ready') continue
      this.setRuntimeDescriptor(runtime, {
        runtimeId: summary.runtimeId,
        generation: summary.generation,
        cwd: summary.cwd,
        sessionFile: summary.sessionFile,
        sessionId: summary.sessionId,
      })
      runtime.lastCredibleSessionFile = summary.sessionFile
    }
  }

  private dropCachedRuntime(runtimeId: string): void {
    const runtime = this.runtimes.get(runtimeId)
    if (runtime) this.clearControlLeases(runtime)
    this.runtimes.delete(runtimeId)
    this.inFlightRuntimeCommands.delete(runtimeId)
    if (
      this.previousSelection?.selectedRuntimeId === runtimeId ||
      this.previousSelection?.previousRuntimeId === runtimeId
    ) {
      this.previousSelection = null
    }
  }

  private assertNotDisposed() {
    if (this.disposed) {
      throw new PiRuntimeFrontendError(
        'PI_RUNTIME_DISPOSED',
        'The Pi runtime frontend is disposed.',
        false,
      )
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.lifecycle.then(operation, operation)
    this.lifecycle = result.then(() => undefined, () => undefined)
    return result
  }
}
