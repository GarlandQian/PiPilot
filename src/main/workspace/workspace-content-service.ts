import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import {
  open,
  opendir,
  readFile,
  realpath,
  stat,
} from 'node:fs/promises'
import {
  isAbsolute,
  relative,
  resolve,
  sep,
} from 'node:path'
import {
  WORKSPACE_DIFF_FILE_LIMIT,
  WORKSPACE_DIFF_PATCH_BYTE_LIMIT,
  WORKSPACE_DIRECTORY_ENTRY_LIMIT,
  WORKSPACE_PATH_SEARCH_RESULT_LIMIT,
  WORKSPACE_PREVIEW_BYTE_LIMIT,
  workspaceDiffFileSchema,
  workspaceDiffSnapshotSchema,
  workspaceDirectorySnapshotSchema,
  workspaceFilePreviewSchema,
  workspacePathSearchResultSchema,
  workspaceRelativePathSchema,
  type WorkspaceChangeSummary,
  type WorkspaceDiffFile,
  type WorkspaceDiffSnapshot,
  type WorkspaceDirectorySnapshot,
  type WorkspaceFilePreview,
  type WorkspaceFileStatus,
  type WorkspacePathSearchEntry,
  type WorkspacePathSearchResult,
} from '../../shared/workspace-content'

const GIT_TIMEOUT_MS = 5_000
const GIT_OUTPUT_LIMIT = 4 * 1024 * 1024
const GIT_SNAPSHOT_COALESCE_MS = 50
const WORKSPACE_PATH_SEARCH_VISIT_LIMIT = 10_000
const GIT_NULL_DEVICE = process.platform === 'win32' ? 'NUL' : '/dev/null'

const IGNORED_DIRECTORY_NAMES = new Set([
  '.cache',
  '.dart_tool',
  '.gradle',
  '.git',
  '.mypy_cache',
  '.next',
  '.nuxt',
  '.nx',
  '.parcel-cache',
  '.pnpm-store',
  '.pytest_cache',
  '.ruff_cache',
  '.svelte-kit',
  '.tox',
  '.turbo',
  '.venv',
  '.vite',
  '__pycache__',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'target',
  'venv',
])

export type WorkspaceContentErrorCode =
  | 'WORKSPACE_CONTENT_NO_WORKSPACE'
  | 'WORKSPACE_CONTENT_STALE_WORKSPACE'
  | 'WORKSPACE_PATH_INVALID'
  | 'WORKSPACE_PATH_OUTSIDE'
  | 'WORKSPACE_PATH_NOT_FOUND'
  | 'WORKSPACE_PATH_NOT_DIRECTORY'
  | 'WORKSPACE_PATH_NOT_FILE'
  | 'WORKSPACE_FILE_UNREADABLE'
  | 'WORKSPACE_GIT_UNAVAILABLE'
  | 'WORKSPACE_CHANGE_NOT_FOUND'
  | 'WORKSPACE_CHANGE_CONFLICT'

export class WorkspaceContentError extends Error {
  constructor(
    readonly code: WorkspaceContentErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'WorkspaceContentError'
  }
}

export interface WorkspaceContentLocation {
  id: string
  path: string
}

interface WorkspaceContentServiceOptions {
  gitBinary?: string
}

interface GitEntry {
  path: string
  previousPath?: string
  status: WorkspaceFileStatus
  unstaged: boolean
  untracked: boolean
}

interface GitNumStat {
  added: number
  deleted: number
  binary: boolean
}

interface GitSnapshot {
  available: boolean
  branch: string
  entries: Map<string, GitEntry>
  numStats: Map<string, GitNumStat>
}

interface GitResult<TOutput extends string | Buffer> {
  stdout: TOutput
  stderr: TOutput
}

function isOutside(root: string, candidate: string) {
  const fromRoot = relative(root, candidate)
  return (
    fromRoot === '..' ||
    fromRoot.startsWith(`..${sep}`) ||
    isAbsolute(fromRoot)
  )
}

