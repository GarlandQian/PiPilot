import { execFile } from 'node:child_process'
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it, vi } from 'vitest'
import {
  WorkspaceContentError,
  WorkspaceContentService,
  workspaceContentInternals,
} from '../../src/main/workspace/workspace-content-service'
import {
  WORKSPACE_DIRECTORY_ENTRY_LIMIT,
  WORKSPACE_DIFF_PATCH_BYTE_LIMIT,
  WORKSPACE_PATH_SEARCH_RESULT_LIMIT,
  WORKSPACE_PREVIEW_BYTE_LIMIT,
} from '../../src/shared/workspace-content'

const execute = promisify(execFile)
const workspaceId = '00000000-0000-4000-8000-000000000701'

async function git(cwd: string, args: string[]) {
  return execute('git', args, { cwd, encoding: 'utf8' })
}

function serviceFor(path: string, gitBinary?: string) {
  return new WorkspaceContentService(
    () => ({ id: workspaceId, path }),
    gitBinary ? { gitBinary } : {},
  )
}

async function initializeIndex(root: string, files: Record<string, string>) {
  await git(root, ['init', '-q'])
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path)
    await mkdir(join(target, '..'), { recursive: true })
    await writeFile(target, content, 'utf8')
  }
  await git(root, ['add', '--', '.'])
  await git(root, [
    '-c',
    'user.name=PiPilot Tests',
    '-c',
    'user.email=pipilot@example.invalid',
    'commit',
    '-qm',
    'baseline',
  ])
}

