import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConversationScope } from '../../src/shared/conversation-scope'
import { ConversationScopeResolver } from '../../src/main/conversations/conversation-scope-resolver'
import {
  OfficialPiSessionCatalog,
  SESSION_CATALOG_REFRESH_FOREGROUND_MAX_SCANS,
  type OfficialPiSessionCatalogOptions,
} from '../../src/main/conversations/official-pi-session-catalog'
import { ObservedPiSessionDirectoryRepository } from '../../src/main/repositories/observed-pi-session-directory-repository'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, open: vi.fn(actual.open) }
})

const scope: ConversationScope = {
  kind: 'project', workspaceId: '00000000-0000-4000-8000-000000000001',
}
const roots: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((complete) => { resolve = complete })
  return { promise, resolve }
}

async function fixture(options: OfficialPiSessionCatalogOptions = {}) {
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'pipilot-catalog-index-')))
  roots.push(root)
  const cwd = join(root, 'project')
  const sessions = join(root, 'sessions')
  await Promise.all([fs.mkdir(cwd), fs.mkdir(sessions)])
  const resolver = new ConversationScopeResolver({
    getLocation: (id) => ({ id, name: 'Project', path: cwd }),
  }, join(root, 'projectless'))
  const observations = new ObservedPiSessionDirectoryRepository(join(root, 'observed.json'))
  await observations.initialize()
  const catalog = new OfficialPiSessionCatalog(resolver, observations, options)
  const contents = (id: string) => `${JSON.stringify({
    type: 'session', version: 3, id, cwd, timestamp: '2026-08-08T00:00:00.000Z',
  })}\n${JSON.stringify({
    type: 'message', message: { role: 'user', content: `prompt ${id}` },
  })}\n`
  const write = async (id: string) => {
    const path = join(sessions, `${id}.jsonl`)
    await fs.writeFile(path, contents(id))
    return path
  }
  return { root, catalog, observations, contents, write, sessions }
}

