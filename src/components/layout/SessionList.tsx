import * as React from 'react'
import {
  TbAlertCircle,
  TbCheck,
  TbChevronDown,
  TbChevronRight,
  TbClock,
  TbCopy,
  TbDots,
  TbFolder,
  TbFolderOpen,
  TbFolderPlus,
  TbLoader2,
  TbMessagePlus,
  TbPencil,
  TbPin,
  TbPinnedOff,
  TbPlus,
  TbTrash,
} from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import type {
  OfficialPiSessionSummary,
} from '@/shared/conversation-scope'
import type { WorkspaceSummary } from '@/shared/schemas/workspace'
import type { AgentStatus } from '@/types/chat'
import type { SessionActivityState } from '@/store/workspace-state'
import { sidebarConversationTitle } from './session-navigation'

export interface SidebarConversationItem {
  summary: OfficialPiSessionSummary
  loading?: boolean
  disabled?: boolean
  status?: AgentStatus
  activityState?: SessionActivityState
  selected?: boolean
}

export type SidebarProjectCatalog =
  | { status: 'idle' | 'loading' | 'notLoaded' | 'activationUnavailable' | 'unavailable' }
  | { status: 'error'; message?: string }
  | {
      status: 'ready'
      items: readonly SidebarConversationItem[]
      hasMore: boolean
      loadedCount?: number
    }

export interface SidebarProjectNavigation {
  project: WorkspaceSummary
  expanded: boolean
  catalog: SidebarProjectCatalog
}

export interface ConversationListActions {
  renamingSelectionToken: string | null
  onSelect(item: SidebarConversationItem): void
  onRenameStart(item: SidebarConversationItem): void
  onRenameCommit(item: SidebarConversationItem, title: string): void
  onDuplicate(item: SidebarConversationItem): void
  onDelete(item: SidebarConversationItem): void
}

interface ConversationListProps extends ConversationListActions {
  activeSessionId: string
  items: readonly SidebarConversationItem[]
  emptyLabel?: string
  variant: 'project' | 'recent'
}

const statusLabelKey = {
  idle: 'agent.status.idle',
  planning: 'agent.status.planning',
  running: 'agent.status.running',
  completed: 'agent.status.completed',
  failed: 'agent.status.failed',
  cancelled: 'agent.status.cancelled',
} as const

export type SidebarSessionIndicatorState =
  | 'loading'
  | 'waiting'
  | 'running'
  | 'completed'
  | 'failed'
  | 'released'

export function resolveSidebarSessionIndicatorState({
  loading = false,
  status,
  activityState,
}: {
  loading?: boolean
  status?: AgentStatus
  activityState?: SessionActivityState
}): SidebarSessionIndicatorState {
  if (loading || activityState === 'opening') return 'loading'
  if (activityState) return activityState
  if (status === 'planning' || status === 'running') return 'running'
  if (status === 'failed') return 'failed'
  if (status === 'idle' || status === 'completed' || status === 'cancelled') {
    return 'completed'
  }
  return 'released'
}

function StatusIndicator({
  loading = false,
  status,
  activityState,
}: {
  loading?: boolean
  status?: AgentStatus
  activityState?: SessionActivityState
}) {
  const t = useT()
  const indicatorState = resolveSidebarSessionIndicatorState({
    loading,
    status,
    activityState,
  })
  if (indicatorState === 'released') {
    return <span className="block size-5 shrink-0" aria-hidden />
  }

  const label = indicatorState === 'loading'
    ? t('sidebar.session.loading')
    : indicatorState === 'waiting'
      ? t('sidebar.session.waiting')
      : indicatorState === 'running'
        ? t(status === 'planning' ? statusLabelKey.planning : statusLabelKey.running)
        : indicatorState === 'completed'
          ? t(status === 'cancelled' ? statusLabelKey.cancelled : statusLabelKey.completed)
          : t(statusLabelKey.failed)

  const icon = indicatorState === 'loading' || indicatorState === 'running'
    ? <TbLoader2 className="size-3.5 animate-spin text-sage motion-reduce:animate-none" aria-hidden />
    : indicatorState === 'waiting'
      ? <TbClock className="size-3.5 text-warning" aria-hidden />
      : indicatorState === 'completed'
        ? <TbCheck className="size-3.5 text-success" aria-hidden />
        : <TbAlertCircle className="size-3.5 text-destructive" aria-hidden />

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="relative z-10 flex size-5 shrink-0 items-center justify-center"
          role="status"
          aria-label={label}
          data-session-indicator={indicatorState}
        >
          {icon}
        </span>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}

