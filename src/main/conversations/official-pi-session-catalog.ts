import { createHash, randomUUID } from 'node:crypto'
import { lstat, open, opendir, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { z } from 'zod'
import {
  SESSION_CATALOG_MAX_CANDIDATES,
  SESSION_CATALOG_MAX_CONCURRENT_READERS,
  SESSION_CATALOG_MAX_FILE_BYTES,
  SESSION_CATALOG_MAX_PAGE_ROWS,
  SESSION_CATALOG_MAX_REFRESH_BYTES,
  SESSION_CATALOG_NAME_LIMIT,
  SESSION_CATALOG_PREVIEW_LIMIT,
  conversationScopeSchema,
  officialPiSessionSummarySchema,
  sessionCatalogCursorSchema,
  sessionCatalogListResultSchema,
  sessionCatalogSelectionTokenSchema,
  type ConversationScope,
  type OfficialPiSessionSummary,
  type SessionCatalogCursor,
  type SessionCatalogDiagnostic,
  type SessionCatalogDiagnosticCode,
  type SessionCatalogListResult,
  type SessionCatalogSelectionToken,
} from '../../shared/conversation-scope'
import type {
  ObservedPiSessionDirectory,
  ObservedPiSessionDirectoryRepository,
} from '../repositories/observed-pi-session-directory-repository'
import {
  conversationScopeKey,
  type ConversationScopeResolver,
  type ResolvedConversationScope,
} from './conversation-scope-resolver'

export const currentOfficialPiSessionHeaderSchema = z
  .object({
    type: z.literal('session'),
    version: z.literal(3),
    id: z
      .string()
      .min(1)
      .max(256)
      .regex(/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/u),
    timestamp: z.string().min(1).max(128),
    cwd: z.string().min(1).max(4_096).refine((value) => !value.includes('\0')),
    parentSession: z
      .string()
      .min(1)
      .max(4_096)
      .refine((value) => !value.includes('\0'))
      .optional(),
  })
  .passthrough()

export type CurrentOfficialPiSessionHeader = z.infer<
  typeof currentOfficialPiSessionHeaderSchema
>

const SESSION_CATALOG_MAX_HEADER_BYTES = 64 * 1_024
export const SESSION_CATALOG_REFRESH_FOREGROUND_MAX_SCANS = 4
export const SESSION_CATALOG_REFRESH_FOREGROUND_MAX_MS = 250

type CandidateIssueCode = Exclude<
  SessionCatalogDiagnosticCode,
  'candidateLimit' | 'directoryUnavailable'
>

class CandidateIssue extends Error {
  constructor(readonly code: CandidateIssueCode) {
    super(code)
    this.name = 'CandidateIssue'
  }
}

export type OfficialPiSessionCatalogErrorCode =
  | 'SESSION_CATALOG_CURSOR_STALE'
  | 'SESSION_CATALOG_SELECTION_STALE'

export class OfficialPiSessionCatalogError extends Error {
  constructor(
    readonly code: OfficialPiSessionCatalogErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'OfficialPiSessionCatalogError'
  }
}

interface FileIdentity {
  dev: number
  ino: number
  size: number
  mtimeMs: number
  ctimeMs: number
}

interface Candidate {
  path: string
  canonicalFile: string
  identity: FileIdentity
  orderToken: string
}

interface ParsedCandidate {
  candidate: Candidate
  canonicalParentSession?: string
  contentDigest: string
  createdAt: string
  headerIdentity: string
  modifiedAt: string
  name?: string
  prefixDigest?: string
  preview: string
  selectionMode: 'open' | 'recover'
  sessionId: string
}

interface InternalRow {
  candidate: Candidate
  contentDigest: string
  headerIdentity: string
  selectionMode: ParsedCandidate['selectionMode']
  summary: OfficialPiSessionSummary
}

interface LocatedSelection {
  cache: CatalogCache
  row: InternalRow
  scope: ConversationScope
  token: SessionCatalogSelectionToken
}

interface CursorState {
  nextIndex: number
  boundaryModifiedAt: string
  boundarySessionId: string
  boundaryOrderToken: string
}

interface CatalogCache {
  version: number
  scope: ConversationScope
  cwd: string
  root: string
  rows: InternalRow[]
  selections: Map<SessionCatalogSelectionToken, InternalRow>
  cursors: Map<SessionCatalogCursor, CursorState>
  cursorByIndex: Map<number, SessionCatalogCursor>
  diagnostics: SessionCatalogDiagnostic[]
}

interface ResolvedOfficialPiSessionSelectionBase {
  scope: ConversationScope
  cwd: string
  sessionId: string
}

export type ResolvedOfficialPiSessionSelection =
  | (ResolvedOfficialPiSessionSelectionBase & {
      mode: 'open'
      sessionFile: string
    })
  | (ResolvedOfficialPiSessionSelectionBase & {
      mode: 'recover'
      forkSessionFile: string
    })

export interface ResolvedOfficialPiSessionDeletionTarget {
  readonly scope: ConversationScope
  readonly cwd: string
  readonly sessionId: string
  readonly sessionFile: string
  readonly root: string
  readonly selectionMode: 'open' | 'recover'
  readonly headerIdentity: string
  readonly identity: {
    readonly dev: number
    readonly ino: number
  }
}

export interface OfficialPiSessionControlTarget {
  readonly scope: ConversationScope
  readonly cwd: string
  readonly sessionId: string
  readonly sessionFile: string
  readonly mode: 'open' | 'recover'
  readonly name?: string
  readonly createdAt: string
  readonly modifiedAt: string
  readonly root: string
  readonly headerIdentity: string
  readonly contentDigest: string
  readonly identity: FileIdentity
}

export interface OfficialPiSessionControlTargetListResult {
  readonly status: SessionCatalogListResult['status']
  readonly scope: ConversationScope
  readonly revision: number
  readonly targets: OfficialPiSessionControlTarget[]
  readonly diagnostics: SessionCatalogDiagnostic[]
}

export interface OfficialPiSessionCatalogOptions {
  createId?: () => string
  now?: () => number
  yieldRefreshContinuation?: () => Promise<void>
}

interface RefreshCoordinator {
  promise: Promise<SessionCatalogListResult>
  requestedVersion: number
  dirty: boolean
  followUp: boolean
}

class RefreshReadBudget {
  private consumed = 0

  consume(bytes: number) {
    if (bytes < 0 || this.consumed + bytes > SESSION_CATALOG_MAX_REFRESH_BYTES) {
      throw new CandidateIssue('refreshByteLimit')
    }
    this.consumed += bytes
  }
}

function identityFromStat(details: Awaited<ReturnType<typeof lstat>>): FileIdentity {
  return {
    dev: Number(details.dev),
    ino: Number(details.ino),
    size: Number(details.size),
    mtimeMs: Number(details.mtimeMs),
    ctimeMs: Number(details.ctimeMs),
  }
}

function createSessionHeaderIdentity(header: CurrentOfficialPiSessionHeader) {
  return createHash('sha256')
    .update(JSON.stringify([
      header.version,
      header.id,
      header.timestamp,
      header.cwd,
      header.parentSession ?? null,
    ]))
    .digest('hex')
}

function createReusableSelectionIdentity(row: InternalRow) {
  return JSON.stringify([
    row.candidate.canonicalFile,
    row.candidate.identity.dev,
    row.candidate.identity.ino,
    row.headerIdentity,
    row.selectionMode,
    row.summary.sessionId,
  ])
}

function createParsedSelectionIdentity(candidate: ParsedCandidate) {
  return JSON.stringify([
    candidate.candidate.canonicalFile,
    candidate.candidate.identity.dev,
    candidate.candidate.identity.ino,
    candidate.headerIdentity,
    candidate.selectionMode,
    candidate.sessionId,
  ])
}

function createCandidateFileIdentity(candidate: Candidate) {
  return JSON.stringify([
    candidate.canonicalFile,
    candidate.identity.dev,
    candidate.identity.ino,
  ])
}

function sameIdentity(left: FileIdentity, right: FileIdentity) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  )
}

