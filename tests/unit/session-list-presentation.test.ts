import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { resolveSidebarSessionIndicatorState } from '../../src/components/layout/SessionList'
import {
  isSidebarSessionRunning,
  isNewBackgroundResult,
  preferredProjectSession,
  presentPrioritySessions,
  presentSidebarSessions,
  sortSidebarProjects,
} from '../../src/components/layout/session-navigation'
import type { SidebarConversationItem } from '../../src/components/layout/SessionList'

describe('sidebar session indicator presentation', () => {
  it('keeps the exact opening row in loading regardless of runtime state', () => {
    expect(resolveSidebarSessionIndicatorState({
      loading: true,
      status: 'completed',
      activityState: 'completed',
    })).toBe('loading')
    expect(resolveSidebarSessionIndicatorState({
      status: 'running',
      activityState: 'opening',
    })).toBe('loading')
  })

  it('keeps running and queued work visible without claiming queued messages need user input', () => {
    expect(resolveSidebarSessionIndicatorState({
      status: 'running',
      activityState: 'running',
    })).toBe('running')
    expect(resolveSidebarSessionIndicatorState({
      status: 'running',
      activityState: 'waiting',
    })).toBe('running')
    expect(resolveSidebarSessionIndicatorState({
      status: 'idle',
      activityState: 'completed',
    })).toBe('none')
    expect(resolveSidebarSessionIndicatorState({
      status: 'failed',
      activityState: 'failed',
    })).toBe('failed')
    expect(resolveSidebarSessionIndicatorState({
      activityState: 'released',
    })).toBe('none')
  })

  it('uses runtime status as a safe fallback for legacy callers', () => {
    expect(resolveSidebarSessionIndicatorState({ status: 'planning' })).toBe('running')
    expect(resolveSidebarSessionIndicatorState({ status: 'cancelled' })).toBe('none')
    expect(resolveSidebarSessionIndicatorState({ status: 'failed' })).toBe('failed')
    expect(resolveSidebarSessionIndicatorState({})).toBe('none')
  })

  it('keeps idle, read and stopped rows quiet while retaining an unread result after host release', () => {
    for (const status of ['idle', 'completed', 'cancelled'] as const) {
      expect(resolveSidebarSessionIndicatorState({ status, activityState: 'completed' })).toBe('none')
    }
    expect(resolveSidebarSessionIndicatorState({ status: 'completed', unread: true })).toBe('unread')
    expect(resolveSidebarSessionIndicatorState({ activityState: 'released', unread: true })).toBe('unread')
    expect(resolveSidebarSessionIndicatorState({ status: 'cancelled', unread: true })).toBe('none')
    expect(resolveSidebarSessionIndicatorState({ status: 'cancelled', activityState: 'waiting', unread: true })).toBe('none')
    expect(resolveSidebarSessionIndicatorState({ status: 'running', unread: true })).toBe('running')
  })

  it('shows failed runs in red even if they also need attention, and reserves yellow for user input', () => {
    expect(resolveSidebarSessionIndicatorState({ status: 'failed', needsAttention: true, unread: true })).toBe('failed')
    expect(resolveSidebarSessionIndicatorState({ status: 'running', needsAttention: true })).toBe('attention')
    expect(resolveSidebarSessionIndicatorState({ status: 'running', activityState: 'waiting', needsAttention: false })).toBe('running')
  })
})

function conversation(
  name: string,
  activityState: SidebarConversationItem['activityState'],
  modifiedAt = '2026-09-08T00:00:00.000Z',
): SidebarConversationItem {
  return {
    summary: {
      name,
      sessionId: name,
      preview: '',
      scope: { kind: 'projectless' },
      selectionToken: `sel_${name}`,
      catalogId: `cat_${createHash('sha256').update(name).digest('hex')}`,
      createdAt: modifiedAt,
      modifiedAt,
    },
    activityState,
  }
}

