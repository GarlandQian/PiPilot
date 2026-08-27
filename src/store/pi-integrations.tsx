import * as React from 'react'
import {
  createPiIntegrationsAdapter,
  type PiIntegrationsAdapter,
} from '@/renderer/adapters/pi-integrations-adapter'
import {
  piIntegrationScopeKey,
  type PiIntegrationOperation,
  type PiIntegrationOperationResult,
  type PiIntegrationScope,
  type PiIntegrationSnapshot,
} from '@/shared/pi-integrations'
import { useWorkspaceStore } from '@/store/workspace'

export type PiIntegrationsStatus =
  | 'unavailable'
  | 'checking'
  | 'loading'
  | 'ready'
  | 'operating'
  | 'restart-required'
  | 'error'

export interface PiIntegrationsState {
  mode: 'electron' | 'unavailable'
  status: PiIntegrationsStatus
  scope: PiIntegrationScope
  snapshot: PiIntegrationSnapshot | null
  operation: PiIntegrationOperation | null
  errorCode: string | null
  errorMessage: string | null
}

export interface PiIntegrationsActions {
  checkUpdates(): Promise<void>
  clearError(): void
  install(source: string): Promise<void>
  loadScope(scope: PiIntegrationScope): Promise<PiIntegrationSnapshot | null>
  refresh(): Promise<void>
  remove(source: string): Promise<void>
  restart(): Promise<void>
  setRetryEnabled(enabled: boolean): Promise<PiIntegrationOperationResult | null>
  setScope(scope: PiIntegrationScope): void
  update(source: string): Promise<void>
}

export interface PiIntegrationsStoreValue
  extends PiIntegrationsState,
  PiIntegrationsActions {}

const PiIntegrationsContext = React.createContext<PiIntegrationsStoreValue | null>(null)

function errorDetails(error: unknown) {
  let code = 'PI_INTEGRATIONS_OPERATION_FAILED'
  let message = error instanceof Error
    ? error.message
    : 'The Pi integration operation failed.'
  if (typeof error === 'object' && error !== null) {
    if ('code' in error && typeof error.code === 'string') code = error.code
    if ('message' in error && typeof error.message === 'string') message = error.message
  }
  return { code, message }
}

function statusFor(
  snapshot: PiIntegrationSnapshot | null,
  operation?: PiIntegrationOperation | null,
): PiIntegrationsStatus {
  if (operation && ['queued', 'running', 'progress'].includes(operation.phase)) {
    return 'operating'
  }
  if (!snapshot) return 'loading'
  if (snapshot.state === 'unavailable') return 'unavailable'
  return snapshot.restartRequired ? 'restart-required' : 'ready'
}

function initialScope(
  activeScope: ReturnType<typeof useWorkspaceStore>['activeScope'],
): PiIntegrationScope {
  return activeScope.kind === 'project'
    ? { kind: 'project', workspaceId: activeScope.workspaceId }
    : { kind: 'global' }
}

