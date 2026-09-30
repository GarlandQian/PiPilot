import * as React from 'react'
import type { SelectedLineRange } from '@pierre/diffs'
import { TbMessagePlus, TbPencil, TbTrash } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n'
import type { ContinuousDiffFile } from '@/components/inspector/continuous-diff-controller'
import { diffReviewStore, selectedDiffText } from '@/renderer/composer/diff-review'
import { MAX_REVIEW_COMMENT, precisionReferenceLabel, type PrecisionReference } from '@/renderer/composer/precision-reference'
import { sessionComposerDrafts } from '@/renderer/composer/session-drafts'
import { usePrecisionReferences } from './PrecisionReferences'

type Freshness = 'current' | 'stale' | 'unknown'
interface ReviewContext {
  ownerKey: string
  ready: boolean
  pending: boolean
  comments: readonly PrecisionReference[]
  freshness(reference: Pick<PrecisionReference, 'sourceId' | 'revision'>): Freshness
  save(reference: PrecisionReference): Promise<boolean>
  remove(id: string): Promise<boolean>
  removeCaptured(references: readonly PrecisionReference[]): Promise<boolean>
}
const Context = React.createContext<ReviewContext | null>(null)
export const useDiffReview = () => React.useContext(Context)

export function DiffReviewProvider({ files, complete, children }: {
  files: readonly ContinuousDiffFile[]; complete: boolean; children: React.ReactNode
}) {
  const precision = usePrecisionReferences()
  const ownerKey = precision?.ownerKey ?? ''
  const key = JSON.stringify([ownerKey, precision?.workspaceId ?? null])
  const subscribe = React.useCallback((listener: () => void) => diffReviewStore.subscribe(key, listener), [key])
  const snapshot = React.useCallback(() => diffReviewStore.get(key), [key])
  const state = React.useSyncExternalStore(subscribe, snapshot, snapshot)
  const [pendingKey, setPendingKey] = React.useState<string | null>(null)
  const [errorKey, setErrorKey] = React.useState<string | null>(null)
  const mountedKey = React.useRef(key)
  mountedKey.current = key
  React.useEffect(() => {
    if (ownerKey && precision?.workspaceId) void diffReviewStore.load(key, ownerKey).catch(() => {
      if (mountedKey.current === key) setErrorKey(key)
    })
  }, [key, ownerKey, precision?.workspaceId])
  const freshness = React.useCallback((reference: Pick<PrecisionReference, 'sourceId' | 'revision'>): Freshness => {
    const file = files.find((candidate) => candidate.id === reference.sourceId)
    if (!file) return complete ? 'stale' : 'unknown'
    if (file.revision !== reference.revision) return 'stale'
    return file.refreshing || file.errorCode ? 'unknown' : 'current'
  }, [files, complete])
  const run = React.useCallback(async (operation: () => Promise<void>) => {
    if (sessionComposerDrafts.isLocked()) return false
    setPendingKey(key)
    setErrorKey(null)
    try { await operation(); return true }
    catch { if (mountedKey.current === key) setErrorKey(key); return false }
    finally { if (mountedKey.current === key) setPendingKey(null) }
  }, [key])
  const save = React.useCallback((reference: PrecisionReference) => run(() => diffReviewStore.change(key, ownerKey, (comments) =>
    comments.some((item) => item.id === reference.id) ? comments.map((item) => item.id === reference.id ? reference : item) : [...comments, reference])), [key, ownerKey, run])
  const remove = React.useCallback((id: string) => run(() => diffReviewStore.change(key, ownerKey, (comments) => comments.filter((item) => item.id !== id))), [key, ownerKey, run])
  const removeCaptured = React.useCallback((references: readonly PrecisionReference[]) => run(() => diffReviewStore.change(key, ownerKey, (comments) => comments.filter((item) =>
    !references.some((captured) => captured.id === item.id && captured.comment === item.comment && captured.revision === item.revision)))), [key, ownerKey, run])
  const value = React.useMemo(() => ({ ownerKey, comments: state.comments, ready: state.loaded && Boolean(precision?.workspaceId),
    pending: pendingKey === key, freshness, save, remove, removeCaptured }), [ownerKey, state, precision?.workspaceId, pendingKey, key, freshness, save, remove, removeCaptured])
  const t = useT()
  return <Context.Provider value={value}>
    {errorKey === key ? <p role="alert" className="flex items-center gap-2 px-3 py-2 text-caption text-destructive">{t('precision.reviewStorageFailed')}<Button variant="ghost" size="xs" onClick={() => void run(() => diffReviewStore.load(key, ownerKey))}>{t('common.retry')}</Button></p> : null}
    {children}
  </Context.Provider>
}