describe('sidebar navigation views', () => {
  it('restores the selected or remembered project task, then the latest, and never invents an empty task', () => {
    const older = { ...conversation('Older', 'completed', '2026-09-01T00:00:00.000Z'), organizationKey: 'older' }
    const recent = { ...conversation('Recent', 'completed'), organizationKey: 'recent' }
    const archived = { ...conversation('Archived', 'completed', '2026-09-10T00:00:00.000Z'), archived: true, organizationKey: 'archived' }
    expect(preferredProjectSession([older, recent, archived], 'older')).toBe(older)
    expect(preferredProjectSession([older, recent, archived], 'missing')).toBe(recent)
    expect(preferredProjectSession([older, recent, archived], 'archived')).toBe(recent)
    expect(preferredProjectSession([older, { ...recent, selected: true }], 'older')?.summary.name).toBe('Recent')
    expect(preferredProjectSession([archived])).toBeUndefined()
    expect(preferredProjectSession([])).toBeUndefined()
  })

  it('keeps archived tasks retrievable without hiding active or unread work', () => {
    const archived = { ...conversation('Archived title', 'completed'), archived: true }
    const unread = { ...conversation('Finished elsewhere', 'completed'), archived: true, unread: true }
    const running = { ...conversation('Still working', 'running'), archived: true }
    const preview = { ...conversation('Renamed', 'completed'), archived: true }
    preview.summary.preview = 'Original request with a needle'
    const items = [archived, unread, running, preview]
    expect(presentSidebarSessions(items, { query: '', filter: 'all', sort: 'name' }).items).toEqual([unread, running])
    expect(presentSidebarSessions(items, { query: '', filter: 'archived', sort: 'name' }).items).toHaveLength(4)
    expect(presentSidebarSessions(items, { query: 'needle', filter: 'all', sort: 'name' }).items).toEqual([preview])
    expect(presentSidebarSessions(items, { query: '', filter: 'attention', sort: 'name' }).items).toEqual([unread])
  })

  it('puts attention and running work across projects ahead of selected and pinned idle tasks', () => {
    const pinned = { ...conversation('Pinned', 'completed'), pinned: true }
    const selected = { ...conversation('Selected', 'completed'), selected: true }
    const running = conversation('Running', 'running')
    const failed = conversation('Failed', 'failed')
    const quiet = conversation('Quiet', 'completed')
    expect(presentPrioritySessions([pinned, quiet, selected, running, failed])).toEqual([failed, running, selected, pinned])
    expect(presentSidebarSessions([quiet, pinned], { query: '', filter: 'all', sort: 'name' }).items[0]).toBe(pinned)
  })

  it('marks only observed background completions as new results', () => {
    const result = { ...conversation('Result', 'completed'), status: 'completed' as const }
    expect(isNewBackgroundResult(result, 'running')).toBe(true)
    expect(isNewBackgroundResult({ ...result, status: 'failed' }, 'planning')).toBe(false)
    expect(isNewBackgroundResult({ ...result, status: 'idle' }, 'running')).toBe(false)
    expect(isNewBackgroundResult({ ...result, selected: true }, 'running')).toBe(false)
    expect(isNewBackgroundResult(result, 'completed')).toBe(false)
    expect(isNewBackgroundResult(result)).toBe(false)
    expect(isNewBackgroundResult({ ...result, status: 'cancelled' }, 'running')).toBe(false)
  })

  it('keeps historical and completed sessions in All, and limits Running to active work', () => {
    const items = [
      conversation('Historic', 'released'),
      conversation('Done', 'completed'),
      conversation('Failed', 'failed'),
      conversation('Reading a transcript', 'opening'),
      conversation('Queued', 'waiting'),
      conversation('Working', 'running'),
    ]
    expect(presentSidebarSessions(items, {
      query: '', filter: 'all', sort: 'recent',
    }).items).toHaveLength(6)
    expect(presentSidebarSessions(items, {
      query: '', filter: 'running', sort: 'name',
    }).items.map((item) => item.summary.name)).toEqual(['Queued', 'Working'])
    expect(isSidebarSessionRunning({
      ...conversation('Stopped', 'released'), status: 'running',
    })).toBe(false)
    expect(isSidebarSessionRunning({
      ...conversation('Opening running session', 'opening'), status: 'planning',
    })).toBe(true)
  })

  it('finds an older matching session before slicing and keeps loaded counts independent of matches', () => {
    const items = [
      conversation('Recent', 'completed'),
      conversation('Older target', 'released', '2026-09-01T00:00:00.000Z'),
      conversation('Oldest', 'released', '2026-08-01T00:00:00.000Z'),
    ]
    const matching = presentSidebarSessions(items, {
      query: '  TARGET  ', filter: 'all', sort: 'recent', limit: 1,
    })
    expect(matching.items).toEqual([items[1]])
    expect(matching.loadedCount).toBe(3)
    expect(matching.matchingCount).toBe(1)
    expect(matching.hasMore).toBe(false)

    const firstPage = presentSidebarSessions(items, {
      query: '', filter: 'all', sort: 'recent', limit: 1,
    })
    expect(firstPage.items).toEqual([items[0]])
    expect(firstPage.loadedCount).toBe(3)
    expect(firstPage.hasMore).toBe(true)
  })

  it('finds loaded sessions by project name while retaining the Running restriction', () => {
    const items = [conversation('Done', 'released'), conversation('Active', 'running')]
    expect(presentSidebarSessions(items, {
      query: 'pilot', filter: 'all', sort: 'name', projectName: 'PiPilot',
    }).items).toHaveLength(2)
    expect(presentSidebarSessions(items, {
      query: 'pilot', filter: 'running', sort: 'name', projectName: 'PiPilot',
    }).items).toEqual([items[1]])
  })

  it('sorts session titles naturally without changing selection ownership or the catalog', () => {
    const items = [
      conversation('Task 10', 'released', '2026-09-07T00:00:00.000Z'),
      conversation('Task 2', 'released', '2026-09-01T00:00:00.000Z'),
      conversation('Task 1', 'completed'),
    ]
    expect(presentSidebarSessions(items, {
      query: '', filter: 'all', sort: 'name',
    }).items).toEqual([items[2], items[1], items[0]])
    expect(presentSidebarSessions(items, {
      query: '', filter: 'all', sort: 'recent',
    }).items).toEqual([items[2], items[0], items[1]])
    expect(items.map((item) => item.summary.name)).toEqual(['Task 10', 'Task 2', 'Task 1'])
  })

  it('retains pinned projects ahead of either project sort order', () => {
    const projects = [
      { name: 'Alpha', lastOpenedAt: 200, pinned: false },
      { name: 'Pinned', lastOpenedAt: 1, pinned: true },
      { name: 'Zebra', lastOpenedAt: 300, pinned: false },
    ]
    expect(sortSidebarProjects(projects, 'recent')).toEqual([projects[1], projects[2], projects[0]])
    expect(sortSidebarProjects(projects, 'name')).toEqual([projects[1], projects[0], projects[2]])
    expect(projects[0].name).toBe('Alpha')
  })
})