function pathSearchRank(entry: WorkspacePathSearchEntry, terms: readonly string[]) {
  const name = entry.name.toLocaleLowerCase()
  const path = entry.path.toLocaleLowerCase()
  let score = entry.type === 'dir' ? 0 : 1
  for (const term of terms) {
    if (name === term) score += 0
    else if (name.startsWith(term)) score += 10
    else if (name.includes(term)) score += 20 + name.indexOf(term)
    else if (path.includes(term)) score += 40 + path.indexOf(term)
    else return undefined
  }
  return score + entry.path.split('/').length
}

function ignoredPath(path: string) {
  return path !== '.' && path
    .split('/')
    .some((part) => IGNORED_DIRECTORY_NAMES.has(part))
}

function hash(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex')
}

function isBinary(buffer: Buffer) {
  if (buffer.includes(0)) return true
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer)
    return false
  } catch {
    return true
  }
}

function lineCount(text: string) {
  if (text.length === 0) return 0
  const matches = text.match(/\n/g)?.length ?? 0
  return matches + (text.endsWith('\n') ? 0 : 1)
}

function boundUnifiedPatch(patch: string, inputComplete = true) {
  if (inputComplete && Buffer.byteLength(patch) <= WORKSPACE_DIFF_PATCH_BYTE_LIMIT) {
    return { patch, truncated: false }
  }

  const hunkStarts = [...patch.matchAll(/^@@ /gmu)].map((match) => match.index)
  if (hunkStarts.length === 0) return { patch: '', truncated: true }

  const prefix = patch.slice(0, hunkStarts[0])
  if (Buffer.byteLength(prefix) > WORKSPACE_DIFF_PATCH_BYTE_LIMIT) {
    return { patch: '', truncated: true }
  }

  let bounded = prefix
  const lastCompleteHunk = inputComplete ? hunkStarts.length : hunkStarts.length - 1
  for (let index = 0; index < lastCompleteHunk; index += 1) {
    const hunk = patch.slice(hunkStarts[index], hunkStarts[index + 1] ?? patch.length)
    if (Buffer.byteLength(bounded) + Buffer.byteLength(hunk) > WORKSPACE_DIFF_PATCH_BYTE_LIMIT) {
      break
    }
    bounded += hunk
  }
  return { patch: bounded, truncated: true }
}

function parsePorcelain(output: string) {
  const entries = new Map<string, GitEntry>()
  const records = output.split('\0')
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    if (!record || record.length < 4) continue
    const x = record[0]
    const y = record[1]
    const path = record.slice(3)
    let previousPath: string | undefined
    if ((x === 'R' || x === 'C' || y === 'R' || y === 'C') && records[index + 1]) {
      previousPath = records[index + 1]
      index += 1
    }
    if (!workspaceRelativePathSchema.safeParse(path).success || ignoredPath(path)) continue
    const status: WorkspaceFileStatus = x === '?' || x === 'A' || y === 'A'
      ? 'added'
      : x === 'D' || y === 'D'
        ? 'deleted'
        : 'modified'
    entries.set(path, {
      path,
      ...(previousPath && workspaceRelativePathSchema.safeParse(previousPath).success
        ? { previousPath }
        : {}),
      status,
      unstaged: x === '?' || y !== ' ',
      untracked: x === '?',
    })
  }
  return entries
}

function parseNumStats(output: string) {
  const stats = new Map<string, GitNumStat>()
  const records = output.split('\0')
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    if (!record) continue
    const fields = record.split('\t')
    if (fields.length < 3) continue
    const [addedText, deletedText, inlinePath] = fields
    const path = inlinePath || records[index + 2]
    if (!inlinePath && records[index + 1] && records[index + 2]) index += 2
    if (!workspaceRelativePathSchema.safeParse(path).success || ignoredPath(path)) continue
    const binary = addedText === '-' || deletedText === '-'
    stats.set(path, {
      added: binary ? 0 : Number.parseInt(addedText, 10) || 0,
      deleted: binary ? 0 : Number.parseInt(deletedText, 10) || 0,
      binary,
    })
  }
  return stats
}

export class WorkspaceContentService {
  private readonly gitBinary: string
  private readonly gitSnapshots = new Map<
    string,
    { expiresAt: number; value: Promise<GitSnapshot> }
  >()

