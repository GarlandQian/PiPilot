import * as React from 'react'
import { TbArrowsSort, TbLoader2, TbMessagePlus, TbPlus, TbSearch, TbX } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import {
  readProjectExpansionPreferences,
  writeProjectExpansionPreferences,
} from '@/renderer/layout-preferences'
import type {
  ConversationScope,
  OfficialPiSessionSummary,
} from '@/shared/conversation-scope'
import type { WorkspaceSummary } from '@/shared/schemas/workspace'
import { usePiRuntime } from '@/store/pi-rpc'
import { conversationScopeKey, useWorkspaceStore } from '@/store/workspace'
import {
  deriveSessionActivityState,
  isOfficialSessionActiveRow,
  runtimeStateForOfficialSession,
} from '@/store/workspace-state'
import {
  ProjectNavigationGroup,
  RecentChatGroup,
  type SidebarConversationItem,
  type SidebarProjectNavigation,
} from '@/components/layout/SessionList'
import {
  presentSidebarSessions,
  sortSidebarProjects,
  type SidebarSessionFilter,
  type SidebarSessionSort,
} from '@/components/layout/session-navigation'
import { sessionCatalogLoadTargets } from './session-catalog-search'

const INITIAL_SESSION_LIMIT = 6
const SESSION_PAGE_SIZE = 10

const SESSION_SORT_PREFERENCE = 'pipilot.sidebar.sessionSort'

export interface SessionsPanelProps {
  /**
    * Keeps the panel mounted while visually hidden so project expansion and
   * pagination state survive workspace switches.
   */
  hidden?: boolean
  renamingSelectionToken: string | null
  deletingSelectionToken: string | null
  isOpeningSessionRow: (
    summary: OfficialPiSessionSummary,
    siblings: readonly OfficialPiSessionSummary[],
  ) => boolean
  onSelect(item: SidebarConversationItem): void
  onNewPrimary(): void
  onNewProjectless(): void
  onRenameStart(item: SidebarConversationItem): void
  onRenameCommit(item: SidebarConversationItem, title: string): void
  onDuplicate(item: SidebarConversationItem): void
  onDelete(item: SidebarConversationItem): void
  onActivateProject(workspaceId: string): void
  onStartProjectTask(workspaceId: string): void
  onChooseWorkspace(): void
  onPinWorkspace(workspaceId: string, pinned: boolean): void
  onRemoveWorkspace(project: WorkspaceSummary): void
}

function NewConversationControl({
  activeScope,
  projects,
  onNewPrimary,
  onNewProjectless,
}: {
  activeScope: ConversationScope
  projects: readonly SidebarProjectNavigation[]
  onNewPrimary(): void
  onNewProjectless(): void
}) {
  const t = useT()
  const activeProject = activeScope.kind === 'project'
    ? projects.find(({ project }) => project.id === activeScope.workspaceId)
    : undefined
  const primaryIsProjectTask = activeScope.kind === 'project'
  const primaryDisabled = primaryIsProjectTask && !activeProject?.project.available
  const primaryLabel = t(primaryIsProjectTask
    ? 'sidebar.newProjectTask'
    : 'sidebar.newProjectless')

  return (
    <div className="flex w-full gap-1">
      <Button
        variant="ghost"
        className="h-(--control-h) min-w-0 flex-1 justify-start bg-surface text-foreground hover:bg-accent"
        disabled={primaryDisabled}
        onClick={onNewPrimary}
      >
        <TbPlus aria-hidden />
        <span className="truncate">{primaryLabel}</span>
      </Button>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-(--control-h) bg-surface text-muted-foreground"
            aria-label={t('sidebar.quickChat')}
            onClick={onNewProjectless}
          >
            <TbMessagePlus aria-hidden />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">{t('sidebar.quickChat')}</TooltipContent>
      </Tooltip>
    </div>
  )
}

