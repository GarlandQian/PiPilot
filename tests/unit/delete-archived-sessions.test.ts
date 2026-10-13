import { describe, expect, it, vi } from 'vitest'
import type { OfficialPiSessionSummary } from '../../src/shared/conversation-scope'
import { deleteArchivedSessions } from '../../src/renderer/delete-archived-sessions'
import { removeTaskOrganization, taskOrganizationKey, type NavigationPreferences } from '../../src/renderer/navigation-preferences'

function summary(file: string, scope: OfficialPiSessionSummary['scope'] = { kind: 'projectless' }): OfficialPiSessionSummary {
  return { scope, sessionId: 'shared-session-id', catalogId: `cat_${file.repeat(64)}`, selectionToken: `sel_${file}`,
    preview: file, createdAt: '', modifiedAt: '' }
}

describe('confirmed archived conversation deletion', () => {
  it('refreshes capabilities for each confirmed physical file and never includes unarchived or newly archived targets', async () => {
    const first = summary('a')
    const second = summary('b', { kind: 'project', workspaceId: 'project' })
    const unarchived = summary('c')
    const later = summary('d')
    let preferences: NavigationPreferences = { tasks: {
      [taskOrganizationKey(first)]: { archived: true }, [taskOrganizationKey(second)]: { archived: true },
      [taskOrganizationKey(unarchived)]: { pinned: true }, [taskOrganizationKey(later)]: { archived: true },
    }, lastSelected: { projectless: taskOrganizationKey(first) } }
    let revision = 0
    const list = vi.fn(async (scope: OfficialPiSessionSummary['scope']) => ({ status: 'ready', rows: [first, second, unarchived, later]
      .filter((row) => JSON.stringify(row.scope) === JSON.stringify(scope))
      .map((row) => ({ ...row, selectionToken: `${row.selectionToken}-${++revision}` })) }))
    const remove = vi.fn(async (_row: OfficialPiSessionSummary) => undefined)
    const failures = await deleteArchivedSessions([first, second, first, unarchived], {
      preferences: () => preferences, list, delete: remove,
      deleted: (row) => { preferences = removeTaskOrganization(preferences, row) },
    })
    expect(failures).toEqual([])
    expect(list).toHaveBeenCalledTimes(2)
    expect(remove.mock.calls.map(([row]) => row)).toEqual([
      expect.objectContaining({ catalogId: first.catalogId, selectionToken: 'sel_a-1' }),
      expect.objectContaining({ catalogId: second.catalogId, selectionToken: 'sel_b-4' }),
    ])
    expect(preferences.tasks).toEqual({ [taskOrganizationKey(unarchived)]: { pinned: true }, [taskOrganizationKey(later)]: { archived: true } })
    expect(preferences.lastSelected).toEqual({})
  })

  it('does not delete a conversation restored while its refreshed catalog is pending', async () => {
    const target = summary('a')
    const preferences: NavigationPreferences = { tasks: { [taskOrganizationKey(target)]: { archived: true } }, lastSelected: {} }
    const remove = vi.fn()
    const deleted = vi.fn()
    expect(await deleteArchivedSessions([target], {
      preferences: () => preferences,
      list: async () => { preferences.tasks[taskOrganizationKey(target)] = {}; return { status: 'ready', rows: [target] } },
      delete: remove, deleted,
    })).toEqual([])
    expect(remove).not.toHaveBeenCalled()
    expect(deleted).not.toHaveBeenCalled()
  })

  it('keeps failed targets archived and continues deleting other confirmed files', async () => {
    const targets = [summary('a'), summary('b'), summary('c')]
    let preferences: NavigationPreferences = { tasks: Object.fromEntries(targets.map((row) => [taskOrganizationKey(row), { archived: true }])), lastSelected: {} }
    const errors = await deleteArchivedSessions(targets, {
      preferences: () => preferences,
      list: async () => ({ status: 'ready', rows: targets }),
      delete: async (row) => { if (row.catalogId === targets[1].catalogId) throw new Error('Fixture denied') },
      deleted: (row) => { preferences = removeTaskOrganization(preferences, row) },
    })
    expect(errors).toEqual([{ summary: targets[1], reason: 'deleteFailed', message: 'Fixture denied' }])
    expect(preferences.tasks).toEqual({ [taskOrganizationKey(targets[1])]: { archived: true } })
  })

  it('preserves unavailable or missing records instead of falling back to a copied session with the same ID', async () => {
    const original = summary('a')
    const copy = summary('b')
    const target = summary('c', { kind: 'project', workspaceId: 'unavailable' })
    const preferences: NavigationPreferences = { tasks: { [taskOrganizationKey(original)]: { archived: true }, [taskOrganizationKey(target)]: { archived: true } }, lastSelected: {} }
    const remove = vi.fn()
    const deleted = vi.fn()
    const errors = await deleteArchivedSessions([original, target], {
      preferences: () => preferences,
      list: async (scope) => scope.kind === 'projectless' ? { status: 'ready', rows: [copy] } : { status: 'unavailable', rows: [] },
      delete: remove, deleted,
    })
    expect(errors).toEqual([{ summary: original, reason: 'missing' }, { summary: target, reason: 'unavailable' }])
    expect(remove).not.toHaveBeenCalled()
    expect(deleted).not.toHaveBeenCalled()
  })
})
