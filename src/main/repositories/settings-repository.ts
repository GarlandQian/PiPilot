import { randomUUID } from 'node:crypto'
import {
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join } from 'node:path'
import {
  cloneSettings,
  DEFAULT_SETTINGS,
  mergeSettings,
  parseSettingsDocument,
  SETTINGS_SCHEMA_VERSION,
  type AppSettings,
  type AppSettingsPatch,
} from '../../shared/settings'
import { persistedSettingsDocumentSchema } from '../../shared/schemas/settings'
import type { SettingsResetScope } from '../../shared/ipc/contracts'

export interface SettingsRepositorySnapshot {
  revision: number
  settings: AppSettings
}

export type SettingsDiagnosticCode =
  | 'created'
  | 'recovered-corrupt'
  | 'write-failed'

interface SettingsRepositoryOptions {
  createId?: () => string
  debounceMs?: number
  now?: () => number
  onDiagnostic?: (code: SettingsDiagnosticCode) => void
}

type Listener = (snapshot: SettingsRepositorySnapshot) => void
interface PersistenceWaiter {
  revision: number
  resolve(snapshot: SettingsRepositorySnapshot): void
  reject(error: Error): void
}

const persistenceError = () => new Error('Settings could not be saved to disk.')

function isMissingFile(error: unknown) {
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
}

export class SettingsRepository {
  private readonly createId: () => string
  private readonly debounceMs: number
  private readonly now: () => number
  private readonly onDiagnostic: (code: SettingsDiagnosticCode) => void
  private readonly listeners = new Set<Listener>()
  private initialized = false
  private disposed = false
  private dirty = false
  private revision = 0
  private settings = cloneSettings()
  private durable: SettingsRepositorySnapshot | null = null
  private readonly waiters = new Set<PersistenceWaiter>()
  private readonly failedBatches: Array<{ first: number; last: number }> = []
  private timer: NodeJS.Timeout | undefined

  constructor(
    private readonly filePath: string,
    options: SettingsRepositoryOptions = {},
  ) {
    this.createId = options.createId ?? randomUUID
    this.debounceMs = Math.max(0, options.debounceMs ?? 150)
    this.now = options.now ?? Date.now
    this.onDiagnostic = options.onDiagnostic ?? (() => undefined)
  }

  initialize(): SettingsRepositorySnapshot {
    if (this.initialized) return this.snapshot()
    this.assertOpen()

    let rawText: string
    try {
      rawText = readFileSync(this.filePath, 'utf8')
    } catch (error) {
      if (!isMissingFile(error)) throw error

      return this.initializeDefaults('created')
    }

    let document: ReturnType<typeof parseSettingsDocument>
    try {
      const raw: unknown = JSON.parse(rawText)
      document = parseSettingsDocument(raw)
    } catch {
      this.backUpCorruptFile()
      return this.initializeDefaults('recovered-corrupt')
    }

    this.settings = cloneSettings(document.settings)
    this.initialized = true
    this.revision = 1
    this.durable = this.snapshot()

    return this.snapshot()
  }

  get(): SettingsRepositorySnapshot {
    if (!this.initialized) return this.initialize()
    return this.snapshot()
  }

  update(patch: AppSettingsPatch): SettingsRepositorySnapshot {
    this.assertOpen()
    if (!this.initialized) this.initialize()
    this.settings = mergeSettings(this.settings, patch)
    this.revision += 1
    this.dirty = true
    const snapshot = this.snapshot()
    this.emit(snapshot)
    this.schedulePersist()
    return snapshot
  }

  reset(scope: SettingsResetScope): SettingsRepositorySnapshot {
    this.assertOpen()
    if (!this.initialized) this.initialize()
    if (scope === 'appearance') {
      this.settings = {
        ...this.settings,
        appearance: cloneSettings(DEFAULT_SETTINGS).appearance,
      }
    } else if (scope === 'terminal') {
      this.settings = {
        ...this.settings,
        terminal: cloneSettings(DEFAULT_SETTINGS).terminal,
      }
    } else {
      this.settings = cloneSettings(DEFAULT_SETTINGS)
    }
    this.revision += 1
    this.dirty = true
    const snapshot = this.snapshot()
    this.emit(snapshot)
    this.schedulePersist()
    return snapshot
  }

