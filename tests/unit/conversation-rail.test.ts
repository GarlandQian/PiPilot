import { describe, expect, it } from 'vitest'
import {
  conversationRailBookmarkTitle,
  conversationRailPreview,
  conversationRailReadingEntry,
  projectConversationRailItems,
} from '../../src/components/chat/conversation-rail'
import { projectResponsePresentation, type ResponsePresentation } from '../../src/renderer/pi-rpc/response-presentation'
import type { AgentStatus, Turn } from '../../src/types/chat'

function response(id: string, turns: readonly Turn[], status: AgentStatus = 'completed'): ResponsePresentation {
  return projectResponsePresentation({ id, anchorEntryId: id, turns }, { active: true, status })
}

function prompt(id: string, text = 'Inspect this project'): Extract<Turn, { kind: 'user' }> {
  return { id, kind: 'user', text, time: '', anchorEntryId: id }
}

describe('conversation rail projection', () => {
  it('preserves prompt chronology and Pi labels while previewing only the latest nonempty assistant body', () => {
    const first = response('first', [
      prompt('first', 'A detailed\nquestion'),
      { kind: 'agent', id: 'commentary', markdown: 'I will inspect it.' },
      { kind: 'tool', id: 'read', call: { id: 'read', kind: 'shell', title: 'Read', body: 'Tool output must not appear', status: 'success' } },
      { kind: 'agent', id: 'answer', markdown: '## Answer\n\n**Ready**' },
      { kind: 'thinking', id: 'thinking', text: 'Thinking must not appear', state: 'complete' },
      { kind: 'agent', id: 'empty', markdown: ' \n ' },
    ])
    const second = response('second', [prompt('second')], 'running')
    const labels = new Map([['first', 'Existing custom label']])
    expect(projectConversationRailItems([first, second], labels)).toEqual([
      { entryId: 'first', title: 'A detailed\nquestion', markdown: '## Answer\n\n**Ready**', status: 'complete', label: 'Existing custom label' },
      { entryId: 'second', title: 'Inspect this project', markdown: '', status: 'running' },
    ])
    expect(labels.get('first')).toBe('Existing custom label')
  })

  it('omits unanchored prompts and assistant-only follow-ups', () => {
    const unanchored = { ...response('unanchored', [prompt('unanchored')]), anchorEntryId: undefined }
    const followUp = response('follow-up', [{ kind: 'agent', id: 'answer', markdown: 'Follow-up' }])
    expect(projectConversationRailItems([unanchored, followUp], new Map())).toEqual([])
  })

  it.each([
    ['idle', 'pending'],
    ['planning', 'running'],
    ['running', 'running'],
    ['completed', 'complete'],
    ['failed', 'error'],
    ['cancelled', 'aborted'],
  ] as const)('retains a truthful %s state when no assistant body exists', (status, expected) => {
    const source = { ...response('first', [prompt('first')]), status }
    expect(projectConversationRailItems([source], new Map())[0]).toMatchObject({ markdown: '', status: expected })
  })
})

describe('conversation rail reading position', () => {
  const positions = [
    { entryId: 'first', top: -180 },
    { entryId: 'second', top: 90 },
    { entryId: 'third', top: 620 },
  ]

  it('keeps a tall response selected until the following prompt crosses the reading line', () => {
    expect(conversationRailReadingEntry(positions, 70)).toBe('first')
    expect(conversationRailReadingEntry(positions, 90)).toBe('second')
    expect(conversationRailReadingEntry(positions, 500)).toBe('second')
    expect(positions.map((position) => position.entryId)).toEqual(['first', 'second', 'third'])
  })

  it('selects the final short turn when the viewport reaches the bottom', () => {
    expect(conversationRailReadingEntry(positions, 100, true)).toBe('third')
  })

  it('handles top padding, missing anchors and unavailable positions', () => {
    expect(conversationRailReadingEntry(positions, -300)).toBe('first')
    expect(conversationRailReadingEntry([], 100)).toBeNull()
    expect(conversationRailReadingEntry([{ entryId: 'stale', top: NaN }, positions[1]], 100)).toBe('second')
  })
})

describe('conversation rail preview', () => {
  it('preserves Markdown for the shared renderer and recognizes empty assistant bodies', () => {
    const markdown = '## Result\n\n- **Ready**\n- [Source](https://example.com)\n\n```ts\nconst ready = true\n```'
    expect(conversationRailPreview(`  ${markdown}\n`)).toEqual({ markdown, truncated: false })
    expect(conversationRailPreview(' \n ')).toEqual({ markdown: '', truncated: false })
  })

  it('bounds large assistant bodies without leaving a split emoji', () => {
    expect(conversationRailPreview('abc😀tail', 4)).toEqual({ markdown: 'abc', truncated: true })
    expect(conversationRailPreview('x'.repeat(10_000))).toEqual({ markdown: 'x'.repeat(1_600), truncated: true })
  })
})

describe('conversation rail native bookmark labels', () => {
  it('normalizes multi-line questions and uses an accessible fallback', () => {
    expect(conversationRailBookmarkTitle('  Explain\n  this\tcode  ', 'Untitled')).toBe('Explain this code')
    expect(conversationRailBookmarkTitle(' \n ', '  Untitled turn  ')).toBe('Untitled turn')
  })

  it('respects the native 120-character label limit without splitting Unicode', () => {
    const prefix = '中'.repeat(119)
    expect(conversationRailBookmarkTitle(`${prefix}😀long title`, 'Untitled')).toBe(prefix)
    expect(conversationRailBookmarkTitle('x'.repeat(130), 'Untitled')).toHaveLength(120)
  })
})
