import * as React from 'react'
import { TbAlertCircle, TbFileText, TbLoader2, TbRefresh } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import type { WorkspaceFileStatus } from '@/shared/workspace-content'
import type { ContinuousDiffFile } from './continuous-diff-controller'
import { InspectorSectionToolbar } from './InspectorSectionToolbar'
import { DiffFileNavigator } from './DiffFileNavigator'

export type DiffViewerFile = ContinuousDiffFile

interface DiffViewerProps {
  files: DiffViewerFile[]
  emptyMessage?: string
  listLoading?: boolean
  listTruncated?: boolean
  listErrorMessage?: string
  onRefresh?: () => void
  onRequestFile?: (paths: string | readonly string[]) => void
  onRetryFile?: (path: string) => void
  onOpenFile?: (path: string) => void
  visible?: boolean
  focusRequest?: { path: string; sequence: number } | null
}

const ReadOnlyPatchDiff = React.lazy(() =>
  import('./ReadOnlyPatchDiff').then((module) => ({
    default: module.ReadOnlyPatchDiff,
  })),
)

const ReadOnlyDiffVirtualizer = React.lazy(() =>
  import('./ReadOnlyPatchDiff').then((module) => ({
    default: module.ReadOnlyDiffVirtualizer,
  })),
)

interface DiffRenderErrorBoundaryProps {
  children: React.ReactNode
  fallback: React.ReactNode
  resetKey: string
}

class DiffRenderErrorBoundary extends React.Component<
  DiffRenderErrorBoundaryProps,
  { error: Error | null }
> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidUpdate(previousProps: Readonly<DiffRenderErrorBoundaryProps>) {
    if (previousProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null })
    }
  }

  render() {
    return this.state.error ? this.props.fallback : this.props.children
  }
}

const statusTone: Record<WorkspaceFileStatus, string> = {
  modified: 'text-warning',
  added: 'text-sage',
  deleted: 'text-destructive',
}

function hasRenderableHunk(patch: string) {
  return /^@@\s/mu.test(patch)
}

function DiffFileHeader({ file, onOpenFile }: { file: DiffViewerFile; onOpenFile?: (path: string) => void }) {
  const t = useT()
  return (
    <header className="sticky top-0 z-20 flex min-h-12 items-center gap-2 border-y border-border bg-sidebar px-2.5 py-1.5">
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-caption text-foreground" title={file.path}>
          {file.previousPath ? `${file.previousPath} → ${file.path}` : file.path}
        </p>
        <p className="mt-0.5 flex items-center gap-2 text-micro tabular-nums">
          <span className="text-muted-foreground">{t(file.stage === 'staged' ? 'inspector.diff.staged' : 'inspector.diff.unstaged')}</span>
          <span className={cn('font-medium', statusTone[file.status])}>
            {t(`inspector.files.${file.status}`)}
          </span>
          <span className="text-sage">+{file.added}</span>
          <span className="text-destructive">−{file.deleted}</span>
        </p>
      </div>
      {onOpenFile && file.status !== 'deleted' ? <Button variant="ghost" size="icon-xs" onClick={() => onOpenFile(file.path)} aria-label={t('inspector.diff.openFile')} title={t('inspector.diff.openFile')}><TbFileText aria-hidden /></Button> : null}
    </header>
  )
}

function DiffInlineState({
  children,
  loading = false,
  onRetry,
}: {
  children: React.ReactNode
  loading?: boolean
  onRetry?: () => void
}) {
  const t = useT()
  return (
    <div className="flex min-h-28 items-center justify-center gap-2 px-4 py-6 text-center text-caption text-muted-foreground">
      {loading ? (
        <TbLoader2 className="size-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
      ) : onRetry ? (
        <TbAlertCircle className="size-4 shrink-0" aria-hidden />
      ) : null}
      <span>{children}</span>
      {onRetry ? (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={t('inspector.diff.retry')}
          title={t('inspector.diff.retry')}
          onClick={onRetry}
        >
          <TbRefresh aria-hidden />
        </Button>
      ) : null}
    </div>
  )
}

