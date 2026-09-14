import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const disk = vi.hoisted(() => ({ failWrite: false, failRename: false, writes: 0, renames: 0 }))
const electronMock = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, request: unknown) => Promise<unknown>>(),
  send: vi.fn(),
}))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    writeFileSync: (...args: Parameters<typeof actual.writeFileSync>) => {
      disk.writes += 1
      if (disk.failWrite) throw new Error('EACCES /private/secret/settings.json')
      return actual.writeFileSync(...args)
    },
    renameSync: (...args: Parameters<typeof actual.renameSync>) => {
      disk.renames += 1
      if (disk.failRename) throw new Error('EIO /private/secret/settings.json')
      return actual.renameSync(...args)
    },
  }
})
vi.mock('electron', () => ({
  app: { getVersion: () => '0.0.4', isPackaged: false },
  shell: { openExternal: vi.fn() },
  ipcMain: {
    removeHandler: (channel: string) => electronMock.handlers.delete(channel),
    handle: (channel: string, handler: (event: unknown, request: unknown) => Promise<unknown>) => electronMock.handlers.set(channel, handler),
  },
}))

import { SettingsRepository } from '../../src/main/repositories/settings-repository'
import { registerAppIpc } from '../../src/main/ipc/register-app-ipc'
import { createApplicationUrlPolicy } from '../../src/main/security/url-policy'
import type { ConfigurationShutdownGuard } from '../../src/main/application-update/configuration-shutdown-guard'
import { cloneSettings, DEFAULT_SETTINGS } from '../../src/shared/settings'
import { ipcChannels, type IpcResult, type SettingsSnapshot } from '../../src/shared/ipc/contracts'
import { createSettingsStore } from '../../src/store/settings'

const repositories: SettingsRepository[] = []
const directories: string[] = []

function createRepository(debounceMs = 150) {
  const directory = mkdtempSync(join(tmpdir(), 'pipilot-settings-persistence-'))
  directories.push(directory)
  const path = join(directory, 'settings.json')
  const diagnostics: string[] = []
  const repository = new SettingsRepository(path, { debounceMs, onDiagnostic: (code) => diagnostics.push(code) })
  repositories.push(repository)
  return { repository, path, directory, diagnostics }
}

function installIpc(repository: SettingsRepository) {
  const mainFrame = { url: 'pipilot://app/' }
  const webContents = { mainFrame, send: electronMock.send }
  const window = { isDestroyed: () => false, webContents } as unknown as BrowserWindow
  registerAppIpc({
    getMainWindow: () => window,
    policy: createApplicationUrlPolicy(),
    settingsRepository: repository,
    shutdownGuard: { respond: () => true } as unknown as ConfigurationShutdownGuard,
  })
  const event = { sender: webContents, senderFrame: mainFrame } as unknown as IpcMainInvokeEvent
  return (channel: string, request: Record<string, unknown>) => electronMock.handlers.get(channel)!(event, {
    context: { requestId: randomUUID() }, ...request,
  }) as Promise<IpcResult<SettingsSnapshot>>
}

beforeEach(() => {
  vi.useFakeTimers()
  disk.failWrite = false
  disk.failRename = false
  disk.writes = 0
  disk.renames = 0
  electronMock.handlers.clear()
  electronMock.send.mockClear()
})
afterEach(() => {
  disk.failWrite = false
  disk.failRename = false
  for (const repository of repositories.splice(0)) repository.dispose()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
  vi.useRealTimers()
})

