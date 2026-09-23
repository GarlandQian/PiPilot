import * as React from 'react'
import {
  TbArrowLeft,
  TbAt,
  TbCheck,
  TbCopy,
  TbFile,
  TbGitCompare,
  TbLoader2,
  TbRefresh,
  TbX,
} from 'react-icons/tb'
import { MarkdownContent, MarkdownSource } from '@/components/chat/markdown/MarkdownContent'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useT } from '@/i18n'
import type { WorkspaceFilePreview } from '@/shared/workspace-content'
import {
  classifyWorkspaceFile,
  displayWorkspacePath,
  formatWorkspaceFileSize,
  type WorkspaceFileClassification,
} from './workspace-file-kind'

type MarkdownMode = 'preview' | 'source'

export interface WorkspaceFileViewerProps {
  path: string
  workspaceName?: string
  fileNavigation?: React.ReactNode
  preview?: WorkspaceFilePreview
  loading: boolean
  refreshing?: boolean
  errorMessage?: string
  onBack: () => void
  onClose: () => void
  onRetry?: () => void
  onRefresh?: () => void
  onShowChanges?: () => void
  onAddToComposer?: () => void
}

function typeLabel(
  classification: WorkspaceFileClassification,
  preview: WorkspaceFilePreview | undefined,
  t: ReturnType<typeof useT>,
) {
  if (preview?.kind === 'binary') return t('inspector.preview.type.binary')
  if (preview?.kind === 'too-large') return t('inspector.preview.type.tooLarge')
  if (classification.kind === 'markdown') return t('inspector.preview.type.markdown')
  if (classification.kind === 'source') return t('inspector.preview.type.source')
  return t('inspector.preview.type.plainText')
}

function PreviewState({
  children,
  role,
}: {
  children: React.ReactNode
  role?: 'alert' | 'status'
}) {
  return (
    <div
      role={role}
      className="flex h-full min-h-32 items-center justify-center px-4 py-8 text-center text-caption text-muted-foreground"
    >
      <div className="flex max-w-full flex-col items-center gap-2">{children}</div>
    </div>
  )
}

function SourceDocument({
  classification,
  content,
}: {
  classification: WorkspaceFileClassification
  content: string
}) {
  return (
    <div className="min-w-0 px-2 py-1">
      <MarkdownSource code={content} language={classification.language} />
    </div>
  )
}