export function ReviewCommentCard({ reference }: { reference: PrecisionReference }) {
  const review = useDiffReview()
  const t = useT()
  const [editing, setEditing] = React.useState(false)
  const [text, setText] = React.useState(reference.comment ?? '')
  React.useEffect(() => { setText(reference.comment ?? ''); setEditing(false) }, [reference])
  if (!review) return null
  return <div className="glass my-2 rounded-[12px] p-2.5 text-caption" data-review-comment={reference.id}>
    <div className="flex items-center gap-1"><p className="min-w-0 flex-1 truncate font-mono text-micro">{precisionReferenceLabel(reference)} · {t(reference.side === 'deletions' ? 'precision.oldSide' : 'precision.newSide')}</p>
      <Button variant="ghost" size="icon-xs" aria-label={t('precision.editComment')} disabled={review.pending} onClick={() => setEditing((value) => !value)}><TbPencil aria-hidden /></Button>
      <Button variant="ghost" size="icon-xs" aria-label={t('precision.deleteComment')} disabled={review.pending} onClick={() => void review.remove(reference.id)}><TbTrash aria-hidden /></Button>
    </div>
    {review.freshness(reference) !== 'current' ? <p className="my-1 text-warning" role="status">{t(review.freshness(reference) === 'stale' ? 'precision.stale' : 'precision.verifying')}</p> : null}
    <details className="my-1 text-micro text-muted-foreground"><summary className="cursor-pointer">{t('precision.snapshot')}</summary><pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono">{reference.text}</pre></details>
    {editing ? <form onSubmit={(event) => { event.preventDefault(); void review.save({ ...reference, comment: text.trim() }).then((saved) => { if (saved) setEditing(false) }) }}>
      <textarea autoFocus aria-label={t('precision.comment')} value={text} maxLength={MAX_REVIEW_COMMENT} onChange={(event) => setText(event.target.value)} className="my-1 min-h-20 w-full rounded-md bg-control p-2 shadow-[0_0_0_0.5px_var(--color-input),inset_0_0.5px_1px_rgb(0_0_0/0.06)] outline-none focus-visible:shadow-[0_0_0_0.5px_var(--color-ring),0_0_0_3.5px_color-mix(in_srgb,var(--color-ring)_45%,transparent)] dark:bg-white/5" />
      <Button size="xs" type="submit" disabled={!text.trim() || review.pending}>{t('precision.saveComment')}</Button>
    </form> : <p className="whitespace-pre-wrap break-words">{reference.comment}</p>}
  </div>
}

