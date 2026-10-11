import type { LocalPiTreeRow } from '@/shared/local-pi'

/**
 * Pi keeps every branch of a conversation in one session file. These helpers
 * read its tree (rows in depth-first order) for the ‹ 1/2 › arrows on edited
 * questions and for the branch tab.
 */
export interface ConversationTree {
  rows: readonly LocalPiTreeRow[]
  leafId: string | null
  byId: ReadonlyMap<string, LocalPiTreeRow>
  children: ReadonlyMap<string | null, readonly string[]>
  /** The current branch, root to leaf. */
  path: ReadonlySet<string>
}

export function isUserMessage(row: LocalPiTreeRow) {
  return row.entry.type === 'message' && row.entry.message.role === 'user'
}

export function userMessageText(row: LocalPiTreeRow) {
  if (row.entry.type !== 'message' || row.entry.message.role !== 'user') return ''
  const content = row.entry.message.content
  return (typeof content === 'string' ? content : content.map((part) => part.type === 'text' ? part.text : '').join(' ')).replace(/\s+/gu, ' ').trim()
}

export function buildConversationTree(rows: readonly LocalPiTreeRow[], leafId: string | null): ConversationTree {
  const byId = new Map(rows.map((row) => [row.entry.id, row]))
  const children = new Map<string | null, string[]>()
  for (const row of [...rows].sort((left, right) => left.order - right.order)) {
    const list = children.get(row.parentId) ?? []
    list.push(row.entry.id)
    children.set(row.parentId, list)
  }
  const path = new Set<string>()
  for (let id = leafId; id && !path.has(id); id = byId.get(id)?.parentId ?? null) path.add(id)
  return { rows, leafId, byId, children, path }
}

/** The newest end of the branch that starts at `id`: always the latest child. */
export function branchLeaf(tree: ConversationTree, id: string) {
  let current = id
  const seen = new Set<string>()
  for (;;) {
    seen.add(current)
    const next = tree.children.get(current)
    const last = next?.[next.length - 1]
    if (!last || seen.has(last)) return current
    current = last
  }
}

/** Questions asked from the same point: a question and its edits. */
export function questionSiblings(tree: ConversationTree, id: string) {
  const row = tree.byId.get(id)
  if (!row || !isUserMessage(row)) return null
  const siblings = (tree.children.get(row.parentId) ?? []).filter((candidate) => {
    const sibling = tree.byId.get(candidate)
    return sibling ? isUserMessage(sibling) : false
  })
  if (siblings.length < 2) return null
  return { ids: siblings, index: siblings.indexOf(id) }
}

/** Questions on the current branch whose answer branches elsewhere too, with where each sibling now ends. */
export function branchPoints(tree: ConversationTree) {
  const result = new Map<string, { index: number; count: number; previous?: string; next?: string }>()
  for (const id of tree.path) {
    const siblings = questionSiblings(tree, id)
    if (!siblings) continue
    const { ids, index } = siblings
    result.set(id, {
      index, count: ids.length,
      ...(index > 0 ? { previous: branchLeaf(tree, ids[index - 1]!) } : {}),
      ...(index < ids.length - 1 ? { next: branchLeaf(tree, ids[index + 1]!) } : {}),
    })
  }
  return result
}
