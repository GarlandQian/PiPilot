import * as React from 'react'
import { PatchDiff, Virtualizer } from '@pierre/diffs/react'
import type { DiffLineAnnotation, SelectedLineRange } from '@pierre/diffs'
import { ReviewCommentCard, SelectedDiffComment, useDiffReview } from '@/components/precision/DiffReview'
import { selectedDiffText } from '@/renderer/composer/diff-review'
import type { PrecisionReference } from '@/renderer/composer/precision-reference'
import type { ContinuousDiffFile } from './continuous-diff-controller'
import { useT } from '@/i18n'
import { useSettings } from '@/store/settings'
import { resolveMonoFontStack } from '@/types/settings'
import {
  createReadOnlyDiffOptions,
  createReadOnlyDiffStyle,
  type ReadOnlyDiffThemeType,
} from './read-only-diff-options'

function readThemeType(): ReadOnlyDiffThemeType {
  if (typeof document === 'undefined') return 'light'
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

function useThemeType(): ReadOnlyDiffThemeType {
  const [themeType, setThemeType] = React.useState<ReadOnlyDiffThemeType>(readThemeType)

  React.useEffect(() => {
    const root = document.documentElement
    const update = () => setThemeType(readThemeType())
    const observer = new MutationObserver(update)
    observer.observe(root, { attributes: true, attributeFilter: ['class'] })
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener('change', update)
    update()
    return () => {
      observer.disconnect()
      media.removeEventListener('change', update)
    }
  }, [])

  return themeType
}

type ReviewAnnotation = { reference: PrecisionReference } | { selection: SelectedLineRange }

export function ReadOnlyPatchDiff({ patch, file }: { patch: string; file?: ContinuousDiffFile }) {
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
  const themeType = useThemeType()
  const { appearance } = settings
  const options = React.useMemo(
    () => ({ ...createReadOnlyDiffOptions<ReviewAnnotation>({
      themeType,
      wordWrap: appearance.wordWrap,
      // Review selection uses Pierre's real number gutter, even when ordinary
      // read-only code views hide their line numbers.
      showLineNumbers: selectable || appearance.showLineNumbers,
    }), enableLineSelection: selectable, onLineSelectionEnd: select }),
    [appearance.showLineNumbers, appearance.wordWrap, themeType, selectable, select],
  )
  const style = React.useMemo(
    () => createReadOnlyDiffStyle(
      appearance,
      resolveMonoFontStack(appearance.monoFontFamily),
    ),
    [appearance],
  )

  const annotations: DiffLineAnnotation<ReviewAnnotation>[] = (review?.comments ?? []).filter((reference) =>
    file && reference.sourceId === file.id && review?.freshness(reference) === 'current').map((reference) => ({
      lineNumber: reference.endLine!, side: reference.side!, metadata: { reference },
    }))
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
