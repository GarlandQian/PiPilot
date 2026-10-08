import * as React from 'react'
import { TbAdjustmentsHorizontal, TbArchive, TbChevronLeft, TbEdit, TbFolderPlus, TbLoader2, TbMessageCircle, TbSearch } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Kbd } from '@/components/ui/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useT } from '@/i18n'
import { primaryShiftShortcut, primaryShortcut } from '@/lib/keyboard-shortcuts'
import { useMinuteClock } from '@/lib/relative-time'
import { cn } from '@/lib/utils'
import { readProjectExpansionPreferences, writeProjectExpansionPreferences } from '@/renderer/layout-preferences'
import { readNavigationPreferences, taskOrganizationKey, updateTaskOrganization, writeNavigationPreferences } from '@/renderer/navigation-preferences'
import type { ConversationScope, OfficialPiSessionSummary } from '@/shared/conversation-scope'
import type { WorkspaceSummary } from '@/shared/schemas/workspace'
import { usePiExtensionUi, usePiRuntime } from '@/store/pi-rpc'
import { conversationScopeKey, useWorkspaceStore } from '@/store/workspace'
import { useTaskNotifications } from '@/store/task-notifications'
import { createOfficialSessionLookup, deriveSessionActivityState } from '@/store/workspace-state'
import { ConversationList, ProjectNavigationGroup, SidebarIconButton, SidebarSection, type ConversationListActions, type SidebarConversationItem, type SidebarProjectNavigation } from '@/components/layout/SessionList'
import { presentPinnedSessions, presentSidebarSessions, sidebarProjectIndicator, sortSidebarProjects, type SidebarOrganization, type SidebarSessionSort } from '@/components/layout/session-navigation'
import { projectlessCatalogNeedsDiscovery, sessionCatalogLoadTargets } from './session-catalog-search'

/** Codex shows a handful of tasks per project before "Show more". */
const INITIAL_SESSION_LIMIT = 5
const SESSION_PAGE_SIZE = 10
const LIST_PAGE_SIZE = 20
const SESSION_SORT_PREFERENCE = 'pipilot.sidebar.sessionSort'
const ORGANIZATION_PREFERENCE = 'pipilot.sidebar.organization'

function readPreference<T extends string>(key: string, values: readonly T[], fallback: T): T {
  try {
    const value = localStorage.getItem(key)
    return values.find((candidate) => candidate === value) ?? fallback
  } catch { return fallback }
}

export interface SessionsPanelProps {
  onSearchAll?: () => void
  hidden?: boolean
  conversationReady: boolean
  renamingSelectionToken: string | null
  deletingSelectionToken: string | null
  isOpeningSessionRow(summary: OfficialPiSessionSummary, siblings: readonly OfficialPiSessionSummary[]): boolean
  onSelect(item: SidebarConversationItem): void
  onNewPrimary(): void
  onNewProjectless(): void
  onRenameStart(item: SidebarConversationItem): void
  onRenameCommit(item: SidebarConversationItem, title: string): void
  onDuplicate(item: SidebarConversationItem): void
  onDelete(item: SidebarConversationItem): void
  onExport(item: SidebarConversationItem): void
  onImport(scope: ConversationScope): void
  onStartProjectTask(workspaceId: string): void
  onChooseWorkspace(): void
  onPinWorkspace(workspaceId: string, pinned: boolean): void
  onRevealWorkspace(workspaceId: string): void
  onRemoveWorkspace(project: WorkspaceSummary): void
}

/** A sidebar navigation row (New task, Search), as at the top of Codex's sidebar. */
function NavigationRow({ icon, label, shortcut, disabled, onClick, children }: {
  icon: React.ReactNode
  label: string
  shortcut?: string
  disabled?: boolean
  onClick?: () => void
  children?: React.ReactNode
}) {
  return (
    <div className="group/row relative">
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" disabled={disabled} onClick={onClick}
            className="flex h-[30px] w-full items-center gap-2 rounded-[8px] px-2 text-left text-app text-foreground/90 outline-none hover:bg-fill focus-visible:focus-ring disabled:opacity-45 disabled:hover:bg-transparent">
            <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-[17px]" aria-hidden>{icon}</span>
            <span className="min-w-0 flex-1 truncate">{label}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" className="flex items-center gap-2">{label}{shortcut ? <Kbd>{shortcut}</Kbd> : null}</TooltipContent>
      </Tooltip>
      {children}
    </div>
  )
}

