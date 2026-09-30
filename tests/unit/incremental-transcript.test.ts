import { describe, expect, it } from 'vitest'
import { createLocalPiProjectorState, type LocalPiProjectorState } from '../../src/renderer/pi-rpc/projector'
import { createConversationOutlineProjector, createLocalPiTurnsProjector, projectLocalPiTurns } from '../../src/renderer/pi-rpc/presentation'
import { createConversationResponseProjector } from '../../src/renderer/pi-rpc/response-presentation'
import type { LocalPiAgentMessage, LocalPiAssistantMessage } from '../../src/shared/local-pi'
import type { Turn } from '../../src/types/chat'
import { createTranscriptStore } from '../../src/renderer/pi-rpc/transcript-store'
import { recordTurnChanges } from '../../src/renderer/pi-rpc/turn-changes'
import { createTranscriptActivityProjector } from '../../src/renderer/pi-rpc/transcript-activity'

const assistant = (text: string, timestamp: number): LocalPiAssistantMessage => ({
  role: 'assistant', content: [{ type: 'text', text }], timestamp,
  api: 'openai-completions', provider: 'fixture', model: 'fixture', stopReason: 'stop',
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
})

describe('incremental transcript projection', () => {
  it('retains outline and activity selectors when long live text does not change their visible meaning', () => {
    const outline = createConversationOutlineProjector()
    const activity = createTranscriptActivityProjector()
    const user: Turn = { kind: 'user', id: 'u', text: 'Question', time: '', anchorEntryId: 'anchor' }
    const live: Extract<Turn, { kind: 'agent' }> = { kind: 'agent', id: 'live', markdown: 'x'.repeat(200), state: 'streaming', anchorEntryId: 'anchor' }
    let turns: Turn[] = [user, live]
    const initialOutline = outline(turns)
    const initialActivity = activity(turns, 'running')
    for (let chunk = 0; chunk < 100; chunk += 1) {
      const next = [user, { ...live, markdown: `${live.markdown} ${chunk}` }]
      recordTurnChanges(turns, next, [{ index: 1, before: turns[1], after: next[1] }])
      turns = next
      expect(outline(turns)).toBe(initialOutline)
      expect(activity(turns, 'running')).toBe(initialActivity)
    }
    const settled: Turn[] = [user, { ...live, state: 'complete' }]
    recordTurnChanges(turns, settled, [{ index: 1, before: turns[1], after: settled[1] }])
    expect(outline(settled)[0]?.status).toBe('complete')
    expect(activity(settled, 'idle').streamingKeys.size).toBe(0)
  })

  it('rebuilds missed projections and removals without leaving stale tools or outline anchors', () => {
    const user: Turn = { kind: 'user', id: 'u', text: 'Question', time: '', anchorEntryId: 'anchor' }
    const tool: Turn = { kind: 'tool', id: 't', anchorEntryId: 'anchor', call: { id: 'call', kind: 'shell', title: 'bash', status: 'success', body: 'pwd' } }
    const initial = [user, tool]
    const outline = createConversationOutlineProjector()
    const store = createTranscriptStore({ turns: initial, outline: outline(initial), loading: false, revision: 0 })
    const intermediate = [user]
    recordTurnChanges(initial, intermediate, [{ index: 1, before: tool, after: undefined }])
    const final: Turn[] = []
    recordTurnChanges(intermediate, final, [{ index: 0, before: user, after: undefined }])
    // The renderer can skip publications while React batches commits.
    store.publish({ turns: final, outline: outline(final), loading: false, revision: 2 })
    expect(store.getToolCall('call')).toBeNull()
    expect(store.getOutline()).toEqual([])
  })

  it('builds 1,000 completed replies once while 100 live chunks keep history objects and response projections', () => {
    const messages: LocalPiAgentMessage[] = []
    for (let index = 0; index < 1000; index += 1) {
      messages.push({ role: 'user', content: `Question ${index}`, timestamp: index * 2 }, assistant(`## Answer ${index}\n\nA completed Markdown response.`, index * 2 + 1))
    }
    messages.push({ role: 'user', content: 'Current prompt', timestamp: 2000 })
    let state = createLocalPiProjectorState({ generation: 1, sessionId: 'a', messages, isStreaming: true })
    const turns = createLocalPiTurnsProjector()
    const responses = createConversationResponseProjector()
    const original = turns.project(state)
    const originalResponses = responses.project(original, 'running')
    for (let chunk = 1; chunk <= 100; chunk += 1) {
      state = { ...state, streamingMessage: { ...assistant('x'.repeat(chunk), 2001), stopReason: 'pending' }, revision: chunk }
      const next = turns.project(state)
      expect(next[0]).toBe(original[0])
      expect(next[1999]).toBe(original[1999])
      const rendered = responses.project(next, 'running')
      expect(rendered[0]).toBe(originalResponses[0])
      expect(rendered[999]).toBe(originalResponses[999])
    }
    expect(turns.historyBuilds).toBe(1)
    expect(responses.builds).toBe(1101)
    expect(turns.project(state)).toEqual(projectLocalPiTurns(state))
    const completed = { ...state, messages: [...messages, assistant('Done', 2001)], streamingMessage: null, isStreaming: false }
    const final = turns.project(completed)
    expect(final[0]).toBe(original[0])
    expect(final[1999]).toBe(original[1999])
    expect(final).toEqual(projectLocalPiTurns(completed))
  })

  it('keeps live tool overlays, images and terminal failures authoritative when cached history is replaced', () => {
    const projector = createLocalPiTurnsProjector()
    const initial = createLocalPiProjectorState({ generation: 1, sessionId: 'a', messages: [
      { role: 'user', timestamp: 1, content: [{ type: 'text', text: 'Check' }, { type: 'image', mimeType: 'image/png', data: 'cGl4ZWw=' }] },
      { ...assistant('', 2), content: [{ type: 'toolCall', id: 'read', name: 'read', arguments: { path: 'a.md' } }], stopReason: 'toolUse' },
    ] })
    const states: LocalPiProjectorState[] = [initial, { ...initial, tools: new Map([['read', {
      toolCallId: 'read', toolName: 'read', args: { path: 'a.md' }, phase: 'complete',
      result: { content: [{ type: 'text', text: 'File not found' }] }, resultIsPartial: false, isError: true,
    }]]) }, { ...initial, generation: 2, sessionId: 'b', messages: [assistant('Different session', 3)] }]
    for (const state of states) expect(projector.project(state)).toEqual(projectLocalPiTurns(state))
  })

  it('keeps completed outline items stable when only another reply advances', () => {
    const project = createConversationOutlineProjector()
    const history: Turn[] = [
      { kind: 'user', id: 'u1', text: 'First', time: '', anchorEntryId: 'a' },
      { kind: 'agent', id: 'a1', markdown: 'Completed', state: 'complete', anchorEntryId: 'a' },
      { kind: 'user', id: 'u2', text: 'Next', time: '', anchorEntryId: 'b' },
    ]
    const before = project(history)
    const after = project([...history, { kind: 'agent', id: 'a2', markdown: 'Live', state: 'streaming', anchorEntryId: 'b' }])
    expect(after[0]).toBe(before[0])
    expect(after[1]?.status).toBe('running')
  })

  it('keeps shell selectors equal through live text and clears a selected tool on a visit reset', () => {
    const tool: Extract<Turn, { kind: 'tool' }> = {
      kind: 'tool', id: 'turn:tool', call: { id: 'call', kind: 'shell', title: 'bash', status: 'success', body: 'pwd' },
    }
    const store = createTranscriptStore({ turns: [tool], outline: [], revision: 0, loading: false })
    const selected = store.getToolCall('call')
    let loadingChanges = 0
    let toolChanges = 0
    let loading = store.getLoading()
    let call = selected
    store.subscribe(() => {
      if (loading !== store.getLoading()) { loadingChanges += 1; loading = store.getLoading() }
      if (call !== store.getToolCall('call')) { toolChanges += 1; call = store.getToolCall('call') }
    })
    for (let index = 0; index < 100; index += 1) store.publish({
      turns: [tool, { kind: 'agent', id: 'live', markdown: 'x'.repeat(index), state: 'streaming' }],
      outline: [], revision: index + 1, loading: false,
    })
    expect(loadingChanges).toBe(0)
    expect(toolChanges).toBe(0)
    store.publish({ turns: [], outline: [], revision: 101, loading: true })
    expect(loadingChanges).toBe(1)
    expect(toolChanges).toBe(1)
    expect(store.getToolCall('call')).toBeNull()
  })
})
