import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildConversationMarkdown, conversationExportBranch } from '../../src/main/conversations/conversation-markdown'
import { ConversationExportService } from '../../src/main/conversations/conversation-export-service'
import { conversationExportRequestSchema, type ConversationExportRequest } from '../../src/shared/conversation-export'
import { conversationExportContract } from '../../src/shared/ipc/conversation-export-contracts'
import { createValidatedInvokeHandler } from '../../src/main/ipc/validated-invoke'
import { localPiSessionEntrySchema, type LocalPiAgentMessage, type LocalPiRpcResponse, type LocalPiRuntimeSnapshot, type LocalPiSessionEntry } from '../../src/shared/local-pi'
import type { PiRuntimeSelectionIdentity } from '../../src/main/pi-host/pi-runtime-frontend'
import type { IpcMainInvokeEvent } from 'electron'
import { PNG_FIXTURE_BASE64 } from '../helpers/image-fixture'
import { createConversationPlanKickoff } from '../../src/shared/conversation-task'

const input: Extract<ConversationExportRequest, { generation: number }> = {
  scope: { kind: 'projectless' }, generation: 2, sessionId: 'session-a',
  selection: { kind: 'conversation' }, includeTools: false, locale: 'en-US',
}
const entry = (id: string, parentId: string | null, message: LocalPiAgentMessage): LocalPiSessionEntry =>
  ({ type: 'message', id, parentId, timestamp: '2026-10-01T01:00:00.000Z', message })
const user = (id: string, parentId: string | null, content: string) => entry(id, parentId, { role: 'user', content, timestamp: 1 })
const assistant = (id: string, parentId: string | null, text: string) => localPiSessionEntrySchema.parse({
  type: 'message', id, parentId, timestamp: '2026-10-01T01:00:01.000Z', message: {
    role: 'assistant', content: [{ type: 'thinking', thinking: 'private-chain-of-thought' }, { type: 'text', text }],
    api: 'openai-responses', provider: 'fixture', model: 'fixture', stopReason: 'stop', timestamp: 2,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  },
})
const imageUser = entry('u', null, { role: 'user', content: [
  { type: 'text', text: 'Describe **this**' }, { type: 'image', mimeType: 'image/png', data: PNG_FIXTURE_BASE64 },
], timestamp: 1 })
function markdown(entries: LocalPiSessionEntry[], overrides: Partial<Extract<ConversationExportRequest, { generation: number }>> = {}, leafId = entries[entries.length - 1]?.id ?? null) {
  return buildConversationMarkdown({ entries, leafId, input: { ...input, ...overrides }, title: 'Fixture', homeDirectory: '/Users/fixture', assetDirectoryName: 'images' })
}