  constructor(
    private readonly getCurrentLocation: () => WorkspaceContentLocation | undefined,
    options: WorkspaceContentServiceOptions = {},
  ) {
    this.gitBinary = options.gitBinary ?? 'git'
  }

  async listDirectory(workspaceId: string, path: string): Promise<WorkspaceDirectorySnapshot> {
    const { root } = await this.context(workspaceId)
    const requestedPath = this.parsePath(path)
    const target = await this.resolveExisting(root, requestedPath)
    const targetStat = await stat(target)
    if (!targetStat.isDirectory()) {
      throw new WorkspaceContentError(
        'WORKSPACE_PATH_NOT_DIRECTORY',
        'The requested workspace path is not a directory.',
      )
    }

    const git = await this.gitSnapshot(root)
    const statusEntries = git.available ? git.entries : new Map<string, GitEntry>()
    const entries: WorkspaceDirectorySnapshot['entries'] = []
    let truncated = false
    const directory = await opendir(target)
    try {
      for await (const entry of directory) {
        if (entries.length >= WORKSPACE_DIRECTORY_ENTRY_LIMIT) {
          truncated = true
          break
        }
        const childPath = requestedPath === '.' ? entry.name : `${requestedPath}/${entry.name}`
        if (
          !workspaceRelativePathSchema.safeParse(childPath).success ||
          IGNORED_DIRECTORY_NAMES.has(entry.name)
        ) continue

        let type: 'file' | 'dir'
        if (entry.isDirectory()) type = 'dir'
        else if (entry.isFile()) type = 'file'
        else if (entry.isSymbolicLink()) {
          try {
            const childTarget = await this.resolveExisting(root, childPath)
            const childStat = await stat(childTarget)
            if (childStat.isDirectory()) type = 'dir'
            else if (childStat.isFile()) type = 'file'
            else continue
          } catch {
            continue
          }
        } else {
          continue
        }

        const status = this.statusForPath(statusEntries, childPath, type === 'dir')
        entries.push({
          name: entry.name.slice(0, 512),
          path: childPath,
          type,
          ...(status ? { status } : {}),
          ...(type === 'dir' ? { hasChildren: true } : {}),
        })
      }
    } finally {
      await directory.close().catch(() => undefined)
    }

    for (const change of statusEntries.values()) {
      if (change.status !== 'deleted') continue
      const parent = change.path.includes('/')
        ? change.path.slice(0, change.path.lastIndexOf('/'))
        : '.'
      if (parent !== requestedPath || entries.some((entry) => entry.path === change.path)) continue
      if (entries.length >= WORKSPACE_DIRECTORY_ENTRY_LIMIT) {
        truncated = true
        break
      }
      const name = change.path.slice(change.path.lastIndexOf('/') + 1)
      entries.push({ name, path: change.path, type: 'file', status: 'deleted' })
    }

    entries.sort((left, right) => {
      if (left.type !== right.type) return left.type === 'dir' ? -1 : 1
      return left.name.localeCompare(right.name, 'en')
    })

    await this.assertActiveWorkspace(workspaceId, root)
    return workspaceDirectorySnapshotSchema.parse({
      workspaceId,
      path: requestedPath,
      entries,
      truncated,
      modifiedCount: statusEntries.size,
      gitAvailable: git.available,
    })
  }

