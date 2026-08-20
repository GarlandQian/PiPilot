import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { SettingsRepository } from '../../src/main/repositories/settings-repository'
import {
  ElectronSettingsAdapter,
  SETTINGS_CACHE_KEY,
} from '../../src/renderer/adapters/settings-adapter'
import { createSettingsStore } from '../../src/store/settings'
import {
  cloneSettings,
  DEFAULT_SETTINGS,
  parseSettingsDocument,
  sanitizeSettings,
  SETTINGS_SCHEMA_VERSION,
  type AppSettings,
} from '../../src/shared/settings'
import type { PiPilotApi } from '../../src/shared/pipilot-api'
import type { SettingsAdapter } from '../../src/renderer/adapters/settings-adapter'
import type { SettingsSnapshot } from '../../src/shared/ipc/contracts'

class MemoryStorage {
  private readonly values = new Map<string, string>()

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

function darkEnglishSettings(): AppSettings {
  return {
    ...cloneSettings(DEFAULT_SETTINGS),
    locale: 'en-US',
    appearance: {
      ...cloneSettings(DEFAULT_SETTINGS).appearance,
      theme: 'dark',
      uiFontSize: 16,
    },
  }
}

describe('current settings schema', () => {
  it('accepts only a complete current document', () => {
    expect(parseSettingsDocument({
      version: SETTINGS_SCHEMA_VERSION,
      settings: darkEnglishSettings(),
    })).toEqual({
      version: SETTINGS_SCHEMA_VERSION,
      settings: darkEnglishSettings(),
    })

    const { terminal: _terminal, ...withoutTerminal } = darkEnglishSettings()
    expect(() => parseSettingsDocument({
      version: SETTINGS_SCHEMA_VERSION,
      settings: withoutTerminal,
    })).toThrow()

    const { composer: _composer, ...withoutComposer } = darkEnglishSettings()
    expect(() => parseSettingsDocument({
      version: SETTINGS_SCHEMA_VERSION,
      settings: withoutComposer,
    })).toThrow()

    expect(() => parseSettingsDocument({
      version: SETTINGS_SCHEMA_VERSION,
      settings: {
        ...darkEnglishSettings(),
        terminal: { fontFamily: 42, fontSize: 16 },
      },
    })).toThrow()

    expect(() => parseSettingsDocument({
      version: SETTINGS_SCHEMA_VERSION,
      settings: { locale: 'en-US' },
    })).toThrow()
  })

  it('rejects unknown future versions instead of guessing', () => {
    expect(() => parseSettingsDocument({ version: 99, settings: {} })).toThrow()
  })

  it('uses terminal defaults for missing or malformed cached fields', () => {
    const malformed = sanitizeSettings({
      ...darkEnglishSettings(),
      terminal: { fontFamily: 42, fontSize: 99 },
    })
    expect(malformed.terminal).toEqual(DEFAULT_SETTINGS.terminal)

    const valid = sanitizeSettings({
      ...darkEnglishSettings(),
      terminal: { fontFamily: 'Maple Mono', fontSize: 16 },
    })
    expect(valid.terminal).toEqual({ fontFamily: 'Maple Mono', fontSize: 16 })
  })
})

describe('SettingsRepository', () => {
  it('creates current defaults and persists later updates only after flush', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pipilot-settings-'))
    const filePath = join(directory, 'settings.json')
    const diagnostics: string[] = []
    const repository = new SettingsRepository(filePath, {
      createId: () => 'test-id',
      debounceMs: 60_000,
      onDiagnostic: (code) => diagnostics.push(code),
    })

    try {
      const initialized = repository.initialize()
      expect(initialized.settings).toEqual(DEFAULT_SETTINGS)
      expect(diagnostics).toEqual(['created'])

      const changed = repository.update({
        locale: 'en-US',
        appearance: { theme: 'dark', uiFontSize: 16 },
        composer: { sendShortcut: 'mod-enter' },
        terminal: { fontFamily: 'Fira Code', fontSize: 16 },
      })
      expect(changed.settings.appearance.theme).toBe('dark')
      expect(changed.settings.composer.sendShortcut).toBe('mod-enter')
      expect(changed.settings.terminal).toEqual({ fontFamily: 'Fira Code', fontSize: 16 })
      const beforeFlush = JSON.parse(await readFile(filePath, 'utf8')) as {
        settings: AppSettings
      }
      expect(beforeFlush.settings.appearance.theme).toBe('system')

      repository.flush()
      const afterFlush = JSON.parse(await readFile(filePath, 'utf8')) as {
        version: number
        settings: AppSettings
      }
      expect(afterFlush).toMatchObject({ version: SETTINGS_SCHEMA_VERSION })
      expect(afterFlush.settings.appearance.theme).toBe('dark')
      expect(afterFlush.settings.composer.sendShortcut).toBe('mod-enter')
      expect(afterFlush.settings.terminal).toEqual({ fontFamily: 'Fira Code', fontSize: 16 })
    } finally {
      repository.dispose()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('rejects an incomplete settings document and recovers current defaults', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pipilot-settings-'))
    const filePath = join(directory, 'settings.json')
    const diagnostics: string[] = []
    const { composer: _composer, ...legacySettings } = darkEnglishSettings()
    await writeFile(
      filePath,
      JSON.stringify({ version: 1, settings: legacySettings }),
      'utf8',
    )
    const repository = new SettingsRepository(filePath, {
      createId: () => 'test-id',
      onDiagnostic: (code) => diagnostics.push(code),
    })

    try {
      const snapshot = repository.initialize()
      expect(snapshot.settings).toEqual(DEFAULT_SETTINGS)
      expect(diagnostics).toEqual(['recovered-corrupt'])
      expect(JSON.parse(await readFile(filePath, 'utf8'))).toMatchObject({
        version: SETTINGS_SCHEMA_VERSION,
        settings: snapshot.settings,
      })
    } finally {
      repository.dispose()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('backs up corrupt content and recovers defaults without exposing it in diagnostics', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pipilot-settings-'))
    const filePath = join(directory, 'settings.json')
    const diagnostics: string[] = []
    await writeFile(filePath, '{"apiKey":"secret", broken', 'utf8')
    const repository = new SettingsRepository(filePath, {
      createId: () => 'backup-id',
      now: () => Date.UTC(2026, 7, 7, 0, 0, 0),
      onDiagnostic: (code) => diagnostics.push(code),
    })

    try {
      expect(repository.initialize().settings).toEqual(DEFAULT_SETTINGS)
      expect(diagnostics).toEqual(['recovered-corrupt'])
      expect(diagnostics.join(' ')).not.toContain('secret')
      const files = await readdir(directory)
      expect(files).toContain('settings.json')
      expect(files).toContain('settings.json.corrupt-2026-08-07T00-00-00-000Z-backup-id.bak')
      expect(await readFile(join(directory, files.find((file) => file.endsWith('.bak'))!), 'utf8'))
        .toContain('secret')
    } finally {
      repository.dispose()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('resets appearance without resetting locale', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pipilot-settings-'))
    const repository = new SettingsRepository(join(directory, 'settings.json'), {
      createId: () => 'test-id',
      debounceMs: 0,
    })

    try {
      repository.initialize()
      repository.update({
        locale: 'en-US',
        appearance: { theme: 'dark', uiFontSize: 16 },
      })
      const reset = repository.reset('appearance')
      expect(reset.settings.locale).toBe('en-US')
      expect(reset.settings.appearance).toEqual(DEFAULT_SETTINGS.appearance)
    } finally {
      repository.dispose()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('resets only terminal typography', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pipilot-settings-'))
    const repository = new SettingsRepository(join(directory, 'settings.json'), {
      createId: () => 'test-id',
      debounceMs: 0,
    })

    try {
      repository.initialize()
      repository.update({
        locale: 'en-US',
        appearance: { theme: 'dark' },
        terminal: { fontFamily: 'Maple Mono', fontSize: 17 },
      })
      const reset = repository.reset('terminal')
      expect(reset.settings.locale).toBe('en-US')
      expect(reset.settings.appearance.theme).toBe('dark')
      expect(reset.settings.terminal).toEqual(DEFAULT_SETTINGS.terminal)
    } finally {
      repository.dispose()
      await rm(directory, { recursive: true, force: true })
    }
  })
})

describe('settings adapters and store', () => {
  it('treats localStorage as a cache while Electron API remains authoritative', async () => {
    const storage = new MemoryStorage()
    storage.setItem(SETTINGS_CACHE_KEY, JSON.stringify(darkEnglishSettings()))
    const authoritative = {
      revision: 4,
      settings: { ...cloneSettings(DEFAULT_SETTINGS), locale: 'zh-CN' as const },
    }
    const get = vi.fn(async () => authoritative)
    const api: PiPilotApi['settings'] = {
      get,
      reset: vi.fn(async () => authoritative),
      subscribe: vi.fn(() => () => undefined),
      update: vi.fn(async () => authoritative),
    }
    const adapter = new ElectronSettingsAdapter(api, storage)

    expect(adapter.getBootstrapSettings()).toEqual(darkEnglishSettings())
    await expect(adapter.load()).resolves.toEqual(authoritative)
    expect(get).toHaveBeenCalledWith()
    expect(JSON.parse(storage.getItem(SETTINGS_CACHE_KEY)!)).toEqual(authoritative.settings)
  })

  it('updates the renderer immediately and reconciles the confirmed snapshot', async () => {
    let resolveUpdate: ((snapshot: SettingsSnapshot) => void) | undefined
    const listeners = new Set<(snapshot: SettingsSnapshot) => void>()
    const adapter: SettingsAdapter = {
      mode: 'electron',
      getBootstrapSettings: () => cloneSettings(DEFAULT_SETTINGS),
      load: async () => ({ revision: 1, settings: cloneSettings(DEFAULT_SETTINGS) }),
      reset: async () => ({ revision: 1, settings: cloneSettings(DEFAULT_SETTINGS) }),
      subscribe(listener) {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
      update: () => new Promise((resolve) => {
        resolveUpdate = resolve
      }),
    }
    const store = createSettingsStore(adapter)
    await store.whenReady()

    store.updateAppearance({ theme: 'dark' })
    expect(store.get().appearance.theme).toBe('dark')

    resolveUpdate?.({
      revision: 2,
      settings: { ...cloneSettings(DEFAULT_SETTINGS), locale: 'en-US' },
    })
    await vi.waitFor(() => expect(store.get().locale).toBe('en-US'))
    expect(store.get().appearance.theme).toBe('system')

    store.updateTerminal({ fontFamily: 'Maple Mono', fontSize: 16 })
    expect(store.get().terminal).toEqual({ fontFamily: 'Maple Mono', fontSize: 16 })
    resolveUpdate?.({
      revision: 3,
      settings: {
        ...cloneSettings(DEFAULT_SETTINGS),
        locale: 'en-US',
        terminal: { fontFamily: 'Maple Mono', fontSize: 16 },
      },
    })
    await vi.waitFor(() => expect(store.get().terminal.fontFamily).toBe('Maple Mono'))
    store.dispose()
  })
})
