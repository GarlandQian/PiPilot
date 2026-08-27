import type { PiPilotApi } from '../../shared/pipilot-api'
import {
  cloneSettings,
  DEFAULT_SETTINGS,
  sanitizeSettings,
  type AppSettings,
  type AppSettingsPatch,
} from '../../shared/settings'
import type {
  SettingsResetScope,
  SettingsSnapshot,
} from '../../shared/ipc/contracts'

export const SETTINGS_CACHE_KEY = 'pipilot.settings.v1'

type SettingsListener = (snapshot: SettingsSnapshot) => void

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface SettingsAdapter {
  readonly mode: 'electron'
  getBootstrapSettings(): AppSettings
  load(): Promise<SettingsSnapshot>
  reset(scope: SettingsResetScope): Promise<SettingsSnapshot>
  subscribe(listener: SettingsListener): () => void
  update(patch: AppSettingsPatch): Promise<SettingsSnapshot>
}

function browserStorage(): StorageLike | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function readCachedSettings(storage: StorageLike | null = browserStorage()) {
  if (!storage) return cloneSettings(DEFAULT_SETTINGS)
  try {
    const raw = storage.getItem(SETTINGS_CACHE_KEY)
    return raw ? sanitizeSettings(JSON.parse(raw)) : cloneSettings(DEFAULT_SETTINGS)
  } catch {
    return cloneSettings(DEFAULT_SETTINGS)
  }
}

function writeCachedSettings(settings: AppSettings, storage: StorageLike | null) {
  if (!storage) return
  try {
    storage.setItem(SETTINGS_CACHE_KEY, JSON.stringify(settings))
  } catch {
    // The cache is a pre-paint hint, never the Electron authority.
  }
}

export class ElectronSettingsAdapter implements SettingsAdapter {
  readonly mode = 'electron' as const
  private readonly bootstrapSettings: AppSettings

  constructor(
    private readonly api: PiPilotApi['settings'],
    private readonly storage: StorageLike | null = browserStorage(),
  ) {
    this.bootstrapSettings = readCachedSettings(storage)
  }

  getBootstrapSettings() {
    return cloneSettings(this.bootstrapSettings)
  }

  async load() {
    const snapshot = await this.api.get()
    return this.cache(snapshot)
  }

  async update(patch: AppSettingsPatch) {
    return this.cache(await this.api.update(patch))
  }

  async reset(scope: SettingsResetScope) {
    return this.cache(await this.api.reset(scope))
  }

  subscribe(listener: SettingsListener) {
    return this.api.subscribe((snapshot) => listener(this.cache(snapshot)))
  }

  private cache(snapshot: SettingsSnapshot) {
    writeCachedSettings(snapshot.settings, this.storage)
    return snapshot
  }
}

export function createDefaultSettingsAdapter(): SettingsAdapter {
  if (typeof window === 'undefined' || !window.pipilot?.settings) {
    throw new Error('PiPilot settings require the Electron preload bridge.')
  }
  return new ElectronSettingsAdapter(window.pipilot.settings)
}
