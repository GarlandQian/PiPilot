import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { lstat, mkdir, realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { z } from 'zod'
import { createWorktreeInputSchema, worktreeSchema, type CreateWorktreeInput, type ManagedWorktree } from '../../shared/project-workflows'
import { ProjectWorkflowError, readWorkflowFile, writeWorkflowFile } from '../project-actions/workflow-storage'

const execute = promisify(execFile)
const documentSchema = z.object({ version: z.literal(1), worktrees: z.array(worktreeSchema).max(500) }).strict()
const samePath = (left: string, right: string) => {
  const resolvedLeft = resolve(left)
  const resolvedRight = resolve(right)
  return process.platform === 'win32'
    ? resolvedLeft.toLowerCase() === resolvedRight.toLowerCase()
    : resolvedLeft === resolvedRight
}
export interface WorktreeServiceOptions {
  directory: string
  location(workspaceId: string): { path: string; name: string } | undefined
  registeredWorkspaceIds(path: string): string[]
  register(path: string, name: string): Promise<{ id: string }>
  unavailable(workspaceId: string): void
  withInactiveProject<T>(workspaceIds: string[], cwd: string, operation: () => Promise<T>): Promise<T>
}

/** Owns only UUID directories created here. Archive never deletes or resets user files. */
export class WorktreeService {
  private records: ManagedWorktree[] = []
  private queue = Promise.resolve()
  private readonly moving = new Set<string>()
  private readonly file: string
  private readonly activeDirectory: string
  private readonly archiveDirectory: string
  private readonly hooksDirectory: string
  private disposed = false
  constructor(private readonly options: WorktreeServiceOptions) {
    this.file = join(options.directory, 'worktrees.json')
    this.activeDirectory = join(options.directory, 'active')
    this.archiveDirectory = join(options.directory, 'archived')
    this.hooksDirectory = join(options.directory, 'empty-hooks')
  }
  async initialize() {
    for (const path of [this.options.directory, this.activeDirectory, this.archiveDirectory, this.hooksDirectory]) {
      await mkdir(path, { recursive: true, mode: 0o700 })
      if ((await lstat(path)).isSymbolicLink() || !samePath(await realpath(path), path)) throw new ProjectWorkflowError('The managed worktree directory changed identity.')
    }
    this.records = (await readWorkflowFile(this.file, documentSchema, { version: 1, worktrees: [] })).worktrees
    for (const record of this.records) {
      this.assertOwned(record)
      if (!['creating', 'archiving', 'restoring'].includes(record.state)) continue
      const active = await this.exists(record.path)
      const archived = await this.exists(record.archivePath)
      if (active === archived) { record.state = 'error'; record.error = 'The interrupted worktree operation needs manual inspection.'; continue }
      try {
        await this.verify(record, archived ? record.archivePath : record.path)
        record.state = archived ? 'archived' : 'active'
        if (archived) {
          await this.lock(record, record.archivePath)
          if (record.workspaceId) this.options.unavailable(record.workspaceId)
        } else record.workspaceId = (await this.options.register(record.path, `${record.name} · ${record.branch}`)).id
        delete record.error
      } catch (error) { record.state = 'error'; record.error = this.message(error) }
    }
    await this.persist()
  }
  list(projectId: string) {
    const owner = this.recordForWorkspace(projectId)?.projectId ?? projectId
    return structuredClone(this.records.filter((record) => record.projectId === owner))
  }
  assertAvailable(workspaceId: string) {
    const record = this.recordForWorkspace(workspaceId)
    if (record && this.moving.has(record.path)) throw new ProjectWorkflowError('This working copy is being archived or restored.')
    if (record && record.state !== 'active') throw new ProjectWorkflowError('Restore this working copy before opening it.')
  }
  async branches(projectId: string): Promise<string[]> {
    const location = this.options.location(projectId)
    if (!location) return []
    try { return (await this.git(location.path, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/'])).trim().split('\n').filter(Boolean).slice(0, 2_000) }
    catch { return [] }
  }
  create(raw: CreateWorktreeInput): Promise<ManagedWorktree> {
    const input = createWorktreeInputSchema.parse(raw)
    return this.serial(async () => {
      this.assertAvailable(input.projectId)
      if (this.records.length >= 500) throw new ProjectWorkflowError('The managed working-copy limit was reached.')
      const source = this.options.location(input.projectId)
      if (!source) throw new ProjectWorkflowError('The source project is unavailable.')
      const repository = await realpath((await this.git(source.path, ['rev-parse', '--show-toplevel'])).trim())
      const commonDirectory = await this.commonDirectory(repository)
      await this.git(repository, ['check-ref-format', '--branch', input.branch])
      if (!(await this.branches(input.projectId)).includes(input.baseBranch)) throw new ProjectWorkflowError('Choose an existing local branch.')
      await this.git(repository, ['rev-parse', '--verify', `refs/heads/${input.baseBranch}^{commit}`])
      const id = randomUUID()
      const parent = this.recordForWorkspace(input.projectId)
      const record: ManagedWorktree = {
        id, projectId: parent?.projectId ?? input.projectId,
        projectName: parent?.projectName ?? source.name, repository, commonDirectory,
        path: join(this.activeDirectory, id), archivePath: join(this.archiveDirectory, id),
        name: input.name, branch: input.branch, baseBranch: input.baseBranch, createdAt: new Date().toISOString(), state: 'creating',
      }
      this.records.push(record)
      try { await this.persist() } catch (error) { this.records = this.records.filter((entry) => entry !== record); throw error }
      try {
        await this.git(repository, ['worktree', 'add', '-b', input.branch, record.path, `refs/heads/${input.baseBranch}`])
        await this.verify(record, record.path)
        record.workspaceId = (await this.options.register(record.path, `${record.name} · ${record.branch}`)).id
        record.state = 'active'
        await this.persist()
        return structuredClone(record)
      } catch (error) {
        record.state = 'error'; record.error = this.message(error)
        await this.persist()
        throw new ProjectWorkflowError(record.error)
      }
    })
  }
  archive(id: string): Promise<ManagedWorktree> {
    const record = this.require(id)
    if (!record.workspaceId) return Promise.reject(new ProjectWorkflowError('The working copy is not registered.'))
    if (this.moving.has(record.path)) return Promise.reject(new ProjectWorkflowError('A working-copy operation is already in progress.'))
    this.moving.add(record.path)
    return this.serial(async () => {
      if (record.state !== 'active') throw new ProjectWorkflowError('Only active working copies can be archived.')
      const workspaceIds = [...new Set([record.workspaceId!, ...this.options.registeredWorkspaceIds(record.path)])]
      return this.options.withInactiveProject(workspaceIds, record.path, async () => {
        await this.verify(record, record.path)
        if (await this.exists(record.archivePath)) throw new ProjectWorkflowError('The archive destination already exists.')
        record.state = 'archiving'
        try { await this.persist() } catch (error) { record.state = 'active'; throw error }
        try {
          // Git moves the entire directory and its index. Ignored and untracked files survive.
          // Do not run with cwd inside the directory being renamed: Windows holds cwd open.
          await this.git(record.repository, ['worktree', 'move', record.path, record.archivePath])
          await this.verify(record, record.archivePath)
          await this.lock(record, record.archivePath)
          record.state = 'archived'; delete record.error
          for (const id of workspaceIds) this.options.unavailable(id)
          await this.persist()
          return structuredClone(record)
        } catch (error) { await this.recordMoveFailure(record, error); throw new ProjectWorkflowError(this.message(error)) }
      })
    }).finally(() => { this.moving.delete(record.path) })
  }
  restore(id: string): Promise<ManagedWorktree> {
    return this.serial(async () => {
      const record = this.require(id)
      if (record.state !== 'archived') throw new ProjectWorkflowError('Only archived working copies can be restored.')
      await this.verify(record, record.archivePath)
      if (await this.exists(record.path)) throw new ProjectWorkflowError('The original working-copy location is occupied. Nothing was overwritten.')
      record.state = 'restoring'
      try { await this.persist() } catch (error) { record.state = 'archived'; throw error }
      try {
        await this.git(record.repository, ['worktree', 'unlock', record.archivePath])
        await this.git(record.repository, ['worktree', 'move', record.archivePath, record.path])
        await this.verify(record, record.path)
        record.workspaceId = (await this.options.register(record.path, `${record.name} · ${record.branch}`)).id
        record.state = 'active'; delete record.error
        await this.persist()
        return structuredClone(record)
      } catch (error) { await this.recordMoveFailure(record, error); throw new ProjectWorkflowError(this.message(error)) }
    })
  }
  async dispose() { this.disposed = true; await this.queue }
  private async recordMoveFailure(record: ManagedWorktree, error: unknown) {
    const active = await this.exists(record.path)
    const archived = await this.exists(record.archivePath)
    record.state = active && !archived ? 'active' : archived && !active ? 'archived' : 'error'
    record.error = this.message(error)
    if (record.state === 'archived') {
      await this.lock(record, record.archivePath).catch(() => undefined)
      if (record.workspaceId) this.options.unavailable(record.workspaceId)
    }
    await this.persist()
  }
  private async verify(record: ManagedWorktree, path: string) {
    this.assertOwned(record)
    if ((await lstat(path)).isSymbolicLink() || !samePath(await realpath(path), path) ||
        !samePath(await this.commonDirectory(path), record.commonDirectory) ||
        !samePath((await this.git(path, ['rev-parse', '--show-toplevel'])).trim(), path) ||
        !(await lstat(join(path, '.git'))).isFile()) {
      throw new ProjectWorkflowError('The managed working copy changed identity. No files were moved.')
    }
  }
  private assertOwned(record: ManagedWorktree) {
    if (record.path !== join(this.activeDirectory, record.id) || record.archivePath !== join(this.archiveDirectory, record.id)) {
      throw new ProjectWorkflowError('The saved working-copy location is invalid.')
    }
  }
  private async commonDirectory(path: string) { return realpath(resolve(path, (await this.git(path, ['rev-parse', '--git-common-dir'])).trim())) }
  private async lock(_record: ManagedWorktree, path: string) {
    const listing = await this.git(path, ['worktree', 'list', '--porcelain', '-z'])
    const section = listing.split('\0\0').find((entry) => {
      const worktree = entry.split('\0', 1)[0] ?? ''
      return worktree.startsWith('worktree ') && samePath(worktree.slice('worktree '.length), path)
    })
    if (section?.split('\0').some((line) => line === 'locked' || line.startsWith('locked '))) return
    await this.git(path, ['worktree', 'lock', '--reason', 'PiPilot archived working copy', path])
  }
  private async git(cwd: string, args: string[]) {
    const { stdout } = await execute('git', ['-c', `core.hooksPath=${this.hooksDirectory}`, '-c', 'submodule.recurse=false', ...args],
      { cwd, timeout: 60_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true })
    return stdout
  }
  private require(id: string) { const record = this.records.find((entry) => entry.id === id); if (!record) throw new ProjectWorkflowError('The working copy was not found.'); return record }
  private recordForWorkspace(workspaceId: string) {
    const path = this.options.location(workspaceId)?.path
    return this.records.find((entry) => entry.workspaceId === workspaceId || (path !== undefined && (entry.path === path || entry.archivePath === path)))
  }
  private async exists(path: string) { try { await lstat(path); return true } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error } }
  private message(error: unknown) { return (error instanceof Error ? error.message : 'The working-copy operation failed.').slice(0, 1_000) }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    if (this.disposed) return Promise.reject(new ProjectWorkflowError('Working copies are shutting down.'))
    const next = this.queue.then(operation); this.queue = next.then(() => undefined, () => undefined); return next
  }
  private persist() { return writeWorkflowFile(this.file, { version: 1, worktrees: this.records }) }
}
