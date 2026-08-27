import * as React from 'react'
import { TbMessagePlus, TbPlus, TbSearch } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useT } from '@/i18n'
import {
  expandedProjectIdsNeedingCatalogLoad,
  readProjectExpansionPreferences,
  writeProjectExpansionPreferences,
} from '@/renderer/layout-preferences'
import type {
  ConversationScope,
  OfficialPiSessionSummary,
} from '@/shared/conversation-scope'
import type { LocalPiRuntimeSessionStatus } from '@/shared/local-pi'
import type { WorkspaceSummary } from '@/shared/schemas/workspace'
import { usePiRuntime } from '@/store/pi-rpc'
import { conversationScopeKey, useWorkspaceStore } from '@/store/workspace'
import {
  ProjectNavigationGroup,
  RecentChatGroup,
  type SidebarConversationItem,
  type SidebarProjectNavigation,
} from '@/components/layout/SessionList'

const INITIAL_SESSION_LIMIT = 6
const SESSION_PAGE_SIZE = 10

/** Case-insensitive search haystack matching the session row's title basis. */
function sessionSearchText(summary: OfficialPiSessionSummary) {
  return (summary.name?.trim() || summary.preview.trim()).toLowerCase()
}

function runtimeStatusFor(
  summary: OfficialPiSessionSummary,
  statuses: readonly LocalPiRuntimeSessionStatus[] | undefined,
  siblings: readonly OfficialPiSessionSummary[],
) {
  const scopeKey = conversationScopeKey(summary.scope)
  const scoped = statuses?.filter((status) =>
    conversationScopeKey(status.scope) === scopeKey) ?? []
  const exact = scoped.find((status) =>
    status.selectionToken === summary.selectionToken)
  if (exact) return exact.status
  const duplicateSessionId = siblings.some((candidate) =>
    candidate !== summary && candidate.sessionId === summary.sessionId)
  if (duplicateSessionId) return undefined
  return scoped.find((status) =>
    status.selectionToken === undefined &&
    status.sessionId === summary.sessionId)?.status
}