describe('official Pi session metadata index', () => {
  it('does not reread unchanged JSONL, rereads only the appended file, and validates a selected file again', async () => {
    const f = await fixture()
    const files = await Promise.all(['one', 'two', 'three'].map(f.write))
    await f.observations.observe(scope, files[0]!)
    const open = vi.mocked(fs.open)
    const first = await f.catalog.list(scope)
    expect(open).toHaveBeenCalledTimes(3)
    open.mockClear()

    const unchanged = await f.catalog.refresh(scope)
    expect(open).not.toHaveBeenCalled()
    expect(unchanged.rows).toEqual(first.rows)

    await fs.appendFile(files[1]!, `${JSON.stringify({
      type: 'session_info', name: 'Renamed second session',
    })}\n`)
    const appended = await f.catalog.refresh(scope)
    expect(open).toHaveBeenCalledTimes(1)
    expect(open.mock.calls[0]?.[0]).toBe(files[1])
    const updated = appended.rows.find((row) => row.sessionId === 'two')!
    expect(updated.name).toBe('Renamed second session')
    expect(updated.selectionToken).toBe(first.rows.find((row) => row.sessionId === 'two')?.selectionToken)

    open.mockClear()
    await expect(f.catalog.resolve(scope, updated.selectionToken)).resolves.toMatchObject({
      sessionId: 'two', sessionFile: files[1],
    })
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('detects same-length rewrites even with the previous mtime restored and replaces the old token', async () => {
    const f = await fixture()
    const file = await f.write('one')
    await f.observations.observe(scope, file)
    // A known mtime makes the same-size/mtime replacement deterministic.
    const timestamp = new Date('2026-08-08T00:00:00.000Z')
    await fs.utimes(file, timestamp, timestamp)
    const first = await f.catalog.list(scope)
    const original = await fs.stat(file)
    await fs.writeFile(file, f.contents('two'))
    await fs.utimes(file, timestamp, timestamp)
    const rewritten = await fs.stat(file)
    expect(rewritten.size).toBe(original.size)
    expect(rewritten.mtimeMs).toBe(original.mtimeMs)
    const open = vi.mocked(fs.open).mockClear()

    const refreshed = await f.catalog.refresh(scope)
    expect(open).toHaveBeenCalledTimes(1)
    expect(refreshed.rows[0]?.sessionId).toBe('two')
    expect(refreshed.rows[0]?.selectionToken).not.toBe(first.rows[0]?.selectionToken)
    await expect(f.catalog.resolve(scope, first.rows[0]!.selectionToken)).rejects.toMatchObject({
      code: 'SESSION_CATALOG_SELECTION_STALE',
    })
  })

  it('invalidates inode replacements and sweeps removed files from the index', async () => {
    const f = await fixture()
    const file = await f.write('one')
    const removed = await f.write('gone')
    await f.observations.observe(scope, file)
    const first = await f.catalog.list(scope)
    const oldToken = first.rows.find((row) => row.sessionId === 'one')!.selectionToken
    const replacement = join(f.sessions, 'replacement.tmp')
    await fs.writeFile(replacement, f.contents('one'))
    await fs.rename(replacement, file)
    await fs.unlink(removed)
    const open = vi.mocked(fs.open).mockClear()

    const refreshed = await f.catalog.refresh(scope)
    expect(open).toHaveBeenCalledTimes(1)
    expect(refreshed.rows).toHaveLength(1)
    expect(refreshed.rows[0]?.selectionToken).not.toBe(oldToken)
    await expect(f.catalog.resolve(scope, oldToken)).rejects.toMatchObject({
      code: 'SESSION_CATALOG_SELECTION_STALE',
    })
    open.mockClear()
    await f.catalog.refresh(scope)
    expect(open).not.toHaveBeenCalled()
  })

  it('rereads authority and rejects a body rewrite even when the cached header still matches', async () => {
    const f = await fixture()
    const file = await f.write('one')
    await f.observations.observe(scope, file)
    const first = await f.catalog.list(scope)
    const originalToken = first.rows[0]!.selectionToken
    await f.catalog.refresh(scope)
    await fs.writeFile(file, f.contents('one').replace('prompt one', 'edited one'))

    await expect(f.catalog.resolve(scope, originalToken)).rejects.toMatchObject({
      code: 'SESSION_CATALOG_SELECTION_STALE',
    })
    const refreshed = await f.catalog.refresh(scope)
    expect(refreshed.rows[0]?.preview).toBe('edited one')
    expect(refreshed.rows[0]?.selectionToken).not.toBe(originalToken)
  })

  it('rechecks a cached recovery cwd without rereading the unchanged session file', async () => {
    const f = await fixture()
    const file = await f.write('one')
    const headerCwd = join(f.root, 'old-project')
    const contents = f.contents('one').replace(join(f.root, 'project'), headerCwd)
    await fs.writeFile(file, contents)
    await f.observations.observe(scope, file)
    const first = await f.catalog.list(scope)
    expect(first.rows).toHaveLength(1)
    await fs.mkdir(headerCwd)
    const open = vi.mocked(fs.open).mockClear()

    const refreshed = await f.catalog.refresh(scope)
    expect(open).not.toHaveBeenCalled()
    expect(refreshed.rows).toEqual([])
    expect(refreshed.diagnostics).toContainEqual({ code: 'scopeMismatch', count: 1 })
  })

  it('reconciles explicit refreshes after external writes between read slices', async () => {
    const suspended = deferred()
    const resume = deferred()
    let firstSlice = true
    const f = await fixture({
      now: () => 0,
      yieldScanContinuation: async () => {
        if (!firstSlice) return
        firstSlice = false
        suspended.resolve()
        await resume.promise
      },
    })
    const files = await Promise.all(Array.from({ length: 9 }, (_, index) => f.write(`s-${index}`)))
    await f.observations.observe(scope, files[0]!)
    const opening = f.catalog.list(scope)
    await suspended.promise
    await Promise.all(files.map((file, index) => fs.writeFile(file, f.contents(`s-${index}`).replace('prompt ', 'edited '))))
    // Multiple callers must not trigger one extra directory pass per caller.
    const joined = Array.from({ length: 5 }, () => f.catalog.refresh(scope))
    resume.resolve()
    const results = await Promise.all([opening, ...joined])
    for (const result of results) {
      expect(result.rows).toHaveLength(9)
      expect(result.rows.every((row) => row.preview.startsWith('edited '))).toBe(true)
      expect(result.diagnostics).toEqual([])
    }
    expect((await f.catalog.list(scope)).rows).toEqual(results[0]!.rows)
  })

  it('merges invalidations between slices without rereading completed files or restarting directory iteration', async () => {
    let invalidate = () => undefined as void
    const resume = deferred()
    const resumed = deferred()
    const yieldScanContinuation = vi.fn(async () => { invalidate() })
    const yieldRefreshContinuation = vi.fn(async () => {
      await resume.promise
      resumed.resolve()
    })
    const f = await fixture({ now: () => 0, yieldScanContinuation, yieldRefreshContinuation })
    const files = await Promise.all(Array.from({ length: 17 }, (_, i) => f.write(`s-${i}`)))
    await f.observations.observe(scope, files[0]!)
    const open = vi.mocked(fs.open)
    invalidate = () => f.catalog.invalidate(scope)
    const foreground = await f.catalog.list(scope)
    expect(foreground.rows).toHaveLength(17)
    expect(open).toHaveBeenCalledTimes(17)
    expect(yieldRefreshContinuation).toHaveBeenCalledOnce()
    expect(yieldScanContinuation.mock.calls.length).toBeGreaterThanOrEqual(
      SESSION_CATALOG_REFRESH_FOREGROUND_MAX_SCANS,
    )

    invalidate = () => undefined
    resume.resolve()
    await resumed.promise
    const reconciled = await f.catalog.refresh(scope)
    expect(reconciled.rows).toEqual(foreground.rows)
    expect(open).toHaveBeenCalledTimes(17)
    expect(yieldRefreshContinuation).toHaveBeenCalledOnce()
  })
})
