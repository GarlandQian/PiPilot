import type { ConversationOutlineItem, ToolCall, Turn } from '@/types/chat'
import { adjacentTurnChanges } from './turn-changes'
import type { LocalPiEntrySnapshot } from './response-provenance'

export interface PiTranscriptSnapshot {
  turns: readonly Turn[]
  outline: readonly ConversationOutlineItem[]
  revision: number
  loading: boolean
  entries?: LocalPiEntrySnapshot | null
}

/** Fine-grained read selectors prevent transcript deltas from waking the shell. */
export function createTranscriptStore(initial: PiTranscriptSnapshot) {
  let snapshot = initial
  let tools = indexTools(initial.turns)
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => snapshot,
    getLoading: () => snapshot.loading,
    getOutline: () => snapshot.outline,
    getEntries: () => snapshot.entries ?? null,
    getToolCall: (id: string | null) => id ? tools.get(id) ?? null : null,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    publish(next: PiTranscriptSnapshot) {
      if (snapshot === next) return
      if (snapshot.turns !== next.turns) {
        const changes = adjacentTurnChanges(snapshot.turns, next.turns)
        // Text deltas cannot affect a tool selector. Rebuild on actual tool
        // changes to preserve last-occurrence semantics for duplicate call ids.
        if (!changes || changes.some(({ before, after }) => before?.kind === 'tool' || after?.kind === 'tool')) tools = indexTools(next.turns)
      }
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