function compareText(left: string, right: string) {
  if (left === right) return 0
  return left < right ? -1 : 1
}

function compareRows(left: InternalRow, right: InternalRow) {
  const modified = Date.parse(right.summary.modifiedAt) - Date.parse(left.summary.modifiedAt)
  if (modified !== 0) return modified
  const session = compareText(left.summary.sessionId, right.summary.sessionId)
  if (session !== 0) return session
  return compareText(left.candidate.orderToken, right.candidate.orderToken)
}

function normalizeVisibleText(value: string, limit: number) {
  return value
    .replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, limit)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNodeIoError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && typeof (error as NodeJS.ErrnoException).code === 'string'
}

function extractMessageText(content: unknown): string | undefined {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return undefined

  const text: string[] = []
  for (const block of content) {
    if (!isRecord(block) || block.type !== 'text') continue
    if (typeof block.text !== 'string') return undefined
    text.push(block.text)
  }
  return text.join(' ')
}

function parseTimestamp(value: unknown) {
  if (typeof value !== 'string') return undefined
  const timestamp = Date.parse(value)
  return Number.isNaN(timestamp) ? undefined : timestamp
}

function addDiagnostic(
  diagnostics: Map<SessionCatalogDiagnosticCode, number>,
  code: SessionCatalogDiagnosticCode,
) {
  diagnostics.set(code, (diagnostics.get(code) ?? 0) + 1)
}

function projectDiagnostics(
  diagnostics: Map<SessionCatalogDiagnosticCode, number>,
): SessionCatalogDiagnostic[] {
  return [...diagnostics]
    .sort(([left], [right]) => compareText(left, right))
    .map(([code, count]) => ({
      code,
      count: Math.min(count, SESSION_CATALOG_MAX_CANDIDATES + 1),
    }))
}

async function mapWithConcurrency<T, TResult>(
  values: readonly T[],
  limit: number,
  mapper: (value: T) => Promise<TResult>,
) {
  const results = new Array<TResult>(values.length)
  let nextIndex = 0

  const worker = async () => {
    while (nextIndex < values.length) {
      const index = nextIndex
      nextIndex += 1
      const value = values[index]
      if (value === undefined) continue
      results[index] = await mapper(value)
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(limit, values.length) },
      () => worker(),
    ),
  )
  return results
}

async function canonicalDirectFile(root: string, filePath: string) {
  const canonicalFile = await realpath(filePath)
  if (dirname(canonicalFile) !== root) throw new CandidateIssue('unsafeCandidate')
  return canonicalFile
}

function hasStableIdentity(
  details: Awaited<ReturnType<typeof lstat>>,
  identity: Pick<FileIdentity, 'dev' | 'ino'>,
) {
  return Number(details.dev) === identity.dev && Number(details.ino) === identity.ino
}

