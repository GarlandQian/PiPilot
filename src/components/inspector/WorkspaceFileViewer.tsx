import * as React from 'react'
import { File as CodeFile } from '@pierre/diffs/react'
import type { SelectedLineRange } from '@pierre/diffs'
import { TbAt, TbCheck, TbChevronRight, TbCopy, TbDots, TbFile, TbFolderOpen, TbGitCompare, TbLoader2, TbMessages, TbQuote, TbRefresh, TbTextWrap, TbX } from 'react-icons/tb'
import { QuoteSelection, usePrecisionReferences } from '@/components/precision/PrecisionReferences'
import { MarkdownContent } from '@/components/chat/markdown/MarkdownContent'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useLocale, useT } from '@/i18n'
import { revealLabelKey } from '@/lib/platform-labels'
import { cn } from '@/lib/utils'
import { useSettings, useUpdateSettings } from '@/store/settings'
import { resolveMonoFontStack } from '@/types/settings'
import { MAX_REFERENCE_TEXT, type PrecisionReference } from '@/renderer/composer/precision-reference'
import { WORKSPACE_MEDIA_BYTE_LIMIT, workspaceMediaType, type WorkspaceFileMedia, type WorkspaceFilePreview } from '@/shared/workspace-content'
import { CODE_THEMES, createReadOnlyDiffStyle } from './read-only-diff-options'
import { useDiffThemeType } from './diff-theme'
import { OpenInEditorButton } from './OpenInEditorButton'
import { classifyWorkspaceFile, formatWorkspaceFileSize } from './workspace-file-kind'

type MarkdownMode = 'preview' | 'source'

export interface WorkspaceFileViewerProps {
  path: string
  workspaceId?: string
  workspaceName?: string
  preview?: WorkspaceFilePreview
  loading: boolean
  refreshing?: boolean
  errorMessage?: string
  onRetry?: () => void
  onRefresh?: () => void
  onShowChanges?: () => void
  onAddToComposer?: () => void
  onReveal?: () => void
  /** Images and PDFs show as themselves. */
  onReadMedia?: (path: string) => Promise<WorkspaceFileMedia>
  /** This file has uncommitted changes. */
  modified?: boolean
  visible?: boolean
}

function PreviewState({ children, role }: { children: React.ReactNode; role?: 'alert' | 'status' }) {
  return <div role={role} className="flex h-full min-h-32 flex-1 items-center justify-center px-4 py-8 text-center text-caption text-muted-foreground">
    <div className="flex max-w-full flex-col items-center gap-2">{children}</div>
  </div>
}

/** src › lib › index.ts — folders muted, the file in full. */
function PathCrumbs({ path }: { path: string }) {
  const parts = path.split('/')
  const name = parts.pop() ?? path
  return <h2 className="flex min-w-0 flex-1 items-center gap-0.5 text-caption" title={path}>
    {parts.length ? <span className="flex min-w-0 shrink items-center gap-0.5 overflow-hidden text-muted-foreground" dir="ltr">
      {/* Long paths keep their last folders; the start gives way first. */}
      {parts.length > 3 ? <><span className="shrink-0">…</span><TbChevronRight className="size-3 shrink-0" aria-hidden /></> : null}
      {parts.slice(-3).map((part, index) => <React.Fragment key={`${index}:${part}`}>
        <span className="min-w-0 truncate">{part}</span>
        <TbChevronRight className="size-3 shrink-0 opacity-70" aria-hidden />
      </React.Fragment>)}
    </span> : null}
    <span className="min-w-0 shrink-0 truncate font-medium text-foreground">{name}</span>
  </h2>
}

function ModeSwitch({ mode, onChange }: { mode: MarkdownMode; onChange(mode: MarkdownMode): void }) {
  const t = useT()
  return <div role="group" aria-label={t('inspector.preview.mode')} className="mac-segmented h-6 shrink-0 [&>button]:h-5 [&>button]:px-2 [&>button]:text-micro">
    {(['preview', 'source'] as const).map((value) => <button key={value} type="button" aria-pressed={mode === value} onClick={() => onChange(value)}
      className="outline-none focus-visible:focus-ring">{t(value === 'preview' ? 'inspector.preview.mode.preview' : 'inspector.preview.mode.source')}</button>)}
  </div>
}

