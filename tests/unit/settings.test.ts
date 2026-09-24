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

const customShell = {
  id: 'custom:fixture', name: 'Project shell', executable: '/bin/sh',
  args: ['-l'], env: { PIPILOT_TEST: 'literal $(whoami)', REMOVE_ME: null },
}

describe('current settings schema', () => {
  it('adds notification preferences without discarding existing appearance or shell profiles', () => {
    const { notifications: _notifications, ...existing } = darkEnglishSettings()
    existing.terminal = { ...existing.terminal, defaultProfileId: customShell.id, profiles: [customShell] }
    const migrated = parseSettingsDocument({ version: SETTINGS_SCHEMA_VERSION, settings: existing }).settings
    expect(migrated).toEqual({ ...existing, notifications: { desktop: true } })
    expect(parseSettingsDocument({ version: SETTINGS_SCHEMA_VERSION, settings: { ...migrated, notifications: { desktop: false } } }).settings.notifications.desktop).toBe(false)
    expect(() => parseSettingsDocument({ version: SETTINGS_SCHEMA_VERSION, settings: { ...migrated, notifications: { desktop: 'yes' } } })).toThrow()
  })
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

  it('migrates the previous Composer shape to queueing by default', () => {
    const current = darkEnglishSettings()
    const legacy = {
      ...current,
      composer: { sendShortcut: current.composer.sendShortcut },
    }

    expect(parseSettingsDocument({
      version: SETTINGS_SCHEMA_VERSION,
      settings: legacy,
    }).settings.composer).toEqual({
      sendShortcut: 'enter',
      runningSubmit: 'queue',
    })
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
    expect(valid.terminal).toEqual({ ...DEFAULT_SETTINGS.terminal, fontFamily: 'Maple Mono', fontSize: 16 })
  })

  it('preserves existing appearance and terminal typography when adding shell preferences', () => {
    for (const composer of [darkEnglishSettings().composer, { sendShortcut: 'mod-enter' }]) {
      const previous = { ...darkEnglishSettings(), composer, terminal: { fontFamily: 'Maple Mono', fontSize: 16 } }
      const migrated = parseSettingsDocument({ version: SETTINGS_SCHEMA_VERSION, settings: previous }).settings
      expect(migrated.appearance).toEqual(previous.appearance)
      expect(migrated.terminal).toEqual({ ...DEFAULT_SETTINGS.terminal, ...previous.terminal })
      expect(migrated.composer.sendShortcut).toBe(composer.sendShortcut)
    }
  })

  it('preserves a missing explicit default and rejects malformed or duplicate custom profiles', () => {
    const settings = {
      ...darkEnglishSettings(),
      terminal: { ...DEFAULT_SETTINGS.terminal, defaultProfileId: 'detected:missing', profiles: [customShell] },
    }
    const parsed = parseSettingsDocument({ version: SETTINGS_SCHEMA_VERSION, settings }).settings
    expect(parsed.terminal).toEqual(settings.terminal)
    parsed.terminal.profiles[0]!.args.push('changed')
    expect(customShell.args).toEqual(['-l'])
    for (const profiles of [[customShell, customShell], [{ ...customShell, args: ['bad\0arg'] }], [{ ...customShell, id: 'detected:spoofed' }]]) {
      expect(() => parseSettingsDocument({
        version: SETTINGS_SCHEMA_VERSION, settings: { ...settings, terminal: { ...settings.terminal, profiles } },
      })).toThrow()
    }
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
        composer: { sendShortcut: 'mod-enter', runningSubmit: 'steer' },
        terminal: { fontFamily: 'Fira Code', fontSize: 16 },
      })
      expect(changed.settings.appearance.theme).toBe('dark')
      expect(changed.settings.composer.sendShortcut).toBe('mod-enter')
      expect(changed.settings.composer.runningSubmit).toBe('steer')
      expect(changed.settings.terminal).toEqual({ ...DEFAULT_SETTINGS.terminal, fontFamily: 'Fira Code', fontSize: 16 })
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
      expect(afterFlush.settings.composer.runningSubmit).toBe('steer')
      expect(afterFlush.settings.terminal).toEqual({ ...DEFAULT_SETTINGS.terminal, fontFamily: 'Fira Code', fontSize: 16 })
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
        terminal: { fontFamily: 'Maple Mono', fontSize: 17, defaultProfileId: customShell.id, profiles: [customShell] },
      })
      const reset = repository.reset('terminal')
      expect(reset.settings.locale).toBe('en-US')
      expect(reset.settings.appearance.theme).toBe('dark')
      expect(reset.settings.terminal).toEqual({ ...DEFAULT_SETTINGS.terminal, defaultProfileId: customShell.id, profiles: [customShell] })
      repository.flush()
      expect(JSON.parse(await readFile(join(directory, 'settings.json'), 'utf8')).settings.terminal).toEqual(reset.settings.terminal)
    } finally {
      repository.dispose()
      await rm(directory, { recursive: true, force: true })
    }
  })
})