async function readDeletionTargetHeader(
  root: string,
  sessionFile: string,
  identity: Pick<FileIdentity, 'dev' | 'ino'>,
) {
  let handle: Awaited<ReturnType<typeof open>>
  try {
    handle = await open(sessionFile, 'r')
  } catch {
    throw new CandidateIssue('changedDuringRead')
  }

  try {
    const [openedDetails, directDetails, canonicalFile] = await Promise.all([
      handle.stat(),
      lstat(sessionFile),
      canonicalDirectFile(root, sessionFile),
    ])
    if (
      !openedDetails.isFile() ||
      !directDetails.isFile() ||
      directDetails.isSymbolicLink() ||
      canonicalFile !== sessionFile ||
      !hasStableIdentity(openedDetails, identity) ||
      !hasStableIdentity(directDetails, identity)
    ) {
      throw new CandidateIssue('changedDuringRead')
    }

    const fileSize = Number(openedDetails.size)
    if (!Number.isSafeInteger(fileSize) || fileSize <= 0) {
      throw new CandidateIssue('changedDuringRead')
    }
    const readLength = Math.min(fileSize, SESSION_CATALOG_MAX_HEADER_BYTES + 1)
    const buffer = Buffer.alloc(readLength)
    const { bytesRead } = await handle.read(buffer, 0, readLength, 0)
    const bytes = buffer.subarray(0, bytesRead)
    let lineEnd = bytes.indexOf(0x0a)
    if (lineEnd === -1) {
      if (fileSize > SESSION_CATALOG_MAX_HEADER_BYTES) {
        throw new CandidateIssue('changedDuringRead')
      }
      lineEnd = bytes.length
    }
    const decoder = new TextDecoder('utf-8', { fatal: true })
    const decoded = decoder.decode(bytes.subarray(0, lineEnd))
    const line = decoded.endsWith('\r') ? decoded.slice(0, -1) : decoded
    const header = currentOfficialPiSessionHeaderSchema.parse(
      JSON.parse(line) as unknown,
    )

    const [finalOpenedDetails, finalDirectDetails, finalCanonicalFile] =
      await Promise.all([
        handle.stat(),
        lstat(sessionFile),
        canonicalDirectFile(root, sessionFile),
      ])
    if (
      finalCanonicalFile !== sessionFile ||
      !finalDirectDetails.isFile() ||
      finalDirectDetails.isSymbolicLink() ||
      !hasStableIdentity(finalOpenedDetails, identity) ||
      !hasStableIdentity(finalDirectDetails, identity)
    ) {
      throw new CandidateIssue('changedDuringRead')
    }
    return header
  } catch (error) {
    if (error instanceof CandidateIssue) throw error
    throw new CandidateIssue('changedDuringRead')
  } finally {
    await handle.close().catch(() => undefined)
  }
}

async function resolveSelectionMode(
  header: CurrentOfficialPiSessionHeader,
  resolvedScope: ResolvedConversationScope,
): Promise<ParsedCandidate['selectionMode']> {
  try {
    if (!isAbsolute(header.cwd)) throw new Error('The header cwd is not absolute.')
    const headerCwd = await realpath(resolve(header.cwd))
    if (headerCwd !== resolvedScope.cwd) throw new CandidateIssue('scopeMismatch')
    return 'open'
  } catch (error) {
    if (error instanceof CandidateIssue) throw error
    const isRecoverableMissingCwd = resolvedScope.scope.kind === 'project' &&
      isNodeIoError(error) &&
      (error.code === 'ENOENT' || error.code === 'ENOTDIR')
    if (!isRecoverableMissingCwd) throw new CandidateIssue('scopeMismatch')
    return 'recover'
  }
}

async function validateRoot(observation: ObservedPiSessionDirectory) {
  if (!isAbsolute(observation.directory)) throw new Error('The catalog root is invalid.')
  const root = resolve(observation.directory)
  const details = await lstat(root)
  if (!details.isDirectory() || details.isSymbolicLink()) {
    throw new Error('The catalog root is unavailable.')
  }
  const canonicalRoot = await realpath(root)
  if (canonicalRoot !== root) throw new Error('The catalog root changed identity.')
  return canonicalRoot
}

async function enumerateCandidates(
  root: string,
  diagnostics: Map<SessionCatalogDiagnosticCode, number>,
) {
  const candidates: Candidate[] = []
  const directory = await opendir(root)
  let examined = 0

  for await (const entry of directory) {
    examined += 1
    if (examined > SESSION_CATALOG_MAX_CANDIDATES) {
      addDiagnostic(diagnostics, 'candidateLimit')
      break
    }
    if (!entry.name.endsWith('.jsonl')) continue
    if (!entry.isFile() || entry.isSymbolicLink()) {
      addDiagnostic(diagnostics, 'unsafeCandidate')
      continue
    }

    const candidatePath = join(root, entry.name)
    try {
      const details = await lstat(candidatePath)
      if (!details.isFile() || details.isSymbolicLink()) {
        throw new CandidateIssue('unsafeCandidate')
      }
      if (details.size > SESSION_CATALOG_MAX_FILE_BYTES) {
        throw new CandidateIssue('fileTooLarge')
      }
      const canonicalFile = await canonicalDirectFile(root, candidatePath)
      candidates.push({
        path: candidatePath,
        canonicalFile,
        identity: identityFromStat(details),
        orderToken: createHash('sha256').update(canonicalFile).digest('hex'),
      })
    } catch (error) {
      addDiagnostic(
        diagnostics,
        error instanceof CandidateIssue ? error.code : 'readFailed',
      )
    }
  }

  candidates.sort((left, right) => compareText(left.canonicalFile, right.canonicalFile))
  const accepted: Candidate[] = []
  let admittedBytes = 0
  for (const candidate of candidates) {
    if (admittedBytes + candidate.identity.size > SESSION_CATALOG_MAX_REFRESH_BYTES) {
      addDiagnostic(diagnostics, 'refreshByteLimit')
      continue
    }
    admittedBytes += candidate.identity.size
    accepted.push(candidate)
  }
  return accepted
}

