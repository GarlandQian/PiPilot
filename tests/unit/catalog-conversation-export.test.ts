import { appendFile, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConversationExportService } from '../../src/main/conversations/conversation-export-service'
import { ConversationScopeResolver } from '../../src/main/conversations/conversation-scope-resolver'
import { OfficialPiSessionCatalog } from '../../src/main/conversations/official-pi-session-catalog'
import { ObservedPiSessionDirectoryRepository } from '../../src/main/repositories/observed-pi-session-directory-repository'
import { conversationExportRequestSchema, type ConversationExportRequest } from '../../src/shared/conversation-export'
import type { LocalPiSessionEntry } from '../../src/shared/local-pi'
import type { PiRuntimeControlSummary } from '../../src/main/pi-host/pi-runtime-frontend'

const scope = { kind: 'project', workspaceId: '00000000-0000-4000-8000-000000000001' } as const
const stamp = '2026-10-01T00:00:00.000Z'
const user = (id: string, parentId: string | null, content: string): LocalPiSessionEntry => ({
  type: 'message', id, parentId, timestamp: stamp, message: { role: 'user', content, timestamp: 1 },
})
const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pipilot-catalog-export-')))
  directories.push(root)
  const cwd = join(root, 'project')
  const sessions = join(root, 'sessions')
  await mkdir(cwd); await mkdir(sessions)
  const resolver = new ConversationScopeResolver({ getLocation: () => ({ id: scope.workspaceId, name: 'Project', path: cwd }) }, join(root, 'general'))
  const observed = new ObservedPiSessionDirectoryRepository(join(root, 'observed.json'))
  await observed.initialize()
  const catalog = new OfficialPiSessionCatalog(resolver, observed)
  async function session(fileName: string, text: string, sessionCwd = cwd, entries = [user('u', null, text)]) {
    const path = join(sessions, fileName)
    await writeFile(path, [
      JSON.stringify({ type: 'session', version: 3, id: 'duplicate-id', timestamp: stamp, cwd: sessionCwd }),
      ...entries.map((entry) => JSON.stringify(entry)),
    ].join('\n') + '\n')
    await observed.observe(scope, path)
    return path
  }
  const a = await session('a.jsonl', 'Selected conversation content')
  const b = await session('b.jsonl', 'Other conversation content')
  const runtime = {
    getActiveRuntimeIdentity: vi.fn(() => null),
    getSnapshot: vi.fn(() => { throw new Error('Must not read selected conversation') }),
    request: vi.fn(async () => { throw new Error('Must not send to selected conversation') }),
    listControlRuntimes: vi.fn((): PiRuntimeControlSummary[] => []),
    getControlEntries: vi.fn(async () => ({ entries: [user('live', null, 'Actual live selected branch')], leafId: 'live' })),
  }
  const chooseDestination = vi.fn(async () => join(root, 'export.md'))
  const service = new ConversationExportService({ runtime, catalog, chooseDestination })
  async function request(text = 'Other conversation content'): Promise<ConversationExportRequest> {
    const listing = await catalog.refresh(scope)
    const row = listing.rows.find((row) => row.preview === text)!
    return { scope, selectionToken: row.selectionToken, selection: { kind: 'conversation' }, includeTools: false, locale: 'en-US' }
  }
  return { root, cwd, a, b, session, catalog, runtime, chooseDestination, service, request }
}

