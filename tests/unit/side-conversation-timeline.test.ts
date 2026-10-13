import { describe, expect, it } from 'vitest'
import { boundSideConversationTimeline, projectSideConversationTimeline } from '../../src/main/conversations/side-conversation-timeline'
import type { LocalPiAssistantMessage } from '../../src/shared/local-pi'

const assistant = (content: LocalPiAssistantMessage['content']): LocalPiAssistantMessage => ({
  role: 'assistant', content, api: 'test', provider: 'test', model: 'test', timestamp: 1, stopReason: 'stop',
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
})

describe('side conversation timeline', () => {
  it('keeps text and reasoning order and attaches the exact tool result to its call', () => {
    const items = projectSideConversationTimeline({ messages: [
      { role: 'user', content: 'question with quoted context', timestamp: 0 },
      assistant([
        { type: 'thinking', thinking: 'Inspect the selected file' },
        { type: 'text', text: 'Reading the file.' },
        { type: 'toolCall', id: 'read-1', name: 'read', arguments: { path: 'source.ts' } },
      ]),
      { role: 'toolResult', toolCallId: 'read-1', toolName: 'read', content: [{ type: 'text', text: 'File contents' }], timestamp: 2, isError: false },
    ] }, () => 'question')
    expect(items.map((item) => item.kind)).toEqual(['user', 'thinking', 'assistant', 'tool'])
    expect(items[0]?.text).toBe('question')
    expect(items[3]).toMatchObject({ toolCallId: 'read-1', toolName: 'read', arguments: '{"path":"source.ts"}', text: 'File contents', status: 'completed' })
  })
  it('exposes live reasoning and running tools while retaining bounded output', () => {
    const items = projectSideConversationTimeline({ messages: [], live: {
      message: assistant([{ type: 'thinking', thinking: 'Working through the question' }, { type: 'toolCall', id: 'work-1', name: 'bash', arguments: { command: 'pwd' } }]),
      isStreaming: true, sequence: 1, toolCallDeltas: [],
    } }, (text) => text)
    expect(items[0]).toMatchObject({ kind: 'thinking', partial: true })
    expect(items[1]).toMatchObject({ kind: 'tool', status: 'running' })
    const bounded = boundSideConversationTimeline(Array.from({ length: 500 }, (_, index) => ({ id: String(index), kind: 'assistant' as const, text: 'x'.repeat(1_000) })))
    expect(bounded.reduce((total, item) => total + item.text.length, 0)).toBeLessThanOrEqual(256_000)
    expect(bounded[bounded.length - 1]?.id).toBe('499')
  })
})
