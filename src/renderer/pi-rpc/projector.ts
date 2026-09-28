import type {
  LocalPiAgentMessage,
  LocalPiAssistantMessage,
  LocalPiCompactionResult,
  LocalPiExtensionErrorEvent,
  LocalPiLiveMessageSnapshot,
  LocalPiRpcEvent,
  LocalPiRpcEventMessage,
  LocalPiToolResult,
} from '@/shared/local-pi'
import { applyAssistantMessageEvent, contentMap, type LocalPiAssistantContent } from '@/shared/pi-stream-projection'
import type { LocalPiEntrySnapshot } from './response-provenance'

const MAX_EXTENSION_ERRORS = 20

type LocalPiCompactionReason = Extract<
  LocalPiRpcEvent,
  { type: 'compaction_start' }
>['reason']

export interface LocalPiProjectorScope {
  generation: number
  sessionId: string
}

export interface LocalPiProjectorSeed extends LocalPiProjectorScope {
  live?: LocalPiLiveMessageSnapshot
  messages?: readonly LocalPiAgentMessage[]
  entrySnapshot?: LocalPiEntrySnapshot | null
  pendingMessageCount?: number
  isStreaming?: boolean
  isCompacting?: boolean
}

export interface LocalPiProjectorSnapshot extends LocalPiProjectorScope {
  live?: LocalPiLiveMessageSnapshot
  messages: readonly LocalPiAgentMessage[]
  entrySnapshot: LocalPiEntrySnapshot | null
  pendingMessageCount: number
  isStreaming: boolean
  isCompacting: boolean
}

export interface LocalPiProjectedQueue {
  pendingCount: number
  detailsKnown: boolean
  steering: readonly string[]
  followUp: readonly string[]
}

export interface LocalPiProjectedTool {
  toolCallId: string
  toolName: string
  args: unknown
  phase: 'running' | 'complete'
  result: LocalPiToolResult | null
  resultIsPartial: boolean
  isError: boolean | null
}

export interface LocalPiProjectedCompaction {
  active: boolean
  reason: LocalPiCompactionReason | null
  result: LocalPiCompactionResult | null
  aborted: boolean
  willRetry: boolean
  errorMessage: string | null
}

export type LocalPiProjectedRetry =
  | { kind: 'none' }
  | {
      kind: 'auto'
      phase: 'waiting'
      attempt: number
      maxAttempts: number
      delayMs: number
      errorMessage: string
    }
  | {
      kind: 'auto'
      phase: 'finished'
      attempt: number
      success: boolean
      finalError: string | null
    }
  | {
      kind: 'summarization'
      phase: 'waiting'
      attempt: number
      maxAttempts: number
      delayMs: number
      errorMessage: string
    }
  | {
      kind: 'summarization'
      phase: 'attempting'
      source: 'branchSummary' | 'compaction'
      reason: LocalPiCompactionReason | null
    }
  | { kind: 'summarization'; phase: 'finished' }

export interface LocalPiProjectedRetryTiming {
  deadline: number | null
  cancelling: boolean
  settledAt: number | null
}

export interface LocalPiProjectorState extends LocalPiProjectorScope {
  messages: readonly LocalPiAgentMessage[]
  entrySnapshot: LocalPiEntrySnapshot | null
  streamingMessage: LocalPiAssistantMessage | null
  messageSequence: number | null
  streamingContent: ReadonlyMap<number, LocalPiAssistantContent>
  streamingToolCallDeltas: ReadonlyMap<number, string>
  tools: ReadonlyMap<string, LocalPiProjectedTool>
  queue: LocalPiProjectedQueue
  compaction: LocalPiProjectedCompaction
  retry: LocalPiProjectedRetry
  retryTiming: LocalPiProjectedRetryTiming
  extensionErrors: readonly LocalPiExtensionErrorEvent[]
  isStreaming: boolean
  isTurnActive: boolean
  lastAgentWillRetry: boolean | null
  shouldRefreshSnapshot: boolean
  revision: number
}

