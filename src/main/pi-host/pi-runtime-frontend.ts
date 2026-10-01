import { realpathSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ExternalControlRequestedMode } from '../../shared/external-control-mode'
import { getConversationBranchEntries } from '../../shared/conversation-task'
import { getGoalStateFromBranch, type GoalSnapshot } from '../../shared/goal-state'
import { getPlanStateFromBranch, type PlanState } from '../../shared/plan-state'
import {
  LOCAL_PI_RUNTIME_SESSION_PENDING_MAX,
  LOCAL_PI_RUNTIME_SESSION_STATUS_MAX_ITEMS,
  localPiRuntimeSnapshotSchema,
  localPiSessionStateSchema,
  localPiDeliverySnapshotSchema,
  localPiMessagesResponseDataSchema,
  type LocalPiDeliverySnapshot,
  type LocalPiExtensionUiResponse,
  type LocalPiRendererRpcCommand,
  type LocalPiRpcEvent,
  type LocalPiRpcResponse,
  type LocalPiRuntimeSnapshot,
  type LocalPiRuntimeSessionStatus,
  type LocalPiSessionState,
} from '../../shared/local-pi'
import { parsePiHostEventPayload } from '../../shared/pi-host-messages'
import type {
  ConversationScope,
  SessionCatalogSelectionToken,
} from '../../shared/conversation-scope'
import type {
  PiHostEventEnvelope,
  PiHostUiRequestEventEnvelope,
} from '../../shared/pi-host-protocol'
import { removeFailedConversationImport } from '../conversations/failed-conversation-import'
import type { ConversationScopeResolver } from '../conversations/conversation-scope-resolver'
import { PiHostControllerError } from './pi-host-controller'
import {
  ProjectHostPool,
  ProjectHostPoolError,
  type ProjectHostPoolSnapshot,
  type ProjectHostScope,
  type ProjectRuntimeDescriptor,
} from './project-host-pool'
import { RuntimeMaintenanceBusyError, type RuntimeMaintenancePermit } from './runtime-maintenance-gate'
import type {
  RuntimeConfigurationAttempt,
  RuntimeConfigurationIdentity,
  RuntimeConfigurationResult,
} from './runtime-configuration'
import {
  BLOCKING_EXTENSION_UI_METHODS,
  createRuntimeActivity,
  isRuntimeIdle,
  isSessionStateBusy,
  isDeliverySnapshotBusy,
  reduceRuntimeActivity,
  summarizeRuntimeActivity,
  type RuntimeActivity,
  type RuntimeActivityAction,
  type RuntimeActivitySummary,
} from './runtime-activity'

export const PI_RUNTIME_ABORT_GRACE_TIMEOUT_MS = 5_000
/** Matches the Host bridge's maximum number of simultaneously pending dialogs. */
export const PI_RUNTIME_PENDING_UI_REQUEST_MAX = 256

export type PiRuntimeFrontendErrorCode =
  | 'PI_RUNTIME_DISPOSED'
  | 'PI_RUNTIME_INACTIVE'
  | 'PI_RUNTIME_STALE_GENERATION'
  | 'PI_RUNTIME_INVALID_TARGET'
  | 'PI_RUNTIME_CONFIRMATION_FAILED'
  | 'PI_RUNTIME_HOST_RECOVERY_FAILED'
  | 'PI_RUNTIME_OPERATION_FAILED'
  | 'PI_RUNTIME_MAINTENANCE_PENDING'
  | 'PI_RUNTIME_CONFIGURATION_INTERACTION_REQUIRED'

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

export interface PiRuntimeWorkflowState {
  plan?: PlanState
  goal?: GoalSnapshot | null
}

export interface PiRuntimeFrontendTarget {
  scope: ConversationScope
  sessionFile?: string
  forkSessionFile?: string
  selectionToken?: SessionCatalogSelectionToken
  importHistory?: import('../../shared/conversation-import').ImportedConversationHistory
}

type SnapshotListener = (snapshot: LocalPiRuntimeSnapshot) => void
type EventListener = (
  event: LocalPiRpcEvent,
  generation: number,
  runtimeId?: string,
  sequence?: number,
) => void | Promise<void>
type UiListener = (event: PiHostUiRequestEventEnvelope) => void | Promise<void>

export interface PiRuntimeControlHandle {
  hostEpoch: number
  runtimeId: string
  generation: number
  scope: ConversationScope
  sessionFile: string | null
  sessionId: string
  selectionToken?: SessionCatalogSelectionToken
}

export interface PiRuntimeControlLease extends PiRuntimeControlHandle {
  readonly leaseId: symbol
}

export interface PiRuntimeControlSummary extends PiRuntimeControlHandle, RuntimeActivitySummary {
  selected: boolean
}

/**
 * Project Main-owned Runtime inventory into the small status shape Renderer
 * needs for session rows. Live Runtime data wins over a retained terminal
 * failure, which makes explicit recovery observable without stale badges.
 */
export function projectRuntimeSessionStatuses(
  liveSummaries: readonly PiRuntimeControlSummary[],
  terminalStatuses: readonly LocalPiRuntimeSessionStatus[],
): LocalPiRuntimeSessionStatus[] {
  const statuses = new Map<string, LocalPiRuntimeSessionStatus>()
  const liveKeys = new Set<string>()
  for (const status of terminalStatuses) {
    statuses.set(sessionStatusKey(
      status.scope,
      status.sessionId,
      status.selectionToken,
    ), status)
  }
  for (const summary of liveSummaries) {
    const status: LocalPiRuntimeSessionStatus['status'] =
      summary.lifecycle === 'idle'
        ? summary.outcome ?? 'completed'
        : 'running'
    const key = sessionStatusKey(
      summary.scope,
      summary.sessionId,
      summary.selectionToken,
    )
    liveKeys.add(key)
    statuses.set(key, {
      scope: structuredClone(summary.scope),
      sessionId: summary.sessionId,
      ...(summary.selectionToken ? { selectionToken: summary.selectionToken } : {}),
      status,
      ...(summary.activity === 'interaction' ? { needsUserInput: true } : {}),
      ...(summary.queueCount > 0
        ? { pendingMessageCount: Math.min(
            summary.queueCount,
            LOCAL_PI_RUNTIME_SESSION_PENDING_MAX,
          ) }
        : {}),
      ...(summary.selected ? { selected: true as const } : {}),
    })
  }
  for (const key of statuses.keys()) {
    if (statuses.size <= LOCAL_PI_RUNTIME_SESSION_STATUS_MAX_ITEMS) break
    if (!liveKeys.has(key)) statuses.delete(key)
  }
  while (statuses.size > LOCAL_PI_RUNTIME_SESSION_STATUS_MAX_ITEMS) {
    const oldest = statuses.keys().next().value
    if (typeof oldest !== 'string') break
    statuses.delete(oldest)
  }
  return [...statuses.values()]
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
  selectionToken?: SessionCatalogSelectionToken
  lastUsedAt: number
  activity: RuntimeActivity
}

interface PreparedRuntimeTarget {
  scope: ProjectHostScope
  sessionFile?: string
  forkSessionFile?: string
  importHistory?: import('../../shared/conversation-import').ImportedConversationHistory
}

interface RuntimePreparation {
  promise: Promise<ActiveRuntime>
  sessionFiles: ReadonlySet<string>
  state: {
    runtime: ActiveRuntime | null
    listeners: Set<(runtime: ActiveRuntime) => void>
  }
}

export interface PiRuntimeFrontendOptions {
  /**
   * Idle cache size only. Running Runtimes never count toward this value and
   * are never evicted to satisfy it.
   */
  maxRetainedIdleRuntimesPerHost?: number
  /** Global idle budget across projects; selected and protected work do not count. */
  maxRetainedIdleRuntimes?: number
  now?: () => number
  isPersistedSessionFile?: (sessionFile: string) => boolean
}

const DEFAULT_MAX_RETAINED_IDLE_RUNTIMES_PER_HOST = 4
const DEFAULT_MAX_RETAINED_IDLE_RUNTIMES = 12

function requireIdleCacheSize(value: number): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError('Idle Runtime cache limits must be non-negative integers.')
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

