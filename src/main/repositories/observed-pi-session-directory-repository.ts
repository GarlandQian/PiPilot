import { randomUUID } from 'node:crypto'
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { z } from 'zod'
import {
  conversationScopeSchema,
  type ConversationScope,
} from '../../shared/conversation-scope'
import { conversationScopeKey } from '../conversations/conversation-scope-resolver'

const OBSERVED_DIRECTORY_SCHEMA_VERSION = 1 as const
const MAX_SCOPE_OBSERVATIONS = 8
const MAX_OBSERVED_SCOPES = 101

const persistedObservationSchema = z
  .object({
    directory: z.string().min(1).max(4_096).refine((value) => !value.includes('\0')),
    observedAt: z.iso.datetime(),
  })
  .strict()

const persistedScopeObservationSchema = z
  .object({
    scope: conversationScopeSchema,
    activationUnavailableAt: z.iso.datetime().optional(),
    activeDirectory: z
      .string()
      .min(1)
      .max(4_096)
      .refine((value) => !value.includes('\0'))
      .optional(),
    recent: z.array(persistedObservationSchema).max(MAX_SCOPE_OBSERVATIONS),
  })
  .strict()
  .superRefine((record, context) => {
    if (record.activeDirectory && record.activationUnavailableAt) {
      context.addIssue({
        code: 'custom',
        message: 'A scope cannot be observed and activation-unavailable at once.',
      })
    }
    if (
      record.activeDirectory &&
      !record.recent.some(
        (observation) => observation.directory === record.activeDirectory,
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'The active directory must reference a retained observation.',
      })
    }
  })

const persistedObservedDirectoryDocumentSchema = z
  .object({
    version: z.literal(OBSERVED_DIRECTORY_SCHEMA_VERSION),
    scopes: z.array(persistedScopeObservationSchema).max(MAX_OBSERVED_SCOPES),
  })
  .strict()

export type ObservedPiSessionDirectoryDiagnosticCode =
  | 'created'
  | 'recovered-corrupt'
  | 'write-failed'

export interface ObservedPiSessionDirectory {
  directory: string
  observedAt: string
}

export type ObservedPiSessionDirectoryState =
  | { status: 'notLoaded' }
  | { status: 'activationUnavailable' }
  | { status: 'observed'; observation: ObservedPiSessionDirectory }

export type ObservePiSessionDirectoryResult =
  | {
      status: 'observed'
      observation: ObservedPiSessionDirectory
    }
  | {
      status: 'activationUnavailable'
      reason: 'missingSessionFile' | 'invalidSessionFile'
    }

interface RepositoryOptions {
  createId?: () => string
  now?: () => number
  onDiagnostic?: (code: ObservedPiSessionDirectoryDiagnosticCode) => void
}

type PersistedScopeObservation = z.infer<typeof persistedScopeObservationSchema>

function isMissingFile(error: unknown) {
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
}

export class ObservedPiSessionDirectoryRepository {
  private readonly createId: () => string
  private readonly now: () => number
  private readonly onDiagnostic: (
    code: ObservedPiSessionDirectoryDiagnosticCode,
  ) => void
  private initialized = false
  private mutations: Promise<void> = Promise.resolve()
  private scopes: PersistedScopeObservation[] = []

  constructor(
    private readonly filePath: string,
    options: RepositoryOptions = {},
  ) {
    this.createId = options.createId ?? randomUUID
    this.now = options.now ?? Date.now
    this.onDiagnostic = options.onDiagnostic ?? (() => undefined)
  }

  async initialize() {
    if (this.initialized) return

    try {
      const rawText = await readFile(this.filePath, 'utf8')
      const document = persistedObservedDirectoryDocumentSchema.parse(
        JSON.parse(rawText) as unknown,
      )
      this.scopes = structuredClone(document.scopes)
    } catch (error) {
      if (isMissingFile(error)) {
        this.onDiagnostic('created')
      } else {
        await this.backUpCorruptFile()
        this.onDiagnostic('recovered-corrupt')
      }
      this.scopes = []
    }

    this.initialized = true
    await this.persistSafely()
  }

  get(rawScope: ConversationScope): ObservedPiSessionDirectory | undefined {
    const state = this.getState(rawScope)
    return state.status === 'observed' ? state.observation : undefined
  }

  getState(rawScope: ConversationScope): ObservedPiSessionDirectoryState {
    this.assertInitialized()
    const scope = conversationScopeSchema.parse(rawScope)
    const record = this.scopes.find(
      (candidate) => conversationScopeKey(candidate.scope) === conversationScopeKey(scope),
    )
    if (!record) return { status: 'notLoaded' }
    if (!record.activeDirectory) {
      return record.activationUnavailableAt
        ? { status: 'activationUnavailable' }
        : { status: 'notLoaded' }
    }
    const observation = record.recent.find(
      (candidate) => candidate.directory === record.activeDirectory,
    )
    return observation
      ? { status: 'observed', observation: structuredClone(observation) }
      : { status: 'notLoaded' }
  }

