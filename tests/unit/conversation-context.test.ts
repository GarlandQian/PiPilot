import { describe, expect, it } from 'vitest'
import { projectConversationContext } from '../../src/renderer/pi-rpc/conversation-context'
import { createTranscriptStore } from '../../src/renderer/pi-rpc/transcript-store'
import { appendLocalPiEntryEvent, canAppendLocalPiEntry, mergeLocalPiEntrySnapshot } from '../../src/renderer/pi-rpc/response-provenance'
import { CONVERSATION_TASK_CUSTOM_TYPE } from '../../src/shared/conversation-task'
import type { LocalPiAgentMessage, LocalPiSessionEntry, LocalPiSlashCommand } from '../../src/shared/local-pi'

const assistant = (content: Extract<LocalPiAgentMessage, { role: 'assistant' }>['content']): LocalPiAgentMessage => ({
  role: 'assistant', content, timestamp: 1, api: 'openai-completions', provider: 'fixture', model: 'fixture', stopReason: 'toolUse',
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
})
const message = (id: string, parentId: string | null, value: LocalPiAgentMessage): LocalPiSessionEntry => ({ id, parentId, timestamp: '2026-10-01T00:00:00Z', type: 'message', message: value })
const user = (text = 'Work on the project') => message('user', null, { role: 'user', content: text, timestamp: 0 })
function tool(id: string, parent: string, name: string, args: Record<string, unknown>, error = false): LocalPiSessionEntry[] {
  return [message(id, parent, assistant([{ type: 'toolCall', id, name, arguments: args }])), message(`${id}-result`, id, {
    role: 'toolResult', toolCallId: id, toolName: name, content: [{ type: 'text', text: 'Arbitrary output mentions fake-output.md' }], isError: error, timestamp: 2,
  })]
}