describe('durable settings acknowledgements', () => {
  it('acknowledges initialization and already durable revisions without another write', async () => {
    const { repository } = createRepository()
    const initialized = repository.initialize()
    const acknowledgement = await repository.whenPersisted(initialized.revision)
    expect(acknowledgement).toEqual(initialized)
    acknowledgement.settings.appearance.theme = 'dark'
    expect(repository.get().settings).toEqual(DEFAULT_SETTINGS)
    expect(disk.writes).toBe(1)
  })

  it('debounces a burst into one atomic write and confirms all waiters with the final snapshot', async () => {
    const { repository, path, directory } = createRepository()
    repository.initialize()
    const first = repository.update({ locale: 'en-US' })
    let settled = false
    const firstAcknowledgement = repository.whenPersisted(first.revision).then((snapshot) => { settled = true; return snapshot })
    await vi.advanceTimersByTimeAsync(100)
    const last = repository.update({ appearance: { theme: 'dark' } })
    const secondAcknowledgement = repository.whenPersisted(last.revision)
    await vi.advanceTimersByTimeAsync(149)
    expect(settled).toBe(false)
    expect(disk.writes).toBe(1)
    expect(JSON.parse(readFileSync(path, 'utf8')).settings).toEqual(DEFAULT_SETTINGS)
    await vi.advanceTimersByTimeAsync(1)
    expect(await firstAcknowledgement).toEqual(last)
    expect(await secondAcknowledgement).toEqual(last)
    expect(disk.writes).toBe(2)
    expect(disk.renames).toBe(2)
    expect(readdirSync(directory)).toEqual(['settings.json'])
    expect(JSON.parse(readFileSync(path, 'utf8')).settings).toEqual(last.settings)
  })

  it.each(['write', 'rename'] as const)('rejects a failed %s batch, preserves the durable file, and emits a newer rollback', async (failure) => {
    const { repository, path, directory, diagnostics } = createRepository()
    const baseline = repository.initialize()
    const events: SettingsSnapshot[] = []
    repository.subscribe((snapshot) => events.push(snapshot))
    const first = repository.update({ locale: 'en-US' })
    const last = repository.update({ appearance: { theme: 'dark' } })
    const outcomes = Promise.allSettled([repository.whenPersisted(first.revision), repository.whenPersisted(last.revision)])
    disk.failWrite = failure === 'write'
    disk.failRename = failure === 'rename'
    await vi.advanceTimersByTimeAsync(150)
    expect((await outcomes).map((result) => result.status)).toEqual(['rejected', 'rejected'])
    expect(repository.get()).toEqual({ revision: last.revision + 1, settings: baseline.settings })
    expect(events.map((snapshot) => snapshot.revision)).toEqual([first.revision, last.revision, last.revision + 1])
    expect(events[events.length - 1]?.settings).toEqual(baseline.settings)
    expect(JSON.parse(readFileSync(path, 'utf8')).settings).toEqual(baseline.settings)
    expect(readdirSync(directory)).toEqual(['settings.json'])
    expect(diagnostics).toEqual(['created', 'write-failed'])

    disk.failWrite = false
    disk.failRename = false
    const retry = repository.update({ terminal: { fontSize: 17 } })
    const retried = repository.whenPersisted(retry.revision)
    repository.flush()
    expect(await retried).toEqual(retry)
    expect(retry.settings.locale).toBe(baseline.settings.locale)
    await expect(repository.whenPersisted(first.revision)).rejects.toThrow('could not be saved')
    await expect(repository.whenPersisted(last.revision)).rejects.toThrow('could not be saved')
  })

  it('does not confirm a synchronous zero-debounce failure even when the waiter arrives afterward', async () => {
    const { repository } = createRepository(0)
    const baseline = repository.initialize()
    disk.failRename = true
    const attempted = repository.update({ locale: 'en-US' })
    await expect(repository.whenPersisted(attempted.revision)).rejects.toThrow('could not be saved')
    expect(repository.get().revision).toBeGreaterThan(attempted.revision)
    expect(repository.get().settings).toEqual(baseline.settings)
  })

  it('can retry initialization after a failed initial write', async () => {
    const { repository, path } = createRepository()
    disk.failWrite = true
    expect(() => repository.initialize()).toThrow('could not be saved')
    disk.failWrite = false
    const initialized = repository.initialize()
    expect(await repository.whenPersisted(initialized.revision)).toEqual(initialized)
    expect(JSON.parse(readFileSync(path, 'utf8')).settings).toEqual(DEFAULT_SETTINGS)
  })

  it('flushes pending acknowledgements on dispose and prevents further updates', async () => {
    const { repository, path } = createRepository()
    repository.initialize()
    const changed = repository.update({ appearance: { theme: 'dark' } })
    const outcome = repository.whenPersisted(changed.revision)
    repository.dispose()
    expect(await outcome).toEqual(changed)
    expect(JSON.parse(readFileSync(path, 'utf8')).settings).toEqual(changed.settings)
    expect(() => repository.update({ locale: 'en-US' })).toThrow('closed')
    expect(() => repository.reset('all')).toThrow('closed')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects every waiter when a shutdown flush fails, without leaving a timer', async () => {
    const { repository } = createRepository()
    repository.initialize()
    const changed = repository.update({ locale: 'en-US' })
    const outcome = Promise.allSettled([repository.whenPersisted(changed.revision)])
    disk.failRename = true
    expect(() => repository.dispose()).toThrow('could not be saved')
    expect((await outcome)[0]?.status).toBe('rejected')
    expect(repository.get().settings).toEqual(DEFAULT_SETTINGS)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects unknown revisions instead of leaving acknowledgements unresolved', async () => {
    const { repository } = createRepository()
    repository.initialize()
    for (const revision of [0, -1, 1.5, 2]) await expect(repository.whenPersisted(revision)).rejects.toThrow('unavailable')
  })
})

