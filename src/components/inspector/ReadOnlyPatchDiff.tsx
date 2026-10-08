import * as React from 'react'
import { PatchDiff, Virtualizer } from '@pierre/diffs/react'
import type { DiffLineAnnotation, FileDiffLoadedFiles, SelectedLineRange } from '@pierre/diffs'
import { ReviewCommentCard, SelectedDiffComment, useDiffReview } from '@/components/precision/DiffReview'
import { selectedDiffText } from '@/renderer/composer/diff-review'
import type { PrecisionReference } from '@/renderer/composer/precision-reference'
import type { ContinuousDiffFile } from './continuous-diff-controller'
import { TbArrowBackUp, TbMinus, TbPlus } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { patchHunks } from '@/shared/patch-hunks'
import { useLocale, useT } from '@/i18n'
import { useSettings } from '@/store/settings'
import { resolveMonoFontStack } from '@/types/settings'
import { useDiffThemeType } from './diff-theme'
import { createReadOnlyDiffOptions, createReadOnlyDiffStyle, localizeDiffSeparators } from './read-only-diff-options'

type ReviewAnnotation = { reference: PrecisionReference } | { selection: SelectedLineRange } | { hunk: number; line: number }

export type HunkAction = 'stage' | 'unstage' | 'discard'

/**
 * The row above a hunk's changes: where it starts, and (for working-tree
 * files) its own stage, unstage or discard, shown when the file is hovered.
 */
function HunkHeader({ line, stage, busy, onAction }: { line: number; stage?: 'staged' | 'unstaged'; busy?: boolean; onAction?(action: HunkAction): void }) {
  const t = useT()
  return <div className="flex h-6 items-center gap-1 pr-2 pl-3 font-sans text-micro text-muted-foreground" data-diff-hunk-actions>
    <span className="tabular-nums">{t('inspector.diff.hunkAt', { line })}</span>
    <span className="flex-1" />
    {onAction ? <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/diff:opacity-100 group-focus-within/diff:opacity-100 motion-reduce:transition-none">
      {stage === 'unstaged' ? <>
        <Button variant="ghost" size="xs" className="h-5 px-1.5 text-micro" disabled={busy} onClick={() => onAction('discard')}><TbArrowBackUp aria-hidden />{t('inspector.diff.discardHunk')}</Button>
        <Button variant="ghost" size="xs" className="h-5 px-1.5 text-micro" disabled={busy} onClick={() => onAction('stage')}><TbPlus aria-hidden />{t('inspector.diff.stageHunk')}</Button>
      </> : <Button variant="ghost" size="xs" className="h-5 px-1.5 text-micro" disabled={busy} onClick={() => onAction('unstage')}><TbMinus aria-hidden />{t('inspector.diff.unstageHunk')}</Button>}
    </div> : null}
  </div>
}

