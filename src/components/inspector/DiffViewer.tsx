import * as React from 'react'
import type { FileDiffLoadedFiles } from '@pierre/diffs'
import { DiffReviewProvider, DiffReviewSummary } from '@/components/precision/DiffReview'
import { TbAlertCircle, TbArrowBackUp, TbCheck, TbChevronDown, TbChevronRight, TbDots, TbFileText, TbFold, TbGitCommit, TbLoader2, TbMinus, TbPlus, TbRefresh, TbTextWrap, TbArrowsVertical } from 'react-icons/tb'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem,
  DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useT } from '@/i18n'
import { RelativeTime } from '@/components/layout/SessionList'
import { cn } from '@/lib/utils'
import type { WorkspaceCommitSummary, WorkspaceFileStatus } from '@/shared/workspace-content'
import type { ContinuousDiffFile } from './continuous-diff-controller'
import { DiffFileNavigator } from './DiffFileNavigator'
import { MaterialFileIcon } from './MaterialFileIcon'
import { diffScopeCounts, filterDiffScope, type DiffScope } from './diff-scope'

export type DiffViewerFile = ContinuousDiffFile
export type DiffChangeAction = 'stage' | 'unstage' | 'discard'

/** One list the review can show: the working tree, the branch, or a commit. */
export interface ReviewFileList {
  files: DiffViewerFile[]
  listLoading: boolean
  listTruncated: boolean
  listErrorMessage?: string
  onRequestFile: (paths: string | readonly string[]) => void
  onRetryFile: (path: string) => void
}

interface DiffViewerProps {
  working: ReviewFileList & { gitAvailable: boolean }
  branch?: ReviewFileList & { base: string }
  commit?: ReviewFileList & {
    commits: readonly WorkspaceCommitSummary[]
    commitsLoading: boolean
    selected: string | null
    onSelect(sha: string): void
  }
  scope: DiffScope
  onScopeChange: (scope: DiffScope) => void
  onRefresh?: () => void
  onOpenFile?: (path: string) => void
  visible?: boolean
  focusRequest?: { path: string; sequence: number } | null
  /** Files the agent wrote or edited since the latest user message (the "Last turn" scope). */
  lastTurnPaths?: readonly string[]
  /** Stage, unstage or discard; resolves when the list has been refreshed. */
  onChangeAction?: (action: DiffChangeAction, files: readonly DiffViewerFile[]) => Promise<void>
  /** The same for one hunk of one file. */
  onHunkAction?: (action: DiffChangeAction, file: DiffViewerFile, hunk: number) => Promise<void>
  describeError?: (error: unknown) => string
  /** Both sides of a file, so unchanged lines between hunks can expand. */
  loadSides?: (file: DiffViewerFile) => Promise<FileDiffLoadedFiles>
}

const VIEW_KEY = 'pipilot.review.view.v1'
/** Below this width a split diff is unreadable; the review stays unified. */
const SPLIT_MIN_WIDTH = 760

function readView(): { split: boolean; wrap: boolean | null } {
  try {
    const value = JSON.parse(localStorage.getItem(VIEW_KEY) ?? 'null') as { split?: unknown; wrap?: unknown } | null
    return { split: value?.split === true, wrap: typeof value?.wrap === 'boolean' ? value.wrap : null }
  } catch {
    return { split: false, wrap: null }
  }
}

/** macOS calls it the Trash; Windows the Recycle Bin. */
function trashKey() {
  const agent = typeof navigator === 'undefined' ? '' : navigator.userAgent
  return /Mac/iu.test(agent) ? 'inspector.diff.trash.mac' : /Windows/iu.test(agent) ? 'inspector.diff.trash.windows' : 'inspector.diff.trash.other'
}

function IconAction({ label, disabled, onClick, children, className }: { label: string; disabled?: boolean; onClick(): void; children: React.ReactNode; className?: string }) {
  return <Tooltip>
    <TooltipTrigger asChild>
      <Button variant="ghost" size="icon-xs" aria-label={label} disabled={disabled} className={className} onClick={(event) => { event.stopPropagation(); onClick() }}>{children}</Button>
    </TooltipTrigger>
    <TooltipContent side="bottom">{label}</TooltipContent>
  </Tooltip>
}

const ReadOnlyPatchDiff = React.lazy(() => import('./ReadOnlyPatchDiff').then((module) => ({ default: module.ReadOnlyPatchDiff })))
const ReadOnlyDiffVirtualizer = React.lazy(() => import('./ReadOnlyPatchDiff').then((module) => ({ default: module.ReadOnlyDiffVirtualizer })))