async function parseCandidate(
  candidate: Candidate,
  resolvedScope: ResolvedConversationScope,
  budget: RefreshReadBudget,
  prefixByteLength?: number,
): Promise<ParsedCandidate> {
  if (candidate.identity.size === 0) throw new CandidateIssue('malformed')
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let handle: Awaited<ReturnType<typeof open>>
  try {
    handle = await open(candidate.path, 'r')
  } catch {
    throw new CandidateIssue('readFailed')
  }
  const stream = handle.createReadStream({
    autoClose: false,
    start: 0,
    end: candidate.identity.size - 1,
  })
  let pending = ''
  let bytesRead = 0
  const contentHasher = createHash('sha256')
  const prefixHasher = prefixByteLength === undefined
    ? undefined
    : createHash('sha256')
  let prefixBytesRead = 0
  let header: CurrentOfficialPiSessionHeader | undefined
  let name: string | undefined
  let preview = ''
  let lastActivityTime: number | undefined

  const parseLine = (rawLine: string) => {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    if (!line.trim()) return

    let rawEntry: unknown
    try {
      rawEntry = JSON.parse(line) as unknown
    } catch {
      throw new CandidateIssue('malformed')
    }

    if (!header) {
      if (!isRecord(rawEntry)) throw new CandidateIssue('malformed')
      if (rawEntry.type === 'session' && rawEntry.version !== 3) {
        throw new CandidateIssue('unsupported')
      }
      const parsedHeader = currentOfficialPiSessionHeaderSchema.safeParse(rawEntry)
      if (!parsedHeader.success) throw new CandidateIssue('malformed')
      header = parsedHeader.data
      return
    }

    if (!isRecord(rawEntry)) throw new CandidateIssue('malformed')
    if (rawEntry.type === 'session_info') {
      if (rawEntry.name !== undefined && typeof rawEntry.name !== 'string') {
        throw new CandidateIssue('malformed')
      }
      name = typeof rawEntry.name === 'string'
        ? normalizeVisibleText(rawEntry.name, SESSION_CATALOG_NAME_LIMIT) || undefined
        : undefined
      return
    }
    if (rawEntry.type !== 'message') return
    if (!isRecord(rawEntry.message)) throw new CandidateIssue('malformed')

    const role = rawEntry.message.role
    if (role !== 'user' && role !== 'assistant') return
    const text = extractMessageText(rawEntry.message.content)
    if (text === undefined) return
    if (!preview && role === 'user') {
      preview = normalizeVisibleText(text, SESSION_CATALOG_PREVIEW_LIMIT)
    }

    const messageTimestamp = rawEntry.message.timestamp
    const activityTime = typeof messageTimestamp === 'number' &&
      Number.isFinite(messageTimestamp) &&
      messageTimestamp > 0
      ? messageTimestamp
      : parseTimestamp(rawEntry.timestamp)
    if (activityTime !== undefined) {
      lastActivityTime = Math.max(lastActivityTime ?? 0, activityTime)
    }
  }

  try {
    const openedDetails = await handle.stat()
    const directDetails = await lstat(candidate.path)
    const openedCanonicalFile = await canonicalDirectFile(
      dirname(candidate.canonicalFile),
      candidate.path,
    )
    if (
      openedCanonicalFile !== candidate.canonicalFile ||
      !directDetails.isFile() ||
      directDetails.isSymbolicLink() ||
      !sameIdentity(candidate.identity, identityFromStat(openedDetails)) ||
      !sameIdentity(candidate.identity, identityFromStat(directDetails))
    ) {
      throw new CandidateIssue('changedDuringRead')
    }

    for await (const rawChunk of stream) {
      const chunk = Buffer.isBuffer(rawChunk)
        ? rawChunk
        : Buffer.from(rawChunk as Uint8Array)
      bytesRead += chunk.byteLength
      if (bytesRead > SESSION_CATALOG_MAX_FILE_BYTES) {
        throw new CandidateIssue('fileTooLarge')
      }
      budget.consume(chunk.byteLength)
      contentHasher.update(chunk)
      if (prefixHasher && prefixByteLength !== undefined && prefixBytesRead < prefixByteLength) {
        const prefixChunkLength = Math.min(
          chunk.byteLength,
          prefixByteLength - prefixBytesRead,
        )
        prefixHasher.update(chunk.subarray(0, prefixChunkLength))
        prefixBytesRead += prefixChunkLength
      }
      pending += decoder.decode(chunk, { stream: true })
      let lineFeed = pending.indexOf('\n')
      while (lineFeed >= 0) {
        parseLine(pending.slice(0, lineFeed))
        pending = pending.slice(lineFeed + 1)
        lineFeed = pending.indexOf('\n')
      }
    }
    pending += decoder.decode()
    if (pending) parseLine(pending)
    const finalOpenedDetails = await handle.stat()
    if (!sameIdentity(candidate.identity, identityFromStat(finalOpenedDetails))) {
      throw new CandidateIssue('changedDuringRead')
    }
  } catch (error) {
    stream.destroy()
    if (error instanceof CandidateIssue) throw error
    throw new CandidateIssue(isNodeIoError(error) ? 'readFailed' : 'malformed')
  } finally {
    await handle.close().catch(() => undefined)
  }

  if (!header) throw new CandidateIssue('malformed')

  const selectionMode = await resolveSelectionMode(header, resolvedScope)

  let canonicalParentSession: string | undefined
  if (header.parentSession && isAbsolute(header.parentSession)) {
    try {
      canonicalParentSession = await realpath(resolve(header.parentSession))
    } catch {
      // Parent lineage is optional navigation metadata. An unavailable parent
      // must not hide an otherwise valid current-cwd session.
    }
  }

  try {
    const finalDetails = await lstat(candidate.path)
    const finalCanonicalFile = await canonicalDirectFile(
      dirname(candidate.canonicalFile),
      candidate.path,
    )
    if (
      finalCanonicalFile !== candidate.canonicalFile ||
      !finalDetails.isFile() ||
      finalDetails.isSymbolicLink() ||
      !sameIdentity(candidate.identity, identityFromStat(finalDetails))
    ) {
      throw new CandidateIssue('changedDuringRead')
    }
  } catch (error) {
    if (error instanceof CandidateIssue) throw error
    throw new CandidateIssue('changedDuringRead')
  }

  const headerTime = parseTimestamp(header.timestamp)
  const fallbackTime = Number.isFinite(candidate.identity.mtimeMs)
    ? candidate.identity.mtimeMs
    : 0
  const createdTime = headerTime ?? fallbackTime
  const modifiedTime = lastActivityTime ?? headerTime ?? fallbackTime
  const contentDigest = contentHasher.digest('hex')
  const prefixDigest = prefixHasher && prefixBytesRead === prefixByteLength
    ? prefixHasher.digest('hex')
    : undefined
  return {
    candidate,
    ...(canonicalParentSession ? { canonicalParentSession } : {}),
    contentDigest,
    createdAt: new Date(Math.max(0, createdTime)).toISOString(),
    headerIdentity: createSessionHeaderIdentity(header),
    modifiedAt: new Date(Math.max(0, modifiedTime)).toISOString(),
    ...(name ? { name } : {}),
    ...(prefixDigest ? { prefixDigest } : {}),
    preview,
    selectionMode,
    sessionId: header.id,
  }
}