function ConversationRow({
  item,
  active,
  renaming,
  onSelect,
  onRenameStart,
  onRenameCommit,
  onDuplicate,
  onDelete,
}: {
  item: SidebarConversationItem
  active: boolean
  renaming: boolean
} & Omit<ConversationListActions, 'renamingSelectionToken'>) {
  const t = useT()
  const title = sidebarConversationTitle(item.summary, t('sidebar.session.untitled'))
  const [renameText, setRenameText] = React.useState(title)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const skipBlurCommit = React.useRef(false)

  React.useEffect(() => {
    if (!renaming) return
    setRenameText(title)
    requestAnimationFrame(() => inputRef.current?.select())
  }, [renaming, title])

  const cancelRename = () => {
    skipBlurCommit.current = true
    onRenameCommit(item, item.summary.name ?? '')
    inputRef.current?.blur()
  }

  return (
    <li className="group/conversation relative" data-session-activity={item.activityState}>
      <div className={cn(
        'relative grid min-h-8 grid-cols-[minmax(0,1fr)_20px_28px] items-center gap-1 rounded-lg pl-2.5 pr-1 transition-colors duration-(--duration-fast)',
        active
          ? 'bg-selected text-foreground'
          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
      )}>
        {renaming ? (
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
            className="z-10 min-w-0 rounded-sm border border-input bg-input px-1 py-0.5 text-caption text-foreground outline-none focus-visible:focus-ring"
          />
        ) : (
          <button
            type="button"
            aria-current={active ? 'page' : undefined}
            aria-label={title}
            title={title}
            disabled={item.loading || item.disabled}
            onClick={() => onSelect(item)}
            className="absolute inset-0 cursor-pointer rounded-lg outline-none focus-visible:focus-ring disabled:cursor-wait"
          >
            <span className="sr-only">{title}</span>
          </button>
        )}

        {!renaming && (
          <span className={cn(
            'pointer-events-none relative z-10 truncate text-app',
            active && 'font-medium',
          )}>
            {title}
          </span>
        )}

        <StatusIndicator
          loading={item.loading}
          status={item.status}
          activityState={item.activityState}
        />

        {!renaming ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={t('sidebar.session.actions')}
                disabled={item.loading || item.disabled}
                className={cn('relative z-10 size-7 opacity-0 group-hover/conversation:opacity-100 group-focus-within/conversation:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100', active && 'opacity-100')}
                onClick={(event) => event.stopPropagation()}
              >
                <TbDots aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onSelect={() => onRenameStart(item)}>
                <TbPencil aria-hidden />
                {t('sidebar.session.rename')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onDuplicate(item)}>
                <TbCopy aria-hidden />
                {t('sidebar.session.duplicate')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => onDelete(item)}
              >
                <TbTrash aria-hidden />
                {t('sidebar.session.delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : <span className="block size-6" aria-hidden />}
      </div>
    </li>
  )
}

export function ConversationList({
  items,
  activeSessionId,
  emptyLabel,
  variant,
  renamingSelectionToken,
  onSelect,
  onRenameStart,
  onRenameCommit,
  onDuplicate,
  onDelete,
}: ConversationListProps) {
  if (items.length === 0) {
    return emptyLabel
      ? <p className="px-2 py-1.5 text-caption text-muted-foreground">{emptyLabel}</p>
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
          onSelect={onSelect}
          onRenameStart={onRenameStart}
          onRenameCommit={onRenameCommit}
          onDuplicate={onDuplicate}
          onDelete={onDelete}
        />
      ))}
    </ul>
  )
}

export interface ProjectNavigationGroupProps extends ConversationListActions {
  activeProjectId: string | null
  activeSessionId: string
  projects: readonly SidebarProjectNavigation[]
  onAddProject(): void
  onToggleProject(projectId: string, expanded: boolean): void
  onActivateProject(projectId: string): void
  onStartProjectTask(projectId: string): void
  onLoadMore(projectId: string): void
  onPinProject(projectId: string, pinned: boolean): void
  onRemoveProject(project: WorkspaceSummary): void
}

