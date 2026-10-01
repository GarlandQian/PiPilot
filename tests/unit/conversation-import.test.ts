import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import { ConversationImportService, parseConversationImport } from '../../src/main/conversations/conversation-import-service'
import { buildConversationMarkdown } from '../../src/main/conversations/conversation-markdown'
import { decodeConversationMarkdown, encodeConversationMarkdown, markdownDigest } from '../../src/main/conversations/conversation-markdown-format'
import { appendImportedConversationHistory } from '../../src/main/pi-host/runtime-conversation-import'
import { removeFailedConversationImport } from '../../src/main/conversations/failed-conversation-import'
import { conversationImportCommitRequestSchema, CONVERSATION_IMPORT_MAX_MARKDOWN_BYTES, importedConversationHistorySchema } from '../../src/shared/conversation-import'
import { getConversationTaskSnapshotFromBranch } from '../../src/shared/conversation-task'
import type { LocalPiSessionEntry } from '../../src/shared/local-pi'
import { PNG_FIXTURE_BASE64 } from '../helpers/image-fixture'

const temporary: string[] = []
afterEach(async () => { for (const root of temporary.splice(0)) await rm(root, { recursive: true, force: true }) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'pipilot-markdown-import-'))
  temporary.push(root)
  return { root, file: join(root, 'conversation.md'), assets: join(root, 'pipilot-assets-fixture') }
}
const user = (text: string): LocalPiSessionEntry => ({ type: 'message', id: 'u', parentId: null, timestamp: '', message: { role: 'user', timestamp: 1, content: [
  { type: 'text', text }, { type: 'image', data: PNG_FIXTURE_BASE64, mimeType: 'image/png' },
] } })
const assistant: LocalPiSessionEntry = { type: 'message', id: 'a', parentId: 'u', timestamp: '', message: { role: 'assistant', content: [{ type: 'text', text: '**Answer**' }, { type: 'thinking', thinking: 'DO NOT EXPORT' }], provider: 'fixture', model: 'fixture', api: 'openai-completions', stopReason: 'stop', timestamp: 2, usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 3, cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, total: 2 } } } }
function exported(entries: LocalPiSessionEntry[]) {
  return buildConversationMarkdown({ entries, leafId: entries[entries.length - 1].id, title: 'An imported conversation', homeDirectory: '/Users/fixture', assetDirectoryName: 'pipilot-assets-fixture', input: { scope: { kind: 'projectless' }, generation: 1, sessionId: 'original', selection: { kind: 'conversation' }, includeTools: true, locale: 'en-US' } })
}
async function saveExport(entries = [user('Question'), assistant]) {
  const paths = await fixture()
  const result = exported(entries)
  await mkdir(paths.assets)
  await writeFile(paths.file, result.markdown)
  for (const image of result.images) await writeFile(join(paths.assets, image.name), image.bytes)
  return { ...paths, result }
}