export class OfficialPiSessionCatalog {
  private readonly createId: () => string
  private readonly caches = new Map<string, CatalogCache>()
  private readonly now: () => number
  private readonly refreshes = new Map<string, RefreshCoordinator>()
  private readonly versions = new Map<string, number>()
  private readonly yieldRefreshContinuation: () => Promise<void>

  constructor(
    private readonly scopeResolver: ConversationScopeResolver,
    private readonly observedDirectories: ObservedPiSessionDirectoryRepository,
    options: OfficialPiSessionCatalogOptions = {},
  ) {
    this.createId = options.createId ?? randomUUID
    this.now = options.now ?? Date.now
    this.yieldRefreshContinuation = options.yieldRefreshContinuation ?? (() =>
      new Promise<void>((resolveContinuation) => {
        setTimeout(resolveContinuation, 0)
      }))
  }

  async list(
    rawScope: ConversationScope,
    rawCursor?: SessionCatalogCursor,
  ): Promise<SessionCatalogListResult> {
    const scope = conversationScopeSchema.parse(rawScope)
    const key = conversationScopeKey(scope)
    if (rawCursor !== undefined) {
      const cursorResult = sessionCatalogCursorSchema.safeParse(rawCursor)
      const cache = this.caches.get(key)
      const cursor = cursorResult.success ? cursorResult.data : undefined
      const currentVersion = this.versions.get(key) ?? 0
      const state = cursor && cache?.version === currentVersion
        ? cache.cursors.get(cursor)
        : undefined
      if (!cache || !state) {
        throw new OfficialPiSessionCatalogError(
          'SESSION_CATALOG_CURSOR_STALE',
          'The session catalog cursor is stale.',
        )
      }
      const boundary = cache.rows[state.nextIndex - 1]
      if (
        !boundary ||
        boundary.summary.modifiedAt !== state.boundaryModifiedAt ||
        boundary.summary.sessionId !== state.boundarySessionId ||
        boundary.candidate.orderToken !== state.boundaryOrderToken
      ) {
        throw new OfficialPiSessionCatalogError(
          'SESSION_CATALOG_CURSOR_STALE',
          'The session catalog cursor is stale.',
        )
      }
      return this.page(cache, state.nextIndex)
    }

    const cached = this.caches.get(key)
    if (cached?.version === (this.versions.get(key) ?? 0)) {
      return this.page(cached, 0)
    }

    const activeRefresh = this.refreshes.get(key)
    if (activeRefresh) return activeRefresh.promise
    return this.startRefresh(scope, key)
  }

  async refresh(
    rawScope: ConversationScope,
  ): Promise<SessionCatalogListResult> {
    const scope = conversationScopeSchema.parse(rawScope)
    const key = conversationScopeKey(scope)
    const activeRefresh = this.refreshes.get(key)
    if (activeRefresh) return activeRefresh.promise

    this.invalidate(scope)
    return this.list(scope)
  }

  /**
   * Main-only complete catalog projection for external control. This reuses
   * the bounded scan cache and deliberately omits Renderer selection tokens.
   */
  async listControlTargets(
    rawScope: ConversationScope,
  ): Promise<OfficialPiSessionControlTargetListResult> {
    const scope = conversationScopeSchema.parse(rawScope)
    const key = conversationScopeKey(scope)
    const result = await this.list(scope)
    const cache = this.caches.get(key)
    if (result.status !== 'ready' || !cache) {
      return {
        status: result.status,
        scope,
        revision: this.versions.get(key) ?? 0,
        targets: [],
        diagnostics: structuredClone(result.diagnostics),
      }
    }

    return {
      status: 'ready',
      scope,
      revision: cache.version,
      targets: cache.rows.map((row) => this.controlTargetFor(cache, row)),
      diagnostics: structuredClone(cache.diagnostics),
    }
  }