export function WorkspaceFileViewer({
  path,
  workspaceName,
  fileNavigation,
  preview,
  loading,
  refreshing = false,
  errorMessage,
  onBack,
  onClose,
  onRetry,
  onRefresh,
  onShowChanges,
  onAddToComposer,
}: WorkspaceFileViewerProps) {
  const t = useT()
  const classification = React.useMemo(() => classifyWorkspaceFile(path), [path])
  const [markdownMode, setMarkdownMode] = React.useState<MarkdownMode>('preview')
  const [copyState, setCopyState] = React.useState<'idle' | 'copied' | 'failed'>('idle')
  const copyReset = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const boundedPath = displayWorkspacePath(path)
  const textPreview = !loading && preview?.kind === 'text'
    ? preview
    : undefined
  const markdown = classification.kind === 'markdown' && textPreview
  const fileType = typeLabel(classification, preview, t)

  React.useEffect(() => {
    setMarkdownMode('preview')
    setCopyState('idle')
  }, [path])

  React.useEffect(() => () => {
    if (copyReset.current) clearTimeout(copyReset.current)
  }, [])

  const copy = React.useCallback(async () => {
    if (!textPreview) return
    try {
      await navigator.clipboard.writeText(textPreview.content)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
    if (copyReset.current) clearTimeout(copyReset.current)
    copyReset.current = setTimeout(() => setCopyState('idle'), 1_400)
  }, [textPreview])

  const copyLabel = copyState === 'copied'
    ? t('md.copied')
    : copyState === 'failed'
      ? t('md.copyFailed')
      : t('md.copy')

  const body = loading ? (
    <PreviewState role="status">
      <TbLoader2 className="size-4 animate-spin" aria-hidden />
      <span>{t('inspector.preview.loading')}</span>
    </PreviewState>
  ) : errorMessage && !preview ? (
    <PreviewState role="alert">
      <TbFile className="size-5" aria-hidden />
      <span className="text-destructive">{errorMessage}</span>
      {onRetry ? (
        <Button variant="outline" size="xs" onClick={onRetry}>
          <TbRefresh aria-hidden />
          {t('inspector.preview.retry')}
        </Button>
      ) : null}
    </PreviewState>
  ) : !preview ? (
    <PreviewState role="status">{t('inspector.preview.loading')}</PreviewState>
  ) : preview.kind === 'binary' ? (
    <PreviewState role="status">
      <TbFile className="size-5" aria-hidden />
      {t('inspector.preview.binary')}
    </PreviewState>
  ) : preview.kind === 'too-large' ? (
    <PreviewState role="status">
      <TbFile className="size-5" aria-hidden />
      {t('inspector.preview.tooLarge', { limit: formatWorkspaceFileSize(preview.limit) })}
    </PreviewState>
  ) : (
    <SourceDocument classification={classification} content={preview.content} />
  )

  return (
    <section
      aria-label={path}
      aria-busy={loading || refreshing}
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
      data-workspace-file-viewer
    >
      <header className="flex min-h-12 shrink-0 items-center gap-1 border-b border-border px-1.5 py-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-xs" aria-label={t('common.back')} onClick={onBack}>
              <TbArrowLeft aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('common.back')}</TooltipContent>
        </Tooltip>

        <div className="min-w-0 flex-1 px-0.5">
          {fileNavigation ?? <h2 className="truncate font-mono text-caption font-medium text-foreground" title={path}>
            {boundedPath}
          </h2>}
          <p className="truncate text-micro text-muted-foreground">
            {workspaceName ? `${workspaceName} · ` : null}
            {t('inspector.preview.metadata', {
              type: fileType,
              size: preview ? formatWorkspaceFileSize(preview.size) : t('inspector.preview.unknownSize'),
            })}
          </p>
        </div>

        {onShowChanges ? <Button variant="ghost" size="icon-xs" onClick={onShowChanges} aria-label={t('inspector.files.showChanges')} title={t('inspector.files.showChanges')}><TbGitCompare aria-hidden /></Button> : null}
        {onAddToComposer ? <Button variant="ghost" size="icon-xs" onClick={onAddToComposer} aria-label={t('inspector.files.addToComposer')} title={t('inspector.files.addToComposer')}><TbAt aria-hidden /></Button> : null}

        {textPreview ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={copyLabel}
                onClick={() => void copy()}
              >
                {copyState === 'copied'
                  ? <TbCheck className="text-sage" aria-hidden />
                  : <TbCopy aria-hidden />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{copyLabel}</TooltipContent>
          </Tooltip>
        ) : null}

        {onRefresh && preview ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={t('common.refresh')}
                disabled={loading || refreshing}
                onClick={onRefresh}
              >
                {refreshing
                  ? <TbLoader2 className="animate-spin motion-reduce:animate-none" aria-hidden />
                  : <TbRefresh aria-hidden />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('common.refresh')}</TooltipContent>
          </Tooltip>
        ) : null}

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-xs" aria-label={t('common.close')} onClick={onClose}>
              <TbX aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('common.close')}</TooltipContent>
        </Tooltip>
      </header>

      {refreshing ? <span role="status" className="sr-only">{t('inspector.preview.loading')}</span> : null}
      {errorMessage && preview ? (
        <div role="alert" className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 text-caption text-destructive">
          <span className="min-w-0 flex-1">{errorMessage}</span>
          {onRetry ? <Button variant="outline" size="xs" onClick={onRetry}>{t('inspector.preview.retry')}</Button> : null}
        </div>
      ) : null}

      {markdown ? (
        <Tabs
          value={markdownMode}
          onValueChange={(value) => setMarkdownMode(value as MarkdownMode)}
          className="flex min-h-0 min-w-0 flex-1 flex-col gap-0"
        >
          <div className="flex h-8 shrink-0 items-center border-b border-border/60 px-2">
            <TabsList className="h-6 rounded-md p-0.5">
              <TabsTrigger value="preview" className="h-5 px-2 text-micro">
                {t('inspector.preview.mode.preview')}
              </TabsTrigger>
              <TabsTrigger value="source" className="h-5 px-2 text-micro">
                {t('inspector.preview.mode.source')}
              </TabsTrigger>
            </TabsList>
          </div>
          <TabsContent
            value="preview"
            className="scroll-slim min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-3 data-[state=inactive]:hidden"
          >
            <MarkdownContent markdown={markdown.content} />
          </TabsContent>
          <TabsContent
            value="source"
            className="scroll-slim min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden data-[state=inactive]:hidden"
          >
            <SourceDocument classification={classification} content={markdown.content} />
          </TabsContent>
        </Tabs>
      ) : (
        <div className="scroll-slim min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
          {body}
        </div>
      )}
    </section>
  )
}
