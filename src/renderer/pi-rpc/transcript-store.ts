import type { ConversationOutlineItem, ToolCall, Turn } from '@/types/chat'

export interface PiTranscriptSnapshot {
  turns: readonly Turn[]
  outline: readonly ConversationOutlineItem[]
  revision: number
  loading: boolean
}

/** Fine-grained read selectors prevent transcript deltas from waking the shell. */
export function createTranscriptStore(initial: PiTranscriptSnapshot) {
  let snapshot = initial
  let tools = indexTools(initial.turns)
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => snapshot,
    getLoading: () => snapshot.loading,
    getToolCall: (id: string | null) => id ? tools.get(id) ?? null : null,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    publish(next: PiTranscriptSnapshot) {
      if (snapshot === next) return
      if (snapshot.turns !== next.turns) tools = indexTools(next.turns)
      snapshot = next
      for (const listener of listeners) listener()
    },
  }
}

function indexTools(turns: readonly Turn[]): ReadonlyMap<string, ToolCall> {
  const tools = new Map<string, ToolCall>()
  for (const turn of turns) if (turn.kind === 'tool') tools.set(turn.call.id, turn.call)
  return tools
}