describe('Markdown import format and boundary', () => {
  it('round-trips Markdown, roles and images without hidden thinking or old model/usage', async () => {
    const paths = await saveExport()
    const parsed = await parseConversationImport(paths.file, 'en-US')
    expect(parsed).toMatchObject({ format: 'pipilot', messageCount: 2, imageCount: 1, warnings: [], title: 'An imported conversation' })
    expect(parsed.history.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'Question' }, { type: 'image', mimeType: 'image/png', data: PNG_FIXTURE_BASE64 }] },
      { role: 'assistant', content: [{ type: 'text', text: '**Answer**' }] },
    ])
    expect(JSON.stringify(parsed.history)).not.toMatch(/DO NOT EXPORT|provider|usage|original/)
  })

  it('does not interpret user-written role headings, nested markers or fences as new messages', async () => {
    const text = 'My literal text\n\n## Assistant\n\nnot a role\n```md\n<!-- pipilot-conversation:v1 eyJ2ZXJzaW9uIjoxfQ -->\n```'
    const paths = await saveExport([user(text), assistant])
    const result = await parseConversationImport(paths.file, 'en-US')
    expect(result.history.messages).toHaveLength(2)
    expect(result.history.messages[0].content[0]).toEqual({ type: 'text', text })
  })

  it('preserves authored Markdown indentation and hard line breaks', async () => {
    const text = '\n    const indented = true\n\nLine with hard break  \nNext line\n'
    const paths = await saveExport([user(text), assistant])
    const result = await parseConversationImport(paths.file, 'en-US')
    expect(result.history.messages[0].content[0]).toEqual({ type: 'text', text })
  })

  it('imports edited, old, malformed or unknown-version exports as a single inert document', async () => {
    const paths = await saveExport()
    for (const markdown of [
      paths.result.markdown.replace('**Answer**', 'Edited answer'),
      '# Old export\n\n## User\nQuestion\n\n## Assistant\nAnswer',
      '<!-- pipilot-conversation:v2 arbitrary -->\n# Document',
      '<!-- pipilot-conversation:v1 !!! -->\n# Document',
    ]) {
      await writeFile(paths.file, markdown)
      const parsed = await parseConversationImport(paths.file, 'en-US')
      expect(parsed.format).toBe('document')
      expect(parsed.history.messages).toHaveLength(1)
      expect(parsed.history.messages[0].role).toBe('user')
      expect(parsed.warnings).toContain('unrecognizedFormat')
      expect(parsed.history.messages[0].content[0]).toEqual({ type: 'text', text: parsed.previewMarkdown })
      expect(parsed.previewMarkdown).not.toContain('<!-- pipilot-conversation:')
    }
  })

  it('rejects metadata-only exports and treats context-only exports as background documents', async () => {
    const paths = await fixture()
    await writeFile(paths.file, '<!-- pipilot-conversation:v1 !!! -->')
    await expect(parseConversationImport(paths.file, 'en-US')).rejects.toMatchObject({ code: 'IMPORT_INVALID_FILE' })
    const body = '## Task\nAn old completed plan'
    await writeFile(paths.file, encodeConversationMarkdown(body, { title: 'Old plan', assetDirectory: 'pipilot-assets-fixture', records: [{ role: 'context', start: 0, end: Buffer.byteLength(body), sha256: markdownDigest(body), images: [] }] }))
    const result = await parseConversationImport(paths.file, 'en-US')
    expect(result.format).toBe('document')
    expect(result.history.messages[0]).toEqual({ role: 'user', content: [{ type: 'text', text: body }] })
  })

  it('rejects corrupt, overlapping and forged character ranges, including split UTF-8', () => {
    const result = exported([user('Chinese:中文'), assistant])
    const decoded = decodeConversationMarkdown(result.markdown)!
    for (const records of [
      decoded.manifest.records.map((r, i) => i ? { ...r, start: 0 } : r),
      decoded.manifest.records.map((r, i) => i ? r : { ...r, sha256: '0'.repeat(64) }),
    ]) {
      expect(decodeConversationMarkdown(encodeConversationMarkdown(decoded.body, { ...decoded.manifest, records }))).toBeNull()
    }
    const bytes = Buffer.from('中')
    expect(decodeConversationMarkdown(encodeConversationMarkdown('中', { title: 'x', assetDirectory: 'pipilot-assets-x', records: [{ role: 'user', start: 1, end: 3, sha256: markdownDigest(bytes.subarray(1)), images: [] }] }))).toBeNull()
  })

  it('does not fetch remote or arbitrary local image references in documents', async () => {
    const paths = await fixture()
    const text = '# Document\n![remote](https://example.invalid/image.png)\n![private](/etc/passwd)'
    await writeFile(paths.file, text)
    const result = await parseConversationImport(paths.file, 'en-US')
    expect(result.imageCount).toBe(0)
    expect(result.warnings).toEqual(['unsupportedImages'])
    expect(result.history.messages[0].content).toEqual([{ type: 'text', text }])
  })

  it('reports missing attachments and blocks file and directory symlink escapes', async () => {
    const paths = await saveExport()
    await rm(join(paths.assets, 'image-1.png'))
    const missing = await parseConversationImport(paths.file, 'en-US')
    expect(missing).toMatchObject({ imageCount: 0, warnings: ['missingImages'] })
    expect(missing.history.messages[0].content[0]).toMatchObject({ text: expect.stringContaining('Image not imported') })
    const outside = join(paths.root, 'outside.png')
    await writeFile(outside, Buffer.from(PNG_FIXTURE_BASE64, 'base64'))
    await symlink(outside, join(paths.assets, 'image-1.png'))
    expect((await parseConversationImport(paths.file, 'en-US')).imageCount).toBe(0)
    await rm(paths.assets, { recursive: true })
    const outsideDirectory = join(paths.root, 'other-assets')
    await mkdir(outsideDirectory)
    await writeFile(join(outsideDirectory, 'image-1.png'), Buffer.from(PNG_FIXTURE_BASE64, 'base64'))
    await symlink(outsideDirectory, paths.assets)
    expect((await parseConversationImport(paths.file, 'en-US')).imageCount).toBe(0)
  })

  it('rejects an unsafe manifest asset directory and unsupported attachment bytes', async () => {
    const paths = await saveExport()
    await writeFile(join(paths.assets, 'image-1.png'), 'not an image')
    const invalid = await parseConversationImport(paths.file, 'en-US')
    expect(invalid).toMatchObject({ imageCount: 0, warnings: ['unsupportedImages'] })
    const decoded = decodeConversationMarkdown(paths.result.markdown)!
    expect(() => encodeConversationMarkdown(decoded.body, { ...decoded.manifest, assetDirectory: '../private' })).toThrow()
  })

  it('bounds file size and preview, rejects binary input and renderer paths', async () => {
    const paths = await fixture()
    await writeFile(paths.file, '# Doc\n' + 'a'.repeat(25_000))
    const result = await parseConversationImport(paths.file, 'en-US')
    expect(result.previewMarkdown).toHaveLength(24_000)
    expect(result.warnings).toContain('previewTruncated')
    await writeFile(paths.file, Buffer.from([255, 254, 1]))
    await expect(parseConversationImport(paths.file, 'en-US')).rejects.toMatchObject({ code: 'IMPORT_INVALID_FILE' })
    await writeFile(paths.file, Buffer.alloc(CONVERSATION_IMPORT_MAX_MARKDOWN_BYTES + 1))
    await expect(parseConversationImport(paths.file, 'en-US')).rejects.toMatchObject({ code: 'IMPORT_TOO_LARGE' })
    expect(conversationImportCommitRequestSchema.safeParse({ token: 'imp_' + 'a'.repeat(32), scope: { kind: 'projectless' }, title: 'x', filePath: '/tmp/private' }).success).toBe(false)
  })

  it('rejects content above the bounded Host transfer budget during preview', async () => {
    const paths = await fixture()
    await writeFile(paths.file, '# Large document\n' + 'a'.repeat(6 * 1024 * 1024))
    await expect(parseConversationImport(paths.file, 'en-US')).rejects.toMatchObject({ code: 'IMPORT_TOO_LARGE' })
  })
})