  /** A superseding write acknowledges the whole batch, never a rolled-back revision. */
  async whenPersisted(revision: number): Promise<SettingsRepositorySnapshot> {
    if (!this.initialized) this.initialize()
    if (!Number.isSafeInteger(revision) || revision < 1 || revision > this.revision) {
      throw new Error('The settings revision is unavailable.')
    }
    if (this.failedBatches.some((batch) => revision >= batch.first && revision <= batch.last)) {
      throw persistenceError()
    }
    if (this.durable && revision <= this.durable.revision) {
      return { revision: this.durable.revision, settings: cloneSettings(this.durable.settings) }
    }
    this.assertOpen()
    return new Promise((resolve, reject) => {
      this.waiters.add({ revision, resolve, reject })
    })
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  flush() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    if (this.initialized && this.dirty) this.persistNow()
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    try {
      this.flush()
    } finally {
      for (const waiter of this.waiters) waiter.reject(new Error('The settings repository is closed.'))
      this.waiters.clear()
      this.listeners.clear()
    }
  }

  private assertOpen() {
    if (this.disposed) throw new Error('The settings repository is closed.')
  }

  private initializeDefaults(diagnostic: 'created' | 'recovered-corrupt') {
    this.settings = cloneSettings(DEFAULT_SETTINGS)
    this.revision = 1
    this.dirty = true
    this.persistNow()
    this.initialized = true
    this.onDiagnostic(diagnostic)
    return this.snapshot()
  }

  private snapshot(): SettingsRepositorySnapshot {
    return { revision: this.revision, settings: cloneSettings(this.settings) }
  }

  private emit(snapshot: SettingsRepositorySnapshot) {
    for (const listener of this.listeners) listener(snapshot)
  }

  private schedulePersist() {
    if (this.timer) clearTimeout(this.timer)
    if (this.debounceMs === 0) {
      this.persistSafely()
      return
    }

    this.timer = setTimeout(() => {
      this.timer = undefined
      this.persistSafely()
    }, this.debounceMs)
    this.timer.unref()
  }

  private persistSafely() {
    try {
      this.persistNow()
    } catch {
      // persistNow rolls back and rejects the durable acknowledgements.
    }
  }

  private persistNow() {
    const candidate = this.snapshot()
    let temporaryPath: string | undefined
    try {
      const document = persistedSettingsDocumentSchema.parse({
        version: SETTINGS_SCHEMA_VERSION,
        settings: candidate.settings,
      })
      temporaryPath = `${this.filePath}.${this.createId()}.tmp`
      mkdirSync(dirname(this.filePath), { recursive: true })
      writeFileSync(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      })
      renameSync(temporaryPath, this.filePath)
      this.dirty = false
      this.durable = candidate
      for (const waiter of this.waiters) {
        if (waiter.revision > candidate.revision) continue
        this.waiters.delete(waiter)
        waiter.resolve({ revision: candidate.revision, settings: cloneSettings(candidate.settings) })
      }
    } catch {
      try {
        if (temporaryPath) unlinkSync(temporaryPath)
      } catch {
        // The temporary file may not have been created.
      }
      this.dirty = false
      if (this.durable) {
        this.failedBatches.push({ first: this.durable.revision + 1, last: candidate.revision })
        this.settings = cloneSettings(this.durable.settings)
        this.revision = candidate.revision + 1
        this.durable = this.snapshot()
      }
      for (const waiter of this.waiters) waiter.reject(persistenceError())
      this.waiters.clear()
      this.onDiagnostic('write-failed')
      if (this.durable) this.emit(this.snapshot())
      throw persistenceError()
    }
  }

  private backUpCorruptFile() {
    const timestamp = new Date(this.now()).toISOString().replace(/[:.]/g, '-')
    const backupName = `${basename(this.filePath)}.corrupt-${timestamp}-${this.createId()}.bak`
    renameSync(this.filePath, join(dirname(this.filePath), backupName))
  }
}
