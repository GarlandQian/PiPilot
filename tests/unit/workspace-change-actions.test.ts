import { execFile } from 'node:child_process'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it, vi } from 'vitest'
import { WorkspaceContentService } from '../../src/main/workspace/workspace-content-service'

const execute = promisify(execFile)
const workspaceId = '00000000-0000-4000-8000-000000000702'
const git = (cwd: string, args: string[]) => execute('git', args, { cwd, encoding: 'utf8' })

async function repository(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), 'pipilot-change-actions-'))
  await git(root, ['init', '-q'])
  await git(root, ['config', 'core.autocrlf', 'false'])
  for (const [path, content] of Object.entries(files)) await writeFile(join(root, path), content, 'utf8')
  await git(root, ['add', '--', '.'])
  await git(root, ['-c', 'user.name=PiPilot Tests', '-c', 'user.email=pipilot@example.invalid', 'commit', '-qm', 'baseline'])
  return root
}

const target = (file: { path: string; stage: string; revision: string }) => ({ path: file.path, stage: file.stage as 'staged' | 'unstaged', revision: file.revision })

describe('reviewing changes: stage, unstage and discard', () => {
  it('stages and unstages what the view showed, returning the new list', async () => {
    const root = await repository({ 'a.txt': 'one\n' })
    try {
      await writeFile(join(root, 'a.txt'), 'two\n', 'utf8')
      await writeFile(join(root, 'new.txt'), 'fresh\n', 'utf8')
      const service = new WorkspaceContentService(() => ({ id: workspaceId, path: root }))
      const before = await service.listChanges(workspaceId)
      const staged = await service.applyChanges(workspaceId, 'stage', before.files.map(target))
      expect(staged.files.map(({ path, stage }) => `${stage}:${path}`)).toEqual(['staged:a.txt', 'staged:new.txt'])
      const unstaged = await service.applyChanges(workspaceId, 'unstage', staged.files.filter((file) => file.path === 'a.txt').map(target))
      expect(unstaged.files.map(({ path, stage }) => `${stage}:${path}`)).toEqual(['staged:new.txt', 'unstaged:a.txt'])
      expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('two\n')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 20_000)

  it('discards edits and moves new files to the trash instead of deleting them', async () => {
    const root = await repository({ 'a.txt': 'one\n' })
    try {
      await writeFile(join(root, 'a.txt'), 'edited\n', 'utf8')
      await writeFile(join(root, 'scratch.txt'), 'draft\n', 'utf8')
      const trashItem = vi.fn(async (path: string) => { await rm(path) })
      const service = new WorkspaceContentService(() => ({ id: workspaceId, path: root }), { trashItem })
      const before = await service.listChanges(workspaceId)
      const after = await service.applyChanges(workspaceId, 'discard', before.files.map(target))
      expect(after.files).toEqual([])
      expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('one\n')
      expect(trashItem).toHaveBeenCalledWith(join(await import('node:fs/promises').then(({ realpath }) => realpath(root)), 'scratch.txt'))
      await expect(access(join(root, 'scratch.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 20_000)

  it('refuses a change that moved on since the view showed it, and the wrong kind of action', async () => {
    const root = await repository({ 'a.txt': 'one\n' })
    try {
      await writeFile(join(root, 'a.txt'), 'two\n', 'utf8')
      const service = new WorkspaceContentService(() => ({ id: workspaceId, path: root }))
      const [shown] = (await service.listChanges(workspaceId)).files
      await writeFile(join(root, 'a.txt'), 'three, edited elsewhere\n', 'utf8')
      await expect(service.applyChanges(workspaceId, 'discard', [target(shown!)])).rejects.toMatchObject({ code: 'WORKSPACE_CHANGE_CONFLICT' })
      expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('three, edited elsewhere\n')
      const [current] = (await service.listChanges(workspaceId)).files
      // Unstaging needs a staged change.
      await expect(service.applyChanges(workspaceId, 'unstage', [target(current!)])).rejects.toMatchObject({ code: 'WORKSPACE_CHANGE_CONFLICT' })
      // Without a trash, a new file is never deleted.
      await writeFile(join(root, 'scratch.txt'), 'draft\n', 'utf8')
      // Listing coalesces Git snapshots for 50 ms, as the refresh loop expects.
      await new Promise((resolve) => setTimeout(resolve, 80))
      const scratch = (await service.listChanges(workspaceId)).files.find((file) => file.path === 'scratch.txt')!
      await expect(service.applyChanges(workspaceId, 'discard', [target(scratch)])).rejects.toMatchObject({ code: 'WORKSPACE_CHANGE_FAILED' })
      await expect(access(join(root, 'scratch.txt'))).resolves.toBeUndefined()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 20_000)

  it('lists what a branch changed since it left main, committed or not, and reads each diff', async () => {
    const root = await repository({ 'a.txt': 'one\n', 'b.txt': 'keep\n' })
    try {
      await git(root, ['branch', '-M', 'main'])
      const service = new WorkspaceContentService(() => ({ id: workspaceId, path: root }))
      // On main itself there is nothing to compare with.
      expect(await service.listBranchChanges(workspaceId)).toMatchObject({ base: '', files: [] })
      await git(root, ['checkout', '-q', '-b', 'feature'])
      await writeFile(join(root, 'a.txt'), 'committed on feature\n', 'utf8')
      await git(root, ['-c', 'user.name=PiPilot Tests', '-c', 'user.email=pipilot@example.invalid', 'commit', '-qam', 'feature work'])
      await writeFile(join(root, 'b.txt'), 'uncommitted edit\n', 'utf8')
      await writeFile(join(root, 'fresh.txt'), 'untracked\n', 'utf8')
      await new Promise((resolve) => setTimeout(resolve, 80))
      const branch = await service.listBranchChanges(workspaceId)
      expect(branch.base).toBe('main')
      expect(branch.files.map(({ path, stage, status }) => `${stage}:${status}:${path}`)).toEqual([
        'branch:modified:a.txt', 'branch:modified:b.txt', 'branch:added:fresh.txt',
      ])
      const diff = await service.readDiff(workspaceId, 'a.txt', 'branch')
      expect(diff.patch).toContain('-one\n+committed on feature')
      expect((await service.readDiff(workspaceId, 'fresh.txt', 'branch')).patch).toContain('+untracked')
      // Branch rows are read-only.
      await expect(service.applyChanges(workspaceId, 'discard', [target(branch.files[0]!)])).rejects.toThrow()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 20_000)

  it('stages, unstages and discards one hunk at a time', async () => {
    const lines = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`)
    const root = await repository({ 'long.txt': `${lines.join('\n')}\n` })
    try {
      const edited = [...lines]
      edited[1] = 'line 2 edited'
      edited[17] = 'line 18 edited'
      await writeFile(join(root, 'long.txt'), `${edited.join('\n')}\n`, 'utf8')
      const service = new WorkspaceContentService(() => ({ id: workspaceId, path: root }))
      const [file] = (await service.listChanges(workspaceId)).files
      const afterStage = await service.applyHunk(workspaceId, 'stage', target(file!), 1)
      const staged = await git(root, ['diff', '--cached'])
      expect(staged.stdout).toContain('+line 18 edited')
      expect(staged.stdout).not.toContain('+line 2 edited')
      // The view's old revision of the file is now stale.
      await expect(service.applyHunk(workspaceId, 'stage', target(file!), 0)).rejects.toMatchObject({ code: 'WORKSPACE_CHANGE_CONFLICT' })
      const stagedFile = afterStage.files.find((entry) => entry.stage === 'staged')!
      await service.applyHunk(workspaceId, 'unstage', target(stagedFile), 0)
      expect((await git(root, ['diff', '--cached'])).stdout).toBe('')
      await new Promise((resolve) => setTimeout(resolve, 80))
      const [current] = (await service.listChanges(workspaceId)).files
      await service.applyHunk(workspaceId, 'discard', target(current!), 0)
      const content = await readFile(join(root, 'long.txt'), 'utf8')
      expect(content).toContain('line 2\n')
      expect(content).toContain('line 18 edited')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 20_000)
})