function emptyCompaction(active: boolean): LocalPiProjectedCompaction {
  return {
    active,
    reason: null,
    result: null,
    aborted: false,
    willRetry: false,
    errorMessage: null,
  }
}

function emptyRetryTiming(): LocalPiProjectedRetryTiming {
  return { deadline: null, cancelling: false, settledAt: null }
}

function createState(
  seed: LocalPiProjectorSeed,
  revision: number,
): LocalPiProjectorState {
  const entrySnapshot = seed.entrySnapshot
  const scopedEntrySnapshot = entrySnapshot &&
    entrySnapshot.generation === seed.generation &&
    entrySnapshot.sessionId === seed.sessionId
    ? { ...entrySnapshot, entries: [...entrySnapshot.entries] }
    : null
  return {
    generation: seed.generation,
    sessionId: seed.sessionId,
    messages: [...(seed.messages ?? [])],
    entrySnapshot: scopedEntrySnapshot,
    streamingMessage: seed.live?.message ?? null,
    messageSequence: seed.live?.sequence ?? null,
    streamingContent: new Map(seed.live?.message?.content.map((part, index) =>
      [seed.live?.contentIndices?.[index] ?? index, part] as const) ?? []),
    streamingToolCallDeltas: new Map(seed.live?.toolCallDeltas ?? []),
    tools: new Map(),
    queue: {
      pendingCount: seed.pendingMessageCount ?? 0,
      detailsKnown: false,
      steering: [],
      followUp: [],
    },
    compaction: emptyCompaction(seed.isCompacting ?? false),
    retry: { kind: 'none' },
    retryTiming: emptyRetryTiming(),
    extensionErrors: [],
    isStreaming: seed.live?.isStreaming ?? (seed.isStreaming ?? false),
    isTurnActive: false,
    lastAgentWillRetry: null,
    shouldRefreshSnapshot: false,
    revision,
  }
}

export function createLocalPiProjectorState(
  seed: LocalPiProjectorSeed,
): LocalPiProjectorState {
  return createState(seed, 0)
}

export function resetLocalPiProjectorState(
  state: LocalPiProjectorState,
  scope: LocalPiProjectorScope,
): LocalPiProjectorState {
  return createState(scope, state.revision + 1)
}

export function replaceLocalPiProjectorSnapshot(
  state: LocalPiProjectorState,
  snapshot: LocalPiProjectorSnapshot,
): LocalPiProjectorState {
  if (snapshot.generation < state.generation) return state
  const next = createState(snapshot, state.revision + 1)
  if (
    snapshot.generation === state.generation &&
    snapshot.sessionId === state.sessionId
  ) {
    const detailedQueueCount = state.queue.steering.length +
      state.queue.followUp.length
    const queue = state.queue.detailsKnown &&
      detailedQueueCount === snapshot.pendingMessageCount
      ? { ...state.queue }
      : next.queue
    return {
      ...next,
      queue,
      retry: state.retry,
      retryTiming: state.retryTiming,
    }
  }
  return next
}

/**
 * Resolve entry provenance without replacing live messages or tool evidence.
 * A concurrent snapshot refresh wins over a page requested from an older base.
 */
export function hydrateLocalPiProjectorEntrySnapshot(
  state: LocalPiProjectorState,
  snapshot: LocalPiEntrySnapshot,
  expectedSnapshot: LocalPiEntrySnapshot | null,
): LocalPiProjectorState {
  if (
    snapshot.generation !== state.generation ||
    snapshot.sessionId !== state.sessionId ||
    state.entrySnapshot !== expectedSnapshot
  ) return state
  return { ...state, entrySnapshot: snapshot, revision: state.revision + 1 }
}

export function setLocalPiRetryCancelling(
  state: LocalPiProjectorState,
  cancelling: boolean,
): LocalPiProjectorState {
  if (state.retry.kind !== 'auto' || state.retry.phase !== 'waiting') return state
  if (state.retryTiming.cancelling === cancelling) return state
  return {
    ...state,
    retryTiming: { ...state.retryTiming, cancelling },
    revision: state.revision + 1,
  }
}