class DiffRenderErrorBoundary extends React.Component<{ children: React.ReactNode; fallback: React.ReactNode; resetKey: string }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidUpdate(previous: Readonly<{ resetKey: string }>) {
    if (previous.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null })
  }
  render() { return this.state.error ? this.props.fallback : this.props.children }
}

/** Git's own letters, colored like Codex: Modified, Added, Deleted, Renamed. */
const STATUS_BADGE: Record<WorkspaceFileStatus | 'renamed', { letter: string; className: string }> = {
  modified: { letter: 'M', className: 'bg-warning/15 text-warning' },
  added: { letter: 'A', className: 'bg-success/15 text-success' },
  deleted: { letter: 'D', className: 'bg-destructive/12 text-destructive' },
  renamed: { letter: 'R', className: 'bg-primary/12 text-primary' },
}

function hasRenderableHunk(patch: string) {
  return /^@@\s/mu.test(patch)
}

function splitPath(path: string) {
  const slash = path.lastIndexOf('/')
  return slash < 0 ? { directory: '', name: path } : { directory: path.slice(0, slash + 1), name: path.slice(slash + 1) }
}

function DiffInlineState({ children, loading = false, onRetry }: { children: React.ReactNode; loading?: boolean; onRetry?: () => void }) {
  const t = useT()
  return <div className="flex min-h-20 items-center justify-center gap-2 px-4 py-5 text-center text-caption text-muted-foreground">
    {loading ? <TbLoader2 className="size-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden /> : onRetry ? <TbAlertCircle className="size-4 shrink-0" aria-hidden /> : null}
    <span>{children}</span>
    {onRetry ? <Button variant="ghost" size="icon-xs" aria-label={t('inspector.diff.retry')} title={t('inspector.diff.retry')} onClick={onRetry}><TbRefresh aria-hidden /></Button> : null}
  </div>
}

/**
 * A file's sticky header: chevron, icon, folder (muted) and name, Git's
 * status letter and line counts. Clicking the row folds the file; the name
 * opens it in a file tab; stage and revert appear on hover.
 */
function DiffFileHeader({ file, collapsed, onToggle, onOpenFile, onAction, busy, showStage }: {
  file: DiffViewerFile
  collapsed: boolean
  onToggle?: () => void
  onOpenFile?: (path: string) => void
  onAction?: (action: DiffChangeAction, files: readonly DiffViewerFile[]) => void
  busy?: boolean
  showStage?: boolean
}) {
  const t = useT()
  const { directory, name } = splitPath(file.path)
  const badge = STATUS_BADGE[file.previousPath ? 'renamed' : file.status]
  const canOpen = onOpenFile && file.status !== 'deleted'
  return <header onClick={onToggle} data-diff-file-header
    className={cn('sticky top-0 z-20 flex h-8 min-w-0 items-center gap-1.5 border-b border-border/70 bg-surface/92 pr-1.5 pl-1.5 backdrop-blur-md', onToggle && 'cursor-default select-none')}>
    {onToggle ? <button type="button" aria-expanded={!collapsed} aria-label={t(collapsed ? 'inspector.diff.expandFile' : 'inspector.diff.collapseFile', { path: file.path })}
      onClick={(event) => { event.stopPropagation(); onToggle() }}
      className="flex size-5 shrink-0 items-center justify-center rounded-[5px] text-muted-foreground outline-none hover:bg-fill hover:text-foreground focus-visible:focus-ring">
      <TbChevronRight className={cn('size-3.5 stroke-[2.4] transition-transform motion-reduce:transition-none', !collapsed && 'rotate-90')} aria-hidden />
    </button> : null}
    <MaterialFileIcon name={name} path={file.path} type="file" className="size-4 shrink-0" />
    <button type="button" disabled={!canOpen} aria-label={file.path} title={canOpen ? `${file.path} · ${t('inspector.diff.openFile')}` : file.path}
      onClick={(event) => { event.stopPropagation(); if (canOpen) onOpenFile(file.path) }}
      className="flex min-w-0 items-baseline truncate rounded-[4px] text-left text-caption outline-none focus-visible:focus-ring enabled:hover:underline enabled:hover:decoration-border-strong disabled:cursor-default">
      {directory ? <span className="truncate text-muted-foreground">{directory}</span> : null}
      <span className="shrink-0 font-medium text-foreground">{name}</span>
    </button>
    {file.previousPath ? <span className="min-w-0 truncate text-micro text-muted-foreground" title={file.previousPath}>← {file.previousPath}</span> : null}
    <span title={t(file.previousPath ? 'inspector.files.renamed' : `inspector.files.${file.status}`)}
      className={cn('shrink-0 rounded-[4px] px-1 font-mono text-[10px] leading-4 font-semibold', badge.className)}>{badge.letter}</span>
    {showStage && file.stage === 'staged' ? <span className="shrink-0 rounded-[4px] bg-fill px-1 text-micro leading-4 text-muted-foreground">{t('inspector.diff.staged')}</span> : null}
    <span className="shrink-0 font-mono text-micro tabular-nums">
      {file.binary ? null : <><span className="text-success">+{file.added}</span> <span className="text-destructive">−{file.deleted}</span></>}
    </span>
    <span className="min-w-2 flex-1" />
    {/* Codex review: stage or revert what is unstaged, unstage what is staged. */}
    <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover/diff:opacity-100 group-focus-within/diff:opacity-100 motion-reduce:transition-none">
      {onAction && file.stage === 'unstaged' ? <>
        <IconAction label={t('inspector.diff.discardFile')} disabled={busy} onClick={() => onAction('discard', [file])}><TbArrowBackUp aria-hidden /></IconAction>
        <IconAction label={t('inspector.diff.stageFile')} disabled={busy} onClick={() => onAction('stage', [file])}><TbPlus aria-hidden /></IconAction>
      </> : null}
      {onAction && file.stage === 'staged' ? <IconAction label={t('inspector.diff.unstageFile')} disabled={busy} onClick={() => onAction('unstage', [file])}><TbMinus aria-hidden /></IconAction> : null}
      {canOpen ? <IconAction label={t('inspector.diff.openFile')} onClick={() => onOpenFile(file.path)}><TbFileText aria-hidden /></IconAction> : null}
    </div>
  </header>
}

function DiffFileSection({ file, sectionRef, collapsed, onToggle, onRetry, onOpenFile, onAction, onHunkAction, busy, split, wrap, loadSides, showStage }: {
  file: DiffViewerFile
  sectionRef: (node: HTMLElement | null) => void
  collapsed: boolean
  onToggle: () => void
  onRetry: (path: string) => void
  onOpenFile?: (path: string) => void
  onAction?: (action: DiffChangeAction, files: readonly DiffViewerFile[]) => void
  onHunkAction?: (action: DiffChangeAction, file: DiffViewerFile, hunk: number) => void
  busy?: boolean
  split: boolean
  wrap: boolean
  loadSides?: (file: DiffViewerFile) => Promise<FileDiffLoadedFiles>
  showStage?: boolean
}) {
  const t = useT()
  const [renderAttempt, setRenderAttempt] = React.useState(0)
  const loading = file.phase === 'queued' || file.phase === 'loading'
  const patch = file.patch ?? ''
  const truncatedWithoutHunk = file.phase === 'ready' && file.truncated && !hasRenderableHunk(patch)
  const showPatch = file.phase === 'ready' && !file.binary && !truncatedWithoutHunk && Boolean(patch)
  const working = file.stage === 'staged' || file.stage === 'unstaged'
  const sides = React.useMemo(() => loadSides && file.status === 'modified' && !file.truncated ? () => loadSides(file) : undefined,
    // A new revision is a new file to load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loadSides, file.id, file.revision, file.status, file.truncated])

  let body: React.ReactNode = null
  if (collapsed) body = null
  else if (file.binary) body = <DiffInlineState>{t('inspector.diff.binary')}</DiffInlineState>
  else if (file.phase === 'idle') body = <DiffInlineState>{t('inspector.diff.waiting')}</DiffInlineState>
  else if (loading) body = <DiffInlineState loading>{t('inspector.diff.loadingFile')}</DiffInlineState>
  else if (file.phase === 'error') body = <DiffInlineState onRetry={() => onRetry(file.id)}>{t('inspector.diff.readError')}</DiffInlineState>
  else if (truncatedWithoutHunk) body = <DiffInlineState>{t('inspector.diff.oversized')}</DiffInlineState>
  else if (!patch) body = <DiffInlineState>{t('inspector.diff.emptyFile')}</DiffInlineState>
  else if (showPatch) {
    body = <DiffRenderErrorBoundary resetKey={`${file.path}:${patch}:${renderAttempt}:${split}`}
      fallback={<DiffInlineState onRetry={() => setRenderAttempt((attempt) => attempt + 1)}>{t('inspector.diff.renderError')}</DiffInlineState>}>
      <React.Suspense fallback={<DiffInlineState loading>{t('inspector.diff.loadingRenderer')}</DiffInlineState>}>
        <ReadOnlyPatchDiff patch={patch} file={file} split={split} wrap={wrap} loadSides={sides}
          hunkActions={onHunkAction && working && file.status === 'modified' && !file.previousPath
            ? { stage: file.stage as 'staged' | 'unstaged', busy, onAction: (action, hunk) => onHunkAction(action, file, hunk) } : undefined} />
      </React.Suspense>
    </DiffRenderErrorBoundary>
  }

  return <section ref={sectionRef} data-diff-path={file.path} data-diff-id={file.id} data-diff-collapsed={collapsed || undefined} aria-label={file.path} aria-busy={loading || undefined}
    className="group/diff min-w-0 border-b border-border/60 outline-none">
    <DiffFileHeader file={file} collapsed={collapsed} onToggle={onToggle} onOpenFile={onOpenFile} onAction={working ? onAction : undefined} busy={busy} showStage={showStage} />
    {body}
    {!collapsed && file.errorCode && file.patch !== undefined ? <div role="alert" className="flex items-center gap-2 px-3 py-2 text-caption text-destructive"><span className="flex-1">{t('inspector.diff.readError')}</span><Button variant="ghost" size="xs" onClick={() => onRetry(file.id)}>{t('common.retry')}</Button></div> : null}
    {!collapsed && file.phase === 'ready' && file.truncated && showPatch ? <p className="px-3 py-2 text-micro text-muted-foreground">{t('inspector.diff.truncated')}</p> : null}
  </section>
}

function DiffSummarySurface({ files, listTruncated, message, registerScrollRoot, registerSection }: {
  files: DiffViewerFile[]
  listTruncated: boolean
  message: string
  registerScrollRoot: (node: HTMLElement | null) => void
  registerSection: (path: string, node: HTMLElement | null) => void
}) {
  const t = useT()
  return <div ref={registerScrollRoot} className="scroll-slim min-h-0 flex-1 overflow-auto pb-2">
    {files.map((file) => <section key={file.id} ref={(node) => registerSection(file.id, node)} data-diff-path={file.path} data-diff-id={file.id} aria-label={file.path} className="group/diff min-w-0 border-b border-border/60">
      <DiffFileHeader file={file} collapsed />
      <DiffInlineState>{file.binary ? t('inspector.diff.binary') : message}</DiffInlineState>
    </section>)}
    {listTruncated ? <p className="px-3 py-2 text-micro text-muted-foreground">{t('inspector.diff.listTruncated')}</p> : null}
  </div>
}

/** Codex's scope menu: Unstaged, Staged, a Commit, the Branch, the Last turn. */
function ScopeMenu({ scope, onScopeChange, counts, branchBase, commit }: {
  scope: DiffScope
  onScopeChange(scope: DiffScope): void
  counts: Record<'unstaged' | 'staged' | 'lastTurn', number>
  branchBase?: string
  commit?: DiffViewerProps['commit']
}) {
  const t = useT()
  const now = Date.now()
  const selectedCommit = commit?.commits.find((item) => item.sha === commit.selected)
  const label = scope === 'commit' ? (selectedCommit ? selectedCommit.sha.slice(0, 7) : t('inspector.diff.scope.commit'))
    : t(`inspector.diff.scope.${scope}`)
  const count = scope === 'commit' || scope === 'branch' ? null : counts[scope]
  const item = (value: 'unstaged' | 'staged' | 'lastTurn') => <DropdownMenuRadioItem value={value} title={t(`inspector.diff.scope.${value}Hint`)}>
    <span className="min-w-0 flex-1">{t(`inspector.diff.scope.${value}`)}</span>
    <span className="ml-4 text-micro text-muted-foreground tabular-nums">{counts[value]}</span>
  </DropdownMenuRadioItem>
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button variant="ghost" size="xs" className="h-6 max-w-44 shrink-0 gap-1 rounded-[7px] px-2 text-caption font-medium" aria-label={t('inspector.diff.scopeMenu')} data-diff-scope={scope}>
        <span className="min-w-0 truncate">{label}</span>
        {count !== null ? <span className="text-muted-foreground tabular-nums">· {count}</span> : null}
        <TbChevronDown className="size-3 shrink-0 text-muted-foreground" aria-hidden />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" className="min-w-56">
      <DropdownMenuLabel>{t('inspector.diff.scopeMenu')}</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={scope === 'commit' ? '' : scope} onValueChange={(value) => onScopeChange(value as DiffScope)}>
        {item('unstaged')}
        {item('staged')}
      </DropdownMenuRadioGroup>
      {commit ? <DropdownMenuSub>
        <DropdownMenuSubTrigger className={cn(scope === 'commit' && 'font-medium')}>
          {scope === 'commit' ? <TbCheck aria-hidden /> : <TbGitCommit aria-hidden />}
          <span className="min-w-0 flex-1">{t('inspector.diff.scope.commit')}</span>
          {selectedCommit && scope === 'commit' ? <span className="ml-3 font-mono text-micro text-muted-foreground">{selectedCommit.sha.slice(0, 7)}</span> : null}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="max-h-80 w-80 overflow-y-auto">
          {commit.commitsLoading && !commit.commits.length ? <DropdownMenuItem disabled><TbLoader2 className="animate-spin" aria-hidden />{t('inspector.diff.loading')}</DropdownMenuItem> : null}
          {!commit.commitsLoading && !commit.commits.length ? <DropdownMenuItem disabled>{t('inspector.diff.noCommits')}</DropdownMenuItem> : null}
          {commit.commits.map((item) => <DropdownMenuItem key={item.sha} onSelect={() => { commit.onSelect(item.sha); onScopeChange('commit') }} className="items-start">
            <span className="mt-0.5 w-4 shrink-0">{scope === 'commit' && item.sha === commit.selected ? <TbCheck aria-hidden /> : null}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate">{item.subject || item.sha.slice(0, 7)}</span>
              <span className="block truncate text-micro text-muted-foreground"><span className="font-mono">{item.sha.slice(0, 7)}</span> · {item.author} · <RelativeTime iso={item.date} now={now} /></span>
            </span>
          </DropdownMenuItem>)}
        </DropdownMenuSubContent>
      </DropdownMenuSub> : null}
      <DropdownMenuRadioGroup value={scope === 'commit' ? '' : scope} onValueChange={(value) => onScopeChange(value as DiffScope)}>
        {branchBase !== undefined ? <DropdownMenuRadioItem value="branch" title={t('inspector.diff.scope.branchHint')}>
          <span className="min-w-0 flex-1">{t('inspector.diff.scope.branch')}</span>
          {branchBase ? <span className="ml-4 max-w-28 truncate font-mono text-micro text-muted-foreground">{branchBase}</span> : null}
        </DropdownMenuRadioItem> : null}
        {item('lastTurn')}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>
}

const NOOP_REQUEST = () => undefined
const SCOPE_EMPTY = {
  unstaged: 'inspector.diff.empty.unstaged',
  staged: 'inspector.diff.empty.staged',
  lastTurn: 'inspector.diff.empty.lastTurn',
} as const

/**
 * The review tab, as in Codex: one header row (scope, totals, stage and
 * revert all, fold all, ⋯), then each file as a foldable section with a
 * sticky header. Hunk actions sit in a row above each block of changes.
 */
export function DiffViewer({ working, branch, commit, scope, onScopeChange, onRefresh, onOpenFile, visible = true, focusRequest, lastTurnPaths = [],
  onChangeAction, onHunkAction, describeError, loadSides }: DiffViewerProps) {
  const t = useT()
  const source: ReviewFileList = scope === 'branch' && branch ? branch : scope === 'commit' && commit ? commit : working
  const files = source.files
  const { listLoading, listTruncated, listErrorMessage } = source
  const requestFile = source.onRequestFile ?? NOOP_REQUEST
  const retryFile = source.onRetryFile ?? NOOP_REQUEST
  const readOnly = scope === 'branch' || scope === 'commit'
  const [busy, setBusy] = React.useState(false)
  const [actionError, setActionError] = React.useState<string | null>(null)
  const [confirmDiscard, setConfirmDiscard] = React.useState<{ files: readonly DiffViewerFile[]; hunk?: number } | null>(null)
  const [collapsed, setCollapsed] = React.useState<ReadonlySet<string>>(() => new Set())
  const [view, setView] = React.useState(readView)
  const [width, setWidth] = React.useState(0)
  const rootRef = React.useRef<HTMLDivElement>(null)
  const counts = React.useMemo(() => diffScopeCounts(working.files, lastTurnPaths), [working.files, lastTurnPaths])
  const scopedFiles = React.useMemo(() => filterDiffScope(files, scope, lastTurnPaths), [files, lastTurnPaths, scope])
  const unstagedInScope = readOnly ? [] : scopedFiles.filter((file) => file.stage === 'unstaged')
  const stagedInScope = readOnly ? [] : scopedFiles.filter((file) => file.stage === 'staged')
  const totals = React.useMemo(() => scopedFiles.reduce((sum, file) => ({ added: sum.added + file.added, deleted: sum.deleted + file.deleted }), { added: 0, deleted: 0 }), [scopedFiles])
  const splitAvailable = width >= SPLIT_MIN_WIDTH
  const split = view.split && splitAvailable
  const wrap = view.wrap ?? true
  React.useEffect(() => {
    try { localStorage.setItem(VIEW_KEY, JSON.stringify(view)) } catch { /* The view still applies until restart. */ }
  }, [view])
  React.useLayoutEffect(() => {
    const node = rootRef.current
    if (!node) return
    const observer = new ResizeObserver(() => setWidth(node.clientWidth))
    observer.observe(node)
    setWidth(node.clientWidth)
    return () => observer.disconnect()
  }, [])

  const run = async (action: DiffChangeAction, targets: readonly DiffViewerFile[], hunk?: number) => {
    if (!onChangeAction || busy || targets.length === 0) return
    setBusy(true)
    setActionError(null)
    try { await (hunk === undefined || !onHunkAction ? onChangeAction(action, targets) : onHunkAction(action, targets[0]!, hunk)) }
    catch (error) { setActionError(describeError?.(error) ?? t('inspector.diff.actionFailed')) }
    finally { setBusy(false) }
  }
  // Discarding loses work, so it always asks first.
  const requestAction = (action: DiffChangeAction, targets: readonly DiffViewerFile[], hunk?: number) => {
    if (action === 'discard') setConfirmDiscard({ files: targets, hunk })
    else void run(action, targets, hunk)
  }
  const discardNewFiles = confirmDiscard?.files.filter((file) => file.status === 'added').length ?? 0
  const [scrollRoot, setScrollRoot] = React.useState<HTMLElement | null>(null)
  const observerRef = React.useRef<IntersectionObserver | null>(null)
  const sectionNodes = React.useRef(new Map<string, HTMLElement>())
  const readingAnchor = React.useRef<{ id: string; offset: number } | null>(null)
  const handledFocus = React.useRef<number | null>(null)
  const focusedSection = React.useRef<string | null>(null)
  // Staged first, as Git lists them; the Last turn shows both.
  const orderedFiles = React.useMemo(() => [...scopedFiles].sort((a, b) => Number(a.stage === 'unstaged') - Number(b.stage === 'unstaged')), [scopedFiles])
  const resetKey = orderedFiles.map((file) => file.id).join('\u0000')
  const allCollapsed = orderedFiles.length > 0 && orderedFiles.every((file) => collapsed.has(file.id))
  const toggleFile = (id: string) => setCollapsed((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  const unfold = (id: string) => setCollapsed((current) => {
    if (!current.has(id)) return current
    const next = new Set(current)
    next.delete(id)
    return next
  })

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
    // The renderer finished loading and replaced the section just focused: keep focus there.
    if (focusedSection.current === path && (!document.activeElement || document.activeElement === document.body)) {
      node.setAttribute('tabindex', '-1')
      node.focus({ preventScroll: true })
    }
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
      const target = orderedFiles.find((file) => file.path === focusRequest.path && file.stage === 'unstaged') ?? orderedFiles.find((file) => file.path === focusRequest.path)
      // A file changed only in the other stage shows in that stage's scope.
      const elsewhere = target ? undefined : working.files.find((file) => file.path === focusRequest.path)
      if (elsewhere && (elsewhere.stage === 'staged' || elsewhere.stage === 'unstaged') && scope !== elsewhere.stage) {
        onScopeChange(elsewhere.stage)
        return
      }
      const section = target ? sectionNodes.current.get(target.id) : undefined
      if (!section || !target) return
      handledFocus.current = focusRequest.sequence
      focusedSection.current = target.id
      readingAnchor.current = null
      unfold(target.id)
      requestFile(target.id)
      section.setAttribute('tabindex', '-1')
      // A tab opened by this request is shown by its dock in the same commit;
      // focus once it has been laid out.
      requestAnimationFrame(() => {
        if (!section.isConnected) return
        scrollRoot.scrollTop += section.getBoundingClientRect().top - scrollRoot.getBoundingClientRect().top
        section.focus({ preventScroll: true })
      })
      return
    }
    const anchor = readingAnchor.current
    const section = anchor ? sectionNodes.current.get(anchor.id) : undefined
    if (section && anchor) scrollRoot.scrollTop += section.getBoundingClientRect().top - scrollRoot.getBoundingClientRect().top - anchor.offset
  }, [files, focusRequest, onScopeChange, orderedFiles, requestFile, scope, scrollRoot, visible, working.files])

  React.useEffect(() => {
    observerRef.current?.disconnect()
    observerRef.current = null
    if (!scrollRoot || !visible) return
    if (typeof IntersectionObserver === 'undefined') {
      requestFile(orderedFiles.slice(0, 3).map((file) => file.id))
      return
    }
    const observer = new IntersectionObserver((entries) => {
      const ids = entries.flatMap((entry) => {
        if (!entry.isIntersecting) return []
        const id = (entry.target as HTMLElement).dataset.diffId
        return id ? [id] : []
      })
      if (ids.length > 0) requestFile(ids)
    }, { root: scrollRoot, rootMargin: '720px 0px', threshold: 0.01 })
    observerRef.current = observer
    for (const node of sectionNodes.current.values()) observer.observe(node)
    return () => {
      observer.disconnect()
      if (observerRef.current === observer) observerRef.current = null
    }
  // `resetKey` covers the files shown.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestFile, resetKey, scrollRoot, visible])

  const emptyMessage = scope === 'branch'
    ? branch?.base ? t('inspector.diff.branchClean', { base: branch.base }) : t('inspector.diff.branchNoBase')
    : scope === 'commit'
      ? commit?.commitsLoading ? t('inspector.diff.loading') : commit?.commits.length ? t('inspector.diff.commitEmpty') : t('inspector.diff.noCommits')
      : !working.gitAvailable ? t('inspector.diff.gitUnavailable') : t(SCOPE_EMPTY[scope])

  return <DiffReviewProvider files={files} complete={!listLoading && !listTruncated && !listErrorMessage}>
    <div ref={rootRef} className="flex h-full min-h-0 flex-col" data-review>
      {working.gitAvailable ? <header className="flex h-9 shrink-0 items-center gap-1 border-b border-border pr-1.5 pl-1.5" data-review-header>
        <ScopeMenu scope={scope} onScopeChange={onScopeChange} counts={counts} branchBase={branch ? branch.base : undefined} commit={commit} />
        {scopedFiles.length ? <span className="shrink-0 px-1 font-mono text-micro tabular-nums" aria-label={t('inspector.diff.totals', { added: totals.added, deleted: totals.deleted })}>
          <span className="text-success">+{totals.added}</span> <span className="text-destructive">−{totals.deleted}</span>
        </span> : null}
        <span className="min-w-1 flex-1" />
        {listLoading && files.length ? <TbLoader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" aria-label={t('inspector.diff.loading')} /> : null}
        {onChangeAction && unstagedInScope.length ? <Button variant="outline" size="xs" className="h-6 shrink-0 rounded-[7px] px-2 text-caption" disabled={busy} onClick={() => requestAction('stage', unstagedInScope)}>
          {t('inspector.diff.stageAllShort')}
        </Button> : null}
        {onChangeAction && !unstagedInScope.length && stagedInScope.length ? <Button variant="outline" size="xs" className="h-6 shrink-0 rounded-[7px] px-2 text-caption" disabled={busy} onClick={() => requestAction('unstage', stagedInScope)}>
          {t('inspector.diff.unstageAllShort')}
        </Button> : null}
        {onChangeAction && unstagedInScope.length ? <IconAction label={t('inspector.diff.discardAllShort')} disabled={busy} onClick={() => requestAction('discard', unstagedInScope)}><TbArrowBackUp aria-hidden /></IconAction> : null}
        {orderedFiles.length > 1 ? <IconAction label={t(allCollapsed ? 'inspector.diff.expandAllFiles' : 'inspector.diff.collapseAllFiles')}
          onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(orderedFiles.map((file) => file.id)))}>
          {allCollapsed ? <TbArrowsVertical aria-hidden /> : <TbFold aria-hidden />}
        </IconAction> : null}
        {orderedFiles.length > 3 ? <DiffFileNavigator files={orderedFiles} onSelect={(id) => {
          readingAnchor.current = null
          unfold(id)
          requestFile(id)
          const section = sectionNodes.current.get(id)
          section?.scrollIntoView({ block: 'start', behavior: 'instant' })
          section?.setAttribute('tabindex', '-1')
          section?.focus({ preventScroll: true })
        }} /> : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-xs" aria-label={t('inspector.diff.actions')} title={t('inspector.diff.actions')}>
              {busy ? <TbLoader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : <TbDots aria-hidden />}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-56">
            <DropdownMenuItem disabled={listLoading || !onRefresh} onSelect={() => onRefresh?.()}><TbRefresh aria-hidden />{t('inspector.diff.refresh')}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{t('inspector.diff.view')}</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={split ? 'split' : 'unified'} onValueChange={(value) => setView((current) => ({ ...current, split: value === 'split' }))}>
              <DropdownMenuRadioItem value="unified">{t('inspector.diff.viewUnified')}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="split" disabled={!splitAvailable} title={splitAvailable ? undefined : t('inspector.diff.viewSplitNarrow')}>{t('inspector.diff.viewSplit')}</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuCheckboxItem checked={wrap} onCheckedChange={(checked) => setView((current) => ({ ...current, wrap: checked === true }))}>
              <TbTextWrap aria-hidden />{t('inspector.preview.wrap')}
            </DropdownMenuCheckboxItem>
            {onChangeAction && (unstagedInScope.length || stagedInScope.length) ? <>
              <DropdownMenuSeparator />
              {unstagedInScope.length ? <DropdownMenuItem onSelect={() => requestAction('stage', unstagedInScope)}><TbPlus aria-hidden />{t('inspector.diff.stageAll', { count: unstagedInScope.length })}</DropdownMenuItem> : null}
              {stagedInScope.length ? <DropdownMenuItem onSelect={() => requestAction('unstage', stagedInScope)}><TbMinus aria-hidden />{t('inspector.diff.unstageAll', { count: stagedInScope.length })}</DropdownMenuItem> : null}
              {unstagedInScope.length ? <DropdownMenuItem variant="destructive" onSelect={() => requestAction('discard', unstagedInScope)}><TbArrowBackUp aria-hidden />{t('inspector.diff.discardAll', { count: unstagedInScope.length })}</DropdownMenuItem> : null}
            </> : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </header> : null}
      {actionError ? <div role="alert" className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 text-caption text-destructive">
        <span className="min-w-0 flex-1">{actionError}</span>
        {onRefresh ? <Button variant="ghost" size="xs" onClick={() => { setActionError(null); onRefresh() }}>{t('common.refresh')}</Button> : null}
      </div> : null}
      <AlertDialog open={confirmDiscard !== null} onOpenChange={(open) => { if (!open) setConfirmDiscard(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmDiscard?.hunk !== undefined
              ? t('inspector.diff.discardHunkTitle', { path: confirmDiscard.files[0]!.path })
              : confirmDiscard?.files.length === 1
                ? t('inspector.diff.discardTitleOne', { path: confirmDiscard.files[0]!.path })
                : t('inspector.diff.discardTitle', { count: confirmDiscard?.files.length ?? 0 })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('inspector.diff.discardDescription')}
              {discardNewFiles > 0 ? ` ${t('inspector.diff.discardNewFiles', { count: discardNewFiles, trash: t(trashKey()) })}` : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => { const pending = confirmDiscard; setConfirmDiscard(null); if (pending) void run('discard', pending.files, pending.hunk) }}>
              {t('inspector.diff.discardConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <DiffReviewSummary />
      {focusRequest && !listLoading && !files.some((file) => file.path === focusRequest.path) ? <p role="status" className="shrink-0 border-b border-border px-3 py-2 text-caption text-muted-foreground">{focusRequest.path} · {t('inspector.diff.noFileChanges')}</p> : null}
      {listErrorMessage && files.length > 0 ? <div role="alert" className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 text-caption text-destructive">
        <span className="min-w-0 flex-1">{listErrorMessage}</span>
        {onRefresh ? <Button variant="ghost" size="xs" onClick={onRefresh} disabled={listLoading}>{t('common.retry')}</Button> : null}
      </div> : null}

      {orderedFiles.length === 0 ? <div className="grid min-h-0 flex-1 place-items-center p-6 text-center text-caption text-muted-foreground">
        {listLoading ? <span className="flex items-center gap-2" role="status"><TbLoader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />{t('inspector.diff.loading')}</span>
          : listErrorMessage ? <div role="alert" className="flex flex-col items-center gap-2">
            <p className="text-destructive">{listErrorMessage}</p>
            {onRefresh ? <Button variant="outline" size="xs" onClick={onRefresh}><TbRefresh aria-hidden />{t('common.retry')}</Button> : null}
          </div>
            : <div role="status" className="max-w-64 space-y-1.5">
              <p className="text-body text-foreground/80">{emptyMessage}</p>
              {scope === 'unstaged' || scope === 'staged' ? <p className="text-micro">{t('inspector.diff.emptyHint')}</p> : null}
            </div>}
      </div> : <DiffRenderErrorBoundary resetKey={resetKey}
        fallback={<DiffSummarySurface files={orderedFiles} listTruncated={listTruncated} message={t('inspector.diff.rendererUnavailable')} registerScrollRoot={setScrollRoot} registerSection={registerSection} />}>
        <React.Suspense fallback={<DiffSummarySurface files={orderedFiles} listTruncated={listTruncated} message={t('inspector.diff.loadingRenderer')} registerScrollRoot={setScrollRoot} registerSection={registerSection} />}>
          <ReadOnlyDiffVirtualizer onScrollRoot={setScrollRoot}>
            {orderedFiles.map((file) => <DiffFileSection
              key={file.id}
              file={file}
              sectionRef={(node) => registerSection(file.id, node)}
              collapsed={collapsed.has(file.id)}
              onToggle={() => toggleFile(file.id)}
              onRetry={retryFile}
              onOpenFile={onOpenFile}
              onAction={onChangeAction && !readOnly ? requestAction : undefined}
              onHunkAction={onHunkAction && !readOnly ? (action, target, hunk) => requestAction(action, [target], hunk) : undefined}
              busy={busy}
              split={split}
              wrap={wrap}
              loadSides={loadSides}
              showStage={scope === 'lastTurn'}
            />)}
            {listTruncated ? <p className="px-3 py-2 text-micro text-muted-foreground">{t('inspector.diff.listTruncated')}</p> : null}
          </ReadOnlyDiffVirtualizer>
        </React.Suspense>
      </DiffRenderErrorBoundary>}
    </div>
  </DiffReviewProvider>
}