/** Source with line numbers, highlighted like the diffs. Selecting line numbers references those lines. */
function SourceCode({ path, content, fingerprint, wordWrap, onReference }: {
  path: string
  content: string
  fingerprint: string
  wordWrap: boolean
  onReference?: (reference: Omit<PrecisionReference, 'id' | 'ownerKey'>, side: boolean) => void
}) {
  const t = useT()
  const settings = useSettings()
  const themeType = useDiffThemeType()
  const [selection, setSelection] = React.useState<SelectedLineRange | null>(null)
  React.useEffect(() => setSelection(null), [fingerprint, path])
  const options = React.useMemo(() => ({
    theme: CODE_THEMES,
    themeType,
    overflow: wordWrap ? 'wrap' as const : 'scroll' as const,
    disableFileHeader: true,
    disableErrorHandling: true,
    lineHoverHighlight: 'number' as const,
    enableLineSelection: Boolean(onReference),
    onLineSelectionEnd: setSelection,
  }), [onReference, themeType, wordWrap])
  const style = React.useMemo(() => createReadOnlyDiffStyle(settings.appearance, resolveMonoFontStack(settings.appearance.monoFontFamily)), [settings.appearance])
  // A final newline ends the last line; it does not start a numbered empty one.
  const file = React.useMemo(() => ({ name: path, contents: content.replace(/\r?\n$/u, '') }), [content, path])
  const range = selection ? { start: Math.min(selection.start, selection.end), end: Math.max(selection.start, selection.end) } : null
  const reference = React.useMemo(() => {
    if (!range) return null
    const text = content.split('\n').slice(range.start - 1, range.end).join('\n')
    if (!text || text.length > MAX_REFERENCE_TEXT) return null
    // The composer chip adds the lines to the label itself.
    return { kind: 'file' as const, sourceId: path, label: path, path, revision: fingerprint, text, startLine: range.start, endLine: range.end }
  }, [content, fingerprint, path, range?.end, range?.start]) // eslint-disable-line react-hooks/exhaustive-deps
  return <div className="relative min-h-0 min-w-0 flex-1">
    <div className="scroll-slim h-full overflow-auto overscroll-contain" data-file-source>
      <CodeFile file={file} options={options} style={style} selectedLines={selection} disableWorkerPool />
    </div>
    {range && reference && onReference ? <div className="glass absolute right-3 bottom-3 flex items-center gap-1 rounded-full p-1 pl-3 text-caption" data-file-line-actions>
      <span className="mr-1 text-muted-foreground tabular-nums">{range.start === range.end ? t('inspector.preview.referenceLine', { line: range.start }) : t('inspector.preview.referenceLines', { start: range.start, end: range.end })}</span>
      <Button size="xs" variant="ghost" onClick={() => { onReference(reference, false); setSelection(null) }}><TbQuote aria-hidden />{t('precision.quoteSelection')}</Button>
      <Button size="xs" variant="ghost" onClick={() => { onReference(reference, true); setSelection(null) }}><TbMessages aria-hidden />{t('sideChat.ask')}</Button>
      <Button size="icon-xs" variant="ghost" aria-label={t('common.close')} onClick={() => setSelection(null)}><TbX aria-hidden /></Button>
    </div> : null}
  </div>
}

