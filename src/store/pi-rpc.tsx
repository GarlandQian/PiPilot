import * as React from 'react'
import type {
  LocalPiCommandArgumentCompletion,
  LocalPiExtensionUiRequest,
  LocalPiExtensionUiResponse,
  LocalPiImageContent,
  LocalPiModel,
  LocalPiRendererRpcCommand,
  LocalPiRendererRpcResponse,
  LocalPiRendererRpcResponseDataFor,
  LocalPiRpcCommandType,
  LocalPiRpcEventMessage,
  LocalPiRuntimeSnapshot,
  LocalPiSessionEntry,
  LocalPiSessionStats,
  LocalPiSessionState,
  LocalPiSlashCommand,
} from '@/shared/local-pi'
import {
  applyLocalPiProjectorEvent,
  createLocalPiProjectorState,
  replaceLocalPiProjectorSnapshot,
  resetLocalPiProjectorState,
  setLocalPiRetryCancelling,
  type LocalPiProjectorState,
} from '@/renderer/pi-rpc/projector'
import {
  latestLocalPiResponseAnchor,
  projectConversationOutline,
  projectLocalPiTurns,
  settleLocalPiResponseActivities,
  upsertLocalPiResponseActivity,
  type LocalPiResponseActivityRecord,
} from '@/renderer/pi-rpc/presentation'
import {
  dedupeRuntimeAdapterPackages,
  detectRichAdapterCapabilities,
  projectGoalMode,
  projectPlanMode,
  projectRetryActivity,
  type GoalModeProjection,
  type PlanModeProjection,
  type RetryActivityProjection,
} from '@/renderer/pi-rpc/adapters'
import {
  mergeLocalPiEntrySnapshot,
  type LocalPiEntrySnapshot,
} from '@/renderer/pi-rpc/response-provenance'
import {
  canPromotePiFollowUp,
  promotePiFollowUpSnapshot,
  queueTexts,
  reconcilePiQueuedMessages,
  type PendingPiQueuedMessage,
  type PiQueuedMessage,
} from '@/renderer/pi-rpc/queue-payloads'
import type {
  AgentStatus,
  ConversationOutlineItem,
  ResponseActivity,
  Turn,
} from '@/types/chat'
import {
  piIntegrationScopeKey,
  type PiPackageSummary,
} from '@/shared/pi-integrations'
import { usePiIntegrations } from './pi-integrations'
import { conversationScopeKey, useWorkspaceStore } from './workspace'

type QueueMode = 'all' | 'one-at-a-time'

export type PiRpcModel = LocalPiModel
export type PiSessionStats = LocalPiSessionStats

export interface PiQueueSnapshot {
  pendingCount: number
  detailsKnown: boolean
  steering: readonly string[]
  followUp: readonly string[]
  steeringItems: readonly PiQueuedMessage[]
  followUpItems: readonly PiQueuedMessage[]
  steeringMode: QueueMode
  followUpMode: QueueMode
}

interface PiTranscriptSnapshot {
  turns: readonly Turn[]
  outline: readonly ConversationOutlineItem[]
  revision: number
  loading: boolean
}

export interface PiHydrationSnapshot {
  scopeKey: string
  generation: number
  sessionId: string | null
  status: 'loading' | 'ready' | 'error'
  error: string | null
}

export type PiConversationPresentation =
  | { status: 'empty' }
  | { status: 'loading' }
  | { status: 'ready'; sessionId: string }
  | { status: 'error'; error: string }

export type PiConversationActivationPresentation =
  | { status: 'loading' }
  | { status: 'error'; error: string }

export interface PiGenerationHydrationTarget {
  scopeKey: string
  generation: number
  sessionId: string
}

export interface PiGenerationHydrationWaiter {
  resolveHydration(success: boolean): void
}

export interface PiForkDraftTarget {
  scopeKey: string
  generation: number
  sessionId: string | null
  text: string
}

export function piForkDraftHydrationOutcome(
  target: PiForkDraftTarget,
  activeScopeKey: string,
  runtime: Pick<
    LocalPiRuntimeSnapshot,
    'generation' | 'state' | 'sessionState'
  > | null,
  hydration: PiHydrationSnapshot,
) {
  if (activeScopeKey !== target.scopeKey) return 'discard' as const
  if (!runtime || runtime.generation <= target.generation) {
    if (
      runtime?.generation === target.generation &&
      (runtime.state === 'error' ||
        runtime.state === 'crashed' ||
        runtime.state === 'stopped')
    ) {
      return 'discard' as const
    }
    return 'pending' as const
  }
  if (
    runtime.state === 'error' ||
    runtime.state === 'crashed' ||
    runtime.state === 'stopped'
  ) {
    return 'discard' as const
  }
  if (runtime.state !== 'ready') return 'pending' as const

  const sessionId = runtime.sessionState?.sessionId ?? null
  if (!sessionId || sessionId === target.sessionId) return 'discard' as const
  if (
    hydration.scopeKey !== target.scopeKey ||
    hydration.generation > runtime.generation
  ) {
    return 'discard' as const
  }
  if (
    hydration.generation < runtime.generation ||
    hydration.sessionId !== sessionId ||
    hydration.status === 'loading'
  ) {
    return 'pending' as const
  }
  return hydration.status === 'ready' ? 'apply' as const : 'discard' as const
}

export function cancelPiGenerationHydrationWaiter<
  TWaiter extends PiGenerationHydrationWaiter,
>(waiterRef: { current: TWaiter | null }) {
  const waiter = waiterRef.current
  waiterRef.current = null
  waiter?.resolveHydration(false)
  return waiter
}

interface PiRuntimeView {
  runtime: LocalPiRuntimeSnapshot | null
  session: LocalPiSessionState | null
  hydration: PiHydrationSnapshot
  status: AgentStatus
  models: readonly PiRpcModel[]
  selectedModel: PiRpcModel | null
  thinkingLevels: readonly LocalPiSessionState['thinkingLevel'][]
  commands: readonly LocalPiSlashCommand[]
  stats: PiSessionStats | null
  queue: PiQueueSnapshot
  loading: boolean
  error: string | null
  compacting: boolean
  retryActivity: RetryActivityProjection
}

interface PiExtensionDialog {
  generation: number
  sessionId: string | null
  request: Extract<
    LocalPiExtensionUiRequest,
    { method: 'select' | 'confirm' | 'input' | 'editor' }
  >
}

export interface PiExtensionNotification {
  id: string
  message: string
  type: 'info' | 'warning' | 'error'
  autoReveal?: boolean
}

export interface PiExtensionWidget {
  key: string
  lines: readonly string[]
  placement: 'aboveEditor' | 'belowEditor'
}

export interface PiResponseActivityScope {
  scopeKey: string
  generation: number
  sessionId: string
}

interface PiActiveResponseProvenance extends PiResponseActivityScope {
  anchorEntryId: string
}

export interface PiPendingPromptProvenance extends PiResponseActivityScope {
  operationId: number
  initialMessageCount: number
  accepted: boolean
  activities: readonly ResponseActivity[]
}

export interface PiPromptAcceptance extends PiResponseActivityScope {
  operationId: number
}

interface PiExtensionView {
  dialog: PiExtensionDialog | null
  dialogBusy: boolean
  notifications: readonly PiExtensionNotification[]
  statuses: Readonly<Record<string, string>>
  widgets: readonly PiExtensionWidget[]
  title: string | null
  working: { message: string | null; visible: boolean }
  unsupportedMethods: readonly string[]
  draftReplacement: { revision: number; text: string } | null
  goalMode: GoalModeProjection | null
  planMode: PlanModeProjection | null
}

interface PiRpcActions {
  abort(): Promise<void>
  compact(instructions?: string): Promise<void>
  completeCommandArguments(
    commandName: string,
    argumentPrefix: string,
  ): Promise<readonly LocalPiCommandArgumentCompletion[]>
  dismissNotification(id: string): void
  markNotificationRevealed(id: string): void
  fork(entryId: string): Promise<void>
  refresh(): Promise<void>
  request<TCommand extends LocalPiRendererRpcCommand>(
    command: TCommand,
  ): Promise<LocalPiRendererRpcResponseDataFor<TCommand['type']>>
  respondToExtension(response: LocalPiExtensionUiResponse): Promise<void>
  selectModel(provider: string, modelId: string): Promise<void>
  selectThinking(level: LocalPiSessionState['thinkingLevel']): Promise<void>
  send(
    text: string,
    action: 'prompt' | 'follow_up' | 'steer',
    images?: readonly LocalPiImageContent[],
  ): Promise<void>
  promoteFollowUp(itemId: string): Promise<void>
  setAutoCompaction(enabled: boolean): Promise<void>
  setAutoRetry(enabled: boolean): Promise<void>
  abortRetry(): Promise<void>
  setQueueMode(kind: 'steering' | 'followUp', mode: QueueMode): Promise<void>
}

interface PiEntryPage {
  appendTo: LocalPiEntrySnapshot | null
  append: boolean
  entries: readonly LocalPiSessionEntry[]
  leafId: string | null
}

const EMPTY_QUEUE: PiQueueSnapshot = Object.freeze({
  pendingCount: 0,
  detailsKnown: false,
  steering: [],
  followUp: [],
  steeringItems: [],
  followUpItems: [],
  steeringMode: 'one-at-a-time',
  followUpMode: 'one-at-a-time',
})

function runtimeFailureMessage(
  runtime: Pick<LocalPiRuntimeSnapshot, 'stderr' | 'diagnostics'> | null,
) {
  return runtime?.diagnostics[runtime.diagnostics.length - 1]?.message ||
    runtime?.stderr ||
    'Pi disconnected.'
}

function reconcileQueueFromSession(
  previous: PiQueueSnapshot,
  session: LocalPiSessionState,
): PiQueueSnapshot {
  const detailedCount = previous.steering.length + previous.followUp.length
  const keepDetails = previous.detailsKnown &&
    detailedCount === session.pendingMessageCount
  return {
    pendingCount: session.pendingMessageCount,
    detailsKnown: keepDetails,
    steering: keepDetails ? previous.steering : [],
    followUp: keepDetails ? previous.followUp : [],
    steeringItems: keepDetails ? previous.steeringItems : [],
    followUpItems: keepDetails ? previous.followUpItems : [],
    steeringMode: session.steeringMode,
    followUpMode: session.followUpMode,
  }
}