  /** Revalidate a Main-owned control target immediately before mutation. */
  async revalidateControlTarget(
    target: OfficialPiSessionControlTarget,
  ): Promise<OfficialPiSessionControlTarget> {
    const scope = conversationScopeSchema.parse(target.scope)
    const observation = this.observedDirectories.get(scope)
    if (!observation || observation.directory !== target.root) {
      throw this.staleSelection()
    }

    try {
      const [resolvedScope, root] = await Promise.all([
        this.scopeResolver.resolve(scope),
        validateRoot(observation),
      ])
      if (resolvedScope.cwd !== target.cwd || root !== target.root) {
        throw this.staleSelection()
      }

      const details = await lstat(target.sessionFile)
      const canonicalFile = await canonicalDirectFile(root, target.sessionFile)
      const currentIdentity = identityFromStat(details)
      if (
        canonicalFile !== target.sessionFile ||
        !details.isFile() ||
        details.isSymbolicLink() ||
        !hasStableIdentity(details, target.identity) ||
        currentIdentity.size < target.identity.size
      ) {
        throw this.staleSelection()
      }

      const parsed = await parseCandidate(
        {
          path: target.sessionFile,
          canonicalFile: target.sessionFile,
          identity: currentIdentity,
          orderToken: target.sessionFile,
        },
        resolvedScope,
        new RefreshReadBudget(),
        target.identity.size,
      )
      if (
        parsed.sessionId !== target.sessionId ||
        parsed.selectionMode !== target.mode ||
        parsed.headerIdentity !== target.headerIdentity ||
        parsed.prefixDigest !== target.contentDigest
      ) {
        throw this.staleSelection()
      }
      return structuredClone(target)
    } catch {
      throw this.staleSelection()
    }
  }

  async resolve(
    rawScope: ConversationScope,
    rawSelectionToken: SessionCatalogSelectionToken,
  ): Promise<ResolvedOfficialPiSessionSelection> {
    const selection = this.locateSelection(rawScope, rawSelectionToken)
    if (selection.row.selectionMode === 'recover') {
      // Recovery creates a new official session. Expire the rendered row as
      // soon as its one-shot token is consumed so a failed fork can be retried
      // from a freshly parsed token instead of leaving a dead row in the UI.
      this.consumeSelection(selection)
    }
    const { resolvedScope } = await this.validateCachedSelection(selection)

    const baseSelection = {
      scope: selection.scope,
      cwd: resolvedScope.cwd,
      sessionId: selection.row.summary.sessionId,
    }
    return selection.row.selectionMode === 'recover'
      ? {
          ...baseSelection,
          mode: 'recover' as const,
          forkSessionFile: selection.row.candidate.canonicalFile,
        }
      : {
          ...baseSelection,
          mode: 'open' as const,
          sessionFile: selection.row.candidate.canonicalFile,
        }
  }

  async consumeForDeletion(
    rawScope: ConversationScope,
    rawSelectionToken: SessionCatalogSelectionToken,
  ): Promise<ResolvedOfficialPiSessionDeletionTarget> {
    const selection = this.locateSelection(rawScope, rawSelectionToken)
    this.consumeSelection(selection)
    const { resolvedScope } = await this.validateCachedSelection(selection)
    return {
      scope: selection.scope,
      cwd: resolvedScope.cwd,
      sessionId: selection.row.summary.sessionId,
      sessionFile: selection.row.candidate.canonicalFile,
      root: selection.cache.root,
      selectionMode: selection.row.selectionMode,
      headerIdentity: selection.row.headerIdentity,
      identity: {
        dev: selection.row.candidate.identity.dev,
        ino: selection.row.candidate.identity.ino,
      },
    }
  }

  async revalidateDeletionTarget(
    target: ResolvedOfficialPiSessionDeletionTarget,
  ) {
    const scope = conversationScopeSchema.parse(target.scope)
    const observation = this.observedDirectories.get(scope)
    if (!observation || observation.directory !== target.root) {
      throw this.staleSelection()
    }

    try {
      const [resolvedScope, root] = await Promise.all([
        this.scopeResolver.resolve(scope),
        validateRoot(observation),
      ])
      if (resolvedScope.cwd !== target.cwd || root !== target.root) {
        throw this.staleSelection()
      }

      const header = await readDeletionTargetHeader(
        root,
        target.sessionFile,
        target.identity,
      )
      const selectionMode = await resolveSelectionMode(header, resolvedScope)
      if (
        header.id !== target.sessionId ||
        selectionMode !== target.selectionMode ||
        createSessionHeaderIdentity(header) !== target.headerIdentity
      ) {
        throw this.staleSelection()
      }
      return target.sessionFile
    } catch {
      throw this.staleSelection()
    }
  }

  invalidate(rawScope: ConversationScope) {
    const scope = conversationScopeSchema.parse(rawScope)
    const key = conversationScopeKey(scope)
    const version = (this.versions.get(key) ?? 0) + 1
    this.versions.set(key, version)
    const coordinator = this.refreshes.get(key)
    if (coordinator) {
      coordinator.requestedVersion = version
      coordinator.dirty = true
    }
  }

  private startRefresh(scope: ConversationScope, key: string) {
    const coordinator: RefreshCoordinator = {
      promise: Promise.resolve(undefined as never),
      requestedVersion: this.versions.get(key) ?? 0,
      dirty: false,
      followUp: false,
    }
    coordinator.promise = this.refreshFirstPage(scope, key, coordinator)
      .finally(() => {
        if (this.refreshes.get(key) === coordinator) this.refreshes.delete(key)
        if (coordinator.followUp) {
          this.scheduleRefreshContinuation(scope, key)
        }
      })
    this.refreshes.set(key, coordinator)
    return coordinator.promise
  }

  private async refreshFirstPage(
    scope: ConversationScope,
    key: string,
    coordinator: RefreshCoordinator,
  ) {
    let foregroundStartedAt = this.now()
    let foregroundScans = 0

    while (true) {
      const version = coordinator.requestedVersion
      coordinator.dirty = false
      const refreshed = await this.scan(scope, version, this.caches.get(key))
      foregroundScans += 1
      if (
        coordinator.dirty ||
        version !== coordinator.requestedVersion ||
        version !== (this.versions.get(key) ?? 0)
      ) {
        const budgetExhausted =
          foregroundScans >= SESSION_CATALOG_REFRESH_FOREGROUND_MAX_SCANS ||
          this.now() - foregroundStartedAt >= SESSION_CATALOG_REFRESH_FOREGROUND_MAX_MS
        if (budgetExhausted) {
          // Continuous extension/session events must not keep a renderer
          // request in `loading` forever. Publish the last coherent scan now,
          // retag it to the current catalog version so its pagination cursor
          // remains usable, and continue reconciliation in the background.
          coordinator.followUp = true
          return this.commitRefreshResult(
            key,
            refreshed,
            this.versions.get(key) ?? coordinator.requestedVersion,
          )
        }
        continue
      }
      return this.commitRefreshResult(key, refreshed)
    }
  }

