import * as React from 'react'
import {
  TbAlertCircle,
  TbArchive,
  TbArchiveOff,
  TbChevronRight,
  TbCircleCheck,
  TbCircleDot,
  TbCopy,
  TbDots,
  TbDownload,
  TbEdit,
  TbFileImport,
  TbFolder,
  TbGitBranch,
  TbFolderOpen,
  TbLoader2,
  TbMessagePlus,
  TbPencil,
  TbPin,
  TbPinnedOff,
  TbTrash,
  TbTerminal2,
  TbExternalLink,
} from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useLocale, useT } from '@/i18n'
import { compactRelativeTime } from '@/lib/relative-time'
import { cn } from '@/lib/utils'
import { revealLabelKey } from '@/lib/platform-labels'
import type {
  OfficialPiSessionSummary,
} from '@/shared/conversation-scope'
import type { WorkspaceSummary } from '@/shared/schemas/workspace'
import type { AgentStatus } from '@/types/chat'
import type { SessionActivityState } from '@/store/workspace-state'
import { sidebarConversationTitle, type SidebarProjectIndicator } from './session-navigation'
import { ArchiveWorktreeDialog, NewWorktreeSheet } from '@/components/projects/WorktreeSheets'
import { useProjectWorkflowActions } from '@/components/projects/project-workflow-actions'
import { useWorktreeIndex } from '@/store/project-workflows'
import type { ManagedWorktree } from '@/shared/project-workflows'
import { useTerminalActions } from '@/components/inspector/TerminalActions'

export interface SidebarConversationItem {
  summary: OfficialPiSessionSummary
  loading?: boolean
  disabled?: boolean
  status?: AgentStatus
  activityState?: SessionActivityState
  selected?: boolean
  pinned?: boolean
  archived?: boolean
  needsAttention?: boolean
  unread?: boolean
  organizationKey?: string
  scopeLabel?: string
}

export type SidebarProjectCatalog =
  | { status: 'idle' | 'loading' | 'notLoaded' | 'activationUnavailable' | 'unavailable' }
  | { status: 'error'; message?: string }
  | {
      status: 'ready'
      items: readonly SidebarConversationItem[]
      hasMore: boolean
    }

export interface SidebarProjectNavigation {
  project: WorkspaceSummary
  expanded: boolean
  catalog: SidebarProjectCatalog
  /** What the row shows for tasks hidden while it is collapsed. */
  indicator: SidebarProjectIndicator
  /** Active (unarchived) tasks, for "Archive tasks". */
  taskCount: number
}

export interface ConversationListActions {
  renamingSelectionToken: string | null
  onSelect(item: SidebarConversationItem): void
  onRenameStart(item: SidebarConversationItem): void
  onRenameCommit(item: SidebarConversationItem, title: string): void
  onDuplicate(item: SidebarConversationItem): void
  onDelete(item: SidebarConversationItem): void
  onPin?(item: SidebarConversationItem, pinned: boolean): void
  onArchive?(item: SidebarConversationItem, archived: boolean): void
  onMarkUnread?(item: SidebarConversationItem, unread: boolean): void
  onExport?(item: SidebarConversationItem): void
}

/**
 * `archived` rows restore or delete (Codex keeps delete behind archive);
 * `timeline` rows name their project because the list mixes projects.
 */
export type ConversationListVariant = 'project' | 'recent' | 'pinned' | 'timeline' | 'archived'

interface ConversationListProps extends ConversationListActions {
  activeSessionId: string
  items: readonly SidebarConversationItem[]
  now: number
  emptyLabel?: string
  variant: ConversationListVariant
}

const statusLabelKey = {
  planning: 'agent.status.planning',
  running: 'agent.status.running',
  failed: 'agent.status.failed',
} as const

export type SidebarSessionIndicatorState =
  | 'loading'
  | 'running'
  | 'attention'
  | 'unread'
  | 'failed'
  | 'none'