describe('conversation context evidence', () => {
  it('records only successful file actions on the selected branch, with navigable response anchors', () => {
    const entries = [user(), ...tool('read', 'user', 'read', { path: 'input.md' }), ...tool('write', 'read-result', 'write', { path: 'output.md' }),
      ...tool('failed', 'write-result', 'edit', { path: 'failed.md' }, true), ...tool('ls', 'failed-result', 'ls', { path: '.' }),
      ...tool('abandoned', 'user', 'write', { path: 'other-branch.md' })]
    const view = projectConversationContext(entries, 'ls-result', [])
    expect(view.sources).toEqual([{ path: 'input.md', entryId: 'user', action: 'read' }])
    expect(view.outputs).toEqual([{ path: 'output.md', entryId: 'user', action: 'write' }])
    expect(projectConversationContext(entries, 'missing', []).valid).toBe(false)
  })

  it('handles successful nested calls without calling a failed parent or unfinished call successful', () => {
    const entries = [user(), ...tool('code', 'user', 'codemode', { code: 'fixture' }, true)]
    const result = entries[2]!
    if (result.type !== 'message' || result.message.role !== 'toolResult') throw new Error('fixture')
    result.message.nestedCalls = { complete: false, calls: [
      { id: '1', name: 'mcp__docs__search', status: 'ok' },
      { id: '2', name: 'read', arguments: { path: 'nested.md' }, status: 'ok' },
      { id: '3', name: 'mcp__docs__fetch', status: 'unfinished' },
      { id: '4', name: 'write', arguments: { path: 'bad.md' }, status: 'error' },
    ] }
    const view = projectConversationContext(entries, 'code-result', [])
    expect(view.capabilities).toEqual([{ name: 'docs / search', kind: 'mcp', entryId: 'user' }])
    expect(view.sources[0]?.path).toBe('nested.md')
    expect(view.outputs).toEqual([])
  })

  it.each(['read_mcp_resource', 'list_mcp_resources', 'list_mcp_resource_templates'])(
    'records successful native %s against the invoking response and official server', (name) => {
      const entries = [user(), message('next-user', 'user', { role: 'user', content: 'Read the docs', timestamp: 1 }),
        ...tool('resource', 'next-user', name, { server: ' docs ', uri: 'docs://guide' })]
      const result = entries[3]!
      if (result.type !== 'message' || result.message.role !== 'toolResult') throw new Error('fixture')
      result.message.details = { server: 'docs', tool: name }
      expect(projectConversationContext(entries, 'resource-result', []).capabilities).toEqual([
        { name: `docs / ${name}`, kind: 'mcp', entryId: 'next-user' },
      ])
      expect(projectConversationContext(entries, 'user', []).capabilities).toEqual([])
      result.message.isError = true
      expect(projectConversationContext(entries, 'resource-result', []).capabilities).toEqual([])
    },
  )

  it('accepts an official resource result server while rejecting mismatched or unknown provenance', () => {
    const entries = [user(), ...tool('resource', 'user', 'read_mcp_resource', { uri: 'docs://guide' })]
    const result = entries[2]!
    if (result.type !== 'message' || result.message.role !== 'toolResult') throw new Error('fixture')
    result.message.details = { server: 'docs', tool: 'read_mcp_resource' }
    expect(projectConversationContext(entries, 'resource-result', []).capabilities).toEqual([
      { name: 'docs / read_mcp_resource', kind: 'mcp', entryId: 'user' },
    ])
    result.message.details = { server: 'docs', tool: 'unrelated_tool' }
    expect(projectConversationContext(entries, 'resource-result', []).capabilities).toEqual([])
    const requested = entries[1]!
    if (requested.type !== 'message' || requested.message.role !== 'assistant') throw new Error('fixture')
    requested.message.content = [{ type: 'toolCall', id: 'resource', name: 'read_mcp_resource', arguments: { server: 'other', uri: 'other://guide' } }]
    result.message.details = { server: 'docs', tool: 'read_mcp_resource' }
    expect(projectConversationContext(entries, 'resource-result', []).capabilities).toEqual([])
    const listing = [user(), ...tool('list', 'user', 'list_mcp_resources', {})]
    const listResult = listing[2]!
    if (listResult.type !== 'message' || listResult.message.role !== 'toolResult') throw new Error('fixture')
    listResult.message.details = { server: '', tool: 'list_mcp_resources' }
    listResult.message.content = [{ type: 'text', text: '{"errors":[{"server":"failed-server","error":"unavailable"}]}' }]
    expect(projectConversationContext(listing, 'list-result', []).capabilities).toEqual([])
  })

  it('retains native resource calls with known servers inside a failed codemode parent, excluding errors and unfinished calls', () => {
    const entries = [user(), ...tool('code', 'user', 'codemode', { code: 'fixture' }, true)]
    const result = entries[2]!
    if (result.type !== 'message' || result.message.role !== 'toolResult') throw new Error('fixture')
    result.message.nestedCalls = { complete: false, calls: [
      { id: '1', name: 'read_mcp_resource', arguments: { server: 'docs', uri: 'docs://guide' }, status: 'ok' },
      { id: '2', name: 'list_mcp_resources', arguments: { server: 'docs' }, status: 'ok' },
      { id: '3', name: 'list_mcp_resource_templates', arguments: { server: 'docs' }, status: 'ok' },
      { id: '4', name: 'read_mcp_resource', arguments: { server: 'failed' }, status: 'error' },
      { id: '5', name: 'read_mcp_resource', arguments: { server: 'unfinished' }, status: 'unfinished' },
      { id: '6', name: 'list_mcp_resources', status: 'ok' },
      { id: '7', name: 'list_mcp_resource_templates', arguments: { server: ' ' }, status: 'ok' },
    ] }
    expect(projectConversationContext(entries, 'code-result', []).capabilities).toEqual([
      { name: 'docs / list_mcp_resource_templates', kind: 'mcp', entryId: 'user' },
      { name: 'docs / list_mcp_resources', kind: 'mcp', entryId: 'user' },
      { name: 'docs / read_mcp_resource', kind: 'mcp', entryId: 'user' },
    ])
  })

  it('keeps available skills separate from invoked skills and ignores hidden thinking, removed text, and credential URLs', () => {
    const skill: LocalPiSlashCommand = { name: 'skill:review', source: 'skill', sourceInfo: { path: '/fixture/review.md', source: 'fixture', scope: 'project', origin: 'top-level' } }
    const entries = [user('<skill name="review" location="/fixture/review.md">\nInstructions https://hidden.example\n</skill>\n\nReview https://public.example/doc'),
      message('answer', 'user', assistant([{ type: 'thinking', thinking: 'https://thinking.example' }, { type: 'text', text: 'https://old.example https://user:password@secret.example' }])),
      { type: 'context_edit' as const, id: 'edit', parentId: 'answer', timestamp: '2026-10-01T00:00:00Z', targetId: 'answer', replacement: { content: 'See https://new.example.' } }]
    const view = projectConversationContext(entries, 'edit', [skill, { ...skill, name: 'unused' }])
    expect(view.capabilities).toEqual([{ name: 'review', kind: 'skill', entryId: 'user' }, { name: 'unused', kind: 'skill' }])
    expect(view.links).toEqual([{ url: 'https://new.example/', entryId: 'user' }, { url: 'https://public.example/doc', entryId: 'user' }])
  })

  it('never replays suggestions from before a newer user prompt', () => {
    const task: LocalPiSessionEntry = { type: 'custom', id: 'task', parentId: 'user', timestamp: '2026-10-01T00:00:00Z', customType: CONVERSATION_TASK_CUSTOM_TYPE,
      data: { version: 1, updatedAt: 1, summary: 'Summary', plan: null, blockers: [], nextActions: [{ id: 'next', label: 'Next', prompt: 'Continue' }] } }
    const entries = [user(), task, message('new-user', 'task', { role: 'user', content: 'Change direction', timestamp: 2 })]
    expect(projectConversationContext(entries, 'task', []).suggestionsCurrent).toBe(true)
    expect(projectConversationContext(entries, 'new-user', []).suggestionsCurrent).toBe(false)
  })

  it('keeps the durable entry selector stable across streaming updates and clears it on session reset', () => {
    const entries = { generation: 1, sessionId: 'session', entries: [user()], leafId: 'user', cursor: 'user' }
    const store = createTranscriptStore({ turns: [], outline: [], loading: false, revision: 0, entries })
    store.publish({ turns: [], outline: [], loading: false, revision: 1, entries })
    expect(store.getEntries()).toBe(entries)
    store.publish({ turns: [], outline: [], loading: true, revision: 2, entries: null })
    expect(store.getEntries()).toBeNull()
  })

  it('does not move the entry cursor past an ordinary SDK message missing before a custom event', () => {
    const old = { generation: 1, sessionId: 'session', entries: [user()], leafId: 'user', cursor: 'user' }
    const assistantEntry = message('assistant', 'user', assistant([{ type: 'text', text: 'Done.' }]))
    const custom: LocalPiSessionEntry = { type: 'custom', id: 'task', parentId: 'assistant', timestamp: '2026-10-01T00:00:00Z', customType: CONVERSATION_TASK_CUSTOM_TYPE,
      data: { version: 1, updatedAt: 1, summary: 'Done', plan: null, blockers: [], nextActions: [] } }
    expect(canAppendLocalPiEntry(old, custom)).toBe(false)
    // get_entries still starts after 'user', so the missed parent is included.
    const repaired = mergeLocalPiEntrySnapshot(old, { generation: 1, sessionId: 'session', entries: [assistantEntry, custom], leafId: 'task', append: true })
    expect(projectConversationContext(repaired.entries, repaired.leafId, []).task?.summary).toBe('Done')
    expect(repaired.cursor).toBe('task')
    expect(canAppendLocalPiEntry(repaired, { ...custom, id: 'next', parentId: 'task' })).toBe(true)
  })

  it('keeps the read cursor behind live events and reconciles overlapping pages without losing another branch', () => {
    const old = { generation: 1, sessionId: 'session', entries: [user()], leafId: 'user', cursor: 'user' }
    const background = message('other-branch', 'user', assistant([{ type: 'text', text: 'Other branch.' }]))
    const live: LocalPiSessionEntry = { type: 'custom', id: 'task', parentId: 'user', timestamp: '2026-10-01T00:00:00Z', customType: CONVERSATION_TASK_CUSTOM_TYPE,
      data: { version: 1, updatedAt: 1, summary: 'Live summary', plan: null, blockers: [], nextActions: [] } }
    const projected = appendLocalPiEntryEvent(old, live)
    expect(projected.cursor).toBe('user')
    expect(projectConversationContext(projected.entries, projected.leafId, []).task?.summary).toBe('Live summary')
    const reconciled = mergeLocalPiEntrySnapshot(projected, { generation: 1, sessionId: 'session', entries: [background, live], leafId: 'task', append: true })
    expect(reconciled.entries.map((entry) => entry.id)).toEqual(['user', 'other-branch', 'task'])
    expect(reconciled.cursor).toBe('task')
    expect(projectConversationContext(reconciled.entries, reconciled.leafId, []).valid).toBe(true)
  })
})