  private commitRefreshResult(
    key: string,
    refreshed:
      | { cache: CatalogCache }
      | { result: SessionCatalogListResult },
    version?: number,
  ) {
    if ('cache' in refreshed) {
      const cache = version === undefined
        ? refreshed.cache
        : { ...refreshed.cache, version }
      this.caches.set(key, cache)
      return this.page(cache, 0)
    }
    this.caches.delete(key)
    return refreshed.result
  }

  private scheduleRefreshContinuation(scope: ConversationScope, key: string) {
    void this.yieldRefreshContinuation()
      .then(() => {
        if (this.refreshes.has(key)) return
        void this.startRefresh(scope, key).catch(() => undefined)
      })
      .catch(() => undefined)
  }

  private async scan(
    scope: ConversationScope,
    version: number,
    reusableCache?: CatalogCache,
  ): Promise<
    | { cache: CatalogCache }
    | { result: SessionCatalogListResult }
  > {
    const directoryState = this.observedDirectories.getState(scope)
    if (directoryState.status !== 'observed') {
      return {
        result: sessionCatalogListResultSchema.parse({
          status: directoryState.status,
          scope,
          rows: [],
          nextCursor: null,
          diagnostics: [],
        }),
      }
    }
    const observation = directoryState.observation

    let resolvedScope: ResolvedConversationScope
    let root: string
    try {
      resolvedScope = await this.scopeResolver.resolve(scope)
      root = await validateRoot(observation)
    } catch {
      return { result: this.unavailable(scope) }
    }

    const diagnosticCounts = new Map<SessionCatalogDiagnosticCode, number>()
    let candidates: Candidate[]
    try {
      candidates = await enumerateCandidates(root, diagnosticCounts)
    } catch {
      return { result: this.unavailable(scope) }
    }

    const budget = new RefreshReadBudget()
    const reusableRowsByFileIdentity = new Map<string, InternalRow>()
    if (
      reusableCache?.cwd === resolvedScope.cwd &&
      reusableCache.root === root
    ) {
      for (const row of reusableCache.rows) {
        const token = row.summary.selectionToken
        if (reusableCache.selections.get(token) === row) {
          reusableRowsByFileIdentity.set(
            createCandidateFileIdentity(row.candidate),
            row,
          )
        }
      }
    }
    const parsed = await mapWithConcurrency(
      candidates,
      SESSION_CATALOG_MAX_CONCURRENT_READERS,
      async (candidate) => {
        try {
          const reusableRow = reusableRowsByFileIdentity.get(
            createCandidateFileIdentity(candidate),
          )
          return await parseCandidate(
            candidate,
            resolvedScope,
            budget,
            reusableRow && candidate.identity.size >= reusableRow.candidate.identity.size
              ? reusableRow.candidate.identity.size
              : undefined,
          )
        } catch (error) {
          addDiagnostic(
            diagnosticCounts,
            error instanceof CandidateIssue ? error.code : 'readFailed',
          )
          return undefined
        }
      },
    )

    const parsedCandidates = parsed
      .filter((candidate): candidate is ParsedCandidate => candidate !== undefined)
    const recoveredSources = new Set(
      parsedCandidates
        .filter((candidate) => candidate.selectionMode === 'open')
        .map((candidate) => candidate.canonicalParentSession)
        .filter((source): source is string => source !== undefined),
    )
    const reusableSelections = new Map<
      string,
      { row: InternalRow; token: SessionCatalogSelectionToken }
    >()
    if (
      reusableCache?.cwd === resolvedScope.cwd &&
      reusableCache.root === root
    ) {
      for (const row of reusableCache.rows) {
        const token = row.summary.selectionToken
        if (reusableCache.selections.get(token) === row) {
          reusableSelections.set(createReusableSelectionIdentity(row), { row, token })
        }
      }
    }

    const selections = new Map<SessionCatalogSelectionToken, InternalRow>()
    const rows = parsedCandidates
      .filter((candidate) =>
        candidate.selectionMode === 'open' ||
        !recoveredSources.has(candidate.candidate.canonicalFile))
      .map((candidate): InternalRow => {
        const reusableSelection = reusableSelections.get(
          createParsedSelectionIdentity(candidate),
        )
        const reusableToken = reusableSelection &&
          candidate.candidate.identity.size >=
            reusableSelection.row.candidate.identity.size &&
          candidate.prefixDigest === reusableSelection.row.contentDigest
          ? reusableSelection.token
          : undefined
        const selectionToken = reusableToken && !selections.has(reusableToken)
          ? reusableToken
          : this.createOpaqueToken('sel', (token) =>
              selections.has(token as SessionCatalogSelectionToken),
            ) as SessionCatalogSelectionToken
        const summary = officialPiSessionSummarySchema.parse({
          scope,
          sessionId: candidate.sessionId,
          ...(candidate.name ? { name: candidate.name } : {}),
          preview: candidate.preview,
          createdAt: candidate.createdAt,
          modifiedAt: candidate.modifiedAt,
          selectionToken,
        })
        const row = {
          candidate: candidate.candidate,
          contentDigest: candidate.contentDigest,
          headerIdentity: candidate.headerIdentity,
          selectionMode: candidate.selectionMode,
          summary,
        }
        selections.set(selectionToken, row)
        return row
      })
      .sort(compareRows)

    return {
      cache: {
        version,
        scope,
        cwd: resolvedScope.cwd,
        root,
        rows,
        selections,
        cursors: new Map(),
        cursorByIndex: new Map(),
        diagnostics: projectDiagnostics(diagnosticCounts),
      },
    }
  }

