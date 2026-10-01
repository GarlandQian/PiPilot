import { describe, expect, it } from 'vitest'
import {
  CONVERSATION_TASK_CUSTOM_TYPE,
  conversationTaskSnapshotSchema,
  getConversationBranchEntries,
  getConversationTaskSnapshot,
  type ConversationTaskSnapshot,
} from '../../src/shared/conversation-task'

export function taskSnapshot(): ConversationTaskSnapshot {
  return {
    version: 2, updatedAt: 1, summary: 'Prepare the feature', blockers: [], nextActions: [],
  }
}

describe('conversation task state', () => {
  it('reads only the selected branch, including deep trees without recursion', () => {
    const entries = Array.from({ length: 10_000 }, (_, index) => ({
      id: String(index), parentId: index ? String(index - 1) : null, type: 'custom',
      customType: CONVERSATION_TASK_CUSTOM_TYPE,
      data: { ...taskSnapshot(), summary: `Summary ${index}` },
    }))
    entries.push({ id: 'abandoned', parentId: '10', type: 'custom', customType: CONVERSATION_TASK_CUSTOM_TYPE, data: { ...taskSnapshot(), summary: 'Another branch' } })
    expect(getConversationTaskSnapshot(entries, '9999')?.summary).toBe('Summary 9999')
    expect(getConversationTaskSnapshot(entries, '10')?.summary).toBe('Summary 10')
    expect(getConversationBranchEntries(entries, null)).toEqual([])
  })

  it('rejects incomplete, cyclic and ambiguous ancestry instead of showing stale task data', () => {
    const entry = { id: 'a', parentId: null, type: 'custom', customType: CONVERSATION_TASK_CUSTOM_TYPE, data: taskSnapshot() }
    expect(getConversationBranchEntries([entry, entry], 'a')).toBeNull()
    expect(getConversationBranchEntries([{ ...entry, parentId: 'missing' }], 'a')).toBeNull()
    expect(getConversationBranchEntries([{ ...entry, parentId: 'a' }], 'a')).toBeNull()
    expect(getConversationTaskSnapshot([entry], 'missing')).toBeNull()
    expect(getConversationTaskSnapshot([entry, { ...entry, id: 'invalid', parentId: 'a', data: { version: 999 } }], 'invalid')).toBeNull()
  })

  it('bounds overview metadata and excludes workflow authority', () => {
    const base = taskSnapshot()
    expect(conversationTaskSnapshotSchema.safeParse(base).success).toBe(true)
    expect(conversationTaskSnapshotSchema.safeParse({ ...base, plan: null }).success).toBe(false)
    expect(conversationTaskSnapshotSchema.safeParse({ ...base, nextActions: Array.from({ length: 4 }, (_, i) => ({ id: `n${i}`, label: 'Next', prompt: 'Continue' })) }).success).toBe(false)
    expect(conversationTaskSnapshotSchema.safeParse({ ...base, nextActions: Array.from({ length: 2 }, () => ({ id: 'same', label: 'Next', prompt: 'Continue' })) }).success).toBe(false)
  })

  it('preserves historical metadata without resurrecting retired plans or resume instructions', () => {
    const legacy = {
      ...taskSnapshot(), version: 1,
      plan: { id: 'old', status: 'running', approvedAt: 5 },
      blockers: ['Missing API access', 'Paused by the user. Resume explicitly to continue.'],
    }
    const snapshot = getConversationTaskSnapshot([{ id: 'old', parentId: null, type: 'custom', customType: CONVERSATION_TASK_CUSTOM_TYPE, data: legacy }], 'old')
    expect(snapshot).toEqual({ ...taskSnapshot(), blockers: ['Missing API access'] })
    expect(legacy.plan.status).toBe('running')
  })
})
