import * as React from 'react'
import {
  createExternalControlAdapter,
  type ExternalControlAdapter,
} from '@/renderer/adapters/external-control-adapter'
import type { ExternalControlSettingsSnapshot } from '@/shared/external-control'

export interface ExternalControlState {
  mode: 'electron' | 'unavailable'
  snapshot: ExternalControlSettingsSnapshot | null
  errorMessage: string | null
}

export interface ExternalControlStoreValue extends ExternalControlState {
  setEnabled(enabled: boolean): Promise<ExternalControlSettingsSnapshot | null>
  retry(): Promise<ExternalControlSettingsSnapshot | null>
}

const ExternalControlContext = React.createContext<ExternalControlStoreValue | null>(null)

function errorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
  ) return error.message
  return 'The External Control operation failed.'
}

export function selectExternalControlSnapshot(
  current: ExternalControlSettingsSnapshot | null,
  candidate: ExternalControlSettingsSnapshot,
) {
  return candidate.revision < (current?.revision ?? -1)
    ? current
    : structuredClone(candidate)
}

export function ExternalControlProvider({ children }: { children: React.ReactNode }) {
  const [adapter] = React.useState<ExternalControlAdapter | null>(
    createExternalControlAdapter,
  )
  const [state, setState] = React.useState<ExternalControlState>(() => ({
    mode: adapter ? 'electron' : 'unavailable',
    snapshot: null,
    errorMessage: adapter ? null : 'The PiPilot desktop bridge is unavailable.',
  }))
  const stateRef = React.useRef(state)
  const requestEpoch = React.useRef(0)

  const update = React.useCallback((patch: Partial<ExternalControlState>) => {
    setState((previous) => {
      const next = { ...previous, ...patch }
      stateRef.current = next
      return next
    })
  }, [])

  const acceptSnapshot = React.useCallback((snapshot: ExternalControlSettingsSnapshot) => {
    setState((previous) => {
      const accepted = selectExternalControlSnapshot(previous.snapshot, snapshot)
      if (accepted === previous.snapshot) return previous
      const next = { ...previous, snapshot: accepted, errorMessage: null }
      stateRef.current = next
      return next
    })
  }, [])

  React.useEffect(() => {
    if (!adapter) return
    let active = true
    const accept = (snapshot: ExternalControlSettingsSnapshot) => {
      if (active) acceptSnapshot(snapshot)
    }
    const unsubscribe = adapter.subscribe(accept)
    void adapter.get().then(accept).catch((error) => {
      if (!active) return
      setState((previous) => {
        if (previous.snapshot) return previous
        const next = { ...previous, errorMessage: errorMessage(error) }
        stateRef.current = next
        return next
      })
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [acceptSnapshot, adapter, update])

  const setEnabled = React.useCallback(async (enabled: boolean) => {
    if (!adapter) return null
    const epoch = ++requestEpoch.current
    const startingRevision = stateRef.current.snapshot?.revision ?? -1
    try {
      const snapshot = await adapter.setEnabled(enabled)
      if (epoch === requestEpoch.current) {
        acceptSnapshot(snapshot)
      }
      return snapshot
    } catch (error) {
      const currentRevision = stateRef.current.snapshot?.revision ?? -1
      if (epoch === requestEpoch.current && currentRevision <= startingRevision) {
        update({ errorMessage: errorMessage(error) })
      }
      return null
    }
  }, [acceptSnapshot, adapter, update])

  const retry = React.useCallback(async () => {
    if (!adapter) return null
    const current = stateRef.current.snapshot
    if (current) return setEnabled(current.enabled)

    const epoch = ++requestEpoch.current
    const startingRevision = stateRef.current.snapshot?.revision ?? -1
    try {
      const snapshot = await adapter.get()
      if (epoch === requestEpoch.current) acceptSnapshot(snapshot)
      return snapshot
    } catch (error) {
      const currentRevision = stateRef.current.snapshot?.revision ?? -1
      if (epoch === requestEpoch.current && currentRevision <= startingRevision) {
        update({ errorMessage: errorMessage(error) })
      }
      return null
    }
  }, [acceptSnapshot, adapter, setEnabled, update])

  const value = React.useMemo<ExternalControlStoreValue>(() => ({
    ...state,
    setEnabled,
    retry,
  }), [retry, setEnabled, state])

  return (
    <ExternalControlContext.Provider value={value}>
      {children}
    </ExternalControlContext.Provider>
  )
}

export function useExternalControl() {
  const value = React.useContext(ExternalControlContext)
  if (!value) {
    throw new Error('useExternalControl must be used within ExternalControlProvider')
  }
  return value
}
