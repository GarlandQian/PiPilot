import { mkdir, mkdtemp, realpath, rm, writeFile, rename, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { ConversationSearchService, parseSearchEntry, searchActiveBranch } from '../../src/main/conversations/conversation-search-service'
import { ConversationScopeResolver } from '../../src/main/conversations/conversation-scope-resolver'
import { OfficialPiSessionCatalog } from '../../src/main/conversations/official-pi-session-catalog'
import { ObservedPiSessionDirectoryRepository } from '../../src/main/repositories/observed-pi-session-directory-repository'
import { conversationSearchResultSchema, findTextMatches } from '../../src/shared/conversation-search'
import { searchTranscript, toolMatchesSearch } from '../../src/renderer/conversation-text-search'
import type { ConversationScope } from '../../src/shared/conversation-scope'

const scope = { kind: 'project', workspaceId: '00000000-0000-4000-8000-000000000001' } satisfies ConversationScope
const message = (id: string, parentId: string | null, role: string, content: unknown) => ({ type: 'message', id, parentId, timestamp: '2026-09-29T00:00:00.000Z', message: { role, content } })

async function fixture(count = 4) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pipilot-search-')))
  const cwd = join(root, 'project'), directory = join(root, 'sessions')
  await Promise.all([mkdir(cwd), mkdir(directory)])
  let available = true
  const resolver = new ConversationScopeResolver({ getLocation: () => available ? { id: scope.workspaceId, name: 'Project', path: cwd } : undefined }, join(root, 'general'))
  const observations = new ObservedPiSessionDirectoryRepository(join(root, 'observed.json'))
  await observations.initialize()
  for (let index = 0; index < count; index++) {
    const entries = [
      { type: 'session', version: 3, id: `session-${index}`, timestamp: `2026-09-29T00:00:0${index}.000Z`, cwd },
      message(`user-${index}`, null, 'user', 'Short unrelated preview'),
      message(`answer-${index}`, `user-${index}`, 'assistant', [{ type: 'text', text: `${'Earlier prose '.repeat(100)}Rare needle [literal] after preview` }, { type: 'thinking', thinking: 'unsearchable-hidden' }, { type: 'image', data: 'unsearchable-image' }]),
    ]
    await writeFile(join(directory, `${index}.jsonl`), entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n')
  }
  await observations.observe(scope, join(directory, '0.jsonl'))
  const catalog = new OfficialPiSessionCatalog(resolver, observations)
  return { root, directory, catalog, service: new ConversationSearchService(catalog), removeProject: () => { available = false } }
}

describe('conversation content search', () => {
  it('matches literal punctuation and preserves Unicode source offsets', () => {
    expect(findTextMatches('😀 Hello [x].* $ and [X].* $', '[x].* $')).toEqual([{ start: 9, length: 7 }, { start: 21, length: 7 }])
    expect(findTextMatches('a\nb', '  ')).toEqual([])
  })

  it('searches only the selected branch and public text, keeping the user response anchor', () => {
    const values = [message('u', null, 'user', 'start'), message('abandoned', 'u', 'assistant', 'needle obsolete'),
      message('a', 'u', 'assistant', [{ type: 'text', text: 'needle current' }, { type: 'thinking', thinking: 'secret needle' }, { type: 'toolCall', arguments: { private: 'needle' } }]),
      message('t', 'a', 'toolResult', [{ type: 'text', text: 'needle result' }, { type: 'image', data: 'needle' }]),
      { type: 'session_info', id: 'name', parentId: 't', name: 'needle title' }]
    const result = searchActiveBranch(values.map(parseSearchEntry).filter((value) => value !== null), 'needle')
    expect(result.hits.map((hit) => [hit.entryId, hit.anchorEntryId, hit.snippet])).toEqual([['a', 'u', 'needle current'], ['t', 'u', 'needle result']])
    const bash = parseSearchEntry({ type: 'message', id: 'bash', parentId: 'u', message: { role: 'bashExecution', command: 'npm test', output: 'needle output' } })!
    expect(searchActiveBranch([parseSearchEntry(values[0])!, bash], 'needle').hits[0].role).toBe('toolResult')
  })

  it('handles a deep branch iteratively and bounds dense results', () => {
    const entries = Array.from({ length: 10_000 }, (_, index) => ({ id: String(index), parentId: index ? String(index - 1) : null, role: index ? 'assistant' as const : 'user' as const, text: 'needle' }))
    expect(searchActiveBranch(entries, 'needle')).toMatchObject({ limited: true, hits: expect.any(Array) })
    expect(searchActiveBranch(entries, 'needle').hits).toHaveLength(100)
    expect(searchActiveBranch([{ id: 'loop', parentId: 'loop', role: 'user', text: 'needle' }], 'needle').hits).toHaveLength(1)
  })

  it('finds streamed transcript text but excludes thinking', () => {
    const result = searchTranscript([{ id: 'u', kind: 'user', text: 'needle question', time: '12:00', anchorEntryId: 'u' },
      { id: 'a', kind: 'agent', markdown: 'needle response', state: 'streaming', anchorEntryId: 'u' },
      { id: 'h', kind: 'thinking', text: 'needle private', state: 'streaming', anchorEntryId: 'u' }], 'needle')
    expect(result.hits.map((hit) => hit.kind)).toEqual(['user', 'assistant'])
  })

  it('retains exact tool identity for targeted disclosure and keeps a visible excerpt for bounded tool views', () => {
    const user = parseSearchEntry(message('u', null, 'user', 'question'))!
    const result = parseSearchEntry({ ...message('result', 'u', 'toolResult', [{ type: 'text', text: 'prefix needle suffix' }]), message: { role: 'toolResult', toolCallId: 'chosen-tool', content: [{ type: 'text', text: 'prefix needle suffix' }] } })!
    expect(searchActiveBranch([user, result], 'needle').hits[0]).toMatchObject({ toolCallId: 'chosen-tool', anchorEntryId: 'u', snippet: 'prefix needle suffix', matchStart: 7, matchLength: 6 })
    const call = { id: 'chosen-tool', kind: 'shell' as const, title: 'bash', status: 'success' as const, body: 'command', output: 'needle result' }
    const hit = searchTranscript([{ id: 'turn', kind: 'tool', call, anchorEntryId: 'u' }], 'needle').hits[0]
    expect(hit.toolCallId).toBe('chosen-tool')
    const request = { sequence: 1, query: 'needle', toolCallId: hit.toolCallId }
    expect(toolMatchesSearch(call, request)).toBe(true)
    expect(toolMatchesSearch({ ...call, id: 'unrelated-tool' }, request)).toBe(false)
    expect(toolMatchesSearch(call, { sequence: 1, query: 'needle' })).toBe(true)
    expect(toolMatchesSearch({ ...call, output: 'different' }, { sequence: 1, query: 'needle' })).toBe(false)
  })

  it('searches full official JSONL text beyond previews, paginates and replays a cursor idempotently', async () => {
    const f = await fixture(7)
    try {
      const first = await f.service.search({ scopes: [scope], query: '[literal]' })
      expect(conversationSearchResultSchema.parse(first).hits).toHaveLength(3)
      expect(first.scanned).toBe(3)
      expect(first.total).toBe(7)
      const second = await f.service.search({ scopes: [scope], query: '[literal]', cursor: first.nextCursor! })
      expect(second.scanned).toBe(6)
      expect(await f.service.search({ scopes: [scope], query: '[literal]', cursor: first.nextCursor! })).toEqual(second)
      const last = await f.service.search({ scopes: [scope], query: '[literal]', cursor: second.nextCursor! })
      expect(last).toMatchObject({ scanned: 7, nextCursor: null, skipped: 0 })
      expect(last.hits).toHaveLength(1)
      await expect(f.service.search({ scopes: [scope], query: 'different', cursor: first.nextCursor! })).rejects.toThrow('expired')
      expect((await f.service.search({ scopes: [scope], query: 'unsearchable' })).hits).toHaveLength(0)
    } finally { await rm(f.root, { recursive: true, force: true }) }
  })

  it('does not read a removed project through an existing cursor', async () => {
    const f = await fixture()
    try {
      const first = await f.service.search({ scopes: [scope], query: 'needle' })
      f.removeProject()
      const next = await f.service.search({ scopes: [scope], query: 'needle', cursor: first.nextCursor! })
      expect(next.hits).toEqual([])
      expect(next.skipped).toBe(1)
    } finally { await rm(f.root, { recursive: true, force: true }) }
  })

  it('rejects replaced files and symlinks after discovery', async () => {
    const f = await fixture()
    try {
      const first = await f.service.search({ scopes: [scope], query: 'needle' })
      const targets = await f.catalog.listSearchTargets(scope)
      const remaining = targets.targets[3].target.sessionFile
      await rename(remaining, `${remaining}.old`)
      await symlink(`${remaining}.old`, remaining)
      const next = await f.service.search({ scopes: [scope], query: 'needle', cursor: first.nextCursor! })
      expect(next.hits).toEqual([])
      expect(next.skipped).toBe(1)
    } finally { await rm(f.root, { recursive: true, force: true }) }
  })
})