describe('settings adapters and store', () => {
  function controlledAdapter() {
    const pending: { resolve(snapshot: SettingsSnapshot): void; reject(reason: Error): void }[] = []
    const adapter: SettingsAdapter = {
      mode: 'electron',
      getBootstrapSettings: () => cloneSettings(DEFAULT_SETTINGS),
      load: vi.fn(async () => ({ revision: 1, settings: cloneSettings(DEFAULT_SETTINGS) })),
      reset: () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
      update: () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
      subscribe: () => () => undefined,
    }
    return { adapter, pending }
  }

  it('reports saving until all outstanding preferences have been confirmed', async () => {
    const { adapter, pending } = controlledAdapter()
    const store = createSettingsStore(adapter)
    await store.whenReady()
    const changes: string[] = []
    store.subscribeSaveStatus(() => changes.push(store.getSaveStatus()))
    expect(store.getSaveStatus()).toBe('idle')
    store.updateAppearance({ theme: 'dark' })
    store.update({ locale: 'en-US' })
    expect(store.getSaveStatus()).toBe('saving')
    pending[1].resolve({ revision: 3, settings: darkEnglishSettings() })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(store.getSaveStatus()).toBe('saving')
    pending[0].resolve({ revision: 2, settings: cloneSettings(DEFAULT_SETTINGS) })
    await vi.waitFor(() => expect(store.getSaveStatus()).toBe('saved'))
    expect(changes).toEqual(['saving', 'saved'])
    expect(store.get()).toEqual(darkEnglishSettings())
    store.dispose()
  })

  it('acknowledges profile form saves only after persistence and reports failures to retain drafts', async () => {
    const { adapter, pending } = controlledAdapter()
    const store = createSettingsStore(adapter)
    await store.whenReady()
    const successful = store.updateTerminal({ profiles: [customShell], defaultProfileId: customShell.id })
    expect(store.getSaveStatus()).toBe('saving')
    const confirmed = { ...cloneSettings(DEFAULT_SETTINGS), terminal: { ...DEFAULT_SETTINGS.terminal, profiles: [customShell], defaultProfileId: customShell.id } }
    pending[0].resolve({ revision: 2, settings: confirmed })
    await expect(successful).resolves.toBe(true)
    const failed = store.updateTerminal({ profiles: [{ ...customShell, name: 'Edited' }] })
    pending[1].reject(new Error('write failed'))
    await expect(failed).resolves.toBe(false)
    expect(store.get().terminal.profiles[0]!.name).toBe(customShell.name)
    expect(store.getSaveStatus()).toBe('error')
    store.resetTerminal()
    expect(store.get().terminal.profiles).toEqual([customShell])
    expect(store.get().terminal.defaultProfileId).toBe(customShell.id)
    pending[2].resolve({ revision: 3, settings: confirmed })
    await vi.waitFor(() => expect(store.getSaveStatus()).toBe('saved'))
    store.dispose()
  })

  it('does not mask an earlier failed preference when a later save succeeds', async () => {
    const { adapter, pending } = controlledAdapter()
    const store = createSettingsStore(adapter)
    await store.whenReady()
    store.updateAppearance({ theme: 'dark' })
    store.update({ locale: 'en-US' })
    pending[0].reject(new Error('storage unavailable'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(store.getSaveStatus()).toBe('saving')
    pending[1].resolve({ revision: 2, settings: { ...cloneSettings(DEFAULT_SETTINGS), locale: 'en-US' } })
    await vi.waitFor(() => expect(store.getSaveStatus()).toBe('error'))
    expect(store.get().appearance.theme).toBe('system')
    expect(store.get().locale).toBe('en-US')
    store.updateAppearance({ theme: 'dark' })
    expect(store.getSaveStatus()).toBe('saving')
    pending[2].resolve({ revision: 3, settings: darkEnglishSettings() })
    await vi.waitFor(() => expect(store.getSaveStatus()).toBe('saved'))
    store.dispose()
  })

  it('restores confirmed preferences and shows failure even if recovery cannot reload', async () => {
    const { adapter, pending } = controlledAdapter()
    const store = createSettingsStore(adapter)
    await store.whenReady()
    vi.mocked(adapter.load).mockRejectedValueOnce(new Error('read failed'))
    store.updateAppearance({ theme: 'dark' })
    pending[0].reject(new Error('write failed'))
    await vi.waitFor(() => expect(store.getSaveStatus()).toBe('error'))
    expect(store.get()).toEqual(DEFAULT_SETTINGS)
    store.dispose()
  })

  it('settles synchronous adapter failures and does not publish after disposal', async () => {
    const { adapter, pending } = controlledAdapter()
    adapter.update = () => { throw new Error('IPC unavailable') }
    const store = createSettingsStore(adapter)
    await store.whenReady()
    expect(() => store.update({ locale: 'en-US' })).not.toThrow()
    await vi.waitFor(() => expect(store.getSaveStatus()).toBe('error'))
    store.resetTerminal()
    expect(store.getSaveStatus()).toBe('saving')
    const statusListener = vi.fn()
    store.subscribeSaveStatus(statusListener)
    store.dispose()
    pending[0].resolve({ revision: 2, settings: cloneSettings(DEFAULT_SETTINGS) })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(statusListener).not.toHaveBeenCalled()
  })

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
    expect(store.get().terminal).toEqual({ ...DEFAULT_SETTINGS.terminal, fontFamily: 'Maple Mono', fontSize: 16 })
    resolveUpdate?.({
      revision: 3,
      settings: {
        ...cloneSettings(DEFAULT_SETTINGS),
        locale: 'en-US',
        terminal: { ...DEFAULT_SETTINGS.terminal, fontFamily: 'Maple Mono', fontSize: 16 },
      },
    })
    await vi.waitFor(() => expect(store.get().terminal.fontFamily).toBe('Maple Mono'))
    store.dispose()
  })
})
