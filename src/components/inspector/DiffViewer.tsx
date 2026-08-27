import * as React from 'react'
import { TbAlertCircle, TbLoader2, TbRefresh } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import type { WorkspaceFileStatus } from '@/shared/workspace-content'
import type { ContinuousDiffFile } from './continuous-diff-controller'

export type DiffViewerFile = ContinuousDiffFile

interface DiffViewerProps {
  files: DiffViewerFile[]
  emptyMessage?: string
  listLoading?: boolean
  listTruncated?: boolean
  onRefresh?: () => void
  onRequestFile?: (paths: string | readonly string[]) => void
  onRetryFile?: (path: string) => void
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

function DiffFileHeader({ file }: { file: DiffViewerFile }) {
  const t = useT()
  return (
    <header className="sticky top-0 z-20 flex min-h-12 items-center gap-2 border-y border-border bg-sidebar px-2.5 py-1.5">
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-caption text-foreground" title={file.path}>
          {file.previousPath ? `${file.previousPath} → ${file.path}` : file.path}
        </p>
        <p className="mt-0.5 flex items-center gap-2 text-micro tabular-nums">
          <span className={cn('font-medium', statusTone[file.status])}>
            {t(`inspector.files.${file.status}`)}
          </span>
          <span className="text-sage">+{file.added}</span>
          <span className="text-destructive">−{file.deleted}</span>
        </p>
      </div>
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
        <TbLoader2 className="size-4 shrink-0 animate-spin" aria-hidden />
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
}: {
  file: DiffViewerFile
  sectionRef: (node: HTMLElement | null) => void
  onRetry: (path: string) => void
}) {
  const t = useT()
  const [renderAttempt, setRenderAttempt] = React.useState(0)
  const loading = file.phase === 'queued' || file.phase === 'loading'
  const patch = file.phase === 'ready' ? file.patch : ''
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
      <DiffInlineState onRetry={() => onRetry(file.path)}>
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
      aria-label={file.path}
      aria-busy={loading || undefined}
      className="min-w-0"
    >
      <DiffFileHeader file={file} />
      {body}
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
          key={file.path}
          ref={(node) => registerSection(file.path, node)}
          data-diff-path={file.path}
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
  onRefresh,
  onRequestFile,
  onRetryFile,
}: DiffViewerProps) {
  const t = useT()
  const [scrollRoot, setScrollRoot] = React.useState<HTMLElement | null>(null)
  const observerRef = React.useRef<IntersectionObserver | null>(null)
  const sectionNodes = React.useRef(new Map<string, HTMLElement>())
  const requestFile = onRequestFile ?? NOOP_REQUEST
  const retryFile = onRetryFile ?? NOOP_REQUEST
  const resetKey = files.map((file) => file.path).join('\u0000')

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

  React.useEffect(() => {
    observerRef.current?.disconnect()
    observerRef.current = null
    if (!scrollRoot) return

    if (typeof IntersectionObserver === 'undefined') {
      requestFile(files.slice(0, 3).map((file) => file.path))
      return
    }

    const observer = new IntersectionObserver((entries) => {
      const paths = entries.flatMap((entry) => {
        if (!entry.isIntersecting) return []
        const path = (entry.target as HTMLElement).dataset.diffPath
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
  }, [requestFile, resetKey, scrollRoot])

  const empty = emptyMessage ?? t('inspector.diff.clean')

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-12 items-center gap-2 border-b border-border px-2.5 py-1.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-caption font-medium text-foreground">
            {t('inspector.diff.uncommitted')}
          </p>
          <p className="mt-0.5 text-micro text-muted-foreground">
            {t('inspector.diff.summary', { count: files.length })}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('inspector.diff.refresh')}
          title={t('inspector.diff.refresh')}
          disabled={listLoading}
          onClick={onRefresh}
        >
          {listLoading ? <TbLoader2 className="animate-spin" aria-hidden /> : <TbRefresh aria-hidden />}
        </Button>
      </div>

      {files.length === 0 ? (
        <div className="grid min-h-0 flex-1 place-items-center p-4 text-center text-caption text-muted-foreground">
          {listLoading ? (
            <span className="flex items-center gap-2">
              <TbLoader2 className="size-4 animate-spin" aria-hidden />
              {t('inspector.diff.loading')}
            </span>
          ) : empty}
        </div>
      ) : (
        <DiffRenderErrorBoundary
          resetKey={resetKey}
          fallback={(
            <DiffSummarySurface
              files={files}
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
                files={files}
                listTruncated={listTruncated}
                message={t('inspector.diff.loadingRenderer')}
                registerScrollRoot={setScrollRoot}
                registerSection={registerSection}
              />
            )}
          >
            <ReadOnlyDiffVirtualizer onScrollRoot={setScrollRoot}>
              {files.map((file) => (
                <DiffFileSection
                  key={file.path}
                  file={file}
                  sectionRef={(node) => registerSection(file.path, node)}
                  onRetry={retryFile}
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