  async searchPaths(workspaceId: string, query: string): Promise<WorkspacePathSearchResult> {
    const { root } = await this.context(workspaceId)
    const normalizedQuery = query.trim().slice(0, 512)
    const terms = normalizedQuery
      .toLocaleLowerCase()
      .split(/\s+/u)
      .filter(Boolean)
    const pending: Array<{ absolute: string; relative: string }> = [{
      absolute: root,
      relative: '.',
    }]
    const visitedDirectories = new Set<string>([root])
    const matches: Array<{ entry: WorkspacePathSearchEntry; score: number }> = []
    let visited = 0
    let truncated = false

    while (pending.length > 0 && visited < WORKSPACE_PATH_SEARCH_VISIT_LIMIT) {
      const current = pending.shift()!
      const directory = await opendir(current.absolute)
      try {
        for await (const item of directory) {
          visited += 1
          if (visited > WORKSPACE_PATH_SEARCH_VISIT_LIMIT) {
            truncated = true
            break
          }
          if (IGNORED_DIRECTORY_NAMES.has(item.name)) continue
          const childPath = current.relative === '.'
            ? item.name
            : `${current.relative}/${item.name}`
          if (!workspaceRelativePathSchema.safeParse(childPath).success) continue

          let type: WorkspacePathSearchEntry['type']
          let canonicalTarget: string | undefined
          if (item.isDirectory()) type = 'dir'
          else if (item.isFile()) type = 'file'
          else if (item.isSymbolicLink()) {
            try {
              canonicalTarget = await this.resolveExisting(root, childPath)
              const details = await stat(canonicalTarget)
              if (details.isDirectory()) type = 'dir'
              else if (details.isFile()) type = 'file'
              else continue
            } catch {
              continue
            }
          } else continue

          const entry: WorkspacePathSearchEntry = {
            name: item.name.slice(0, 512),
            path: childPath,
            type,
          }
          const score = pathSearchRank(entry, terms)
          if (score !== undefined) matches.push({ entry, score })

          if (type === 'dir' && terms.length > 0) {
            const target = canonicalTarget ?? await this.resolveExisting(root, childPath)
            if (!visitedDirectories.has(target)) {
              visitedDirectories.add(target)
              pending.push({ absolute: target, relative: childPath })
            }
          }
        }
      } finally {
        await directory.close().catch(() => undefined)
      }
      if (terms.length === 0) break
    }

    if (pending.length > 0 || matches.length > WORKSPACE_PATH_SEARCH_RESULT_LIMIT) {
      truncated = true
    }
    matches.sort((left, right) =>
      left.score - right.score ||
      left.entry.path.localeCompare(right.entry.path, 'en'))
    await this.assertActiveWorkspace(workspaceId, root)
    return workspacePathSearchResultSchema.parse({
      workspaceId,
      query: normalizedQuery,
      entries: matches
        .slice(0, WORKSPACE_PATH_SEARCH_RESULT_LIMIT)
        .map(({ entry }) => entry),
      truncated,
    })
  }

  async previewFile(workspaceId: string, path: string): Promise<WorkspaceFilePreview> {
    const { root } = await this.context(workspaceId)
    const requestedPath = this.parsePath(path)
    const target = await this.resolveExisting(root, requestedPath)
    let handle
    try {
      handle = await open(
        target,
        constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
      )
    } catch {
      throw new WorkspaceContentError(
        'WORKSPACE_FILE_UNREADABLE',
        'The workspace file could not be read.',
      )
    }

    try {
      const details = await handle.stat()
      if (!details.isFile()) {
        throw new WorkspaceContentError(
          'WORKSPACE_PATH_NOT_FILE',
          'The requested workspace path is not a file.',
        )
      }
      if (details.size > WORKSPACE_PREVIEW_BYTE_LIMIT) {
        await this.assertActiveWorkspace(workspaceId, root)
        return workspaceFilePreviewSchema.parse({
          workspaceId,
          path: requestedPath,
          kind: 'too-large',
          size: details.size,
          fingerprint: hash(`large\0${details.size}\0${details.mtimeMs}`),
          limit: WORKSPACE_PREVIEW_BYTE_LIMIT,
        })
      }

      const bounded = Buffer.alloc(WORKSPACE_PREVIEW_BYTE_LIMIT + 1)
      let length = 0
      while (length < bounded.length) {
        const result = await handle.read(
          bounded,
          length,
          bounded.length - length,
          length,
        )
        if (result.bytesRead === 0) break
        length += result.bytesRead
      }
      const finalDetails = await handle.stat()
      if (length > WORKSPACE_PREVIEW_BYTE_LIMIT || finalDetails.size > WORKSPACE_PREVIEW_BYTE_LIMIT) {
        await this.assertActiveWorkspace(workspaceId, root)
        return workspaceFilePreviewSchema.parse({
          workspaceId,
          path: requestedPath,
          kind: 'too-large',
          size: Math.max(length, finalDetails.size),
          fingerprint: hash(`large\0${finalDetails.size}\0${finalDetails.mtimeMs}`),
          limit: WORKSPACE_PREVIEW_BYTE_LIMIT,
        })
      }
      if (
        details.size !== finalDetails.size ||
        details.mtimeMs !== finalDetails.mtimeMs ||
        details.ctimeMs !== finalDetails.ctimeMs
      ) {
        throw new WorkspaceContentError(
          'WORKSPACE_CHANGE_CONFLICT',
          'The file changed outside PiPilot. Refresh before trying again.',
        )
      }

      const content = bounded.subarray(0, length)
      const fingerprint = hash(content)
      if (isBinary(content)) {
        await this.assertActiveWorkspace(workspaceId, root)
        return workspaceFilePreviewSchema.parse({
          workspaceId,
          path: requestedPath,
          kind: 'binary',
          size: content.length,
          fingerprint,
        })
      }
      await this.assertActiveWorkspace(workspaceId, root)
      return workspaceFilePreviewSchema.parse({
        workspaceId,
        path: requestedPath,
        kind: 'text',
        size: content.length,
        fingerprint,
        content: content.toString('utf8'),
      })
    } finally {
      await handle.close().catch(() => undefined)
    }
  }

