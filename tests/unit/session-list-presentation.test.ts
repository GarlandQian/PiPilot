import { describe, expect, it } from 'vitest'
import { resolveSidebarSessionIndicatorState } from '../../src/components/layout/SessionList'
import {
  isSidebarSessionRunning,
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

  it('renders every authoritative lifecycle state in the stable trailing slot', () => {
    expect(resolveSidebarSessionIndicatorState({
      status: 'running',
      activityState: 'running',
    })).toBe('running')
    expect(resolveSidebarSessionIndicatorState({
      status: 'running',
      activityState: 'waiting',
    })).toBe('waiting')
    expect(resolveSidebarSessionIndicatorState({
      status: 'idle',
      activityState: 'completed',
    })).toBe('completed')
    expect(resolveSidebarSessionIndicatorState({
      status: 'failed',
      activityState: 'failed',
    })).toBe('failed')
    expect(resolveSidebarSessionIndicatorState({
      activityState: 'released',
    })).toBe('released')
  })

  it('uses runtime status as a safe fallback for legacy callers', () => {
    expect(resolveSidebarSessionIndicatorState({ status: 'planning' })).toBe('running')
    expect(resolveSidebarSessionIndicatorState({ status: 'cancelled' })).toBe('completed')
    expect(resolveSidebarSessionIndicatorState({ status: 'failed' })).toBe('failed')
    expect(resolveSidebarSessionIndicatorState({})).toBe('released')
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
      createdAt: modifiedAt,
      modifiedAt,
    },
    activityState,
  }
}

describe('sidebar navigation views', () => {
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
