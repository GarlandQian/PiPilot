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
  private dirty = false
  private revision = 0
  private settings = cloneSettings()
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

    let rawText: string
    try {
      rawText = readFileSync(this.filePath, 'utf8')
    } catch (error) {
      if (!isMissingFile(error)) throw error

      this.settings = cloneSettings(DEFAULT_SETTINGS)
      this.initialized = true
      this.revision = 1
      this.dirty = true
      this.persistNow()
      this.onDiagnostic('created')
      return this.snapshot()
    }

    let document: ReturnType<typeof parseSettingsDocument>
    try {
      const raw: unknown = JSON.parse(rawText)
      document = parseSettingsDocument(raw)
    } catch {
      this.backUpCorruptFile()
      this.settings = cloneSettings(DEFAULT_SETTINGS)
      this.initialized = true
      this.revision = 1
      this.dirty = true
      this.persistNow()
      this.onDiagnostic('recovered-corrupt')
      return this.snapshot()
    }

    this.settings = cloneSettings(document.settings)
    this.initialized = true
    this.revision = 1

    return this.snapshot()
  }

  get(): SettingsRepositorySnapshot {
    if (!this.initialized) return this.initialize()
    return this.snapshot()
  }

  update(patch: AppSettingsPatch): SettingsRepositorySnapshot {
    if (!this.initialized) this.initialize()
    this.settings = mergeSettings(this.settings, patch)
    this.revision += 1
    this.dirty = true
    const snapshot = this.snapshot()
    this.schedulePersist()
    this.emit(snapshot)
    return snapshot
  }

  reset(scope: SettingsResetScope): SettingsRepositorySnapshot {
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
    this.schedulePersist()
    this.emit(snapshot)
    return snapshot
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
    this.flush()
    this.listeners.clear()
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
      this.onDiagnostic('write-failed')
    }
  }

  private persistNow() {
    const document = persistedSettingsDocumentSchema.parse({
      version: SETTINGS_SCHEMA_VERSION,
      settings: this.settings,
    })
    const temporaryPath = `${this.filePath}.${this.createId()}.tmp`

    mkdirSync(dirname(this.filePath), { recursive: true })
    try {
      writeFileSync(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      })
      renameSync(temporaryPath, this.filePath)
      this.dirty = false
    } catch (error) {
      try {
        unlinkSync(temporaryPath)
      } catch {
        // The temporary file may not have been created.
      }
      throw error
    }
  }

  private backUpCorruptFile() {
    const timestamp = new Date(this.now()).toISOString().replace(/[:.]/g, '-')
    const backupName = `${basename(this.filePath)}.corrupt-${timestamp}-${this.createId()}.bak`
    renameSync(this.filePath, join(dirname(this.filePath), backupName))
  }
}