describe('conversation Markdown export', () => {
  it('exports a localized plan action instead of internal kickoff instructions', () => {
    const text = createConversationPlanKickoff({ title: 'Build the feature', id: 'plan-1' }, '325bb64b-1779-4163-b44c-9179e8092a26')
    const entries = [user('u', null, text)]
    expect(markdown(entries).markdown).toContain('Continue approved plan: Build the feature')
    expect(markdown(entries, { locale: 'zh-CN' }).markdown).toContain('继续已批准的计划：Build the feature')
    expect(markdown(entries).markdown).not.toMatch(/pipilot_update_task|325bb64b|plan-1/)
  })
  it('exports the active branch including pre-compaction messages, without hidden context', () => {
    const entries: LocalPiSessionEntry[] = [
      entry('system', null, { role: 'system', content: 'private system instruction', timestamp: 0 }),
      user('u', 'system', '# Question'), assistant('old-fork', 'u', 'Abandoned answer'), assistant('a', 'u', '**Current** answer [output](report.md)'),
      { type: 'compaction', id: 'c', parentId: 'a', timestamp: '', summary: 'private summary', firstKeptEntryId: 'a', tokensBefore: 100 },
      user('u2', 'c', 'Follow-up'), assistant('a2', 'u2', 'Later answer'),
    ]
    const result = markdown(entries).markdown
    expect(result).toContain('# Question')
    expect(result).toContain('**Current** answer [output](report.md)')
    expect(result).toContain('Later answer')
    expect(result).not.toMatch(/private|Abandoned/)
  })

  it('selects one full response round or one message and rejects foreign anchors', () => {
    const entries = [user('u', null, 'First question'), assistant('a', 'u', 'First answer'), user('u2', 'a', 'Second question'), assistant('a2', 'u2', 'Second answer')]
    const round = markdown(entries, { selection: { kind: 'response', anchorEntryId: 'u' } }).markdown
    expect(round).toContain('First question')
    expect(round).toContain('First answer')
    expect(round).not.toContain('Second')
    const single = markdown(entries, { selection: { kind: 'message', entryId: 'a' } }).markdown
    expect(single).toContain('First answer')
    expect(single).not.toContain('question')
    expect(() => markdown(entries, { selection: { kind: 'response', anchorEntryId: 'foreign' } })).toThrow('active conversation branch')
  })

  it('applies the latest context edits and never resurrects deleted content', () => {
    const entries: LocalPiSessionEntry[] = [user('u', null, 'Old prompt'), assistant('a', 'u', 'Deleted answer'),
      { type: 'context_edit', id: 'e1', parentId: 'a', timestamp: '', targetId: 'u', replacement: { content: 'Corrected prompt' } },
      { type: 'context_edit', id: 'e2', parentId: 'e1', timestamp: '', targetId: 'a', replacement: null }]
    const result = markdown(entries).markdown
    expect(result).toContain('Corrected prompt')
    expect(result).not.toMatch(/Old prompt|Deleted answer/)
  })

  it('exports optional tool output, visible notices and real plan evidence', () => {
    const entries: LocalPiSessionEntry[] = [user('u', null, 'Question'),
      entry('t', 'u', { role: 'toolResult', toolName: 'bash', toolCallId: 'call', content: [{ type: 'text', text: '``` nested tool output' }], isError: false, timestamp: 2 }),
      { type: 'custom_message', id: 'notice', parentId: 't', timestamp: '', customType: 'notice', content: 'Visible notice', display: true },
      { type: 'custom_message', id: 'hidden', parentId: 'notice', timestamp: '', customType: 'internal', content: 'Hidden notice', display: false },
      { type: 'custom', id: 'task', parentId: 'hidden', timestamp: '', customType: 'pipilot.task-state', data: {
        version: 1, updatedAt: 1, summary: 'Implementation complete', blockers: [], nextActions: [],
        plan: { id: 'plan', title: 'Implement', approvedAt: 0, status: 'completed', steps: [{ id: 'step', title: 'Build', status: 'completed', evidence: 'Test passed [report](report.md)' }] },
      } }]
    expect(markdown(entries).markdown).not.toContain('nested tool output')
    const result = markdown(entries, { includeTools: true }).markdown
    expect(result).toContain('````text\n``` nested tool output\n````')
    expect(result).toContain('Visible notice')
    expect(result).not.toContain('Hidden notice')
    expect(result).toContain('- [x] Build (completed) — Test passed [report](report.md)')
  })

  it('extracts image attachments, preserves Markdown and shortens home paths', () => {
    const result = markdown([imageUser, assistant('a', 'u', 'See /Users/fixture/Documents/a.md and C:\\Users\\Someone\\b.md')])
    expect(result.markdown).toContain('![Image 1](images/image-1.png)')
    expect(result.markdown).not.toContain(PNG_FIXTURE_BASE64)
    expect(result.images[0].bytes.equals(Buffer.from(PNG_FIXTURE_BASE64, 'base64'))).toBe(true)
    expect(result.markdown).toContain('~/Documents/a.md')
    expect(result.markdown).toContain('~\\b.md')
  })

  it('removes expanded skill instructions but keeps the actual question', () => {
    const text = '<skill name="example" location="/private/SKILL.md">\nPrivate instruction\n```xml\n</skill>\n```\n</skill>\n\nActual question'
    const result = markdown([user('u', null, text)]).markdown
    expect(result).toContain('Actual question')
    expect(result).not.toContain('Private instruction')
  })

  it('handles long branches iteratively and rejects incomplete or cyclic history', () => {
    const entries = Array.from({ length: 10_000 }, (_, index) => user(String(index), index ? String(index - 1) : null, 'text'))
    expect(conversationExportBranch(entries, '9999')).toHaveLength(10_000)
    expect(() => conversationExportBranch([user('u', 'missing', '')], 'u')).toThrow('unavailable')
    expect(() => conversationExportBranch([user('u', 'u', '')], 'u')).toThrow('unavailable')
    expect(() => conversationExportBranch([entries[0], entries[0]], '0')).toThrow('inconsistent')
  })

  it('rejects renderer-supplied file paths and transcript bodies at the IPC boundary', async () => {
    expect(conversationExportRequestSchema.safeParse({ ...input, destination: '/secret', markdown: 'arbitrary' }).success).toBe(false)
    const handler = vi.fn()
    const invoke = createValidatedInvokeHandler(conversationExportContract, () => false, handler)
    const result = await invoke({} as IpcMainInvokeEvent, { context: { requestId: '00000000-0000-4000-8000-000000000001' }, input })
    expect(result).toMatchObject({ ok: false, error: { code: 'IPC_UNTRUSTED_SENDER' } })
    expect(handler).not.toHaveBeenCalled()
  })
})

