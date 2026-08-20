import * as React from 'react'
import {
  createDefaultWorkspaceAdapter,
  loadOfficialSessionCatalog,
  type WorkspaceAdapter,
} from '@/renderer/adapters/workspace-adapter'
import type {
  ConversationActivationResult,
  ConversationNavigationSnapshot,
  ConversationScope,
  OfficialPiSessionSummary,
  SessionCatalogDeleteResult,
  SessionCatalogListResult,
  SessionCatalogSelectionToken,
} from '@/shared/conversation-scope'
import {
  localPiSessionStateSchema,
  type LocalPiRendererRpcCommand,
  type LocalPiRuntimeSnapshot,
} from '@/shared/local-pi'
import type { WorkspaceSnapshot } from '@/shared/schemas/workspace'
import type { WorkspacePathSearchResult } from '@/shared/workspace-content'
import type { RecentProject, Session, Workspace } from '@/types/chat'
import {
  deriveOfficialSessionState,
  sameConversationScope,
} from './workspace-state'

type CatalogStatus = SessionCatalogListResult['status'] | 'loading' | 'error'

export interface ScopedSessionCatalog {
  status: CatalogStatus
  rows: readonly OfficialPiSessionSummary[]
  errorMessage: string | null
}

export function conversationScopeKey(scope: ConversationScope) {
  return scope.kind === 'project'
    ? `project:${scope.workspaceId}`
    : 'projectless'
}

export interface WorkspaceState {
  mode: 'electron' | 'unavailable'
  activeScope: ConversationScope
  workspace: Workspace | null
  recentProjects: RecentProject[]
  sessions: Session[]
  activeId: string
  activeSessionId: string
  runtime: LocalPiRuntimeSnapshot | null
  catalogStatus: CatalogStatus
  sessionCatalogs: Readonly<Record<string, ScopedSessionCatalog>>
  filesModified: number
  errorCode: string | null
  errorMessage: string | null
}

export interface WorkspaceActions {
  chooseWorkspace(): Promise<boolean>
  clearError(): void
  deleteSession(
    scope: ConversationScope,
    selectionToken: SessionCatalogSelectionToken,
  ): Promise<SessionCatalogDeleteResult>
  duplicateSession(
    scope: ConversationScope,
    selectionToken: SessionCatalogSelectionToken,
  ): Promise<void>
  loadSessionCatalog(scope: ConversationScope, refresh?: boolean): Promise<void>
  newSession(scope: ConversationScope): Promise<void>
  openSession(
    scope: ConversationScope,
    selectionToken: SessionCatalogSelectionToken,
  ): Promise<ConversationActivationResult>
  openWorkspace(workspaceId: string): Promise<void>
  refreshContent(): Promise<void>
  refreshSessions(): Promise<void>
  renameSession(
    scope: ConversationScope,
    selectionToken: SessionCatalogSelectionToken,
    title: string,
  ): Promise<void>
  searchWorkspacePaths(query: string): Promise<WorkspacePathSearchResult>
  setWorkspacePinned(workspaceId: string, pinned: boolean): Promise<void>
}

export interface WorkspaceStoreValue extends WorkspaceState, WorkspaceActions {}

const WorkspaceContext = React.createContext<WorkspaceStoreValue | null>(null)

class OfficialPiCommandError extends Error {
  readonly code = 'LOCAL_PI_COMMAND_FAILED'

  constructor(message: string) {
    super(message)
    this.name = 'OfficialPiCommandError'
  }
}

function initialState(adapter: WorkspaceAdapter | null): WorkspaceState {
  const available = Boolean(adapter)
  return {
    mode: available ? 'electron' : 'unavailable',
    activeScope: { kind: 'projectless' },
    workspace: null,
    recentProjects: [],
    sessions: [],
    activeId: '',
    activeSessionId: '',
    runtime: null,
    catalogStatus: available ? 'loading' : 'activationUnavailable',
    sessionCatalogs: available
      ? {
          projectless: {
            status: 'loading',
            rows: [],
            errorMessage: null,
          },
        }
      : {},
    filesModified: 0,
    errorCode: available ? null : 'PIPILOT_PRELOAD_UNAVAILABLE',
    errorMessage: available
      ? null
      : 'The PiPilot desktop bridge is unavailable.',
  }
}