function replaceTool(
  state: LocalPiProjectorState,
  tool: LocalPiProjectedTool,
) {
  const tools = new Map(state.tools)
  tools.set(tool.toolCallId, tool)
  return tools
}

function appendExtensionError(
  errors: readonly LocalPiExtensionErrorEvent[],
  event: LocalPiExtensionErrorEvent,
) {
  return [...errors, event].slice(-MAX_EXTENSION_ERRORS)
}

function assertNever(value: never): never {
  throw new Error(`Unhandled local Pi event: ${JSON.stringify(value)}`)
}

export function isLocalPiLiveMessageEvent(event: LocalPiRpcEvent): boolean {
  return event.type === 'message_start' || event.type === 'message_update' ||
    event.type === 'message_end' || event.type === 'agent_start' ||
    event.type === 'agent_end' || event.type === 'agent_settled' ||
    event.type === 'turn_start' || event.type === 'turn_end'
}

export function applyLocalPiProjectorEvent(
  state: LocalPiProjectorState,
  envelope: LocalPiRpcEventMessage,
): LocalPiProjectorState {
  if (envelope.generation !== state.generation) return state

  const event = envelope.event
  if (isLocalPiLiveMessageEvent(event) && envelope.sequence !== undefined) {
    // Hydration can overtake an already-produced event in the IPC queue. The
    // live snapshot already includes every message event through its sequence.
    if (state.messageSequence !== null && envelope.sequence <= state.messageSequence) return state
    state = { ...state, messageSequence: envelope.sequence }
  }
  const revision = state.revision + 1
  switch (event.type) {
    case 'agent_start':
      return {
        ...state,
        retry: state.retry.kind === 'auto' && state.retry.phase === 'finished'
          ? { kind: 'none' }
          : state.retry,
        retryTiming: state.retry.kind === 'auto' && state.retry.phase === 'finished'
          ? emptyRetryTiming()
          : state.retryTiming,
        isStreaming: true,
        lastAgentWillRetry: null,
        revision,
      }
    case 'agent_end':
      return { ...state, lastAgentWillRetry: event.willRetry, revision }
    case 'agent_settled':
      return {
        ...state,
        streamingMessage: null,
        streamingContent: new Map(),
        streamingToolCallDeltas: new Map(),
        isStreaming: false,
        isTurnActive: false,
        lastAgentWillRetry: false,
        shouldRefreshSnapshot: true,
        revision,
      }
    case 'entry_appended':
    case 'session_info_changed':
    case 'thinking_level_changed':
    case 'bash_execution_update':
      return state
    case 'turn_start':
      return { ...state, isTurnActive: true, revision }
    case 'turn_end':
      return { ...state, isTurnActive: false, revision }
    case 'message_start': {
      if (event.message.role !== 'assistant') return { ...state, revision }
      const streamingContent = contentMap(event.message)
      return {
        ...state,
        streamingMessage: {
          ...event.message,
          content: [...event.message.content],
        },
        streamingContent,
        streamingToolCallDeltas: new Map(),
        isStreaming: true,
        revision,
      }
    }
    case 'message_update': {
      if (!state.streamingMessage) {
        return {
          ...state,
          shouldRefreshSnapshot: true,
          revision,
        }
      }
      const projected = applyAssistantMessageEvent(
        state.streamingMessage,
        state.streamingContent,
        state.streamingToolCallDeltas,
        event.assistantMessageEvent,
      )
      return {
        ...state,
        streamingMessage: projected.message,
        streamingContent: projected.content,
        streamingToolCallDeltas: projected.toolCallDeltas,
        shouldRefreshSnapshot: state.shouldRefreshSnapshot || projected.uncertain,
        revision,
      }
    }
    case 'message_end':
      return {
        ...state,
        messages: [...state.messages, event.message],
        streamingMessage: event.message.role === 'assistant'
          ? null
          : state.streamingMessage,
        streamingContent: event.message.role === 'assistant'
          ? new Map()
          : state.streamingContent,
        streamingToolCallDeltas: event.message.role === 'assistant'
          ? new Map()
          : state.streamingToolCallDeltas,
        revision,
      }
    case 'tool_execution_start': {
      const tool: LocalPiProjectedTool = {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: event.args,
        phase: 'running',
        result: null,
        resultIsPartial: false,
        isError: null,
      }
      return { ...state, tools: replaceTool(state, tool), revision }
    }
    case 'tool_execution_update': {
      const tool: LocalPiProjectedTool = {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: event.args,
        phase: 'running',
        result: event.partialResult,
        resultIsPartial: true,
        isError: null,
      }
      return { ...state, tools: replaceTool(state, tool), revision }
    }
    case 'tool_execution_end': {
      const previous = state.tools.get(event.toolCallId)
      const tool: LocalPiProjectedTool = {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: previous?.args,
        phase: 'complete',
        result: event.result,
        resultIsPartial: false,
        isError: event.isError,
      }
      return { ...state, tools: replaceTool(state, tool), revision }
    }
    case 'queue_update':
      return {
        ...state,
        queue: {
          pendingCount: event.steering.length + event.followUp.length,
          detailsKnown: true,
          steering: [...event.steering],
          followUp: [...event.followUp],
        },
        revision,
      }
    case 'compaction_start':
      return {
        ...state,
        compaction: {
          ...emptyCompaction(true),
          reason: event.reason,
        },
        revision,
      }
    case 'compaction_end':
      return {
        ...state,
        compaction: {
          active: false,
          reason: event.reason,
          result: event.result ?? null,
          aborted: event.aborted,
          willRetry: event.willRetry,
          errorMessage: event.errorMessage ?? null,
        },
        revision,
      }
    case 'auto_retry_start':
      return {
        ...state,
        retry: {
          kind: 'auto',
          phase: 'waiting',
          attempt: event.attempt,
          maxAttempts: event.maxAttempts,
          delayMs: event.delayMs,
          errorMessage: event.errorMessage,
        },
        retryTiming: {
          deadline: Date.now() + event.delayMs,
          cancelling: false,
          settledAt: null,
        },
        revision,
      }
    case 'auto_retry_end':
      return {
        ...state,
        retry: {
          kind: 'auto',
          phase: 'finished',
          attempt: event.attempt,
          success: event.success,
          finalError: event.finalError ?? null,
        },
        retryTiming: {
          deadline: null,
          cancelling: false,
          settledAt: Date.now(),
        },
        revision,
      }
    case 'summarization_retry_scheduled':
      return {
        ...state,
        retry: {
          kind: 'summarization',
          phase: 'waiting',
          attempt: event.attempt,
          maxAttempts: event.maxAttempts,
          delayMs: event.delayMs,
          errorMessage: event.errorMessage,
        },
        retryTiming: emptyRetryTiming(),
        revision,
      }
    case 'summarization_retry_attempt_start':
      return {
        ...state,
        retry: {
          kind: 'summarization',
          phase: 'attempting',
          source: event.source,
          reason: event.source === 'compaction' ? event.reason : null,
        },
        retryTiming: emptyRetryTiming(),
        revision,
      }
    case 'summarization_retry_finished':
      return {
        ...state,
        retry: { kind: 'summarization', phase: 'finished' },
        retryTiming: emptyRetryTiming(),
        revision,
      }
    case 'extension_error':
      return {
        ...state,
        extensionErrors: appendExtensionError(state.extensionErrors, event),
        revision,
      }
    case 'delivery_state':
      // Delivery identity and payloads are projected by the dedicated queue store.
      return { ...state, revision }
    case 'runtime_diagnostic':
      return {
        ...state,
        shouldRefreshSnapshot: true,
        revision,
      }
    default:
      return assertNever(event)
  }
}