describe('settings IPC and renderer save status', () => {
  it('returns IPC success only after durable persistence and returns safe reset errors', async () => {
    const { repository } = createRepository()
    repository.initialize()
    const invoke = installIpc(repository)
    let acknowledged = false
    const update = invoke(ipcChannels.settingsUpdate, { patch: { appearance: { theme: 'dark' } } }).then((result) => { acknowledged = true; return result })
    await vi.advanceTimersByTimeAsync(149)
    expect(acknowledged).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await update).toMatchObject({ ok: true, value: { settings: { appearance: { theme: 'dark' } } } })
    const saved = repository.get()
    disk.failWrite = true
    const reset = invoke(ipcChannels.settingsReset, { scope: 'appearance' })
    await vi.advanceTimersByTimeAsync(150)
    const result = await reset
    expect(result).toMatchObject({ ok: false, error: { code: 'SETTINGS_WRITE_FAILED', recoverable: true } })
    expect(JSON.stringify(result)).not.toContain('/private/secret')
    expect(repository.get().settings).toEqual(saved.settings)
    expect(electronMock.send.mock.calls[electronMock.send.mock.calls.length - 1]?.[1]).toMatchObject({ snapshot: { revision: saved.revision + 2, settings: saved.settings } })
  })

  it('keeps the renderer saving until disk confirmation and rolls failed optimistic changes back', async () => {
    const { repository } = createRepository()
    repository.initialize()
    const store = createSettingsStore({
      mode: 'electron',
      getBootstrapSettings: () => cloneSettings(DEFAULT_SETTINGS),
      load: async () => repository.get(),
      update: async (patch) => repository.whenPersisted(repository.update(patch).revision),
      reset: async (scope) => repository.whenPersisted(repository.reset(scope).revision),
      subscribe: (listener) => repository.subscribe(listener),
    })
    try {
      await store.whenReady()
      store.updateAppearance({ theme: 'dark' })
      expect(store.getSaveStatus()).toBe('saving')
      expect(store.get().appearance.theme).toBe('dark')
      await vi.advanceTimersByTimeAsync(150)
      expect(store.getSaveStatus()).toBe('saved')
      disk.failRename = true
      store.update({ locale: 'en-US' })
      store.updateTerminal({ fontSize: 17 })
      await vi.advanceTimersByTimeAsync(150)
      expect(store.getSaveStatus()).toBe('error')
      expect(store.get().appearance.theme).toBe('dark')
      expect(store.get().locale).toBe(DEFAULT_SETTINGS.locale)
      expect(store.get().terminal).toEqual(DEFAULT_SETTINGS.terminal)
      disk.failRename = false
      store.updateTerminal({ fontSize: 16 })
      await vi.advanceTimersByTimeAsync(150)
      expect(store.getSaveStatus()).toBe('saved')
      expect(store.get().terminal.fontSize).toBe(16)
    } finally {
      store.dispose()
    }
  })
})