function mapWorkspaceSnapshot(snapshot: WorkspaceSnapshot) {
  return snapshot.recent.map((project): RecentProject => ({
    id: project.id,
    name: project.name,
    lastOpenedAt: Date.parse(project.lastOpenedAt),
    pinned: project.pinned,
    available: project.available,
  }))
}

function workspaceForScope(
  scope: ConversationScope,
  recentProjects: readonly RecentProject[],
  previous?: Workspace | null,
): Workspace | null {
  if (scope.kind === 'projectless') return null
  const project = recentProjects.find((candidate) => candidate.id === scope.workspaceId)
  if (!project) return null
  return {
    id: project.id,
    name: project.name,
    branch: previous?.id === project.id ? previous.branch : '',
    available: project.available,
  }
}

function errorDetails(error: unknown) {
  let code = 'UNKNOWN_ERROR'
  let message = error instanceof Error ? error.message : 'The operation failed.'
  if (typeof error === 'object' && error !== null) {
    if ('code' in error && typeof error.code === 'string') code = error.code
    if ('message' in error && typeof error.message === 'string') {
      message = error.message
    }
  }
  return { code, message }
}

async function runOfficialCommand(
  adapter: WorkspaceAdapter,
  command: LocalPiRendererRpcCommand,
) {
  const response = await adapter.localPi.runtime.command(command)
  if (!response.success) {
    throw new OfficialPiCommandError(
      response.error || `Pi rejected the ${command.type} command.`,
    )
  }
  return response
}

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [adapter] = React.useState(createDefaultWorkspaceAdapter)
  const [state, setState] = React.useState(() => initialState(adapter))
  const stateRef = React.useRef(state)
  const scopeEpoch = React.useRef(0)
  const workspaceRevision = React.useRef(-1)
  const navigationRevision = React.useRef(0)
  const catalogRequests = React.useRef(new Map<string, number>())
  const contentRequest = React.useRef(0)
  const workspaceSignal = React.useRef(0)
  const navigationSignal = React.useRef(0)
  const runtimeSignal = React.useRef(0)

  const invalidateCatalogRequest = React.useCallback((scope: ConversationScope) => {
    const key = conversationScopeKey(scope)
    const requestId = (catalogRequests.current.get(key) ?? 0) + 1
    catalogRequests.current.set(key, requestId)
    return requestId
  }, [])

  const updateState = React.useCallback(
    (update: (previous: WorkspaceState) => WorkspaceState) => {
      const previous = stateRef.current
      const next = update(previous)
      if (Object.is(previous, next)) return
      stateRef.current = next
      setState(next)
    },
    [],
  )

  const fail = React.useCallback((error: unknown) => {
    const details = errorDetails(error)
    updateState((previous) => ({
      ...previous,
      errorCode: details.code,
      errorMessage: details.message,
    }))
  }, [updateState])

  const clearError = React.useCallback(() => {
    updateState((previous) => previous.errorCode || previous.errorMessage
      ? { ...previous, errorCode: null, errorMessage: null }
      : previous)
  }, [updateState])

  const applyWorkspaceSnapshot = React.useCallback((snapshot: WorkspaceSnapshot) => {
    if (snapshot.revision < workspaceRevision.current) return
    workspaceRevision.current = snapshot.revision
    const recentProjects = mapWorkspaceSnapshot(snapshot)
    updateState((previous) => ({
      ...previous,
      recentProjects,
      workspace: workspaceForScope(
        previous.activeScope,
        recentProjects,
        previous.workspace,
      ),
    }))
  }, [updateState])

  const applyConversationNavigation = React.useCallback((
    snapshot: ConversationNavigationSnapshot,
  ) => {
    if (snapshot.revision < navigationRevision.current) return false
    navigationRevision.current = snapshot.revision
    const changed = !sameConversationScope(
      stateRef.current.activeScope,
      snapshot.activeScope,
    )
    if (changed) {
      scopeEpoch.current += 1
      // Catalog requests are keyed by scope and may safely finish while that
      // scope becomes inactive. Cancelling the previous scope here leaves its
      // visible project row in `loading` forever: the request result is
      // discarded, but no replacement request is started for the inactive
      // project. Content/runtime hydration uses scope epochs separately.
      contentRequest.current += 1
    }
    updateState((previous) => {
      const workspace = workspaceForScope(
        snapshot.activeScope,
        previous.recentProjects,
        previous.workspace,
      )
      const activeSessionId = changed ? '' : previous.activeSessionId
      return {
        ...previous,
        activeScope: snapshot.activeScope,
        workspace,
        ...(changed
          ? {
              sessions: [],
              activeId: '',
              activeSessionId,
              catalogStatus: previous.sessionCatalogs[
                conversationScopeKey(snapshot.activeScope)
              ]?.status ?? 'loading',
              filesModified: 0,
            }
          : {}),
      }
    })
    return changed
  }, [invalidateCatalogRequest, updateState])

  const applyRuntimeSnapshot = React.useCallback((
    snapshot: LocalPiRuntimeSnapshot,
    authoritativeSession = false,
  ) => {
    // Main has already selected this Runtime by runtimeId. Generation ordering
    // cannot be compared with the Runtime that was visible before it.
    const previous = stateRef.current.runtime

    const generationChanged = previous?.generation !== snapshot.generation
    const replacing = snapshot.state === 'replacing' || snapshot.state === 'starting'
    const sessionUnavailable = snapshot.state === 'stopped' ||
      snapshot.state === 'crashed' || snapshot.state === 'error'
    const reportedSessionChanged = Boolean(
      previous?.sessionState?.sessionId &&
      snapshot.sessionState?.sessionId &&
      previous.sessionState.sessionId !== snapshot.sessionState.sessionId,
    )
    const preserveSession = !authoritativeSession && !generationChanged && !replacing &&
      !reportedSessionChanged && previous?.state === 'ready' && snapshot.state === 'ready'
    const runtime = preserveSession
      ? {
          ...snapshot,
          sessionFile: previous.sessionFile,
          sessionState: previous.sessionState,
        }
      : snapshot
    const nextSessionId = replacing || sessionUnavailable
      ? ''
      : authoritativeSession || generationChanged || reportedSessionChanged ||
          !stateRef.current.activeSessionId
        ? runtime.sessionState?.sessionId ?? ''
        : stateRef.current.activeSessionId
    const sessionChanged = nextSessionId !== stateRef.current.activeSessionId
    const invalidateCatalog = generationChanged || replacing || reportedSessionChanged ||
      (sessionUnavailable && Boolean(stateRef.current.activeSessionId)) || (
      authoritativeSession && sessionChanged
    )

    if (invalidateCatalog) invalidateCatalogRequest(stateRef.current.activeScope)
    updateState((current) => {
      const sessions = invalidateCatalog ? [] : current.sessions
      const activeCatalogKey = conversationScopeKey(current.activeScope)
      return {
        ...current,
        runtime,
        activeSessionId: nextSessionId,
        sessions,
        activeId: sessions.some((session) => session.id === nextSessionId)
          ? nextSessionId
          : '',
        catalogStatus: invalidateCatalog ? 'loading' : current.catalogStatus,
        sessionCatalogs: invalidateCatalog
          ? {
              ...current.sessionCatalogs,
              [activeCatalogKey]: {
                status: 'loading',
                rows: current.sessionCatalogs[activeCatalogKey]?.rows ?? [],
                errorMessage: null,
              },
            }
          : current.sessionCatalogs,
      }
    })
    return invalidateCatalog || (
      snapshot.state === 'ready' && previous?.state !== 'ready'
    )
  }, [invalidateCatalogRequest, updateState])

  const applyActivation = React.useCallback((result: ConversationActivationResult) => {
    const scopeChanged = !sameConversationScope(
      stateRef.current.activeScope,
      result.scope,
    )
    if (scopeChanged) {
      scopeEpoch.current += 1
      contentRequest.current += 1
    }
    invalidateCatalogRequest(result.scope)
    const catalogKey = conversationScopeKey(result.scope)
    updateState((previous) => ({
      ...previous,
      activeScope: result.scope,
      workspace: workspaceForScope(
        result.scope,
        previous.recentProjects,
        previous.workspace,
      ),
      sessions: [],
      activeId: '',
      activeSessionId: result.sessionId,
      catalogStatus: 'loading',
      sessionCatalogs: {
        ...previous.sessionCatalogs,
        [catalogKey]: {
          status: 'loading',
          rows: previous.sessionCatalogs[catalogKey]?.rows ?? [],
          errorMessage: null,
        },
      },
      ...(scopeChanged ? { filesModified: 0 } : {}),
    }))
  }, [invalidateCatalogRequest, updateState])

  const refreshCatalogFor = React.useCallback(async (
    scope: ConversationScope,
    refresh = false,
  ) => {
    if (!adapter) return
    const key = conversationScopeKey(scope)
    const requestId = invalidateCatalogRequest(scope)
    updateState((previous) => ({
      ...previous,
      ...(sameConversationScope(scope, previous.activeScope)
        ? { catalogStatus: 'loading' as const }
        : {}),
      sessionCatalogs: {
        ...previous.sessionCatalogs,
        [key]: {
          status: 'loading',
          rows: previous.sessionCatalogs[key]?.rows ?? [],
          errorMessage: null,
        },
      },
    }))

    try {
      const result = await loadOfficialSessionCatalog(
        adapter.sessionCatalog,
        scope,
        refresh,
      )
      if (requestId !== catalogRequests.current.get(key)) return

      updateState((previous) => {
        const active = sameConversationScope(scope, previous.activeScope)
        const nextCatalog: ScopedSessionCatalog = {
          status: result.status,
          rows: result.status === 'ready' ? result.rows : [],
          errorMessage: null,
        }
        if (!active) {
          return {
            ...previous,
            sessionCatalogs: {
              ...previous.sessionCatalogs,
              [key]: nextCatalog,
            },
          }
        }
        if (result.status !== 'ready') {
          return {
            ...previous,
            sessions: [],
            activeId: '',
            catalogStatus: result.status,
            sessionCatalogs: {
              ...previous.sessionCatalogs,
              [key]: nextCatalog,
            },
          }
        }
        const sessionState = deriveOfficialSessionState(
          result.rows,
          previous.workspace?.name ?? '',
          previous.activeSessionId,
        )
        return {
          ...previous,
          ...sessionState,
          catalogStatus: 'ready',
          sessionCatalogs: {
            ...previous.sessionCatalogs,
            [key]: nextCatalog,
          },
        }
      })
    } catch (error) {
      if (requestId !== catalogRequests.current.get(key)) return

      const details = errorDetails(error)
      updateState((previous) => ({
        ...previous,
        ...(sameConversationScope(scope, previous.activeScope)
          ? { catalogStatus: 'error' as const }
          : {}),
        sessionCatalogs: {
          ...previous.sessionCatalogs,
          [key]: {
            status: 'error',
            rows: [],
            errorMessage: details.message,
          },
        },
      }))
      throw error
    }
  }, [adapter, invalidateCatalogRequest, updateState])

  const refreshWorkspaceContentFor = React.useCallback(async (
    workspace: Workspace | null,
  ) => {
    if (!adapter) return
    const requestId = ++contentRequest.current
    const expectedScopeEpoch = scopeEpoch.current
    if (!workspace?.available) {
      if (requestId === contentRequest.current) {
        updateState((previous) => ({
          ...previous,
          filesModified: 0,
          workspace: previous.workspace
            ? { ...previous.workspace, branch: '' }
            : null,
        }))
      }
      return
    }

    const [directory, changes] = await Promise.all([
      adapter.files.list(workspace.id, '.'),
      adapter.changes.list(workspace.id),
    ])
    if (
      requestId !== contentRequest.current ||
      expectedScopeEpoch !== scopeEpoch.current ||
      workspace.id !== stateRef.current.workspace?.id
    ) {
      return
    }
    updateState((previous) => ({
      ...previous,
      filesModified: directory.modifiedCount,
      workspace: previous.workspace
        ? { ...previous.workspace, branch: changes.branch }
        : null,
    }))
  }, [adapter, updateState])

  const refreshRuntimeState = React.useCallback(async (scope: ConversationScope) => {
    if (!adapter) return
    const expectedScopeEpoch = scopeEpoch.current
    const before = await adapter.localPi.runtime.status()
    if (
      expectedScopeEpoch !== scopeEpoch.current ||
      !sameConversationScope(scope, stateRef.current.activeScope)
    ) {
      return
    }
    if (before.state !== 'ready') {
      applyRuntimeSnapshot(before, true)
      return
    }

    const response = await runOfficialCommand(adapter, { type: 'get_state' })
    const sessionState = localPiSessionStateSchema.parse(response.data)
    const after = await adapter.localPi.runtime.status()
    if (
      expectedScopeEpoch !== scopeEpoch.current ||
      !sameConversationScope(scope, stateRef.current.activeScope)
    ) {
      return
    }
    if (before.generation !== after.generation) {
      applyRuntimeSnapshot(after, true)
      return
    }
    applyRuntimeSnapshot({
      ...after,
      sessionFile: sessionState.sessionFile ?? after.sessionFile,
      sessionState,
    }, true)
  }, [adapter, applyRuntimeSnapshot])

  const refreshConversation = React.useCallback(async (
    scope: ConversationScope,
    refreshContent = false,
  ) => {
    await refreshRuntimeState(scope)
    await Promise.all([
      refreshCatalogFor(scope, true),
      ...(refreshContent
        ? [refreshWorkspaceContentFor(stateRef.current.workspace)]
        : []),
    ])
  }, [refreshCatalogFor, refreshRuntimeState, refreshWorkspaceContentFor])

  React.useEffect(() => {
    if (!adapter) return
    let disposed = false
    const report = (operation: Promise<unknown>) => {
      void operation.catch((error) => {
        if (!disposed) fail(error)
      })
    }

    const detachWorkspace = adapter.workspace.subscribe((snapshot) => {
      if (disposed) return
      workspaceSignal.current += 1
      applyWorkspaceSnapshot(snapshot)
      report(refreshWorkspaceContentFor(stateRef.current.workspace))
    })
    const detachConversation = adapter.conversation.subscribe((snapshot) => {
      if (disposed) return
      navigationSignal.current += 1
      const changed = applyConversationNavigation(snapshot)
      if (!changed) return
      report(Promise.all([
        refreshCatalogFor(snapshot.activeScope, true),
        refreshWorkspaceContentFor(stateRef.current.workspace),
      ]))
    })
    const detachRuntime = adapter.localPi.runtime.subscribe((event) => {
      if (disposed) return
      runtimeSignal.current += 1
      if (applyRuntimeSnapshot(event.snapshot)) {
        report(refreshCatalogFor(stateRef.current.activeScope, true))
      }
    })
    const detachEvents = adapter.localPi.runtime.subscribeEvents((event) => {
      if (
        disposed ||
        event.generation !== stateRef.current.runtime?.generation
      ) {
        return
      }
      if (event.event.type === 'agent_settled') {
        report(refreshConversation(stateRef.current.activeScope))
      } else if (
        event.event.type === 'entry_appended' ||
        event.event.type === 'session_info_changed'
      ) {
        report(refreshCatalogFor(stateRef.current.activeScope, true))
      }
    })
    const initialWorkspaceSignal = workspaceSignal.current
    const initialNavigationSignal = navigationSignal.current
    const initialRuntimeSignal = runtimeSignal.current
    report((async () => {
      await Promise.all([
        adapter.workspace.get()
          .then((snapshot) => {
            if (!disposed && initialWorkspaceSignal === workspaceSignal.current) {
              applyWorkspaceSnapshot(snapshot)
            }
          })
          .catch((error) => {
            if (!disposed && initialWorkspaceSignal === workspaceSignal.current) {
              fail(error)
            }
          }),
        adapter.conversation.get()
          .then((snapshot) => {
            if (!disposed && initialNavigationSignal === navigationSignal.current) {
              applyConversationNavigation(snapshot)
            }
          })
          .catch((error) => {
            if (!disposed && initialNavigationSignal === navigationSignal.current) {
              fail(error)
            }
          }),
        adapter.localPi.runtime.status()
          .then((snapshot) => {
            if (!disposed && initialRuntimeSignal === runtimeSignal.current) {
              applyRuntimeSnapshot(snapshot, true)
            }
          })
          .catch((error) => {
            if (!disposed && initialRuntimeSignal === runtimeSignal.current) {
              fail(error)
            }
          }),
      ])
      if (disposed) return
      await Promise.all([
        refreshCatalogFor(stateRef.current.activeScope),
        refreshWorkspaceContentFor(stateRef.current.workspace),
      ])
    })())

    return () => {
      disposed = true
      detachWorkspace()
      detachConversation()
      detachRuntime()
      detachEvents()
    }
  }, [
    adapter,
    applyConversationNavigation,
    applyRuntimeSnapshot,
    applyWorkspaceSnapshot,
    fail,
    refreshCatalogFor,
    refreshConversation,
    refreshRuntimeState,
    refreshWorkspaceContentFor,
  ])

  const runElectron = React.useCallback(async <T,>(operation: () => Promise<T>) => {
    try {
      const result = await operation()
      clearError()
      return result
    } catch (error) {
      fail(error)
      throw error
    }
  }, [clearError, fail])

  const chooseWorkspace = React.useCallback(async () => {
    if (!adapter) return false
    return runElectron(async () => {
      const result = await adapter.workspace.choose()
      applyWorkspaceSnapshot(result.snapshot)
      if (result.cancelled) return false
      const workspaceId = result.snapshot.current?.id ?? result.snapshot.currentId
      if (!workspaceId) {
        throw new Error('The selected workspace is unavailable.')
      }
      const activation = await adapter.conversation.new({
        kind: 'project',
        workspaceId,
      })
      applyActivation(activation)
      await refreshConversation(activation.scope, true)
      return true
    })
  }, [
    adapter,
    applyActivation,
    applyWorkspaceSnapshot,
    refreshConversation,
    runElectron,
  ])

  const openWorkspace = React.useCallback(async (
    workspaceId: string,
  ) => {
    if (!adapter) return
    await runElectron(async () => {
      const result = await adapter.workspace.open(workspaceId)
      applyWorkspaceSnapshot(result.snapshot)
      const activation = await adapter.conversation.new({
        kind: 'project',
        workspaceId,
      })
      applyActivation(activation)
      await refreshConversation(activation.scope, true)
    })
  }, [
    adapter,
    applyActivation,
    applyWorkspaceSnapshot,
    refreshConversation,
    runElectron,
  ])

  const newSession = React.useCallback(async (
    scope: ConversationScope,
  ) => {
    if (!adapter) return
    await runElectron(async () => {
      const activation = await adapter.conversation.new(scope)
      applyActivation(activation)
      await refreshConversation(activation.scope)
    })
  }, [adapter, applyActivation, refreshConversation, runElectron])

  const openSession = React.useCallback(async (
    scope: ConversationScope,
    selectionToken: SessionCatalogSelectionToken,
  ) => {
    if (!adapter) throw new Error('Session activation is unavailable.')
    return runElectron(async () => {
      const activation = await adapter.sessionCatalog.open(
        scope,
        selectionToken,
      )
      applyActivation(activation)
      // Main has already confirmed the exact runtime generation/session. Do
      // not make the renderer wait for catalog and workspace refreshes before
      // handing that identity to App; those refreshes can be slow (or be
      // superseded by another click) while PiRpc hydrates the selected
      // transcript independently.
      void refreshConversation(activation.scope).catch(() => undefined)
      return activation
    })
  }, [adapter, applyActivation, refreshConversation, runElectron])

  const deleteSession = React.useCallback(async (
    scope: ConversationScope,
    selectionToken: SessionCatalogSelectionToken,
  ) => {
    if (!adapter) throw new Error('Session deletion is unavailable.')
    let result: SessionCatalogDeleteResult
    try {
      result = await adapter.sessionCatalog.delete(scope, selectionToken)
    } catch (error) {
      // Main consumes deletion capabilities before asynchronous revalidation.
      // Refresh even on failure so the renderer never offers the dead token again.
      await refreshCatalogFor(scope, true).catch(() => undefined)
      throw error
    }
    if (!sameConversationScope(scope, result.scope)) {
      throw new Error('The deleted session belonged to another conversation scope.')
    }

    const catalogKey = conversationScopeKey(result.scope)
    updateState((previous) => {
      const activeScope = sameConversationScope(result.scope, previous.activeScope)
      const clearActive = result.activeDeleted && activeScope &&
        previous.activeSessionId === result.sessionId
      const currentCatalog = previous.sessionCatalogs[catalogKey]
      const rows = currentCatalog?.rows.filter((row) =>
        row.selectionToken !== selectionToken) ?? []
      return {
        ...previous,
        ...(activeScope
          ? {
              sessions: previous.sessions.filter((session) =>
                session.selectionToken !== selectionToken),
              ...(clearActive
                ? { activeId: '', activeSessionId: '' }
                : {}),
            }
          : {}),
        sessionCatalogs: {
          ...previous.sessionCatalogs,
          [catalogKey]: currentCatalog
            ? { ...currentCatalog, rows }
            : { status: 'loading', rows, errorMessage: null },
        },
        errorCode: null,
        errorMessage: null,
      }
    })

    try {
      await refreshCatalogFor(result.scope, true)
    } catch {
      // The deletion completed; refreshCatalogFor already exposes its own catalog error state.
    }
    return result
  }, [adapter, refreshCatalogFor, updateState])

  const renameSession = React.useCallback(async (
    scope: ConversationScope,
    selectionToken: SessionCatalogSelectionToken,
    title: string,
  ) => {
    const name = title.trim()
    if (!adapter || !name) return
    await runElectron(async () => {
      const result = await adapter.sessionCatalog.rename(
        scope,
        selectionToken,
        name,
      )
      try {
        await refreshCatalogFor(result.scope, true)
      } catch {
        // The rename completed. The scoped catalog exposes its own refresh
        // error without turning a successful metadata update into a failure.
      }
    })
  }, [adapter, refreshCatalogFor, runElectron])

  const duplicateSession = React.useCallback(async (
    scope: ConversationScope,
    selectionToken: SessionCatalogSelectionToken,
  ) => {
    if (!adapter) return
    await runElectron(async () => {
      const activation = await adapter.sessionCatalog.open(
        scope,
        selectionToken,
      )
      applyActivation(activation)
      let commandError: unknown
      let commandFailed = false
      try {
        await runOfficialCommand(adapter, { type: 'clone' })
      } catch (error) {
        commandFailed = true
        commandError = error
      }
      try {
        await refreshConversation(activation.scope)
      } catch (error) {
        if (!commandFailed) throw error
      }
      if (commandFailed) throw commandError
    })
  }, [adapter, applyActivation, refreshConversation, runElectron])

  const setWorkspacePinned = React.useCallback(async (
    workspaceId: string,
    pinned: boolean,
  ) => {
    if (!adapter) return
    await runElectron(async () => {
      const result = await adapter.workspace.setPinned(workspaceId, pinned)
      applyWorkspaceSnapshot(result.snapshot)
    })
  }, [adapter, applyWorkspaceSnapshot, runElectron])

  const searchWorkspacePaths = React.useCallback(async (query: string) => {
    const scope = stateRef.current.activeScope
    if (!adapter || scope.kind !== 'project') {
      throw new Error('Workspace paths are unavailable in a projectless chat.')
    }
    return adapter.files.search(scope.workspaceId, query)
  }, [adapter])

  const refreshContent = React.useCallback(
    () => refreshWorkspaceContentFor(stateRef.current.workspace),
    [refreshWorkspaceContentFor],
  )

  const refreshSessions = React.useCallback(
    () => refreshCatalogFor(stateRef.current.activeScope, true),
    [refreshCatalogFor],
  )

  const loadSessionCatalog = React.useCallback(
    (scope: ConversationScope, refresh = false) => refreshCatalogFor(scope, refresh),
    [refreshCatalogFor],
  )

  const value = React.useMemo<WorkspaceStoreValue>(() => ({
    ...state,
    chooseWorkspace,
    clearError,
    deleteSession,
    duplicateSession,
    loadSessionCatalog,
    newSession,
    openSession,
    openWorkspace,
    refreshContent,
    refreshSessions,
    renameSession,
    searchWorkspacePaths,
    setWorkspacePinned,
  }), [
    chooseWorkspace,
    clearError,
    deleteSession,
    duplicateSession,
    loadSessionCatalog,
    newSession,
    openSession,
    openWorkspace,
    refreshContent,
    refreshSessions,
    renameSession,
    searchWorkspacePaths,
    setWorkspacePinned,
    state,
  ])

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

export function useWorkspaceStore() {
  const store = React.useContext(WorkspaceContext)
  if (!store) throw new Error('useWorkspaceStore must be used within WorkspaceProvider')
  return store
}