const temporaryDirectories: string[] = []
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function serviceFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'pipilot-export-test-'))
  temporaryDirectories.push(directory)
  let identity: PiRuntimeSelectionIdentity = { runtimeId: 'runtime', generation: 2, selectionRevision: 1, scope: input.scope, sessionId: 'session-a', sessionFile: '/isolated/session.jsonl' }
  const snapshot: LocalPiRuntimeSnapshot = {
    state: 'ready', generation: 2, cwd: directory, sessionFile: identity.sessionFile, commands: [], stderr: '', diagnostics: [],
    sessionState: { sessionId: 'session-a', sessionName: 'Export fixture', thinkingLevel: 'medium', isStreaming: false, isCompacting: false,
      steeringMode: 'one-at-a-time', followUpMode: 'one-at-a-time', autoCompactionEnabled: true, messageCount: 1, pendingMessageCount: 0 },
  }
  const runtime = {
    getActiveRuntimeIdentity: () => ({ ...identity }),
    getSnapshot: () => snapshot,
    request: vi.fn(async (): Promise<LocalPiRpcResponse> => ({ type: 'response', command: 'get_entries', success: true, data: { entries: [imageUser], leafId: 'u' } })),
  }
  const destination = join(directory, 'conversation.md')
  const chooseDestination = vi.fn(async (_defaultName: string, _locale: ConversationExportRequest['locale']): Promise<string | null> => destination)
  const service = new ConversationExportService({ runtime, chooseDestination, homeDirectory: '/Users/fixture' })
  return { directory, runtime, chooseDestination, destination, service,
    changeSelection: () => { identity = { ...identity, selectionRevision: identity.selectionRevision + 1 } } }
}

describe('authoritative Markdown save', () => {
  it('saves a document plus adjacent images and leaves no staging files', async () => {
    const f = await serviceFixture()
    await expect(f.service.save(input)).resolves.toEqual({ status: 'saved', fileName: 'conversation.md', imageCount: 1 })
    expect(f.runtime.request).toHaveBeenCalledWith({ type: 'get_entries' })
    const files = await readdir(f.directory)
    expect(files).toHaveLength(2)
    const assets = files.find((name) => name.startsWith('pipilot-assets-'))!
    expect(await readdir(join(f.directory, assets))).toEqual(['image-1.png'])
    expect(await readFile(f.destination, 'utf8')).toContain(`](${assets}/image-1.png)`)
  })

  it('cancels without writing and refuses a conversation changed during the native dialog', async () => {
    const f = await serviceFixture()
    f.chooseDestination.mockResolvedValueOnce(null)
    await expect(f.service.save(input)).resolves.toEqual({ status: 'cancelled' })
    expect(await readdir(f.directory)).toEqual([])
    f.chooseDestination.mockImplementationOnce(async () => { f.changeSelection(); return f.destination })
    await expect(f.service.save(input)).rejects.toMatchObject({ code: 'EXPORT_STALE_SESSION' })
    expect(await readdir(f.directory)).toEqual([])
  })

  it('rejects stale read results before opening the native save dialog', async () => {
    const f = await serviceFixture()
    f.runtime.request.mockImplementationOnce(async () => {
      f.changeSelection()
      return { type: 'response', command: 'get_entries', success: true, data: { entries: [imageUser], leafId: 'u' } }
    })
    await expect(f.service.save(input)).rejects.toMatchObject({ code: 'EXPORT_STALE_SESSION' })
    expect(f.chooseDestination).not.toHaveBeenCalled()
  })

  it('prevents overlapping save dialogs and safely replaces a user-selected existing document', async () => {
    const f = await serviceFixture()
    await writeFile(f.destination, 'old content')
    let finish!: (path: string) => void
    f.chooseDestination.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const first = f.service.save(input)
    await vi.waitFor(() => expect(f.chooseDestination).toHaveBeenCalledTimes(1))
    await expect(f.service.save(input)).rejects.toMatchObject({ code: 'EXPORT_BUSY' })
    finish(f.destination)
    await expect(first).resolves.toMatchObject({ status: 'saved' })
    expect(await readFile(f.destination, 'utf8')).not.toBe('old content')
  })

  it('writes only the exact path approved by the native dialog', async () => {
    const f = await serviceFixture()
    const chosen = join(f.directory, 'no-extension')
    await writeFile(`${chosen}.md`, 'unrelated document')
    f.chooseDestination.mockResolvedValueOnce(chosen)
    await expect(f.service.save(input)).resolves.toMatchObject({ status: 'saved', fileName: 'no-extension' })
    expect(await readFile(`${chosen}.md`, 'utf8')).toBe('unrelated document')
    expect(await readFile(chosen, 'utf8')).toContain('# Export fixture')
  })
})