export function PiIntegrationsProvider({ children }: { children: React.ReactNode }) {
  const workspace = useWorkspaceStore()
  const [adapter] = React.useState<PiIntegrationsAdapter | null>(createPiIntegrationsAdapter)
  const [state, setState] = React.useState<PiIntegrationsState>(() => ({
    mode: adapter ? 'electron' : 'unavailable',
    status: adapter ? 'checking' : 'unavailable',
    scope: initialScope(workspace.activeScope),
    snapshot: null,
    operation: null,
    errorCode: adapter ? null : 'PIPILOT_PRELOAD_UNAVAILABLE',
    errorMessage: adapter ? null : 'The PiPilot desktop bridge is unavailable.',
  }))
  const stateRef = React.useRef(state)
  const requestEpoch = React.useRef(0)

  const updateState = React.useCallback((
    update: (previous: PiIntegrationsState) => PiIntegrationsState,
  ) => {
    const previous = stateRef.current
    const next = update(previous)
    if (Object.is(previous, next)) return
    stateRef.current = next
    setState(next)
  }, [])

  const fail = React.useCallback((error: unknown, epoch: number) => {
    if (epoch !== requestEpoch.current) return
    const details = errorDetails(error)
    updateState((previous) => ({
      ...previous,
      status: 'error',
      errorCode: details.code,
      errorMessage: details.message,
    }))
  }, [updateState])

  const applySnapshot = React.useCallback((
    snapshot: PiIntegrationSnapshot,
    epoch: number,
    expectedScope: PiIntegrationScope,
  ) => {
    if (
      epoch !== requestEpoch.current ||
      piIntegrationScopeKey(stateRef.current.scope) !== piIntegrationScopeKey(expectedScope) ||
      piIntegrationScopeKey(snapshot.scope) !== piIntegrationScopeKey(expectedScope)
    ) return false
    updateState((previous) => ({
      ...previous,
      snapshot,
      status: statusFor(snapshot, previous.operation),
      errorCode: null,
      errorMessage: null,
    }))
    return true
  }, [updateState])

  const refresh = React.useCallback(async () => {
    if (!adapter) return
    const epoch = ++requestEpoch.current
    const scope = stateRef.current.scope
    updateState((previous) => ({
      ...previous,
      status: previous.snapshot ? 'loading' : 'checking',
      errorCode: null,
      errorMessage: null,
    }))
    try {
      applySnapshot(await adapter.load(scope), epoch, scope)
    } catch (error) {
      fail(error, epoch)
    }
  }, [adapter, applySnapshot, fail, updateState])

  const runOperation = React.useCallback(async (
    invoke: (adapter: PiIntegrationsAdapter, scope: PiIntegrationScope) =>
      Promise<PiIntegrationOperationResult>,
  ) => {
    if (!adapter) return null
    const epoch = ++requestEpoch.current
    const scope = stateRef.current.scope
    updateState((previous) => ({
      ...previous,
      status: 'operating',
      errorCode: null,
      errorMessage: null,
    }))
    try {
      const result = await invoke(adapter, scope)
      applySnapshot(result.snapshot, epoch, scope)
      return result
    } catch (error) {
      fail(error, epoch)
      return null
    }
  }, [adapter, applySnapshot, fail, updateState])

  const setScope = React.useCallback((scope: PiIntegrationScope) => {
    if (piIntegrationScopeKey(scope) === piIntegrationScopeKey(stateRef.current.scope)) return
    requestEpoch.current += 1
    updateState((previous) => ({
      ...previous,
      scope,
      snapshot: null,
      operation: null,
      status: adapter ? 'loading' : 'unavailable',
      errorCode: null,
      errorMessage: null,
    }))
  }, [adapter, updateState])

  React.useEffect(() => {
    const current = stateRef.current.scope
    if (current.kind !== 'project') return
    if (
      workspace.activeScope.kind !== 'project' ||
      workspace.activeScope.workspaceId !== current.workspaceId
    ) {
      setScope(initialScope(workspace.activeScope))
    }
  }, [setScope, workspace.activeScope])

  React.useEffect(() => {
    if (!adapter) return
    const unsubscribeOperations = adapter.subscribe((operation) => {
      if (
        piIntegrationScopeKey(operation.scope) !==
        piIntegrationScopeKey(stateRef.current.scope)
      ) return
      updateState((previous) => ({
        ...previous,
        operation,
        status: operation.phase === 'failed'
          ? 'error'
          : statusFor(previous.snapshot, operation),
        ...(operation.phase === 'failed'
          ? {
              errorCode: 'PI_INTEGRATIONS_OPERATION_FAILED',
              errorMessage: operation.message ?? 'The operation failed.',
            }
          : {}),
      }))
    })
    return () => {
      unsubscribeOperations()
    }
  }, [adapter, refresh, updateState])

  React.useEffect(() => {
    void refresh()
  }, [refresh, state.scope])

  const actions = React.useMemo<PiIntegrationsActions>(() => ({
    checkUpdates: async () => {
      await runOperation((nextAdapter, scope) => nextAdapter.checkUpdates(scope))
    },
    clearError: () => updateState((previous) => ({
      ...previous,
      errorCode: null,
      errorMessage: null,
      status: previous.snapshot
        ? statusFor(previous.snapshot, previous.operation)
        : previous.mode === 'electron' ? 'loading' : 'unavailable',
    })),
    install: async (source) => {
      await runOperation((nextAdapter, scope) => nextAdapter.install(scope, source))
    },
    loadScope: async (scope) => adapter ? adapter.load(scope) : null,
    refresh,
    remove: async (source) => {
      await runOperation((nextAdapter, scope) => nextAdapter.remove(scope, source))
    },
    restart: async () => {
      await runOperation((nextAdapter, scope) => nextAdapter.restart(scope))
    },
    setRetryEnabled: (enabled) => runOperation((nextAdapter, scope) =>
      nextAdapter.setRetryEnabled(scope, enabled)),
    setScope,
    update: async (source) => {
      await runOperation((nextAdapter, scope) => nextAdapter.update(scope, source))
    },
  }), [adapter, refresh, runOperation, setScope, updateState])

  const value = React.useMemo<PiIntegrationsStoreValue>(
    () => ({ ...state, ...actions }),
    [actions, state],
  )

  return (
    <PiIntegrationsContext.Provider value={value}>
      {children}
    </PiIntegrationsContext.Provider>
  )
}

export function usePiIntegrations() {
  const store = React.useContext(PiIntegrationsContext)
  if (!store) {
    throw new Error('usePiIntegrations must be used within PiIntegrationsProvider')
  }
  return store
}