describe('catalog row Markdown export', () => {
  it('accepts only an opaque row target for whole-conversation export', () => {
    const input = { scope, selectionToken: 'sel_abcdefghijklmnop', selection: { kind: 'conversation' }, locale: 'en-US', includeTools: false }
    expect(conversationExportRequestSchema.safeParse(input).success).toBe(true)
    expect(conversationExportRequestSchema.safeParse({ ...input, generation: 1, sessionId: 'duplicate-id' }).success).toBe(false)
    expect(conversationExportRequestSchema.safeParse({ ...input, sessionFile: '/private/session.jsonl' }).success).toBe(false)
    expect(conversationExportRequestSchema.safeParse({ ...input, selection: { kind: 'message', entryId: 'u' } }).success).toBe(false)
  })

  it('exports an unopened row with a duplicate session ID without inspecting or activating the selected runtime', async () => {
    const f = await fixture()
    await expect(f.service.save(await f.request())).resolves.toMatchObject({ status: 'saved' })
    const result = await readFile(join(f.root, 'export.md'), 'utf8')
    expect(result).toContain('Other conversation content')
    expect(result).not.toContain('Selected conversation content')
    expect(f.runtime.getActiveRuntimeIdentity).not.toHaveBeenCalled()
    expect(f.runtime.getSnapshot).not.toHaveBeenCalled()
    expect(f.runtime.request).not.toHaveBeenCalled()
    expect(f.runtime.getControlEntries).not.toHaveBeenCalled()
  })

  it('uses the exact live runtime branch for a matching native file and ignores a same-ID different file', async () => {
    const f = await fixture()
    const handle = { hostEpoch: 1, runtimeId: 'live', generation: 2, scope, sessionId: 'duplicate-id', sessionFile: f.b } as PiRuntimeControlSummary
    f.runtime.listControlRuntimes.mockReturnValue([{ ...handle, runtimeId: 'other', sessionFile: f.a }, handle])
    await f.service.save(await f.request())
    expect(f.runtime.getControlEntries).toHaveBeenCalledExactlyOnceWith(handle)
    expect(await readFile(join(f.root, 'export.md'), 'utf8')).toContain('Actual live selected branch')
    expect(f.runtime.request).not.toHaveBeenCalled()
  })

  it('does not consume recovery tokens or fork a session to export it', async () => {
    const f = await fixture()
    await f.session('recover.jsonl', 'Moved project conversation', join(f.root, 'removed-project'))
    const input = await f.request('Moved project conversation')
    if (!('selectionToken' in input)) throw new Error('Expected catalog target')
    const before = await f.catalog.resolveReadTarget(scope, input.selectionToken)
    expect(before.mode).toBe('recover')
    await f.service.save(input)
    expect((await f.catalog.resolveReadTarget(scope, input.selectionToken)).sessionFile).toBe(before.sessionFile)
    expect((await f.catalog.resolve(scope, input.selectionToken)).mode).toBe('recover')
  })

  it('rejects a stale token before showing the native save dialog', async () => {
    const f = await fixture()
    const input = await f.request()
    await rm(f.b)
    await f.catalog.refresh(scope)
    await expect(f.service.save(input)).rejects.toMatchObject({ code: 'EXPORT_STALE_SESSION' })
    expect(f.chooseDestination).not.toHaveBeenCalled()
  })

  it('refuses a same-name file replacement while the native save dialog is open', async () => {
    const f = await fixture()
    const input = await f.request()
    f.chooseDestination.mockImplementationOnce(async () => {
      await rename(f.b, `${f.b}.retired`)
      await f.session('b.jsonl', 'Other conversation content')
      return join(f.root, 'export.md')
    })
    await expect(f.service.save(input)).rejects.toMatchObject({ code: 'EXPORT_STALE_SESSION' })
    await expect(readFile(join(f.root, 'export.md'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('refuses a same-inode rewrite of captured history before publishing', async () => {
    const f = await fixture()
    const input = await f.request()
    f.chooseDestination.mockImplementationOnce(async () => {
      const old = await readFile(f.b, 'utf8')
      await writeFile(f.b, old.replace('Other conversation content', 'Altered conversation text'))
      return join(f.root, 'export.md')
    })
    await expect(f.service.save(input)).rejects.toMatchObject({ code: 'EXPORT_STALE_SESSION' })
    await expect(readFile(join(f.root, 'export.md'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('does not silently export incomplete history after a partial JSONL append', async () => {
    const f = await fixture()
    const input = await f.request()
    await appendFile(f.b, '{"type":"message"')
    await expect(f.service.save(input)).rejects.toMatchObject({ code: 'EXPORT_STALE_SESSION' })
    expect(f.chooseDestination).not.toHaveBeenCalled()
  })

  it('exports one captured snapshot while normal appends continue during the save dialog', async () => {
    const f = await fixture()
    const input = await f.request()
    f.chooseDestination.mockImplementationOnce(async () => {
      await appendFile(f.b, JSON.stringify(user('later', 'u', 'Appended after capture')) + '\n')
      return join(f.root, 'export.md')
    })
    await expect(f.service.save(input)).resolves.toMatchObject({ status: 'saved' })
    expect(await readFile(join(f.root, 'export.md'), 'utf8')).not.toContain('Appended after capture')
  })

  it('uses the last persisted entry as leaf and excludes an abandoned branch', async () => {
    const f = await fixture()
    await f.session('branch.jsonl', '', f.cwd, [user('root', null, 'Branch root'), user('old', 'root', 'Abandoned fork'), user('current', 'root', 'Current fork')])
    const input = await f.request('Branch root')
    await f.service.save(input)
    const result = await readFile(join(f.root, 'export.md'), 'utf8')
    expect(result).toContain('Current fork')
    expect(result).not.toContain('Abandoned fork')
  })
})