export function resolveSidebarSessionIndicatorState({
  loading = false,
  status,
  activityState,
  needsAttention = false,
  unread = false,
}: {
  loading?: boolean
  status?: AgentStatus
  activityState?: SessionActivityState
  needsAttention?: boolean
  unread?: boolean
}): SidebarSessionIndicatorState {
  if (loading || activityState === 'opening') return 'loading'
  if (status === 'failed' || activityState === 'failed') return 'failed'
  if (needsAttention) return 'attention'
  if (status === 'cancelled') return 'none'
  // "waiting" describes queued prompts, not a request for user input.
  if (activityState === 'running' || activityState === 'waiting' ||
    (!activityState && (status === 'planning' || status === 'running'))) return 'running'
  return unread ? 'unread' : 'none'
}

function IndicatorIcon({ state }: { state: Exclude<SidebarSessionIndicatorState, 'none'> }) {
  if (state === 'attention') return <TbAlertCircle className="size-3.5 text-warning" aria-hidden />
  if (state === 'failed') return <TbAlertCircle className="size-3.5 text-destructive" aria-hidden />
  if (state === 'unread') return <span className="size-[7px] rounded-full bg-primary" aria-hidden />
  return <TbLoader2 className="size-3.5 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden />
}

function StatusIndicator({ state, label }: { state: Exclude<SidebarSessionIndicatorState, 'none'>; label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="relative z-10 flex size-5 shrink-0 items-center justify-center"
          role="status"
          aria-label={label}
          data-session-indicator={state}
        >
          <IndicatorIcon state={state} />
        </span>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}

/** "now", "5m", "3h" … in English; "刚刚", "5 分钟" … in Chinese; then a short date. */
export function RelativeTime({ iso, now }: { iso: string; now: number }) {
  const t = useT()
  const locale = useLocale()
  const value = compactRelativeTime(iso, now)
  if (!value) return null
  const label = value.unit === 'now' ? t('time.compact.now')
    : value.unit === 'date'
      ? new Intl.DateTimeFormat(locale, value.sameYear ? { month: 'short', day: 'numeric' } : { year: 'numeric', month: 'numeric', day: 'numeric' }).format(value.date)
      : t(`time.compact.${value.unit}`, { count: value.count })
  return (
    <time dateTime={iso} title={new Date(iso).toLocaleString(locale)} className="shrink-0 whitespace-nowrap text-micro tabular-nums text-muted-foreground">
      {label}
    </time>
  )
}

/** One menu for a task, rendered as its ⋯ dropdown or its right-click menu. */
function TaskMenuItems({ item, variant, kind, onRename, actions }: {
  item: SidebarConversationItem
  variant: ConversationListVariant
  kind: 'dropdown' | 'context'
  onRename(): void
  actions: Omit<ConversationListActions, 'renamingSelectionToken'>
}) {
  const t = useT()
  const Item = kind === 'dropdown' ? DropdownMenuItem : ContextMenuItem
  const Separator = kind === 'dropdown' ? DropdownMenuSeparator : ContextMenuSeparator
  if (variant === 'archived') {
    return <>
      {actions.onArchive && <Item onSelect={() => actions.onArchive?.(item, false)}><TbArchiveOff aria-hidden />{t('nav.redesign.restoreTask')}</Item>}
      {actions.onExport && <Item onSelect={() => actions.onExport?.(item)}><TbDownload aria-hidden />{t('export.conversation')}</Item>}
      <Separator />
      <Item variant="destructive" onSelect={() => actions.onDelete(item)}><TbTrash aria-hidden />{t('sidebar.session.delete')}</Item>
    </>
  }
  return <>
    {actions.onPin && <Item onSelect={() => actions.onPin?.(item, !item.pinned)}>
      {item.pinned ? <TbPinnedOff aria-hidden /> : <TbPin aria-hidden />}
      {t(item.pinned ? 'nav.redesign.unpinTask' : 'nav.redesign.pinTask')}
    </Item>}
    <Item onSelect={onRename}><TbPencil aria-hidden />{t('sidebar.session.rename')}</Item>
    {actions.onMarkUnread && !item.selected && <Item onSelect={() => actions.onMarkUnread?.(item, !item.unread)}>
      {item.unread ? <TbCircleCheck aria-hidden /> : <TbCircleDot aria-hidden />}
      {t(item.unread ? 'sidebar.session.markRead' : 'sidebar.session.markUnread')}
    </Item>}
    <Separator />
    <Item onSelect={() => actions.onDuplicate(item)}><TbCopy aria-hidden />{t('sidebar.session.duplicate')}</Item>
    {actions.onExport && <Item onSelect={() => actions.onExport?.(item)}><TbDownload aria-hidden />{t('export.conversation')}</Item>}
    {actions.onArchive && <>
      <Separator />
      <Item onSelect={() => actions.onArchive?.(item, true)}><TbArchive aria-hidden />{t('nav.redesign.archiveTask')}</Item>
    </>}
  </>
}

/** Hover actions reveal on pointer hover, keyboard focus, or while their menu is open. */
const HOVER_REVEAL = 'opacity-0 group-hover/row:opacity-100 group-has-[:focus-visible]/row:opacity-100 group-has-[[data-state=open]]/row:opacity-100'
const HOVER_HIDE = 'group-hover/row:invisible group-has-[:focus-visible]/row:invisible group-has-[[data-state=open]]/row:invisible'

function ConversationRow({
  item,
  active,
  renaming,
  now,
  variant,
  ...actions
}: {
  item: SidebarConversationItem
  active: boolean
  renaming: boolean
  now: number
  variant: ConversationListVariant
} & Omit<ConversationListActions, 'renamingSelectionToken'>) {
  const t = useT()
  const { onRenameCommit, onRenameStart, onSelect } = actions
  const title = sidebarConversationTitle(item.summary, t('sidebar.session.untitled'))
  const [renameText, setRenameText] = React.useState(title)
  const [requestedRename, setRequestedRename] = React.useState(false)
  const renamingHere = renaming && requestedRename
  const inputRef = React.useRef<HTMLInputElement>(null)
  const skipBlurCommit = React.useRef(false)
  const unavailable = item.loading || item.disabled
  const indicator = resolveSidebarSessionIndicatorState({
    loading: item.loading,
    status: item.status,
    activityState: item.activityState,
    needsAttention: item.needsAttention,
    unread: !active && item.unread,
  })
  const indicatorLabel = indicator === 'attention' ? t('nav.redesign.attention')
    : indicator === 'loading' ? t('sidebar.session.loading')
      : indicator === 'running'
        ? t(item.activityState === 'waiting' && item.status !== 'running' && item.status !== 'planning'
          ? 'nav.redesign.waiting' : item.status === 'planning' ? statusLabelKey.planning : statusLabelKey.running)
        : indicator === 'unread' ? t('nav.redesign.unread') : t(statusLabelKey.failed)

  React.useEffect(() => {
    if (!renaming) setRequestedRename(false)
    if (!renamingHere) return
    setRenameText(title)
    requestAnimationFrame(() => inputRef.current?.select())
  }, [renaming, renamingHere, title])

  const cancelRename = () => {
    skipBlurCommit.current = true
    onRenameCommit(item, item.summary.name ?? '')
    inputRef.current?.blur()
  }
  const startRename = () => {
    setRequestedRename(true)
    onRenameStart(item)
  }

  const row = (
    <div className={cn(
      'group/row relative grid min-h-[28px] grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-[8px] py-[3px] pr-1 pl-2.5',
      active ? 'bg-source-list-selected text-foreground' : 'text-foreground/90 hover:bg-fill',
    )} data-session-row>
      {renamingHere ? (
        <input
          ref={inputRef}
          name="session-title"
          autoComplete="off"
          value={renameText}
          onChange={(event) => setRenameText(event.target.value)}
          onBlur={() => {
            if (skipBlurCommit.current) {
              skipBlurCommit.current = false
              return
            }
            onRenameCommit(item, renameText)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
            if (event.key === 'Escape') cancelRename()
          }}
          aria-label={t('sidebar.session.renameLabel')}
          className="z-10 col-span-2 min-w-0 rounded-[4px] bg-control px-1 py-0.5 text-app text-foreground shadow-[0_0_0_0.5px_var(--color-ring),0_0_0_3px_color-mix(in_srgb,var(--color-ring)_40%,transparent)] outline-none"
        />
      ) : <>
        <button
          type="button"
          aria-current={active ? 'page' : undefined}
          aria-label={title}
          title={title}
          disabled={unavailable}
          onClick={() => onSelect(item)}
          className="absolute inset-0 rounded-[8px] outline-none focus-visible:focus-ring disabled:cursor-wait"
        >
          <span className="sr-only">{title}</span>
        </button>
        {indicator === 'unread' && <span className="pointer-events-none absolute top-1/2 left-[3px] size-[5px] -translate-y-1/2 rounded-full bg-primary" aria-hidden />}
        <div className="pointer-events-none relative min-w-0">
          <span className="block truncate text-app">{title}</span>
          {variant === 'timeline' && item.scopeLabel && <span className="block truncate text-micro text-muted-foreground">{item.scopeLabel}</span>}
        </div>

        {/* Codex: the age sits on the right; running state replaces it; hover swaps in actions. */}
        <span className="relative flex h-[22px] min-w-[46px] items-center justify-end">
          <span className={cn('flex items-center', HOVER_HIDE)}>
            {indicator !== 'none' && indicator !== 'unread'
              ? <StatusIndicator state={indicator} label={indicatorLabel} />
              : <>
                {indicator === 'unread' && <span className="sr-only" role="status" aria-label={indicatorLabel} data-session-indicator="unread" />}
                <RelativeTime iso={item.summary.modifiedAt} now={now} />
              </>}
          </span>
          <span className={cn('absolute inset-y-0 right-0 z-10 flex items-center gap-px', HOVER_REVEAL)}>
            {variant === 'archived' ? <>
              {actions.onArchive && <RowAction label={t('nav.redesign.restoreTask')} disabled={unavailable} onClick={() => actions.onArchive?.(item, false)}><TbArchiveOff aria-hidden /></RowAction>}
              <RowAction label={t('sidebar.session.delete')} disabled={unavailable} onClick={() => actions.onDelete(item)}><TbTrash aria-hidden /></RowAction>
            </> : <>
              {actions.onArchive && <RowAction label={t('nav.redesign.archiveTask')} disabled={unavailable} onClick={() => actions.onArchive?.(item, true)}><TbArchive aria-hidden /></RowAction>}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-xs" aria-label={t('sidebar.session.actions')} disabled={unavailable}
                    className="size-[22px] rounded-[6px] text-muted-foreground hover:text-foreground"
                    onClick={(event) => event.stopPropagation()}>
                    <TbDots aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <TaskMenuItems item={item} variant={variant} kind="dropdown" onRename={startRename} actions={actions} />
                </DropdownMenuContent>
              </DropdownMenu>
            </>}
          </span>
        </span>
      </>}
    </div>
  )

  return (
    <li className="relative" data-session-activity={item.activityState}>
      {renamingHere || unavailable ? row : (
        <ContextMenu>
          <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
          <ContextMenuContent>
            <TaskMenuItems item={item} variant={variant} kind="context" onRename={startRename} actions={actions} />
          </ContextMenuContent>
        </ContextMenu>
      )}
    </li>
  )
}

function RowAction({ label, disabled, onClick, children }: {
  label: string
  disabled?: boolean
  onClick(): void
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label={label} disabled={disabled}
          className="size-[22px] rounded-[6px] text-muted-foreground hover:text-foreground"
          onClick={(event) => { event.stopPropagation(); onClick() }}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

export function ConversationList({
  items,
  activeSessionId,
  emptyLabel,
  variant,
  now,
  renamingSelectionToken,
  ...actions
}: ConversationListProps) {
  if (items.length === 0) {
    return emptyLabel
      ? <p className="px-2.5 py-1.5 text-caption text-muted-foreground">{emptyLabel}</p>
      : null
  }

  return (
    <ul className="flex flex-col gap-px" data-session-list={variant}>
      {items.map((item) => (
        <ConversationRow
          key={item.summary.selectionToken}
          item={item}
          active={item.selected ?? item.summary.sessionId === activeSessionId}
          renaming={item.summary.selectionToken === renamingSelectionToken}
          now={now}
          variant={variant}
          {...actions}
        />
      ))}
    </ul>
  )
}

/** Section heading whose trailing actions appear on hover, like Codex's sidebar. */
export function SidebarSection({ id, title, actions, className, children, ...props }: {
  id: string
  title: string
  actions?: React.ReactNode
  className?: string
  children?: React.ReactNode
} & Omit<React.HTMLAttributes<HTMLElement>, 'title' | 'id'>) {
  return (
    <section className={className} aria-labelledby={id} {...props}>
      <div className="group/row mb-px flex h-[26px] items-center justify-between pr-1 pl-2.5">
        <h2 id={id} className="text-micro font-semibold text-muted-foreground">{title}</h2>
        {actions ? <div className={cn('flex items-center gap-px', HOVER_REVEAL)}>{actions}</div> : null}
      </div>
      {children}
    </section>
  )
}

/** A compact icon button with tooltip for section headings and project rows. */
export function SidebarIconButton({ label, disabled, onClick, children, className }: {
  label: string
  disabled?: boolean
  onClick?: () => void
  children: React.ReactNode
  className?: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label={label} disabled={disabled}
          className={cn('size-[22px] rounded-[6px] text-muted-foreground hover:text-foreground', className)}
          onClick={(event) => { event.stopPropagation(); onClick?.() }}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

export interface ProjectNavigationGroupProps extends ConversationListActions {
  activeSessionId: string
  projects: readonly SidebarProjectNavigation[]
  now: number
  /** Organize menu and Add project, shown on the heading. */
  headerActions?: React.ReactNode
  onAddProject(): void
  onToggleProject(projectId: string, expanded: boolean): void
  onStartProjectTask(projectId: string): void
  onImportProject?(projectId: string): void
  onRevealProject?(projectId: string): void
  onLoadMore(projectId: string): void
  onPinProject(projectId: string, pinned: boolean): void
  onArchiveProjectTasks(projectId: string): void
  onRemoveProject(project: WorkspaceSummary): void
}

function ProjectChildren({
  navigation,
  activeSessionId,
  now,
  actions,
  onStartProjectTask,
  onLoadMore,
  onAddProject,
  onRetryProject,
}: {
  navigation: SidebarProjectNavigation
  activeSessionId: string
  now: number
  actions: ConversationListActions
  onStartProjectTask(projectId: string): void
  onLoadMore(projectId: string): void
  onAddProject(): void
  onRetryProject(projectId: string): void
}) {
  const t = useT()
  const { project, catalog } = navigation
  const quietRow = 'flex h-[28px] w-full items-center gap-1.5 rounded-[8px] px-2.5 text-left text-caption text-muted-foreground outline-none hover:bg-fill hover:text-foreground focus-visible:focus-ring'

  if (!project.available) {
    return <button type="button" className={quietRow} onClick={onAddProject}>{t('sidebar.project.reselect')}</button>
  }

  if (catalog.status === 'idle') return null

  if (catalog.status === 'loading') {
    return (
      <p className="flex h-[28px] items-center gap-1.5 px-2.5 text-caption text-muted-foreground" role="status">
        <TbLoader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
        {t('sidebar.project.loading')}
      </p>
    )
  }

  if (catalog.status === 'notLoaded') {
    return <button type="button" className={quietRow} onClick={() => onStartProjectTask(project.id)}>{t('sidebar.project.startTask')}</button>
  }

  if (catalog.status === 'activationUnavailable' || catalog.status === 'unavailable') {
    return <p className="px-2.5 py-1 text-caption text-muted-foreground" role="status">{t('sidebar.project.unavailable')}</p>
  }

  if (catalog.status === 'error') {
    return (
      <div className="flex h-[28px] items-center gap-1.5 px-2.5 text-caption" role="alert" title={catalog.message}>
        <TbAlertCircle className="size-3.5 shrink-0 text-destructive" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-destructive">{t('sidebar.project.error')}</span>
        <Button variant="ghost" size="xs" className="h-6 px-1.5" onClick={() => onRetryProject(project.id)}>{t('common.retry')}</Button>
      </div>
    )
  }

  if (catalog.status !== 'ready') return null

  const scopedItems = catalog.items.filter((item) =>
    item.summary.scope.kind === 'project' &&
    item.summary.scope.workspaceId === project.id)

  return (
    <>
      {scopedItems.length > 0 ? (
        <ConversationList {...actions} items={scopedItems} activeSessionId={activeSessionId} now={now} variant="project" />
      ) : (
        <button type="button" className={quietRow} onClick={() => onStartProjectTask(project.id)}>
          <TbMessagePlus className="size-3.5" aria-hidden />
          {t('sidebar.project.startTask')}
        </button>
      )}
      {catalog.hasMore && (
        <button type="button" className={cn(quietRow, 'text-micro')} onClick={() => onLoadMore(project.id)}>
          {t('sidebar.project.showMore')}
        </button>
      )}
    </>
  )
}

/** The platform's name for its file browser. */
/** One project's ⋯ / right-click menu (Codex: new task, organize, archive, remove). */
function ProjectMenuItems({ navigation, kind, worktree, onStartProjectTask, onImportProject, onRevealProject, onPinProject, onNewWorktree, onArchiveWorktree, onArchiveAll, onRemoveProject }: {
  navigation: SidebarProjectNavigation
  kind: 'dropdown' | 'context'
  onStartProjectTask(projectId: string): void
  onImportProject?(projectId: string): void
  onRevealProject?(projectId: string): void
  onPinProject(projectId: string, pinned: boolean): void
  /** Set when this project is a working copy. */
  worktree?: ManagedWorktree
  onNewWorktree(): void
  onArchiveWorktree(): void
  onArchiveAll(): void
  onRemoveProject(project: WorkspaceSummary): void
}) {
  const t = useT()
  const terminal = useTerminalActions()
  const Item = kind === 'dropdown' ? DropdownMenuItem : ContextMenuItem
  const Separator = kind === 'dropdown' ? DropdownMenuSeparator : ContextMenuSeparator
  const { project } = navigation
  return <>
    <Item disabled={!project.available} onSelect={() => onStartProjectTask(project.id)}><TbEdit aria-hidden />{t('nav.redesign.newTask')}</Item>
    {onImportProject && <Item disabled={!project.available} onSelect={() => onImportProject(project.id)}><TbFileImport aria-hidden />{t('import.open')}</Item>}
    <Separator />
    {onRevealProject && <Item disabled={!project.available} onSelect={() => onRevealProject(project.id)}><TbFolderOpen aria-hidden />{t(revealLabelKey())}</Item>}
    {terminal ? <>
      <Item disabled={!project.available} onSelect={() => terminal.open({ kind: 'project', workspaceId: project.id }, '.')}><TbTerminal2 aria-hidden />{t('terminal.context.openHere')}</Item>
      <Item disabled={!project.available} onSelect={() => terminal.openExternal({ kind: 'project', workspaceId: project.id }, '.')}><TbExternalLink aria-hidden />{t('terminal.context.openExternalHere')}</Item>
    </> : null}
    <Item onSelect={() => onPinProject(project.id, !project.pinned)}>
      {project.pinned ? <TbPinnedOff aria-hidden /> : <TbPin aria-hidden />}
      {t(project.pinned ? 'sidebar.workspace.unpinShort' : 'sidebar.workspace.pinShort')}
    </Item>
    <Item disabled={!project.available} onSelect={onNewWorktree}><TbGitBranch aria-hidden />{t('worktree.newMenu')}</Item>
    <Item disabled={navigation.taskCount === 0} onSelect={onArchiveAll}><TbArchive aria-hidden />{t('sidebar.project.archiveAll')}</Item>
    <Separator />
    {worktree?.state === 'active'
      ? <Item variant="destructive" onSelect={onArchiveWorktree}><TbArchive aria-hidden />{t('worktree.archiveMenu')}</Item>
      : <Item variant="destructive" onSelect={() => onRemoveProject(project)}><TbTrash aria-hidden />{t('sidebar.project.remove')}</Item>}
  </>
}

function ProjectIndicator({ indicator }: { indicator: SidebarProjectIndicator }) {
  const t = useT()
  if (indicator === 'none') return null
  const label = t(indicator === 'attention' ? 'nav.redesign.attention' : indicator === 'failed' ? 'agent.status.failed'
    : indicator === 'running' ? 'nav.redesign.running' : 'nav.redesign.unread')
  return (
    <span className="flex size-5 items-center justify-center" role="status" aria-label={label} data-project-indicator={indicator}>
      <IndicatorIcon state={indicator} />
    </span>
  )
}

export function ProjectNavigationGroup({
  projects,
  activeSessionId,
  now,
  headerActions,
  onAddProject,
  onToggleProject,
  onStartProjectTask,
  onImportProject,
  onRevealProject,
  onLoadMore,
  onPinProject,
  onArchiveProjectTasks,
  onRemoveProject,
  ...conversationActions
}: ProjectNavigationGroupProps) {
  const t = useT()
  const shell = useProjectWorkflowActions()
  const [worktreeSource, setWorktreeSource] = React.useState<WorkspaceSummary | null>(null)
  const [archivingWorktree, setArchivingWorktree] = React.useState<ManagedWorktree | null>(null)
  const [archiveProject, setArchiveProject] = React.useState<SidebarProjectNavigation | null>(null)
  const worktrees = useWorktreeIndex(projects.map((navigation) => navigation.project.id))

  return (
    <SidebarSection id="sidebar-projects-heading" title={t('sidebar.projects')} actions={headerActions}>
      {worktreeSource ? <NewWorktreeSheet open onOpenChange={(open) => { if (!open) setWorktreeSource(null) }} workspaceId={worktreeSource.id}
        projectName={worktrees.get(worktreeSource.id)?.projectName ?? worktreeSource.name}
        onCreated={(created, ranSetup) => {
          if (!created.workspaceId) return
          onStartProjectTask(created.workspaceId)
          if (ranSetup) shell?.openActionRun(created.workspaceId)
        }} /> : null}
      <ArchiveWorktreeDialog worktree={archivingWorktree} onOpenChange={(open) => { if (!open) setArchivingWorktree(null) }} />
      <AlertDialog open={archiveProject !== null} onOpenChange={(open) => { if (!open) setArchiveProject(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('sidebar.project.archiveAllTitle', { name: archiveProject?.project.name ?? '' })}</AlertDialogTitle>
            <AlertDialogDescription>{t('sidebar.project.archiveAllDescription', { count: archiveProject?.taskCount ?? 0 })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (archiveProject) onArchiveProjectTasks(archiveProject.project.id) }}>
              {t('sidebar.project.archiveAllConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {projects.length === 0 ? (
        <button
          type="button"
          className="flex h-[28px] w-full items-center rounded-[8px] px-2.5 text-left text-caption text-muted-foreground outline-none hover:bg-fill hover:text-foreground focus-visible:focus-ring"
          onClick={onAddProject}
        >
          {t('sidebar.projects.empty')}
        </button>
      ) : (
        <ul className="flex flex-col gap-px">
          {projects.map((navigation) => {
            const { project } = navigation
            const worktree = worktrees.get(project.id)
            const menuProps = {
              navigation, worktree, onStartProjectTask, onImportProject, onRevealProject, onPinProject, onRemoveProject,
              onNewWorktree: () => setWorktreeSource(project),
              onArchiveWorktree: () => { if (worktree) setArchivingWorktree(worktree) },
              onArchiveAll: () => setArchiveProject(navigation),
            }
            return (
              <li key={project.id}>
                <ContextMenu>
                  <ContextMenuTrigger asChild>
                    <div className="group/row relative grid min-h-[28px] grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-[8px] pr-1 pl-1.5 hover:bg-fill" data-project-row={project.id}>
                      {/* Codex/Finder: the whole row opens and closes the folder. */}
                      <button
                        type="button"
                        aria-expanded={navigation.expanded}
                        aria-label={t(
                          navigation.expanded ? 'sidebar.project.collapse' : 'sidebar.project.expand',
                          { name: project.name },
                        )}
                        onClick={() => onToggleProject(project.id, !navigation.expanded)}
                        className="absolute inset-0 rounded-[8px] outline-none focus-visible:focus-ring"
                      />
                      <span className="pointer-events-none relative flex min-w-0 items-center gap-1.5">
                        <span className="relative flex size-4 shrink-0 items-center justify-center text-muted-foreground" aria-hidden>
                          {worktree ? <TbGitBranch className="size-4 transition-opacity duration-(--duration-fast) group-hover/row:opacity-0" />
                            : <TbFolder className="size-4 transition-opacity duration-(--duration-fast) group-hover/row:opacity-0" />}
                          <TbChevronRight className={cn('absolute size-3.5 stroke-[2.4] opacity-0 transition-[opacity,transform] duration-(--duration-fast) group-hover/row:opacity-100', navigation.expanded && 'rotate-90')} />
                        </span>
                        <span className={cn('min-w-0 truncate text-app text-foreground/90', !project.available && 'opacity-55')} title={project.name} data-worktree-project={worktree ? worktree.branch : undefined}>
                          {worktree ? <>{worktree.name}<span className="ml-1.5 font-mono text-micro text-muted-foreground">{worktree.branch}</span></> : project.name}
                        </span>
                      </span>
                      <span className="relative flex h-[22px] min-w-[46px] items-center justify-end">
                        {!navigation.expanded && <span className={cn('flex items-center', HOVER_HIDE)}><ProjectIndicator indicator={navigation.indicator} /></span>}
                        <span className={cn('absolute inset-y-0 right-0 z-10 flex items-center gap-px', HOVER_REVEAL)}>
                          <SidebarIconButton label={t('sidebar.project.newSessionIn', { name: project.name })} disabled={!project.available}
                            onClick={() => onStartProjectTask(project.id)}>
                            <TbEdit className="size-3.5" aria-hidden />
                          </SidebarIconButton>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon-xs" aria-label={t('sidebar.project.actions', { name: project.name })}
                                className="size-[22px] rounded-[6px] text-muted-foreground hover:text-foreground">
                                <TbDots aria-hidden />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <ProjectMenuItems {...menuProps} kind="dropdown" />
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </span>
                      </span>
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ProjectMenuItems {...menuProps} kind="context" />
                  </ContextMenuContent>
                </ContextMenu>

                {navigation.expanded && (
                  <div className="mt-px mb-1 pl-[18px]">
                    <ProjectChildren
                      navigation={navigation}
                      activeSessionId={activeSessionId}
                      now={now}
                      actions={conversationActions}
                      onStartProjectTask={onStartProjectTask}
                      onLoadMore={onLoadMore}
                      onAddProject={onAddProject}
                      onRetryProject={(projectId) => onToggleProject(projectId, true)}
                    />
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </SidebarSection>
  )
}
