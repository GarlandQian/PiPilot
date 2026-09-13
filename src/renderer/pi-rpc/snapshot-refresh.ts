import type { LocalPiRpcEvent, LocalPiSessionState } from '@/shared/local-pi'
import {
  replaceLocalPiProjectorSnapshot,
  type LocalPiProjectorSnapshot,
  type LocalPiProjectorState,
  type LocalPiProjectedTool,
} from './projector'

export interface PiSnapshotWatermark {
  history: number
  activity: number
  queue: number
  compaction: number
  sessionInfo: number
  thinking: number
  tools: ReadonlyMap<string, number>
}

export function createPiSnapshotWatermark(): PiSnapshotWatermark {
  return { history: 0, activity: 0, queue: 0, compaction: 0, sessionInfo: 0, thinking: 0, tools: new Map() }
}

/** Track event order, never inferred message IDs, timestamps, or JSON equality. */
export function advancePiSnapshotWatermark(
  previous: PiSnapshotWatermark,
  event: LocalPiRpcEvent,
): PiSnapshotWatermark {
  switch (event.type) {
    case 'message_end':
    case 'entry_appended':
    case 'runtime_diagnostic':
      return { ...previous, history: previous.history + 1 }
    case 'agent_settled':
      return { ...previous, history: previous.history + 1, activity: previous.activity + 1 }
    case 'agent_start':
    case 'message_start':
    case 'message_update':
    case 'turn_start':
    case 'turn_end':
      return { ...previous, activity: previous.activity + 1 }
    case 'queue_update':
      return { ...previous, queue: previous.queue + 1 }
    case 'tool_execution_start':
    case 'tool_execution_update':
    case 'tool_execution_end': {
      const tools = new Map(previous.tools)
      tools.set(event.toolCallId, (tools.get(event.toolCallId) ?? 0) + 1)
      return { ...previous, tools }
    }
    case 'compaction_start':
      return { ...previous, compaction: previous.compaction + 1 }
    case 'compaction_end':
      return { ...previous, history: previous.history + 1, compaction: previous.compaction + 1 }
    case 'session_info_changed':
      return { ...previous, sessionInfo: previous.sessionInfo + 1 }
    case 'thinking_level_changed':
      return { ...previous, thinking: previous.thinking + 1 }
    default:
      return previous
  }
}

/**
 * Only history-changing events invalidate the persisted read. Retrying on every
 * token would starve initial hydration, while skipping a conflicted first read
 * would discard all older history. Apply synchronously in the validated window.
 */
export async function refreshPiSnapshot<T>({
  isCurrent,
  watermark,
  read,
  apply,
}: {
  isCurrent(): boolean
  watermark(): PiSnapshotWatermark
  read(): Promise<T>
  apply(value: T, startedAt: PiSnapshotWatermark): void
}): Promise<boolean> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (!isCurrent()) return false
    const startedAt = watermark()
    let value: T
    try {
      value = await read()
    } catch (error) {
      if (!isCurrent()) return false
      throw error
    }
    if (!isCurrent()) return false
    if (startedAt.history !== watermark().history) continue
    apply(value, startedAt)
    return true
  }
  throw new Error('Pi conversation history is changing. Please retry loading the conversation.')
}

/** Session fields updated by newer events take precedence over the older read. */
export function reconcilePiSessionSnapshot(
  snapshot: LocalPiSessionState,
  current: LocalPiSessionState | null,
  startedAt: PiSnapshotWatermark,
  latest: PiSnapshotWatermark,
): LocalPiSessionState {
  if (!current || snapshot.sessionId !== current.sessionId) return snapshot
  return {
    ...snapshot,
    ...(startedAt.activity !== latest.activity ? { isStreaming: current.isStreaming } : {}),
    ...(startedAt.queue !== latest.queue ? { pendingMessageCount: current.pendingMessageCount } : {}),
    ...(startedAt.compaction !== latest.compaction ? { isCompacting: current.isCompacting } : {}),
    ...(startedAt.sessionInfo !== latest.sessionInfo ? { sessionName: current.sessionName } : {}),
    ...(startedAt.thinking !== latest.thinking ? { thinkingLevel: current.thinkingLevel } : {}),
  }
}

/** get_messages contains persisted messages; it must not erase the live overlay. */
export function reconcilePiProjectorSnapshot(
  current: LocalPiProjectorState,
  snapshot: LocalPiProjectorSnapshot,
  startedAt: PiSnapshotWatermark,
  latest: PiSnapshotWatermark,
): LocalPiProjectorState {
  const next = replaceLocalPiProjectorSnapshot(current, snapshot)
  if (next === current || current.generation !== snapshot.generation || current.sessionId !== snapshot.sessionId) {
    return next
  }
  const isStreaming = startedAt.activity !== latest.activity ? current.isStreaming : snapshot.isStreaming
  const finalTools = new Set<string>()
  const knownCalls = new Set<string>()
  for (const message of snapshot.messages) {
    if (message.role === 'toolResult') finalTools.add(message.toolCallId)
    if (message.role === 'assistant') {
      for (const part of message.content) {
        if (part.type === 'toolCall') knownCalls.add(part.id)
      }
    }
  }
  if (isStreaming && current.streamingMessage) {
    for (const part of current.streamingMessage.content) {
      if (part.type === 'toolCall') knownCalls.add(part.id)
    }
  }
  const tools = new Map<string, LocalPiProjectedTool>()
  for (const [id, tool] of current.tools) {
    // A persisted final result wins even when tool_execution_end was lost.
    // Otherwise an old partial overlay would turn the result back to running.
    if (finalTools.has(id)) continue
    const updatedDuringRead = latest.tools.get(id) !== startedAt.tools.get(id)
    if (updatedDuringRead || (knownCalls.has(id) && (isStreaming || tool.phase === 'complete'))) {
      tools.set(id, tool)
    }
  }
  return {
    ...next,
    ...(isStreaming ? {
      streamingMessage: current.streamingMessage,
      streamingContent: current.streamingContent,
      streamingToolCallDeltas: current.streamingToolCallDeltas,
      isTurnActive: current.isTurnActive,
    } : {}),
    isStreaming,
    // Compaction can remove earlier calls. Do not append their stale overlays
    // to the latest response simply because they once executed in this owner.
    tools,
    extensionErrors: current.extensionErrors,
    lastAgentWillRetry: current.lastAgentWillRetry,
    queue: startedAt.queue !== latest.queue ? current.queue : next.queue,
    compaction: {
      ...current.compaction,
      active: startedAt.compaction !== latest.compaction ? current.compaction.active : snapshot.isCompacting,
    },
  }
}
