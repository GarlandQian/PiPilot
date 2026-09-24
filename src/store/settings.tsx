import * as React from 'react'
import {
  createDefaultSettingsAdapter,
  type SettingsAdapter,
} from '@/renderer/adapters/settings-adapter'
import {
  cloneSettings,
  DEFAULT_SETTINGS,
  mergeSettings,
  type AppSettings,
  type AppSettingsPatch,
  type AppearanceSettings,
  type TerminalSettings,
} from '@/shared/settings'
import type { SettingsSnapshot } from '@/shared/ipc/contracts'

type Listener = (settings: AppSettings) => void
export type SettingsSaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export function createSettingsStore(
  adapter: SettingsAdapter = createDefaultSettingsAdapter(),
) {
  let settings = adapter.getBootstrapSettings()
  let confirmedSettings = cloneSettings(settings)
  let confirmedRevision = 0
  let pendingOperations = 0
  let disposed = false
  const listeners = new Set<Listener>()
  const statusListeners = new Set<() => void>()
  let saveStatus: SettingsSaveStatus = 'idle'
  let batchFailed = false
  const publishStatus = (next: SettingsSaveStatus) => {
    if (disposed || saveStatus === next) return
    saveStatus = next
    for (const listener of statusListeners) listener()
  }

  const notify = () => {
    if (disposed) return
    for (const listener of listeners) listener(settings)
  }

  const publishConfirmed = () => {
    settings = cloneSettings(confirmedSettings)
    notify()
  }

  const acceptSnapshot = (snapshot: SettingsSnapshot) => {
    if (disposed || snapshot.revision < confirmedRevision) return
    confirmedRevision = snapshot.revision
    confirmedSettings = cloneSettings(snapshot.settings)
    if (pendingOperations === 0) publishConfirmed()
  }

  const recover = async () => {
    try {
      acceptSnapshot(await adapter.load())
    } catch {
      // Keep the latest confirmed state; privileged diagnostics remain in Main.
    }
  }

  const mutate = (
    optimisticSettings: AppSettings,
    operation: () => Promise<SettingsSnapshot>,
  ) => {
    if (disposed) return Promise.resolve(false)
    if (pendingOperations === 0) batchFailed = false
    pendingOperations += 1
    settings = optimisticSettings
    publishStatus('saving')
    notify()

    let result: Promise<SettingsSnapshot>
    try { result = operation() } catch (error) { result = Promise.reject(error) }
    return result
      .then((snapshot) => { acceptSnapshot(snapshot); return true })
      .catch(async () => {
        batchFailed = true
        await recover()
        return false
      })
      .finally(() => {
        pendingOperations -= 1
        if (pendingOperations === 0) {
          publishConfirmed()
          publishStatus(batchFailed ? 'error' : 'saved')
        }
      })
  }

  const detachAdapter = adapter.subscribe(acceptSnapshot)
  const readyPromise = adapter.load().then(acceptSnapshot).catch(() => undefined)

  return {
    mode: adapter.mode,
    get(): AppSettings {
      return settings
    },
    getSaveStatus(): SettingsSaveStatus { return saveStatus },
    subscribeSaveStatus(listener: () => void) {
      statusListeners.add(listener)
      return () => { statusListeners.delete(listener) }
    },
    update(patch: AppSettingsPatch) {
      const next = mergeSettings(settings, patch)
      mutate(next, () => adapter.update(patch))
    },
    updateAppearance(patch: Partial<AppearanceSettings>) {
      const settingsPatch: AppSettingsPatch = { appearance: patch }
      const next = mergeSettings(settings, settingsPatch)
      mutate(next, () => adapter.update(settingsPatch))
    },
    updateTerminal(patch: Partial<TerminalSettings>) {
      const settingsPatch: AppSettingsPatch = { terminal: patch }
      const next = mergeSettings(settings, settingsPatch)
      return mutate(next, () => adapter.update(settingsPatch))
    },
    resetAppearance() {
      const next = {
        ...settings,
        appearance: cloneSettings(DEFAULT_SETTINGS).appearance,
      }
      mutate(next, () => adapter.reset('appearance'))
    },
    resetTerminal() {
      const next = {
        ...settings,
        terminal: {
          ...settings.terminal,
          fontFamily: DEFAULT_SETTINGS.terminal.fontFamily,
          fontSize: DEFAULT_SETTINGS.terminal.fontSize,
        },
      }
      mutate(next, () => adapter.reset('terminal'))
    },
    subscribe(listener: Listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    async whenReady() {
      await readyPromise
    },
    dispose() {
      if (disposed) return
      disposed = true
      detachAdapter()
      listeners.clear()
      statusListeners.clear()
    },
  }
}

export type SettingsStore = ReturnType<typeof createSettingsStore>

const SettingsContext = React.createContext<SettingsStore | null>(null)

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [store] = React.useState(() => createSettingsStore())

  React.useEffect(() => () => store.dispose(), [store])

  return <SettingsContext.Provider value={store}>{children}</SettingsContext.Provider>
}

function useStore(): SettingsStore {
  const store = React.useContext(SettingsContext)
  if (!store) throw new Error('useSettings must be used within SettingsProvider')
  return store
}

export function useSettings(): AppSettings {
  const store = useStore()
  return React.useSyncExternalStore(store.subscribe, store.get, store.get)
}

export function useUpdateSettings() {
  const store = useStore()
  return React.useMemo(
    () => ({
      update: store.update,
      updateAppearance: store.updateAppearance,
      updateTerminal: store.updateTerminal,
      resetAppearance: store.resetAppearance,
      resetTerminal: store.resetTerminal,
    }),
    [store],
  )
}

export function useSettingsSaveStatus(): SettingsSaveStatus {
  const store = useStore()
  return React.useSyncExternalStore(store.subscribeSaveStatus, store.getSaveStatus, store.getSaveStatus)
}