export interface SessionsPanelProps {
  /**
   * Keeps the panel mounted while visually hidden so project expansion and
   * pagination state survive rail destination switches.
   */
  hidden?: boolean
  renamingSelectionToken: string | null
  deletingSelectionToken: string | null
  isOpeningSessionRow: (summary: OfficialPiSessionSummary) => boolean
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
    <div className="flex w-full">
      <Button
        variant="secondary"
        className="h-[var(--control-h)] min-w-0 flex-1 justify-start rounded-r-none"
        disabled={primaryDisabled}
        onClick={onNewPrimary}
      >
        <TbPlus aria-hidden />
        <span className="truncate">{primaryLabel}</span>
      </Button>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="secondary"
            size="icon"
            className="size-[var(--control-h)] rounded-l-none border-l border-border/70"
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
  const normalizedQuery = query.trim().toLowerCase()
  const filtering = normalizedQuery.length > 0
  const [projectExpansion, setProjectExpansion] = React.useState<ReadonlyMap<string, boolean>>(
    () => readProjectExpansionPreferences(),
  )
  const [projectSessionLimits, setProjectSessionLimits] = React.useState<
    Readonly<Record<string, number>>
  >({})
  const catalogLoadsStarted = React.useRef(new Set<string>())
  const knownProjectIds = React.useRef<ReadonlySet<string> | null>(null)
  const loadSessionCatalog = workspace.loadSessionCatalog

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
    expandedProjectIdsNeedingCatalogLoad(
      projectExpansion,
      workspace.recentProjects.map((project) => ({
        projectId: project.id,
        available: project.available,
        hasCatalog: Boolean(workspace.sessionCatalogs[conversationScopeKey({
          kind: 'project',
          workspaceId: project.id,
        })]),
      })),
    ), [projectExpansion, workspace.recentProjects, workspace.sessionCatalogs])

  React.useEffect(() => {
    if (workspace.mode !== 'electron') return

    for (const projectId of expandedProjectsWithoutCatalog) {
      startProjectCatalogLoad(projectId)
    }
  }, [expandedProjectsWithoutCatalog, startProjectCatalogLoad, workspace.mode])

  const sidebarProjects = React.useMemo<SidebarProjectNavigation[]>(() =>
    workspace.recentProjects.map((project) => {
      const scope: ConversationScope = { kind: 'project', workspaceId: project.id }
      const catalog = workspace.sessionCatalogs[conversationScopeKey(scope)]
      const expandedByPreference = projectExpansion.get(project.id) === true
      const expanded = filtering || expandedByPreference
      const limit = projectSessionLimits[project.id] ?? INITIAL_SESSION_LIMIT
      const rows = catalog?.rows ?? []
      // Local filter: a session matches on its title or its project name; a
      // matching project name keeps every loaded session of that project.
      const projectMatches = filtering && project.name.toLowerCase().includes(normalizedQuery)
      const visibleRows = filtering
        ? rows.filter((summary) =>
            projectMatches || sessionSearchText(summary).includes(normalizedQuery))
        : rows.slice(0, limit)
      const items = visibleRows.map((summary): SidebarConversationItem => {
        const runtimeStatus = runtimeStatusFor(summary, runtimeSessionStatuses, rows)
        const isActive = summary.sessionId === workspace.activeSessionId &&
          workspace.activeScope.kind === 'project' &&
          workspace.activeScope.workspaceId === project.id
        const status = runtimeStatus ?? (isActive ? pi.status : undefined)
        return {
          summary,
          ...(isOpeningSessionRow(summary) ||
            summary.selectionToken === deletingSelectionToken
            ? { loading: true }
            : {}),
          ...(status ? { status } : {}),
        }
      })
      const projectCatalog: SidebarProjectNavigation['catalog'] = !catalog
        ? { status: workspace.mode === 'electron' && project.available && expandedByPreference
            ? 'loading'
            : 'idle' }
        : catalog.status === 'ready' || (catalog.status === 'loading' && rows.length > 0)
          ? { status: 'ready', items, hasMore: !filtering && rows.length > items.length }
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
        navigation.catalog.status === 'ready' && navigation.catalog.items.length > 0)
    : sidebarProjects, [filtering, sidebarProjects])

  const recentChats = React.useMemo<SidebarConversationItem[]>(() => {
    const catalog = workspace.sessionCatalogs.projectless
    if (!catalog) return []
    const rows = filtering
      ? catalog.rows.filter((summary) => sessionSearchText(summary).includes(normalizedQuery))
      : catalog.rows
    return rows.map((summary) => {
      const runtimeStatus = runtimeStatusFor(summary, runtimeSessionStatuses, catalog.rows)
      const isActive = summary.sessionId === workspace.activeSessionId &&
        workspace.activeScope.kind === 'projectless'
      const status = runtimeStatus ?? (isActive ? pi.status : undefined)
      return {
        summary,
        ...(isOpeningSessionRow(summary) ||
          summary.selectionToken === deletingSelectionToken
          ? { loading: true }
          : {}),
        ...(status ? { status } : {}),
      }
    })
  }, [
    filtering,
    isOpeningSessionRow,
    normalizedQuery,
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

  const filterHasResults = visibleProjects.length > 0 || recentChats.length > 0

  return (
    <div hidden={hidden} className="px-2 pb-3 pt-2">
      <div className="relative mb-2">
        <TbSearch
          aria-hidden
          className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60"
        />
        <Input
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
          autoComplete="off"
          className="pl-8"
        />
      </div>
      <NewConversationControl
        activeScope={workspace.activeScope}
        projects={sidebarProjects}
        onNewPrimary={onNewPrimary}
        onNewProjectless={onNewProjectless}
      />
      <div className="pt-3">
        {filtering && !filterHasResults ? (
          <p className="px-2 py-1.5 text-caption text-muted-foreground">
            {t('sidebar.sessions.empty')}
          </p>
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
            {(!filtering || recentChats.length > 0) && (
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
