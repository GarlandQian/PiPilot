import type {
  LocalPiAgentMessage,
  LocalPiSessionEntry,
} from '@/shared/local-pi'

export interface LocalPiEntrySnapshot {
  generation: number
  sessionId: string
  entries: readonly LocalPiSessionEntry[]
  leafId: string | null
  cursor: string | null
}

export interface LocalPiEntrySnapshotPage {
  generation: number
  sessionId: string
  entries: readonly LocalPiSessionEntry[]
  leafId: string | null
  append: boolean
}

export interface LocalPiMessageOrigin {
  entryId: string
  role: LocalPiAgentMessage['role']
  forkEntryId: string | null
}

/** SDK custom entries can arrive before ordinary message entries are fetched.
 * Advancing the incremental cursor past such a gap makes its parent unreachable.
 */
export function canAppendLocalPiEntry(snapshot: LocalPiEntrySnapshot, entry: LocalPiSessionEntry): boolean {
  return entry.parentId === null || snapshot.entries.some((candidate) => candidate.id === entry.parentId)
}

export function appendLocalPiEntryEvent(snapshot: LocalPiEntrySnapshot, entry: LocalPiSessionEntry): LocalPiEntrySnapshot {
  if (!canAppendLocalPiEntry(snapshot, entry) || snapshot.entries.some((candidate) => candidate.id === entry.id)) return snapshot
  // An event proves ancestry, not that all intervening entries were read. Only
  // get_entries may advance the cursor, including when another branch changed.
  return { ...snapshot, entries: [...snapshot.entries, entry], leafId: entry.id }
}

export function mergeLocalPiEntrySnapshot(
  previous: LocalPiEntrySnapshot | null,
  page: LocalPiEntrySnapshotPage,
): LocalPiEntrySnapshot {
  const canAppend = page.append &&
    previous?.generation === page.generation &&
    previous.sessionId === page.sessionId
  const pageIds = new Set(page.entries.map((entry) => entry.id))
  const entries = canAppend
    ? [...previous.entries.filter((entry) => !pageIds.has(entry.id)), ...page.entries]
    : [...page.entries]
  const lastReadEntry = page.entries[page.entries.length - 1]

  return {
    generation: page.generation,
    sessionId: page.sessionId,
    entries,
    leafId: page.leafId,
    cursor: lastReadEntry?.id ?? (canAppend ? previous.cursor : null),
  }
}

function activeSessionPath(
  entries: readonly LocalPiSessionEntry[],
  leafId: string | null,
): readonly LocalPiSessionEntry[] | null {
  if (leafId === null) return []

  const byId = new Map<string, LocalPiSessionEntry>()
  for (const entry of entries) {
    if (byId.has(entry.id)) return null
    byId.set(entry.id, entry)
  }

  const leaf = byId.get(leafId)
  if (!leaf) return null

  const reversedPath: LocalPiSessionEntry[] = []
  const seen = new Set<string>()
  let current: LocalPiSessionEntry | undefined = leaf
  while (current) {
    if (seen.has(current.id)) return null
    seen.add(current.id)
    reversedPath.push(current)
    if (current.parentId === null) break
    current = byId.get(current.parentId)
    if (!current) return null
  }

  reversedPath.reverse()
  return reversedPath
}

function contextEntries(
  path: readonly LocalPiSessionEntry[],
): readonly LocalPiSessionEntry[] {
  let compactionIndex = -1
  for (let index = 0; index < path.length; index += 1) {
    if (path[index]?.type === 'compaction') compactionIndex = index
  }
  if (compactionIndex < 0) return path

  const compaction = path[compactionIndex]
  if (!compaction || compaction.type !== 'compaction') return path

  const selected: LocalPiSessionEntry[] = [compaction]
  let foundFirstKept = false
  for (let index = 0; index < compactionIndex; index += 1) {
    const entry = path[index]
    if (!entry) continue
    if (entry.id === compaction.firstKeptEntryId) foundFirstKept = true
    if (foundFirstKept && !(entry.type === 'message' && entry.message.role === 'system')) selected.push(entry)
  }
  for (let index = compactionIndex + 1; index < path.length; index += 1) {
    const entry = path[index]
    if (entry) selected.push(entry)
  }
  return selected
}

