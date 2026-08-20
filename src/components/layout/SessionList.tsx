import * as React from 'react'
import {
  TbAlertCircle,
  TbCheck,
  TbChevronDown,
  TbChevronRight,
  TbCopy,
  TbDots,
  TbFolder,
  TbFolderOpen,
  TbFolderPlus,
  TbLoader2,
  TbMessage,
  TbMessagePlus,
  TbPencil,
  TbPin,
  TbPinnedOff,
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

export interface SidebarConversationItem {
  summary: OfficialPiSessionSummary
  loading?: boolean
  status?: AgentStatus
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

function StatusIndicator({
  loading = false,
  status,
}: {
  loading?: boolean
  status?: AgentStatus
}) {
  const t = useT()
  if (loading) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className="flex size-4 shrink-0 items-center justify-center"
            role="status"
            aria-label={t('sidebar.session.loading')}
          >
            <TbLoader2 className="size-3.5 animate-spin text-sage" aria-hidden />
          </span>
        </TooltipTrigger>
        <TooltipContent side="right">{t('sidebar.session.loading')}</TooltipContent>
      </Tooltip>
    )
  }
  if (!status || status === 'idle') return <span className="block size-4" aria-hidden />

  const icon = status === 'running' || status === 'planning'
    ? <TbLoader2 className="size-3.5 animate-spin text-sage" aria-hidden />
    : status === 'completed'
      ? <TbCheck className="size-3.5 text-sage" aria-hidden />
      : <TbAlertCircle className={cn(
          'size-3.5',
          status === 'failed' ? 'text-destructive' : 'text-muted-foreground',
        )} aria-hidden />

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="flex size-4 shrink-0 items-center justify-center"
          role="status"
          aria-label={t(statusLabelKey[status])}
        >
          {icon}
        </span>
      </TooltipTrigger>
      <TooltipContent side="right">{t(statusLabelKey[status])}</TooltipContent>
    </Tooltip>
  )
}

function conversationTitle(item: SidebarConversationItem, untitled: string) {
  return item.summary.name?.trim() || item.summary.preview.trim() || untitled
}

function ConversationRow({
  item,
  active,
  renaming,
  variant,
  onSelect,
  onRenameStart,
  onRenameCommit,
  onDuplicate,
  onDelete,
}: {
  item: SidebarConversationItem
  active: boolean
  renaming: boolean
  variant: ConversationListProps['variant']
} & Omit<ConversationListActions, 'renamingSelectionToken'>) {
  const t = useT()
  const title = conversationTitle(item, t('sidebar.session.untitled'))
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
    <li className="group/conversation relative">
      <div className={cn(
        'density-row relative grid grid-cols-[16px_minmax(0,1fr)_16px_32px] items-center gap-1 rounded-md px-2 transition-colors duration-(--duration-fast)',
        active
          ? 'bg-accent text-accent-foreground'
          : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
      )}>
        <TbMessage
          className={cn('size-3.5', variant === 'project' && 'opacity-55')}
          aria-hidden
        />

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
            disabled={item.loading}
            onClick={() => onSelect(item)}
            className="absolute inset-0 cursor-pointer rounded-md outline-none focus-visible:focus-ring disabled:cursor-wait"
          >
            <span className="sr-only">{title}</span>
          </button>
        )}

        {!renaming && (
          <span className="pointer-events-none relative z-10 truncate text-caption">
            {title}
          </span>
        )}

        <StatusIndicator loading={item.loading} status={item.status} />

        {!renaming ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('sidebar.session.actions')}
                disabled={item.loading}
                className={cn(
                  'relative z-10 opacity-0 group-hover/conversation:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100',
                  active && 'opacity-100',
                )}
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
        ) : <span className="block size-8" aria-hidden />}
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
    <ul className="flex flex-col gap-0.5">
      {items.map((item) => (
        <ConversationRow
          key={item.summary.selectionToken}
          item={item}
          active={item.summary.sessionId === activeSessionId}
          renaming={item.summary.selectionToken === renamingSelectionToken}
          variant={variant}
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
}

function ProjectChildren({
  navigation,
  activeSessionId,
  actions,
  onActivateProject,
  onStartProjectTask,
  onLoadMore,
  onAddProject,
}: {
  navigation: SidebarProjectNavigation
  activeSessionId: string
  actions: ConversationListActions
  onActivateProject(projectId: string): void
  onStartProjectTask(projectId: string): void
  onLoadMore(projectId: string): void
  onAddProject(): void
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
        <TbLoader2 className="size-3.5 animate-spin" aria-hidden />
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
      <p className="px-2 py-1 text-caption text-destructive" role="alert" title={catalog.message}>
        {t('sidebar.project.error')}
      </p>
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
          className="w-full rounded-sm px-2 py-1 text-left text-caption font-medium text-foreground outline-none transition-colors duration-(--duration-fast) hover:bg-accent/60 focus-visible:focus-ring"
          onClick={() => onStartProjectTask(project.id)}
        >
          {t('sidebar.project.startTask')}
        </button>
      )}
      {catalog.hasMore && (
        <button
          type="button"
          className="w-full rounded-sm px-2 py-1 text-left text-micro text-muted-foreground outline-none transition-colors duration-(--duration-fast) hover:bg-accent/60 hover:text-foreground focus-visible:focus-ring"
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
      <div className="density-row flex items-center justify-between px-2">
        <h2 id="sidebar-projects-heading" className="text-caption font-medium uppercase tracking-wide text-muted-foreground/75">
          {t('sidebar.projects')}
        </h2>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
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
        <ul className="flex flex-col gap-0.5">
          {projects.map((navigation) => {
            const { project } = navigation
            const active = project.id === activeProjectId
            return (
              <li key={project.id}>
                <div className="group/project density-row grid grid-cols-[16px_minmax(0,1fr)_32px] items-center gap-1 rounded-md px-2 transition-colors duration-(--duration-fast) hover:bg-accent/60">
                  <button
                    type="button"
                    aria-expanded={navigation.expanded}
                    aria-label={t(
                      navigation.expanded ? 'sidebar.project.collapse' : 'sidebar.project.expand',
                      { name: project.name },
                    )}
                    onClick={() => onToggleProject(project.id, !navigation.expanded)}
                    className="col-span-2 flex min-w-0 items-center gap-1.5 rounded-sm outline-none focus-visible:focus-ring"
                  >
                    {navigation.expanded
                      ? <TbChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                      : <TbChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
                    {navigation.expanded
                      ? <TbFolderOpen className="size-3.5 shrink-0" aria-hidden />
                      : <TbFolder className="size-3.5 shrink-0" aria-hidden />}
                    <span className={cn(
                      'truncate text-caption',
                      active ? 'font-medium text-foreground' : 'text-muted-foreground',
                      !project.available && 'opacity-55',
                    )} title={project.name}>
                      {project.name}
                    </span>
                  </button>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('sidebar.project.actions', { name: project.name })}
                        className="opacity-0 group-hover/project:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
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
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                {navigation.expanded && (
                  <div className="ml-5 border-l border-border/70 pl-1">
                    <ProjectChildren
                      navigation={navigation}
                      activeSessionId={active ? activeSessionId : ''}
                      actions={conversationActions}
                      onActivateProject={onActivateProject}
                      onStartProjectTask={onStartProjectTask}
                      onLoadMore={onLoadMore}
                      onAddProject={onAddProject}
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
    <section className="mt-3" aria-labelledby="sidebar-recent-heading">
      <h2 id="sidebar-recent-heading" className="density-row flex items-center px-2 text-caption font-medium uppercase tracking-wide text-muted-foreground/75">
        {t('sidebar.recent')}
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
