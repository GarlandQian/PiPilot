import { describe, expect, it } from 'vitest'
import { parseNavigationPreferences, taskOrganizationKey, updateTaskOrganization } from '../../src/renderer/navigation-preferences'
import type { OfficialPiSessionSummary } from '../../src/shared/conversation-scope'

const summary: OfficialPiSessionSummary = {
  scope: { kind: 'project', workspaceId: 'project-a' }, sessionId: 'session-a',
  name: 'Original title', preview: 'Original prompt', selectionToken: 'sel_initial',
  catalogId: `cat_${'a'.repeat(64)}`,
  createdAt: '2026-09-01T00:00:00.000Z', modifiedAt: '2026-09-02T00:00:00.000Z',
}

describe('task organization preferences', () => {
  it('survives catalog token changes, renames and new messages while separating scopes and files', () => {
    const changed = { ...summary, name: 'Renamed', selectionToken: 'sel_rotated', modifiedAt: '2026-09-10T00:00:00.000Z' }
    expect(taskOrganizationKey(changed)).toBe(taskOrganizationKey(summary))
    expect(taskOrganizationKey({ ...summary, scope: { kind: 'projectless' } })).not.toBe(taskOrganizationKey(summary))
    expect(taskOrganizationKey({ ...summary, catalogId: `cat_${'b'.repeat(64)}` })).not.toBe(taskOrganizationKey(summary))
    const pinned = updateTaskOrganization({ tasks: {}, lastSelected: {} }, summary, { pinned: true })
    const archived = updateTaskOrganization(pinned, changed, { archived: true, unread: true })
    expect(Object.keys(archived.tasks)).toHaveLength(1)
    const restored = parseNavigationPreferences(JSON.stringify({ version: 1, ...archived }))
    expect(restored.tasks[taskOrganizationKey(summary)]).toEqual({ pinned: true, archived: true, unread: true })
    expect(pinned.tasks[taskOrganizationKey(summary)]).toEqual({ pinned: true })
    expect(summary.name).toBe('Original title')
  })

  it('organizes copied files independently even when session IDs and creation times match', () => {
    const copy = { ...summary, catalogId: `cat_${'b'.repeat(64)}`, selectionToken: 'sel_copy' }
    const pinned = updateTaskOrganization({ tasks: {}, lastSelected: {} }, summary, { pinned: true })
    const organized = updateTaskOrganization(pinned, copy, { archived: true, unread: true })
    expect(Object.keys(organized.tasks)).toHaveLength(2)
    expect(organized.tasks[taskOrganizationKey(summary)]).toEqual({ pinned: true })
    expect(organized.tasks[taskOrganizationKey(copy)]).toEqual({ archived: true, unread: true })
    expect(updateTaskOrganization(organized, copy, { archived: false, unread: false }).tasks)
      .toEqual(pinned.tasks)
  })

  it('uses distinct selection capabilities for incomplete fixture rows without a catalog identity', () => {
    const incomplete = { ...summary, catalogId: undefined }
    const copy = { ...incomplete, selectionToken: 'sel_copy' }
    expect(taskOrganizationKey(incomplete)).toBe(JSON.stringify(['project:project-a', 'sel_initial']))
    expect(taskOrganizationKey(copy)).not.toBe(taskOrganizationKey(incomplete))
  })

  it('restores archived tasks without changing pin or unread state and removes empty metadata', () => {
    const saved = updateTaskOrganization({ tasks: {}, lastSelected: {} }, summary, { pinned: true, archived: true })
    const restored = updateTaskOrganization(saved, summary, { archived: false })
    expect(restored.tasks[taskOrganizationKey(summary)]).toMatchObject({ pinned: true, archived: false })
    expect(updateTaskOrganization(restored, summary, { pinned: false }).tasks).toEqual({})
  })

  it('recovers malformed storage and accepts only known true flags', () => {
    for (const raw of [null, '', '{', 'null', '[]', '{"version":2,"tasks":{}}']) {
      expect(parseNavigationPreferences(raw)).toEqual({ tasks: {}, lastSelected: {} })
    }
    const key = taskOrganizationKey(summary)
    expect(parseNavigationPreferences(JSON.stringify({ version: 1, tasks: { [key]: { pinned: 'yes', archived: true, command: 'ignored' } } })).tasks[key]).toEqual({ archived: true })
  })
})
