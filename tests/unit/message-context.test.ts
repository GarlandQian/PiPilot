import { describe, expect, it } from 'vitest'
import { messageReference, messageSelectionText, messageSnapshotIsCurrent, userMessageMarkdown } from '../../src/renderer/composer/message-context'
import { MAX_REFERENCE_TEXT } from '../../src/renderer/composer/precision-reference'
import { createConversationPlanKickoff } from '../../src/shared/conversation-task'

describe('message menu snapshots', () => {
  const source = { sourceId: 'question/assistant', label: 'Assistant message' }
  it('copies the visible question without the injected skill or plan instructions', () => {
    const envelope = '<skill name="review" location="/skills/review/SKILL.md">\nPrivate workflow instructions\n</skill>\n\nReview **this file**.'
    expect(userMessageMarkdown(envelope, (title) => title)).toBe('Review **this file**.')
    const plan = createConversationPlanKickoff({ id: 'private-plan-id', title: 'Fix the layout' }, '325bb64b-1779-4163-b44c-9179e8092a26')
    expect(userMessageMarkdown(plan, (title) => `Continue: ${title}`)).toBe('Continue: Fix the layout')
    expect(userMessageMarkdown('```xml\n' + envelope + '\n```', (title) => title)).toBe('```xml\n' + envelope + '\n```')
  })
  it('keeps copied/quoted text immutable and does not claim source lines for rendered Markdown', () => {
    const reference = messageReference(source, 'session-A', 'Rendered **passage**\nnext line')!
    expect(reference).toMatchObject({ kind: 'message', ownerKey: 'session-A', sourceId: source.sourceId, text: 'Rendered **passage**\nnext line' })
    expect(reference).not.toHaveProperty('startLine')
    expect(reference).not.toHaveProperty('endLine')
    expect(messageSnapshotIsCurrent({ ownerKey: 'session-A', sourceId: source.sourceId }, 'session-B', source.sourceId)).toBe(false)
    expect(messageSnapshotIsCurrent({ ownerKey: 'session-A', sourceId: source.sourceId }, 'session-A', 'other-message')).toBe(false)
    expect(messageSnapshotIsCurrent({ ownerKey: 'session-A', sourceId: source.sourceId }, 'session-A', source.sourceId)).toBe(true)
    expect(messageSnapshotIsCurrent(null, 'session-A', source.sourceId)).toBe(false)
  })
  it('bounds quote size without truncating or treating an unavailable composer as a valid owner', () => {
    expect(messageReference(source, undefined, 'A passage')).toBeNull()
    expect(messageReference(source, 'session-A', ' \n ')).toBeNull()
    expect(messageReference(source, 'session-A', 'a'.repeat(MAX_REFERENCE_TEXT))?.text).toHaveLength(MAX_REFERENCE_TEXT)
    expect(messageReference(source, 'session-A', 'a'.repeat(MAX_REFERENCE_TEXT + 1))).toBeNull()
  })
  it('captures a nonempty selection inside the clicked message and rejects selections spanning messages', () => {
    const inside = {} as Node, outside = {} as Node
    const root = { contains: (node: Node) => node === inside } as HTMLElement
    const select = (end: Node, text: string, isCollapsed = false) => ({ rangeCount: 1, isCollapsed, getRangeAt: () => ({ startContainer: inside, endContainer: end }), toString: () => text }) as unknown as Selection
    expect(messageSelectionText(root, select(inside, '  exact passage\n'))).toBe('  exact passage\n')
    expect(messageSelectionText(root, select(outside, 'spanning two messages'))).toBeNull()
    expect(messageSelectionText(root, select(inside, ' \n'))).toBeNull()
    expect(messageSelectionText(root, select(inside, 'stale selection', true))).toBeNull()
    expect(messageSelectionText(root, null)).toBeNull()
  })
})
