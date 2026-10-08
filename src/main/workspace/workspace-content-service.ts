import { execFile } from 'node:child_process'
import { patchHunks } from '../../shared/patch-hunks'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import {
  lstat,
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
  WORKSPACE_COMMIT_LIST_LIMIT,
  WORKSPACE_DIFF_SIDE_BYTE_LIMIT,
  WORKSPACE_EXISTS_PATH_LIMIT,
  WORKSPACE_MEDIA_BYTE_LIMIT,
  workspaceCommitDiffSnapshotSchema,
  workspaceCommitListSchema,
  workspaceCommitResultSchema,
  workspaceDiffSidesSchema,
  workspaceExistingFilesSchema,
  workspaceFileMediaSchema,
  workspaceGitStatusSchema,
  workspaceMediaType,
  type WorkspaceCommitDiffSnapshot,
  type WorkspaceCommitList,
  type WorkspaceCommitRequest,
  type WorkspaceCommitResult,
  type WorkspaceDiffSides,
  type WorkspaceExistingFiles,
  type WorkspaceFileMedia,
  type WorkspaceGitStatus,
  WORKSPACE_DIFF_FILE_LIMIT,
  WORKSPACE_DIFF_PATCH_BYTE_LIMIT,
  WORKSPACE_DIRECTORY_ENTRY_LIMIT,
  WORKSPACE_PATH_SEARCH_RESULT_LIMIT,
  WORKSPACE_PREVIEW_BYTE_LIMIT,
  workspaceBranchDiffSnapshotSchema,
  workspaceChangeId,
  workspaceDiffFileSchema,
  workspaceDiffSnapshotSchema,
  workspaceDirectorySnapshotSchema,
  workspaceFilePreviewSchema,
  workspacePathSearchResultSchema,
  workspaceRelativePathSchema,
  workspaceWorkingStageSchema,
  type WorkspaceBranchDiffSnapshot,
  type WorkspaceChangeStage,
  type WorkspaceWorkingStage,
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
/** Commit hooks, pushes and GitHub can take a while; they never prompt. */
const GIT_REMOTE_TIMEOUT_MS = 120_000
const GH_CHECK_TTL_MS = 60_000
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
  | 'WORKSPACE_CHANGE_FAILED'
  | 'WORKSPACE_MEDIA_UNSUPPORTED'
  | 'WORKSPACE_MEDIA_TOO_LARGE'
  | 'WORKSPACE_NOTHING_TO_COMMIT'
  | 'WORKSPACE_BRANCH_EXISTS'
  | 'WORKSPACE_COMMIT_FAILED'

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
  ghBinary?: string
  /** Moves a discarded new file to the system trash (Electron's shell.trashItem). */
  trashItem?: (path: string) => Promise<void>
}

export type WorkspaceChangeAction = 'stage' | 'unstage' | 'discard'

/** One change as the view last saw it; a different revision is a conflict. */
export interface WorkspaceChangeTarget {
  path: string
  stage: WorkspaceWorkingStage
  revision: string
}

/** Long path lists stay under Windows' command-line limit. */
const GIT_PATH_BATCH = 100

interface GitEntry {
  path: string
  previousPath?: string
  status: WorkspaceFileStatus
  stage: WorkspaceWorkingStage
  untracked: boolean
}

interface BranchEntry {
  path: string
  previousPath?: string
  status: WorkspaceFileStatus
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
  numStats: Record<WorkspaceWorkingStage, Map<string, GitNumStat>>
  indexPath: string
  revision: string
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

/** The last lines Git or GitHub printed, without the noise around them. */
function gitErrorText(error: unknown) {
  const stderr = typeof (error as { stderr?: unknown } | null)?.stderr === 'string' ? (error as { stderr: string }).stderr : ''
  const message = stderr.trim() || (error instanceof Error && !/^Command failed/u.test(error.message) ? error.message : '')
  return message.split('\n').map((line) => line.trim()).filter(Boolean).slice(-6).join('\n').slice(0, 1_800)
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
    if (!workspaceRelativePathSchema.safeParse(path).success) continue
    for (const stage of ['staged', 'unstaged'] as const) {
      const code = stage === 'staged' ? x : y
      if (code === ' ' || code === '!' || (stage === 'staged' && code === '?')) continue
      const renamed = code === 'R' || code === 'C'
      if (renamed && !workspaceRelativePathSchema.safeParse(previousPath).success) continue
      entries.set(workspaceChangeId(path, stage), {
        path,
        ...(renamed ? { previousPath } : {}),
        status: code === '?' || code === 'A'
          ? 'added'
          : code === 'D' ? 'deleted' : 'modified',
        stage,
        untracked: x === '?',
      })
    }
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
    if (!workspaceRelativePathSchema.safeParse(path).success) continue
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
    this.ghBinary = options.ghBinary ?? 'gh'
    this.trashItem = options.trashItem
  }

  private readonly ghBinary: string
  private ghCheck: { at: number; available: Promise<boolean> } | undefined

  private readonly trashItem?: (path: string) => Promise<void>

