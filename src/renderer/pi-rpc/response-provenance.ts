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

export function mergeLocalPiEntrySnapshot(
  previous: LocalPiEntrySnapshot | null,
  page: LocalPiEntrySnapshotPage,
): LocalPiEntrySnapshot {
  const canAppend = page.append &&
    previous?.generation === page.generation &&
    previous.sessionId === page.sessionId
  const entries = canAppend
    ? [...previous.entries, ...page.entries]
    : [...page.entries]
  const lastEntry = entries[entries.length - 1]

  return {
    generation: page.generation,
    sessionId: page.sessionId,
    entries,
    leafId: page.leafId,
    cursor: lastEntry?.id ?? null,
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
    if (foundFirstKept) selected.push(entry)
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

  const origins: LocalPiMessageOrigin[] = []
  for (const entry of contextEntries(path)) {
    const origin = messageOrigin(entry)
    if (origin) origins.push(origin)
  }
  if (origins.length !== messages.length) return null
  for (let index = 0; index < messages.length; index += 1) {
    if (origins[index]?.role !== messages[index]?.role) return null
  }
  return origins
}
