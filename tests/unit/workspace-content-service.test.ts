import { execFile } from 'node:child_process'
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
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
  })

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
  })

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