const TranscriptContext = React.createContext<PiTranscriptSnapshot | null>(null)
const RuntimeContext = React.createContext<PiRuntimeView | null>(null)
const ExtensionContext = React.createContext<PiExtensionView | null>(null)
const ActionsContext = React.createContext<PiRpcActions | null>(null)

function responseData<TCommand extends LocalPiRpcCommandType>(
  response: LocalPiRendererRpcResponse,
  command: TCommand,
): LocalPiRendererRpcResponseDataFor<TCommand> {
  if (!response.success) throw new Error(response.error || `Pi rejected ${command}.`)
  if (response.command !== command) throw new Error(`Unexpected Pi response for ${response.command}.`)
  return response.data as LocalPiRendererRpcResponseDataFor<TCommand>
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'The Pi operation failed.'
}

const ANSI_OSC_SEQUENCE = /\u001B\][^\u0007]*(?:\u0007|\u001B\\)/gu
const ANSI_CSI_SEQUENCE = /\u001B\[[0-?]*[ -/]*[@-~]/gu
const MAX_RESPONSE_ACTIVITY_TEXT = 4_000
const MAX_RESPONSE_ACTIVITY_DETAILS = 12
const MAX_PENDING_RESPONSE_ACTIVITIES = 32

function extensionDisplayText(value: string) {
  return value
    .replace(ANSI_OSC_SEQUENCE, '')
    .replace(ANSI_CSI_SEQUENCE, '')
}

function responseActivityText(value: string) {
  const clean = extensionDisplayText(value)
  return clean.length <= MAX_RESPONSE_ACTIVITY_TEXT
    ? clean
    : `${clean.slice(0, MAX_RESPONSE_ACTIVITY_TEXT)}\n...`
}

function upsertExtensionNotification(
  notifications: readonly PiExtensionNotification[],
  notification: PiExtensionNotification,
) {
  const next = notifications.filter((item) => item.id !== notification.id)
  return [...next, notification].slice(-5)
}

function sameResponseActivityScope(
  left: PiResponseActivityScope,
  right: PiResponseActivityScope,
) {
  return left.scopeKey === right.scopeKey &&
    left.generation === right.generation &&
    left.sessionId === right.sessionId
}

export function isRegisteredPiExtensionCommandPrompt(
  text: string,
  commands: readonly LocalPiSlashCommand[],
): boolean {
  if (!text.startsWith('/')) return false
  const separator = text.indexOf(' ')
  const commandName = text.slice(1, separator === -1 ? undefined : separator)
  if (!commandName) return false
  return commands.some((command) =>
    command.source === 'extension' && command.name === commandName)
}

export function createPiPromptAcceptance({
  operationId,
  scopeKey,
  generation,
  sessionId,
}: PiResponseActivityScope & { operationId: number }): PiPromptAcceptance {
  return { operationId, scopeKey, generation, sessionId }
}

export function clearPiPromptAcceptance(
  acceptance: PiPromptAcceptance | null,
  operationId: number,
): PiPromptAcceptance | null {
  return acceptance?.operationId === operationId ? null : acceptance
}

export function reconcilePiPromptAcceptanceScope(
  acceptance: PiPromptAcceptance | null,
  scope: PiResponseActivityScope,
): PiPromptAcceptance | null {
  return acceptance && sameResponseActivityScope(acceptance, scope)
    ? acceptance
    : null
}

export function createPiPendingPromptProvenance({
  operationId,
  scopeKey,
  generation,
  sessionId,
  initialMessageCount,
}: PiResponseActivityScope & {
  operationId: number
  initialMessageCount: number
}): PiPendingPromptProvenance {
  return {
    operationId,
    scopeKey,
    generation,
    sessionId,
    initialMessageCount,
    accepted: false,
    activities: [],
  }
}

export function capturePiPendingPromptActivity(
  pending: PiPendingPromptProvenance | null,
  scope: PiResponseActivityScope,
  activity: ResponseActivity,
): PiPendingPromptProvenance | null {
  if (!pending || !sameResponseActivityScope(pending, scope)) return null
  const index = pending.activities.findIndex((item) => item.id === activity.id)
  if (index === -1) {
    return {
      ...pending,
      activities: [...pending.activities, activity].slice(-MAX_PENDING_RESPONSE_ACTIVITIES),
    }
  }
  const activities = [...pending.activities]
  activities[index] = activity
  return { ...pending, activities }
}

export function settlePiPendingPromptActivities(
  pending: PiPendingPromptProvenance | null,
  scope: PiResponseActivityScope,
  activityId?: string,
): PiPendingPromptProvenance | null {
  if (!pending || !sameResponseActivityScope(pending, scope)) return null
  let changed = false
  const activities = pending.activities.map((activity) => {
    if (
      (activityId !== undefined && activity.id !== activityId) ||
      activity.state === 'settled'
    ) {
      return activity
    }
    changed = true
    return { ...activity, state: 'settled' } as ResponseActivity
  })
  return changed ? { ...pending, activities } : pending
}

export function acceptPiPendingPrompt(
  pending: PiPendingPromptProvenance | null,
  operationId: number,
): PiPendingPromptProvenance | null {
  if (!pending || pending.operationId !== operationId) return pending
  return pending.accepted ? pending : { ...pending, accepted: true }
}

export function clearPiPendingPrompt(
  pending: PiPendingPromptProvenance | null,
  operationId: number,
): PiPendingPromptProvenance | null {
  return pending?.operationId === operationId ? null : pending
}

export function reconcilePiPendingPromptScope(
  pending: PiPendingPromptProvenance | null,
  scope: PiResponseActivityScope,
): PiPendingPromptProvenance | null {
  return pending && sameResponseActivityScope(pending, scope) ? pending : null
}

export function projectPiPendingPromptActivities(
  pending: PiPendingPromptProvenance | null,
  provenance: PiResponseActivityScope & { anchorEntryId: string },
  firstOrder: number,
): readonly LocalPiResponseActivityRecord[] | null {
  if (!pending || !sameResponseActivityScope(pending, provenance)) return null
  return pending.activities.map((activity, index) => ({
    ...provenance,
    order: firstOrder + index,
    activity,
  }))
}

export function piPendingPromptSnapshotAnchor(
  pending: PiPendingPromptProvenance | null,
  scope: PiResponseActivityScope,
  projection: LocalPiProjectorState,
): string | null {
  if (
    !pending?.accepted ||
    !sameResponseActivityScope(pending, scope) ||
    projection.generation !== pending.generation ||
    projection.sessionId !== pending.sessionId ||
    projection.messages.length <= pending.initialMessageCount
  ) {
    return null
  }
  return latestLocalPiResponseAnchor(projection)
}

export function derivePiConversationPresentation({
  activeScopeKey,
  activeSessionId,
  activation,
  runtime,
  session,
  hydration,
  runtimeLoading,
  transcriptLoading,
}: {
  activeScopeKey: string
  activeSessionId: string
  activation: PiConversationActivationPresentation | null
  runtime: Pick<
    LocalPiRuntimeSnapshot,
    'generation' | 'state' | 'sessionState' | 'stderr' | 'diagnostics'
  > | null
  session: Pick<LocalPiSessionState, 'sessionId'> | null
  hydration: PiHydrationSnapshot
  runtimeLoading: boolean
  transcriptLoading: boolean
}): PiConversationPresentation {
  if (activation?.status === 'loading') return { status: 'loading' }
  if (activation?.status === 'error') return activation
  if (!activeSessionId) return { status: 'empty' }
  if (!runtime && hydration.status === 'error') {
    return {
      status: 'error',
      error: hydration.error || 'Pi disconnected.',
    }
  }

  const runtimeFailed = runtime?.state === 'error' ||
    runtime?.state === 'crashed' ||
    runtime?.state === 'stopped'
  if (runtimeFailed) {
    return {
      status: 'error',
      error: hydration.error || runtimeFailureMessage(runtime),
    }
  }
  if (
    !runtime ||
    runtime.state !== 'ready' ||
    hydration.scopeKey !== activeScopeKey ||
    runtime.sessionState?.sessionId !== activeSessionId ||
    session?.sessionId !== activeSessionId ||
    hydration.generation !== runtime.generation ||
    hydration.sessionId !== activeSessionId
  ) {
    return { status: 'loading' }
  }
  if (hydration.status === 'error') {
    return {
      status: 'error',
      error: hydration.error || runtimeFailureMessage(runtime),
    }
  }
  if (
    hydration.status !== 'ready' ||
    runtimeLoading ||
    transcriptLoading
  ) {
    return { status: 'loading' }
  }
  return { status: 'ready', sessionId: activeSessionId }
}

export function piGenerationHydrationOutcome(
  target: PiGenerationHydrationTarget | null,
  activeScopeKey: string,
  activeSessionId: string,
  runtime: Pick<
    LocalPiRuntimeSnapshot,
    'generation' | 'state' | 'sessionState'
  > | null,
  session: Pick<LocalPiSessionState, 'sessionId'> | null,
  hydration: PiHydrationSnapshot,
  runtimeLoading: boolean,
  transcriptLoading: boolean,
) {
  if (!target || !runtime) {
    return 'pending' as const
  }
  // Runtime generations are monotonic only inside one Runtime. Main publishes
  // only the selected Runtime, so a different numeric generation can be an old
  // view of another Runtime rather than a replacement of this target.
  if (
    activeScopeKey !== target.scopeKey ||
    runtime.generation !== target.generation
  ) {
    return 'pending' as const
  }
  if (
    runtime.state === 'error' ||
    runtime.state === 'crashed' ||
    runtime.state === 'stopped'
  ) {
    return 'error' as const
  }
  if (
    runtime.state !== 'ready' ||
    activeSessionId !== target.sessionId ||
    runtime.sessionState?.sessionId !== target.sessionId ||
    session?.sessionId !== target.sessionId ||
    hydration.scopeKey !== target.scopeKey ||
    hydration.generation !== runtime.generation ||
    hydration.sessionId !== target.sessionId
  ) {
    return 'pending' as const
  }
  if (hydration.status === 'error') return 'error' as const
  return hydration.status === 'ready' && !runtimeLoading && !transcriptLoading
    ? 'ready' as const
    : 'pending' as const
}

export function PiRpcProvider({ children }: { children: React.ReactNode }) {
  const api = typeof window === 'undefined' ? undefined : window.pipilot
  const workspace = useWorkspaceStore()
  const integrations = usePiIntegrations()
  const activeScopeKey = conversationScopeKey(workspace.activeScope)
  const [runtime, setRuntime] = React.useState<LocalPiRuntimeSnapshot | null>(null)
  const [session, setSession] = React.useState<LocalPiSessionState | null>(null)
  const [models, setModels] = React.useState<PiRpcModel[]>([])
  const [thinkingLevels, setThinkingLevels] = React.useState<LocalPiSessionState['thinkingLevel'][]>([])
  const [commands, setCommands] = React.useState<LocalPiSlashCommand[]>([])
  const [stats, setStats] = React.useState<PiSessionStats | null>(null)
  const [queue, setQueue] = React.useState<PiQueueSnapshot>(EMPTY_QUEUE)
  const [transcriptLoading, setTranscriptLoading] = React.useState(Boolean(api))
  const [projection, setProjection] = React.useState<LocalPiProjectorState>(() =>
    createLocalPiProjectorState({ generation: 0, sessionId: 'none' }))
  const [loading, setLoading] = React.useState(Boolean(api))
  const [error, setError] = React.useState<string | null>(
    api ? null : 'The PiPilot desktop bridge is unavailable.',
  )
  const initialHydration = React.useMemo<PiHydrationSnapshot>(() => ({
    scopeKey: activeScopeKey,
    generation: 0,
    sessionId: null,
    status: api ? 'loading' : 'error',
    error: api ? null : 'The PiPilot desktop bridge is unavailable.',
  }), [activeScopeKey, api])
  const [hydration, setHydration] = React.useState(initialHydration)
  const [compacting, setCompacting] = React.useState(false)
  const [dialogs, setDialogs] = React.useState<PiExtensionDialog[]>([])
  const [dialogBusy, setDialogBusy] = React.useState(false)
  const [notifications, setNotifications] = React.useState<PiExtensionNotification[]>([])
  const [statuses, setStatuses] = React.useState<Record<string, string>>({})
  const [widgets, setWidgets] = React.useState<PiExtensionWidget[]>([])
  const [extensionTitle, setExtensionTitle] = React.useState<string | null>(null)
  const [workingMessage, setWorkingMessage] = React.useState<string | null>(null)
  const [workingVisible, setWorkingVisible] = React.useState(false)
  const [responseActivities, setResponseActivities] = React.useState<
    readonly LocalPiResponseActivityRecord[]
  >([])
  const [responseActivityRevision, setResponseActivityRevision] = React.useState(0)
  const [unsupportedMethods, setUnsupportedMethods] = React.useState<string[]>([])
  // A runtime replacement can load different configured packages or merged
  // settings. Keep rich adapters off until the matching integration snapshot
  // has been refreshed for this process generation.
  const [adapterRuntimePackages, setAdapterRuntimePackages] = React.useState<{
    generation: number
    scopeKey: string
    packages: readonly PiPackageSummary[]
  } | null>(null)
  const [draftReplacement, setDraftReplacement] = React.useState<{
    revision: number
    text: string
  } | null>(null)
  const [pendingForkDraft, setPendingForkDraft] = React.useState<PiForkDraftTarget | null>(null)
  const runtimeRef = React.useRef<LocalPiRuntimeSnapshot | null>(null)
  const sessionRef = React.useRef<LocalPiSessionState | null>(null)
  const hydrationRef = React.useRef(initialHydration)
  const refreshNonce = React.useRef(0)
  const conversationRefreshNonce = React.useRef(0)
  const protocolRecoveryPending = React.useRef(false)
  const hydrationKey = React.useRef('')
  const notificationSequence = React.useRef(0)
  const draftRevision = React.useRef(0)
  const projectionRef = React.useRef(projection)
  const responseActivitiesRef = React.useRef(responseActivities)
  const activeResponseRef = React.useRef<PiActiveResponseProvenance | null>(null)
  const pendingPromptRef = React.useRef<PiPendingPromptProvenance | null>(null)
  const promptAcceptanceRef = React.useRef<PiPromptAcceptance | null>(null)
  const promptOperationSequence = React.useRef(0)
  const responseActivitySequence = React.useRef(0)
  const workingMessageRef = React.useRef<string | null>(null)
  const workingVisibleRef = React.useRef(false)
  const forkInFlight = React.useRef<Promise<void> | null>(null)
  const projectionScopeKey = React.useRef(activeScopeKey)
  const queueRef = React.useRef<PiQueueSnapshot>(EMPTY_QUEUE)
  const queueItemSequence = React.useRef(0)
  const pendingQueuedMessages = React.useRef<PendingPiQueuedMessage[]>([])
  const queueConversion = React.useRef<{
    steering: readonly PiQueuedMessage[]
    followUp: readonly PiQueuedMessage[]
    latestOfficial: { steering: readonly string[]; followUp: readonly string[] } | null
  } | null>(null)

  const nextQueueItemId = React.useCallback(() =>
    `queue-${++queueItemSequence.current}`, [])

  const commitQueue = React.useCallback((
    next: PiQueueSnapshot | ((previous: PiQueueSnapshot) => PiQueueSnapshot),
  ) => {
    const value = typeof next === 'function' ? next(queueRef.current) : next
    queueRef.current = value
    setQueue(value)
  }, [])

  const expectedIntegrationScope = workspace.activeScope.kind === 'project'
    ? { kind: 'project' as const, workspaceId: workspace.activeScope.workspaceId }
    : { kind: 'global' as const }
  const expectedIntegrationScopeKey = piIntegrationScopeKey(expectedIntegrationScope)
  const runtimeGenerationForAdapters = runtime?.state === 'ready'
    ? runtime.generation
    : null

  React.useEffect(() => {
    if (runtimeGenerationForAdapters === null) {
      setAdapterRuntimePackages(null)
      return
    }
    let cancelled = false
    setAdapterRuntimePackages(null)
    const adapterScopes = expectedIntegrationScope.kind === 'project'
      ? [{ kind: 'global' as const }, expectedIntegrationScope]
      : [expectedIntegrationScope]
    void Promise.all(adapterScopes.map((scope) => integrations.loadScope(scope))).then((snapshots) => {
      if (
        cancelled ||
        snapshots.some((snapshot, index) =>
          snapshot?.state !== 'ready' ||
          piIntegrationScopeKey(snapshot.scope) !== piIntegrationScopeKey(adapterScopes[index]!))
      ) return
      const currentRuntime = runtimeRef.current
      if (
        currentRuntime?.state === 'ready' &&
        currentRuntime.generation === runtimeGenerationForAdapters
      ) {
        const packages = dedupeRuntimeAdapterPackages(snapshots.flatMap((snapshot) =>
          snapshot?.state === 'ready' ? snapshot.packages : []))
        setAdapterRuntimePackages({
          generation: runtimeGenerationForAdapters,
          scopeKey: expectedIntegrationScopeKey,
          packages,
        })
      }
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [
    expectedIntegrationScopeKey,
    integrations.loadScope,
    runtimeGenerationForAdapters,
  ])

  const adapterPackages = adapterRuntimePackages?.generation === runtimeGenerationForAdapters &&
    adapterRuntimePackages.scopeKey === expectedIntegrationScopeKey
    ? adapterRuntimePackages.packages
    : []
  const adapterCapabilities = React.useMemo(() => detectRichAdapterCapabilities({
    packages: adapterPackages,
    commands,
  }), [adapterPackages, commands])
  const planMode = React.useMemo(() => projectPlanMode(
    projection,
    projectionScopeKey.current === activeScopeKey
      ? adapterCapabilities.planMode
      : null,
    { scopeKey: activeScopeKey, statuses, widgets },
  ), [activeScopeKey, adapterCapabilities.planMode, projection, statuses, widgets])
  const goalMode = React.useMemo(() => projectGoalMode(
    projection,
    projectionScopeKey.current === activeScopeKey
      ? adapterCapabilities.goal
      : null,
    { scopeKey: activeScopeKey, statuses },
  ), [activeScopeKey, adapterCapabilities.goal, projection, statuses])
  const retryActivity = React.useMemo<RetryActivityProjection>(() =>
    projectionScopeKey.current === activeScopeKey
      ? projectRetryActivity(projection)
      : { kind: 'idle' },
  [activeScopeKey, projection])

  React.useEffect(() => {
    if (!pendingForkDraft) return
    const outcome = piForkDraftHydrationOutcome(
      pendingForkDraft,
      activeScopeKey,
      runtime,
      hydration,
    )
    if (outcome === 'pending') return
    setPendingForkDraft(null)
    if (outcome === 'apply') {
      setDraftReplacement({
        revision: ++draftRevision.current,
        text: pendingForkDraft.text,
      })
    }
  }, [activeScopeKey, hydration, pendingForkDraft, runtime])

  const commitProjection = React.useCallback((next: LocalPiProjectorState) => {
    if (next === projectionRef.current) return
    projectionRef.current = next
    setProjection(next)
  }, [])

  const commitResponseActivities = React.useCallback((
    next: readonly LocalPiResponseActivityRecord[],
  ) => {
    if (next === responseActivitiesRef.current) return
    responseActivitiesRef.current = next
    setResponseActivities(next)
    setResponseActivityRevision((revision) => revision + 1)
  }, [])

  const flushPendingPromptActivities = React.useCallback((
    provenance: PiActiveResponseProvenance,
  ) => {
    const pending = pendingPromptRef.current
    const projected = projectPiPendingPromptActivities(
      pending,
      provenance,
      responseActivitySequence.current + 1,
    )
    if (!pending || !projected) return false
    let next = responseActivitiesRef.current
    for (const record of projected) {
      next = upsertLocalPiResponseActivity(next, record)
    }
    responseActivitySequence.current += projected.length
    commitResponseActivities(next)
    pendingPromptRef.current = clearPiPendingPrompt(
      pendingPromptRef.current,
      pending.operationId,
    )
    return true
  }, [commitResponseActivities])

  const promotePendingPromptActivities = React.useCallback((
    pending: PiPendingPromptProvenance,
  ) => {
    const promoted = pending.activities.flatMap((activity): PiExtensionNotification[] => {
      const id = `pending-prompt:${pending.operationId}:${activity.id}`
      switch (activity.kind) {
        case 'notification':
          return [{
            id,
            message: activity.message,
            type: activity.tone,
            autoReveal: true,
          }]
        case 'extension-error':
          return [{
            id,
            message: activity.message,
            type: 'error',
            autoReveal: true,
          }]
        case 'status':
          return activity.message
            ? [{
                id,
                message: `${activity.label}: ${activity.message}`,
                type: 'info',
                autoReveal: true,
              }]
            : []
        case 'widget':
          return activity.summary
            ? [{
                id,
                message: `${activity.label}: ${activity.summary}`,
                type: 'info',
                autoReveal: true,
              }]
            : []
        case 'working':
          return activity.message
            ? [{ id, message: activity.message, type: 'info', autoReveal: true }]
            : []
        case 'retry':
          return activity.message
            ? [{
                id,
                message: activity.message,
                type: activity.phase === 'error' ? 'error' : 'info',
                autoReveal: true,
              }]
            : []
      }
    })
    if (promoted.length === 0) return
    setNotifications((previous) => promoted.reduce(
      (next, notification) => upsertExtensionNotification(next, notification),
      previous,
    ))
  }, [])

  const captureResponseActivity = React.useCallback((activity: ResponseActivity) => {
    const provenance = activeResponseRef.current
    const currentRuntime = runtimeRef.current
    const currentSessionId = sessionRef.current?.sessionId
    if (!currentSessionId || currentRuntime?.generation === undefined) return false
    const currentScope = {
      scopeKey: projectionScopeKey.current,
      generation: currentRuntime.generation,
      sessionId: currentSessionId,
    }
    const projectionMatches = projectionRef.current.generation === currentScope.generation &&
      projectionRef.current.sessionId === currentScope.sessionId
    if (
      provenance &&
      projectionMatches &&
      sameResponseActivityScope(provenance, currentScope)
    ) {
      commitResponseActivities(upsertLocalPiResponseActivity(
        responseActivitiesRef.current,
        {
          ...provenance,
          order: ++responseActivitySequence.current,
          activity,
        },
      ))
      return true
    }
    if (provenance) activeResponseRef.current = null
    if (!projectionMatches) return false
    const pending = capturePiPendingPromptActivity(
      pendingPromptRef.current,
      currentScope,
      activity,
    )
    if (!pending) return false
    pendingPromptRef.current = pending
    return true
  }, [commitResponseActivities])

  const settleResponseActivities = React.useCallback((activityId?: string) => {
    const currentRuntime = runtimeRef.current
    const currentSessionId = sessionRef.current?.sessionId
    if (currentSessionId && currentRuntime?.generation !== undefined) {
      const currentScope = {
        scopeKey: projectionScopeKey.current,
        generation: currentRuntime.generation,
        sessionId: currentSessionId,
      }
      const pending = settlePiPendingPromptActivities(
        pendingPromptRef.current,
        currentScope,
        activityId,
      )
      if (pending) pendingPromptRef.current = pending
    }
    const provenance = activeResponseRef.current
    if (!provenance) return
    commitResponseActivities(settleLocalPiResponseActivities(
      responseActivitiesRef.current,
      provenance,
      activityId,
    ))
  }, [commitResponseActivities])

  const acceptPendingPromptForScope = React.useCallback((
    scope: PiResponseActivityScope,
  ) => {
    const pending = reconcilePiPendingPromptScope(pendingPromptRef.current, scope)
    if (pending) {
      pendingPromptRef.current = acceptPiPendingPrompt(
        pendingPromptRef.current,
        pending.operationId,
      )
    }
    const acceptance = reconcilePiPromptAcceptanceScope(
      promptAcceptanceRef.current,
      scope,
    )
    if (acceptance) {
      promptAcceptanceRef.current = clearPiPromptAcceptance(
        promptAcceptanceRef.current,
        acceptance.operationId,
      )
    }
  }, [])

  const restoreActiveResponseProvenance = React.useCallback((
    nextProjection: LocalPiProjectorState,
    scopeKey: string,
    active: boolean,
  ) => {
    const scope = {
      scopeKey,
      generation: nextProjection.generation,
      sessionId: nextProjection.sessionId,
    }
    const pending = reconcilePiPendingPromptScope(pendingPromptRef.current, scope)
    if (pendingPromptRef.current && !pending) pendingPromptRef.current = null
    if (pending) {
      const anchorEntryId = piPendingPromptSnapshotAnchor(pending, scope, nextProjection)
      if (!anchorEntryId) {
        activeResponseRef.current = null
        return
      }
      const provenance = { ...scope, anchorEntryId }
      if (!active) {
        pendingPromptRef.current = settlePiPendingPromptActivities(pending, scope)
      }
      flushPendingPromptActivities(provenance)
      activeResponseRef.current = active ? provenance : null
      return
    }
    if (!active) {
      activeResponseRef.current = null
      return
    }
    const anchorEntryId = latestLocalPiResponseAnchor(nextProjection)
    if (!anchorEntryId) {
      activeResponseRef.current = null
      return
    }
    activeResponseRef.current = {
      scopeKey,
      generation: nextProjection.generation,
      sessionId: nextProjection.sessionId,
      anchorEntryId,
    }
  }, [flushPendingPromptActivities])

  const commitSession = React.useCallback((next: LocalPiSessionState | null) => {
    sessionRef.current = next
    setSession(next)
    commitQueue((previous) => next
      ? reconcileQueueFromSession(previous, next)
      : EMPTY_QUEUE)
  }, [commitQueue])

  const commitHydration = React.useCallback((next: PiHydrationSnapshot) => {
    hydrationRef.current = next
    setHydration(next)
  }, [])

  const resetGeneration = React.useCallback((snapshot: LocalPiRuntimeSnapshot) => {
    const activeSession = snapshot.state === 'ready' ? snapshot.sessionState : null
    const canHydrate = snapshot.state === 'ready' ||
      snapshot.state === 'starting' ||
      snapshot.state === 'replacing'
    refreshNonce.current += 1
    conversationRefreshNonce.current += 1
    hydrationKey.current = ''
    projectionScopeKey.current = activeScopeKey
    setLoading(
      snapshot.state === 'ready' ||
      snapshot.state === 'starting' ||
      snapshot.state === 'replacing',
    )
    setModels([])
    setThinkingLevels([])
    setCommands([])
    setStats(null)
    queueRef.current = EMPTY_QUEUE
    pendingQueuedMessages.current = []
    queueConversion.current = null
    commitQueue(EMPTY_QUEUE)
    setTranscriptLoading(
      snapshot.state === 'ready' ||
      snapshot.state === 'starting' ||
      snapshot.state === 'replacing',
    )
    commitProjection(resetLocalPiProjectorState(projectionRef.current, {
      generation: snapshot.generation,
      sessionId: activeSession?.sessionId ?? 'pending',
    }))
    setDialogs([])
    setDialogBusy(false)
    setNotifications([])
    setStatuses({})
    setWidgets([])
    activeResponseRef.current = null
    pendingPromptRef.current = null
    promptAcceptanceRef.current = null
    responseActivitySequence.current = 0
    commitResponseActivities([])
    setExtensionTitle(null)
    workingMessageRef.current = null
    setWorkingMessage(null)
    workingVisibleRef.current = false
    setWorkingVisible(false)
    setUnsupportedMethods([])
    setDraftReplacement(null)
    setCompacting(false)
    setError(null)
    commitHydration({
      scopeKey: activeScopeKey,
      generation: snapshot.generation,
      sessionId: activeSession?.sessionId ?? null,
      status: canHydrate ? 'loading' : 'error',
      error: canHydrate ? null : runtimeFailureMessage(snapshot),
    })
    commitSession(activeSession)
  }, [activeScopeKey, commitHydration, commitProjection, commitQueue, commitResponseActivities, commitSession])

  const runCommand = React.useCallback(async <TCommand extends LocalPiRendererRpcCommand,>(
    command: TCommand,
  ): Promise<LocalPiRendererRpcResponseDataFor<TCommand['type']>> => {
    const expectedGeneration = runtimeRef.current?.generation
    const expectedSessionId = sessionRef.current?.sessionId
    const expectedScopeKey = projectionScopeKey.current
    const changesSession = command.type === 'new_session' ||
      command.type === 'fork' ||
      command.type === 'clone'
    // A stuck abort may hard-reclaim the utility Host and rehydrate the same
    // persisted Session under a fresh Runtime identity/generation.
    const allowsRuntimeReplacement = changesSession || command.type === 'abort'
    try {
      if (!api) throw new Error('The PiPilot desktop bridge is unavailable.')
      const runtimeState = runtimeRef.current?.state
      const canRecoverCrashedRuntime = command.type === 'abort' &&
        runtimeState === 'crashed'
      if (
        !expectedGeneration ||
        (runtimeState !== 'ready' && !canRecoverCrashedRuntime)
      ) {
        throw new Error('Pi is not connected.')
      }
      setError(null)
      if (changesSession) {
        setLoading(true)
        setTranscriptLoading(true)
        if (command.type !== 'fork') setPendingForkDraft(null)
      }
      const response = await api.localPi.runtime.command(command)
      if (projectionScopeKey.current !== expectedScopeKey) {
        throw new Error('The Pi conversation scope changed before the operation completed.')
      }
      // Session-changing commands intentionally publish a new per-Runtime
      // generation before their command response resolves. That transition is
      // the successful result, not a stale-response race. Only commands that
      // do not change the active Session must still match the source generation.
      if (!allowsRuntimeReplacement && runtimeRef.current?.generation !== expectedGeneration) {
        throw new Error('The Pi session changed before the operation completed.')
      }
      if (
        !allowsRuntimeReplacement &&
        expectedSessionId &&
        sessionRef.current?.sessionId !== expectedSessionId
      ) {
        throw new Error('The Pi session changed before the operation completed.')
      }
      const data = responseData<TCommand['type']>(response, command.type)
      if (
        changesSession &&
        typeof data === 'object' &&
        data !== null &&
        'cancelled' in data &&
        data.cancelled === true
      ) {
        setLoading(false)
        setTranscriptLoading(false)
      }
      if (
        response.success &&
        response.command === 'fork' &&
        !response.data.cancelled
      ) {
        setPendingForkDraft({
          scopeKey: expectedScopeKey,
          generation: expectedGeneration,
          sessionId: expectedSessionId ?? null,
          text: response.data.text,
        })
      } else if (response.success && response.command === 'fork') {
        setPendingForkDraft(null)
      }
      return data
    } catch (caught) {
      if (
        projectionScopeKey.current === expectedScopeKey &&
        (changesSession || runtimeRef.current?.generation === expectedGeneration) &&
        (changesSession || sessionRef.current?.sessionId === expectedSessionId)
      ) {
        setError(errorMessage(caught))
      }
      if (
        changesSession &&
        projectionScopeKey.current === expectedScopeKey &&
        sessionRef.current?.sessionId === expectedSessionId
      ) {
        setLoading(false)
        setTranscriptLoading(false)
      }
      throw caught
    }
  }, [api])

  const completeCommandArguments = React.useCallback(async (
    commandName: string,
    argumentPrefix: string,
  ): Promise<readonly LocalPiCommandArgumentCompletion[]> => {
    const expectedGeneration = runtimeRef.current?.generation
    const expectedSessionId = sessionRef.current?.sessionId
    const expectedScopeKey = projectionScopeKey.current
    if (!api) throw new Error('The PiPilot desktop bridge is unavailable.')
    if (!expectedGeneration || !expectedSessionId || runtimeRef.current?.state !== 'ready') {
      throw new Error('Pi is not connected.')
    }

    const response = await api.localPi.runtime.command({
      type: 'get_command_argument_completions',
      commandName,
      argumentPrefix,
    })
    if (
      projectionScopeKey.current !== expectedScopeKey ||
      runtimeRef.current?.generation !== expectedGeneration ||
      sessionRef.current?.sessionId !== expectedSessionId
    ) {
      throw new Error('The Pi session changed before command suggestions completed.')
    }
    return responseData(response, 'get_command_argument_completions').items
  }, [api])

  const fetchEntryPage = React.useCallback(async (
    expectedGeneration: number,
    expectedSessionId: string | undefined,
    incremental: boolean,
  ): Promise<PiEntryPage> => {
    if (!api) throw new Error('The PiPilot desktop bridge is unavailable.')
    const previous = projectionRef.current.entrySnapshot
    const cursor = incremental &&
      expectedSessionId !== undefined &&
      previous?.generation === expectedGeneration &&
      previous.sessionId === expectedSessionId
      ? previous.cursor
      : null
    let append = cursor !== null
    let response = await api.localPi.runtime.command(cursor
      ? { type: 'get_entries', since: cursor }
      : { type: 'get_entries' })

    if (!response.success && cursor) {
      response = await api.localPi.runtime.command({ type: 'get_entries' })
      append = false
    }
    const data = responseData(response, 'get_entries')
    return {
      appendTo: append ? previous : null,
      append,
      entries: data.entries,
      leafId: data.leafId,
    }
  }, [api])

  const refresh = React.useCallback(async () => {
    const expected = runtimeRef.current
    if (!api || !expected || expected.state !== 'ready') return
    const expectedScopeKey = activeScopeKey
    const expectedGeneration = expected.generation
    const expectedSessionId = expected.sessionState?.sessionId
    const hydrationRequired = hydrationRef.current.scopeKey !== expectedScopeKey ||
      hydrationRef.current.generation !== expectedGeneration ||
      hydrationRef.current.sessionId !== expectedSessionId ||
      hydrationRef.current.status !== 'ready'
    const nonce = ++refreshNonce.current
    setLoading(true)
    setTranscriptLoading(true)

    try {
      const [
        stateResponse,
        messagesResponse,
        modelsResponse,
        levelsResponse,
        commandsResponse,
        statsResponse,
        entryPage,
      ] = await Promise.all([
        api.localPi.runtime.command({ type: 'get_state' }),
        api.localPi.runtime.command({ type: 'get_messages' }),
        api.localPi.runtime.command({ type: 'get_available_models' }),
        api.localPi.runtime.command({ type: 'get_available_thinking_levels' }),
        api.localPi.runtime.command({ type: 'get_commands' }),
        api.localPi.runtime.command({ type: 'get_session_stats' }),
        fetchEntryPage(expectedGeneration, expectedSessionId, false),
      ])
      const nextSession = responseData(stateResponse, 'get_state')
      const messageData = responseData(messagesResponse, 'get_messages')
      const modelData = responseData(modelsResponse, 'get_available_models')
      const levelData = responseData(
        levelsResponse,
        'get_available_thinking_levels',
      )
      const commandData = responseData(
        commandsResponse,
        'get_commands',
      )
      const nextStats = responseData(statsResponse, 'get_session_stats')
      const current = runtimeRef.current
      if (
        nonce !== refreshNonce.current ||
        projectionScopeKey.current !== expectedScopeKey ||
        current?.state !== 'ready' ||
        current.generation !== expectedGeneration ||
        (expectedSessionId && sessionRef.current?.sessionId !== expectedSessionId) ||
        (expectedSessionId && nextSession.sessionId !== expectedSessionId)
      ) {
        return
      }

      commitSession(nextSession)
      setModels(modelData.models)
      setThinkingLevels(levelData.levels)
      setCommands(commandData.commands)
      setStats(nextStats)
      setTranscriptLoading(false)
      const nextProjection = replaceLocalPiProjectorSnapshot(projectionRef.current, {
        generation: expectedGeneration,
        sessionId: nextSession.sessionId,
        messages: messageData.messages,
        entrySnapshot: mergeLocalPiEntrySnapshot(entryPage.appendTo, {
          generation: expectedGeneration,
          sessionId: nextSession.sessionId,
          entries: entryPage.entries,
          leafId: entryPage.leafId,
          append: entryPage.append,
        }),
        pendingMessageCount: nextSession.pendingMessageCount,
        isStreaming: nextSession.isStreaming,
        isCompacting: nextSession.isCompacting,
      })
      restoreActiveResponseProvenance(
        nextProjection,
        expectedScopeKey,
        nextSession.isStreaming || nextProjection.isTurnActive,
      )
      commitProjection(nextProjection)
      setCompacting(nextSession.isCompacting)
      setError(null)
      commitHydration({
        scopeKey: expectedScopeKey,
        generation: expectedGeneration,
        sessionId: nextSession.sessionId,
        status: 'ready',
        error: null,
      })
    } catch (caught) {
      const current = runtimeRef.current
      if (
        nonce === refreshNonce.current &&
        projectionScopeKey.current === expectedScopeKey &&
        current?.generation === expectedGeneration
      ) {
        const message = errorMessage(caught)
        setError(message)
        setTranscriptLoading(false)
        if (hydrationRequired) {
          commitHydration({
            scopeKey: expectedScopeKey,
            generation: expectedGeneration,
            sessionId: expectedSessionId ?? sessionRef.current?.sessionId ?? null,
            status: 'error',
            error: message,
          })
        }
      }
      throw caught
    } finally {
      if (nonce === refreshNonce.current) setLoading(false)
    }
  }, [activeScopeKey, api, commitHydration, commitProjection, commitSession, fetchEntryPage, restoreActiveResponseProvenance])

  const refreshConversation = React.useCallback(async () => {
    const expected = runtimeRef.current
    if (!api || !expected || expected.state !== 'ready') return
    const expectedScopeKey = activeScopeKey
    const expectedGeneration = expected.generation
    const expectedSessionId = expected.sessionState?.sessionId ?? sessionRef.current?.sessionId
    const nonce = ++conversationRefreshNonce.current
    try {
      const [stateResponse, messagesResponse, statsResponse, entryPage] = await Promise.all([
        api.localPi.runtime.command({ type: 'get_state' }),
        api.localPi.runtime.command({ type: 'get_messages' }),
        api.localPi.runtime.command({ type: 'get_session_stats' }),
        fetchEntryPage(expectedGeneration, expectedSessionId, true),
      ])
      const nextSession = responseData(stateResponse, 'get_state')
      const messageData = responseData(messagesResponse, 'get_messages')
      const nextStats = responseData(statsResponse, 'get_session_stats')
      if (
        nonce !== conversationRefreshNonce.current ||
        projectionScopeKey.current !== expectedScopeKey ||
        runtimeRef.current?.generation !== expectedGeneration ||
        (expectedSessionId && sessionRef.current?.sessionId !== expectedSessionId) ||
        (expectedSessionId && nextSession.sessionId !== expectedSessionId)
      ) {
        return
      }
      commitSession(nextSession)
      setStats(nextStats)
      setTranscriptLoading(false)
      const nextProjection = replaceLocalPiProjectorSnapshot(projectionRef.current, {
        generation: expectedGeneration,
        sessionId: nextSession.sessionId,
        messages: messageData.messages,
        entrySnapshot: mergeLocalPiEntrySnapshot(entryPage.appendTo, {
          generation: expectedGeneration,
          sessionId: nextSession.sessionId,
          entries: entryPage.entries,
          leafId: entryPage.leafId,
          append: entryPage.append,
        }),
        pendingMessageCount: nextSession.pendingMessageCount,
        isStreaming: nextSession.isStreaming,
        isCompacting: nextSession.isCompacting,
      })
      restoreActiveResponseProvenance(
        nextProjection,
        expectedScopeKey,
        nextSession.isStreaming || nextProjection.isTurnActive,
      )
      commitProjection(nextProjection)
      setError(null)
    } catch (caught) {
      if (
        nonce === conversationRefreshNonce.current &&
        projectionScopeKey.current === expectedScopeKey &&
        runtimeRef.current?.generation === expectedGeneration &&
        (!expectedSessionId || sessionRef.current?.sessionId === expectedSessionId)
      ) {
        setError(errorMessage(caught))
      }
    }
  }, [activeScopeKey, api, commitProjection, commitSession, fetchEntryPage, restoreActiveResponseProvenance])

  const applyRuntime = React.useCallback((snapshot: LocalPiRuntimeSnapshot) => {
    // Main already projects only the selected Runtime. Its per-Runtime
    // generation may be lower than the Runtime that was selected previously.
    const previous = runtimeRef.current
    const previousDiagnostic = previous?.diagnostics[previous.diagnostics.length - 1]
    const nextDiagnostic = snapshot.diagnostics[snapshot.diagnostics.length - 1]
    const unknownEnvelopeAdded = nextDiagnostic?.code === 'UNKNOWN_RPC_ENVELOPE' && (
      previous?.diagnostics.length !== snapshot.diagnostics.length ||
      previousDiagnostic?.code !== nextDiagnostic.code ||
      previousDiagnostic?.timestamp !== nextDiagnostic.timestamp
    )
    const activeSessionId = sessionRef.current?.sessionId
    const sessionChanged = previous?.generation === snapshot.generation
      && activeSessionId !== undefined
      && snapshot.sessionState?.sessionId !== undefined
      && snapshot.sessionState.sessionId !== activeSessionId
    const processInvalidated = previous?.state === 'ready' && snapshot.state !== 'ready'
    runtimeRef.current = snapshot
    setRuntime(snapshot)
    if (
      previous?.generation !== snapshot.generation ||
      sessionChanged ||
      processInvalidated
    ) {
      resetGeneration(snapshot)
    }

    if (snapshot.state !== 'ready') {
      if (snapshot.state === 'error' || snapshot.state === 'crashed') {
        const lastDiagnostic = snapshot.diagnostics[snapshot.diagnostics.length - 1]
        setError(lastDiagnostic?.message ?? (snapshot.stderr || 'Pi disconnected.'))
      }
      return
    }

    let startedProtocolRecovery = false
    if (unknownEnvelopeAdded && !protocolRecoveryPending.current) {
      startedProtocolRecovery = true
      protocolRecoveryPending.current = true
      void refresh()
        .catch(() => undefined)
        .finally(() => {
          protocolRecoveryPending.current = false
        })
    }

    const nextSession = snapshot.sessionState ?? sessionRef.current
    if (nextSession && sessionRef.current?.sessionId !== nextSession.sessionId) {
      commitSession(nextSession)
    }
    const key = `${activeScopeKey}:${snapshot.generation}:${nextSession?.sessionId ?? ''}`
    if (hydrationKey.current === key) return
    hydrationKey.current = key
    if (!startedProtocolRecovery) void refresh().catch(() => undefined)
  }, [activeScopeKey, commitSession, refresh, resetGeneration])

  React.useEffect(() => {
    if (projectionScopeKey.current === activeScopeKey) return
    const current = runtimeRef.current
    if (!current) {
      projectionScopeKey.current = activeScopeKey
      hydrationKey.current = ''
      activeResponseRef.current = null
      pendingPromptRef.current = null
      promptAcceptanceRef.current = null
      commitHydration({
        scopeKey: activeScopeKey,
        generation: 0,
        sessionId: null,
        status: api ? 'loading' : 'error',
        error: api ? null : 'The PiPilot desktop bridge is unavailable.',
      })
      return
    }

    resetGeneration(current)
    if (current.state !== 'ready') return
    const nextSession = current.sessionState ?? sessionRef.current
    hydrationKey.current = `${activeScopeKey}:${current.generation}:${nextSession?.sessionId ?? ''}`
    void refresh().catch(() => undefined)
  }, [activeScopeKey, api, commitHydration, refresh, resetGeneration])

  const applyEvent = React.useCallback((envelope: LocalPiRpcEventMessage) => {
    if (envelope.generation !== runtimeRef.current?.generation) return
    const previousProjection = projectionRef.current
    const event = envelope.event
    let nextProjection = applyLocalPiProjectorEvent(previousProjection, envelope)
    if (
      event.type === 'entry_appended' &&
      previousProjection.entrySnapshot?.generation === envelope.generation &&
      previousProjection.entrySnapshot.sessionId === previousProjection.sessionId &&
      !previousProjection.entrySnapshot.entries.some((entry) => entry.id === event.entry.id)
    ) {
      nextProjection = {
        ...nextProjection,
        entrySnapshot: mergeLocalPiEntrySnapshot(previousProjection.entrySnapshot, {
          generation: envelope.generation,
          sessionId: previousProjection.sessionId,
          entries: [event.entry],
          leafId: event.entry.id,
          append: true,
        }),
        revision: previousProjection.revision + 1,
      }
    }
    commitProjection(nextProjection)
    if (event.type === 'entry_appended' && event.entry.type === 'message' && event.entry.message.role === 'user') {
      const currentSessionId = sessionRef.current?.sessionId
      if (
        currentSessionId &&
        previousProjection.generation === envelope.generation &&
        previousProjection.sessionId === currentSessionId
      ) {
        const provenance: PiActiveResponseProvenance = {
          scopeKey: projectionScopeKey.current,
          generation: envelope.generation,
          sessionId: currentSessionId,
          anchorEntryId: event.entry.id,
        }
        acceptPendingPromptForScope(provenance)
        activeResponseRef.current = provenance
        flushPendingPromptActivities(provenance)
      }
    }
    switch (event.type) {
      case 'agent_start':
        if (sessionRef.current) {
          acceptPendingPromptForScope({
            scopeKey: projectionScopeKey.current,
            generation: envelope.generation,
            sessionId: sessionRef.current.sessionId,
          })
        }
        if (sessionRef.current) commitSession({ ...sessionRef.current, isStreaming: true })
        break
      case 'agent_settled':
        if (sessionRef.current) commitSession({ ...sessionRef.current, isStreaming: false })
        settleResponseActivities()
        activeResponseRef.current = null
        break
      case 'session_info_changed':
        if (sessionRef.current) {
          commitSession({
            ...sessionRef.current,
            ...(event.name === undefined
              ? { sessionName: undefined }
              : { sessionName: event.name }),
          })
        }
        break
      case 'thinking_level_changed':
        if (sessionRef.current) {
          commitSession({ ...sessionRef.current, thinkingLevel: event.level })
        }
        break
      case 'queue_update': {
        const official = {
          steering: nextProjection.queue.steering,
          followUp: nextProjection.queue.followUp,
        }
        if (sessionRef.current) {
          const nextSession = {
            ...sessionRef.current,
            pendingMessageCount: nextProjection.queue.pendingCount,
          }
          sessionRef.current = nextSession
          setSession(nextSession)
        }
        const converting = queueConversion.current
        if (converting) {
          converting.latestOfficial = official
          const reachedTarget = queueTexts(converting.steering).every(
            (text, index) => official.steering[index] === text,
          ) && official.steering.length === converting.steering.length &&
            queueTexts(converting.followUp).every(
              (text, index) => official.followUp[index] === text,
            ) && official.followUp.length === converting.followUp.length
          if (reachedTarget) {
            queueConversion.current = null
            commitQueue((previous) => ({
              ...previous,
              ...nextProjection.queue,
              steeringItems: converting.steering,
              followUpItems: converting.followUp,
            }))
          }
          break
        }

        const previous = queueRef.current
        const steeringPending = pendingQueuedMessages.current.find(
          (item) => item.kind === 'steering',
        ) ?? null
        const followUpPending = pendingQueuedMessages.current.find(
          (item) => item.kind === 'followUp',
        ) ?? null
        const steeringItems = reconcilePiQueuedMessages(
          official.steering,
          previous.steeringItems,
          steeringPending,
          nextQueueItemId,
        )
        const followUpItems = reconcilePiQueuedMessages(
          official.followUp,
          previous.followUpItems,
          followUpPending,
          nextQueueItemId,
        )
        const consumedIds = new Set(
          [...steeringItems, ...followUpItems]
            .filter((item) => item.locallyOwned)
            .map((item) => item.id),
        )
        pendingQueuedMessages.current = pendingQueuedMessages.current.filter(
          (item) => !consumedIds.has(item.id),
        )
        commitQueue({
          ...previous,
          ...nextProjection.queue,
          steeringItems,
          followUpItems,
        })
        break
      }
      case 'compaction_start':
        if (sessionRef.current) {
          commitSession({ ...sessionRef.current, isCompacting: true })
        }
        setCompacting(true)
        break
      case 'compaction_end':
        if (sessionRef.current) {
          commitSession({ ...sessionRef.current, isCompacting: false })
        }
        setCompacting(false)
        if (!event.aborted && !event.result && event.errorMessage) {
          setError(event.errorMessage)
        }
        break
      case 'auto_retry_start':
        captureResponseActivity({
          kind: 'retry',
          id: 'retry:provider',
          retryKind: 'provider',
          phase: 'waiting',
          attempt: event.attempt,
          maxAttempts: event.maxAttempts,
          delayMs: event.delayMs,
          message: responseActivityText(event.errorMessage),
          state: 'active',
        })
        break
      case 'auto_retry_end': {
        const attached = captureResponseActivity({
          kind: 'retry',
          id: 'retry:provider',
          retryKind: 'provider',
          phase: event.success ? 'success' : 'error',
          attempt: event.attempt,
          ...(event.finalError
            ? { message: responseActivityText(event.finalError) }
            : {}),
          state: 'settled',
        })
        if (!attached && event.success === false && event.finalError) setError(event.finalError)
        break
      }
      case 'summarization_retry_scheduled':
        captureResponseActivity({
          kind: 'retry',
          id: 'retry:summarization',
          retryKind: 'summarization',
          phase: 'waiting',
          attempt: event.attempt,
          maxAttempts: event.maxAttempts,
          delayMs: event.delayMs,
          message: responseActivityText(event.errorMessage),
          state: 'active',
        })
        break
      case 'summarization_retry_attempt_start':
        captureResponseActivity({
          kind: 'retry',
          id: 'retry:summarization',
          retryKind: 'summarization',
          phase: 'attempting',
          ...(event.source === 'compaction' ? { message: event.reason } : {}),
          state: 'active',
        })
        break
      case 'summarization_retry_finished':
        captureResponseActivity({
          kind: 'retry',
          id: 'retry:summarization',
          retryKind: 'summarization',
          phase: 'finished',
          state: 'settled',
        })
        break
      case 'extension_error': {
        const id = `extension-error:${++notificationSequence.current}`
        const message = responseActivityText(event.error)
        const attached = captureResponseActivity({
          kind: 'extension-error',
          id,
          message,
          state: 'settled',
        })
        if (!attached) {
          setNotifications((previous) => [...previous, {
            id,
            message,
            type: 'error' as const,
          }].slice(-5))
        }
        break
      }
      default:
        break
    }

    if (
      event.type === 'agent_settled' ||
      event.type === 'compaction_end' ||
      (!previousProjection.shouldRefreshSnapshot && nextProjection.shouldRefreshSnapshot)
    ) {
      void refreshConversation()
    }
  }, [
    acceptPendingPromptForScope,
    captureResponseActivity,
    commitProjection,
    commitSession,
    flushPendingPromptActivities,
    refreshConversation,
    settleResponseActivities,
  ])

  const applyExtensionRequest = React.useCallback((
    generation: number,
    request: LocalPiExtensionUiRequest,
  ) => {
    if (generation !== runtimeRef.current?.generation) return
    switch (request.method) {
      case 'select':
      case 'confirm':
      case 'input':
      case 'editor':
        setDialogs((previous) => [...previous, {
          generation,
          sessionId: sessionRef.current?.sessionId ?? null,
          request,
        }])
        break
      case 'notify':
        {
          const message = responseActivityText(request.message)
          const type = request.notifyType ?? 'info'
          const attached = captureResponseActivity({
            kind: 'notification',
            id: `notification:${request.id}`,
            message,
            tone: type,
            state: 'settled',
          })
          if (!attached) {
            setNotifications((previous) => [...previous, {
              id: request.id,
              message,
              type,
              autoReveal: true,
            }].slice(-5))
          } else {
            setNotifications((previous) => previous.filter(
              (notification) => notification.id !== request.id,
            ))
          }
        }
        break
      case 'setStatus':
        {
          const activityId = `status:${request.statusKey}`
          const globalId = `extension-${activityId}`
          const statusText = request.statusText
            ? responseActivityText(request.statusText)
            : ''
          let attached = false
          if (statusText) {
            attached = captureResponseActivity({
              kind: 'status',
              id: activityId,
              label: request.statusKey,
              message: statusText,
              state: 'active',
            })
          } else {
            settleResponseActivities(activityId)
          }
          setNotifications((previous) => {
            if (!statusText || attached) {
              return previous.filter((notification) => notification.id !== globalId)
            }
            return upsertExtensionNotification(previous, {
              id: globalId,
              message: `${request.statusKey}: ${statusText}`,
              type: 'info',
            })
          })
          setStatuses((previous) => {
            const next = { ...previous }
            if (statusText) next[request.statusKey] = statusText
            else delete next[request.statusKey]
            return next
          })
        }
        break
      case 'setWorkingMessage':
        {
          const message = request.message
            ? responseActivityText(request.message)
            : null
          workingMessageRef.current = message
          setWorkingMessage(message)
          if (workingVisibleRef.current) {
            const attached = captureResponseActivity({
              kind: 'working',
              id: 'working',
              message: message ?? '',
              state: 'active',
            })
            setNotifications((previous) => {
              if (!message || attached) {
                return previous.filter((notification) =>
                  notification.id !== 'extension-working')
              }
              return upsertExtensionNotification(previous, {
                id: 'extension-working',
                message,
                type: 'info',
              })
            })
          }
        }
        break
      case 'setWorkingVisible':
        workingVisibleRef.current = request.visible
        setWorkingVisible(request.visible)
        if (request.visible) {
          const message = workingMessageRef.current ?? ''
          const attached = captureResponseActivity({
            kind: 'working',
            id: 'working',
            message,
            state: 'active',
          })
          setNotifications((previous) => {
            if (!message || attached) {
              return previous.filter((notification) =>
                notification.id !== 'extension-working')
            }
            return upsertExtensionNotification(previous, {
              id: 'extension-working',
              message,
              type: 'info',
            })
          })
        } else {
          settleResponseActivities('working')
          setNotifications((previous) => previous.filter((notification) =>
            notification.id !== 'extension-working'))
        }
        break
      case 'setWidget':
        {
          const activityId = `widget:${request.widgetKey}`
          const globalId = `extension-${activityId}`
          const lines = request.widgetLines
            ?.slice(0, MAX_RESPONSE_ACTIVITY_DETAILS + 1)
            .map(responseActivityText)
          let attached = false
          if (lines) {
            attached = captureResponseActivity({
              kind: 'widget',
              id: activityId,
              label: request.widgetKey,
              summary: lines[0] ?? '',
              ...(lines.length > 1 ? { details: lines.slice(1) } : {}),
              state: 'active',
            })
          } else {
            settleResponseActivities(activityId)
          }
          setNotifications((previous) => {
            if (!lines?.length || attached) {
              return previous.filter((notification) => notification.id !== globalId)
            }
            return upsertExtensionNotification(previous, {
              id: globalId,
              message: `${request.widgetKey}: ${lines[0]}`,
              type: 'info',
            })
          })
          setWidgets((previous) => {
            const rest = previous.filter((widget) => widget.key !== request.widgetKey)
            return request.widgetLines
              ? [...rest, {
                  key: request.widgetKey,
                  lines: request.widgetLines.map(extensionDisplayText),
                  placement: request.widgetPlacement ?? 'aboveEditor',
                }]
              : rest
          })
        }
        break
      case 'setTitle':
        setExtensionTitle(request.title
          ? extensionDisplayText(request.title)
          : request.title)
        break
      case 'set_editor_text':
        setDraftReplacement({ revision: ++draftRevision.current, text: request.text })
        break
      case 'unsupported':
        setUnsupportedMethods((previous) => previous.includes(request.unsupportedMethod)
          ? previous
          : [...previous, request.unsupportedMethod].slice(-32))
        break
      case 'dismiss':
        setDialogs((previous) => previous.filter(
          (dialog) => dialog.request.id !== request.id,
        ))
        setDialogBusy(false)
        break
    }
  }, [captureResponseActivity, commitQueue, nextQueueItemId, settleResponseActivities])

  React.useEffect(() => {
    if (!api) return
    let disposed = false
    let runtimeSignal = 0
    const detachRuntime = api.localPi.runtime.subscribe((event) => {
      if (!disposed) {
        runtimeSignal += 1
        applyRuntime(event.snapshot)
      }
    })
    const detachEvents = api.localPi.runtime.subscribeEvents((event) => {
      if (!disposed) applyEvent(event)
    })
    const detachExtension = api.localPi.runtime.subscribeExtensionUi((event) => {
      if (!disposed) applyExtensionRequest(event.generation, event.request)
    })
    const initialRuntimeSignal = runtimeSignal
    void api.localPi.runtime.rendererReady()
      .then(() => api.localPi.runtime.status())
      .then((snapshot) => {
        if (!disposed && runtimeSignal === initialRuntimeSignal) applyRuntime(snapshot)
      })
      .catch((caught) => {
        if (!disposed && runtimeSignal === initialRuntimeSignal) {
          const message = errorMessage(caught)
          setLoading(false)
          setTranscriptLoading(false)
          setError(message)
          commitHydration({
            scopeKey: activeScopeKey,
            generation: runtimeRef.current?.generation ?? 0,
            sessionId: sessionRef.current?.sessionId ?? null,
            status: 'error',
            error: message,
          })
        }
      })
    return () => {
      disposed = true
      refreshNonce.current += 1
      detachRuntime()
      detachEvents()
      detachExtension()
    }
  }, [api, applyEvent, applyExtensionRequest, applyRuntime, commitHydration])

  React.useEffect(() => {
    document.title = extensionTitle || 'PiPilot'
    return () => {
      document.title = 'PiPilot'
    }
  }, [extensionTitle])

  const actions = React.useMemo<PiRpcActions>(() => ({
    async abort() {
      const acceptance = promptAcceptanceRef.current
      const pending = pendingPromptRef.current
      try {
        await runCommand({ type: 'abort' })
        await refreshConversation()
      } finally {
        if (acceptance) {
          promptAcceptanceRef.current = clearPiPromptAcceptance(
            promptAcceptanceRef.current,
            acceptance.operationId,
          )
        }
        const currentPending = pendingPromptRef.current
        if (pending && currentPending?.operationId === pending.operationId) {
          promotePendingPromptActivities(currentPending)
          pendingPromptRef.current = clearPiPendingPrompt(
            currentPending,
            pending.operationId,
          )
        }
      }
    },
    async compact(instructions) {
      await runCommand({ type: 'compact', ...(instructions ? { customInstructions: instructions } : {}) })
      await refreshConversation()
    },
    completeCommandArguments,
    dismissNotification(id) {
      setNotifications((previous) => previous.filter((notification) => notification.id !== id))
    },
    markNotificationRevealed(id) {
      setNotifications((previous) => previous.map((notification) =>
        notification.id === id && notification.autoReveal
          ? { ...notification, autoReveal: false }
          : notification))
    },
    fork(entryId) {
      if (forkInFlight.current) return forkInFlight.current
      const operation = (async () => {
        try {
          await runCommand({ type: 'fork', entryId })
        } finally {
          forkInFlight.current = null
        }
      })()
      forkInFlight.current = operation
      return operation
    },
    refresh,
    request: runCommand,
    async respondToExtension(response) {
      const active = dialogs[0]
      if (!api || !active) return
      const isCurrent = () =>
        active.generation === runtimeRef.current?.generation &&
        active.sessionId === (sessionRef.current?.sessionId ?? null)
      const matchesActiveDialog = (dialog: PiExtensionDialog | undefined) =>
        dialog?.generation === active.generation &&
        dialog.sessionId === active.sessionId &&
        dialog.request.id === active.request.id
      if (!isCurrent() || active.request.id !== response.id) {
        setDialogs((previous) => matchesActiveDialog(previous[0])
          ? previous.slice(1)
          : previous)
        return
      }
      setDialogBusy(true)
      try {
        await api.localPi.runtime.respondToExtensionUi(active.generation, response)
        setDialogs((previous) => matchesActiveDialog(previous[0])
          ? previous.slice(1)
          : previous)
        if (isCurrent()) setError(null)
      } catch (caught) {
        if (isCurrent()) setError(errorMessage(caught))
      } finally {
        if (isCurrent()) setDialogBusy(false)
      }
    },
    async selectModel(provider, modelId) {
      const model = await runCommand({ type: 'set_model', provider, modelId })
      if (sessionRef.current) commitSession({ ...sessionRef.current, model })
      await refresh().catch(() => undefined)
    },
    async selectThinking(level) {
      await runCommand({ type: 'set_thinking_level', level })
      await refresh().catch(() => undefined)
    },
    async send(text, action, images = []) {
      if (
        action !== 'prompt' &&
        runtimeRef.current?.state === 'ready' &&
        !sessionRef.current?.isStreaming
      ) {
        const settledError = new Error(
          'Pi finished before the queued message was accepted.',
        )
        setError(settledError.message)
        throw settledError
      }
      if (action !== 'prompt' && !text.trim()) {
        throw new Error('Queued image messages require text.')
      }
      const imagePayload = images.length > 0 ? { images: [...images] } : {}
      const command = action === 'prompt'
        ? { type: 'prompt' as const, message: text, ...imagePayload }
        : action === 'steer'
          ? { type: 'steer' as const, message: text, ...imagePayload }
          : { type: 'follow_up' as const, message: text, ...imagePayload }
      const isExtensionCommand = action === 'prompt' &&
        isRegisteredPiExtensionCommandPrompt(text, commands)
      let pendingOperationId: number | null = null
      let pendingQueueItem: PendingPiQueuedMessage | null = null
      if (action === 'prompt') {
        const currentRuntime = runtimeRef.current
        const currentSessionId = sessionRef.current?.sessionId
        const currentProjection = projectionRef.current
        if (
          currentRuntime?.state === 'ready' &&
          currentSessionId &&
          currentProjection.generation === currentRuntime.generation &&
          currentProjection.sessionId === currentSessionId
        ) {
          const currentScope = {
            scopeKey: projectionScopeKey.current,
            generation: currentRuntime.generation,
            sessionId: currentSessionId,
          }
          const previousPending = reconcilePiPendingPromptScope(
            pendingPromptRef.current,
            currentScope,
          )
          const previousAcceptance = reconcilePiPromptAcceptanceScope(
            promptAcceptanceRef.current,
            currentScope,
          )
          if (promptAcceptanceRef.current && !previousAcceptance) {
            promptAcceptanceRef.current = null
          }
          if (previousAcceptance) {
            const message = 'Pi is still accepting the previous prompt.'
            setError(message)
            throw new Error(message)
          }
          if (previousPending) promotePendingPromptActivities(previousPending)
          pendingPromptRef.current = null
          pendingOperationId = ++promptOperationSequence.current
          promptAcceptanceRef.current = createPiPromptAcceptance({
            operationId: pendingOperationId,
            ...currentScope,
          })
          pendingPromptRef.current = createPiPendingPromptProvenance({
            operationId: pendingOperationId,
            ...currentScope,
            initialMessageCount: currentProjection.messages.length,
          })
          activeResponseRef.current = null
        }
      } else {
        const kind = action === 'steer' ? 'steering' as const : 'followUp' as const
        const currentQueue = queueRef.current
        pendingQueueItem = {
          id: nextQueueItemId(),
          kind,
          text,
          images: [...images],
          locallyOwned: true,
          before: kind === 'steering'
            ? [...currentQueue.steering]
            : [...currentQueue.followUp],
        }
        pendingQueuedMessages.current.push(pendingQueueItem)
      }
      try {
        await runCommand(command)
        if (pendingOperationId !== null) {
          pendingPromptRef.current = acceptPiPendingPrompt(
            pendingPromptRef.current,
            pendingOperationId,
          )
          const currentProjection = projectionRef.current
          restoreActiveResponseProvenance(
            currentProjection,
            projectionScopeKey.current,
            Boolean(sessionRef.current?.isStreaming || currentProjection.isTurnActive),
          )
          if (isExtensionCommand) {
            const unanchored = pendingPromptRef.current
            if (unanchored?.operationId === pendingOperationId) {
              promotePendingPromptActivities(unanchored)
              pendingPromptRef.current = clearPiPendingPrompt(
                unanchored,
                pendingOperationId,
              )
            }
          }
        }
      } catch (caught) {
        if (pendingQueueItem) {
          pendingQueuedMessages.current = pendingQueuedMessages.current.filter(
            (item) => item.id !== pendingQueueItem?.id,
          )
        }
        if (pendingOperationId !== null) {
          const failedPending = pendingPromptRef.current
          const nextPending = clearPiPendingPrompt(failedPending, pendingOperationId)
          if (failedPending && nextPending !== failedPending) {
            promotePendingPromptActivities(failedPending)
          }
          pendingPromptRef.current = nextPending
        }
        throw caught
      } finally {
        if (pendingOperationId !== null) {
          promptAcceptanceRef.current = clearPiPromptAcceptance(
            promptAcceptanceRef.current,
            pendingOperationId,
          )
        }
      }
    },
    async promoteFollowUp(itemId) {
      const current = queueRef.current
      if (
        !current.detailsKnown ||
        !canPromotePiFollowUp(current.steeringItems, current.followUpItems)
      ) {
        throw new Error('This Follow-up cannot be promoted because its full payload is unavailable.')
      }
      if (!sessionRef.current?.isStreaming) {
        throw new Error('Pi finished before the Follow-up could be promoted.')
      }
      const promoted = promotePiFollowUpSnapshot(
        current.steeringItems,
        current.followUpItems,
        itemId,
      )
      if (!promoted) throw new Error('The queued Follow-up no longer exists.')

      const conversion = {
        steering: promoted.steering,
        followUp: promoted.followUp,
        latestOfficial: null as {
          steering: readonly string[]
          followUp: readonly string[]
        } | null,
      }
      queueConversion.current = conversion
      const payload = (items: readonly PiQueuedMessage[]) => items.map((item) => ({
        message: item.text,
        ...(item.images.length > 0 ? { images: [...item.images] } : {}),
      }))
      try {
        await runCommand({
          type: 'promote_follow_up',
          followUpIndex: promoted.followUpIndex,
          steering: payload(current.steeringItems),
          followUp: payload(current.followUpItems),
        })
        if (queueConversion.current === conversion) {
          // Command responses and queue events travel over separate IPC
          // channels. Keep the conversion guard until the authoritative
          // target snapshot arrives so delayed clear/rebuild events cannot
          // erase locally retained image payloads.
          commitQueue({
            ...current,
            steering: queueTexts(promoted.steering),
            followUp: queueTexts(promoted.followUp),
            steeringItems: promoted.steering,
            followUpItems: promoted.followUp,
          })
        }
      } catch (caught) {
        if (queueConversion.current === conversion) {
          queueConversion.current = null
          const latest = conversion.latestOfficial
          if (latest) {
            const steeringItems = reconcilePiQueuedMessages(
              latest.steering,
              current.steeringItems,
              null,
              nextQueueItemId,
            )
            const followUpItems = reconcilePiQueuedMessages(
              latest.followUp,
              current.followUpItems,
              null,
              nextQueueItemId,
            )
            commitQueue({
              ...current,
              pendingCount: latest.steering.length + latest.followUp.length,
              detailsKnown: true,
              steering: latest.steering,
              followUp: latest.followUp,
              steeringItems,
              followUpItems,
            })
          }
        }
        throw caught
      }
    },
    async setAutoCompaction(enabled) {
      await runCommand({ type: 'set_auto_compaction', enabled })
      if (sessionRef.current) {
        commitSession({ ...sessionRef.current, autoCompactionEnabled: enabled })
      }
      await refresh().catch(() => undefined)
    },
    async setAutoRetry(enabled) {
      await runCommand({ type: 'set_auto_retry', enabled })
    },
    async abortRetry() {
      const current = projectionRef.current
      if (
        current.retry.kind !== 'auto' ||
        current.retry.phase !== 'waiting' ||
        current.retryTiming.cancelling ||
        current.retryTiming.deadline === null ||
        Date.now() >= current.retryTiming.deadline
      ) return
      commitProjection(setLocalPiRetryCancelling(current, true))
      try {
        await runCommand({ type: 'abort_retry' })
      } catch (caught) {
        commitProjection(setLocalPiRetryCancelling(projectionRef.current, false))
        throw caught
      }
    },
    async setQueueMode(kind, mode) {
      await runCommand(kind === 'steering'
        ? { type: 'set_steering_mode', mode }
        : { type: 'set_follow_up_mode', mode })
      if (sessionRef.current) {
        commitSession({
          ...sessionRef.current,
          ...(kind === 'steering'
            ? { steeringMode: mode }
            : { followUpMode: mode }),
        })
      }
      commitQueue((previous) => ({
        ...previous,
        ...(kind === 'steering'
          ? { steeringMode: mode }
          : { followUpMode: mode }),
      }))
    },
  }), [
    api,
    completeCommandArguments,
    commitProjection,
    commitQueue,
    commitSession,
    commands,
    dialogs,
    nextQueueItemId,
    promotePendingPromptActivities,
    refresh,
    refreshConversation,
    restoreActiveResponseProvenance,
    runCommand,
  ])

  const transcriptSnapshot = React.useMemo<PiTranscriptSnapshot>(() => {
    const turns = projectLocalPiTurns(projection, {
      planMode,
      scopeKey: activeScopeKey,
      responseActivities,
    })
    return {
      turns,
      outline: projectConversationOutline(turns),
      revision: projection.revision + responseActivityRevision,
      loading: transcriptLoading,
    }
  }, [activeScopeKey, planMode, projection, responseActivities, responseActivityRevision, transcriptLoading])

  const runtimeView = React.useMemo<PiRuntimeView>(() => ({
    runtime,
    session,
    hydration,
    status: runtime?.state === 'crashed' || runtime?.state === 'error'
      ? 'failed'
      : session?.isStreaming
        ? planMode?.lifecycle === 'planning' ? 'planning' : 'running'
        : goalMode?.lifecycle === 'active' || goalMode?.lifecycle === 'queued'
          ? 'running'
        : 'idle',
    models,
    selectedModel: session?.model ?? null,
    thinkingLevels,
    commands,
    stats,
    queue,
    loading,
    error,
    compacting,
    retryActivity,
  }), [commands, compacting, error, goalMode?.lifecycle, hydration, loading, models, planMode?.lifecycle, queue, retryActivity, runtime, session, stats, thinkingLevels])

  const extensionView = React.useMemo<PiExtensionView>(() => ({
    dialog: dialogs[0] ?? null,
    dialogBusy,
    notifications,
    statuses,
    widgets,
    title: extensionTitle,
    working: { message: workingMessage, visible: workingVisible },
    unsupportedMethods,
    draftReplacement,
    goalMode,
    planMode,
  }), [dialogBusy, dialogs, draftReplacement, extensionTitle, goalMode, notifications, planMode, statuses, unsupportedMethods, widgets, workingMessage, workingVisible])

  return (
    <ActionsContext.Provider value={actions}>
      <RuntimeContext.Provider value={runtimeView}>
        <TranscriptContext.Provider value={transcriptSnapshot}>
          <ExtensionContext.Provider value={extensionView}>
            {children}
          </ExtensionContext.Provider>
        </TranscriptContext.Provider>
      </RuntimeContext.Provider>
    </ActionsContext.Provider>
  )
}

function requiredContext<T>(context: React.Context<T | null>, name: string) {
  const value = React.useContext(context)
  if (!value) throw new Error(`${name} must be used within PiRpcProvider`)
  return value
}

export function usePiTranscript() {
  return requiredContext(TranscriptContext, 'usePiTranscript')
}

export function usePiRuntime() {
  return requiredContext(RuntimeContext, 'usePiRuntime')
}

export function usePiExtensionUi() {
  return requiredContext(ExtensionContext, 'usePiExtensionUi')
}

export function usePiRpcActions() {
  return requiredContext(ActionsContext, 'usePiRpcActions')
}
