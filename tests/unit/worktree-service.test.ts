import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { WorktreeService } from '../../src/main/worktrees/worktree-service'
const execute = promisify(execFile)
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })
async function git(cwd: string, args: string[]) { return (await execute('git', args, { cwd })).stdout }
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pipilot-worktree-'))); roots.push(root)
  const repository = join(root, 'repo'); await mkdir(repository)
  await git(repository, ['init', '-b', 'main'])
  await git(repository, ['config', 'user.email', 'fixture@example.invalid'])
  await git(repository, ['config', 'user.name', 'Fixture'])
  await writeFile(join(repository, 'file.txt'), 'original\n')
  await writeFile(join(repository, '.gitignore'), 'ignored.bin\n')
  await git(repository, ['add', '.']); await git(repository, ['commit', '-m', 'fixture'])
  const projectId = randomUUID()
  const locations = new Map<string, { path: string; name: string }>([[projectId, { path: repository, name: 'Project' }]])
  let busy = false
  let guard: (() => Promise<void>) | undefined
  let guardedIds: string[] = []
  const options = {
    directory: join(root, 'managed'), location: (id: string) => locations.get(id),
    registeredWorkspaceIds: (path: string) => [...locations].filter(([, entry]) => entry.path === path).map(([id]) => id),
    register: async (path: string, name: string) => {
      const existing = [...locations].find(([, entry]) => entry.path === path)?.[0]
      const id = existing ?? randomUUID(); locations.set(id, { path, name }); return { id }
    },
    unavailable: () => undefined,
    withInactiveProject: async <T>(ids: string[], _cwd: string, operation: () => Promise<T>) => {
      guardedIds = ids
      if (busy) throw new Error('busy')
      await guard?.(); return operation()
    },
  }
  const service = new WorktreeService(options); await service.initialize()
  return { root, repository, projectId, service, options, locations, guardedIds: () => guardedIds, setBusy: (value: boolean) => { busy = value }, setGuard: (value: () => Promise<void>) => { guard = value },
    create: () => service.create({ projectId, name: 'Task', branch: `task-${randomUUID()}`, baseBranch: 'main' }) }
}
describe('managed working copies', () => {
  it('creates a new local branch without changing the source checkout', async () => {
    const f = await fixture(); const created = await f.create()
    expect(created.state).toBe('active'); expect(created.workspaceId).toBeTruthy()
    expect(await readFile(join(created.path, 'file.txt'), 'utf8')).toBe('original\n')
    expect((await git(created.path, ['branch', '--show-current'])).trim()).toBe(created.branch)
    expect((await git(f.repository, ['branch', '--show-current'])).trim()).toBe('main')
    expect(await f.service.branches(f.projectId)).toContain('main')
  })
  it('preserves index, dirty, untracked and ignored bytes through archive and restore', async () => {
    const f = await fixture(); const created = await f.create()
    await writeFile(join(created.path, 'file.txt'), 'staged\n'); await git(created.path, ['add', 'file.txt'])
    await writeFile(join(created.path, 'file.txt'), 'dirty\n')
    await writeFile(join(created.path, 'untracked.txt'), 'unsaved work\n')
    await writeFile(join(created.path, 'ignored.bin'), Buffer.from([0, 1, 255]))
    const status = await git(created.path, ['status', '--porcelain'])
    const archived = await f.service.archive(created.id)
    expect(archived.state).toBe('archived')
    await expect(readFile(join(created.path, 'file.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await git(archived.archivePath, ['worktree', 'list', '--porcelain'])).toContain('locked PiPilot archived working copy')
    const restored = await f.service.restore(created.id)
    expect(restored.state).toBe('active'); expect(restored.workspaceId).toBe(created.workspaceId)
    expect(await git(restored.path, ['status', '--porcelain'])).toBe(status)
    expect(await git(restored.path, ['show', ':file.txt'])).toBe('staged\n')
    expect(await readFile(join(restored.path, 'file.txt'), 'utf8')).toBe('dirty\n')
    expect(await readFile(join(restored.path, 'untracked.txt'), 'utf8')).toBe('unsaved work\n')
    expect(await readFile(join(restored.path, 'ignored.bin'))).toEqual(Buffer.from([0, 1, 255]))
  })
  it('refuses busy projects and reopens admission after failure', async () => {
    const f = await fixture(); const created = await f.create(); f.setBusy(true)
    await expect(f.service.archive(created.id)).rejects.toThrow('busy')
    expect(() => f.service.assertAvailable(created.workspaceId!)).not.toThrow()
    expect(await readFile(join(created.path, 'file.txt'), 'utf8')).toBe('original\n')
    f.setBusy(false); expect((await f.service.archive(created.id)).state).toBe('archived')
  })
  it('closes admission synchronously while an archive waits for other owners', async () => {
    const f = await fixture(); const created = await f.create()
    let release!: () => void; f.setGuard(() => new Promise<void>((resolve) => { release = resolve }))
    const archiving = f.service.archive(created.id)
    expect(() => f.service.assertAvailable(created.workspaceId!)).toThrow('being archived')
    await new Promise<void>((resolve) => setImmediate(resolve)); release(); await archiving
    expect(() => f.service.assertAvailable(created.workspaceId!)).toThrow('Restore')
  })
  it('refuses an occupied restore destination without overwriting user files', async () => {
    const f = await fixture(); const created = await f.create(); await f.service.archive(created.id)
    await mkdir(created.path); await writeFile(join(created.path, 'new.txt'), 'keep')
    await expect(f.service.restore(created.id)).rejects.toThrow('occupied')
    expect(await readFile(join(created.path, 'new.txt'), 'utf8')).toBe('keep')
    expect(await readFile(join(created.archivePath, 'file.txt'), 'utf8')).toBe('original\n')
  })
  it('guards a removed and re-added checkout by its directory and every registered ID', async () => {
    const f = await fixture(); const created = await f.create()
    f.locations.delete(created.workspaceId!)
    const addedId = randomUUID(); f.locations.set(addedId, { path: created.path, name: 'Re-added' })
    let release!: () => void; f.setGuard(() => new Promise<void>((resolve) => { release = resolve }))
    const archiving = f.service.archive(created.id)
    expect(() => f.service.assertAvailable(addedId)).toThrow('being archived')
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(f.guardedIds()).toEqual(expect.arrayContaining([created.workspaceId, addedId]))
    const lateId = randomUUID(); f.locations.set(lateId, { path: created.path, name: 'Late add' })
    expect(() => f.service.assertAvailable(lateId)).toThrow('being archived')
    release(); await archiving
    expect(() => f.service.assertAvailable(addedId)).toThrow('Restore')
    expect(f.service.list(addedId)[0]?.id).toBe(created.id)
  })
  it('recovers a crash after the directory move but before metadata commit', async () => {
    const f = await fixture(); const created = await f.create(); await f.service.archive(created.id)
    const file = join(f.options.directory, 'worktrees.json'); const saved = JSON.parse(await readFile(file, 'utf8'))
    saved.worktrees[0].state = 'archiving'; await writeFile(file, JSON.stringify(saved))
    const next = new WorktreeService(f.options); await next.initialize()
    expect(next.list(f.projectId)[0]?.state).toBe('archived')
    expect((await next.restore(created.id)).state).toBe('active')
  })
  it('rejects path and ref injection and a replaced checkout identity', async () => {
    const f = await fixture()
    await expect(f.service.create({ projectId: f.projectId, name: 'x', branch: '--force', baseBranch: 'main' })).rejects.toThrow()
    await expect(f.service.create({ projectId: f.projectId, name: 'x', branch: 'valid', baseBranch: '--orphan' })).rejects.toThrow()
    const created = await f.create()
    await rm(join(created.path, '.git')); await symlink(join(f.repository, '.git'), join(created.path, '.git'), 'dir')
    await expect(f.service.archive(created.id)).rejects.toThrow()
    expect(await readFile(join(created.path, 'file.txt'), 'utf8')).toBe('original\n')
  })
})
