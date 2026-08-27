import { randomUUID } from 'node:crypto'
import {
  constants,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { access, realpath, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { z } from 'zod'
import {
  workspaceSnapshotSchema,
  type WorkspaceSnapshot,
  type WorkspaceSummary,
} from '../../shared/schemas/workspace'

const WORKSPACE_SCHEMA_VERSION = 1 as const
const MAX_RECENT_WORKSPACES = 100

const persistedWorkspaceSchema = z
  .object({
    id: z.uuid(),
    name: z.string().min(1).max(256),
    path: z.string().min(1).max(4_096).refine((value) => !value.includes('\0')),
    lastOpenedAt: z.iso.datetime(),
    pinned: z.boolean(),
  })
  .strict()

const persistedWorkspaceDocumentSchema = z
  .object({
    version: z.literal(WORKSPACE_SCHEMA_VERSION),
    recent: z.array(persistedWorkspaceSchema).max(MAX_RECENT_WORKSPACES),
  })
  .strict()

type PersistedWorkspace = z.infer<typeof persistedWorkspaceSchema>

interface WorkspaceRecord extends PersistedWorkspace {
  available: boolean
}

export type WorkspaceDiagnosticCode =
  | 'created'
  | 'recovered-corrupt'
  | 'unavailable'
  | 'write-failed'

interface WorkspaceRepositoryOptions {
  createId?: () => string
  now?: () => number
  onDiagnostic?: (code: WorkspaceDiagnosticCode) => void
  validateDirectory?: (candidatePath: string) => Promise<string>
}

type Listener = (snapshot: WorkspaceSnapshot) => void

export class WorkspaceRepositoryError extends Error {
  constructor(
    readonly code: 'WORKSPACE_NOT_FOUND' | 'WORKSPACE_UNAVAILABLE',
    message: string,
  ) {
    super(message)
    this.name = 'WorkspaceRepositoryError'
  }
}

async function validateDirectory(candidatePath: string) {
  const canonicalPath = await realpath(candidatePath)
  const details = await stat(canonicalPath)
  if (!details.isDirectory()) throw new Error('Not a directory')
  await access(canonicalPath, constants.R_OK | constants.W_OK)
  return canonicalPath
}

function isMissingFile(error: unknown) {
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
}

function workspaceName(canonicalPath: string) {
  return (basename(canonicalPath) || canonicalPath).slice(0, 256)
}

export class WorkspaceRepository {
  private readonly createId: () => string
  private readonly now: () => number
  private readonly onDiagnostic: (code: WorkspaceDiagnosticCode) => void
  private readonly validateDirectory: (candidatePath: string) => Promise<string>
  private readonly listeners = new Set<Listener>()
  private initialized = false
  private revision = 0
  private currentId: string | undefined
  private recent: WorkspaceRecord[] = []

  constructor(
    private readonly filePath: string,
    options: WorkspaceRepositoryOptions = {},
  ) {
    this.createId = options.createId ?? randomUUID
    this.now = options.now ?? Date.now
    this.onDiagnostic = options.onDiagnostic ?? (() => undefined)
    this.validateDirectory = options.validateDirectory ?? validateDirectory
  }

  async initialize(): Promise<WorkspaceSnapshot> {
    if (this.initialized) return this.snapshot()

    try {
      const rawText = readFileSync(this.filePath, 'utf8')
      const parsed: unknown = JSON.parse(rawText)
      const document = persistedWorkspaceDocumentSchema.parse(parsed)
      this.currentId = undefined
      this.recent = document.recent.map((record) => ({ ...record, available: true }))
    } catch (error) {
      if (!isMissingFile(error)) {
        this.backUpCorruptFile()
        this.onDiagnostic('recovered-corrupt')
      } else {
        this.onDiagnostic('created')
      }
      this.currentId = undefined
      this.recent = []
    }

    this.initialized = true
    this.revision = 1
    const availabilityChanged = await this.refreshAvailability()
    if (availabilityChanged || !this.existsOnDisk()) this.persistSafely()
    return this.snapshot()
  }

  get(): WorkspaceSnapshot {
    if (!this.initialized) {
      throw new Error('WorkspaceRepository.initialize() must be awaited first.')
    }
    return this.snapshot()
  }

  getCurrentLocation() {
    return this.currentId ? this.getLocation(this.currentId) : undefined
  }

  getLocation(workspaceId: string) {
    this.assertInitialized()
    const record = this.recent.find((workspace) => workspace.id === workspaceId)
    if (!record?.available) return undefined
    return { id: record.id, name: record.name, path: record.path }
  }

  async activatePath(candidatePath: string) {
    this.assertInitialized()
    const canonicalPath = await this.validateOrThrow(candidatePath)
    const openedAt = new Date(this.now()).toISOString()
    let record = this.recent.find((workspace) => workspace.path === canonicalPath)

    if (record) {
      record.name = workspaceName(canonicalPath)
      record.lastOpenedAt = openedAt
      record.available = true
    } else {
      record = {
        id: this.createId(),
        name: workspaceName(canonicalPath),
        path: canonicalPath,
        lastOpenedAt: openedAt,
        pinned: false,
        available: true,
      }
      this.recent.push(record)
    }

    this.currentId = record.id
    this.pruneRecent()
    this.commit()
    return { id: record.id, name: record.name, path: record.path, snapshot: this.snapshot() }
  }

  async activate(workspaceId: string) {
    this.assertInitialized()
    const record = this.recent.find((workspace) => workspace.id === workspaceId)
    if (!record) {
      throw new WorkspaceRepositoryError('WORKSPACE_NOT_FOUND', 'The workspace was not found.')
    }

    let canonicalPath: string
    try {
      canonicalPath = await this.validateDirectory(record.path)
    } catch {
      record.available = false
      this.commit()
      this.onDiagnostic('unavailable')
      throw new WorkspaceRepositoryError(
        'WORKSPACE_UNAVAILABLE',
        'The workspace is unavailable.',
      )
    }

    record.path = canonicalPath
    record.name = workspaceName(canonicalPath)
    record.lastOpenedAt = new Date(this.now()).toISOString()
    record.available = true
    this.currentId = record.id
    this.commit()
    return { id: record.id, name: record.name, path: record.path, snapshot: this.snapshot() }
  }

  setPinned(workspaceId: string, pinned: boolean) {
    this.assertInitialized()
    const record = this.recent.find((workspace) => workspace.id === workspaceId)
    if (!record) {
      throw new WorkspaceRepositoryError('WORKSPACE_NOT_FOUND', 'The workspace was not found.')
    }
    if (record.pinned === pinned) return this.snapshot()
    record.pinned = pinned
    this.commit()
    return this.snapshot()
  }

  remove(workspaceId: string) {
    this.assertInitialized()
    const index = this.recent.findIndex((workspace) => workspace.id === workspaceId)
    if (index < 0) {
      throw new WorkspaceRepositoryError('WORKSPACE_NOT_FOUND', 'The workspace was not found.')
    }

    this.recent.splice(index, 1)
    if (this.currentId === workspaceId) this.currentId = undefined
    this.commit()
    return this.snapshot()
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  flush() {
    if (this.initialized) this.persistSafely()
  }

  private assertInitialized() {
    if (!this.initialized) {
      throw new Error('WorkspaceRepository.initialize() must be awaited first.')
    }
  }

  private async validateOrThrow(candidatePath: string) {
    try {
      return await this.validateDirectory(candidatePath)
    } catch {
      this.onDiagnostic('unavailable')
      throw new WorkspaceRepositoryError(
        'WORKSPACE_UNAVAILABLE',
        'The selected workspace is unavailable.',
      )
    }
  }

  private async refreshAvailability() {
    let changed = false
    for (const record of this.recent) {
      try {
        const canonicalPath = await this.validateDirectory(record.path)
        const name = workspaceName(canonicalPath)
        if (!record.available || record.path !== canonicalPath || record.name !== name) {
          changed = true
        }
        record.available = true
        record.path = canonicalPath
        record.name = name
      } catch {
        if (record.available) changed = true
        record.available = false
      }
    }
    return changed
  }

  private pruneRecent() {
    const sorted = this.sortedRecent()
    this.recent = sorted.slice(0, MAX_RECENT_WORKSPACES)
  }

  private sortedRecent() {
    return [...this.recent].sort((left, right) => {
      if (left.pinned !== right.pinned) return left.pinned ? -1 : 1
      return Date.parse(right.lastOpenedAt) - Date.parse(left.lastOpenedAt)
    })
  }

  private snapshot(): WorkspaceSnapshot {
    const recent = this.sortedRecent().map((record): WorkspaceSummary => ({
      id: record.id,
      name: record.name,
      lastOpenedAt: record.lastOpenedAt,
      pinned: record.pinned,
      available: record.available,
    }))
    const current = this.currentId
      ? recent.find((workspace) => workspace.id === this.currentId)
      : undefined
    return workspaceSnapshotSchema.parse({
      revision: this.revision,
      ...(current ? { currentId: current.id, current } : {}),
      recent,
    })
  }

  private commit() {
    this.revision += 1
    this.persistSafely()
    const snapshot = this.snapshot()
    for (const listener of this.listeners) listener(snapshot)
  }

  private persistedDocument() {
    return persistedWorkspaceDocumentSchema.parse({
      version: WORKSPACE_SCHEMA_VERSION,
      recent: this.recent.map(({ available: _available, ...record }) => record),
    })
  }

  private persistSafely() {
    try {
      this.persistNow()
    } catch {
      this.onDiagnostic('write-failed')
    }
  }

  private persistNow() {
    const temporaryPath = `${this.filePath}.${this.createId()}.tmp`
    mkdirSync(dirname(this.filePath), { recursive: true })
    try {
      writeFileSync(
        temporaryPath,
        `${JSON.stringify(this.persistedDocument(), null, 2)}\n`,
        { encoding: 'utf8', mode: 0o600 },
      )
      renameSync(temporaryPath, this.filePath)
    } catch (error) {
      try {
        unlinkSync(temporaryPath)
      } catch {
        // The temporary file may not have been created.
      }
      throw error
    }
  }

  private existsOnDisk() {
    try {
      readFileSync(this.filePath)
      return true
    } catch {
      return false
    }
  }

  private backUpCorruptFile() {
    const timestamp = new Date(this.now()).toISOString().replace(/[:.]/g, '-')
    const backupName = `${basename(this.filePath)}.corrupt-${timestamp}-${this.createId()}.bak`
    renameSync(this.filePath, join(dirname(this.filePath), backupName))
  }
}