export function DiffReviewSummary() {
  const review = useDiffReview()
  const precision = usePrecisionReferences()
  const t = useT()
  const [adding, setAdding] = React.useState(false)
  const [failed, setFailed] = React.useState(false)
  const owner = React.useRef(review?.ownerKey)
  owner.current = review?.ownerKey
  React.useEffect(() => { setAdding(false); setFailed(false) }, [review?.ownerKey])
  if (!review?.ready) return null
  return <div className="shrink-0 border-b border-border px-3 py-2 text-caption" data-diff-review-summary>
    <p className="text-micro text-muted-foreground">{t('precision.projectScope')}</p>
    <p className="mt-1 text-micro text-muted-foreground">{t('precision.selectDiffLines')}</p>
    {review.comments.length ? <details className="mt-2" open><summary className="cursor-pointer font-medium">{t('precision.reviewCount', { count: review.comments.length })}</summary>
      <div className="scroll-slim max-h-56 overflow-auto">{review.comments.map((reference) => <ReviewCommentCard key={reference.id} reference={reference} />)}</div>
      <Button size="sm" variant="secondary" className="mt-2" disabled={adding || review.pending || !precision?.available || review.comments.some((reference) => review.freshness(reference) === 'unknown')}
        onClick={() => {
          const captured = review.comments
          const capturedOwner = review.ownerKey
          setAdding(true); setFailed(false)
          const transfer = async () => {
            if (!precision?.insert(captured.map((reference) => ({ ...reference, stale: review.freshness(reference) === 'stale' })))) throw new Error('Composer unavailable')
            await sessionComposerDrafts.flush(review.ownerKey)
            if (!await review.removeCaptured(captured)) throw new Error('Review cleanup failed')
          }
          void transfer().catch(() => { if (owner.current === capturedOwner) setFailed(true) }).finally(() => { if (owner.current === capturedOwner) setAdding(false) })
        }}><TbMessagePlus aria-hidden />{t('precision.addReviewToDraft')}</Button>
    </details> : null}
    {failed ? <p className="mt-1 text-destructive" role="alert">{t('precision.reviewTransferFailed')}</p> : null}
  </div>
}

export function SelectedDiffComment({ file, selection, text, onTextChange, onClose }: {
  file: ContinuousDiffFile; selection: SelectedLineRange; text: string; onTextChange(text: string): void; onClose(): void
}) {
  const t = useT()
  const review = useDiffReview()
  const selected = selectedDiffText(file.patch ?? '', selection)
  if (!review?.ready || !selected) return <p role="alert" className="p-2 text-caption text-warning">{t('precision.invalidDiffSelection')}</p>
  const freshness = review.freshness({ sourceId: file.id, revision: file.revision })
  return <form className="glass my-2 rounded-[14px] p-3 text-caption shadow-[var(--glass-shadow),0_0_0_1.5px_var(--color-ring)]" data-review-new-comment onSubmit={(event) => {
    event.preventDefault()
    if (!text.trim() || file.refreshing || file.errorCode) return
    void review.save({ id: crypto.randomUUID(), ownerKey: review.ownerKey, kind: 'diff', sourceId: file.id,
      label: file.path, path: file.path, revision: file.revision, stage: file.stage, ...selected, comment: text.trim() }).then((saved) => { if (saved) onClose() })
  }}>
    <p className="mb-2 font-mono text-micro">{file.path}:{selected.startLine}–{selected.endLine} · {t(selected.side === 'deletions' ? 'precision.oldSide' : 'precision.newSide')}</p>
    {freshness !== 'current' ? <p className="my-2 text-warning" role="status">{t(freshness === 'stale' ? 'precision.stale' : 'precision.verifying')}</p> : null}
    <textarea autoFocus aria-label={t('precision.comment')} placeholder={t('precision.commentPlaceholder')} value={text} onChange={(event) => onTextChange(event.target.value)} maxLength={MAX_REVIEW_COMMENT}
      className="min-h-20 w-full rounded-md bg-control p-2 shadow-[0_0_0_0.5px_var(--color-input),inset_0_0.5px_1px_rgb(0_0_0/0.06)] outline-none focus-visible:shadow-[0_0_0_0.5px_var(--color-ring),0_0_0_3.5px_color-mix(in_srgb,var(--color-ring)_45%,transparent)] dark:bg-white/5" />
    <div className="mt-2 flex gap-2"><Button size="xs" type="submit" disabled={!text.trim() || review.pending || Boolean(file.refreshing || file.errorCode)}>{t('precision.saveComment')}</Button>
      <Button size="xs" variant="ghost" type="button" onClick={onClose}>{t('common.cancel')}</Button></div>
  </form>
}
