import type { Turn } from '@/types/chat'

export interface TurnChange {
  index: number
  before: Turn | undefined
  after: Turn | undefined
}

// Tokens identify adjacent projections without retaining old transcript arrays.
// A consumer that missed a publication safely rebuilds from the current snapshot.
const publications = new WeakMap<readonly Turn[], {
  owner: object
  revision: number
  fromRevision: number
  changes: readonly TurnChange[]
}>()

export function recordTurnChanges(previous: readonly Turn[], next: readonly Turn[], changes: readonly TurnChange[]) {
  let before = publications.get(previous)
  if (!before) {
    before = { owner: {}, revision: 0, fromRevision: -1, changes: [] }
    publications.set(previous, before)
  }
  publications.set(next, { owner: before.owner, revision: before.revision + 1, fromRevision: before.revision, changes })
}

export function adjacentTurnChanges(previous: readonly Turn[], next: readonly Turn[]): readonly TurnChange[] | undefined {
  if (previous === next) return []
  const before = publications.get(previous)
  const after = publications.get(next)
  return before && after && before.owner === after.owner && before.revision === after.fromRevision
    ? after.changes : undefined
}
