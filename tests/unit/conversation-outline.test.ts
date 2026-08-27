import { describe, expect, it } from 'vitest'
import {
  conversationOutlineFocusIndex,
  orderConversationOutlineItemsForDisplay,
} from '../../src/components/inspector/ConversationOutlinePanel'
import { projectConversationOutline } from '../../src/renderer/pi-rpc/presentation'
import type { ConversationOutlineItem, Turn } from '../../src/types/chat'

describe('conversation outline projection', () => {
  it('keeps one visible item per official user anchor and ignores unanchored turns', () => {
    const turns: Turn[] = [
      {
        kind: 'agent',
        id: 'summary-before-user',
        markdown: 'Compaction summary',
        state: 'complete',
      },
      {
        kind: 'user',
        id: 'user-a',
        anchorEntryId: 'entry-user-a',
        text: 'Investigate the session projection',
        time: '',
        timestamp: 1_786_300_000_000,
      },
      {
        kind: 'thinking',
        id: 'thinking-a',
        anchorEntryId: 'entry-user-a',
        text: 'Checking',
        state: 'complete',
      },
      {
        kind: 'agent',
        id: 'agent-a',
        anchorEntryId: 'entry-user-a',
        markdown: 'The active branch is aligned.',
        state: 'complete',
      },
      {
        kind: 'response-actions',
        id: 'actions-a',
        anchorEntryId: 'entry-user-a',
        copyMarkdown: 'The active branch is aligned.',
      },
      {
        kind: 'user',
        id: 'user-untrusted',
        text: 'This visible text has no official provenance',
        time: '',
      },
    ]

    expect(projectConversationOutline(turns)).toEqual([{
      entryId: 'entry-user-a',
      title: 'Investigate the session projection',
      summary: 'The active branch is aligned.',
      status: 'complete',
      time: '',
      timestamp: 1_786_300_000_000,
    }])
  })

  it('updates the current item in place and bounds long labels', () => {
    const turns: Turn[] = [
      {
        kind: 'user',
        id: 'user-a',
        anchorEntryId: 'entry-user-a',
        text: `  ${'prompt '.repeat(40)}  `,
        time: '10:00',
      },
      {
        kind: 'agent',
        id: 'agent-a',
        anchorEntryId: 'entry-user-a',
        markdown: `  ${'response '.repeat(40)}  `,
        state: 'streaming',
      },
      {
        kind: 'notice',
        id: 'notice-a',
        anchorEntryId: 'entry-user-a',
        notice: 'response-error',
      },
    ]

    const [item] = projectConversationOutline(turns)
    expect(item).toMatchObject({
      entryId: 'entry-user-a',
      status: 'error',
      time: '10:00',
    })
    expect(item?.title.length).toBeLessThanOrEqual(120)
    expect(item?.summary?.length).toBeLessThanOrEqual(180)
    expect(item?.title.endsWith('…')).toBe(true)
    expect(item?.summary?.endsWith('…')).toBe(true)
  })

  it('keeps multiple user-led turns ordered and groups tool-only responses', () => {
    const turns: Turn[] = [
      {
        kind: 'user',
        id: 'user-a',
        anchorEntryId: 'entry-user-a',
        text: 'First prompt',
        time: '',
      },
      {
        kind: 'agent',
        id: 'agent-a',
        anchorEntryId: 'entry-user-a',
        markdown: 'First answer',
        state: 'complete',
      },
      {
        kind: 'user',
        id: 'user-b',
        anchorEntryId: 'entry-user-b',
        text: 'Second prompt',
        time: '',
      },
      {
        kind: 'tool',
        id: 'tool-b',
        anchorEntryId: 'entry-user-b',
        call: {
          id: 'call-b',
          kind: 'read',
          title: 'Read files',
          status: 'success',
          body: '',
        },
      },
      {
        kind: 'user',
        id: 'user-c',
        anchorEntryId: 'entry-user-c',
        text: 'Third prompt',
        time: '',
      },
    ]

    expect(projectConversationOutline(turns)).toEqual([
      expect.objectContaining({
        entryId: 'entry-user-a',
        title: 'First prompt',
        summary: 'First answer',
        status: 'complete',
      }),
      expect.objectContaining({
        entryId: 'entry-user-b',
        title: 'Second prompt',
        summary: 'Read files',
        status: 'complete',
      }),
      expect.objectContaining({
        entryId: 'entry-user-c',
        title: 'Third prompt',
        status: 'pending',
      }),
    ])
  })
})

describe('conversation outline panel ordering', () => {
  const chronologicalItems: readonly ConversationOutlineItem[] = [
    {
      entryId: 'entry-user-a',
      title: 'Oldest prompt',
      status: 'complete',
      time: '',
    },
    {
      entryId: 'entry-user-b',
      title: 'Middle prompt',
      status: 'complete',
      time: '',
    },
    {
      entryId: 'entry-user-c',
      title: 'Newest prompt',
      status: 'pending',
      time: '',
    },
  ]

  it('shows the latest projected turn first without mutating source order', () => {
    expect(orderConversationOutlineItemsForDisplay(chronologicalItems).map((item) => item.entryId))
      .toEqual(['entry-user-c', 'entry-user-b', 'entry-user-a'])
    expect(chronologicalItems.map((item) => item.entryId))
      .toEqual(['entry-user-a', 'entry-user-b', 'entry-user-c'])
  })

  it('moves focus by the latest-first visual DOM order', () => {
    expect(conversationOutlineFocusIndex('ArrowDown', 0, 3)).toBe(1)
    expect(conversationOutlineFocusIndex('ArrowUp', 2, 3)).toBe(1)
    expect(conversationOutlineFocusIndex('Home', 2, 3)).toBe(0)
    expect(conversationOutlineFocusIndex('End', 0, 3)).toBe(2)
    expect(conversationOutlineFocusIndex('ArrowUp', 0, 3)).toBe(0)
    expect(conversationOutlineFocusIndex('ArrowDown', 2, 3)).toBe(2)
    expect(conversationOutlineFocusIndex('Enter', 1, 3)).toBeNull()
  })
})