function ProjectChildren({
  navigation,
  activeSessionId,
  actions,
  onActivateProject,
  onStartProjectTask,
  onLoadMore,
  onAddProject,
  onRetryProject,
}: {
  navigation: SidebarProjectNavigation
  activeSessionId: string
  actions: ConversationListActions
  onActivateProject(projectId: string): void
  onStartProjectTask(projectId: string): void
  onLoadMore(projectId: string): void
  onAddProject(): void
  onRetryProject(projectId: string): void
}) {
  const t = useT()
  const { project, catalog } = navigation

  if (!project.available) {
    return (
      <button
        type="button"
        className="w-full rounded-sm px-2 py-1 text-left text-caption text-muted-foreground outline-none transition-colors duration-(--duration-fast) hover:bg-accent/60 hover:text-foreground focus-visible:focus-ring"
        onClick={onAddProject}
      >
        {t('sidebar.project.reselect')}
      </button>
    )
  }

  if (catalog.status === 'idle') return null

  if (catalog.status === 'loading') {
    return (
      <p className="flex items-center gap-1.5 px-2 py-1 text-caption text-muted-foreground" role="status">
        <TbLoader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
        {t('sidebar.project.loading')}
      </p>
    )
  }

  if (catalog.status === 'notLoaded') {
    return (
      <button
        type="button"
        className="w-full rounded-sm px-2 py-1 text-left text-caption text-muted-foreground outline-none transition-colors duration-(--duration-fast) hover:bg-accent/60 hover:text-foreground focus-visible:focus-ring"
        onClick={() => onActivateProject(project.id)}
      >
        {t('sidebar.project.openToLoad')}
      </button>
    )
  }

  if (catalog.status === 'activationUnavailable' || catalog.status === 'unavailable') {
    return (
      <p className="px-2 py-1 text-caption text-muted-foreground" role="status">
        {t('sidebar.project.unavailable')}
      </p>
    )
  }

  if (catalog.status === 'error') {
    return (
      <div className="density-row flex items-center gap-1.5 px-2 text-caption" role="alert" title={catalog.message}>
        <TbAlertCircle className="size-3.5 shrink-0 text-destructive" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-destructive">
          {t('sidebar.project.error')}
        </span>
        <Button
          variant="ghost"
          size="xs"
          className="h-6 px-1.5"
          onClick={() => onRetryProject(project.id)}
        >
          {t('common.retry')}
        </Button>
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
        <ConversationList
          {...actions}
          items={scopedItems}
          activeSessionId={activeSessionId}
          variant="project"
        />
      ) : (
        <button
          type="button"
          className="density-row flex w-full items-center gap-1.5 rounded-sm px-2 text-left text-caption font-medium text-foreground outline-none transition-colors duration-(--duration-fast) hover:bg-accent/50 focus-visible:focus-ring"
          onClick={() => onStartProjectTask(project.id)}
        >
          <TbMessagePlus className="size-3.5" aria-hidden />
          {t('sidebar.project.startTask')}
        </button>
      )}
      {catalog.hasMore && (
        <button
          type="button"
          className="density-row w-full rounded-sm px-2 text-left text-micro text-muted-foreground outline-none transition-colors duration-(--duration-fast) hover:bg-accent/50 hover:text-foreground focus-visible:focus-ring"
          onClick={() => onLoadMore(project.id)}
        >
          {t('sidebar.project.showMore')}
        </button>
      )}
    </>
  )
}

