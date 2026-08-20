import * as React from 'react'
import {
  cloneApplicationUpdateSnapshot,
  type ApplicationUpdateActionResult,
  type ApplicationUpdateSnapshot,
} from '@/shared/application-update'
import {
  createApplicationUpdateAdapter,
  type ApplicationUpdateAdapter,
} from '@/renderer/adapters/application-update-adapter'

export interface ApplicationUpdateState {
  mode: 'electron' | 'unavailable'
  snapshot: ApplicationUpdateSnapshot | null
  busy: boolean
  errorMessage: string | null
  dismissedVersion: string | null
}

export interface ApplicationUpdateActions {
  check(): Promise<ApplicationUpdateActionResult | null>
  download(): Promise<ApplicationUpdateActionResult | null>
  install(confirmActiveWork?: boolean): Promise<ApplicationUpdateActionResult | null>
  openRelease(): Promise<void>
  dismissNotice(): void
}

export interface ApplicationUpdateStoreValue
  extends ApplicationUpdateState,
    ApplicationUpdateActions {}

const ApplicationUpdateContext = React.createContext<ApplicationUpdateStoreValue | null>(null)

function messageFor(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    return error.message
  }
  return 'The application update operation failed.'
}

function snapshotFromResult(result: ApplicationUpdateActionResult) {
  return cloneApplicationUpdateSnapshot(result.snapshot)
}

export function ApplicationUpdateProvider({ children }: { children: React.ReactNode }) {
  const [adapter] = React.useState<ApplicationUpdateAdapter | null>(createApplicationUpdateAdapter)
  const [state, setState] = React.useState<ApplicationUpdateState>(() => ({
    mode: adapter ? 'electron' : 'unavailable',
    snapshot: null,
    busy: false,
    errorMessage: adapter ? null : 'The PiPilot desktop bridge is unavailable.',
    dismissedVersion: null,
  }))
  const stateRef = React.useRef(state)
  const requestEpoch = React.useRef(0)

  const update = React.useCallback((patch: Partial<ApplicationUpdateState>) => {
    setState((previous) => {
      const next = { ...previous, ...patch }
      stateRef.current = next
      return next
    })
  }, [])

  React.useEffect(() => {
    if (!adapter) return
    let active = true
    const accept = (snapshot: ApplicationUpdateSnapshot) => {
      if (!active) return
      const previousRevision = stateRef.current.snapshot?.revision ?? -1
      if (snapshot.revision < previousRevision) return
      update({ snapshot: cloneApplicationUpdateSnapshot(snapshot), errorMessage: null })
    }
    const unsubscribe = adapter.updates.subscribe(accept)
    void adapter.updates.get().then(accept).catch((error) => {
      if (active) update({ errorMessage: messageFor(error) })
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [adapter, update])

  const run = React.useCallback(async (
    operation: (updates: ApplicationUpdateAdapter['updates']) => Promise<ApplicationUpdateActionResult>,
  ) => {
    if (!adapter || stateRef.current.busy) return null
    const epoch = ++requestEpoch.current
    update({ busy: true, errorMessage: null })
    try {
      const result = await operation(adapter.updates)
      if (epoch === requestEpoch.current) {
        update({ snapshot: snapshotFromResult(result), busy: false, errorMessage: null })
      }
      return result
    } catch (error) {
      if (epoch === requestEpoch.current) update({ busy: false, errorMessage: messageFor(error) })
      return null
    }
  }, [adapter, update])

  const check = React.useCallback(() => run((updates) => updates.check()), [run])
  const download = React.useCallback(() => run((updates) => updates.download()), [run])
  const install = React.useCallback((confirmActiveWork = false) =>
    run((updates) => updates.install(confirmActiveWork)), [run])

  const openRelease = React.useCallback(async () => {
    if (!adapter) return
    const url = stateRef.current.snapshot && 'releaseUrl' in stateRef.current.snapshot
      ? stateRef.current.snapshot.releaseUrl
      : stateRef.current.snapshot?.policy.releaseUrl
    if (!url) return
    try {
      await adapter.shell.openExternal(url)
    } catch (error) {
      update({ errorMessage: messageFor(error) })
    }
  }, [adapter, update])

  const dismissNotice = React.useCallback(() => {
    const snapshot = stateRef.current.snapshot
    const version = snapshot && 'availableVersion' in snapshot
      ? snapshot.availableVersion
      : null
    update({ dismissedVersion: version })
  }, [update])

  const value = React.useMemo<ApplicationUpdateStoreValue>(() => ({
    ...state,
    check,
    download,
    install,
    openRelease,
    dismissNotice,
  }), [check, dismissNotice, download, install, openRelease, state])

  return <ApplicationUpdateContext.Provider value={value}>{children}</ApplicationUpdateContext.Provider>
}

export function useApplicationUpdate() {
  const value = React.useContext(ApplicationUpdateContext)
  if (!value) throw new Error('useApplicationUpdate must be used within ApplicationUpdateProvider')
  return value
}