function DiffFileSection({
  file,
  sectionRef,
  onRetry,
  onOpenFile,
}: {
  file: DiffViewerFile
  sectionRef: (node: HTMLElement | null) => void
  onRetry: (path: string) => void
  onOpenFile?: (path: string) => void
}) {
  const t = useT()
  const [renderAttempt, setRenderAttempt] = React.useState(0)
  const loading = file.phase === 'queued' || file.phase === 'loading'
  const patch = file.patch ?? ''
  const truncatedWithoutHunk = file.phase === 'ready' && file.truncated && !hasRenderableHunk(patch)
  const showPatch = file.phase === 'ready'
    && !file.binary
    && !truncatedWithoutHunk
    && Boolean(patch)

  let body: React.ReactNode
  if (file.binary) {
    body = <DiffInlineState>{t('inspector.diff.binary')}</DiffInlineState>
  } else if (file.phase === 'idle') {
    body = <DiffInlineState>{t('inspector.diff.waiting')}</DiffInlineState>
  } else if (loading) {
    body = <DiffInlineState loading>{t('inspector.diff.loadingFile')}</DiffInlineState>
  } else if (file.phase === 'error') {
    body = (
      <DiffInlineState onRetry={() => onRetry(file.id)}>
        {t('inspector.diff.readError')}
      </DiffInlineState>
    )
  } else if (truncatedWithoutHunk) {
    body = <DiffInlineState>{t('inspector.diff.oversized')}</DiffInlineState>
  } else if (!patch) {
    body = <DiffInlineState>{t('inspector.diff.emptyFile')}</DiffInlineState>
  } else if (showPatch) {
    body = (
      <DiffRenderErrorBoundary
        resetKey={`${file.path}:${patch}:${renderAttempt}`}
        fallback={(
          <DiffInlineState onRetry={() => setRenderAttempt((attempt) => attempt + 1)}>
            {t('inspector.diff.renderError')}
          </DiffInlineState>
        )}
      >
        <React.Suspense
          fallback={<DiffInlineState loading>{t('inspector.diff.loadingRenderer')}</DiffInlineState>}
        >
          <ReadOnlyPatchDiff patch={patch} />
        </React.Suspense>
      </DiffRenderErrorBoundary>
    )
  }

  return (
    <section
      ref={sectionRef}
      data-diff-path={file.path}
      data-diff-id={file.id}
      aria-label={file.path}
      aria-busy={loading || undefined}
      className="min-w-0"
    >
      <DiffFileHeader file={file} onOpenFile={onOpenFile} />
      {body}
      {file.errorCode && file.patch !== undefined ? <div role="alert" className="flex items-center gap-2 border-t border-border px-3 py-2 text-caption text-destructive"><span className="flex-1">{t('inspector.diff.readError')}</span><Button variant="ghost" size="xs" onClick={() => onRetry(file.id)}>{t('common.retry')}</Button></div> : null}
      {file.phase === 'ready' && file.truncated && showPatch ? (
        <p className="border-t border-border px-3 py-2 text-micro text-muted-foreground">
          {t('inspector.diff.truncated')}
        </p>
      ) : null}
    </section>
  )
}

function ListTruncatedNotice() {
  const t = useT()
  return (
    <p className="border-t border-border px-3 py-2 text-micro text-muted-foreground">
      {t('inspector.diff.listTruncated')}
    </p>
  )
}

function DiffSummarySurface({
  files,
  listTruncated,
  message,
  registerScrollRoot,
  registerSection,
}: {
  files: DiffViewerFile[]
  listTruncated: boolean
  message: string
  registerScrollRoot: (node: HTMLElement | null) => void
  registerSection: (path: string, node: HTMLElement | null) => void
}) {
  const t = useT()
  return (
    <div ref={registerScrollRoot} className="scroll-slim min-h-0 flex-1 overflow-auto pb-2">
      {files.map((file) => (
        <section
          key={file.id}
          ref={(node) => registerSection(file.id, node)}
          data-diff-path={file.path}
          data-diff-id={file.id}
          aria-label={file.path}
          className="min-w-0"
        >
          <DiffFileHeader file={file} />
          <DiffInlineState>
            {file.binary ? t('inspector.diff.binary') : message}
          </DiffInlineState>
        </section>
      ))}
      {listTruncated ? <ListTruncatedNotice /> : null}
    </div>
  )
}