  private page(cache: CatalogCache, startIndex: number) {
    const endIndex = Math.min(
      cache.rows.length,
      startIndex + SESSION_CATALOG_MAX_PAGE_ROWS,
    )
    const rows = cache.rows
      .slice(startIndex, endIndex)
      .map((row) => row.summary)
    let nextCursor: SessionCatalogCursor | null = null

    if (endIndex < cache.rows.length) {
      nextCursor = cache.cursorByIndex.get(endIndex) ?? null
      if (!nextCursor) {
        const boundary = cache.rows[endIndex - 1]
        if (!boundary) throw new Error('The catalog page boundary is invalid.')
        nextCursor = this.createOpaqueToken('cur', (token) =>
          cache.cursors.has(token as SessionCatalogCursor),
        ) as SessionCatalogCursor
        cache.cursorByIndex.set(endIndex, nextCursor)
        cache.cursors.set(nextCursor, {
          nextIndex: endIndex,
          boundaryModifiedAt: boundary.summary.modifiedAt,
          boundarySessionId: boundary.summary.sessionId,
          boundaryOrderToken: boundary.candidate.orderToken,
        })
      }
    }

    return sessionCatalogListResultSchema.parse({
      status: 'ready',
      scope: cache.scope,
      rows,
      nextCursor,
      diagnostics: cache.diagnostics,
    })
  }

  private controlTargetFor(
    cache: CatalogCache,
    row: InternalRow,
  ): OfficialPiSessionControlTarget {
    return {
      scope: structuredClone(cache.scope),
      cwd: cache.cwd,
      sessionId: row.summary.sessionId,
      sessionFile: row.candidate.canonicalFile,
      mode: row.selectionMode,
      ...(row.summary.name ? { name: row.summary.name } : {}),
      createdAt: row.summary.createdAt,
      modifiedAt: row.summary.modifiedAt,
      root: cache.root,
      headerIdentity: row.headerIdentity,
      contentDigest: row.contentDigest,
      identity: { ...row.candidate.identity },
    }
  }

  private unavailable(scope: ConversationScope) {
    return sessionCatalogListResultSchema.parse({
      status: 'unavailable',
      scope,
      rows: [],
      nextCursor: null,
      diagnostics: [{ code: 'directoryUnavailable', count: 1 }],
    })
  }

  private createOpaqueToken(
    prefix: 'cur' | 'sel',
    isUsed: (token: string) => boolean,
  ) {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const value = this.createId().replace(/[^A-Za-z0-9_-]/gu, '')
      const token = `${prefix}_${value}`
      if (value.length >= 16 && !isUsed(token)) return token
    }
    throw new Error('Could not create a unique catalog token.')
  }

  private locateSelection(
    rawScope: ConversationScope,
    rawSelectionToken: SessionCatalogSelectionToken,
  ): LocatedSelection {
    const scope = conversationScopeSchema.parse(rawScope)
    const cache = this.caches.get(conversationScopeKey(scope))
    const tokenResult = sessionCatalogSelectionTokenSchema.safeParse(rawSelectionToken)
    const token = tokenResult.success ? tokenResult.data : undefined
    const row = token ? cache?.selections.get(token) : undefined
    if (!cache || !token || !row) throw this.staleSelection()
    return { cache, row, scope, token }
  }

  private consumeSelection(selection: LocatedSelection) {
    if (!selection.cache.selections.delete(selection.token)) {
      throw this.staleSelection()
    }
    this.invalidate(selection.scope)
  }

  private async validateCachedSelection(selection: LocatedSelection) {
    const { cache, row, scope } = selection
    const observation = this.observedDirectories.get(scope)
    if (
      !observation ||
      observation.directory !== cache.root
    ) {
      throw this.staleSelection()
    }

    let resolvedScope: ResolvedConversationScope
    let root: string
    try {
      resolvedScope = await this.scopeResolver.resolve(scope)
      root = await validateRoot(observation)
    } catch {
      throw this.staleSelection()
    }
    if (resolvedScope.cwd !== cache.cwd || root !== cache.root) {
      throw this.staleSelection()
    }

    try {
      const details = await lstat(row.candidate.path)
      const canonicalFile = await canonicalDirectFile(root, row.candidate.path)
      const currentIdentity = identityFromStat(details)
      if (
        canonicalFile !== row.candidate.canonicalFile ||
        !details.isFile() ||
        details.isSymbolicLink() ||
        !hasStableIdentity(details, row.candidate.identity) ||
        currentIdentity.size < row.candidate.identity.size
      ) {
        throw this.staleSelection()
      }
      const parsed = await parseCandidate(
        {
          ...row.candidate,
          identity: currentIdentity,
        },
        resolvedScope,
        new RefreshReadBudget(),
        row.candidate.identity.size,
      )
      if (
        parsed.sessionId !== row.summary.sessionId ||
        parsed.selectionMode !== row.selectionMode ||
        parsed.headerIdentity !== row.headerIdentity ||
        parsed.prefixDigest !== row.contentDigest
      ) {
        throw this.staleSelection()
      }
    } catch {
      throw this.staleSelection()
    }
    return { resolvedScope }
  }

  private staleSelection() {
    return new OfficialPiSessionCatalogError(
      'SESSION_CATALOG_SELECTION_STALE',
      'The selected session is stale. Refresh the catalog and try again.',
    )
  }
}