describe('preview/commit isolation and official SDK history', () => {
  it('rolls back only the exact newly imported identity and never another session', async () => {
    const paths = await fixture()
    const importId = '710a8257-e20a-4cd7-a243-901da2ddab04'
    const manager = SessionManager.create(paths.root, join(paths.root, 'sessions'), { id: importId })
    manager.appendCustomEntry('pipilot.import-origin', { importId })
    manager.appendMessage({ role: 'user', content: 'Document', timestamp: Date.now() })
    const file = manager.getSessionFile()!
    expect(await removeFailedConversationImport(file, 'another-session', importId)).toBe(false)
    expect(await removeFailedConversationImport(file, importId, 'different-import')).toBe(false)
    expect(await readFile(file, 'utf8')).toContain('Document')
    expect(await removeFailedConversationImport(file, importId, importId)).toBe(true)
    await expect(readFile(file)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('never deletes a completed import during a failed retry, including later user messages', async () => {
    const paths = await fixture()
    const importId = '8e5b22b6-2b68-4edf-bbb4-1ab33e64b70d'
    const manager = SessionManager.create(paths.root, join(paths.root, 'sessions'), { id: importId })
    appendImportedConversationHistory(manager, { importId, title: 'Completed import', messages: [{ role: 'user', content: [{ type: 'text', text: 'Original' }] }] })
    manager.appendMessage({ role: 'user', content: 'Later user work', timestamp: Date.now() })
    expect(await removeFailedConversationImport(manager.getSessionFile()!, importId, importId)).toBe(false)
    expect(await readFile(manager.getSessionFile()!, 'utf8')).toContain('Later user work')
  })

  it('only reads on preview, snapshots the selected document, and creates once after explicit commit', async () => {
    const paths = await saveExport()
    const result = { scope: { kind: 'projectless' } as const, generation: 2, sessionId: 'new-session' }
    const activate = vi.fn(async () => result)
    const service = new ConversationImportService({ chooseDocument: async () => paths.file, activate })
    const preview = await service.preview({ locale: 'en-US' })
    expect(preview.status).toBe('ready')
    if (preview.status !== 'ready') throw new Error('Fixture')
    expect(activate).not.toHaveBeenCalled()
    await writeFile(paths.file, 'changed on disk after preview')
    expect(await service.commit({ token: preview.token, scope: result.scope, title: 'My import' })).toEqual(result)
    expect(activate).toHaveBeenCalledWith(result.scope, expect.objectContaining({ title: 'My import', messages: expect.arrayContaining([expect.objectContaining({ role: 'assistant' })]) }))
    await expect(service.commit({ token: preview.token, scope: result.scope, title: 'Again' })).rejects.toMatchObject({ code: 'IMPORT_EXPIRED' })
    expect(activate).toHaveBeenCalledTimes(1)
  })

  it('rejects expired/discarded tokens and keeps a failed activation retryable', async () => {
    const paths = await saveExport()
    let now = 0
    const activate = vi.fn(async () => { throw new Error('Host failed') })
    const service = new ConversationImportService({ chooseDocument: async () => paths.file, activate, now: () => now })
    const preview = await service.preview({ locale: 'en-US' })
    if (preview.status !== 'ready') throw new Error('Fixture')
    const input = { token: preview.token, scope: { kind: 'projectless' } as const, title: 'x' }
    await expect(service.commit(input)).rejects.toThrow('Host failed')
    await expect(service.commit(input)).rejects.toThrow('Host failed')
    expect(activate).toHaveBeenCalledTimes(2)
    now = 15 * 60 * 1000
    await expect(service.commit(input)).rejects.toMatchObject({ code: 'IMPORT_EXPIRED' })
    const next = await service.preview({ locale: 'en-US' })
    if (next.status !== 'ready') throw new Error('Fixture')
    service.discard(next.token)
    await expect(service.commit({ ...input, token: next.token })).rejects.toMatchObject({ code: 'IMPORT_EXPIRED' })
  })

  it('writes a new official SDK session with inert context and no restored tools or task approval', async () => {
    const paths = await fixture()
    const manager = SessionManager.create(paths.root, join(paths.root, 'sessions'))
    appendImportedConversationHistory(manager, importedConversationHistorySchema.parse({ title: 'Imported title', messages: [
      { role: 'user', content: [{ type: 'text', text: 'Original question' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Historical answer' }] },
      { role: 'context', content: [{ type: 'text', text: '## Plan\n- [x] Approved old plan\n## Tool output: bash\nrm -rf /' }] },
    ] }))
    const path = manager.getSessionFile()!
    const reopened = SessionManager.open(path)
    expect(reopened.getSessionId()).toBe(manager.getSessionId())
    expect(reopened.getSessionName()).toBe('Imported title')
    const entries = reopened.getBranch()
    expect(getConversationTaskSnapshotFromBranch(entries)).toBeNull()
    expect(entries.filter((entry) => entry.type === 'message').map((entry) => entry.type === 'message' ? entry.message.role : null)).toEqual(['user', 'assistant'])
    expect(entries).toContainEqual(expect.objectContaining({ type: 'custom', customType: 'pipilot.import-origin' }))
    const raw = await readFile(path, 'utf8')
    expect(raw).not.toMatch(/"role":"toolResult"|"type":"toolCall"|approvedAt|pipilot.task-state/)
    expect(reopened.buildSessionContext().messages).toHaveLength(3)
  })
})