const stoppedSnapshot = (generation = 0): LocalPiRuntimeSnapshot => ({
  state: 'stopped',
  generation,
  cwd: null,
  sessionFile: null,
  sessionState: null,
  commands: [],
  stderr: '',
  diagnostics: [],
  sessionStatuses: [],
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

function sessionStatusKey(
  scope: ConversationScope,
  sessionId: string,
  selectionToken?: SessionCatalogSelectionToken,
): string {
  const identity = selectionToken ?? `session:${sessionId}`
  return scope.kind === 'project'
    ? `project:${scope.workspaceId}:${identity}`
    : `projectless:${identity}`
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
  /**
   * Host failure is terminal for the retained Runtime generation. Keep that
   * fact visible after the in-memory Runtime is retired so the sidebar does
   * not silently turn a failed Session back into an unmarked historical row.
   */
  private readonly terminalSessionStatuses = new Map<
    string,
    LocalPiRuntimeSessionStatus
  >()
  private readonly maxRetainedIdleRuntimesPerHost: number
  private readonly maxRetainedIdleRuntimes: number
  private readonly preparations = new Map<string, RuntimePreparation>()
  private readonly pendingPreparations = new Set<RuntimePreparation>()
  private readonly releasingSessionFiles = new Set<string>()
  private readonly preparingRuntimeIds = new Set<string>()
  private readonly runtimeRetirements = new Map<string, Promise<boolean>>()
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
  private readonly pendingUiEnvelopes = new Map<string, Map<string, {
    envelope: PiHostUiRequestEventEnvelope
    sessionId: string
  }>>()
  private selectedUiIdentity: string | null = null
  private readonly deliveredSelectedUiRequests = new Set<string>()
  private readonly allEventListeners = new Set<AllEventListener>()
  private readonly allUiListeners = new Set<AllUiListener>()
  private readonly controlRuntimeListeners = new Set<ControlRuntimeListener>()
  private readonly detachEvents: () => boolean
  private readonly detachUiRequests: () => boolean
  private readonly detachHostSnapshots: () => boolean
  private readonly detachAdmission: () => boolean

  constructor(
    private readonly pool: ProjectHostPool,
    private readonly scopeResolver: Pick<ConversationScopeResolver, 'prepare'>,
    options: PiRuntimeFrontendOptions = {},
  ) {
    this.maxRetainedIdleRuntimesPerHost = requireIdleCacheSize(
      options.maxRetainedIdleRuntimesPerHost ??
        DEFAULT_MAX_RETAINED_IDLE_RUNTIMES_PER_HOST,
    )
    this.maxRetainedIdleRuntimes = requireIdleCacheSize(
      options.maxRetainedIdleRuntimes ?? DEFAULT_MAX_RETAINED_IDLE_RUNTIMES,
    )
    this.now = options.now ?? Date.now
    this.isPersistedSessionFile = options.isPersistedSessionFile ??
      defaultIsPersistedSessionFile
    this.detachEvents = pool.subscribeEvents((envelope) => {
      void this.forwardEvent(envelope).catch(() => undefined)
    })
    this.detachUiRequests = pool.subscribeUiRequests((envelope) => {
      void this.forwardUiRequest(envelope).catch(() => undefined)
    })
    this.detachAdmission = pool.subscribeAdmission(() => this.publishControlRuntimes())
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
        this.recordHostRuntimeFailures(active.hostScope)
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
    return structuredClone({
      ...this.publishedSnapshot,
      sessionStatuses: this.collectSessionStatuses(),
    })
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

  /** Resync a remounted Renderer explicitly; ordinary selection delivers each pending ID once. */
  async replayPendingSelectedUiRequests({ force = false }: { force?: boolean } = {}): Promise<void> {
    const active = this.active
    if (this.disposed || !active || active.snapshot.state !== 'ready' ||
      this.publishedSnapshot.state !== 'ready' ||
      this.publishedSnapshot.generation !== active.descriptor.generation ||
      this.publishedSnapshot.sessionState?.sessionId !== active.descriptor.sessionId) return
    let handle: PiRuntimeControlHandle
    try { handle = this.controlHandleFor(active) } catch { return }
    this.syncSelectedUiIdentity(handle)
    if (force) {
      this.deliveredSelectedUiRequests.clear()
      // rendererReady precedes the Renderer status read on a remount. Restore
      // its selected generation before replaying any generation-scoped UI.
      this.publish(active.snapshot)
    }
    await this.replayRetainedUiRequests(active, handle)
  }

  private async replayStartingRuntimeUi(runtime: ActiveRuntime): Promise<void> {
    if (this.disposed || this.active !== runtime || runtime.snapshot.state !== 'starting' ||
        this.publishedSnapshot.state !== 'starting' || this.publishedSnapshot.generation !== runtime.descriptor.generation) return
    let handle: PiRuntimeControlHandle
    try { handle = this.controlHandleFor(runtime, true) } catch { return }
    await this.replayRetainedUiRequests(runtime, handle)
  }

  private async replayRetainedUiRequests(active: ActiveRuntime, handle: PiRuntimeControlHandle): Promise<void> {
    const pending: Promise<void>[] = []
    for (const { envelope, sessionId } of this.pendingUiEnvelopes.get(active.runtimeId)?.values() ?? []) {
      if (sessionId !== handle.sessionId || envelope.hostEpoch !== handle.hostEpoch ||
        envelope.runtimeGeneration !== handle.generation ||
        !active.activity.pendingUiRequests.has(envelope.request.id)) continue
      pending.push(...this.deliverSelectedUiRequest(active, handle, envelope))
    }
    await Promise.allSettled(pending)
  }

  private syncSelectedUiIdentity(handle: PiRuntimeControlHandle): void {
    const identity = JSON.stringify([handle.runtimeId, handle.hostEpoch, handle.generation, handle.sessionId])
    if (identity === this.selectedUiIdentity) return
    this.selectedUiIdentity = identity
    this.deliveredSelectedUiRequests.clear()
  }

  private setSelectedRuntime(runtime: ActiveRuntime | null): void {
    if (this.active !== runtime) {
      this.selectedUiIdentity = null
      this.deliveredSelectedUiRequests.clear()
    }
    this.active = runtime
  }

  private deliverSelectedUiRequest(
    runtime: ActiveRuntime,
    handle: PiRuntimeControlHandle,
    envelope: PiHostUiRequestEventEnvelope,
  ): Promise<void>[] {
    if (this.runtimes.get(runtime.runtimeId) !== runtime || this.active !== runtime ||
      runtime.descriptor.generation !== handle.generation ||
      runtime.descriptor.sessionId !== handle.sessionId ||
      envelope.runtimeGeneration !== handle.generation || envelope.hostEpoch !== handle.hostEpoch) return []
    this.syncSelectedUiIdentity(handle)
    const blocking = BLOCKING_EXTENSION_UI_METHODS.has(envelope.request.method)
    if (blocking && (!runtime.activity.pendingUiRequests.has(envelope.request.id) ||
      this.deliveredSelectedUiRequests.has(envelope.request.id))) return []
    if (blocking && this.uiListeners.size > 0) this.deliveredSelectedUiRequests.add(envelope.request.id)
    const pending: Promise<void>[] = []
    for (const listener of this.uiListeners) {
      try { pending.push(Promise.resolve(listener(structuredClone(envelope)))) } catch { /* Isolate UI consumers. */ }
    }
    return pending
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
        // Keep unreviewed dialogs in internal activity for reclaim protection,
        // but expose interaction only after every Main consumer has declined
        // to answer it. Other events can publish while those consumers await.
        const retained = this.pendingUiEnvelopes.get(runtime.runtimeId)
        const activity = runtime.activity.pendingUiRequests.size === 0 ? runtime.activity : {
          ...runtime.activity,
          pendingUiRequests: new Set([...runtime.activity.pendingUiRequests].filter((id) => retained?.has(id))),
        }
        summaries.push({
          ...this.controlHandleFor(runtime),
          selected: runtime.runtimeId === this.active?.runtimeId,
          ...summarizeRuntimeActivity(activity),
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
  async acquireControlRuntime(
    target: PiRuntimeFrontendTarget,
    onCreated?: (handle: PiRuntimeControlHandle) => void,
  ): Promise<PiRuntimeControlLease> {
    this.assertNotDisposed()
    const prepared = await this.prepareTarget(target)
    const runtime = await this.prepareRuntime(target, prepared, onCreated ? (runtime) => onCreated(this.controlHandleFor(runtime, true)) : undefined)
    this.assertNotDisposed()
    this.assertAdmission(runtime.hostScope.cwd)
    this.assertSessionAvailable(prepared)
    const retirement = this.runtimeRetirements.get(runtime.runtimeId)
    if (retirement) {
      await retirement
      return this.acquireControlRuntime(target, onCreated)
    }
    runtime.scope = target.scope
    if (target.selectionToken) runtime.selectionToken = target.selectionToken
    this.touchActivity(runtime)
    return this.pinControlRuntime(runtime)
  }

  /** Resource loading is shared by exact Session target, independently of UI selection. */
  private prepareRuntime(
    target: PiRuntimeFrontendTarget,
    prepared: PreparedRuntimeTarget,
    onCreated?: (runtime: ActiveRuntime) => void,
  ): Promise<ActiveRuntime> {
    this.assertNotDisposed()
    this.assertSessionAvailable(prepared)
    const key = prepared.sessionFile === undefined ? undefined : JSON.stringify([
      prepared.scope.kind, pathIdentity(prepared.scope.cwd), pathIdentity(prepared.sessionFile),
    ])
    const pending = key === undefined ? undefined : this.preparations.get(key)
    if (pending) {
      if (onCreated) {
        if (pending.state.runtime) onCreated(pending.state.runtime)
        else pending.state.listeners.add(onCreated)
      }
      return pending.promise
    }
    const cached = this.findCachedRuntime(prepared.scope, prepared.sessionFile)
    if (cached) {
      const retirement = this.runtimeRetirements.get(cached.runtimeId)
      return retirement
        ? retirement.then(() => this.prepareRuntime(target, prepared, onCreated))
        : Promise.resolve(cached)
    }

    const state: RuntimePreparation['state'] = { runtime: null, listeners: new Set(onCreated ? [onCreated] : []) }
    const operation = this.createPreparedRuntime(target, prepared, (runtime) => {
      state.runtime = runtime
      for (const listener of state.listeners) listener(runtime)
      state.listeners.clear()
    })
    const preparation = {
      promise: operation, state,
      sessionFiles: new Set([prepared.sessionFile, prepared.forkSessionFile]
        .filter((file): file is string => file !== undefined).map(pathIdentity)),
    }
    this.pendingPreparations.add(preparation)
    if (key !== undefined) this.preparations.set(key, preparation)
    const finish = () => {
      this.pendingPreparations.delete(preparation)
      if (key !== undefined && this.preparations.get(key) === preparation) this.preparations.delete(key)
    }
    void operation.then(finish, finish)
    return operation
  }

  private async createPreparedRuntime(
    target: PiRuntimeFrontendTarget,
    prepared: PreparedRuntimeTarget,
    onCreated?: (runtime: ActiveRuntime) => void,
  ): Promise<ActiveRuntime> {
    let runtime: ActiveRuntime | null = null
    let descriptor: ProjectRuntimeDescriptor | null = null
    try {
      descriptor = await this.pool.createRuntime(prepared.scope, {
        ...(prepared.sessionFile === undefined ? {} : { sessionFile: prepared.sessionFile }),
        ...(prepared.forkSessionFile === undefined ? {} : { forkSessionFile: prepared.forkSessionFile }),
        ...(prepared.importHistory === undefined ? {} : { importHistory: prepared.importHistory }),
      })
      this.assertNotDisposed()
      this.assertSessionAvailable(prepared)
      const snapshot: LocalPiRuntimeSnapshot = {
        state: 'starting', generation: descriptor.generation, cwd: descriptor.cwd,
        sessionFile: descriptor.sessionFile, sessionState: null, commands: [], stderr: '', diagnostics: [],
      }
      runtime = {
        runtimeId: descriptor.runtimeId, hostScope: prepared.scope, scope: target.scope, descriptor,
        snapshot, lastCredibleSessionFile: descriptor.sessionFile,
        ...(target.selectionToken ? { selectionToken: target.selectionToken } : {}),
        lastUsedAt: this.now(), activity: createRuntimeActivity(),
      }
      this.preparingRuntimeIds.add(runtime.runtimeId)
      this.runtimes.set(runtime.runtimeId, runtime)
      onCreated?.(runtime)
      const token = this.markCommandStart(runtime, descriptor.generation)
      try {
        descriptor = await this.pool.bindRuntime(descriptor.runtimeId, descriptor.generation)
        this.assertNotDisposed()
        this.assertSessionAvailable(prepared)
        this.setRuntimeDescriptor(runtime, descriptor)
        runtime.snapshot = await this.hydrate(descriptor, prepared)
        this.assertNotDisposed()
        this.assertSessionAvailable(prepared)
        this.controlHandleFor(runtime)
        if (this.runtimes.get(runtime.runtimeId) !== runtime || runtime.descriptor.generation !== descriptor.generation ||
            runtime.descriptor.sessionId !== descriptor.sessionId) {
          throw new PiRuntimeFrontendError('PI_RUNTIME_STALE_GENERATION', 'The prepared Runtime was retired.')
        }
        runtime.lastCredibleSessionFile = runtime.snapshot.sessionFile
        return runtime
      } finally {
        this.markCommandEnd(runtime, token)
      }
    } catch (error) {
      if (descriptor) {
        const owned = runtime && this.runtimes.get(runtime.runtimeId) === runtime ? runtime.descriptor : descriptor
        const released = await this.pool.disposeRuntime(owned.runtimeId, owned.generation).then(() => true, () => false)
        this.dropCachedRuntime(descriptor.runtimeId)
        if (prepared.importHistory && released) await removeFailedConversationImport(descriptor.sessionFile, descriptor.sessionId, prepared.importHistory.importId).catch(() => false)
      }
      throw this.toFrontendError(error)
    } finally {
      if (runtime) {
        const completed = runtime
        // All preparation waiters claim their own lease/selection before reclamation.
        setImmediate(() => {
          this.preparingRuntimeIds.delete(completed.runtimeId)
          if (!this.disposed) this.scheduleIdleReclaim(completed.hostScope)
        })
      }
    }
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

    this.updateActivity(runtime, { type: 'control_pin', delta: -1 })
    this.publishControlRuntimes()
    if (runtime.runtimeId !== this.active?.runtimeId && isRuntimeIdle(runtime.activity)) {
      this.scheduleIdleReclaim(runtime.hostScope)
    }
    return true
  }

  /** A cancelled fresh side conversation has no user Session to retain in the idle cache. */
  discardUnpersistedControlRuntime(handle: PiRuntimeControlHandle): Promise<void> {
    return this.enqueue(async () => {
      let runtime: ActiveRuntime
      try { runtime = this.requireControlRuntime(handle) } catch { return }
      const eligible = () => {
        const file = runtime.descriptor.sessionFile ?? runtime.lastCredibleSessionFile
        return this.runtimes.get(runtime.runtimeId) === runtime && runtime !== this.active &&
          isRuntimeIdle(runtime.activity) && runtime.activity.managedMessages === 0 &&
          (!file || !this.isPersistedSessionFile(file))
      }
      if (!eligible()) return
      await this.pool.withMaintenance(runtime.hostScope.cwd, async (permit) => {
        if (!eligible()) return
        const revision = runtime.activity.revision
        const [state, delivery] = await Promise.all([
          this.pool.command(runtime.runtimeId, { type: 'get_state' }, handle.generation, undefined, permit),
          this.pool.command(runtime.runtimeId, { type: 'get_delivery_state', expectedSessionId: handle.sessionId }, handle.generation, undefined, permit),
        ])
        const parsed = this.parseStateResponse(state.response)
        if (!eligible() || runtime.activity.revision !== revision || state.runtime.generation !== handle.generation ||
            delivery.runtime.generation !== handle.generation || isSessionStateBusy(parsed) || parsed.messageCount !== 0 ||
            this.parseDeliveryResponse(delivery.response).items.length !== 0) return
        await this.pool.disposeRuntime(runtime.runtimeId, handle.generation, permit)
        if (this.runtimes.get(runtime.runtimeId) === runtime) this.dropCachedRuntime(runtime.runtimeId)
      })
    })
  }

  async submitControlPrompt(
    handle: PiRuntimeControlHandle,
    message: string,
    mode: ExternalControlRequestedMode,
    timeoutMs?: number,
  ) {
    this.assertNotDisposed()
    const runtime = this.requireControlRuntime(handle)
    this.assertAdmission(runtime.hostScope.cwd)
    const token = this.markCommandStart(runtime, handle.generation)
    const expectedEventRevision = runtime.activity.eventRevision
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
      this.updateActivity(runtime, {
        type: 'prompt_accepted',
        mode: result.acceptedMode === 'prompt' ? 'prompt' : 'queued',
        expectedEventRevision,
      })
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
    const expectedStateRevision = runtime.activity.stateRevision
    try {
      const result = await this.pool.command(
        handle.runtimeId,
        { type: 'get_state' },
        handle.generation,
      )
      if (this.runtimes.get(runtime.runtimeId) !== runtime ||
        runtime.descriptor.generation !== handle.generation ||
        result.runtime.generation !== handle.generation) {
        throw new PiRuntimeFrontendError(
          'PI_RUNTIME_STALE_GENERATION',
          'The controlled Pi runtime was replaced while reading state.',
        )
      }
      this.setRuntimeDescriptor(runtime, result.runtime)
      this.requireControlRuntime(handle)
      const state = this.parseStateResponse(result.response)
      this.updateActivity(runtime, { type: 'session_state', state, expectedStateRevision })
      return structuredClone(state)
    } catch (error) {
      throw this.toFrontendError(error)
    } finally {
      this.markCommandEnd(runtime, token)
    }
  }

  /** Read the exact background Session; never consult the selected Renderer transcript. */
  async getControlTranscript(handle: PiRuntimeControlHandle) {
    this.assertNotDisposed()
    const runtime = this.requireControlRuntime(handle)
    const result = await this.pool.command(handle.runtimeId, { type: 'get_messages' }, handle.generation)
    this.requireControlRuntime(handle)
    if (this.runtimes.get(runtime.runtimeId) !== runtime || result.runtime.generation !== handle.generation ||
        !result.response.success || result.response.command !== 'get_messages') {
      throw new PiRuntimeFrontendError('PI_RUNTIME_OPERATION_FAILED', 'The side conversation transcript is no longer available.')
    }
    return localPiMessagesResponseDataSchema.parse(result.response.data)
  }

  /** Read plugin-owned workflows from the exact branch, including background Sessions. */
  async getControlWorkflowState(handle: PiRuntimeControlHandle): Promise<PiRuntimeWorkflowState> {
    const history = await this.getControlEntries(handle)
    const branch = getConversationBranchEntries(history.entries, history.leafId)
    const plan = branch ? getPlanStateFromBranch(branch) : null
    const goal = branch ? getGoalStateFromBranch(branch) : null
    if (!branch || plan === null || goal === null) {
      throw new PiRuntimeFrontendError('PI_RUNTIME_OPERATION_FAILED', 'The conversation workflow state could not be verified.')
    }
    return { plan, goal: goal?.goal }
  }

  /** Read authoritative history without activating, rebinding or executing a Session. */
  async getControlEntries(handle: PiRuntimeControlHandle) {
    this.assertNotDisposed()
    const runtime = this.requireControlRuntime(handle)
    // Completion releases ordinary execution pins. Retain this exact Runtime
    // while checking its workflow so idle-cache reclamation cannot race the read.
    const lease = this.pinControlRuntime(runtime)
    try {
      const result = await this.pool.command(handle.runtimeId, { type: 'get_entries' }, handle.generation)
      this.requireControlRuntime(handle)
      if (this.runtimes.get(runtime.runtimeId) !== runtime || result.runtime.generation !== handle.generation ||
          !result.response.success || result.response.command !== 'get_entries') {
        throw new PiRuntimeFrontendError('PI_RUNTIME_OPERATION_FAILED', 'The conversation history is no longer available.')
      }
      return result.response.data
    } finally {
      this.releaseControlRuntime(lease)
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
    if (!this.updateActivity(runtime, { type: 'ui_responded', id: response.id })) return
    this.publishControlRuntimes()
    if (runtime.runtimeId !== this.active?.runtimeId && isRuntimeIdle(runtime.activity)) {
      this.scheduleIdleReclaim(runtime.hostScope)
    }
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
        this.setSelectedRuntime(previous)
        this.touchActivity(previous)
        this.publish(previous.snapshot)
        void this.replayPendingSelectedUiRequests()
      } else if (!previous) {
        this.setSelectedRuntime(null)
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
      this.assertAdmission(active.hostScope.cwd)
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

  /** Package synchronization has the same no-interruption policy as config save. */
  async reloadRuntimes(cwd?: string): Promise<void> {
    const result = await this.applyConfiguration({
      ...(cwd === undefined ? {} : { cwd }),
      isCurrent: async () => true,
      isApplied: () => false,
      didApply: () => undefined,
    })
    if (result.state === 'pending') throw new RuntimeMaintenanceBusyError()
    if (result.state === 'failed') {
      throw new PiRuntimeFrontendError(
        'PI_RUNTIME_OPERATION_FAILED',
        'Pi configuration could not be applied to every affected runtime.',
      )
    }
  }

  async applyConfiguration(attempt: RuntimeConfigurationAttempt): Promise<RuntimeConfigurationResult> {
    this.assertNotDisposed()
    const counts = { total: 0, applied: 0, failed: 0 }
    let reason: RuntimeConfigurationResult['reason']
    const outcome = (state: RuntimeConfigurationResult['state']): RuntimeConfigurationResult =>
      ({ state, ...counts, ...(reason ? { reason } : {}) })
    const admission = await this.pool.withMaintenance(attempt.cwd, async (permit) => {
      if (!await attempt.isCurrent()) return outcome('superseded')
      const hosts = this.pool.getSnapshot().hosts.filter((host) =>
        host.state !== 'stopped' && (attempt.cwd === undefined || host.cwd === attempt.cwd))
      counts.total = hosts.reduce((total, host) => total + host.runtimes.length, 0)
      if (hosts.some((host) => host.state === 'crashed')) {
        counts.failed = Math.max(1, counts.total)
        return outcome('failed')
      }
      if (hosts.some((host) => host.state !== 'ready')) return outcome('pending')
      if (counts.total === 0) return outcome('unavailable')

      const targets: Array<{
        runtime: ActiveRuntime
        identity: RuntimeConfigurationIdentity
        revision: number
      }> = []
      for (const host of hosts) {
        for (const summary of host.runtimes) {
          const runtime = this.runtimes.get(summary.runtimeId)
          if (!runtime || summary.state !== 'ready' ||
              runtime.descriptor.generation !== summary.generation ||
              !isRuntimeIdle(runtime.activity)) return outcome('pending')
          const identity = {
            hostKey: host.hostKey,
            hostEpoch: host.controller.hostEpoch,
            runtimeId: runtime.runtimeId,
            generation: summary.generation,
          }
          if (attempt.isApplied(identity)) counts.applied += 1
          targets.push({ runtime, identity, revision: runtime.activity.revision })
        }
      }

      const stillIdle = () => targets.every(({ runtime, identity, revision }) => {
        if (this.runtimes.get(runtime.runtimeId) !== runtime ||
            runtime.descriptor.generation !== identity.generation ||
            runtime.activity.revision !== revision || !isRuntimeIdle(runtime.activity)) return false
        try {
          return this.controlHandleFor(runtime).hostEpoch === identity.hostEpoch
        } catch {
          return false
        }
      })
      // Every affected Runtime is checked before the first extension shutdown.
      for (const { runtime, identity } of targets) {
        try {
          const [result, deliveryResult] = await Promise.all([
            this.pool.command(runtime.runtimeId, { type: 'get_state' }, identity.generation, undefined, permit),
            this.pool.command(runtime.runtimeId, { type: 'get_delivery_state', expectedSessionId: runtime.descriptor.sessionId }, identity.generation, undefined, permit),
          ])
          const state = this.parseStateResponse(result.response)
          const delivery = this.parseDeliveryResponse(deliveryResult.response)
          if (isDeliverySnapshotBusy(delivery) && result.runtime.generation === identity.generation &&
            deliveryResult.runtime.generation === identity.generation) this.observeDeliveryResponse(runtime, deliveryResult.response)
          if (!stillIdle() || result.runtime.generation !== identity.generation ||
              deliveryResult.runtime.generation !== identity.generation ||
              isSessionStateBusy(state) || isDeliverySnapshotBusy(delivery)) {
            return outcome('pending')
          }
        } catch {
          counts.failed += 1
          return outcome('failed')
        }
      }

      for (const target of targets) {
        if (attempt.isApplied(target.identity)) {
          if (target.runtime.snapshot.state !== 'ready') {
            try {
              await this.hydrateConfigurationRuntime(target.runtime, permit)
              target.revision = target.runtime.activity.revision
            } catch {
              return outcome('failed')
            }
          }
          continue
        }
        if (!await attempt.isCurrent()) return outcome('superseded')
        if (!stillIdle()) return outcome('pending')
        try {
          const confirmed = await this.reloadConfigurationRuntime(target.runtime, permit, async () => {
            target.identity.generation = target.runtime.descriptor.generation
            if (!await attempt.isCurrent()) return false
            attempt.didApply(target.identity)
            counts.applied += 1
            return true
          })
          target.revision = target.runtime.activity.revision
          if (!confirmed) return outcome('superseded')
        } catch (error) {
          if (error instanceof PiHostControllerError &&
              error.diagnostic?.code === 'RUNTIME_CONFIGURATION_BUSY') return outcome('pending')
          if (error instanceof PiRuntimeFrontendError && error.code === 'PI_RUNTIME_CONFIGURATION_INTERACTION_REQUIRED') {
            reason = 'interaction-required'
          }
          if (!attempt.isApplied(target.identity)) counts.failed += 1
          // Do not restart a Host after an uncertain/partial extension reload.
          return outcome('failed')
        }
      }
      return outcome('applied')
    })
    return admission.admitted ? admission.value : {
      ...outcome('pending'),
      ...(admission.retryAfter ? { retryAfter: admission.retryAfter } : {}),
    }
  }

  private async reloadConfigurationRuntime(
    runtime: ActiveRuntime,
    permit: RuntimeMaintenancePermit,
    didReload: () => Promise<boolean>,
  ) {
    const baseGeneration = runtime.descriptor.generation
    const token = this.markCommandStart(runtime, baseGeneration)
    try {
      const { interactionRequired, reloadFailed, ...descriptor } = await this.pool.reloadRuntime(runtime.runtimeId, baseGeneration, undefined, permit)
      this.setRuntimeDescriptor(runtime, descriptor)
      runtime.lastCredibleSessionFile = descriptor.sessionFile ?? runtime.lastCredibleSessionFile
      runtime.snapshot = { ...runtime.snapshot, state: 'replacing', generation: descriptor.generation }
      if (runtime.runtimeId === this.active?.runtimeId) this.publish(runtime.snapshot)
      const confirmed = interactionRequired || reloadFailed ? false : await didReload()
      await this.hydrateConfigurationRuntime(runtime, permit)
      if (reloadFailed) {
        throw new PiRuntimeFrontendError('PI_RUNTIME_OPERATION_FAILED', 'Pi configuration reload failed. The current runtime state was refreshed; retry application.')
      }
      if (interactionRequired) {
        throw new PiRuntimeFrontendError(
          'PI_RUNTIME_CONFIGURATION_INTERACTION_REQUIRED',
          'Configuration reload required interactive setup. Its new dialogs were cancelled without interrupting existing work.',
        )
      }
      return confirmed
    } finally {
      this.markCommandEnd(runtime, token)
    }
  }

  private async hydrateConfigurationRuntime(runtime: ActiveRuntime, permit: RuntimeMaintenancePermit) {
    try {
      runtime.snapshot = await this.hydrate(runtime.descriptor, { scope: runtime.hostScope }, permit)
      runtime.lastCredibleSessionFile = runtime.snapshot.sessionFile
      if (runtime.runtimeId === this.active?.runtimeId) this.publish(runtime.snapshot)
    } catch (error) {
      runtime.snapshot = {
        ...runtime.snapshot,
        state: 'error',
        sessionState: null,
        commands: [],
        diagnostics: [{
          code: 'PI_RUNTIME_CONFIRMATION_FAILED',
          message: 'Configuration was reloaded, but Pi runtime state could not be refreshed. Retry application.',
          timestamp: this.now(),
        }],
      }
      if (runtime.runtimeId === this.active?.runtimeId) this.publish(runtime.snapshot)
      throw error
    }
  }

  stop() {
    return this.enqueue(async () => {
      if (!this.active) {
        const snapshot = stoppedSnapshot(this.publishedSnapshot.generation)
        this.publish(snapshot)
        return snapshot
      }
      this.assertAdmission(this.active.hostScope.cwd)
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
  releaseSession(sessionFile: string, afterRelease?: () => Promise<void>): Promise<boolean> {
    const identity = pathIdentity(sessionFile)
    if (this.releasingSessionFiles.has(identity)) {
      return Promise.reject(new PiRuntimeFrontendError('PI_RUNTIME_OPERATION_FAILED', 'The Session is already being released.'))
    }
    // Admission closes before entering the UI lifecycle queue. Keep it closed
    // through the caller's filesystem mutation, including revalidation.
    this.releasingSessionFiles.add(identity)
    return this.enqueue(async () => {
      this.assertNotDisposed()
      const preparing = [...this.pendingPreparations].filter((entry) => entry.sessionFiles.has(identity))
      if (preparing.some((entry) => entry.state.runtime && entry.state.runtime === this.active)) {
        throw new PiRuntimeFrontendError('PI_RUNTIME_OPERATION_FAILED', 'The active Pi session must be stopped before it can be released.', false)
      }
      // Cancellation also releases a startup dialog that a background bind
      // may be awaiting. Creations not yet returned observe the admission
      // marker before binding and dispose their own result.
      await Promise.allSettled(preparing.map(async (entry) => {
        const runtime = entry.state.runtime
        if (runtime) {
          await Promise.allSettled([...runtime.activity.pendingUiRequests].map(async (id) => {
            await this.pool.respondToExtensionUi(runtime.runtimeId, { type: 'extension_ui_response', id, cancelled: true }, runtime.descriptor.generation)
            this.updateActivity(runtime, { type: 'ui_responded', id })
          }))
        }
        await entry.promise.catch(() => undefined)
      }))
      const matches = [...this.runtimes.values()].filter((runtime) => {
        const cachedSessionFile = runtime.descriptor.sessionFile ??
          runtime.lastCredibleSessionFile
        return cachedSessionFile !== null &&
          pathIdentity(cachedSessionFile) === identity
      })
      const owned = new Map(matches.map((runtime) => [runtime.runtimeId, runtime.descriptor]))
      // Preparation failure may have detached the frontend even if its
      // best-effort cleanup failed. The Pool still owns the authoritative
      // Session lease and must release it before filesystem mutation.
      for (const host of this.pool.getSnapshot().hosts) {
        for (const runtime of host.runtimes) {
          const file = runtime.sessionFile ?? runtime.leaseKey
          if (runtime.state !== 'stopped' && file && pathIdentity(file) === identity) owned.set(runtime.runtimeId, runtime)
        }
      }
      if (this.active && owned.has(this.active.runtimeId)) {
        throw new PiRuntimeFrontendError(
          'PI_RUNTIME_OPERATION_FAILED',
          'The active Pi session must be stopped before it can be released.',
          false,
        )
      }

      for (const runtime of owned.values()) {
        try {
          await this.pool.disposeRuntime(
            runtime.runtimeId,
            runtime.generation,
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
      await afterRelease?.()
      return owned.size > 0 || preparing.length > 0
    }).finally(() => { this.releasingSessionFiles.delete(identity) })
  }

  /** Hold project admission closed while an owned checkout is archived. */
  withInactiveProject<T>(cwd: string, operation: () => Promise<T>): Promise<T> {
    return this.enqueue(async () => {
      const result = await this.pool.withMaintenance(cwd, async (permit) => {
        const runtimes = [...this.runtimes.values()].filter((runtime) => pathIdentity(runtime.hostScope.cwd) === pathIdentity(cwd))
        if (runtimes.some((runtime) => runtime === this.active || !isRuntimeIdle(runtime.activity) || runtime.activity.managedMessages > 0 ||
            this.preparingRuntimeIds.has(runtime.runtimeId) || !runtime.lastCredibleSessionFile ||
            !this.isPersistedSessionFile(runtime.lastCredibleSessionFile))) {
          throw new PiRuntimeFrontendError('PI_RUNTIME_OPERATION_FAILED', 'Switch to another project and finish its running or unsaved sessions before archiving.')
        }
        const observed = runtimes.map((runtime) => ({ runtime, generation: runtime.descriptor.generation, revision: runtime.activity.revision }))
        const unchanged = () => observed.every(({ runtime, generation, revision }) =>
          this.runtimes.get(runtime.runtimeId) === runtime && runtime.descriptor.generation === generation &&
          runtime.activity.revision === revision && runtime !== this.active && isRuntimeIdle(runtime.activity) && runtime.activity.managedMessages === 0)
        // Confirm every Session before the first teardown, including paused delivery queues.
        for (const { runtime, generation } of observed) {
          const [state, delivery] = await Promise.all([
            this.pool.command(runtime.runtimeId, { type: 'get_state' }, generation, undefined, permit),
            this.pool.command(runtime.runtimeId, { type: 'get_delivery_state', expectedSessionId: runtime.descriptor.sessionId }, generation, undefined, permit),
          ])
          const deliveries = this.parseDeliveryResponse(delivery.response)
          if (!unchanged() || state.runtime.generation !== generation || delivery.runtime.generation !== generation ||
              isSessionStateBusy(this.parseStateResponse(state.response)) || isDeliverySnapshotBusy(deliveries) || deliveries.items.length > 0) {
            throw new PiRuntimeFrontendError('PI_RUNTIME_OPERATION_FAILED', 'The project still has running or queued work. Finish it before archiving.')
          }
        }
        for (const runtime of runtimes) {
          const expected = observed.find((entry) => entry.runtime === runtime)!
          if (this.runtimes.get(runtime.runtimeId) !== runtime || runtime.descriptor.generation !== expected.generation ||
              runtime.activity.revision !== expected.revision || !isRuntimeIdle(runtime.activity) || runtime.activity.managedMessages > 0) {
            throw new PiRuntimeFrontendError('PI_RUNTIME_OPERATION_FAILED', 'The project started work while preparing to archive. Retry after it finishes.')
          }
          await this.pool.disposeRuntime(runtime.runtimeId, runtime.descriptor.generation, permit)
          this.dropCachedRuntime(runtime.runtimeId)
        }
        const host = this.pool.getHost({ kind: 'project', cwd })
        if (host?.runtimes.some((runtime) => runtime.state !== 'stopped')) {
          throw new PiRuntimeFrontendError('PI_RUNTIME_OPERATION_FAILED', 'The project still owns a Runtime. Retry after it finishes.')
        }
        await this.pool.stop({ kind: 'project', cwd }, permit)
        return operation()
      })
      if (!result.admitted) throw new PiRuntimeFrontendError('PI_RUNTIME_OPERATION_FAILED', 'The project is busy. Retry when its current operation finishes.')
      return result.value
    })
  }

  async request(
    command: LocalPiRendererRpcCommand,
    timeoutMs?: number,
  ): Promise<LocalPiRpcResponse> {
    this.assertNotDisposed()
    const runtime = command.type === 'abort'
      ? this.requireAbortTarget()
      : this.requireActive()
    this.assertAdmission(runtime.hostScope.cwd)
    const expectedGeneration = runtime.descriptor.generation
    const recoveryHostEpoch = command.type === 'abort'
      ? this.pool.getSnapshot().hosts.find((host) => sameHostScope(host.scope, runtime.hostScope))?.controller.hostEpoch
      : undefined
    const commandToken = this.markCommandStart(runtime, expectedGeneration)
    const recoverySessionFile = runtime.descriptor.sessionFile ??
      runtime.lastCredibleSessionFile
    const recoveryTarget: PiRuntimeFrontendTarget | null = command.type === 'abort' &&
      recoverySessionFile
      ? {
          scope: structuredClone(runtime.scope),
          sessionFile: recoverySessionFile,
          ...(runtime.selectionToken
            ? { selectionToken: runtime.selectionToken }
            : {}),
        }
      : null
    const commandTimeoutMs = command.type === 'abort'
      ? Math.min(timeoutMs ?? PI_RUNTIME_ABORT_GRACE_TIMEOUT_MS, PI_RUNTIME_ABORT_GRACE_TIMEOUT_MS)
      : timeoutMs
    let result: Awaited<ReturnType<ProjectHostPool['command']>>
    try {
      result = await this.pool.command(
        runtime.runtimeId,
        command,
        expectedGeneration,
        commandTimeoutMs,
      )
    } catch (error) {
      if (command.type === 'abort' && this.isAbortRecoveryFailure(error)) {
        if (!recoveryTarget) {
          throw new PiRuntimeFrontendError(
            'PI_RUNTIME_HOST_RECOVERY_FAILED',
            'The interrupted Pi runtime has no persisted Session to recover.',
            false,
          )
        }
        try {
          await this.recoverAbortedRuntime(runtime, expectedGeneration, recoveryHostEpoch, recoveryTarget)
        } catch (recoveryError) {
          throw this.toFrontendError(recoveryError)
        }
        return {
          type: 'response',
          command: 'abort',
          success: true,
        }
      }
      throw error
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
    this.observeDeliveryResponse(runtime, response)
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
        this.updateActivity(active, { type: 'ui_responded', id: response.id })
      }
    } finally {
      this.markCommandEnd(active, commandToken)
    }
  }

  async getState(): Promise<LocalPiSessionState> {
    const active = this.requireActive()
    this.assertAdmission(active.hostScope.cwd)
    const expectedGeneration = active.descriptor.generation
    const expectedStateRevision = active.activity.stateRevision
    const result = await this.pool.command(
      active.runtimeId,
      { type: 'get_state' },
      expectedGeneration,
    )
    const parsed = this.parseStateResponse(result.response)
    const current = this.active
    if (current === active && current.descriptor.generation === expectedGeneration &&
      result.runtime.generation === expectedGeneration) {
      this.setRuntimeDescriptor(current, result.runtime)
      current.snapshot = this.mergeSnapshotActivity(current, {
        ...current.snapshot,
        sessionState: { ...parsed, sessionFile: parsed.sessionFile ?? current.snapshot.sessionFile ?? undefined },
        sessionFile: parsed.sessionFile ?? current.snapshot.sessionFile ?? null,
      }, expectedStateRevision)
      current.lastCredibleSessionFile = current.snapshot.sessionFile
      this.publish(current.snapshot)
    }
    return parsed
  }

  async dispose() {
    if (this.disposed) return
    this.disposed = true
    await Promise.allSettled([...this.pendingPreparations].map((entry) => entry.promise))
    await this.enqueue(async () => {
      const runtimes = [...this.runtimes.values()]
      this.setSelectedRuntime(null)
      this.runtimes.clear()
      this.pendingUiEnvelopes.clear()
      this.deliveredSelectedUiRequests.clear()
      this.selectedUiIdentity = null
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
    this.detachAdmission()
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

  private async recoverAbortedRuntime(
    runtime: ActiveRuntime,
    generation: number,
    hostEpoch: number | undefined,
    target: PiRuntimeFrontendTarget,
  ) {
    const selectedRecovery = await this.enqueue(async () => {
      this.assertNotDisposed()
      const host = this.pool.getSnapshot().hosts.find((entry) => sameHostScope(entry.scope, runtime.hostScope))
      const current = host?.runtimes.find((entry) => entry.runtimeId === runtime.runtimeId)
      if (!host || !current || host.controller.hostEpoch !== hostEpoch ||
          current.generation !== generation || !['ready', 'crashed'].includes(host.state)) {
        throw new PiRuntimeFrontendError(
          'PI_RUNTIME_STALE_GENERATION',
          'The aborted Pi runtime was already replaced before recovery.',
        )
      }
      if (this.active?.runtimeId === runtime.runtimeId) {
        await this.activate(target, { restartHost: true })
        return true
      }
      const selected = this.active
      if (selected && sameHostScope(selected.hostScope, runtime.hostScope)) {
        const sessionFile = selected.descriptor.sessionFile ?? selected.lastCredibleSessionFile
        if (!sessionFile) {
          throw new PiRuntimeFrontendError(
            'PI_RUNTIME_HOST_RECOVERY_FAILED',
            'The selected Pi runtime has no persisted Session to restore after Host recovery.',
            false,
          )
        }
        // A hard abort replaces the whole Host; rebind its selected sibling too.
        await this.activate({
          scope: structuredClone(selected.scope),
          sessionFile,
          ...(selected.selectionToken ? { selectionToken: selected.selectionToken } : {}),
        }, { restartHost: true })
        return false
      }
      this.dropCachedHost(runtime.hostScope)
      await this.pool.restart(runtime.hostScope)
      return false
    })
    if (!selectedRecovery) {
      const lease = await this.acquireControlRuntime(target)
      this.releaseControlRuntime(lease)
    }
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
      if (options.restartHost) {
        if (previousActive && sameHostScope(previousActive.hostScope, prepared.scope)) this.setSelectedRuntime(null)
        this.dropCachedHost(prepared.scope)
        await this.pool.restart(prepared.scope)
      }
      selected = await this.prepareRuntime(target, prepared, (runtime) => {
        createdRuntime = true
        selected = runtime
        descriptor = runtime.descriptor
        this.setSelectedRuntime(runtime)
        this.publish(runtime.snapshot)
        void this.replayStartingRuntimeUi(runtime)
      })
      descriptor = selected.descriptor
      const snapshot = createdRuntime ? selected.snapshot : await this.hydrate(descriptor, prepared)
      this.assertNotDisposed()
      this.controlHandleFor(selected)
      if (selected.descriptor.generation !== descriptor.generation || selected.descriptor.sessionId !== descriptor.sessionId) {
        throw new PiRuntimeFrontendError('PI_RUNTIME_STALE_GENERATION', 'The Session changed while it was being selected.')
      }
      this.setSelectedRuntime(selected)
      selected.scope = target.scope
      if (target.selectionToken) selected.selectionToken = target.selectionToken
      this.setRuntimeDescriptor(selected, descriptor)
      selected.snapshot = snapshot
      selected.lastCredibleSessionFile = snapshot.sessionFile
      selected.lastUsedAt = this.now()
      this.runtimes.set(descriptor.runtimeId, selected)
      const activatedSessionId = snapshot.sessionState?.sessionId || descriptor.sessionId
      if (activatedSessionId) {
        this.terminalSessionStatuses.delete(
          sessionStatusKey(target.scope, activatedSessionId, target.selectionToken),
        )
        this.terminalSessionStatuses.delete(
          sessionStatusKey(target.scope, activatedSessionId),
        )
      }
      this.publish(snapshot)
      this.selectionRevision += 1
      this.previousSelection = {
        selectedRuntimeId: selected.runtimeId,
        previousRuntimeId: previousActive?.runtimeId ?? null,
        selectionRevision: this.selectionRevision,
      }
      if (previousActive && previousActive.runtimeId !== selected.runtimeId) {
        this.scheduleIdleReclaim(previousActive.hostScope)
      }
      // Cached dialogs are emitted only after the selected session's hydrated
      // snapshot. Startup dialogs retain their existing immediate delivery.
      void this.replayPendingSelectedUiRequests()
      return this.getSnapshot()
    } catch (error) {
      const failure = this.toFrontendError(error)
      const failedRuntime = selected
      const shouldDisposeFailedRuntime = Boolean(
        descriptor &&
        createdRuntime &&
        failedRuntime &&
        this.runtimes.get(failedRuntime.runtimeId) === failedRuntime &&
        failedRuntime.descriptor.generation === descriptor.generation &&
        isRuntimeIdle(failedRuntime.activity) &&
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
        this.setSelectedRuntime(previousActive)
        this.publish(previousActive.snapshot)
        void this.replayPendingSelectedUiRequests()
      } else {
        this.setSelectedRuntime(null)
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
        target.importHistory === undefined &&
        (failure.recoverable || failure.code === 'PI_RUNTIME_HOST_RECOVERY_FAILED') &&
        (failure.code === 'PI_RUNTIME_CONFIRMATION_FAILED' ||
          failure.code === 'PI_RUNTIME_OPERATION_FAILED' ||
          failure.code === 'PI_RUNTIME_STALE_GENERATION' ||
          failure.code === 'PI_RUNTIME_HOST_RECOVERY_FAILED')
      ) {
        return this.activate(target, options, attempt + 1)
      }
      throw failure
    }
  }

  private async forwardUiRequest(envelope: PiHostUiRequestEventEnvelope): Promise<void> {
    try {
      const active = this.active
      const activeAccepted = Boolean(active && this.adoptInFlightGeneration(
        active,
        envelope.runtimeId,
        envelope.runtimeGeneration,
      ))
      const tracked = this.runtimes.get(envelope.runtimeId)
      let trackedHandle: PiRuntimeControlHandle | null = null
      if (
        tracked &&
        tracked.descriptor.generation === envelope.runtimeGeneration
      ) {
        // A Host snapshot can retire a Runtime between the event and this
        // projection. Treat that request as stale instead of leaking a
        // rejection or presenting UI from the replaced Runtime.
        try {
          trackedHandle = this.controlHandleFor(tracked, true)
        } catch (error) {
          if (error instanceof PiRuntimeFrontendError &&
            error.code === 'PI_RUNTIME_STALE_GENERATION') {
            return
          } else {
            throw error
          }
        }
      }
      let controlChanged = false
      const blocking = BLOCKING_EXTENSION_UI_METHODS.has(envelope.request.method)
      if (trackedHandle && trackedHandle.hostEpoch !== envelope.hostEpoch) return
      if (tracked && tracked.descriptor.generation === envelope.runtimeGeneration &&
        (trackedHandle || activeAccepted)) {
        controlChanged = this.applyUiActivity(tracked, envelope)
      }
      if (blocking && tracked && trackedHandle && [...this.pendingPreparations].some((preparation) =>
        preparation.state.runtime === tracked && [...preparation.sessionFiles].some((file) => this.releasingSessionFiles.has(file)))) {
        await this.pool.respondToExtensionUi(tracked.runtimeId, {
          type: 'extension_ui_response', id: envelope.request.id, cancelled: true,
        }, trackedHandle.generation)
        this.updateActivity(tracked, { type: 'ui_responded', id: envelope.request.id })
        return
      }
      if (controlChanged && !blocking) this.publishControlRuntimes()

      const pendingMainConsumers: Promise<void>[] = []
      if (tracked && trackedHandle) {
        for (const listener of this.allUiListeners) {
          try {
            pendingMainConsumers.push(Promise.resolve(listener(envelope, trackedHandle)))
          } catch {
            // Isolate Main consumers while still returning bounded Host credit.
          }
        }
      }
      if (pendingMainConsumers.length > 0) {
        await Promise.allSettled(pendingMainConsumers)
      }

      // Main may answer the question, expire it, or replace its runtime while
      // consumers await. Retain only the still-pending original identity.
      const stillCurrent = tracked && trackedHandle &&
        this.runtimes.get(tracked.runtimeId) === tracked &&
        tracked.descriptor.generation === trackedHandle.generation &&
        tracked.descriptor.sessionId === trackedHandle.sessionId &&
        trackedHandle.hostEpoch === envelope.hostEpoch
      if (!stillCurrent || !tracked || !trackedHandle) return
      try {
        if (this.controlHandleFor(tracked, true).hostEpoch !== trackedHandle.hostEpoch) return
      } catch { return }
      if (blocking) {
        if (!tracked.activity.pendingUiRequests.has(envelope.request.id)) return
        const retained = this.pendingUiEnvelopes.get(tracked.runtimeId) ?? new Map()
        if (!retained.has(envelope.request.id) && retained.size < PI_RUNTIME_PENDING_UI_REQUEST_MAX) {
          retained.set(envelope.request.id, { envelope: structuredClone(envelope), sessionId: trackedHandle.sessionId })
          this.pendingUiEnvelopes.set(tracked.runtimeId, retained)
        }
        if (controlChanged) this.publishControlRuntimes()
      }
      // Selection may have changed during Main consumption. The current
      // identity, rather than the pre-await active flag, owns UI delivery.
      const pendingSelectedConsumers = this.deliverSelectedUiRequest(tracked, trackedHandle, envelope)
      if (pendingSelectedConsumers.length > 0) {
        await Promise.allSettled(pendingSelectedConsumers)
      }
    } finally {
      // Every accepted Host envelope must release its credit, including stale
      // requests dropped during Runtime replacement.
      this.pool.acknowledgeEvent(envelope)
    }
  }

  private async forwardEvent(envelope: PiHostEventEnvelope): Promise<void> {
    try {
      const event = parsePiHostEventPayload(envelope.event)
      if (!event) return
      const active = this.active
      const activeAccepted = Boolean(active && this.adoptInFlightGeneration(
        active,
        envelope.runtimeId,
        envelope.runtimeGeneration,
      ))
      const tracked = this.runtimes.get(envelope.runtimeId)
      let trackedHandle: PiRuntimeControlHandle | null = null
      if (
        tracked &&
        tracked.descriptor.generation === envelope.runtimeGeneration
      ) {
        try {
          trackedHandle = this.controlHandleFor(tracked, true)
        } catch (error) {
          if (error instanceof PiRuntimeFrontendError &&
            error.code === 'PI_RUNTIME_STALE_GENERATION') {
            return
          } else {
            throw error
          }
        }
      }
      let controlChanged = false
      if (tracked && tracked.descriptor.generation === envelope.runtimeGeneration &&
        (trackedHandle || activeAccepted)) {
        controlChanged = this.applyRuntimeActivityEvent(tracked, event)
      }
      if (controlChanged) this.publishControlRuntimes()

      const pending: Promise<void>[] = []
      if (tracked && trackedHandle) {
        for (const listener of this.allEventListeners) {
          try {
            pending.push(Promise.resolve(listener(event, trackedHandle)))
          } catch {
            // Isolate Main consumers while still returning bounded Host credit.
          }
        }
      }
      if (activeAccepted && trackedHandle) {
        for (const listener of this.eventListeners) {
          try {
            pending.push(Promise.resolve(listener(
              event,
              envelope.runtimeGeneration,
              envelope.runtimeId,
              envelope.sequence,
            )))
          } catch {
            // Isolate Main consumers while still returning bounded Host credit.
          }
        }
      }
      if (pending.length > 0) await Promise.allSettled(pending)
    } finally {
      this.pool.acknowledgeEvent(envelope)
    }
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
    this.updateActivity(runtime, { type: 'touch' })
  }

  private updateActivity(runtime: ActiveRuntime, action: RuntimeActivityAction): boolean {
    const settledId = action.type === 'ui_responded' ? action.id
      : action.type === 'ui_request' && action.request.method === 'dismiss' ? action.request.id : null
    if (settledId !== null) {
      const retained = this.pendingUiEnvelopes.get(runtime.runtimeId)
      retained?.delete(settledId)
      if (retained?.size === 0) this.pendingUiEnvelopes.delete(runtime.runtimeId)
      if (runtime === this.active) this.deliveredSelectedUiRequests.delete(settledId)
    }
    const activity = reduceRuntimeActivity(runtime.activity, action)
    if (activity === runtime.activity) return false
    runtime.activity = activity
    runtime.lastUsedAt = this.now()
    return true
  }

  private pinControlRuntime(runtime: ActiveRuntime): PiRuntimeControlLease {
    this.assertAdmission(runtime.hostScope.cwd)
    const handle = this.controlHandleFor(runtime)
    const leaseId = Symbol(runtime.runtimeId)
    this.controlLeases.set(leaseId, {
      runtime,
      generation: runtime.descriptor.generation,
    })
    this.updateActivity(runtime, { type: 'control_pin', delta: 1 })
    return { ...handle, leaseId }
  }

  private setRuntimeDescriptor(
    runtime: ActiveRuntime,
    descriptor: ProjectRuntimeDescriptor,
  ): void {
    const sessionChanged = runtime.descriptor.sessionId !== descriptor.sessionId
    const generationChanged =
      runtime.descriptor.generation !== descriptor.generation
    if (sessionChanged) runtime.selectionToken = undefined
    if (generationChanged) {
      this.clearControlLeases(runtime)
    }
    if (generationChanged || sessionChanged) {
      for (const id of runtime.activity.pendingUiRequests) this.updateActivity(runtime, { type: 'ui_responded', id })
      this.pendingUiEnvelopes.delete(runtime.runtimeId)
      this.updateActivity(runtime, { type: 'delivery_reset' })
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
    this.updateActivity(runtime, { type: 'control_pins_cleared' })
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
    this.updateActivity(runtime, { type: 'command_started' })
    this.publishControlRuntimes()
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
    this.updateActivity(runtime, { type: 'command_finished' })
    this.publishControlRuntimes()
    if (runtime.runtimeId !== this.active?.runtimeId && isRuntimeIdle(runtime.activity)) {
      this.scheduleIdleReclaim(runtime.hostScope)
    }
  }

  private mergeSnapshotActivity(
    runtime: ActiveRuntime,
    snapshot: LocalPiRuntimeSnapshot,
    expectedStateRevision: number,
  ): LocalPiRuntimeSnapshot {
    if (expectedStateRevision !== runtime.activity.stateRevision) {
      // Commands and get_state travel independently from events. Preserve newer live
      // execution fields while retaining the rest of the authoritative read result.
      return snapshot.sessionState ? {
        ...snapshot,
        sessionState: {
          ...snapshot.sessionState,
          isStreaming: runtime.activity.agentRunning,
          isCompacting: runtime.activity.compactionRunning,
          pendingMessageCount: runtime.activity.queuedMessages,
        },
      } : snapshot
    }
    this.updateActivity(runtime, {
      type: 'session_state', state: snapshot.sessionState, expectedStateRevision,
    })
    return snapshot
  }

  private applyRuntimeActivityEvent(
    runtime: ActiveRuntime,
    event: LocalPiRpcEvent,
  ): boolean {
    if (!this.updateActivity(runtime, { type: 'event', event })) return false
    if (runtime.runtimeId !== this.active?.runtimeId && isRuntimeIdle(runtime.activity)) {
      this.scheduleIdleReclaim(runtime.hostScope)
    }
    return true
  }

  private applyUiActivity(
    runtime: ActiveRuntime,
    envelope: PiHostUiRequestEventEnvelope,
  ): boolean {
    if (!this.updateActivity(runtime, { type: 'ui_request', request: envelope.request })) return false
    if (runtime.runtimeId !== this.active?.runtimeId && isRuntimeIdle(runtime.activity)) {
      this.scheduleIdleReclaim(runtime.hostScope)
    }
    return true
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
          this.preparingRuntimeIds.has(runtime.runtimeId) ||
          !isRuntimeIdle(runtime.activity)
        ) {
          return false
        }
        const sessionFile = runtime.descriptor.sessionFile ??
          runtime.lastCredibleSessionFile
        return sessionFile !== null && this.isPersistedSessionFile(sessionFile)
      })
      .sort((left, right) => left.lastUsedAt - right.lastUsedAt)

    let globalExcess = Math.max(0, candidates.length - this.maxRetainedIdleRuntimes)
    let hostExcess = Math.max(0, candidates.filter((runtime) => sameHostScope(runtime.hostScope, scope)).length - this.maxRetainedIdleRuntimesPerHost)
    for (const candidate of candidates) {
      const inHost = sameHostScope(candidate.hostScope, scope)
      if (globalExcess === 0 && hostExcess === 0) break
      if (globalExcess === 0 && !inHost) continue
      if (await this.reclaimRuntimeIfStillIdle(candidate)) {
        globalExcess = Math.max(0, globalExcess - 1)
        if (inHost) hostExcess = Math.max(0, hostExcess - 1)
      }
    }
  }

  private async reclaimRuntimeIfStillIdle(
    candidate: ActiveRuntime,
  ): Promise<boolean> {
    const current = this.runtimes.get(candidate.runtimeId)
    if (
      current !== candidate ||
      this.preparingRuntimeIds.has(candidate.runtimeId) ||
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
      const [result, deliveryResult] = await Promise.all([
        this.pool.command(current.runtimeId, { type: 'get_state' }, generation),
        this.pool.command(current.runtimeId, { type: 'get_delivery_state', expectedSessionId: current.descriptor.sessionId }, generation),
      ])
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
        deliveryResult.runtime.generation !== generation ||
        current.activity.revision !== activityRevision ||
        !isRuntimeIdle(current.activity) ||
        isSessionStateBusy(parsed.data)
      ) {
        return false
      }
      this.parseDeliveryResponse(deliveryResult.response)
      this.observeDeliveryResponse(current, deliveryResult.response)
      if (!isRuntimeIdle(current.activity)) return false
      const confirmedSessionFile = result.runtime.sessionFile ??
        parsed.data.sessionFile ?? sessionFile
      if (!this.isPersistedSessionFile(confirmedSessionFile)) return false

      const retirement = Promise.resolve().then(async () => {
        // Register before disposal can publish. A cached acquisition already
        // resolving this turn can still pin; newer callers await retirement.
        if (this.runtimes.get(current.runtimeId) !== current ||
            this.active?.runtimeId === current.runtimeId ||
            current.descriptor.generation !== generation || !isRuntimeIdle(current.activity)) return false
        await this.pool.disposeRuntime(current.runtimeId, generation)
        if (this.runtimes.get(current.runtimeId) === current) this.dropCachedRuntime(current.runtimeId)
        return true
      }).catch(() => false)
      this.runtimeRetirements.set(current.runtimeId, retirement)
      try {
        return await retirement
      } finally {
        if (this.runtimeRetirements.get(current.runtimeId) === retirement) this.runtimeRetirements.delete(current.runtimeId)
      }
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

  private parseDeliveryResponse(response: LocalPiRpcResponse): LocalPiDeliverySnapshot {
    const data = response.success && response.command === 'get_delivery_state'
      ? localPiDeliverySnapshotSchema.safeParse(response.data) : null
    if (!data?.success) {
      throw new PiRuntimeFrontendError('PI_RUNTIME_CONFIRMATION_FAILED', 'Pi did not confirm its pending message state.')
    }
    return data.data
  }

  private observeDeliveryResponse(runtime: ActiveRuntime, response: LocalPiRpcResponse): void {
    if (!response.success) return
    const delivery = response.command === 'submit_message' ? response.data.delivery
      : response.command === 'get_delivery_state' || response.command === 'mutate_delivery' || response.command === 'resume_delivery' || response.command === 'clear_delivery'
        ? response.data : null
    if (delivery && this.updateActivity(runtime, { type: 'delivery_state', delivery })) {
      this.publishControlRuntimes()
      if (runtime.runtimeId !== this.active?.runtimeId && isRuntimeIdle(runtime.activity)) this.scheduleIdleReclaim(runtime.hostScope)
    }
  }

  private async hydrate(
    descriptor: ProjectRuntimeDescriptor,
    _prepared: { scope: ProjectHostScope; sessionFile?: string; forkSessionFile?: string },
    maintenancePermit?: RuntimeMaintenancePermit,
  ): Promise<LocalPiRuntimeSnapshot> {
    const runtime = this.runtimes.get(descriptor.runtimeId)
    const expectedStateRevision = runtime?.activity.stateRevision
    const [stateResult, commandsResult, deliveryResult] = await Promise.all([
      this.pool.command(descriptor.runtimeId, { type: 'get_state' }, descriptor.generation, undefined, maintenancePermit),
      this.pool.command(descriptor.runtimeId, { type: 'get_commands' }, descriptor.generation, undefined, maintenancePermit),
      this.pool.command(descriptor.runtimeId, { type: 'get_delivery_state', expectedSessionId: descriptor.sessionId }, descriptor.generation, undefined, maintenancePermit),
    ])
    const delivery = this.parseDeliveryResponse(deliveryResult.response)
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
    if (runtime && this.runtimes.get(descriptor.runtimeId) === runtime &&
      runtime.descriptor.generation === descriptor.generation && expectedStateRevision !== undefined) {
      const merged = this.mergeSnapshotActivity(runtime, snapshot.data, expectedStateRevision)
      this.updateActivity(runtime, { type: 'delivery_state', delivery })
      return merged
    }
    return snapshot.data
  }

  private async refreshSession(active: ActiveRuntime) {
    const expectedStateRevision = active.activity.stateRevision
    const expectedGeneration = active.descriptor.generation
    const expectedSessionId = active.descriptor.sessionId
    const [result, deliveryResult] = await Promise.all([
      this.pool.command(active.runtimeId, { type: 'get_state' }, expectedGeneration),
      this.pool.command(active.runtimeId, { type: 'get_delivery_state', expectedSessionId }, expectedGeneration),
    ])
    if (this.runtimes.get(active.runtimeId) !== active ||
      active.descriptor.generation !== expectedGeneration || active.descriptor.sessionId !== expectedSessionId ||
      result.runtime.generation !== expectedGeneration || deliveryResult.runtime.generation !== expectedGeneration) {
      throw new PiRuntimeFrontendError('PI_RUNTIME_STALE_GENERATION', 'The Pi session changed while its pending messages were being refreshed.')
    }
    const delivery = this.parseDeliveryResponse(deliveryResult.response)
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
    const snapshot = this.mergeSnapshotActivity(active, parsed.data, expectedStateRevision)
    this.updateActivity(active, { type: 'delivery_state', delivery })
    return { descriptor, snapshot }
  }

  private async prepareTarget(target: PiRuntimeFrontendTarget) {
    if ([target.sessionFile, target.forkSessionFile, target.importHistory].filter((item) => item !== undefined).length > 1) {
      throw new PiRuntimeFrontendError(
        'PI_RUNTIME_INVALID_TARGET',
        'Pi session and fork sources are mutually exclusive.',
        false,
      )
    }
    const resolved = await this.scopeResolver.prepare(target.scope)
    this.assertAdmission(resolved.cwd)
    return {
      scope: {
        kind: scopeKindFor(target.scope),
        cwd: resolved.cwd,
      } satisfies ProjectHostScope,
      ...(target.sessionFile === undefined ? {} : { sessionFile: target.sessionFile }),
      ...(target.forkSessionFile === undefined ? {} : { forkSessionFile: target.forkSessionFile }),
      ...(target.importHistory === undefined ? {} : { importHistory: target.importHistory }),
    }
  }

  private assertSessionAvailable(target: Pick<PreparedRuntimeTarget, 'sessionFile' | 'forkSessionFile'>): void {
    if ([target.sessionFile, target.forkSessionFile].some((file) =>
      file !== undefined && this.releasingSessionFiles.has(pathIdentity(file)))) {
      throw new PiRuntimeFrontendError('PI_RUNTIME_OPERATION_FAILED', 'The Session is being released. Retry after deletion finishes.')
    }
  }

  private controlHandleFor(
    runtime: ActiveRuntime,
    allowStarting = false,
  ): PiRuntimeControlHandle {
    const identity = this.pool.getRuntimeIdentity(runtime.runtimeId)
    const summary = identity?.runtime
    if (
      !identity ||
      !sameHostScope(identity.scope, runtime.hostScope) ||
      identity.hostState !== 'ready' ||
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
      hostEpoch: identity.hostEpoch,
      runtimeId: runtime.runtimeId,
      generation: runtime.descriptor.generation,
      scope: structuredClone(runtime.scope),
      sessionFile: runtime.descriptor.sessionFile ??
        runtime.lastCredibleSessionFile,
      sessionId: runtime.descriptor.sessionId,
      ...(runtime.selectionToken ? { selectionToken: runtime.selectionToken } : {}),
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

  private requireAbortTarget(): ActiveRuntime {
    const active = this.active
    if (!active || !['ready', 'crashed'].includes(active.snapshot.state)) {
      throw new PiRuntimeFrontendError(
        'PI_RUNTIME_INACTIVE',
        'No Pi runtime is available to abort or recover.',
      )
    }
    return active
  }

  private async disposeActive() {
    const active = this.active
    this.setSelectedRuntime(null)
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

  private publish(snapshot: LocalPiRuntimeSnapshot, updateActive = true, summaries?: PiRuntimeControlSummary[]) {
    const cloned = structuredClone({
      ...snapshot,
      sessionStatuses: this.collectSessionStatuses(summaries),
    })
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
    // Background Runtime activity does not change the selected Runtime
    // snapshot. Reuse the existing snapshot subscription to notify Renderer
    // consumers without adding another IPC channel or state store.
    this.publish(this.publishedSnapshot, false, summaries)
  }

  private collectSessionStatuses(summaries = this.collectControlRuntimes()): LocalPiRuntimeSessionStatus[] {
    return projectRuntimeSessionStatuses(
      summaries,
      [...this.terminalSessionStatuses.values()],
    )
  }

  private recordHostRuntimeFailures(scope: ProjectHostScope): void {
    for (const runtime of this.runtimes.values()) {
      if (!sameHostScope(runtime.hostScope, scope)) continue
      this.rememberRuntimeStatus(runtime, 'failed')
    }
  }

  private rememberRuntimeStatus(
    runtime: ActiveRuntime,
    status: Extract<LocalPiRuntimeSessionStatus['status'], 'completed' | 'failed' | 'cancelled'>,
  ): void {
    const sessionId = runtime.descriptor.sessionId ||
      runtime.snapshot.sessionState?.sessionId
    if (!sessionId) return
    const key = sessionStatusKey(runtime.scope, sessionId, runtime.selectionToken)
    this.terminalSessionStatuses.delete(key)
    this.terminalSessionStatuses.set(key, {
      scope: structuredClone(runtime.scope),
      sessionId,
      ...(runtime.selectionToken ? { selectionToken: runtime.selectionToken } : {}),
      status,
    })
    while (
      this.terminalSessionStatuses.size >
      LOCAL_PI_RUNTIME_SESSION_STATUS_MAX_ITEMS
    ) {
      const oldest = this.terminalSessionStatuses.keys().next().value
      if (typeof oldest !== 'string') break
      this.terminalSessionStatuses.delete(oldest)
    }
  }

  private toFrontendError(error: unknown): PiRuntimeFrontendError {
    if (error instanceof PiRuntimeFrontendError) return error
    if (error instanceof RuntimeMaintenanceBusyError) {
      return new PiRuntimeFrontendError('PI_RUNTIME_MAINTENANCE_PENDING', error.message)
    }
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

  private isAbortRecoveryFailure(error: unknown): boolean {
    if (
      error instanceof ProjectHostPoolError &&
      error.code === 'HOST_CRASHED'
    ) {
      return true
    }
    if (!(error instanceof PiHostControllerError)) return false
    return error.code === 'TIMEOUT' ||
      error.diagnostic?.code === 'RUNTIME_OPERATION_TIMEOUT' ||
      error.diagnostic?.code === 'HOST_RUNTIME_TIMEOUT'
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
        if (host?.state === 'crashed' || summary?.state === 'crashed') {
          this.rememberRuntimeStatus(runtime, 'failed')
        }
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
    this.pendingUiEnvelopes.delete(runtimeId)
    if (this.active?.runtimeId === runtimeId) {
      this.selectedUiIdentity = null
      this.deliveredSelectedUiRequests.clear()
    }
    const runtime = this.runtimes.get(runtimeId)
    if (runtime) {
      const sessionId = runtime.descriptor.sessionId ||
        runtime.snapshot.sessionState?.sessionId
      const key = sessionId
        ? sessionStatusKey(runtime.scope, sessionId, runtime.selectionToken)
        : null
      if (
        key &&
        !this.terminalSessionStatuses.has(key) &&
        isRuntimeIdle(runtime.activity)
      ) {
        this.rememberRuntimeStatus(runtime, runtime.activity.outcome ?? 'completed')
      }
      this.clearControlLeases(runtime)
    }
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

  private assertAdmission(cwd: string): void {
    try {
      this.pool.assertAdmission(cwd)
    } catch (error) {
      throw this.toFrontendError(error)
    }
  }
}