/** An image centered on a checkerboard, fit to the tab or at its own size; or a PDF in the viewer. */
function MediaView({ media, fit, onFitChange }: { media: WorkspaceFileMedia; fit: boolean; onFitChange(fit: boolean): void }) {
  const t = useT()
  const [url, setUrl] = React.useState<string | null>(null)
  const [size, setSize] = React.useState<{ width: number; height: number } | null>(null)
  const [failed, setFailed] = React.useState(false)
  React.useEffect(() => {
    const next = URL.createObjectURL(new Blob([media.data.slice()], { type: media.mime }))
    setUrl(next)
    setFailed(false)
    return () => URL.revokeObjectURL(next)
  }, [media])
  if (!url) return null
  if (media.mime === 'application/pdf') {
    return <iframe src={url} title={media.path} className="min-h-0 w-full flex-1 border-0 bg-surface" data-file-pdf />
  }
  if (failed) return <PreviewState role="alert"><TbFile className="size-5" aria-hidden />{t('inspector.preview.mediaFailed')}</PreviewState>
  return <div className="relative flex min-h-0 flex-1 flex-col" data-file-image>
    <div className={cn('scroll-slim flex min-h-0 flex-1 overflow-auto p-4 [background-color:var(--color-surface)] [background-image:linear-gradient(45deg,var(--color-fill)_25%,transparent_25%,transparent_75%,var(--color-fill)_75%),linear-gradient(45deg,var(--color-fill)_25%,transparent_25%,transparent_75%,var(--color-fill)_75%)] [background-position:0_0,8px_8px] [background-size:16px_16px]',
      fit ? 'items-center justify-center' : 'items-start justify-start')}>
      <img src={url} alt={media.path} draggable={false} onError={() => setFailed(true)}
        onLoad={(event) => setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
        className={cn('shrink-0 [image-rendering:auto]', fit ? 'max-h-full max-w-full object-contain' : 'max-w-none')} />
    </div>
    <footer className="flex h-8 shrink-0 items-center gap-2 border-t border-border px-3 text-micro text-muted-foreground">
      <span className="tabular-nums">{size ? t('inspector.preview.imageSize', { width: size.width, height: size.height }) : null}</span>
      <span className="tabular-nums">{formatWorkspaceFileSize(media.size)}</span>
      <span className="flex-1" />
      <div role="group" className="mac-segmented h-6 [&>button]:h-5 [&>button]:px-2 [&>button]:text-micro">
        <button type="button" aria-pressed={fit} onClick={() => onFitChange(true)}>{t('inspector.preview.fit')}</button>
        <button type="button" aria-pressed={!fit} onClick={() => onFitChange(false)}>{t('inspector.preview.actualSize')}</button>
      </div>
    </footer>
  </div>
}

function useMedia(path: string, readMedia: WorkspaceFileViewerProps['onReadMedia'], enabled: boolean, revision: string | undefined) {
  const [state, setState] = React.useState<{ status: 'idle' | 'loading' } | { status: 'ready'; media: WorkspaceFileMedia } | { status: 'error'; code: string }>({ status: 'idle' })
  React.useEffect(() => {
    if (!enabled || !readMedia) return
    let current = true
    setState((value) => value.status === 'ready' ? value : { status: 'loading' })
    readMedia(path).then((media) => { if (current) setState({ status: 'ready', media }) }, (error: unknown) => {
      if (current) setState({ status: 'error', code: (error as { code?: string } | null)?.code ?? 'UNKNOWN' })
    })
    return () => { current = false }
  }, [enabled, path, readMedia, revision])
  return state
}

/**
 * A file tab, as in Codex: one header row (path, preview/source for
 * Markdown, Open in, ⋯) over the file itself. Read-only; editing happens in
 * the editor it opens.
 */
export function WorkspaceFileViewer({ path, workspaceId, preview, loading, refreshing = false, errorMessage, onRetry, onRefresh, onShowChanges, onAddToComposer, onReveal, onReadMedia, modified = false, visible = true }: WorkspaceFileViewerProps) {
  const t = useT()
  const locale = useLocale()
  const settings = useSettings()
  const { update: updateSettings } = useUpdateSettings()
  const references = usePrecisionReferences()
  const classification = React.useMemo(() => classifyWorkspaceFile(path), [path])
  const mediaType = workspaceMediaType(path)
  const [markdownMode, setMarkdownMode] = React.useState<MarkdownMode>('preview')
  const [fit, setFit] = React.useState(true)
  const [copied, setCopied] = React.useState<'path' | 'contents' | null>(null)
  const textPreview = !loading && preview?.kind === 'text' ? preview : undefined
  const markdown = classification.kind === 'markdown' && textPreview ? textPreview : undefined
  // SVG is text: it previews as an image and switches to its source like Markdown.
  const svg = mediaType === 'image/svg+xml' && textPreview ? textPreview : undefined
  // Images and PDFs always show as themselves (a PDF can be plain ASCII); an SVG offers its source too.
  const showMedia = Boolean(mediaType && preview && (!svg || preview.kind !== 'text' || markdownMode === 'preview'))
  const media = useMedia(path, onReadMedia, Boolean(visible && showMedia), preview?.fingerprint)
  const wordWrap = settings.appearance.wordWrap
  React.useEffect(() => { setMarkdownMode('preview'); setCopied(null) }, [path])
  React.useEffect(() => { if (copied) { const timer = setTimeout(() => setCopied(null), 1_400); return () => clearTimeout(timer) } }, [copied])

  const copy = async (kind: 'path' | 'contents') => {
    try {
      await navigator.clipboard.writeText(kind === 'path' ? path : textPreview?.content ?? '')
      setCopied(kind)
    } catch { /* The clipboard may be unavailable; nothing to undo. */ }
  }
  const handedOff = React.useRef(false)
  const reference = React.useCallback((value: Omit<PrecisionReference, 'id' | 'ownerKey'>, side: boolean) => {
    if (!references) return
    const full: PrecisionReference = { ...value, id: crypto.randomUUID(), ownerKey: references.ownerKey }
    if (side) references.askSideQuestion?.(full)
    else references.insert([full])
  }, [references])

  const body = loading ? <PreviewState role="status"><TbLoader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /><span>{t('inspector.preview.loading')}</span></PreviewState>
    : errorMessage && !preview ? <PreviewState role="alert">
      <TbFile className="size-5" aria-hidden />
      <span className="text-destructive">{errorMessage}</span>
      {onRetry ? <Button variant="outline" size="xs" onClick={onRetry}><TbRefresh aria-hidden />{t('inspector.preview.retry')}</Button> : null}
    </PreviewState>
      : !preview ? <PreviewState role="status">{t('inspector.preview.loading')}</PreviewState>
        : showMedia ? (
          media.status === 'ready' ? <MediaView media={media.media} fit={fit} onFitChange={setFit} />
            : media.status === 'error' ? <PreviewState role="alert"><TbFile className="size-5" aria-hidden />
              {media.code === 'WORKSPACE_MEDIA_TOO_LARGE' ? t('inspector.preview.mediaTooLarge', { limit: formatWorkspaceFileSize(WORKSPACE_MEDIA_BYTE_LIMIT) }) : t('inspector.preview.mediaFailed')}</PreviewState>
              : <PreviewState role="status"><TbLoader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /></PreviewState>
        ) : preview.kind === 'binary' ? <PreviewState role="status"><TbFile className="size-5" aria-hidden />{t('inspector.preview.binary')}</PreviewState>
          : preview.kind === 'too-large' ? <PreviewState role="status"><TbFile className="size-5" aria-hidden />{t('inspector.preview.tooLarge', { limit: formatWorkspaceFileSize(preview.limit) })}</PreviewState>
            : markdown && markdownMode === 'preview' ? <div className="scroll-slim min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-5 py-4">
              <QuoteSelection source={{ kind: 'file', sourceId: path, label: path, path, revision: markdown.fingerprint }}><MarkdownContent markdown={markdown.content} /></QuoteSelection>
            </div>
              : <SourceCode path={path} content={preview.content} fingerprint={preview.fingerprint} wordWrap={wordWrap} onReference={references?.available ? reference : undefined} />

  return <section aria-label={path} aria-busy={loading || refreshing} className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface" data-workspace-file-viewer lang={locale}>
    <header className="flex h-9 shrink-0 items-center gap-2 border-b border-border pr-1.5 pl-3">
      <PathCrumbs path={path} />
      {refreshing ? <TbLoader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" aria-label={t('inspector.preview.loading')} /> : null}
      {markdown || svg ? <ModeSwitch mode={markdownMode} onChange={setMarkdownMode} /> : null}
      {workspaceId ? <OpenInEditorButton workspaceId={workspaceId} path={path} variant="icon" /> : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-xs" aria-label={t('inspector.preview.more')} title={t('inspector.preview.more')}><TbDots aria-hidden /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52" onCloseAutoFocus={(event) => {
          // Actions that move focus elsewhere (the review, the composer) keep it there.
          if (handedOff.current) event.preventDefault()
          handedOff.current = false
        }}>
          <DropdownMenuItem onSelect={() => void copy('path')}>{copied === 'path' ? <TbCheck aria-hidden /> : <TbCopy aria-hidden />}{t('inspector.preview.copyPath')}</DropdownMenuItem>
          {textPreview ? <DropdownMenuItem onSelect={() => void copy('contents')}>{copied === 'contents' ? <TbCheck aria-hidden /> : <TbCopy aria-hidden />}{t('inspector.preview.copyContents')}</DropdownMenuItem> : null}
          {onReveal ? <DropdownMenuItem onSelect={onReveal}><TbFolderOpen aria-hidden />{t(revealLabelKey())}</DropdownMenuItem> : null}
          {onAddToComposer || (onShowChanges && modified) ? <DropdownMenuSeparator /> : null}
          {onAddToComposer ? <DropdownMenuItem onSelect={() => { handedOff.current = true; onAddToComposer() }}><TbAt aria-hidden />{t('inspector.preview.reference')}</DropdownMenuItem> : null}
          {onShowChanges && modified ? <DropdownMenuItem onSelect={() => { handedOff.current = true; onShowChanges() }}><TbGitCompare aria-hidden />{t('inspector.files.showChanges')}</DropdownMenuItem> : null}
          <DropdownMenuSeparator />
          {textPreview ? <DropdownMenuCheckboxItem checked={wordWrap} onCheckedChange={(checked) => updateSettings({ appearance: { wordWrap: checked === true } })}>
            <TbTextWrap aria-hidden />{t('inspector.preview.wrap')}
          </DropdownMenuCheckboxItem> : null}
          {onRefresh ? <DropdownMenuItem disabled={loading || refreshing} onSelect={onRefresh}><TbRefresh aria-hidden />{t('common.refresh')}</DropdownMenuItem> : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
    {errorMessage && preview ? <div role="alert" className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5 text-caption text-destructive">
      <span className="min-w-0 flex-1">{errorMessage}</span>
      {onRetry ? <Button variant="ghost" size="xs" onClick={onRetry}>{t('inspector.preview.retry')}</Button> : null}
    </div> : null}
    {body}
  </section>
}