  observe(
    rawScope: ConversationScope,
    sessionFile: string | undefined,
  ): Promise<ObservePiSessionDirectoryResult> {
    this.assertInitialized()
    const scope = conversationScopeSchema.parse(rawScope)
    return this.enqueueMutation(() => this.observeNow(scope, sessionFile))
  }

  private async observeNow(
    scope: ConversationScope,
    sessionFile: string | undefined,
  ): Promise<ObservePiSessionDirectoryResult> {
    if (!sessionFile) {
      await this.markActivationUnavailable(scope)
      return { status: 'activationUnavailable', reason: 'missingSessionFile' }
    }

    try {
      if (!isAbsolute(sessionFile)) throw new Error('The session file is not absolute.')
      const normalizedFile = resolve(sessionFile)
      if (normalizedFile !== sessionFile) {
        throw new Error('The session file path is not normalized.')
      }
      const canonicalDirectory = await realpath(dirname(normalizedFile))
      const directoryDetails = await lstat(canonicalDirectory)
      if (!directoryDetails.isDirectory() || directoryDetails.isSymbolicLink()) {
        throw new Error('The session directory is unavailable.')
      }

      try {
        const directDetails = await lstat(normalizedFile)
        if (!directDetails.isFile() || directDetails.isSymbolicLink()) {
          throw new Error('The session file is not a direct regular file.')
        }
        const canonicalFile = await realpath(normalizedFile)
        if (dirname(canonicalFile) !== canonicalDirectory) {
          throw new Error('The session file is outside its canonical directory.')
        }
      } catch (error) {
        // Pi 0.84.2 assigns a sessionFile before its first persisted assistant
        // message. Its canonical parent is still the authoritative directory.
        if (!isMissingFile(error)) throw error
      }

      const observation = {
        directory: canonicalDirectory,
        observedAt: new Date(this.now()).toISOString(),
      }
      const record = this.ensureScopeRecord(scope)
      record.activeDirectory = canonicalDirectory
      delete record.activationUnavailableAt
      record.recent = [
        observation,
        ...record.recent.filter(
          (candidate) => candidate.directory !== canonicalDirectory,
        ),
      ].slice(0, MAX_SCOPE_OBSERVATIONS)
      await this.persistSafely()
      return { status: 'observed', observation: structuredClone(observation) }
    } catch {
      await this.markActivationUnavailable(scope)
      return { status: 'activationUnavailable', reason: 'invalidSessionFile' }
    }
  }

  flush() {
    if (!this.initialized) return Promise.resolve()
    return this.enqueueMutation(() => this.persistSafely())
  }

  private enqueueMutation<T>(operation: () => Promise<T>) {
    const result = this.mutations.then(operation, operation)
    this.mutations = result.then(() => undefined, () => undefined)
    return result
  }

  private assertInitialized() {
    if (!this.initialized) {
      throw new Error(
        'ObservedPiSessionDirectoryRepository.initialize() must be awaited first.',
      )
    }
  }

  private ensureScopeRecord(scope: ConversationScope) {
    const key = conversationScopeKey(scope)
    let record = this.scopes.find(
      (candidate) => conversationScopeKey(candidate.scope) === key,
    )
    if (!record) {
      record = { scope, recent: [] }
      this.scopes.push(record)
      if (this.scopes.length > MAX_OBSERVED_SCOPES) {
        const removable = this.scopes
          .map((candidate, index) => ({ candidate, index }))
          .filter(({ candidate }) => candidate !== record)
          .sort((left, right) => {
            const leftTime = left.candidate.recent[0]?.observedAt ??
              left.candidate.activationUnavailableAt ?? ''
            const rightTime = right.candidate.recent[0]?.observedAt ??
              right.candidate.activationUnavailableAt ?? ''
            return leftTime.localeCompare(rightTime)
          })[0]
        if (removable) this.scopes.splice(removable.index, 1)
      }
    }
    return record
  }

  private async markActivationUnavailable(scope: ConversationScope) {
    const record = this.ensureScopeRecord(scope)
    delete record.activeDirectory
    record.activationUnavailableAt = new Date(this.now()).toISOString()
    await this.persistSafely()
  }

  private document() {
    return persistedObservedDirectoryDocumentSchema.parse({
      version: OBSERVED_DIRECTORY_SCHEMA_VERSION,
      scopes: this.scopes,
    })
  }

  private async persistSafely() {
    try {
      await this.persistNow()
    } catch {
      this.onDiagnostic('write-failed')
    }
  }

  private async persistNow() {
    const temporaryPath = `${this.filePath}.${this.createId()}.tmp`
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 })
    try {
      await writeFile(
        temporaryPath,
        `${JSON.stringify(this.document(), null, 2)}\n`,
        { encoding: 'utf8', mode: 0o600 },
      )
      await rename(temporaryPath, this.filePath)
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined)
      throw error
    }
  }

  private async backUpCorruptFile() {
    const timestamp = new Date(this.now()).toISOString().replace(/[:.]/gu, '-')
    const backupName = `${basename(this.filePath)}.corrupt-${timestamp}-${this.createId()}.bak`
    await rename(this.filePath, join(dirname(this.filePath), backupName))
  }
}
