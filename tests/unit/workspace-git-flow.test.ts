import { execFile, type ExecFileOptions } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { WorkspaceContentService } from '../../src/main/workspace/workspace-content-service'

const execute = (file: string, args: string[], options: ExecFileOptions) =>
  new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    execFile(file, args, { ...options, encoding: 'utf8' }, (error, stdout, stderr) =>
      error ? reject(error) : resolve({ stdout, stderr }))
  })

// Run the fake CLI with Node on every platform; Windows cannot execute a shebang.
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return {
    ...actual,
    execFile(file: string, args: string[], options: ExecFileOptions, callback: (error: Error | null, stdout: string, stderr: string) => void) {
      if (file.endsWith('pipilot-test-gh.cjs')) {
        return actual.execFile(process.execPath, [file, ...args], { ...options, encoding: 'utf8' }, callback)
      }
      return Reflect.apply(actual.execFile, undefined, [file, args, options, callback])
    },
  }
})
const workspaceId = '00000000-0000-4000-8000-000000000703'
const git = (cwd: string, args: string[]) => execute('git', args, { cwd, encoding: 'utf8' })

async function repository(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), 'pipilot-git-flow-'))
  await git(root, ['init', '-q', '-b', 'main'])
  await git(root, ['config', 'core.autocrlf', 'false'])
  await git(root, ['config', 'user.name', 'PiPilot Tests'])
  await git(root, ['config', 'user.email', 'pipilot@example.invalid'])
  await git(root, ['config', 'commit.gpgsign', 'false'])
  for (const [path, content] of Object.entries(files)) await writeFile(join(root, path), content, 'utf8')
  await git(root, ['add', '--', '.'])
  await git(root, ['commit', '-qm', 'Add the baseline'])
  return root
}