export function SessionsPanel({
  hidden = false,
  renamingSelectionToken,
  deletingSelectionToken,
  isOpeningSessionRow,
  onSelect,
  onNewPrimary,
  onNewProjectless,
  onRenameStart,
  onRenameCommit,
  onDuplicate,
  onDelete,
  onActivateProject,
  onStartProjectTask,
  onChooseWorkspace,
  onPinWorkspace,
  onRemoveWorkspace,
}: SessionsPanelProps) {
  const workspace = useWorkspaceStore()
  const pi = usePiRuntime()
  const runtimeSessionStatuses = pi.runtime?.sessionStatuses
  const t = useT()
  const [query, setQuery] = React.useState('')
  const searchRef = React.useRef<HTMLInputElement>(null)
  const [sessionFilter, setSessionFilter] = React.useState<SidebarSessionFilter>('all')
  const [sessionSort, setSessionSort] = React.useState<SidebarSessionSort>(() => {
    try {
      return localStorage.getItem(SESSION_SORT_PREFERENCE) === 'name' ? 'name' : 'recent'
    } catch {
      return 'recent'
    }
  })
  const normalizedQuery = query.trim().toLowerCase()
  const filtering = normalizedQuery.length > 0 || sessionFilter !== 'all'
  const [projectExpansion, setProjectExpansion] = React.useState<ReadonlyMap<string, boolean>>(
    () => readProjectExpansionPreferences(),
  )
  const [projectSessionLimits, setProjectSessionLimits] = React.useState<
    Readonly<Record<string, number>>
  >({})
  const catalogLoadsStarted = React.useRef(new Set<string>())
  const knownProjectIds = React.useRef<ReadonlySet<string> | null>(null)
  const loadSessionCatalog = workspace.loadSessionCatalog

  React.useEffect(() => {
    try {
      localStorage.setItem(SESSION_SORT_PREFERENCE, sessionSort)
    } catch {
      // Sorting remains available when presentation preferences cannot persist.
    }
  }, [sessionSort])

  const startProjectCatalogLoad = React.useCallback((
    projectId: string,
    force = false,
  ) => {
    const scope: ConversationScope = { kind: 'project', workspaceId: projectId }
    const key = conversationScopeKey(scope)
    if (!force && catalogLoadsStarted.current.has(key)) return

    // Mark before dispatch so React Strict Mode or a nearby state update
    // cannot start a duplicate request before WorkspaceProvider publishes the
    // scoped loading state. A pointer-triggered expansion may force a retry.
    catalogLoadsStarted.current.add(key)
    void loadSessionCatalog(scope).catch(() => {
      // WorkspaceProvider owns the scoped error transition. The marker stays
      // consumed for automatic loading; another manual expansion may retry.
    })
  }, [loadSessionCatalog])

  React.useEffect(() => {
    writeProjectExpansionPreferences(projectExpansion)
  }, [projectExpansion])

  React.useEffect(() => {
    const nextProjectIds = new Set(workspace.recentProjects.map((project) => project.id))
    const previousProjectIds = knownProjectIds.current
    knownProjectIds.current = nextProjectIds
    if (!previousProjectIds) return

    const removedProjectIds = [...previousProjectIds].filter((id) => !nextProjectIds.has(id))
    if (removedProjectIds.length === 0) return

    setProjectExpansion((previous) => {
      const next = new Map(previous)
      for (const projectId of removedProjectIds) next.delete(projectId)
      return next.size === previous.size ? previous : next
    })
    setProjectSessionLimits((previous) => {
      const next = { ...previous }
      let changed = false
      for (const projectId of removedProjectIds) {
        if (projectId in next) {
          delete next[projectId]
          changed = true
        }
        catalogLoadsStarted.current.delete(conversationScopeKey({
          kind: 'project',
          workspaceId: projectId,
        }))
      }
      return changed ? next : previous
    })
  }, [workspace.recentProjects])

  React.useEffect(() => {
    if (workspace.activeScope.kind !== 'project') return
    const projectId = workspace.activeScope.workspaceId
    setProjectExpansion((previous) => {
      // A project with no preference opens on first activation. Once the user
      // explicitly expands or collapses it, that choice remains authoritative
      // across scope switches and application restarts.
      if (previous.has(projectId)) return previous
      const next = new Map(previous)
      next.set(projectId, true)
      return next
    })
  }, [workspace.activeScope])

  const expandedProjectsWithoutCatalog = React.useMemo(() =>
    sessionCatalogLoadTargets(
      workspace.recentProjects.map((project) => ({
        projectId: project.id,
        available: project.available,
        catalogStatus: workspace.sessionCatalogs[conversationScopeKey({
          kind: 'project',
          workspaceId: project.id,
        })]?.status,
      })),
      projectExpansion,
      filtering,
    ), [filtering, projectExpansion, workspace.recentProjects, workspace.sessionCatalogs])

  React.useEffect(() => {
    if (workspace.mode !== 'electron') return

    for (const projectId of expandedProjectsWithoutCatalog) {
      startProjectCatalogLoad(projectId)
    }
  }, [expandedProjectsWithoutCatalog, startProjectCatalogLoad, workspace.mode])

  const sidebarProjects = React.useMemo<SidebarProjectNavigation[]>(() =>
    sortSidebarProjects(workspace.recentProjects, sessionSort).map((project) => {
      const scope: ConversationScope = { kind: 'project', workspaceId: project.id }
      const catalog = workspace.sessionCatalogs[conversationScopeKey(scope)]
      const expandedByPreference = projectExpansion.get(project.id) === true
      const expanded = filtering || expandedByPreference
      const limit = projectSessionLimits[project.id] ?? INITIAL_SESSION_LIMIT
      const rows = catalog?.rows ?? []
      const mappedItems = rows.map((summary): SidebarConversationItem => {
        const runtimeState = runtimeStateForOfficialSession(
          summary,
          runtimeSessionStatuses,
          rows,
        )
        const isActive = isOfficialSessionActiveRow(
          summary,
          rows,
          workspace.activeScope,
          workspace.activeSessionId,
          runtimeState?.selected === true,
        )
        const status = runtimeState?.status ?? (isActive ? pi.status : undefined)
        const opening = isOpeningSessionRow(summary, rows)
        const deleting = summary.selectionToken === deletingSelectionToken
        const activityState = deriveSessionActivityState({
          opening,
          status,
          pendingMessageCount: isActive
            ? pi.session?.pendingMessageCount ?? runtimeState?.pendingMessageCount ?? 0
            : runtimeState?.pendingMessageCount ?? 0,
        })
        return {
          summary,
          loading: opening,
          disabled: opening || deleting,
          selected: isActive || opening,
          activityState,
          ...(status ? { status } : {}),
        }
      })
      const presentation = presentSidebarSessions(mappedItems, {
        query: normalizedQuery,
        filter: sessionFilter,
        sort: sessionSort,
        projectName: project.name,
        limit: filtering ? undefined : limit,
      })
      const projectCatalog: SidebarProjectNavigation['catalog'] = !catalog
        ? { status: workspace.mode === 'electron' && project.available && expanded
            ? 'loading'
            : 'idle' }
        : catalog.status === 'ready' || (catalog.status === 'loading' && rows.length > 0)
          ? {
              status: 'ready',
              items: presentation.items,
              hasMore: presentation.hasMore,
              loadedCount: presentation.loadedCount,
            }
          : catalog.status === 'error'
            ? { status: 'error', ...(catalog.errorMessage
                ? { message: catalog.errorMessage }
                : {}) }
            : { status: catalog.status }
      return {
        project: {
          id: project.id,
          name: project.name,
          lastOpenedAt: new Date(project.lastOpenedAt).toISOString(),
          pinned: project.pinned,
          available: project.available,
        },
        expanded,
        catalog: projectCatalog,
      }
    }), [
      projectExpansion,
      filtering,
      isOpeningSessionRow,
      normalizedQuery,
      sessionFilter,
      sessionSort,
      pi.session?.pendingMessageCount,
      pi.status,
      runtimeSessionStatuses,
      projectSessionLimits,
      workspace.activeScope,
      workspace.activeSessionId,
      deletingSelectionToken,
      workspace.mode,
      workspace.recentProjects,
      workspace.sessionCatalogs,
    ])

  // While filtering, hide groups without matches and force expansion so
  // matches stay visible; the real expansion state is restored on clear.
  const visibleProjects = React.useMemo(() => filtering
    ? sidebarProjects.filter((navigation) =>
        (navigation.catalog.status === 'ready' && navigation.catalog.items.length > 0) ||
        (navigation.project.available && navigation.catalog.status !== 'ready' && navigation.catalog.status !== 'idle') ||
        (sessionFilter === 'all' && normalizedQuery.length > 0 &&
          navigation.project.name.toLowerCase().includes(normalizedQuery)))
    : sidebarProjects, [filtering, normalizedQuery, sessionFilter, sidebarProjects])

  const recentChats = React.useMemo<SidebarConversationItem[]>(() => {
    const catalog = workspace.sessionCatalogs.projectless
    if (!catalog) return []
    const mappedItems = catalog.rows.map((summary): SidebarConversationItem => {
      const runtimeState = runtimeStateForOfficialSession(
        summary,
        runtimeSessionStatuses,
        catalog.rows,
      )
      const isActive = isOfficialSessionActiveRow(
        summary,
        catalog.rows,
        workspace.activeScope,
        workspace.activeSessionId,
        runtimeState?.selected === true,
      )
      const status = runtimeState?.status ?? (isActive ? pi.status : undefined)
      const opening = isOpeningSessionRow(summary, catalog.rows)
      const deleting = summary.selectionToken === deletingSelectionToken
      return {
        summary,
        loading: opening,
        disabled: opening || deleting,
        selected: isActive || opening,
        activityState: deriveSessionActivityState({
          opening,
          status,
          pendingMessageCount: isActive
            ? pi.session?.pendingMessageCount ?? runtimeState?.pendingMessageCount ?? 0
            : runtimeState?.pendingMessageCount ?? 0,
        }),
        ...(status ? { status } : {}),
      }
    })
    return presentSidebarSessions(mappedItems, {
      query: normalizedQuery,
      filter: sessionFilter,
      sort: sessionSort,
    }).items
  }, [
    isOpeningSessionRow,
    normalizedQuery,
    sessionFilter,
    sessionSort,
    pi.session?.pendingMessageCount,
    pi.status,
    runtimeSessionStatuses,
    workspace.activeScope,
    workspace.activeSessionId,
    deletingSelectionToken,
    workspace.sessionCatalogs,
  ])

  const toggleProject = React.useCallback((projectId: string, expanded: boolean) => {
    setProjectExpansion((previous) => {
      if (previous.get(projectId) === expanded) return previous
      const next = new Map(previous)
      next.delete(projectId)
      next.set(projectId, expanded)
      return next
    })
    if (expanded) startProjectCatalogLoad(projectId, true)
  }, [startProjectCatalogLoad])

  const loadMore = React.useCallback((projectId: string) => {
    setProjectSessionLimits((previous) => ({
      ...previous,
      [projectId]: (previous[projectId] ?? INITIAL_SESSION_LIMIT) + SESSION_PAGE_SIZE,
    }))
  }, [])

  const recentCatalog = workspace.sessionCatalogs.projectless
  const recentCatalogUnavailable = workspace.mode !== 'electron' ||
    recentCatalog?.status === 'unavailable' || recentCatalog?.status === 'activationUnavailable'
  const recentCatalogPending = !recentCatalogUnavailable && (!recentCatalog || recentCatalog.status === 'loading')
  const showRecentCatalogState = recentChats.length === 0 && recentCatalog?.status !== 'ready'
  const searchInProgress = filtering && sidebarProjects.some(({ project, catalog }) => project.available && catalog.status === 'loading')
  const filterHasResults = visibleProjects.length > 0 || recentChats.length > 0 || showRecentCatalogState

  return (
    <div hidden={hidden} className="min-w-0 px-2 pb-4 pt-3">
      <NewConversationControl
        activeScope={workspace.activeScope}
        projects={sidebarProjects}
        onNewPrimary={onNewPrimary}
        onNewProjectless={onNewProjectless}
      />
      <div className="relative mb-1.5 mt-3">
        <TbSearch
          aria-hidden
          className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          ref={searchRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setQuery('')
              event.currentTarget.blur()
            }
          }}
          placeholder={t('sidebar.sessions.searchPlaceholder')}
          aria-label={t('sidebar.sessions.search')}
          title={t('workbenchReview.sessions.searchHint')}
          autoComplete="off"
          className="h-8 border-transparent bg-transparent pl-8 pr-8 text-caption shadow-none hover:bg-accent/40 focus-visible:bg-surface"
        />
        {query.length > 0 && (
          <Button
            variant="ghost"
            size="icon-xs"
            className="absolute right-0.5 top-1/2 size-7 -translate-y-1/2 text-muted-foreground"
            aria-label={t('sidebar.sessions.clearSearch')}
            onClick={() => {
              setQuery('')
              searchRef.current?.focus()
            }}
          >
            <TbX className="size-3.5" aria-hidden />
          </Button>
        )}
      </div>
      <div className="mb-3 flex items-center justify-between gap-1 px-1">
        <div role="group" aria-label={t('sidebar.sessions.filter')} className="flex gap-0.5">
          {(['all', 'running'] as const).map((filter) => (
            <Button
              key={filter}
              variant="ghost"
              size="xs"
              className={cn(
                'h-7 rounded-md px-2 text-caption font-normal',
                sessionFilter === filter
                  ? 'bg-selected font-medium text-foreground'
                  : 'text-muted-foreground',
              )}
              aria-pressed={sessionFilter === filter}
              onClick={() => setSessionFilter(filter)}
            >
              {t(filter === 'all' ? 'sidebar.sessions.all' : 'sidebar.sessions.running')}
            </Button>
          ))}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              className="size-7 text-muted-foreground"
              aria-label={t('sidebar.sessions.sort')}
              title={t(sessionSort === 'recent' ? 'sidebar.sessions.sortRecent' : 'sidebar.sessions.sortName')}
            >
              <TbArrowsSort className="size-3.5" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuRadioGroup
              value={sessionSort}
              onValueChange={(value) => {
                if (value === 'recent' || value === 'name') setSessionSort(value)
              }}
            >
              <DropdownMenuRadioItem value="recent">{t('sidebar.sessions.sortRecent')}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="name">{t('sidebar.sessions.sortName')}</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {searchInProgress ? <p role="status" className="mb-2 flex items-center gap-1.5 px-2 text-micro text-muted-foreground"><TbLoader2 className="size-3 animate-spin motion-reduce:animate-none" aria-hidden />{t('workbenchReview.sessions.searching')}</p> : null}
      <div>
        {filtering && !filterHasResults ? (
          <div className="flex flex-col items-start gap-2 px-2 py-1.5">
            <p className="text-caption text-muted-foreground" role="status">
              {t(sessionFilter === 'running' && !normalizedQuery
                ? 'sidebar.sessions.runningEmpty'
                : 'sidebar.sessions.empty')}
            </p>
            <Button variant="ghost" size="xs" onClick={() => { setQuery(''); setSessionFilter('all'); searchRef.current?.focus() }}>{t('workbenchReview.sessions.reset')}</Button>
          </div>
        ) : (
          <>
            {(!filtering || visibleProjects.length > 0) && (
              <ProjectNavigationGroup
                projects={visibleProjects}
                activeProjectId={workspace.activeScope.kind === 'project'
                  ? workspace.activeScope.workspaceId
                  : null}
                activeSessionId={workspace.activeSessionId}
                renamingSelectionToken={renamingSelectionToken}
                onSelect={onSelect}
                onRenameStart={onRenameStart}
                onRenameCommit={onRenameCommit}
                onDuplicate={onDuplicate}
                onDelete={onDelete}
                onAddProject={onChooseWorkspace}
                onToggleProject={toggleProject}
                onActivateProject={onActivateProject}
                onStartProjectTask={onStartProjectTask}
                onLoadMore={loadMore}
                onPinProject={onPinWorkspace}
                onRemoveProject={onRemoveWorkspace}
              />
            )}
            {showRecentCatalogState ? <section className="mt-4 px-2" aria-label={t('sidebar.generalChats')}>
              <h2 className="mb-2 text-micro font-medium text-muted-foreground">{t('sidebar.generalChats')}</h2>
              <div role={recentCatalogPending ? 'status' : 'alert'} className="flex items-center gap-2 text-caption text-muted-foreground">
                {recentCatalogPending ? <TbLoader2 className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden /> : null}
                <span className="min-w-0 flex-1">{t(recentCatalogPending ? 'workbenchReview.sessions.loading' : recentCatalogUnavailable ? 'workbenchReview.sessions.unavailable' : 'workbenchReview.sessions.failed')}</span>
                {!recentCatalogPending && !recentCatalogUnavailable ? <Button variant="ghost" size="xs" onClick={() => { void loadSessionCatalog({ kind: 'projectless' }, true).catch(() => undefined) }}>{t('common.retry')}</Button> : null}
              </div>
            </section> : (!filtering || recentChats.length > 0) && (
              <RecentChatGroup
                items={recentChats}
                activeSessionId={workspace.activeScope.kind === 'projectless'
                  ? workspace.activeSessionId
                  : ''}
                renamingSelectionToken={renamingSelectionToken}
                onSelect={onSelect}
                onRenameStart={onRenameStart}
                onRenameCommit={onRenameCommit}
                onDuplicate={onDuplicate}
                onDelete={onDelete}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}
