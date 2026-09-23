import * as React from 'react'
import { TbArchive, TbArrowsSort, TbLoader2, TbMessagePlus, TbPlus, TbSearch, TbX } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import { readProjectExpansionPreferences, writeProjectExpansionPreferences } from '@/renderer/layout-preferences'
import { readNavigationPreferences, taskOrganizationKey, taskScopeKey, updateTaskOrganization, writeNavigationPreferences } from '@/renderer/navigation-preferences'
import type { OfficialPiSessionSummary } from '@/shared/conversation-scope'
import type { WorkspaceSummary } from '@/shared/schemas/workspace'
import { usePiExtensionUi, usePiRuntime } from '@/store/pi-rpc'
import { useWorkspaceStore } from '@/store/workspace'
import { deriveSessionActivityState, isOfficialSessionActiveRow, runtimeStateForOfficialSession } from '@/store/workspace-state'
import { ConversationList, ProjectNavigationGroup, RecentChatGroup, type ConversationListActions, type SidebarConversationItem, type SidebarProjectNavigation } from '@/components/layout/SessionList'
import { isNewBackgroundResult, isSidebarSessionRunning, preferredProjectSession, presentPrioritySessions, presentSidebarSessions, sortSidebarProjects, type SidebarSessionFilter, type SidebarSessionSort } from '@/components/layout/session-navigation'
import { projectlessCatalogNeedsDiscovery, sessionCatalogLoadTargets } from './session-catalog-search'

const INITIAL_SESSION_LIMIT = 6
const SESSION_PAGE_SIZE = 10
const SESSION_SORT_PREFERENCE = 'pipilot.sidebar.sessionSort'

interface PendingProjectNavigation {
  projectId: string
  navigationRevision: number
}

export interface SessionsPanelProps {
  hidden?: boolean
  conversationReady: boolean
  navigationRevision: number
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
  onStartProjectTask(workspaceId: string): void
  onChooseWorkspace(): void
  onPinWorkspace(workspaceId: string, pinned: boolean): void
  onRemoveWorkspace(project: WorkspaceSummary): void
}