async function withRepository(files: Record<string, string>, run: (root: string, service: WorkspaceContentService) => Promise<void>, options: ConstructorParameters<typeof WorkspaceContentService>[1] = {}) {
  const root = await repository(files)
  try {
    await run(root, new WorkspaceContentService(() => ({ id: workspaceId, path: root }), options))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

describe('review scopes: commits and expandable sides', () => {
  it('lists recent commits and shows one commit against its parent', async () => {
    await withRepository({ 'a.txt': 'one\ntwo\n' }, async (root, service) => {
      await writeFile(join(root, 'a.txt'), 'one\nTWO\n', 'utf8')
      await writeFile(join(root, 'b.txt'), 'new\n', 'utf8')
      await git(root, ['add', '--', '.'])
      await git(root, ['commit', '-qm', 'Change a and add b'])
      const list = await service.listCommits(workspaceId)
      expect(list.commits.map((commit) => commit.subject)).toEqual(['Change a and add b', 'Add the baseline'])
      expect(list.commits[0]!.author).toBe('PiPilot Tests')
      const latest = list.commits[0]!.sha
      const changes = await service.listCommitChanges(workspaceId, latest)
      expect(changes.files.map(({ path, status, stage, added, deleted }) => ({ path, status, stage, added, deleted }))).toEqual([
        { path: 'a.txt', status: 'modified', stage: 'commit', added: 1, deleted: 1 },
        { path: 'b.txt', status: 'added', stage: 'commit', added: 1, deleted: 0 },
      ])
      const diff = await service.readDiff(workspaceId, 'a.txt', 'commit', latest)
      expect(diff.patch).toContain('-two')
      expect(diff.patch).toContain('+TWO')
      // The root commit compares with the empty tree.
      const first = await service.listCommitChanges(workspaceId, list.commits[1]!.sha)
      expect(first.files.map((file) => file.status)).toEqual(['added'])
      await expect(service.listCommitChanges(workspaceId, 'f'.repeat(40))).rejects.toMatchObject({ code: 'WORKSPACE_CHANGE_NOT_FOUND' })
    })
  }, 20_000)

  it('reads both sides of a change for each stage', async () => {
    await withRepository({ 'a.txt': 'base\n' }, async (root, service) => {
      await writeFile(join(root, 'a.txt'), 'staged\n', 'utf8')
      await git(root, ['add', '--', 'a.txt'])
      await writeFile(join(root, 'a.txt'), 'working\n', 'utf8')
      const unstaged = await service.readDiffSides(workspaceId, 'a.txt', 'unstaged')
      expect([unstaged.oldFile?.contents, unstaged.newFile?.contents]).toEqual(['staged\n', 'working\n'])
      const staged = await service.readDiffSides(workspaceId, 'a.txt', 'staged')
      expect([staged.oldFile?.contents, staged.newFile?.contents]).toEqual(['base\n', 'staged\n'])
      await git(root, ['commit', '-qm', 'Stage it'])
      const sha = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim()
      const commit = await service.readDiffSides(workspaceId, 'a.txt', 'commit', sha)
      expect([commit.oldFile?.contents, commit.newFile?.contents]).toEqual(['base\n', 'staged\n'])
    })
  }, 20_000)
})

describe('file tabs: existence, media and location', () => {
  it('keeps only paths that are still files inside the project', async () => {
    await withRepository({ 'a.txt': 'a\n' }, async (root, service) => {
      await mkdir(join(root, 'dir'))
      const result = await service.existingFiles(workspaceId, ['a.txt', 'missing.txt', 'dir', '../outside.txt'])
      expect(result.paths).toEqual(['a.txt'])
    })
  }, 20_000)

  it('reads images whole and refuses other files as media', async () => {
    const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex')
    await withRepository({ 'a.txt': 'a\n' }, async (root, service) => {
      await writeFile(join(root, 'dot.png'), png)
      const media = await service.previewMedia(workspaceId, 'dot.png')
      expect(media.mime).toBe('image/png')
      expect(Buffer.from(media.data).equals(png)).toBe(true)
      await expect(service.previewMedia(workspaceId, 'a.txt')).rejects.toMatchObject({ code: 'WORKSPACE_MEDIA_UNSUPPORTED' })
      await expect(service.locateFile(workspaceId, '../a.txt')).rejects.toMatchObject({ code: 'WORKSPACE_PATH_INVALID' })
    })
  }, 20_000)
})

describe('committing from the review', () => {
  it('commits everything when asked, describing it for a model first', async () => {
    await withRepository({ 'a.txt': 'one\n' }, async (root, service) => {
      await writeFile(join(root, 'a.txt'), 'two\n', 'utf8')
      await writeFile(join(root, 'new.txt'), 'fresh\n', 'utf8')
      const preview = await service.commitPreview(workspaceId, true)
      expect(preview).toContain('Add the baseline')
      expect(preview).toContain('new.txt')
      expect(preview).toContain('+two')
      await expect(service.commit(workspaceId, { message: 'Nothing staged', includeUnstaged: false, next: 'commit' })).rejects.toMatchObject({ code: 'WORKSPACE_NOTHING_TO_COMMIT' })
      const result = await service.commit(workspaceId, { message: 'Update a and add new\n\nWith a body.', includeUnstaged: true, next: 'commit' })
      expect(result).toMatchObject({ branch: 'main', pushed: false })
      expect((await git(root, ['log', '-1', '--format=%s%n%b'])).stdout.trim()).toBe('Update a and add new\nWith a body.')
      expect((await service.listChanges(workspaceId)).files).toEqual([])
    })
  }, 20_000)

  it('pushes to a new upstream, then reports where the branch stands', async () => {
    const remote = await mkdtemp(join(tmpdir(), 'pipilot-git-remote-'))
    try {
      await git(remote, ['init', '-q', '--bare'])
      await withRepository({ 'a.txt': 'one\n' }, async (root, service) => {
        await git(root, ['remote', 'add', 'origin', remote])
        await writeFile(join(root, 'a.txt'), 'two\n', 'utf8')
        const before = await service.gitStatus(workspaceId)
        expect(before).toMatchObject({ branch: 'main', onDefaultBranch: true, hasRemote: true, upstream: '', unstaged: 1, staged: 0 })
        const result = await service.commit(workspaceId, { message: 'Push it', includeUnstaged: true, next: 'push' })
        expect(result.pushed).toBe(true)
        expect(result.pushError).toBeUndefined()
        const after = await service.gitStatus(workspaceId)
        expect(after).toMatchObject({ upstream: 'origin/main', ahead: 0, behind: 0 })
      })
    } finally {
      await rm(remote, { recursive: true, force: true })
    }
  }, 30_000)

  it('opens a pull request from a new branch, and keeps the commit when GitHub fails', async () => {
    const remote = await mkdtemp(join(tmpdir(), 'pipilot-git-remote-'))
    const bin = await mkdtemp(join(tmpdir(), 'pipilot-gh-'))
    try {
      await git(remote, ['init', '-q', '--bare'])
      const gh = join(bin, 'pipilot-test-gh.cjs')
      await writeFile(gh, `
        if (process.argv[2] === '--version') { console.log('gh'); process.exit(0) }
        require('node:fs').writeFileSync(require('node:path').join(__dirname, 'args'), process.argv.slice(2).join(' ') + '\\n')
        console.log('https://github.com/example/repo/pull/7')
      `, 'utf8')
      await chmod(gh, 0o755)
      await withRepository({ 'a.txt': 'one\n' }, async (root, service) => {
        await git(root, ['remote', 'add', 'origin', remote])
        await writeFile(join(root, 'a.txt'), 'two\n', 'utf8')
        expect((await service.gitStatus(workspaceId)).ghAvailable).toBe(true)
        await expect(service.commit(workspaceId, { message: 'Taken', includeUnstaged: true, next: 'pull-request', branch: 'main' }))
          .rejects.toMatchObject({ code: 'WORKSPACE_BRANCH_EXISTS' })
        const result = await service.commit(workspaceId, { message: 'Open a PR\n\nDetails.', includeUnstaged: true, next: 'pull-request', branch: 'pipilot/open-a-pr' })
        expect(result).toMatchObject({ branch: 'pipilot/open-a-pr', pushed: true, pullRequestUrl: 'https://github.com/example/repo/pull/7' })
        expect(await readFile(join(bin, 'args'), 'utf8')).toBe('pr create --title Open a PR --body Details.\n')
      }, { ghBinary: gh })
      await withRepository({ 'a.txt': 'one\n' }, async (root, service) => {
        await writeFile(join(root, 'a.txt'), 'two\n', 'utf8')
        const result = await service.commit(workspaceId, { message: 'No remote', includeUnstaged: true, next: 'push' })
        expect(result.pushed).toBe(false)
        expect(result.pushError).toBeTruthy()
        expect((await git(root, ['log', '-1', '--format=%s'])).stdout.trim()).toBe('No remote')
      })
    } finally {
      await rm(remote, { recursive: true, force: true })
      await rm(bin, { recursive: true, force: true })
    }
  }, 30_000)
})
