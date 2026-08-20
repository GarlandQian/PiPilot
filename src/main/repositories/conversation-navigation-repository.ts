import { randomUUID } from 'node:crypto'
import {
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { z } from 'zod'
import {
  conversationNavigationSnapshotSchema,
  conversationScopeSchema,
  type ConversationNavigationSnapshot,
  type ConversationScope,
} from '../../shared/conversation-scope'

const CONVERSATION_NAVIGATION_SCHEMA_VERSION = 1 as const

const persistedConversationNavigationSchema = z
  .object({
    version: z.literal(CONVERSATION_NAVIGATION_SCHEMA_VERSION),
    activeScope: conversationScopeSchema,
  })
  .strict()

export type ConversationNavigationDiagnosticCode =
  | 'created'
  | 'recovered-corrupt'
  | 'write-failed'

interface ConversationNavigationRepositoryOptions {
  createId?: () => string
  now?: () => number
  onDiagnostic?: (code: ConversationNavigationDiagnosticCode) => void
}

type Listener = (snapshot: ConversationNavigationSnapshot) => void

function isMissingFile(error: unknown) {
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
}

function sameScope(left: ConversationScope, right: ConversationScope) {
  return left.kind === right.kind && (
    left.kind === 'projectless' ||
    (right.kind === 'project' && left.workspaceId === right.workspaceId)
  )
}

export class ConversationNavigationRepository {
  private readonly createId: () => string
  private readonly now: () => number
  private readonly onDiagnostic: (
    code: ConversationNavigationDiagnosticCode,
  ) => void
  private initialized = false
  private revision = 0
  private activeScope: ConversationScope = { kind: 'projectless' }
  private readonly listeners = new Set<Listener>()

  constructor(
    private readonly filePath: string,
    options: ConversationNavigationRepositoryOptions = {},
  ) {
    this.createId = options.createId ?? randomUUID
    this.now = options.now ?? Date.now
    this.onDiagnostic = options.onDiagnostic ?? (() => undefined)
  }

  initialize() {
    if (this.initialized) return this.snapshot()

    try {
      const raw: unknown = JSON.parse(readFileSync(this.filePath, 'utf8'))
      const document = persistedConversationNavigationSchema.parse(raw)
      this.activeScope = document.activeScope
    } catch (error) {
      if (isMissingFile(error)) {
        this.onDiagnostic('created')
      } else {
        this.backUpCorruptFile()
        this.onDiagnostic('recovered-corrupt')
      }
      this.activeScope = { kind: 'projectless' }
    }

    this.initialized = true
    this.revision = 1
    this.persistSafely()
    return this.snapshot()
  }

  get() {
    this.assertInitialized()
    return this.snapshot()
  }

  setActiveScope(rawScope: ConversationScope) {
    this.assertInitialized()
    const scope = conversationScopeSchema.parse(rawScope)
    if (sameScope(this.activeScope, scope)) return this.snapshot()
    this.activeScope = scope
    this.revision += 1
    this.persistSafely()
    const snapshot = this.snapshot()
    for (const listener of this.listeners) listener(snapshot)
    return snapshot
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
      throw new Error(
        'ConversationNavigationRepository.initialize() must be called first.',
      )
    }
  }

  private snapshot() {
    return conversationNavigationSnapshotSchema.parse({
      revision: this.revision,
      activeScope: this.activeScope,
    })
  }

  private persistedDocument() {
    return persistedConversationNavigationSchema.parse({
      version: CONVERSATION_NAVIGATION_SCHEMA_VERSION,
      activeScope: this.activeScope,
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

  private backUpCorruptFile() {
    const timestamp = new Date(this.now()).toISOString().replace(/[:.]/g, '-')
    const backupName = `${basename(this.filePath)}.corrupt-${timestamp}-${this.createId()}.bak`
    renameSync(this.filePath, join(dirname(this.filePath), backupName))
  }
}