  async listChanges(workspaceId: string): Promise<WorkspaceDiffSnapshot> {
    const { root } = await this.context(workspaceId)
    const git = await this.gitSnapshot(root)
    if (!git.available) {
      await this.assertActiveWorkspace(workspaceId, root)
      return workspaceDiffSnapshotSchema.parse({
        workspaceId,
        gitAvailable: false,
        branch: '',
        files: [],
        truncated: false,
      })
    }

    const candidates = [...git.entries.values()]
      .filter((entry) => entry.unstaged)
      .sort((left, right) => left.path.localeCompare(right.path, 'en'))
    let truncated = false
    const files: WorkspaceChangeSummary[] = []
    for (const entry of candidates) {
      if (files.length >= WORKSPACE_DIFF_FILE_LIMIT) {
        truncated = true
        break
      }
      try {
        files.push(await this.changeSummary(root, git, entry))
      } catch (error) {
        if (
          error instanceof WorkspaceContentError &&
          [
            'WORKSPACE_PATH_NOT_FILE',
            'WORKSPACE_PATH_NOT_FOUND',
            'WORKSPACE_PATH_OUTSIDE',
          ].includes(error.code)
        ) {
          continue
        }
        throw error
      }
    }
    await this.assertActiveWorkspace(workspaceId, root)
    return workspaceDiffSnapshotSchema.parse({
      workspaceId,
      gitAvailable: true,
      branch: git.branch,
      files,
      truncated,
    })
  }

  async readDiff(workspaceId: string, path: string): Promise<WorkspaceDiffFile> {
    const { root } = await this.context(workspaceId)
    const requestedPath = this.parsePath(path)
    const git = await this.gitSnapshot(root)
    if (!git.available) {
      throw new WorkspaceContentError(
        'WORKSPACE_GIT_UNAVAILABLE',
        'Git integration is unavailable for this workspace.',
      )
    }
    const entry = git.entries.get(requestedPath)
    if (!entry?.unstaged) {
      throw new WorkspaceContentError(
        'WORKSPACE_CHANGE_NOT_FOUND',
        'The requested workspace change no longer exists.',
      )
    }
    const summary = await this.changeSummary(root, git, entry)
    if (summary.binary) {
      await this.assertActiveWorkspace(workspaceId, root)
      return workspaceDiffFileSchema.parse({
        workspaceId,
        ...summary,
        patch: '',
        truncated: false,
      })
    }

    const result = entry.untracked
      ? await this.runGitBoundedPatch(root, [
          'diff',
          '--no-index',
          '--no-ext-diff',
          '--no-textconv',
          '--no-color',
          '--unified=3',
          '--',
          GIT_NULL_DEVICE,
          requestedPath,
        ], true)
      : await this.runGitBoundedPatch(root, [
        'diff',
        '--no-ext-diff',
        '--no-textconv',
        '--no-color',
        '--find-renames',
        '--unified=3',
        '--',
        requestedPath,
      ])
    const binary = /^Binary files .+ differ$/mu.test(result.patch)
    await this.assertActiveWorkspace(workspaceId, root)
    return workspaceDiffFileSchema.parse({
      workspaceId,
      ...summary,
      binary,
      patch: binary ? '' : result.patch,
      truncated: result.truncated,
    })
  }