function messageOrigin(
  entry: LocalPiSessionEntry,
): LocalPiMessageOrigin | null {
  switch (entry.type) {
    case 'message':
      return {
        entryId: entry.id,
        role: entry.message.role,
        forkEntryId: entry.message.role === 'user' ? entry.id : null,
      }
    case 'custom_message':
      return { entryId: entry.id, role: 'custom', forkEntryId: null }
    case 'compaction':
      return {
        entryId: entry.id,
        role: 'compactionSummary',
        forkEntryId: null,
      }
    case 'branch_summary':
      return entry.summary
        ? { entryId: entry.id, role: 'branchSummary', forkEntryId: null }
        : null
    default:
      return null
  }
}

export function alignLocalPiMessageOrigins(
  snapshot: LocalPiEntrySnapshot,
  messages: readonly LocalPiAgentMessage[],
): readonly LocalPiMessageOrigin[] | null {
  const path = activeSessionPath(snapshot.entries, snapshot.leafId)
  if (!path) return null

  const context = contextEntries(path)
  const edits = new Map<string, Extract<LocalPiSessionEntry, { type: 'context_edit' }>['replacement']>()
  for (const entry of context) {
    if (entry.type === 'context_edit') edits.set(entry.targetId, entry.replacement)
  }
  const origins: LocalPiMessageOrigin[] = []
  const sourceEntries: LocalPiSessionEntry[] = []
  for (const [index, entry] of context.entries()) {
    // Pi's native retry records context_edit omissions while preserving raw
    // history. Only the current projected context participates in alignment.
    if (edits.has(entry.id) && edits.get(entry.id) === null) continue
    // A retained older compaction is metadata; only the newest checkpoint
    // emits a summary (and, in current Pi, its optional system message).
    if (entry.type === 'compaction') {
      if (index > 0) continue
      if (entry.systemMessage) {
        origins.push({ entryId: entry.id, role: 'system', forkEntryId: null })
        sourceEntries.push(entry)
      }
    }
    const origin = messageOrigin(entry)
    if (origin) {
      origins.push(origin)
      sourceEntries.push(entry)
    }
  }
  // get_messages retains the final persisted error in the UI when native
  // retry has omitted it and the user stops waiting. Restore that exact tail
  // only, at the same final position as the Main snapshot. Earlier attempts
  // and entries on another branch must never acquire editable origins.
  let lastMessageEntry: Extract<LocalPiSessionEntry, { type: 'message' }> | undefined
  for (let index = path.length - 1; index >= 0; index -= 1) {
    const entry = path[index]!
    if (entry.type !== 'message' ||
        (entry.message.role !== 'assistant' && entry.message.role !== 'user' && entry.message.role !== 'toolResult')) continue
    lastMessageEntry = entry
    break
  }
  const lastMessage = messages[messages.length - 1]
  if (lastMessageEntry?.type === 'message' && lastMessageEntry.message.role === 'assistant' &&
      lastMessageEntry.message.stopReason === 'error' && lastMessage?.role === 'assistant' &&
      lastMessage.stopReason === 'error' && lastMessage.timestamp === lastMessageEntry.message.timestamp &&
      !sourceEntries.includes(lastMessageEntry)) {
    origins.push({ entryId: lastMessageEntry.id, role: 'assistant', forkEntryId: null })
    sourceEntries.push(lastMessageEntry)
  }
  if (origins.length !== messages.length) return null
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]!
    if (origins[index]?.role !== message.role) return null
    const entry = sourceEntries[index]
    if (entry?.type === 'message' && entry.message.timestamp !== message.timestamp) return null
  }
  return origins
}