export function ProjectNavigationGroup({
  projects,
  activeProjectId,
  activeSessionId,
  renamingSelectionToken,
  onAddProject,
  onToggleProject,
  onActivateProject,
  onStartProjectTask,
  onLoadMore,
  onPinProject,
  onRemoveProject,
  onSelect,
  onRenameStart,
  onRenameCommit,
  onDuplicate,
  onDelete,
}: ProjectNavigationGroupProps) {
  const t = useT()
  const conversationActions: ConversationListActions = {
    renamingSelectionToken,
    onSelect,
    onRenameStart,
    onRenameCommit,
    onDuplicate,
    onDelete,
  }

  return (
    <section aria-labelledby="sidebar-projects-heading">
      <div className="mb-1 flex min-h-8 items-center justify-between px-2">
        <h2 id="sidebar-projects-heading" className="text-micro font-medium tracking-wide text-muted-foreground">
          {t('sidebar.projects')}
        </h2>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              className="size-7 text-muted-foreground"
              aria-label={t('sidebar.addProject')}
              onClick={onAddProject}
            >
              <TbFolderPlus aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">{t('sidebar.addProject')}</TooltipContent>
        </Tooltip>
      </div>

      {projects.length === 0 ? (
        <button
          type="button"
          className="w-full rounded-md px-2 py-2 text-left text-caption text-muted-foreground outline-none transition-colors duration-(--duration-fast) hover:bg-accent/60 hover:text-foreground focus-visible:focus-ring"
          onClick={onAddProject}
        >
          {t('sidebar.projects.empty')}
        </button>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {projects.map((navigation) => {
            const { project } = navigation
            const active = project.id === activeProjectId
            return (
              <li key={project.id}>
                <div className="group/project grid min-h-8 grid-cols-[22px_minmax(0,1fr)_28px_28px] items-center gap-0.5 rounded-lg px-1 transition-colors duration-(--duration-fast) hover:bg-accent/45 focus-within:bg-accent/45">
                  <button
                    type="button"
                    aria-expanded={navigation.expanded}
                    aria-label={t(
                      navigation.expanded ? 'sidebar.project.collapse' : 'sidebar.project.expand',
                      { name: project.name },
                    )}
                    onClick={() => onToggleProject(project.id, !navigation.expanded)}
                    className="flex min-h-8 items-center justify-center rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:focus-ring"
                  >
                    {navigation.expanded
                      ? <TbChevronDown className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                      : <TbChevronRight className="size-3 shrink-0 text-muted-foreground" aria-hidden />}
                  </button>
                  <button
                    type="button"
                    aria-label={`${t('sidebar.project.open')}: ${project.name}`}
                    aria-current={active ? 'true' : undefined}
                    disabled={!project.available}
                    onClick={() => {
                      if (!navigation.expanded) onToggleProject(project.id, true)
                      onActivateProject(project.id)
                    }}
                    className="flex min-h-8 min-w-0 items-center gap-1.5 rounded-sm text-left outline-none focus-visible:focus-ring disabled:cursor-default"
                  >
                    {navigation.expanded
                      ? <TbFolderOpen className="size-3.5 shrink-0" aria-hidden />
                      : <TbFolder className="size-3.5 shrink-0" aria-hidden />}
                    <span className={cn(
                      'min-w-0 truncate text-caption font-medium',
                      active ? 'text-foreground' : 'text-muted-foreground',
                      !project.available && 'opacity-55',
                    )} title={project.name}>
                      {project.name}
                    </span>
                    {project.pinned ? <TbPin className="size-3 shrink-0 text-muted-foreground" aria-hidden /> : null}
                    {navigation.catalog.status === 'ready' && navigation.catalog.loadedCount !== undefined && (
                      <span
                        className="ml-auto shrink-0 pl-1 text-micro font-normal tabular-nums text-muted-foreground/70"
                        title={t('sidebar.sessions.loadedCount', { count: navigation.catalog.loadedCount })}
                        aria-label={t('sidebar.sessions.loadedCount', { count: navigation.catalog.loadedCount })}
                      >
                        {navigation.catalog.loadedCount}
                      </span>
                    )}
                  </button>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="size-7 text-muted-foreground/75 hover:text-foreground"
                        aria-label={t('sidebar.project.newSessionIn', { name: project.name })}
                        disabled={!project.available}
                        onClick={() => onStartProjectTask(project.id)}
                      >
                        <TbPlus className="size-3.5" aria-hidden />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="right">{t('sidebar.project.newSession')}</TooltipContent>
                  </Tooltip>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={t('sidebar.project.actions', { name: project.name })}
                        className="size-7 text-muted-foreground/75 hover:text-foreground data-[state=open]:text-foreground"
                      >
                        <TbDots aria-hidden />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      <DropdownMenuItem
                        disabled={!project.available}
                        onSelect={() => onStartProjectTask(project.id)}
                      >
                        <TbMessagePlus aria-hidden />
                        {t('sidebar.project.newSession')}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={!project.available}
                        onSelect={() => onActivateProject(project.id)}
                      >
                        <TbFolderOpen aria-hidden />
                        {t('sidebar.project.open')}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => onPinProject(project.id, !project.pinned)}>
                        {project.pinned ? <TbPinnedOff aria-hidden /> : <TbPin aria-hidden />}
                        {t(project.pinned
                          ? 'sidebar.workspace.unpinShort'
                          : 'sidebar.workspace.pinShort')}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => onRemoveProject(project)}
                      >
                        <TbTrash aria-hidden />
                        {t('sidebar.project.remove')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                {navigation.expanded && (
                  <div className="mb-1 ml-5 mt-0.5">
                    <ProjectChildren
                      navigation={navigation}
                      activeSessionId={active ? activeSessionId : ''}
                      actions={conversationActions}
                      onActivateProject={onActivateProject}
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
    </section>
  )
}

export interface RecentChatGroupProps extends ConversationListActions {
  activeSessionId: string
  items: readonly SidebarConversationItem[]
}

export function RecentChatGroup({
  items,
  activeSessionId,
  ...actions
}: RecentChatGroupProps) {
  const t = useT()
  const projectless = items.filter((item) => item.summary.scope.kind === 'projectless')

  return (
    <section className="mt-4" aria-labelledby="sidebar-recent-heading">
      <h2 id="sidebar-recent-heading" className="mb-1 flex min-h-8 items-center px-2 text-micro font-medium tracking-wide text-muted-foreground">
        {t('sidebar.generalChats')}
      </h2>
      <ConversationList
        {...actions}
        items={projectless}
        activeSessionId={activeSessionId}
        emptyLabel={t('sidebar.recent.empty')}
        variant="recent"
      />
    </section>
  )
}