  private async context(workspaceId: string) {
    const location = this.getCurrentLocation()
    if (!location) {
      throw new WorkspaceContentError(
        'WORKSPACE_CONTENT_NO_WORKSPACE',
        'No active workspace is available.',
      )
    }
    if (location.id !== workspaceId) {
      throw new WorkspaceContentError(
        'WORKSPACE_CONTENT_STALE_WORKSPACE',
        'The workspace request is stale.',
      )
    }
    let root: string
    try {
      root = await realpath(location.path)
    } catch {
      throw new WorkspaceContentError(
        'WORKSPACE_CONTENT_NO_WORKSPACE',
        'No active workspace is available.',
      )
    }
    return { location, root }
  }

  private async assertActiveWorkspace(workspaceId: string, root: string) {
    const location = this.getCurrentLocation()
    if (!location || location.id !== workspaceId) {
      throw new WorkspaceContentError(
        'WORKSPACE_CONTENT_STALE_WORKSPACE',
        'The workspace request is stale.',
      )
    }
    let activeRoot: string
    try {
      activeRoot = await realpath(location.path)
    } catch {
      throw new WorkspaceContentError(
        'WORKSPACE_CONTENT_STALE_WORKSPACE',
        'The workspace request is stale.',
      )
    }
    if (activeRoot !== root) {
      throw new WorkspaceContentError(
        'WORKSPACE_CONTENT_STALE_WORKSPACE',
        'The workspace request is stale.',
      )
    }
  }

  private parsePath(path: string) {
    const result = workspaceRelativePathSchema.safeParse(path)
    if (!result.success) {
      throw new WorkspaceContentError(
        'WORKSPACE_PATH_INVALID',
        'The workspace path is invalid.',
      )
    }
    return result.data
  }

  private lexicalTarget(root: string, path: string) {
    const target = path === '.' ? root : resolve(root, ...path.split('/'))
    if (isOutside(root, target)) {
      throw new WorkspaceContentError(
        'WORKSPACE_PATH_OUTSIDE',
        'The workspace path resolves outside the active workspace.',
      )
    }
    return target
  }

  private async resolveExisting(root: string, path: string) {
    const target = this.lexicalTarget(root, path)
    let canonical: string
    try {
      canonical = await realpath(target)
    } catch {
      throw new WorkspaceContentError(
        'WORKSPACE_PATH_NOT_FOUND',
        'The workspace path was not found.',
      )
    }
    if (isOutside(root, canonical)) {
      throw new WorkspaceContentError(
        'WORKSPACE_PATH_OUTSIDE',
        'The workspace path resolves outside the active workspace.',
      )
    }
    return canonical
  }

  private statusForPath(
    entries: Map<string, GitEntry>,
    path: string,
    directory: boolean,
  ) {
    const exact = entries.get(path)?.status
    if (exact || !directory) return exact
    const prefix = `${path}/`
    for (const entry of entries.values()) {
      if (entry.path.startsWith(prefix)) return 'modified' as const
    }
    return undefined
  }

  private async gitSnapshot(root: string): Promise<GitSnapshot> {
    const cached = this.gitSnapshots.get(root)
    if (cached && cached.expiresAt > Date.now()) return cached.value
    const value = this.loadGitSnapshot(root)
    const entry = {
      expiresAt: Number.POSITIVE_INFINITY,
      value,
    }
    this.gitSnapshots.delete(root)
    this.gitSnapshots.set(root, entry)
    void value
      .finally(() => {
        if (this.gitSnapshots.get(root) === entry) {
          entry.expiresAt = Date.now() + GIT_SNAPSHOT_COALESCE_MS
        }
      })
      .catch(() => undefined)
    while (this.gitSnapshots.size > 10) {
      const oldest = this.gitSnapshots.keys().next().value
      if (typeof oldest !== 'string') break
      this.gitSnapshots.delete(oldest)
    }
    return value
  }