  /**
   * Stage, unstage or discard reviewed changes, then return the new list.
   * Each target must still match what the view showed. Discarding a new file
   * moves it to the trash instead of deleting it.
   */
  async applyChanges(workspaceId: string, action: WorkspaceChangeAction, targets: readonly WorkspaceChangeTarget[]): Promise<WorkspaceDiffSnapshot> {
    const { root } = await this.context(workspaceId)
    const git = await this.gitSnapshot(root, true)
    if (!git.available) {
      throw new WorkspaceContentError('WORKSPACE_GIT_UNAVAILABLE', 'Git integration is unavailable for this workspace.')
    }
    const expected = action === 'unstage' ? 'staged' : 'unstaged'
    const entries: GitEntry[] = []
    for (const target of targets) {
      const path = this.parsePath(target.path)
      const entry = git.entries.get(workspaceChangeId(path, workspaceWorkingStageSchema.parse(target.stage)))
      if (!entry || entry.stage !== expected) this.changeConflict()
      await this.assertChangeRevision(root, git, entry, target.revision)
      entries.push(entry)
    }
    await this.assertActiveWorkspace(workspaceId, root)
    const paths = (items: readonly GitEntry[]) => [...new Set(items.flatMap((entry) => entry.previousPath ? [entry.previousPath, entry.path] : [entry.path]))]
    const batches = <T>(items: readonly T[]) => Array.from({ length: Math.ceil(items.length / GIT_PATH_BATCH) }, (_, index) => items.slice(index * GIT_PATH_BATCH, (index + 1) * GIT_PATH_BATCH))
    try {
      if (action === 'stage') {
        for (const batch of batches(paths(entries))) await this.runGitWrite(root, ['add', '-A', '--', ...batch])
      } else if (action === 'unstage') {
        const hasHead = await this.runGitText(root, ['rev-parse', '--verify', 'HEAD']).then(() => true, () => false)
        for (const batch of batches(paths(entries))) {
          // Before the first commit there is no HEAD to restore the index from.
          if (!hasHead) await this.runGitWrite(root, ['rm', '--cached', '-r', '-q', '--', ...batch])
          else await this.runGitWrite(root, ['restore', '--staged', '--', ...batch])
            .catch(() => this.runGitWrite(root, ['reset', '-q', '--', ...batch]))
        }
      } else {
        const untracked = entries.filter((entry) => entry.untracked)
        const tracked = entries.filter((entry) => !entry.untracked)
        if (untracked.length && !this.trashItem) {
          throw new WorkspaceContentError('WORKSPACE_CHANGE_FAILED', 'New files cannot be moved to the trash here.')
        }
        for (const batch of batches(paths(tracked))) {
          await this.runGitWrite(root, ['restore', '--worktree', '--', ...batch])
            .catch(() => this.runGitWrite(root, ['checkout', '--', ...batch]))
        }
        for (const entry of untracked) await this.trashItem!(await this.resolveExisting(root, entry.path))
      }
    } catch (error) {
      if (error instanceof WorkspaceContentError) throw error
      throw new WorkspaceContentError('WORKSPACE_CHANGE_FAILED', 'Git could not apply this change.')
    } finally {
      this.gitSnapshots.delete(root)
    }
    return this.listChanges(workspaceId)
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
      modifiedCount: new Set([...statusEntries.values()].map((entry) => entry.path)).size,
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
      .sort((left, right) =>
        left.stage.localeCompare(right.stage, 'en') || left.path.localeCompare(right.path, 'en'))
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

  /**
   * Where this branch left the default branch: origin's HEAD, else main or
   * master. Undefined before the first commit or without such a branch.
   */
  private async branchBase(root: string, current: string) {
    const remoteHead = await this.runGitText(root, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'])
      .then((result) => result.stdout.trim(), () => '')
    for (const ref of new Set([remoteHead, 'origin/main', 'origin/master', 'main', 'master'].filter(Boolean))) {
      if (ref === current) continue
      const commit = await this.runGitText(root, ['merge-base', 'HEAD', ref]).then((result) => result.stdout.trim(), () => '')
      if (/^[0-9a-f]{40,64}$/u.test(commit)) return { ref, commit }
    }
    return undefined
  }

  private async branchEntries(root: string, git: GitSnapshot, commit: string) {
    const [names, stats] = await Promise.all([
      this.runGitText(root, ['diff', '--no-ext-diff', '--no-textconv', '--find-renames', '--name-status', '-z', commit, '--', '.']),
      this.runGitText(root, ['diff', '--no-ext-diff', '--no-textconv', '--find-renames', '--numstat', '-z', commit, '--', '.']),
    ])
    const entries = new Map<string, BranchEntry>()
    const records = names.stdout.split('\0')
    for (let index = 0; index < records.length; index += 1) {
      const code = records[index]?.[0]
      if (!code) continue
      const renamed = code === 'R' || code === 'C'
      const previousPath = renamed ? records[index + 1] : undefined
      const path = records[index + (renamed ? 2 : 1)]
      index += renamed ? 2 : 1
      if (!path || !workspaceRelativePathSchema.safeParse(path).success) continue
      if (renamed && !workspaceRelativePathSchema.safeParse(previousPath).success) continue
      entries.set(path, { path, ...(renamed ? { previousPath } : {}), status: code === 'A' ? 'added' : code === 'D' ? 'deleted' : 'modified', untracked: false })
    }
    // New files Git does not track yet are part of the branch's work too.
    for (const entry of git.entries.values()) {
      if (entry.untracked && !entries.has(entry.path)) entries.set(entry.path, { path: entry.path, status: 'added', untracked: true })
    }
    return { entries, numStats: parseNumStats(stats.stdout) }
  }

  private async branchSummary(root: string, commit: string, entry: BranchEntry, numStats: Map<string, GitNumStat>): Promise<WorkspaceChangeSummary> {
    let stats = numStats.get(entry.path) ?? { added: 0, deleted: 0, binary: false }
    if (entry.untracked) {
      const target = await this.resolveExisting(root, entry.path)
      const details = await stat(target)
      if (details.isFile() && details.size <= WORKSPACE_DIFF_PATCH_BYTE_LIMIT) {
        const content = await readFile(target)
        stats = isBinary(content) ? { added: 0, deleted: 0, binary: true } : { added: lineCount(content.toString('utf8')), deleted: 0, binary: false }
      }
    }
    const file = entry.status === 'deleted' ? 'missing' : await this.fileRevision(this.lexicalTarget(root, entry.path))
    return {
      id: workspaceChangeId(entry.path, 'branch'),
      stage: 'branch',
      revision: hash(JSON.stringify([commit, entry, stats, file])),
      path: entry.path,
      ...(entry.previousPath ? { previousPath: entry.previousPath } : {}),
      status: entry.status,
      added: stats.added,
      deleted: stats.deleted,
      binary: stats.binary,
    }
  }

  /**
   * Stage, unstage or discard one hunk of a reviewed file. The hunk is cut
   * from a fresh diff of the same revision the view showed, then applied.
   */
  async applyHunk(workspaceId: string, action: WorkspaceChangeAction, target: WorkspaceChangeTarget, hunkIndex: number): Promise<WorkspaceDiffSnapshot> {
    const { root } = await this.context(workspaceId)
    const git = await this.gitSnapshot(root, true)
    if (!git.available) {
      throw new WorkspaceContentError('WORKSPACE_GIT_UNAVAILABLE', 'Git integration is unavailable for this workspace.')
    }
    const path = this.parsePath(target.path)
    const entry = git.entries.get(workspaceChangeId(path, workspaceWorkingStageSchema.parse(target.stage)))
    // New and renamed files change as a whole.
    if (!entry || entry.stage !== (action === 'unstage' ? 'staged' : 'unstaged') || entry.untracked || entry.previousPath) this.changeConflict()
    await this.assertChangeRevision(root, git, entry, target.revision)
    const diff = await this.runGitBoundedPatch(root, ['diff', ...(entry.stage === 'staged' ? ['--cached'] : []), '--no-ext-diff', '--no-textconv', '--no-color', '--unified=3', '--', path])
    const hunk = diff.truncated ? undefined : patchHunks(diff.patch)[hunkIndex]
    if (!hunk) this.changeConflict()
    await this.assertActiveWorkspace(workspaceId, root)
    try {
      await this.runGitApply(root, ['apply', ...(action === 'discard' ? [] : ['--cached']), ...(action === 'stage' ? [] : ['-R']), '--whitespace=nowarn', '-'], hunk.patch)
    } catch {
      throw new WorkspaceContentError('WORKSPACE_CHANGE_FAILED', 'Git could not apply this hunk.')
    } finally {
      this.gitSnapshots.delete(root)
    }
    return this.listChanges(workspaceId)
  }

  /** Read-only: the branch's committed and uncommitted work since it left the default branch. */
  async listBranchChanges(workspaceId: string): Promise<WorkspaceBranchDiffSnapshot> {
    const { root } = await this.context(workspaceId)
    const git = await this.gitSnapshot(root)
    const base = git.available ? await this.branchBase(root, git.branch) : undefined
    if (!git.available || !base) {
      await this.assertActiveWorkspace(workspaceId, root)
      return workspaceBranchDiffSnapshotSchema.parse({ workspaceId, gitAvailable: git.available, branch: git.branch, base: '', files: [], truncated: false })
    }
    const { entries, numStats } = await this.branchEntries(root, git, base.commit)
    const files: WorkspaceChangeSummary[] = []
    let truncated = false
    for (const entry of [...entries.values()].sort((left, right) => left.path.localeCompare(right.path, 'en'))) {
      if (files.length >= WORKSPACE_DIFF_FILE_LIMIT) { truncated = true; break }
      try { files.push(await this.branchSummary(root, base.commit, entry, numStats)) }
      catch (error) {
        if (error instanceof WorkspaceContentError && ['WORKSPACE_PATH_NOT_FILE', 'WORKSPACE_PATH_NOT_FOUND', 'WORKSPACE_PATH_OUTSIDE'].includes(error.code)) continue
        throw error
      }
    }
    await this.assertActiveWorkspace(workspaceId, root)
    return workspaceBranchDiffSnapshotSchema.parse({ workspaceId, gitAvailable: true, branch: git.branch, base: base.ref, files, truncated })
  }

  private async readBranchDiff(workspaceId: string, root: string, path: string): Promise<WorkspaceDiffFile> {
    const git = await this.gitSnapshot(root, true)
    const base = git.available ? await this.branchBase(root, git.branch) : undefined
    if (!git.available || !base) {
      throw new WorkspaceContentError('WORKSPACE_CHANGE_NOT_FOUND', 'The branch has no base to compare with.')
    }
    const { entries, numStats } = await this.branchEntries(root, git, base.commit)
    const entry = entries.get(path)
    if (!entry) throw new WorkspaceContentError('WORKSPACE_CHANGE_NOT_FOUND', 'The requested workspace change no longer exists.')
    const summary = await this.branchSummary(root, base.commit, entry, numStats)
    if (summary.binary) {
      await this.assertActiveWorkspace(workspaceId, root)
      return workspaceDiffFileSchema.parse({ workspaceId, ...summary, patch: '', truncated: false })
    }
    const result = entry.untracked
      ? await this.runGitBoundedPatch(root, ['diff', '--no-index', '--no-ext-diff', '--no-textconv', '--no-color', '--unified=3', '--', GIT_NULL_DEVICE, path], true)
      : await this.runGitBoundedPatch(root, ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--find-renames', '--unified=3', base.commit, '--', ...(entry.previousPath ? [entry.previousPath] : []), path])
    const binary = /^Binary files .+ differ$/mu.test(result.patch)
    await this.assertActiveWorkspace(workspaceId, root)
    return workspaceDiffFileSchema.parse({ workspaceId, ...summary, binary, patch: binary ? '' : result.patch, truncated: result.truncated })
  }

  async readDiff(
    workspaceId: string,
    path: string,
    stage: WorkspaceChangeStage = 'unstaged',
    commit?: string,
  ): Promise<WorkspaceDiffFile> {
    const { root } = await this.context(workspaceId)
    const requestedPath = this.parsePath(path)
    if (stage === 'branch') return this.readBranchDiff(workspaceId, root, requestedPath)
    if (stage === 'commit') return this.readCommitDiff(workspaceId, root, requestedPath, commit)
    const requestedStage = workspaceWorkingStageSchema.parse(stage)
    const git = await this.gitSnapshot(root, true)
    if (!git.available) {
      throw new WorkspaceContentError(
        'WORKSPACE_GIT_UNAVAILABLE',
        'Git integration is unavailable for this workspace.',
      )
    }
    const entry = git.entries.get(workspaceChangeId(requestedPath, requestedStage))
    if (!entry) {
      throw new WorkspaceContentError(
        'WORKSPACE_CHANGE_NOT_FOUND',
        'The requested workspace change no longer exists.',
      )
    }
    const summary = await this.changeSummary(root, git, entry)
    if (summary.binary) {
      await this.assertChangeRevision(root, git, entry, summary.revision)
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
        ...(entry.stage === 'staged' ? ['--cached'] : []),
        '--no-ext-diff',
        '--no-textconv',
        '--no-color',
        '--find-renames',
        '--unified=3',
        '--',
        ...(entry.previousPath ? [entry.previousPath] : []),
        requestedPath,
      ])
    const binary = /^Binary files .+ differ$/mu.test(result.patch)
    await this.assertChangeRevision(root, git, entry, summary.revision)
    await this.assertActiveWorkspace(workspaceId, root)
    return workspaceDiffFileSchema.parse({
      workspaceId,
      ...summary,
      binary,
      patch: binary ? '' : result.patch,
      truncated: result.truncated,
    })
  }


  /** An image or PDF, whole, for the file tab to show as itself. */
  async previewMedia(workspaceId: string, path: string): Promise<WorkspaceFileMedia> {
    const { root } = await this.context(workspaceId)
    const requestedPath = this.parsePath(path)
    const mime = workspaceMediaType(requestedPath)
    if (!mime) throw new WorkspaceContentError('WORKSPACE_MEDIA_UNSUPPORTED', 'This file is not an image or a PDF.')
    const target = await this.resolveExisting(root, requestedPath)
    let handle
    try {
      handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    } catch {
      throw new WorkspaceContentError('WORKSPACE_FILE_UNREADABLE', 'The workspace file could not be read.')
    }
    try {
      const details = await handle.stat()
      if (!details.isFile()) throw new WorkspaceContentError('WORKSPACE_PATH_NOT_FILE', 'The requested workspace path is not a file.')
      if (details.size > WORKSPACE_MEDIA_BYTE_LIMIT) throw new WorkspaceContentError('WORKSPACE_MEDIA_TOO_LARGE', 'The file is too large to preview.')
      const data = await handle.readFile()
      if (data.length > WORKSPACE_MEDIA_BYTE_LIMIT) throw new WorkspaceContentError('WORKSPACE_MEDIA_TOO_LARGE', 'The file is too large to preview.')
      await this.assertActiveWorkspace(workspaceId, root)
      return workspaceFileMediaSchema.parse({
        workspaceId, path: requestedPath, mime, size: data.length, fingerprint: hash(data),
        data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
      })
    } finally {
      await handle.close().catch(() => undefined)
    }
  }

  /** Which of these paths are still files inside the project. */
  async existingFiles(workspaceId: string, paths: readonly string[]): Promise<WorkspaceExistingFiles> {
    const { root } = await this.context(workspaceId)
    const existing: string[] = []
    for (const path of paths.slice(0, WORKSPACE_EXISTS_PATH_LIMIT)) {
      const requested = workspaceRelativePathSchema.safeParse(path)
      if (!requested.success || requested.data === '.') continue
      try {
        if ((await stat(await this.resolveExisting(root, requested.data))).isFile()) existing.push(requested.data)
      } catch {
        // Missing, outside the project, or unreadable: its tab is not restored.
      }
    }
    await this.assertActiveWorkspace(workspaceId, root)
    return workspaceExistingFilesSchema.parse({ workspaceId, paths: existing })
  }

  /** The file's real location, for Finder or File Explorer to show. */
  async locateFile(workspaceId: string, path: string) {
    const { root } = await this.context(workspaceId)
    const target = await this.resolveExisting(root, this.parsePath(path))
    await this.assertActiveWorkspace(workspaceId, root)
    return target
  }

  /** Recent commits on this branch, for the review's Commit scope. */
  async listCommits(workspaceId: string): Promise<WorkspaceCommitList> {
    const { root } = await this.context(workspaceId)
    const git = await this.gitSnapshot(root)
    if (!git.available) return workspaceCommitListSchema.parse({ workspaceId, gitAvailable: false, commits: [] })
    const log = await this.runGitText(root, ['log', `--max-count=${WORKSPACE_COMMIT_LIST_LIMIT}`, '--no-color', '--format=%H%x1f%s%x1f%an%x1f%aI%x1e'])
      .then((result) => result.stdout, () => '')
    const commits = log.split('\x1e').flatMap((record) => {
      const [sha, subject, author, date] = record.trim().split('\x1f')
      return sha && /^[0-9a-f]{40,64}$/u.test(sha) ? [{ sha, subject: (subject ?? '').slice(0, 1_024), author: (author ?? '').slice(0, 256), date: (date ?? '').slice(0, 64) }] : []
    })
    await this.assertActiveWorkspace(workspaceId, root)
    return workspaceCommitListSchema.parse({ workspaceId, gitAvailable: true, commits })
  }

  private async commitEntries(root: string, commit: string) {
    // The root commit compares with Git's empty tree.
    const parent = await this.runGitText(root, ['rev-parse', '--verify', '--quiet', `${commit}^`])
      .then((result) => result.stdout.trim(), () => '')
    const base = parent || await this.runGitText(root, ['hash-object', '-t', 'tree', GIT_NULL_DEVICE]).then((result) => result.stdout.trim())
    const [names, stats] = await Promise.all([
      this.runGitText(root, ['diff', '--no-ext-diff', '--no-textconv', '--find-renames', '--name-status', '-z', base, commit, '--', '.']),
      this.runGitText(root, ['diff', '--no-ext-diff', '--no-textconv', '--find-renames', '--numstat', '-z', base, commit, '--', '.']),
    ])
    const entries = new Map<string, BranchEntry>()
    const records = names.stdout.split('\0')
    for (let index = 0; index < records.length; index += 1) {
      const code = records[index]?.[0]
      if (!code) continue
      const renamed = code === 'R' || code === 'C'
      const previousPath = renamed ? records[index + 1] : undefined
      const path = records[index + (renamed ? 2 : 1)]
      index += renamed ? 2 : 1
      if (!path || !workspaceRelativePathSchema.safeParse(path).success) continue
      if (renamed && !workspaceRelativePathSchema.safeParse(previousPath).success) continue
      entries.set(path, { path, ...(renamed ? { previousPath } : {}), status: code === 'A' ? 'added' : code === 'D' ? 'deleted' : 'modified', untracked: false })
    }
    return { base, entries, numStats: parseNumStats(stats.stdout) }
  }

  private async verifiedCommit(root: string, commit: string | undefined) {
    const sha = commit && /^[0-9a-f]{40,64}$/u.test(commit)
      ? await this.runGitText(root, ['rev-parse', '--verify', '--quiet', `${commit}^{commit}`]).then((result) => result.stdout.trim(), () => '')
      : ''
    if (!sha) throw new WorkspaceContentError('WORKSPACE_CHANGE_NOT_FOUND', 'The commit no longer exists.')
    return sha
  }

  private commitSummary(commit: string, entry: BranchEntry, numStats: Map<string, GitNumStat>): WorkspaceChangeSummary {
    const stats = numStats.get(entry.path) ?? { added: 0, deleted: 0, binary: false }
    return {
      id: workspaceChangeId(entry.path, 'commit'),
      stage: 'commit',
      revision: hash(JSON.stringify([commit, entry, stats])),
      path: entry.path,
      ...(entry.previousPath ? { previousPath: entry.previousPath } : {}),
      status: entry.status,
      added: stats.added,
      deleted: stats.deleted,
      binary: stats.binary,
    }
  }

  /** Read-only: what one commit changed. */
  async listCommitChanges(workspaceId: string, commit: string): Promise<WorkspaceCommitDiffSnapshot> {
    const { root } = await this.context(workspaceId)
    const git = await this.gitSnapshot(root)
    if (!git.available) throw new WorkspaceContentError('WORKSPACE_GIT_UNAVAILABLE', 'Git integration is unavailable for this workspace.')
    const sha = await this.verifiedCommit(root, commit)
    const { entries, numStats } = await this.commitEntries(root, sha)
    const ordered = [...entries.values()].sort((left, right) => left.path.localeCompare(right.path, 'en'))
    const files = ordered.slice(0, WORKSPACE_DIFF_FILE_LIMIT).map((entry) => this.commitSummary(sha, entry, numStats))
    await this.assertActiveWorkspace(workspaceId, root)
    return workspaceCommitDiffSnapshotSchema.parse({ workspaceId, gitAvailable: true, branch: git.branch, commit: sha, files, truncated: ordered.length > files.length })
  }

  private async readCommitDiff(workspaceId: string, root: string, path: string, commit: string | undefined): Promise<WorkspaceDiffFile> {
    const sha = await this.verifiedCommit(root, commit)
    const { base, entries, numStats } = await this.commitEntries(root, sha)
    const entry = entries.get(path)
    if (!entry) throw new WorkspaceContentError('WORKSPACE_CHANGE_NOT_FOUND', 'The requested workspace change no longer exists.')
    const summary = this.commitSummary(sha, entry, numStats)
    if (summary.binary) {
      await this.assertActiveWorkspace(workspaceId, root)
      return workspaceDiffFileSchema.parse({ workspaceId, ...summary, patch: '', truncated: false })
    }
    const result = await this.runGitBoundedPatch(root, ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--find-renames', '--unified=3', base, sha, '--', ...(entry.previousPath ? [entry.previousPath] : []), path])
    const binary = /^Binary files .+ differ$/mu.test(result.patch)
    await this.assertActiveWorkspace(workspaceId, root)
    return workspaceDiffFileSchema.parse({ workspaceId, ...summary, binary, patch: binary ? '' : result.patch, truncated: result.truncated })
  }

  /**
   * Both sides of a reviewed file, so the diff can expand the lines around a
   * hunk: the index and the working tree for unstaged changes, HEAD and the
   * index for staged ones, the branch base or the commit's parent otherwise.
   */
  async readDiffSides(workspaceId: string, path: string, stage: WorkspaceChangeStage, commit?: string, previousPath?: string): Promise<WorkspaceDiffSides> {
    const { root } = await this.context(workspaceId)
    const requestedPath = this.parsePath(path)
    const oldPath = previousPath ? this.parsePath(previousPath) : requestedPath
    const git = await this.gitSnapshot(root, true)
    if (!git.available) throw new WorkspaceContentError('WORKSPACE_GIT_UNAVAILABLE', 'Git integration is unavailable for this workspace.')
    const blob = async (spec: string) => {
      const result = await this.runGit<Buffer>(root, ['show', spec], 'buffer').catch(() => null)
      if (!result) return null
      if (result.stdout.length > WORKSPACE_DIFF_SIDE_BYTE_LIMIT || isBinary(result.stdout)) throw new WorkspaceContentError('WORKSPACE_MEDIA_TOO_LARGE', 'The file is too large to expand.')
      return result.stdout.toString('utf8')
    }
    const worktree = async () => {
      const target = await this.resolveExisting(root, requestedPath).catch(() => null)
      if (!target) return null
      const details = await stat(target)
      if (!details.isFile() || details.size > WORKSPACE_DIFF_SIDE_BYTE_LIMIT) throw new WorkspaceContentError('WORKSPACE_MEDIA_TOO_LARGE', 'The file is too large to expand.')
      const content = await readFile(target)
      if (isBinary(content)) throw new WorkspaceContentError('WORKSPACE_MEDIA_TOO_LARGE', 'The file cannot be expanded.')
      return content.toString('utf8')
    }
    let oldContents: string | null
    let newContents: string | null
    if (stage === 'unstaged') {
      oldContents = await blob(`:${oldPath}`)
      newContents = await worktree()
    } else if (stage === 'staged') {
      oldContents = await blob(`HEAD:${oldPath}`)
      newContents = await blob(`:${requestedPath}`)
    } else if (stage === 'branch') {
      const base = await this.branchBase(root, git.branch)
      if (!base) throw new WorkspaceContentError('WORKSPACE_CHANGE_NOT_FOUND', 'The branch has no base to compare with.')
      oldContents = await blob(`${base.commit}:${oldPath}`)
      newContents = await worktree()
    } else {
      const sha = await this.verifiedCommit(root, commit)
      oldContents = await blob(`${sha}^:${oldPath}`)
      newContents = await blob(`${sha}:${requestedPath}`)
    }
    await this.assertActiveWorkspace(workspaceId, root)
    return workspaceDiffSidesSchema.parse({
      workspaceId,
      path: requestedPath,
      oldFile: oldContents === null ? null : { name: oldPath, contents: oldContents },
      newFile: newContents === null ? null : { name: requestedPath, contents: newContents },
    })
  }

  private ghAvailable() {
    if (!this.ghCheck || Date.now() - this.ghCheck.at > GH_CHECK_TTL_MS) {
      this.ghCheck = {
        at: Date.now(),
        available: new Promise<boolean>((resolvePromise) => {
          execFile(this.ghBinary, ['--version'], { timeout: GIT_TIMEOUT_MS, windowsHide: true }, (error) => resolvePromise(!error))
        }),
      }
    }
    return this.ghCheck.available
  }

  /** Where the branch stands: its base, upstream, and what a commit would include. */
  async gitStatus(workspaceId: string): Promise<WorkspaceGitStatus> {
    const { root } = await this.context(workspaceId)
    const git = await this.gitSnapshot(root, true)
    if (!git.available) {
      await this.assertActiveWorkspace(workspaceId, root)
      return workspaceGitStatusSchema.parse({ workspaceId, gitAvailable: false, branch: '', detached: false, base: '', onDefaultBranch: false, upstream: '', ahead: 0, behind: 0, hasRemote: false, hasCommits: false, staged: 0, unstaged: 0, ghAvailable: false })
    }
    const text = (args: string[]) => this.runGitText(root, args).then((result) => result.stdout.trim(), () => '')
    const [head, upstream, remotes, remoteHead, gh] = await Promise.all([
      text(['rev-parse', '--verify', '--quiet', 'HEAD']),
      text(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']),
      text(['remote']),
      text(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']),
      this.ghAvailable(),
    ])
    const base = head ? await this.branchBase(root, git.branch) : undefined
    const counts = upstream ? await text(['rev-list', '--left-right', '--count', `${upstream}...HEAD`]) : ''
    const [behind, ahead] = counts.split(/\s+/u).map((value) => Number.parseInt(value, 10) || 0)
    const defaults = new Set(['main', 'master', remoteHead.replace(/^origin\//u, '')].filter(Boolean))
    const entries = [...git.entries.values()]
    await this.assertActiveWorkspace(workspaceId, root)
    return workspaceGitStatusSchema.parse({
      workspaceId,
      gitAvailable: true,
      branch: git.branch,
      detached: Boolean(head) && !git.branch,
      base: base?.ref ?? '',
      onDefaultBranch: defaults.has(git.branch),
      upstream: upstream.slice(0, 512),
      ahead: ahead ?? 0,
      behind: behind ?? 0,
      hasRemote: remotes.length > 0,
      hasCommits: Boolean(head),
      staged: new Set(entries.filter((entry) => entry.stage === 'staged').map((entry) => entry.path)).size,
      unstaged: new Set(entries.filter((entry) => entry.stage === 'unstaged').map((entry) => entry.path)).size,
      ghAvailable: gh,
    })
  }

  /**
   * Commit what is staged (or everything, with `includeUnstaged`), then
   * optionally push and open a pull request. Once the commit lands, a failed
   * push or pull request is reported in the result rather than thrown.
   */
  async commit(workspaceId: string, request: WorkspaceCommitRequest): Promise<WorkspaceCommitResult> {
    const { root } = await this.context(workspaceId)
    const git = await this.gitSnapshot(root, true)
    if (!git.available) throw new WorkspaceContentError('WORKSPACE_GIT_UNAVAILABLE', 'Git integration is unavailable for this workspace.')
    const failure = (code: WorkspaceContentErrorCode, error: unknown, fallback: string) =>
      new WorkspaceContentError(code, gitErrorText(error) || fallback)
    try {
      if (request.branch) {
        const exists = await this.runGitText(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${request.branch}`]).then(() => true, () => false)
        if (exists) throw new WorkspaceContentError('WORKSPACE_BRANCH_EXISTS', `A branch named ${request.branch} already exists.`)
        await this.runGitRemote(root, ['switch', '-c', request.branch]).catch((error) => { throw failure('WORKSPACE_COMMIT_FAILED', error, 'Git could not create the branch.') })
      }
      if (request.includeUnstaged) await this.runGitWrite(root, ['add', '-A', '--', '.'])
      const staged = await this.runGitText(root, ['diff', '--cached', '--quiet']).then(() => false, (error: { code?: unknown }) => error?.code === 1)
      if (!staged) throw new WorkspaceContentError('WORKSPACE_NOTHING_TO_COMMIT', 'There is nothing staged to commit.')
      await this.assertActiveWorkspace(workspaceId, root)
      await this.runGitRemote(root, ['commit', '-F', '-'], request.message.trim() + '\n')
        .catch((error) => { throw failure('WORKSPACE_COMMIT_FAILED', error, 'Git could not create the commit.') })
    } finally {
      this.gitSnapshots.delete(root)
    }
    const sha = (await this.runGitText(root, ['rev-parse', 'HEAD'])).stdout.trim()
    const branch = (await this.runGitText(root, ['branch', '--show-current']).catch(() => ({ stdout: '' }))).stdout.trim()
    const result: WorkspaceCommitResult = { workspaceId, sha, branch, pushed: false }
    if (request.next === 'commit') return workspaceCommitResultSchema.parse(result)
    try {
      const upstream = await this.runGitText(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']).then((value) => value.stdout.trim(), () => '')
      if (upstream) await this.runGitRemote(root, ['push'])
      else {
        const remotes = (await this.runGitText(root, ['remote'])).stdout.split(/\s+/u).filter(Boolean)
        const remote = remotes.includes('origin') ? 'origin' : remotes[0]
        if (!remote || !branch) throw new Error('This repository has no remote to push to.')
        await this.runGitRemote(root, ['push', '--set-upstream', remote, branch])
      }
      result.pushed = true
    } catch (error) {
      result.pushError = gitErrorText(error) || 'Git could not push the commit.'
      return workspaceCommitResultSchema.parse(result)
    }
    if (request.next === 'pull-request') {
      const [subject, ...body] = request.message.trim().split('\n')
      try {
        const output = await this.runCommand(this.ghBinary, root, ['pr', 'create', '--title', subject!.trim(), '--body', body.join('\n').trim() || subject!.trim()])
        const url = output.split(/\s+/u).reverse().find((value) => /^https:\/\/\S+$/u.test(value))
        if (url) result.pullRequestUrl = url
        else result.pullRequestError = 'GitHub did not return a pull request link.'
      } catch (error) {
        result.pullRequestError = gitErrorText(error) || 'GitHub could not create the pull request.'
      }
    }
    return workspaceCommitResultSchema.parse(result)
  }

  /**
   * What the next commit would contain, for a model to describe: the staged
   * diff (and the unstaged one, with `includeUnstaged`), bounded, plus the
   * names of new files Git does not track yet.
   */
  async commitPreview(workspaceId: string, includeUnstaged: boolean) {
    const { root } = await this.context(workspaceId)
    const git = await this.gitSnapshot(root, true)
    if (!git.available) throw new WorkspaceContentError('WORKSPACE_GIT_UNAVAILABLE', 'Git integration is unavailable for this workspace.')
    const limit = 48 * 1024
    const hasHead = await this.runGitText(root, ['rev-parse', '--verify', '--quiet', 'HEAD']).then(() => true, () => false)
    const range = includeUnstaged && hasHead ? ['HEAD'] : ['--cached']
    const [stat, diff] = await Promise.all([
      this.runGitText(root, ['diff', ...range, '--no-color', '--stat=120', '--', '.']).then((result) => result.stdout, () => ''),
      this.runGitBoundedPatch(root, ['diff', ...range, '--no-ext-diff', '--no-textconv', '--no-color', '--unified=2', '--', '.']).then((result) => result.patch, () => ''),
    ])
    const untracked = includeUnstaged ? [...git.entries.values()].filter((entry) => entry.untracked).map((entry) => entry.path).slice(0, 200) : []
    const recent = hasHead ? await this.runGitText(root, ['log', '--max-count=10', '--no-color', '--format=%s']).then((result) => result.stdout.trim(), () => '') : ''
    const text = [
      git.branch ? `Branch: ${git.branch}` : '',
      recent ? `Recent commit subjects (match their style and language):\n${recent}` : '',
      stat.trim(),
      untracked.length ? `New files:\n${untracked.join('\n')}` : '',
      diff.length > limit ? `${diff.slice(0, limit)}\n[diff truncated]` : diff,
    ].filter(Boolean).join('\n\n')
    await this.assertActiveWorkspace(workspaceId, root)
    return text.trim()
  }

  /** Git commands that may run hooks or reach a remote: longer timeout, no prompts. */
  private runGitRemote(root: string, args: string[], input?: string) {
    return this.runCommand(this.gitBinary, root, args, input)
  }

  private runCommand(binary: string, root: string, args: string[], input?: string) {
    return new Promise<string>((resolvePromise, rejectPromise) => {
      const child = execFile(binary, args, {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: GIT_OUTPUT_LIMIT,
        timeout: GIT_REMOTE_TIMEOUT_MS,
        windowsHide: true,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1', GIT_EDITOR: 'true', GCM_INTERACTIVE: 'never' },
      }, (error, stdout, stderr) => error ? rejectPromise(Object.assign(error, { stderr })) : resolvePromise(stdout))
      if (input !== undefined) child.stdin?.end(input)
      else child.stdin?.end()
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
    const exact = entries.get(workspaceChangeId(path, 'unstaged'))?.status ??
      entries.get(workspaceChangeId(path, 'staged'))?.status
    if (exact || !directory) return exact
    const prefix = `${path}/`
    for (const entry of entries.values()) {
      if (entry.path.startsWith(prefix)) return 'modified' as const
    }
    return undefined
  }

  private async gitSnapshot(root: string, refresh = false): Promise<GitSnapshot> {
    const cached = this.gitSnapshots.get(root)
    if (cached && (
      cached.expiresAt === Number.POSITIVE_INFINITY || (!refresh && cached.expiresAt > Date.now())
    )) return cached.value
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
      const indexResult = await this.runGitText(root, ['rev-parse', '--git-path', 'index'])
      const indexPath = resolve(root, indexResult.stdout.trim())
      const revision = await this.gitRevision(root, indexPath)
      const [statusResult, unstagedNumStats, stagedNumStats, branchResult] = await Promise.all([
        this.runGitText(root, [
          'status',
          '--porcelain=v1',
          '-z',
          '--renames',
          '--untracked-files=all',
          '--ignored=no',
          '--',
          '.',
        ]),
        this.runGitText(root, [
          'diff',
          '--no-ext-diff',
          '--no-textconv',
          '--find-renames',
          '--numstat',
          '-z',
          '--',
          '.',
        ]),
        this.runGitText(root, [
          'diff',
          '--cached',
          '--no-ext-diff',
          '--no-textconv',
          '--find-renames',
          '--numstat',
          '-z',
          '--',
          '.',
        ]),
        this.runGitText(root, ['branch', '--show-current']).catch(() => ({ stdout: '', stderr: '' })),
      ])
      if (revision !== await this.gitRevision(root, indexPath)) this.changeConflict()
      return {
        available: true,
        branch: branchResult.stdout.trim().slice(0, 512),
        entries: parsePorcelain(statusResult.stdout),
        numStats: {
          staged: parseNumStats(stagedNumStats.stdout),
          unstaged: parseNumStats(unstagedNumStats.stdout),
        },
        indexPath,
        revision,
      }
    } catch (error) {
      if (error instanceof WorkspaceContentError) throw error
      return {
        available: false,
        branch: '',
        entries: new Map(),
        numStats: { staged: new Map(), unstaged: new Map() },
        indexPath: '',
        revision: '',
      }
    }
  }

  private changeConflict(): never {
    throw new WorkspaceContentError(
      'WORKSPACE_CHANGE_CONFLICT',
      'The workspace change was updated outside PiPilot. Refresh before trying again.',
    )
  }

  private async fileRevision(path: string) {
    try {
      const details = await lstat(path, { bigint: true })
      return `${details.ino}:${details.mode}:${details.size}:${details.mtimeNs}:${details.ctimeNs}`
    } catch (error) {
      if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) {
        return 'missing'
      }
      throw error
    }
  }

  private async gitRevision(root: string, indexPath: string) {
    const [head, index] = await Promise.all([
      this.runGitText(root, ['rev-parse', '--verify', 'HEAD'])
        .then((result) => result.stdout.trim())
        .catch(() => ''),
      this.fileRevision(indexPath),
    ])
    return hash(`${head}\0${index}`)
  }

  private async changeRevision(root: string, git: GitSnapshot, entry: GitEntry) {
    const file = entry.stage === 'unstaged'
      ? await this.fileRevision(this.lexicalTarget(root, entry.path))
      : ''
    return hash(JSON.stringify([
      git.revision,
      entry,
      git.numStats[entry.stage].get(entry.path),
      file,
    ]))
  }

  private async assertChangeRevision(
    root: string,
    git: GitSnapshot,
    entry: GitEntry,
    revision: string,
  ) {
    const [gitRevision, currentRevision] = await Promise.all([
      this.gitRevision(root, git.indexPath),
      this.changeRevision(root, git, entry),
    ])
    if (gitRevision !== git.revision || currentRevision !== revision) this.changeConflict()
  }

  private async changeSummary(
    root: string,
    git: GitSnapshot,
    entry: GitEntry,
  ): Promise<WorkspaceChangeSummary> {
    const revision = await this.changeRevision(root, git, entry)
    let stats = git.numStats[entry.stage].get(entry.path) ?? { added: 0, deleted: 0, binary: false }
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
      if (revision !== await this.changeRevision(root, git, entry)) this.changeConflict()
    }
    return {
      id: workspaceChangeId(entry.path, entry.stage),
      stage: entry.stage,
      revision,
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

  private runGitApply(root: string, args: string[], input: string) {
    return new Promise<void>((resolvePromise, rejectPromise) => {
      const child = execFile(this.gitBinary, args, {
        cwd: root, encoding: 'utf8', maxBuffer: GIT_OUTPUT_LIMIT, timeout: GIT_TIMEOUT_MS, windowsHide: true,
      }, (error) => error ? rejectPromise(error) : resolvePromise())
      child.stdin?.end(input)
    })
  }

  /** Index and worktree writes take Git's normal locks. */
  private runGitWrite(root: string, args: string[]) {
    return new Promise<void>((resolvePromise, rejectPromise) => {
      execFile(this.gitBinary, ['--literal-pathspecs', ...args], {
        cwd: root, encoding: 'utf8', maxBuffer: GIT_OUTPUT_LIMIT, timeout: GIT_TIMEOUT_MS, windowsHide: true,
      }, (error) => error ? rejectPromise(error) : resolvePromise())
    })
  }

  private runGitBoundedPatch(
    root: string,
    args: string[],
    allowDifferenceExit = false,
  ) {
    return new Promise<{ patch: string; truncated: boolean }>((resolvePromise, rejectPromise) => {
      execFile(
        this.gitBinary,
        ['--no-optional-locks', '--literal-pathspecs', ...args],
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
        ['--no-optional-locks', '--literal-pathspecs', ...args],
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
