import type { SelectedLineRange } from '@pierre/diffs'
import { IndexedDbRecordStore } from '../indexeddb-record-store'
import { isPrecisionReference, MAX_REFERENCE_TEXT, type PrecisionReference } from './precision-reference'

/** Resolve real Pierre line selections against visible patch hunks, never guessed line offsets. */
export function selectedDiffText(patch: string, range: SelectedLineRange) {
  const side = range.side ?? 'additions'
  if (range.endSide && range.endSide !== side) return null
  const startLine = Math.min(range.start, range.end), endLine = Math.max(range.start, range.end)
  if (!Number.isSafeInteger(startLine) || startLine < 1 || !Number.isSafeInteger(endLine) || endLine - startLine > MAX_REFERENCE_TEXT) return null
  const lines = new Map<number, string>()
  let oldLine = 0, newLine = 0, inHunk = false
  for (const line of patch.split('\n')) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
    if (hunk) { oldLine = Number(hunk[1]); newLine = Number(hunk[2]); inHunk = true; continue }
    if (!inHunk || line.startsWith('\\')) continue
    if (line.startsWith('diff --git ')) { inHunk = false; continue }
    const prefix = line[0]
    if (prefix !== ' ' && prefix !== '+' && prefix !== '-') continue
    if (side === 'deletions' && prefix !== '+') lines.set(oldLine, line.slice(1))
    if (side === 'additions' && prefix !== '-') lines.set(newLine, line.slice(1))
    if (prefix !== '+') oldLine += 1
    if (prefix !== '-') newLine += 1
  }
  const selected: string[] = []
  for (let line = startLine; line <= endLine; line += 1) {
    const text = lines.get(line)
    if (text === undefined) return null
    selected.push(text)
  }
  const text = selected.join('\n')
  return text.trim() && text.length <= MAX_REFERENCE_TEXT ? { text, startLine, endLine, side } : null
}

interface ReviewPersistence {
  read(key: string): Promise<unknown>
  write(key: string, fields?: Record<string, unknown>): Promise<void>
}
export interface DiffReviewSnapshot { loaded: boolean; comments: readonly PrecisionReference[] }
const EMPTY: DiffReviewSnapshot = { loaded: false, comments: [] }
const MAX_COMMENTS = 50

/** Review drafts are separate from editable messages until the user adds them. */
export class DiffReviewStore {
  private snapshots = new Map<string, DiffReviewSnapshot>()
  private listeners = new Map<string, Set<() => void>>()
  private operations = new Map<string, Promise<unknown>>()
  constructor(private readonly persistence: ReviewPersistence = new IndexedDbRecordStore('pipilot-diff-reviews', 'conversations')) {}
  get = (key: string) => this.snapshots.get(key) ?? EMPTY
  subscribe(key: string, listener: () => void) {
    const listeners = this.listeners.get(key) ?? new Set()
    this.listeners.set(key, listeners)
    listeners.add(listener)
    return () => { listeners.delete(listener); if (!listeners.size) this.listeners.delete(key) }
  }
  private publish(key: string, comments: readonly PrecisionReference[]) {
    this.snapshots.set(key, { loaded: true, comments: Object.freeze(comments.map((comment) => Object.freeze({ ...comment }))) })
    for (const listener of this.listeners.get(key) ?? []) listener()
  }
  private serialize<T>(key: string, run: () => Promise<T>): Promise<T> {
    const result = (this.operations.get(key) ?? Promise.resolve()).then(run, run)
    this.operations.set(key, result)
    const clear = () => { if (this.operations.get(key) === result) this.operations.delete(key) }
    void result.then(clear, clear)
    return result
  }
  private async hydrate(key: string, ownerKey: string) {
    if (this.get(key).loaded) return
    const record = await this.persistence.read(key) as { comments?: unknown } | undefined
    const comments = record?.comments ?? []
    if (!Array.isArray(comments) || comments.length > MAX_COMMENTS || new Set(comments.map((item) => item?.id)).size !== comments.length || comments.some((item) =>
      !isPrecisionReference(item) || item.kind !== 'diff' || item.ownerKey !== ownerKey || !item.comment?.trim())) throw new Error('Invalid review draft')
    this.publish(key, comments)
  }
  load(key: string, ownerKey: string) { return this.serialize(key, () => this.hydrate(key, ownerKey)) }
  change(key: string, ownerKey: string, update: (comments: readonly PrecisionReference[]) => readonly PrecisionReference[]) {
    return this.serialize(key, async () => {
      await this.hydrate(key, ownerKey)
      const comments = update(this.get(key).comments)
      if (comments.length > MAX_COMMENTS || new Set(comments.map((item) => item.id)).size !== comments.length || comments.some((item) => !isPrecisionReference(item) ||
        item.kind !== 'diff' || item.ownerKey !== ownerKey || !item.comment?.trim())) throw new Error('Invalid review draft')
      await this.persistence.write(key, comments.length ? { comments } : undefined)
      this.publish(key, comments)
    })
  }
}
export const diffReviewStore = new DiffReviewStore()