const NOOP_REQUEST = () => undefined

export function DiffViewer({
  files,
  emptyMessage,
  listLoading = false,
  listTruncated = false,
  listErrorMessage,
  onRefresh,
  onRequestFile,
  onRetryFile,
  onOpenFile,
  visible = true,
  focusRequest,
}: DiffViewerProps) {
  const t = useT()
  const [scrollRoot, setScrollRoot] = React.useState<HTMLElement | null>(null)
  const observerRef = React.useRef<IntersectionObserver | null>(null)
  const sectionNodes = React.useRef(new Map<string, HTMLElement>())
  const readingAnchor = React.useRef<{ id: string; offset: number } | null>(null)
  const handledFocus = React.useRef<number | null>(null)
  const requestFile = onRequestFile ?? NOOP_REQUEST
  const retryFile = onRetryFile ?? NOOP_REQUEST
  const orderedFiles = React.useMemo(() => [...files].sort((a, b) => Number(a.stage === 'unstaged') - Number(b.stage === 'unstaged')), [files])
  const resetKey = orderedFiles.map((file) => file.id).join('\u0000')

  const registerSection = React.useCallback((path: string, node: HTMLElement | null) => {
    const previous = sectionNodes.current.get(path)
    if (previous === node) return
    if (previous) observerRef.current?.unobserve(previous)
    if (!node) {
      sectionNodes.current.delete(path)
      return
    }
    sectionNodes.current.set(path, node)
    observerRef.current?.observe(node)
  }, [])

  React.useLayoutEffect(() => {
    if (!scrollRoot || !visible) return
    const capture = () => {
      const top = scrollRoot.getBoundingClientRect().top
      for (const file of orderedFiles) {
        const section = sectionNodes.current.get(file.id)
        if (!section || section.getBoundingClientRect().bottom <= top) continue
        readingAnchor.current = { id: file.id, offset: section.getBoundingClientRect().top - top }
        break
      }
    }
    scrollRoot.addEventListener('scroll', capture, { passive: true })
    return () => scrollRoot.removeEventListener('scroll', capture)
  }, [orderedFiles, scrollRoot, visible])

  React.useLayoutEffect(() => {
    if (!scrollRoot || !visible) return
    if (focusRequest && handledFocus.current !== focusRequest.sequence) {
      const target = files.find((file) => file.path === focusRequest.path && file.stage === 'unstaged') ?? files.find((file) => file.path === focusRequest.path)
      const section = target ? sectionNodes.current.get(target.id) : undefined
      if (!section) return
      handledFocus.current = focusRequest.sequence
      readingAnchor.current = null
      requestFile(target!.id)
      scrollRoot.scrollTop += section.getBoundingClientRect().top - scrollRoot.getBoundingClientRect().top
      section.setAttribute('tabindex', '-1')
      section.focus({ preventScroll: true })
      return
    }
    const anchor = readingAnchor.current
    const section = anchor ? sectionNodes.current.get(anchor.id) : undefined
    if (section && anchor) scrollRoot.scrollTop += section.getBoundingClientRect().top - scrollRoot.getBoundingClientRect().top - anchor.offset
  }, [files, focusRequest, requestFile, scrollRoot, visible])

  React.useEffect(() => {
    observerRef.current?.disconnect()
    observerRef.current = null
    if (!scrollRoot || !visible) return

    if (typeof IntersectionObserver === 'undefined') {
      requestFile(files.slice(0, 3).map((file) => file.id))
      return
    }

    const observer = new IntersectionObserver((entries) => {
      const paths = entries.flatMap((entry) => {
        if (!entry.isIntersecting) return []
        const path = (entry.target as HTMLElement).dataset.diffId
        return path ? [path] : []
      })
      if (paths.length > 0) requestFile(paths)
    }, {
      root: scrollRoot,
      rootMargin: '720px 0px',
      threshold: 0.01,
    })
    observerRef.current = observer
    for (const node of sectionNodes.current.values()) observer.observe(node)
    return () => {
      observer.disconnect()
      if (observerRef.current === observer) observerRef.current = null
    }
  }, [requestFile, resetKey, scrollRoot, visible])

  const empty = emptyMessage ?? t('inspector.diff.clean')

  return (
    <div className="flex h-full min-h-0 flex-col">
      <InspectorSectionToolbar title={t('inspector.diff.projectChanges')} description={t('inspector.diff.summary', { count: new Set(files.map((file) => file.path)).size })}>
        <DiffFileNavigator files={orderedFiles} onSelect={(path) => {
          readingAnchor.current = null
          requestFile(path)
          const section = sectionNodes.current.get(path)
          section?.scrollIntoView({ block: 'start', behavior: 'instant' })
          section?.setAttribute('tabindex', '-1')
          section?.focus({ preventScroll: true })
        }} />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('inspector.diff.refresh')}
          title={t('inspector.diff.refresh')}
          disabled={listLoading || !onRefresh}
          onClick={onRefresh}
        >
          {listLoading ? <TbLoader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : <TbRefresh aria-hidden />}
        </Button>
      </InspectorSectionToolbar>
      {focusRequest && !listLoading && !files.some((file) => file.path === focusRequest.path) ? <p role="status" className="shrink-0 border-b border-border px-3 py-2 text-caption text-muted-foreground">{focusRequest.path} · {t('inspector.diff.noFileChanges')}</p> : null}
      {listErrorMessage && files.length > 0 ? <div role="alert" className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 text-caption text-destructive">
        <span className="min-w-0 flex-1">{listErrorMessage}</span>
        {onRefresh ? <Button variant="ghost" size="xs" onClick={onRefresh} disabled={listLoading}>{t('common.retry')}</Button> : null}
      </div> : null}

      {files.length === 0 ? (
        <div className="grid min-h-0 flex-1 place-items-center p-4 text-center text-caption text-muted-foreground">
          {listLoading ? (
            <span className="flex items-center gap-2" role="status">
              <TbLoader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
              {t('inspector.diff.loading')}
            </span>
          ) : listErrorMessage ? <div role="alert" className="flex flex-col items-center gap-2">
            <p className="text-destructive">{listErrorMessage}</p>
            {onRefresh ? <Button variant="outline" size="xs" onClick={onRefresh}><TbRefresh aria-hidden />{t('common.retry')}</Button> : null}
          </div> : <span role="status">{empty}</span>}
        </div>
      ) : (
        <DiffRenderErrorBoundary
          resetKey={resetKey}
          fallback={(
            <DiffSummarySurface
              files={orderedFiles}
              listTruncated={listTruncated}
              message={t('inspector.diff.rendererUnavailable')}
              registerScrollRoot={setScrollRoot}
              registerSection={registerSection}
            />
          )}
        >
          <React.Suspense
            fallback={(
              <DiffSummarySurface
                files={orderedFiles}
                listTruncated={listTruncated}
                message={t('inspector.diff.loadingRenderer')}
                registerScrollRoot={setScrollRoot}
                registerSection={registerSection}
              />
            )}
          >
            <ReadOnlyDiffVirtualizer onScrollRoot={setScrollRoot}>
              {orderedFiles.map((file) => (
                <DiffFileSection
                  key={file.id}
                  file={file}
                  sectionRef={(node) => registerSection(file.id, node)}
                  onRetry={retryFile}
                  onOpenFile={onOpenFile}
                />
              ))}
              {listTruncated ? <ListTruncatedNotice /> : null}
            </ReadOnlyDiffVirtualizer>
          </React.Suspense>
        </DiffRenderErrorBoundary>
      )}
    </div>
  )
}