export function ReadOnlyPatchDiff({ patch, file, split = false, wrap, hunkActions, loadSides }: {
  patch: string
  file?: ContinuousDiffFile
  split?: boolean
  /** Overrides the app's word-wrap preference. */
  wrap?: boolean
  /** Per-hunk staging for working-tree files with more than one hunk. */
  hunkActions?: { stage: 'staged' | 'unstaged'; busy?: boolean; onAction(action: HunkAction, hunk: number): void }
  /** Both sides of the file, so unchanged lines between hunks can expand. */
  loadSides?: () => Promise<FileDiffLoadedFiles>
}) {
  const settings = useSettings()
  const review = useDiffReview()
  const t = useT()
  const [capturedSelection, setSelection] = React.useState<{ ownerKey: string; range: SelectedLineRange; file: ContinuousDiffFile } | null>(null)
  const selection = capturedSelection?.ownerKey === review?.ownerKey ? capturedSelection : null
  const [comment, setComment] = React.useState('')
  const [invalidSelection, setInvalidSelection] = React.useState(false)
  React.useEffect(() => { setSelection(null); setComment(''); setInvalidSelection(false) }, [file?.id, review?.ownerKey])
  const selectable = Boolean(file && review?.ready && !file.refreshing && !file.errorCode)
  const select = React.useCallback((range: SelectedLineRange | null) => {
    const valid = range && selectedDiffText(patch, range)
    setInvalidSelection(Boolean(range && !valid))
    if (valid && range && file && review) { setSelection({ ownerKey: review.ownerKey, range, file: { ...file } }); setComment('') }
    else setSelection(null)
  }, [patch, file, review])
  const themeType = useDiffThemeType()
  const locale = useLocale()
  const { appearance } = settings
  const loader = React.useRef(loadSides)
  loader.current = loadSides
  const separatorLabel = React.useCallback((count: number) => t('inspector.diff.unmodifiedLines', { count }), [t])
  const expandAll = t('inspector.diff.expandAll')
  const moreContext = t('inspector.diff.moreContext')
  const options = React.useMemo(
    () => ({ ...createReadOnlyDiffOptions<ReviewAnnotation>({
      themeType,
      locale,
      split,
      wordWrap: wrap ?? appearance.wordWrap,
      // Review selection uses the number gutter, even when code views hide line numbers.
      showLineNumbers: selectable || appearance.showLineNumbers,
    }),
    enableLineSelection: selectable,
    onLineSelectionEnd: select,
    // Codex: hover a line, then its "+" comments on it.
    enableGutterUtility: selectable,
    onGutterUtilityClick: select,
    ...(loadSides ? { loadDiffFiles: () => loader.current!() } : {}),
    onPostRender: (node: HTMLElement) => localizeDiffSeparators(node, separatorLabel, expandAll, moreContext),
    }),
    [appearance.showLineNumbers, appearance.wordWrap, expandAll, moreContext, locale, separatorLabel, themeType, selectable, select, split, wrap, Boolean(loadSides)], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const style = React.useMemo(() => createReadOnlyDiffStyle(appearance, resolveMonoFontStack(appearance.monoFontFamily)), [appearance])

  const annotations: DiffLineAnnotation<ReviewAnnotation>[] = (review?.comments ?? []).filter((reference) =>
    file && reference.sourceId === file.id && review?.freshness(reference) === 'current').map((reference) => ({
      lineNumber: reference.endLine!, side: reference.side!, metadata: { reference },
    }))
  const hunks = React.useMemo(() => patchHunks(patch), [patch])
  // With more than one hunk, each gets its own header row (and its own actions).
  if (hunks.length > 1) for (const hunk of hunks) annotations.push({ lineNumber: hunk.top.lineNumber, side: hunk.top.side, metadata: { hunk: hunk.index, line: Math.max(1, hunk.top.lineNumber + 1) } })
  const selectionCurrent = selection?.file.revision === file?.revision
  if (selection && selectionCurrent) annotations.push({ lineNumber: Math.max(selection.range.start, selection.range.end),
    side: selection.range.side ?? 'additions', metadata: { selection: selection.range } })
  const selectionForm = selection ? <SelectedDiffComment key={`${review?.ownerKey}:${selection.file.revision}:${JSON.stringify(selection.range)}`}
    file={selection.file} selection={selection.range} text={comment} onTextChange={setComment} onClose={() => {
      // Pierre keys annotation slots by array index, so saving a comment can
      // remount this form before its write resolves. The owning selection,
      // rather than the transient annotation component, decides what closes.
      setSelection((current) => current === selection ? null : current)
    }} /> : null
  return <>
    {invalidSelection ? <p role="alert" className="px-3 py-2 text-caption text-warning">{t('precision.invalidDiffSelection')}</p> : null}
    <PatchDiff<ReviewAnnotation>
      patch={patch}
      options={options}
      style={style}
      selectedLines={selectionCurrent ? selection?.range ?? null : null}
      lineAnnotations={annotations}
      renderAnnotation={({ metadata }) => 'reference' in metadata
        ? <ReviewCommentCard reference={metadata.reference} />
        : 'hunk' in metadata
          ? <HunkHeader line={metadata.line} stage={hunkActions?.stage} busy={hunkActions?.busy} onAction={hunkActions ? (action) => hunkActions.onAction(action, metadata.hunk) : undefined} />
          : selectionForm}
      disableWorkerPool
    />
    {selection && !selectionCurrent ? selectionForm : null}
  </>
}

interface ReadOnlyDiffVirtualizerProps {
  children: React.ReactNode
  onScrollRoot: (root: HTMLElement | null) => void
}

export function ReadOnlyDiffVirtualizer({
  children,
  onScrollRoot,
}: ReadOnlyDiffVirtualizerProps) {
  const hostRef = React.useRef<HTMLDivElement>(null)

  React.useLayoutEffect(() => {
    const root = hostRef.current?.firstElementChild
    const scrollRoot = root instanceof HTMLElement ? root : null
    onScrollRoot(scrollRoot)
    return () => onScrollRoot(null)
  }, [onScrollRoot])

  return (
    <div ref={hostRef} className="min-h-0 flex-1 overflow-hidden">
      <Virtualizer
        className="scroll-slim h-full min-h-0 overflow-auto overscroll-contain"
        contentClassName="min-w-0 pb-2"
      >
        {children}
      </Virtualizer>
    </div>
  )
}