describe('WorkspaceContentService paths and bounded reads', () => {
  it('bounds unified patches at complete hunk boundaries', () => {
    const first = '@@ -1,1 +1,1 @@\n-before\n+after\n'
    const oversized = `${first}@@ -2,1 +2,1 @@\n-${'x'.repeat(WORKSPACE_DIFF_PATCH_BYTE_LIMIT)}\n+y\n`
    const bounded = workspaceContentInternals.boundUnifiedPatch(oversized)
    expect(bounded.truncated).toBe(true)
    expect(bounded.patch).toBe(first)
    expect(workspaceContentInternals.boundUnifiedPatch(first, false)).toEqual({
      patch: '',
      truncated: true,
    })
  })

  it('uses the destination path for NUL-delimited rename statistics', () => {
    expect(workspaceContentInternals.parseNumStats(
      '2\t1\t\0old-name.ts\0new-name.ts\0',
    ).get('new-name.ts')).toEqual({ added: 2, deleted: 1, binary: false })
  })

  it('bounds lazy listings, ignores generated directories, and rejects traversal or symlink escape', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pipilot-content-'))
    const outside = await mkdtemp(join(tmpdir(), 'pipilot-outside-'))
    try {
      await Promise.all([
        mkdir(join(root, 'node_modules'), { recursive: true }),
        mkdir(join(root, 'dist'), { recursive: true }),
        writeFile(join(root, '.env'), 'TOKEN=private', 'utf8'),
        writeFile(join(outside, 'secret.txt'), 'outside', 'utf8'),
        ...Array.from({ length: WORKSPACE_DIRECTORY_ENTRY_LIMIT + 5 }, (_, index) =>
          writeFile(join(root, `file-${String(index).padStart(3, '0')}.txt`), `${index}`, 'utf8')),
      ])
      await symlink(outside, join(root, 'escape'))
      const service = serviceFor(root, 'git-not-installed-for-this-test')

      const listing = await service.listDirectory(workspaceId, '.')
      expect(listing.entries).toHaveLength(WORKSPACE_DIRECTORY_ENTRY_LIMIT)
      expect(listing.truncated).toBe(true)
      expect(listing.gitAvailable).toBe(false)
      expect(listing.entries.map((entry) => entry.name)).not.toEqual(
        expect.arrayContaining(['node_modules', 'dist', 'escape']),
      )

      await expect(service.listDirectory(workspaceId, '../outside')).rejects.toMatchObject({
        code: 'WORKSPACE_PATH_INVALID',
      } satisfies Partial<WorkspaceContentError>)
      await expect(service.previewFile(workspaceId, 'escape/secret.txt')).rejects.toMatchObject({
        code: 'WORKSPACE_PATH_OUTSIDE',
      } satisfies Partial<WorkspaceContentError>)
      await expect(service.previewFile(workspaceId, '.env')).resolves.toMatchObject({
        kind: 'text',
        path: '.env',
        content: 'TOKEN=private',
      })
    } finally {
      await Promise.all([
        rm(root, { recursive: true, force: true }),
        rm(outside, { recursive: true, force: true }),
      ])
    }
  })

  it('returns bounded text previews and explicit binary or too-large outcomes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pipilot-content-'))
    try {
      await Promise.all([
        writeFile(join(root, 'text.txt'), 'hello PiPilot\n', 'utf8'),
        writeFile(join(root, 'binary.bin'), Buffer.from([0, 1, 2, 3])),
        writeFile(
          join(root, 'large.txt'),
          Buffer.alloc(WORKSPACE_PREVIEW_BYTE_LIMIT + 1, 65),
        ),
      ])
      const service = serviceFor(root, 'git-not-installed-for-this-test')

      await expect(service.previewFile(workspaceId, 'text.txt')).resolves.toMatchObject({
        kind: 'text',
        path: 'text.txt',
        content: 'hello PiPilot\n',
      })
      await expect(service.previewFile(workspaceId, 'binary.bin')).resolves.toMatchObject({
        kind: 'binary',
        path: 'binary.bin',
      })
      await expect(service.previewFile(workspaceId, 'large.txt')).resolves.toMatchObject({
        kind: 'too-large',
        path: 'large.txt',
        limit: WORKSPACE_PREVIEW_BYTE_LIMIT,
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('searches canonical project paths without exposing generated or escaping entries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pipilot-search-'))
    const outside = await mkdtemp(join(tmpdir(), 'pipilot-search-outside-'))
    try {
      await Promise.all([
        mkdir(join(root, 'src/components'), { recursive: true }),
        mkdir(join(root, 'node_modules/pkg'), { recursive: true }),
      ])
      await Promise.all([
        writeFile(join(root, 'src/components/Composer.tsx'), 'export {}', 'utf8'),
        writeFile(join(root, '.env'), 'VISIBLE_TO_USER=1', 'utf8'),
        writeFile(join(root, 'node_modules/pkg/index.js'), 'generated', 'utf8'),
        writeFile(join(outside, 'outside.ts'), 'outside', 'utf8'),
      ])
      await symlink(outside, join(root, 'external'))
      const service = serviceFor(root, 'git-not-installed-for-this-test')

      await expect(service.searchPaths(workspaceId, 'composer')).resolves.toMatchObject({
        workspaceId,
        query: 'composer',
        entries: [{
          name: 'Composer.tsx',
          path: 'src/components/Composer.tsx',
          type: 'file',
        }],
      })
      const rootEntries = await service.searchPaths(workspaceId, '')
      expect(rootEntries.entries.map((entry) => entry.path)).toContain('.env')
      expect(rootEntries.entries.map((entry) => entry.path)).not.toEqual(
        expect.arrayContaining(['node_modules', 'external']),
      )
      expect(rootEntries.entries.length).toBeLessThanOrEqual(WORKSPACE_PATH_SEARCH_RESULT_LIMIT)
    } finally {
      await Promise.all([
        rm(root, { recursive: true, force: true }),
        rm(outside, { recursive: true, force: true }),
      ])
    }
  })

  it('rejects a response when the active workspace changes during the read', async () => {
    const firstRoot = await mkdtemp(join(tmpdir(), 'pipilot-content-first-'))
    const secondRoot = await mkdtemp(join(tmpdir(), 'pipilot-content-second-'))
    let location = { id: workspaceId, path: firstRoot }
    const service = new WorkspaceContentService(
      () => location,
      { gitBinary: 'git-not-installed-for-this-test' },
    )
    try {
      await writeFile(join(firstRoot, 'first.txt'), 'first', 'utf8')
      const request = service.listDirectory(workspaceId, '.')
      location = {
        id: '00000000-0000-4000-8000-000000000702',
        path: secondRoot,
      }
      await expect(request).rejects.toMatchObject({
        code: 'WORKSPACE_CONTENT_STALE_WORKSPACE',
      } satisfies Partial<WorkspaceContentError>)
    } finally {
      await Promise.all([
        rm(firstRoot, { recursive: true, force: true }),
        rm(secondRoot, { recursive: true, force: true }),
      ])
    }
  })
})
describe('WorkspaceContentService Git changes', () => {
  it('keeps each status column independent, including a staged rename edited again', () => {
    const entries = workspaceContentInternals.parsePorcelain(
      'RM new.ts\0old.ts\0AD added.txt\0D  removed.txt\0?? removed.txt\0',
    )
    expect([...entries.values()]).toEqual([
      { path: 'new.ts', previousPath: 'old.ts', stage: 'staged', status: 'modified', untracked: false },
      { path: 'new.ts', stage: 'unstaged', status: 'modified', untracked: false },
      { path: 'added.txt', stage: 'staged', status: 'added', untracked: false },
      { path: 'added.txt', stage: 'unstaged', status: 'deleted', untracked: false },
      { path: 'removed.txt', stage: 'staged', status: 'deleted', untracked: false },
      { path: 'removed.txt', stage: 'unstaged', status: 'added', untracked: true },
    ])
  })

  it('lists and reads staged, unstaged, and untracked changes with separate identities', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pipilot-content-stages-'))
    try {
      await initializeIndex(root, { 'main.txt': 'base\n', 'dist/tracked.txt': 'old\n' })
      await writeFile(join(root, 'main.txt'), 'staged\nsecond\n', 'utf8')
      await git(root, ['add', '--', 'main.txt'])
      await writeFile(join(root, 'main.txt'), 'working\nsecond\n', 'utf8')
      await writeFile(join(root, 'dist/tracked.txt'), 'new\n', 'utf8')
      await writeFile(join(root, 'new.txt'), 'untracked\n', 'utf8')
      const indexBefore = await readFile(join(root, '.git/index'))
      const service = serviceFor(root)
      const changes = await service.listChanges(workspaceId)
      expect(changes.files).toMatchObject([
        { id: 'staged:main.txt', path: 'main.txt', stage: 'staged', added: 2, deleted: 1 },
        { id: 'unstaged:dist/tracked.txt', path: 'dist/tracked.txt', stage: 'unstaged' },
        { id: 'unstaged:main.txt', path: 'main.txt', stage: 'unstaged', added: 1, deleted: 1 },
        { id: 'unstaged:new.txt', path: 'new.txt', stage: 'unstaged', status: 'added' },
      ])
      const staged = await service.readDiff(workspaceId, 'main.txt', 'staged')
      expect(staged.patch).toContain('-base\n+staged\n+second')
      expect(staged.patch).not.toContain('+working')
      const unstaged = await service.readDiff(workspaceId, 'main.txt', 'unstaged')
      expect(unstaged.patch).toContain('-staged\n+working')
      expect(unstaged.patch).not.toContain('-base')
      expect((await service.listDirectory(workspaceId, '.')).modifiedCount).toBe(3)
      await expect(readFile(join(root, '.git/index'))).resolves.toEqual(indexBefore)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 15_000)

  it('reads staged additions before the first commit and when the worktree file is deleted', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pipilot-content-unborn-'))
    try {
      await git(root, ['init', '-q'])
      await writeFile(join(root, 'first.txt'), 'first commit content\n', 'utf8')
      await git(root, ['add', '--', 'first.txt'])
      await rm(join(root, 'first.txt'))
      const service = serviceFor(root)
      expect((await service.listChanges(workspaceId)).files).toMatchObject([
        { path: 'first.txt', stage: 'staged', status: 'added', added: 1, deleted: 0 },
        { path: 'first.txt', stage: 'unstaged', status: 'deleted', added: 0, deleted: 1 },
      ])
      await expect(service.readDiff(workspaceId, 'first.txt', 'staged')).resolves.toMatchObject({
        patch: expect.stringContaining('+first commit content'),
      })
      await expect(service.readDiff(workspaceId, 'first.txt')).resolves.toMatchObject({
        patch: expect.stringContaining('-first commit content'),
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 15_000)

  it('preserves both rename paths in the staged patch and reads later edits separately', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pipilot-content-renames-'))
    try {
      await initializeIndex(root, { 'old name.txt': 'keep\nkeep also\nbefore\n' })
      await rename(join(root, 'old name.txt'), join(root, 'new name.txt'))
      await git(root, ['add', '-A', '--', '.'])
      await writeFile(join(root, 'new name.txt'), 'keep\nkeep also\nafter\n', 'utf8')
      const service = serviceFor(root)
      const changes = await service.listChanges(workspaceId)
      expect(changes.files).toMatchObject([
        { path: 'new name.txt', stage: 'staged', previousPath: 'old name.txt', added: 0, deleted: 0 },
        { path: 'new name.txt', stage: 'unstaged', added: 1, deleted: 1 },
      ])
      expect(changes.files[1]).not.toHaveProperty('previousPath')
      const renamed = await service.readDiff(workspaceId, 'new name.txt', 'staged')
      expect(renamed.patch).toContain('rename from old name.txt')
      expect(renamed.patch).toContain('rename to new name.txt')
      expect(renamed.patch).not.toContain('new file mode')
      await expect(service.readDiff(workspaceId, 'new name.txt')).resolves.toMatchObject({
        patch: expect.stringContaining('-before\n+after'),
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 15_000)

  it('reports staged deletion and binary changes without reading the current file as staged content', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pipilot-content-binary-'))
    try {
      await initializeIndex(root, { 'gone.txt': 'removed\n', 'data.bin': 'plain\n' })
      await rm(join(root, 'gone.txt'))
      await writeFile(join(root, 'data.bin'), Buffer.from([0, 1, 2]))
      await git(root, ['add', '-A', '--', '.'])
      await writeFile(join(root, 'new.bin'), Buffer.from([0, 3, 4]))
      const service = serviceFor(root)
      expect((await service.listChanges(workspaceId)).files).toMatchObject([
        { path: 'data.bin', stage: 'staged', binary: true },
        { path: 'gone.txt', stage: 'staged', status: 'deleted', added: 0, deleted: 1 },
        { path: 'new.bin', stage: 'unstaged', binary: true },
      ])
      await expect(service.readDiff(workspaceId, 'data.bin', 'staged')).resolves.toMatchObject({
        binary: true, patch: '', truncated: false,
      })
      await expect(service.readDiff(workspaceId, 'new.bin')).resolves.toMatchObject({
        binary: true, patch: '', truncated: false,
      })
      await expect(service.readDiff(workspaceId, 'gone.txt', 'staged')).resolves.toMatchObject({
        patch: expect.stringContaining('-removed'),
      })
      await expect(service.readDiff(workspaceId, 'gone.txt')).rejects.toMatchObject({
        code: 'WORKSPACE_CHANGE_NOT_FOUND',
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 15_000)

  it('uses literal file paths instead of interpreting Git pathspec patterns', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pipilot-content-literal-'))
    try {
      await initializeIndex(root, { 'file[1].txt': 'base\n', 'file1.txt': 'other\n' })
      await writeFile(join(root, 'file[1].txt'), 'selected\n', 'utf8')
      await writeFile(join(root, 'file1.txt'), 'unrelated\n', 'utf8')
      const diff = await serviceFor(root).readDiff(workspaceId, 'file[1].txt')
      expect(diff.patch).toContain('+selected')
      expect(diff.patch).not.toContain('unrelated')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 15_000)

  it('invalidates revisions for equal-sized external edits while keeping staged revisions stable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pipilot-content-revision-'))
    try {
      await initializeIndex(root, { 'main.txt': 'base\n' })
      await writeFile(join(root, 'main.txt'), 'index\n', 'utf8')
      await git(root, ['add', '--', 'main.txt'])
      await writeFile(join(root, 'main.txt'), 'first\n', 'utf8')
      const service = serviceFor(root)
      const first = await service.listChanges(workspaceId)
      const same = await service.listChanges(workspaceId)
      expect(same.files.map((file) => file.revision)).toEqual(first.files.map((file) => file.revision))
      await writeFile(join(root, 'main.txt'), 'later\n', 'utf8')
      const next = await service.listChanges(workspaceId)
      expect(next.files[0].revision).toBe(first.files[0].revision)
      expect(next.files[1].revision).not.toBe(first.files[1].revision)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 15_000)

  it('refreshes stage membership before reading and rejects a stage that disappeared', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pipilot-content-refresh-'))
    try {
      await initializeIndex(root, { 'main.txt': 'base\n' })
      await writeFile(join(root, 'main.txt'), 'changed\n', 'utf8')
      const service = serviceFor(root)
      expect((await service.listChanges(workspaceId)).files[0].stage).toBe('unstaged')
      await git(root, ['add', '--', 'main.txt'])
      await expect(service.readDiff(workspaceId, 'main.txt', 'unstaged')).rejects.toMatchObject({
        code: 'WORKSPACE_CHANGE_NOT_FOUND',
      })
      await expect(service.readDiff(workspaceId, 'main.txt', 'staged')).resolves.toMatchObject({
        stage: 'staged', patch: expect.stringContaining('+changed'),
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 15_000)

  it('omits untracked symlink escapes and rejects a workspace switch during a diff read', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pipilot-content-safe-diff-'))
    const outside = await mkdtemp(join(tmpdir(), 'pipilot-content-private-'))
    let location = { id: workspaceId, path: root }
    try {
      await initializeIndex(root, { 'main.txt': 'base\n' })
      await writeFile(join(root, 'main.txt'), 'changed\n', 'utf8')
      await writeFile(join(outside, 'secret.txt'), 'outside\n', 'utf8')
      await symlink(join(outside, 'secret.txt'), join(root, 'escape.txt'))
      const service = new WorkspaceContentService(() => location)
      expect((await service.listChanges(workspaceId)).files.map((file) => file.path)).toEqual(['main.txt'])
      await expect(service.readDiff(workspaceId, 'escape.txt')).rejects.toMatchObject({
        code: 'WORKSPACE_PATH_OUTSIDE',
      })
      const patchReader = service as unknown as {
        runGitBoundedPatch(root: string, args: string[], allowDifferenceExit?: boolean): Promise<{ patch: string; truncated: boolean }>
      }
      const original = patchReader.runGitBoundedPatch.bind(service)
      vi.spyOn(patchReader, 'runGitBoundedPatch').mockImplementationOnce(async (...args) => {
        const result = await original(...args)
        location = { id: '00000000-0000-4000-8000-000000000702', path: outside }
        return result
      })
      await expect(service.readDiff(workspaceId, 'main.txt')).rejects.toMatchObject({
        code: 'WORKSPACE_CONTENT_STALE_WORKSPACE',
      })
    } finally {
      await Promise.all([
        rm(root, { recursive: true, force: true }),
        rm(outside, { recursive: true, force: true }),
      ])
    }
  }, 15_000)

  it.each(['staged', 'unstaged'] as const)('rejects %s state changes during a diff read', async (stage) => {
    const root = await mkdtemp(join(tmpdir(), 'pipilot-content-race-'))
    try {
      await initializeIndex(root, { 'main.txt': 'base\n' })
      await writeFile(join(root, 'main.txt'), 'changed\n', 'utf8')
      if (stage === 'staged') await git(root, ['add', '--', 'main.txt'])
      const service = serviceFor(root)
      const patchReader = service as unknown as {
        runGitBoundedPatch(root: string, args: string[], allowDifferenceExit?: boolean): Promise<{ patch: string; truncated: boolean }>
      }
      const original = patchReader.runGitBoundedPatch.bind(service)
      vi.spyOn(patchReader, 'runGitBoundedPatch').mockImplementationOnce(async (...args) => {
        const result = await original(...args)
        await writeFile(join(root, 'main.txt'), 'outside\n', 'utf8')
        if (stage === 'staged') await git(root, ['add', '--', 'main.txt'])
        return result
      })
      await expect(service.readDiff(workspaceId, 'main.txt', stage)).rejects.toMatchObject({
        code: 'WORKSPACE_CHANGE_CONFLICT',
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 15_000)

  it('shows an actual unified edit without writing files or the index', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pipilot-content-git-'))
    try {
      await initializeIndex(root, { 'src/main.ts': 'before\n' })
      await writeFile(join(root, 'src/main.ts'), 'after\n', 'utf8')
      const service = serviceFor(root)
      const indexBefore = await readFile(join(root, '.git/index'))

      const changes = await service.listChanges(workspaceId)
      expect(changes).toMatchObject({
        gitAvailable: true,
        files: [{
          path: 'src/main.ts',
          status: 'modified',
          added: 1,
          deleted: 1,
        }],
      })
      const change = changes.files[0]
      const diff = await service.readDiff(workspaceId, change.path)
      expect(diff.patch).toMatch(/-before[\s\S]*\+after/u)
      expect(diff.patch).toContain('@@')
      expect(diff).not.toHaveProperty('fingerprint')
      expect(diff).not.toHaveProperty('source')
      await expect(readFile(join(root, 'src/main.ts'), 'utf8')).resolves.toBe('after\n')
      await expect(readFile(join(root, '.git/index'))).resolves.toEqual(indexBefore)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 15_000)

  it('reports a refreshed external edit without mutation or conflict state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pipilot-content-git-'))
    try {
      await initializeIndex(root, { 'config.txt': 'base\n' })
      await writeFile(join(root, 'config.txt'), 'agent edit\n', 'utf8')
      const service = serviceFor(root)
      const first = (await service.listChanges(workspaceId)).files[0]
      await writeFile(join(root, 'config.txt'), 'external edit\n', 'utf8')
      await expect(readFile(join(root, 'config.txt'), 'utf8')).resolves.toBe('external edit\n')

      const refreshed = (await service.listChanges(workspaceId)).files[0]
      expect(refreshed.path).toBe(first.path)
      await expect(service.readDiff(workspaceId, refreshed.path)).resolves.toMatchObject({
        patch: expect.stringContaining('+external edit'),
      })
      await expect(readFile(join(root, 'config.txt'), 'utf8')).resolves.toBe('external edit\n')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 15_000)

  it('lists untracked files and degrades outside Git', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pipilot-content-git-'))
    const plainRoot = await mkdtemp(join(tmpdir(), 'pipilot-content-plain-'))
    try {
      await git(root, ['init', '-q'])
      await writeFile(join(root, 'new.txt'), 'new\n', 'utf8')
      const service = serviceFor(root)
      const change = (await service.listChanges(workspaceId)).files[0]
      expect(change).toMatchObject({ path: 'new.txt', status: 'added' })
      await expect(service.readDiff(workspaceId, change.path)).resolves.toMatchObject({
        patch: expect.stringContaining('+new'),
      })

      const fallback = serviceFor(plainRoot, 'git-not-installed-for-this-test')
      await expect(fallback.listChanges(workspaceId)).resolves.toEqual({
        workspaceId,
        gitAvailable: false,
        branch: '',
        files: [],
        truncated: false,
      })
    } finally {
      await Promise.all([
        rm(root, { recursive: true, force: true }),
        rm(plainRoot, { recursive: true, force: true }),
      ])
    }
  })

  it('keeps read-only diff unavailable outside Git', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pipilot-content-tool-'))
    const path = join(root, 'main.ts')
    try {
      await writeFile(path, 'after\n', 'utf8')
      const service = serviceFor(root, 'git-not-installed-for-this-test')
      await expect(service.readDiff(workspaceId, 'main.ts')).rejects.toMatchObject({
        code: 'WORKSPACE_GIT_UNAVAILABLE',
      } satisfies Partial<WorkspaceContentError>)
      await expect(readFile(path, 'utf8')).resolves.toBe('after\n')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