export function SessionsPanel({
  hidden = false, conversationReady, navigationRevision, renamingSelectionToken, deletingSelectionToken, isOpeningSessionRow,
  onSelect, onNewPrimary, onNewProjectless, onRenameStart, onRenameCommit, onDuplicate,
  onDelete, onStartProjectTask, onChooseWorkspace, onPinWorkspace, onRemoveWorkspace,
}: SessionsPanelProps) {
  const workspace = useWorkspaceStore()
  const pi = usePiRuntime()
  const extensionUi = usePiExtensionUi()
  const t = useT()
  const [query, setQuery] = React.useState('')
  const searchRef = React.useRef<HTMLInputElement>(null)
  const [sessionFilter, setSessionFilter] = React.useState<SidebarSessionFilter>('all')
  const [sessionSort, setSessionSort] = React.useState<SidebarSessionSort>(() => {
    try { return localStorage.getItem(SESSION_SORT_PREFERENCE) === 'name' ? 'name' : 'recent' } catch { return 'recent' }
  })
  const [preferences, setPreferences] = React.useState(readNavigationPreferences)
  const [projectExpansion, setProjectExpansion] = React.useState<ReadonlyMap<string, boolean>>(readProjectExpansionPreferences)
  const [projectSessionLimits, setProjectSessionLimits] = React.useState<Readonly<Record<string, number>>>({})
  const [pendingProject, setPendingProject] = React.useState<PendingProjectNavigation | null>(null)
  const catalogLoadsStarted = React.useRef(new Set<string>())
  const projectlessDiscoveryStarted = React.useRef(false)
  const knownProjectIds = React.useRef<ReadonlySet<string> | null>(null)
  const observedRunStatuses = React.useRef(new Map<string, SidebarConversationItem['status']>())
  const normalizedQuery = query.trim().toLowerCase()
  const filtering = normalizedQuery.length > 0 || sessionFilter !== 'all'
  const loadSessionCatalog = workspace.loadSessionCatalog
  const runtimeSessionStatuses = pi.runtime?.sessionStatuses
  const projectlessCatalogStatus = workspace.sessionCatalogs.projectless?.status
  const activeScopeKey = workspace.activeScope.kind === 'project' ? `project:${workspace.activeScope.workspaceId}` : 'projectless'

  // A later navigation intent must supersede a project catalog still loading.
  React.useEffect(() => setPendingProject(null), [activeScopeKey, navigationRevision, workspace.activeSessionId])

  React.useEffect(() => writeNavigationPreferences(preferences), [preferences])
  React.useEffect(() => writeProjectExpansionPreferences(projectExpansion), [projectExpansion])
  React.useEffect(() => {
    try { localStorage.setItem(SESSION_SORT_PREFERENCE, sessionSort) } catch { /* Presentation preferences are optional. */ }
  }, [sessionSort])

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
    setPendingProject((current) => current && removed.includes(current.projectId) ? null : current)
  }, [workspace.recentProjects])

  React.useEffect(() => {
    if (workspace.activeScope.kind !== 'project') return
    const id = workspace.activeScope.workspaceId
    setProjectExpansion((previous) => previous.has(id) ? previous : new Map(previous).set(id, true))
  }, [workspace.activeScope])

  // Running, pinned and unread work remains discoverable in collapsed projects.
  const importantProjectIds = React.useMemo(() => {
    const ids = new Set<string>()
    if (workspace.activeScope.kind === 'project') ids.add(workspace.activeScope.workspaceId)
    for (const status of runtimeSessionStatuses ?? []) {
      if (status.scope.kind === 'project') ids.add(status.scope.workspaceId)
    }
    for (const [key, organization] of Object.entries(preferences.tasks)) {
      if (!organization.pinned && !organization.unread) continue
      try {
        const scope = JSON.parse(key)[0] as unknown
        if (typeof scope === 'string' && scope.startsWith('project:')) ids.add(scope.slice(8))
      } catch { /* Invalid persisted keys cannot start catalog work. */ }
    }
    return ids
  }, [preferences.tasks, runtimeSessionStatuses, workspace.activeScope])

  React.useEffect(() => {
    if (workspace.mode !== 'electron') return
    const targets = sessionCatalogLoadTargets(workspace.recentProjects.map((project) => ({
      projectId: project.id, available: project.available,
      catalogStatus: workspace.sessionCatalogs[`project:${project.id}`]?.status,
    })), projectExpansion, filtering, importantProjectIds)
    for (const id of targets) startProjectCatalogLoad(id)
  }, [filtering, importantProjectIds, projectExpansion, startProjectCatalogLoad, workspace.mode, workspace.recentProjects, workspace.sessionCatalogs])

  React.useEffect(() => {
    if (projectlessDiscoveryStarted.current || !projectlessCatalogNeedsDiscovery(
      workspace.mode, workspace.activeScope.kind, projectlessCatalogStatus,
    )) return
    // Mark before dispatch to avoid repeat requests from render or Strict Mode.
    projectlessDiscoveryStarted.current = true
    void loadSessionCatalog({ kind: 'projectless' }).catch(() => undefined)
  }, [loadSessionCatalog, projectlessCatalogStatus, workspace.activeScope.kind, workspace.mode])

  const allItems = React.useMemo(() => {
    const items: SidebarConversationItem[] = []
    for (const catalog of Object.values(workspace.sessionCatalogs)) {
      for (const summary of catalog.rows) {
        const project = summary.scope.kind === 'project'
          ? workspace.recentProjects.find((project) => summary.scope.kind === 'project' && project.id === summary.scope.workspaceId)
          : undefined
        if (summary.scope.kind === 'project' && !project) continue
        const runtime = runtimeStateForOfficialSession(summary, runtimeSessionStatuses, catalog.rows)
        const active = isOfficialSessionActiveRow(summary, catalog.rows, workspace.activeScope, workspace.activeSessionId, runtime?.selected === true)
        const status = runtime?.status ?? (active ? pi.status : undefined)
        const opening = isOpeningSessionRow(summary, catalog.rows)
        const organizationKey = taskOrganizationKey(summary)
        items.push({
          summary, organizationKey, ...preferences.tasks[organizationKey],
          scopeLabel: project?.name ?? t('nav.redesign.general'),
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
    return items
  }, [deletingSelectionToken, extensionUi.dialog, isOpeningSessionRow, pi.runtime?.generation, pi.session?.pendingMessageCount, pi.status, preferences.tasks, runtimeSessionStatuses, t, workspace.activeScope, workspace.activeSessionId, workspace.recentProjects, workspace.sessionCatalogs])

  const selectTask = React.useCallback((item: SidebarConversationItem) => {
    setPendingProject(null)
    const key = taskOrganizationKey(item.summary)
    setPreferences((previous) => ({ ...previous, lastSelected: { ...previous.lastSelected, [taskScopeKey(item.summary)]: key } }))
    onSelect(item)
  }, [onSelect])

  React.useEffect(() => {
    if (hidden || !conversationReady) return
    const active = allItems.find((item) => item.selected && !item.loading)
    if (!active) return
    const scope = taskScopeKey(active.summary)
    const key = taskOrganizationKey(active.summary)
    setPreferences((previous) => {
      if (previous.lastSelected[scope] === key && !previous.tasks[key]?.unread) return previous
      const next = updateTaskOrganization(previous, active.summary, { unread: false })
      return { ...next, lastSelected: { ...next.lastSelected, [scope]: key } }
    })
  }, [allItems, conversationReady, hidden])

  React.useEffect(() => {
    const completed: SidebarConversationItem[] = []
    for (const item of allItems) {
      if (!item.status || !item.organizationKey) continue
      const previous = observedRunStatuses.current.get(item.organizationKey)
      observedRunStatuses.current.set(item.organizationKey, item.status)
      if (isNewBackgroundResult(item, previous)) completed.push(item)
    }
    if (completed.length) setPreferences((previous) => completed.reduce((next, item) =>
      updateTaskOrganization(next, item.summary, { unread: true }), previous))
  }, [allItems])

  const toggleProject = React.useCallback((id: string, expanded: boolean) => {
    setProjectExpansion((previous) => new Map(previous).set(id, expanded))
    if (!expanded) setPendingProject((current) => current?.projectId === id ? null : current)
    if (expanded) startProjectCatalogLoad(id, workspace.sessionCatalogs[`project:${id}`]?.status === 'error')
  }, [startProjectCatalogLoad, workspace.sessionCatalogs])

  const resumeProject = React.useCallback((id: string) => {
    setPendingProject(null)
    setProjectExpansion((previous) => new Map(previous).set(id, true))
    const catalog = workspace.sessionCatalogs[`project:${id}`]
    if (catalog?.status === 'ready' || catalog?.rows.length) {
      const next = preferredProjectSession(allItems.filter((item) => item.summary.scope.kind === 'project' && item.summary.scope.workspaceId === id), preferences.lastSelected[`project:${id}`])
      if (next && !next.disabled) selectTask(next)
      return
    }
    setPendingProject({ projectId: id, navigationRevision })
    startProjectCatalogLoad(id, true)
  }, [allItems, navigationRevision, preferences.lastSelected, selectTask, startProjectCatalogLoad, workspace.sessionCatalogs])

  React.useEffect(() => {
    if (!pendingProject) return
    if (pendingProject.navigationRevision !== navigationRevision) {
      setPendingProject(null)
      return
    }
    const { projectId } = pendingProject
    const catalog = workspace.sessionCatalogs[`project:${projectId}`]
    if (!catalog || catalog.status === 'loading') return
    if (catalog.status === 'ready') {
      const next = preferredProjectSession(allItems.filter((item) => item.summary.scope.kind === 'project' && item.summary.scope.workspaceId === projectId), preferences.lastSelected[`project:${projectId}`])
      if (next && !next.disabled) selectTask(next)
    }
    setPendingProject(null)
  }, [allItems, navigationRevision, pendingProject, preferences.lastSelected, selectTask, workspace.sessionCatalogs])

  const actions: ConversationListActions = {
    renamingSelectionToken, onSelect: selectTask, onRenameStart, onRenameCommit,
    onDuplicate: (item) => { setPendingProject(null); onDuplicate(item) }, onDelete,
    onPin: (item, pinned) => setPreferences((previous) => updateTaskOrganization(previous, item.summary, { pinned })),
    onArchive: (item, archived) => setPreferences((previous) => updateTaskOrganization(previous, item.summary, { archived })),
  }

  const projects = sortSidebarProjects(workspace.recentProjects, sessionSort).map((project): SidebarProjectNavigation => {
    const catalog = workspace.sessionCatalogs[`project:${project.id}`]
    const items = allItems.filter((item) => item.summary.scope.kind === 'project' && item.summary.scope.workspaceId === project.id)
    const presentation = presentSidebarSessions(items, {
      query: normalizedQuery, filter: sessionFilter, sort: sessionSort, projectName: project.name,
      limit: filtering ? undefined : projectSessionLimits[project.id] ?? INITIAL_SESSION_LIMIT,
    })
    return {
      project: { ...project, lastOpenedAt: new Date(project.lastOpenedAt).toISOString() },
      expanded: filtering || projectExpansion.get(project.id) === true,
      activeCount: items.filter(isSidebarSessionRunning).length,
      catalog: !catalog ? { status: 'idle' } : catalog.status === 'ready' || (catalog.status === 'loading' && catalog.rows.length > 0)
        ? { status: 'ready', items: presentation.items, hasMore: presentation.hasMore, loadedCount: presentation.matchingCount }
        : catalog.status === 'error' ? { status: 'error', message: catalog.errorMessage ?? undefined } : { status: catalog.status },
    }
  })
  const visibleProjects = filtering ? projects.filter(({ project, catalog }) =>
    (catalog.status === 'ready' && catalog.items.length > 0) ||
    (project.available && catalog.status !== 'ready' && catalog.status !== 'idle') ||
    (sessionFilter === 'all' && normalizedQuery && project.name.toLowerCase().includes(normalizedQuery))) : projects
  const recentChats = presentSidebarSessions(allItems.filter((item) => item.summary.scope.kind === 'projectless'), { query: normalizedQuery, filter: sessionFilter, sort: sessionSort }).items
  const focusItems = presentPrioritySessions(allItems)
  const recentCatalog = workspace.sessionCatalogs.projectless
  const recentUnavailable = workspace.mode !== 'electron' || recentCatalog?.status === 'unavailable' || recentCatalog?.status === 'activationUnavailable'
  const recentPending = !recentUnavailable && (!recentCatalog || recentCatalog.status === 'loading')
  const showRecentState = recentChats.length === 0 &&
    recentCatalog?.status !== 'ready' && recentCatalog?.status !== 'notLoaded'
  const searching = filtering && projects.some(({ catalog }) => catalog.status === 'loading')
  const activeProject = workspace.activeScope.kind === 'project' ? workspace.recentProjects.find((project) => workspace.activeScope.kind === 'project' && project.id === workspace.activeScope.workspaceId) : undefined
  const archivedCount = allItems.filter((item) => item.archived).length

  return (
    <div hidden={hidden} className="min-w-0 px-2.5 pb-5 pt-3" data-navigation="tasks">
      <div className="mb-3 flex items-center gap-1.5">
        <Button variant="secondary" className="h-9 min-w-0 flex-1 justify-start gap-2 rounded-lg text-caption font-medium" disabled={workspace.activeScope.kind === 'project' && !activeProject?.available} onClick={() => { setPendingProject(null); onNewPrimary() }}>
          <TbPlus className="size-4" aria-hidden />{t('nav.redesign.newTask')}
        </Button>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="size-9 shrink-0 text-muted-foreground"
              aria-label={t('sidebar.newProjectless')}
              onClick={() => { setPendingProject(null); onNewProjectless() }}>
              <TbMessagePlus className="size-4" aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('sidebar.newProjectless')}</TooltipContent>
        </Tooltip>
      </div>
      <div className="relative mb-2">
        <TbSearch className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') { setQuery(''); event.currentTarget.blur() }
          }}
          placeholder={t('nav.redesign.searchPlaceholder')}
          aria-label={t('sidebar.sessions.search')}
          title={t('nav.redesign.searchHint')} autoComplete="off"
          className="h-8 rounded-md border-transparent bg-accent/35 pl-8 pr-7 text-caption shadow-none focus-visible:bg-surface" />
        {query && (
          <Button variant="ghost" size="icon-xs"
            className="absolute right-0.5 top-1/2 size-6 -translate-y-1/2"
            aria-label={t('sidebar.sessions.clearSearch')}
            onClick={() => { setQuery(''); searchRef.current?.focus() }}>
            <TbX className="size-3.5" aria-hidden />
          </Button>
        )}
      </div>
      <div className="mb-3 flex items-center justify-between gap-0.5">
        <div role="group" aria-label={t('sidebar.sessions.filter')} className="flex min-w-0 gap-0.5">
          {(['all', 'running', 'attention'] as const).map((filter) => (
            <Button key={filter} variant="ghost" size="xs"
              className={cn('h-7 px-1.5 text-micro font-normal', sessionFilter === filter
                ? 'bg-selected font-medium text-foreground' : 'text-muted-foreground')}
              aria-pressed={sessionFilter === filter} onClick={() => setSessionFilter(filter)}>
              {t(filter === 'all' ? 'nav.redesign.tasks'
                : filter === 'running' ? 'nav.redesign.running' : 'nav.redesign.attention')}
            </Button>
          ))}
        </div>
        <div className="flex shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-xs"
                className={cn('size-7 text-muted-foreground', sessionFilter === 'archived' && 'bg-selected text-foreground')}
                aria-label={t('nav.redesign.archived')} aria-pressed={sessionFilter === 'archived'}
                onClick={() => setSessionFilter((current) => current === 'archived' ? 'all' : 'archived')}>
                <TbArchive className="size-3.5" aria-hidden />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('nav.redesign.archived')}</TooltipContent>
          </Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-xs" className="size-7 text-muted-foreground"
                aria-label={t('sidebar.sessions.sort')}>
                <TbArrowsSort className="size-3.5" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuRadioGroup value={sessionSort} onValueChange={(value) => {
                if (value === 'recent' || value === 'name') setSessionSort(value)
              }}>
                <DropdownMenuRadioItem value="recent">{t('sidebar.sessions.sortRecent')}</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="name">{t('sidebar.sessions.sortName')}</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {sessionFilter === 'archived' && <p className="mb-3 px-2 text-micro text-muted-foreground">{t('nav.redesign.archiveHint', { count: archivedCount })}</p>}
      {normalizedQuery && <p className="mb-2 px-2 text-micro text-muted-foreground">{t('nav.redesign.searchHint')}</p>}
      {searching && (
        <p role="status" className="mb-2 flex items-center gap-1.5 px-2 text-micro text-muted-foreground">
          <TbLoader2 className="size-3 animate-spin motion-reduce:animate-none" aria-hidden />
          {t('workbenchReview.sessions.searching')}
        </p>
      )}
      {!filtering && focusItems.length > 0 && (
        <section className="mb-4 rounded-lg border border-border/55 bg-surface/45 px-1 py-1.5" aria-labelledby="navigation-focus-heading">
          <h2 id="navigation-focus-heading" className="mb-1 px-2 py-1 text-micro font-medium text-muted-foreground">
            {t('nav.redesign.focus')}
          </h2>
          <ConversationList {...actions} items={focusItems} activeSessionId={workspace.activeSessionId} variant="focus" />
        </section>
      )}
      {filtering && visibleProjects.length === 0 && recentChats.length === 0 && !showRecentState ? (
        <div className="px-2 py-4">
          <p role="status" className="text-caption text-muted-foreground">
            {t(sessionFilter === 'archived' ? 'nav.redesign.archiveEmpty' : 'sidebar.sessions.empty')}
          </p>
          <Button variant="ghost" size="xs" className="mt-2" onClick={() => { setQuery(''); setSessionFilter('all') }}>
            {t('workbenchReview.sessions.reset')}
          </Button>
        </div>
      ) : (
        <>
          {(!filtering || visibleProjects.length > 0) && (
            <ProjectNavigationGroup {...actions} projects={visibleProjects}
              activeProjectId={workspace.activeScope.kind === 'project' ? workspace.activeScope.workspaceId : null}
              activeSessionId={workspace.activeSessionId}
              onAddProject={() => { setPendingProject(null); onChooseWorkspace() }}
              onToggleProject={toggleProject} onResumeProject={resumeProject}
              onStartProjectTask={(id) => { setPendingProject(null); onStartProjectTask(id) }}
              onLoadMore={(id) => setProjectSessionLimits((previous) => ({
                ...previous, [id]: (previous[id] ?? INITIAL_SESSION_LIMIT) + SESSION_PAGE_SIZE,
              }))}
              onPinProject={onPinWorkspace} onRemoveProject={onRemoveWorkspace} />
          )}
          {showRecentState ? (
            <section className="mt-4 px-2" aria-label={t('sidebar.generalChats')}>
              <h2 className="mb-2 text-micro font-medium text-muted-foreground">{t('sidebar.generalChats')}</h2>
              <div role={recentPending ? 'status' : 'alert'} className="flex items-center gap-2 text-caption text-muted-foreground">
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
            </section>
          ) : (!filtering || recentChats.length > 0) && (
            <RecentChatGroup {...actions} items={recentChats}
              activeSessionId={workspace.activeScope.kind === 'projectless' ? workspace.activeSessionId : ''} />
          )}
        </>
      )}
    </div>
  )
}