export function SessionsPanel({
  onSearchAll,
  hidden = false, conversationReady, renamingSelectionToken, deletingSelectionToken, isOpeningSessionRow,
  onSelect, onNewPrimary, onNewProjectless, onRenameStart, onRenameCommit, onDuplicate,
  onDelete, onExport, onImport, onStartProjectTask, onChooseWorkspace, onPinWorkspace, onRevealWorkspace, onRemoveWorkspace,
}: SessionsPanelProps) {
  const workspace = useWorkspaceStore()
  const pi = usePiRuntime()
  const extensionUi = usePiExtensionUi()
  const { snapshot: notifications, markRead } = useTaskNotifications()
  const t = useT()
  const now = useMinuteClock()
  const [view, setView] = React.useState<'tasks' | 'archived'>('tasks')
  const [organization, setOrganization] = React.useState<SidebarOrganization>(() =>
    readPreference(ORGANIZATION_PREFERENCE, ['project', 'chronological'], 'project'))
  const [sessionSort, setSessionSort] = React.useState<SidebarSessionSort>(() =>
    readPreference(SESSION_SORT_PREFERENCE, ['recent', 'created', 'name'], 'recent'))
  const [preferences, setPreferences] = React.useState(readNavigationPreferences)
  const [projectExpansion, setProjectExpansion] = React.useState<ReadonlyMap<string, boolean>>(readProjectExpansionPreferences)
  const [projectSessionLimits, setProjectSessionLimits] = React.useState<Readonly<Record<string, number>>>({})
  const [listLimit, setListLimit] = React.useState(LIST_PAGE_SIZE)
  const catalogLoadsStarted = React.useRef(new Set<string>())
  const projectlessDiscoveryStarted = React.useRef(false)
  const knownProjectIds = React.useRef<ReadonlySet<string> | null>(null)
  // One list and Archived both span every project, so every catalog loads.
  const loadAllCatalogs = organization === 'chronological' || view === 'archived'
  const loadSessionCatalog = workspace.loadSessionCatalog
  const runtimeSessionStatuses = pi.runtime?.sessionStatuses
  const projectlessCatalogStatus = workspace.sessionCatalogs.projectless?.status

  React.useEffect(() => writeNavigationPreferences(preferences), [preferences])
  React.useEffect(() => writeProjectExpansionPreferences(projectExpansion), [projectExpansion])
  React.useEffect(() => {
    try {
      localStorage.setItem(SESSION_SORT_PREFERENCE, sessionSort)
      localStorage.setItem(ORGANIZATION_PREFERENCE, organization)
    } catch { /* Presentation preferences are optional. */ }
  }, [organization, sessionSort])

  const startProjectCatalogLoad = React.useCallback((projectId: string, force = false) => {
    if (!force && catalogLoadsStarted.current.has(projectId)) return
    catalogLoadsStarted.current.add(projectId)
    void loadSessionCatalog({ kind: 'project', workspaceId: projectId }, force).catch(() => undefined)
  }, [loadSessionCatalog])

  React.useEffect(() => {
    const nextIds = new Set(workspace.recentProjects.map((project) => project.id))
    const removed = [...(knownProjectIds.current ?? [])].filter((id) => !nextIds.has(id))
    knownProjectIds.current = nextIds
    if (!removed.length) return
    setProjectExpansion((previous) => {
      const next = new Map(previous)
      for (const id of removed) next.delete(id)
      return next
    })
    setProjectSessionLimits((previous) => {
      const next = { ...previous }
      for (const id of removed) { delete next[id]; catalogLoadsStarted.current.delete(id) }
      return next
    })
  }, [workspace.recentProjects])

  React.useEffect(() => {
    if (workspace.activeScope.kind !== 'project') return
    const id = workspace.activeScope.workspaceId
    setProjectExpansion((previous) => previous.has(id) ? previous : new Map(previous).set(id, true))
  }, [workspace.activeScope])

  // Running, pinned and unread work stays visible from collapsed projects.
  const importantProjectIds = React.useMemo(() => {
    const ids = new Set<string>()
    if (workspace.activeScope.kind === 'project') ids.add(workspace.activeScope.workspaceId)
    for (const status of runtimeSessionStatuses ?? []) {
      if (status.scope.kind === 'project') ids.add(status.scope.workspaceId)
    }
    for (const notice of notifications.items) {
      if (!notice.read && notice.scope.kind === 'project') ids.add(notice.scope.workspaceId)
    }
    for (const [key, organization] of Object.entries(preferences.tasks)) {
      if (!organization.pinned && !organization.unread) continue
      try {
        const scope = JSON.parse(key)[0] as unknown
        if (typeof scope === 'string' && scope.startsWith('project:')) ids.add(scope.slice(8))
      } catch { /* Invalid persisted keys cannot start catalog work. */ }
    }
    return ids
  }, [notifications.items, preferences.tasks, runtimeSessionStatuses, workspace.activeScope])

  React.useEffect(() => {
    if (workspace.mode !== 'electron') return
    const targets = sessionCatalogLoadTargets(workspace.recentProjects.map((project) => ({
      projectId: project.id, available: project.available,
      catalogStatus: workspace.sessionCatalogs[`project:${project.id}`]?.status,
    })), projectExpansion, loadAllCatalogs, importantProjectIds)
    for (const id of targets) startProjectCatalogLoad(id)
  }, [importantProjectIds, loadAllCatalogs, projectExpansion, startProjectCatalogLoad, workspace.mode, workspace.recentProjects, workspace.sessionCatalogs])

  React.useEffect(() => {
    if (projectlessDiscoveryStarted.current || !projectlessCatalogNeedsDiscovery(
      workspace.mode, workspace.activeScope.kind, projectlessCatalogStatus,
    )) return
    // Mark before dispatch to avoid repeat requests from render or Strict Mode.
    projectlessDiscoveryStarted.current = true
    void loadSessionCatalog({ kind: 'projectless' }).catch(() => undefined)
  }, [loadSessionCatalog, projectlessCatalogStatus, workspace.activeScope.kind, workspace.mode])

  const { items: allItems, unreadNotices } = React.useMemo(() => {
    const items: SidebarConversationItem[] = []
    const unreadNotices = new Map<string, string[]>()
    const projects = new Map(workspace.recentProjects.map((project) => [project.id, project]))
    const unreadCatalogs = new Map<string, string[]>()
    const unreadSessions = new Map<string, string[]>()
    const identity = (scope: OfficialPiSessionSummary['scope'], id: string) => JSON.stringify([conversationScopeKey(scope), id])
    const remember = (map: Map<string, string[]>, key: string, id: string) => map.set(key, [...(map.get(key) ?? []), id])
    for (const notice of notifications.items) {
      if (notice.read) continue
      if (notice.catalogId) remember(unreadCatalogs, identity(notice.scope, notice.catalogId), notice.id)
      else remember(unreadSessions, identity(notice.scope, notice.sessionId), notice.id)
    }
    for (const catalog of Object.values(workspace.sessionCatalogs)) {
      const lookup = createOfficialSessionLookup(catalog.rows, runtimeSessionStatuses)
      for (const summary of catalog.rows) {
        const project = summary.scope.kind === 'project'
          ? projects.get(summary.scope.workspaceId)
          : undefined
        if (summary.scope.kind === 'project' && !project) continue
        const runtime = lookup.runtime(summary)
        const active = lookup.active(summary, workspace.activeScope, workspace.activeSessionId, runtime?.selected === true)
        const status = runtime?.status ?? (active ? pi.status : undefined)
        const opening = isOpeningSessionRow(summary, catalog.rows)
        const organizationKey = taskOrganizationKey(summary)
        // Main owns unread results across background work and reloads; "Mark as unread" adds a local flag.
        const notices = [
          ...(summary.catalogId ? unreadCatalogs.get(identity(summary.scope, summary.catalogId)) ?? [] : []),
          ...(lookup.isUnique(summary) ? unreadSessions.get(identity(summary.scope, summary.sessionId)) ?? [] : []),
        ]
        if (notices.length) unreadNotices.set(organizationKey, notices)
        items.push({
          summary, organizationKey, ...preferences.tasks[organizationKey],
          unread: notices.length > 0 || preferences.tasks[organizationKey]?.unread === true,
          scopeLabel: project?.name ?? t('sidebar.generalChats'),
          loading: opening,
          disabled: opening || summary.selectionToken === deletingSelectionToken || project?.available === false,
          selected: active || opening,
          status,
          needsAttention: !opening && (runtime?.needsUserInput === true || (active &&
            extensionUi.dialog?.sessionId === summary.sessionId &&
            extensionUi.dialog.generation === pi.runtime?.generation)),
          activityState: deriveSessionActivityState({ opening, status, pendingMessageCount: active
            ? pi.session?.pendingMessageCount ?? runtime?.pendingMessageCount ?? 0 : runtime?.pendingMessageCount ?? 0 }),
        })
      }
    }
    return { items, unreadNotices }
  }, [deletingSelectionToken, extensionUi.dialog, isOpeningSessionRow, notifications.items, pi.runtime?.generation, pi.session?.pendingMessageCount, pi.status, preferences.tasks, runtimeSessionStatuses, t, workspace.activeScope, workspace.activeSessionId, workspace.recentProjects, workspace.sessionCatalogs])

  // Opening a task reads it.
  React.useEffect(() => {
    if (hidden || !conversationReady) return
    const active = allItems.find((item) => item.selected && !item.loading)
    if (!active || !preferences.tasks[taskOrganizationKey(active.summary)]?.unread) return
    setPreferences((previous) => updateTaskOrganization(previous, active.summary, { unread: false }))
  }, [allItems, conversationReady, hidden, preferences.tasks])

  const toggleProject = React.useCallback((id: string, expanded: boolean) => {
    setProjectExpansion((previous) => new Map(previous).set(id, expanded))
    if (expanded) startProjectCatalogLoad(id, workspace.sessionCatalogs[`project:${id}`]?.status === 'error')
  }, [startProjectCatalogLoad, workspace.sessionCatalogs])

  const organize = (item: SidebarConversationItem, patch: Parameters<typeof updateTaskOrganization>[2]) =>
    setPreferences((previous) => updateTaskOrganization(previous, item.summary, patch))
  const actions: ConversationListActions = {
    renamingSelectionToken, onSelect, onRenameStart, onRenameCommit, onDuplicate, onDelete, onExport,
    onPin: (item, pinned) => organize(item, { pinned }),
    onArchive: (item, archived) => organize(item, { archived, ...(archived ? { pinned: false } : {}) }),
    onMarkUnread: (item, unread) => {
      organize(item, { unread })
      if (!unread) for (const id of unreadNotices.get(taskOrganizationKey(item.summary)) ?? []) markRead(id)
    },
  }

  const archiveProjectTasks = (projectId: string) => setPreferences((previous) => allItems
    .filter((item) => item.summary.scope.kind === 'project' && item.summary.scope.workspaceId === projectId && !item.archived)
    .reduce((next, item) => updateTaskOrganization(next, item.summary, { archived: true, pinned: false }), previous))

  const projects = sortSidebarProjects(workspace.recentProjects, sessionSort).map((project): SidebarProjectNavigation => {
    const catalog = workspace.sessionCatalogs[`project:${project.id}`]
    const items = allItems.filter((item) => item.summary.scope.kind === 'project' && item.summary.scope.workspaceId === project.id)
    const presentation = presentSidebarSessions(items, {
      query: '', filter: 'all', sort: sessionSort, projectName: project.name,
      limit: projectSessionLimits[project.id] ?? INITIAL_SESSION_LIMIT,
    })
    return {
      project: { ...project, lastOpenedAt: new Date(project.lastOpenedAt).toISOString() },
      expanded: projectExpansion.get(project.id) === true,
      indicator: sidebarProjectIndicator(items.filter((item) => !item.pinned)),
      taskCount: items.filter((item) => !item.archived).length,
      catalog: !catalog ? { status: 'idle' } : catalog.status === 'ready' || (catalog.status === 'loading' && catalog.rows.length > 0)
        ? { status: 'ready', items: presentation.items, hasMore: presentation.hasMore }
        : catalog.status === 'error' ? { status: 'error', message: catalog.errorMessage ?? undefined } : { status: catalog.status },
    }
  })
  const pinnedItems = presentPinnedSessions(allItems, sessionSort)
  const chats = presentSidebarSessions(allItems.filter((item) => item.summary.scope.kind === 'projectless'), {
    query: '', filter: 'all', sort: sessionSort, limit: listLimit,
  })
  const timeline = presentSidebarSessions(allItems, { query: '', filter: 'all', sort: sessionSort, limit: listLimit })
  const archived = presentSidebarSessions(allItems, { query: '', filter: 'archived', sort: sessionSort })
  const catalogsLoading = Object.values(workspace.sessionCatalogs).some((catalog) => catalog.status === 'loading')
  const recentCatalog = workspace.sessionCatalogs.projectless
  const recentUnavailable = workspace.mode !== 'electron' || recentCatalog?.status === 'unavailable' || recentCatalog?.status === 'activationUnavailable'
  const recentPending = !recentUnavailable && (!recentCatalog || recentCatalog.status === 'loading')
  const showRecentState = chats.items.length === 0 &&
    recentCatalog?.status !== 'ready' && recentCatalog?.status !== 'notLoaded'
  const activeProject = workspace.activeScope.kind === 'project' ? workspace.recentProjects.find((project) => workspace.activeScope.kind === 'project' && project.id === workspace.activeScope.workspaceId) : undefined
  const archivedCount = allItems.filter((item) => item.archived).length
  const activeSessionId = workspace.activeSessionId ?? ''

  const organizeMenu = (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-xs" aria-label={t('sidebar.organize')}
              className={cn('size-[22px] rounded-[6px] text-muted-foreground hover:text-foreground', (organization !== 'project' || sessionSort !== 'recent') && 'text-primary')}>
              <TbAdjustmentsHorizontal className="size-3.5" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t('sidebar.organize')}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-[220px]">
        <DropdownMenuLabel>{t('sidebar.organize.title')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={organization} onValueChange={(value) => {
          if (value === 'project' || value === 'chronological') { setOrganization(value); setListLimit(LIST_PAGE_SIZE) }
        }}>
          <DropdownMenuRadioItem value="project">{t('sidebar.organize.byProject')}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="chronological">{t('sidebar.organize.oneList')}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{t('sidebar.sessions.sort')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={sessionSort} onValueChange={(value) => {
          if (value === 'recent' || value === 'created' || value === 'name') setSessionSort(value)
        }}>
          <DropdownMenuRadioItem value="recent">{t('sidebar.sessions.sortRecent')}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="created">{t('sidebar.sessions.sortCreated')}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="name">{t('sidebar.sessions.sortName')}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setView('archived')}>
          <TbArchive aria-hidden />{t('nav.redesign.archived')}
          {archivedCount > 0 && <span className="ml-auto pl-4 text-caption tabular-nums text-muted-foreground">{archivedCount}</span>}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
  const addProject = (
    <SidebarIconButton label={t('sidebar.addProject')} onClick={onChooseWorkspace}>
      <TbFolderPlus className="size-3.5" aria-hidden />
    </SidebarIconButton>
  )
  const newChat = (
    <SidebarIconButton label={t('sidebar.newProjectless')} onClick={onNewProjectless}>
      <TbEdit className="size-3.5" aria-hidden />
    </SidebarIconButton>
  )

  if (view === 'archived') {
    return (
      <div hidden={hidden} className="min-w-0 px-2.5 pb-4 pt-0.5" data-navigation="archived">
        <button type="button" onClick={() => setView('tasks')}
          className="mb-2 flex h-[30px] w-full items-center gap-1 rounded-[8px] px-1.5 text-left text-app font-semibold text-foreground outline-none hover:bg-fill focus-visible:focus-ring">
          <TbChevronLeft className="size-4 text-muted-foreground" aria-hidden />
          {t('nav.redesign.archived')}
        </button>
        {catalogsLoading && (
          <p role="status" className="mb-2 flex items-center gap-1.5 px-2.5 text-micro text-muted-foreground">
            <TbLoader2 className="size-3 animate-spin motion-reduce:animate-none" aria-hidden />
            {t('sidebar.project.loading')}
          </p>
        )}
        <ConversationList {...actions} items={archived.items} activeSessionId={activeSessionId} now={now}
          variant="archived" emptyLabel={catalogsLoading ? undefined : t('nav.redesign.archiveEmpty')} />
      </div>
    )
  }

  return (
    <div hidden={hidden} className="min-w-0 px-2.5 pb-4 pt-0.5" data-navigation="tasks">
      <nav aria-label={t('sidebar.nav')} className="mb-3 flex flex-col gap-px">
        <NavigationRow icon={<TbEdit />} label={t('nav.redesign.newTask')} shortcut={primaryShortcut('N')}
          disabled={workspace.activeScope.kind === 'project' && !activeProject?.available}
          onClick={onNewPrimary}>
          {/* Codex: a chat outside any project sits on the right of New chat. */}
          <span className="absolute inset-y-0 right-1 flex items-center opacity-0 group-hover/row:opacity-100 group-has-[:focus-visible]/row:opacity-100">
            <SidebarIconButton label={t('sidebar.quickChat')} onClick={onNewProjectless}>
              <TbMessageCircle className="size-3.5" aria-hidden />
            </SidebarIconButton>
          </span>
        </NavigationRow>
        {onSearchAll && <NavigationRow icon={<TbSearch />} label={t('sidebar.search')} shortcut={primaryShiftShortcut('F')} onClick={onSearchAll} />}
      </nav>

      {pinnedItems.length > 0 && (
        <SidebarSection id="sidebar-pinned-heading" title={t('nav.redesign.pinned')} className="mb-3">
          <ConversationList {...actions} items={pinnedItems} activeSessionId={activeSessionId} now={now} variant="pinned" />
        </SidebarSection>
      )}

      {organization === 'chronological' ? (
        <SidebarSection id="sidebar-tasks-heading" title={t('nav.redesign.tasks')} actions={<>{organizeMenu}{addProject}</>}>
          {catalogsLoading && timeline.items.length === 0 ? (
            <p role="status" className="flex h-[28px] items-center gap-1.5 px-2.5 text-caption text-muted-foreground">
              <TbLoader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
              {t('sidebar.project.loading')}
            </p>
          ) : (
            <ConversationList {...actions} items={timeline.items} activeSessionId={activeSessionId} now={now}
              variant="timeline" emptyLabel={t('sidebar.sessions.empty')} />
          )}
          {timeline.hasMore && (
            <button type="button" onClick={() => setListLimit((limit) => limit + LIST_PAGE_SIZE)}
              className="flex h-[28px] w-full items-center rounded-[8px] px-2.5 text-left text-micro text-muted-foreground outline-none hover:bg-fill hover:text-foreground focus-visible:focus-ring">
              {t('sidebar.project.showMore')}
            </button>
          )}
        </SidebarSection>
      ) : (
        <>
          <ProjectNavigationGroup {...actions} projects={projects} now={now}
            activeSessionId={workspace.activeScope.kind === 'project' ? activeSessionId : ''}
            headerActions={<>{organizeMenu}{addProject}</>}
            onAddProject={onChooseWorkspace}
            onToggleProject={toggleProject}
            onStartProjectTask={onStartProjectTask}
            onImportProject={(workspaceId) => onImport({ kind: 'project', workspaceId })}
            onRevealProject={onRevealWorkspace}
            onLoadMore={(id) => setProjectSessionLimits((previous) => ({
              ...previous, [id]: (previous[id] ?? INITIAL_SESSION_LIMIT) + SESSION_PAGE_SIZE,
            }))}
            onPinProject={onPinWorkspace} onArchiveProjectTasks={archiveProjectTasks} onRemoveProject={onRemoveWorkspace} />
          <SidebarSection id="sidebar-recent-heading" title={t('sidebar.generalChats')} actions={newChat} className="mt-3">
            {showRecentState ? (
              <div role={recentPending ? 'status' : 'alert'} className="flex h-[28px] items-center gap-2 px-2.5 text-caption text-muted-foreground">
                {recentPending && <TbLoader2 className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />}
                <span className="min-w-0 flex-1">
                  {t(recentPending ? 'workbenchReview.sessions.loading'
                    : recentUnavailable ? 'workbenchReview.sessions.unavailable' : 'workbenchReview.sessions.failed')}
                </span>
                {!recentPending && !recentUnavailable && (
                  <Button variant="ghost" size="xs" onClick={() => {
                    void loadSessionCatalog({ kind: 'projectless' }, true).catch(() => undefined)
                  }}>{t('common.retry')}</Button>
                )}
              </div>
            ) : (
              <ConversationList {...actions} items={chats.items} now={now} variant="recent"
                activeSessionId={workspace.activeScope.kind === 'projectless' ? activeSessionId : ''} />
            )}
            {chats.hasMore && (
              <button type="button" onClick={() => setListLimit((limit) => limit + LIST_PAGE_SIZE)}
                className="flex h-[28px] w-full items-center rounded-[8px] px-2.5 text-left text-micro text-muted-foreground outline-none hover:bg-fill hover:text-foreground focus-visible:focus-ring">
                {t('sidebar.project.showMore')}
              </button>
            )}
          </SidebarSection>
        </>
      )}
    </div>
  )
}