  private async loadGitSnapshot(root: string): Promise<GitSnapshot> {
    try {
      const topLevel = await this.runGitText(root, ['rev-parse', '--show-toplevel'])
      const canonicalTopLevel = await realpath(topLevel.stdout.trim())
      if (canonicalTopLevel !== root) throw new Error('nested workspace')
      const [statusResult, numStatResult, branchResult] = await Promise.all([
        this.runGitText(root, [
          'status',
          '--porcelain=v1',
          '-z',
          '--untracked-files=all',
          '--ignored=no',
          '--',
          '.',
        ]),
        this.runGitText(root, [
          'diff',
          '--no-ext-diff',
          '--no-textconv',
          '--numstat',
          '-z',
          '--',
          '.',
        ]),
        this.runGitText(root, ['branch', '--show-current']).catch(() => ({ stdout: '', stderr: '' })),
      ])
      return {
        available: true,
        branch: branchResult.stdout.trim().slice(0, 512),
        entries: parsePorcelain(statusResult.stdout),
        numStats: parseNumStats(numStatResult.stdout),
      }
    } catch {
      return { available: false, branch: '', entries: new Map(), numStats: new Map() }
    }
  }

  private async changeSummary(
    root: string,
    git: GitSnapshot,
    entry: GitEntry,
  ): Promise<WorkspaceChangeSummary> {
    let stats = git.numStats.get(entry.path) ?? { added: 0, deleted: 0, binary: false }
    if (entry.untracked) {
      const target = await this.resolveExisting(root, entry.path)
      const details = await stat(target)
      if (!details.isFile() || details.size > WORKSPACE_DIFF_PATCH_BYTE_LIMIT) {
        stats = { added: 0, deleted: 0, binary: false }
      } else {
        const content = await readFile(target)
        stats = isBinary(content)
          ? { added: 0, deleted: 0, binary: true }
          : { added: lineCount(content.toString('utf8')), deleted: 0, binary: false }
      }
    }
    return {
      path: entry.path,
      ...(entry.previousPath ? { previousPath: entry.previousPath } : {}),
      status: entry.status,
      added: stats.added,
      deleted: stats.deleted,
      binary: stats.binary,
    }
  }

  private runGitText(root: string, args: string[]) {
    return this.runGit<string>(root, args, 'utf8')
  }

  private runGitBoundedPatch(
    root: string,
    args: string[],
    allowDifferenceExit = false,
  ) {
    return new Promise<{ patch: string; truncated: boolean }>((resolvePromise, rejectPromise) => {
      execFile(
        this.gitBinary,
        args,
        {
          cwd: root,
          encoding: 'utf8',
          maxBuffer: GIT_OUTPUT_LIMIT,
          timeout: GIT_TIMEOUT_MS,
          windowsHide: true,
        },
        (error, stdout) => {
          const outputLimitReached = (error as NodeJS.ErrnoException | null)?.code ===
            'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
          const differenceExit = allowDifferenceExit &&
            typeof (error as { code?: unknown } | null)?.code === 'number' &&
            (error as { code: number }).code === 1
          if (error && !outputLimitReached && !differenceExit) {
            rejectPromise(error)
            return
          }
          resolvePromise(boundUnifiedPatch(stdout, !outputLimitReached))
        },
      )
    })
  }

  private runGit<TOutput extends string | Buffer>(
    root: string,
    args: string[],
    encoding: BufferEncoding | 'buffer',
  ): Promise<GitResult<TOutput>> {
    return new Promise((resolvePromise, rejectPromise) => {
      execFile(
        this.gitBinary,
        args,
        {
          cwd: root,
          encoding: encoding as BufferEncoding,
          maxBuffer: GIT_OUTPUT_LIMIT,
          timeout: GIT_TIMEOUT_MS,
          windowsHide: true,
        },
        (error, stdout, stderr) => {
          if (error) {
            rejectPromise(error)
            return
          }
          resolvePromise({ stdout, stderr } as GitResult<TOutput>)
        },
      )
    })
  }
}

export const workspaceContentInternals = {
  boundUnifiedPatch,
  ignoredPath,
  parseNumStats,
  parsePorcelain,
}
