import { describe, expect, it } from 'vitest'
import { projectlessCatalogNeedsDiscovery, sessionCatalogLoadTargets } from '../../src/components/frame/session-catalog-search'
import { filterWorkbenchNotifications } from '../../src/components/frame/notification-presentation'

describe('workbench catalog discovery', () => {
  it('discovers general chats when restoring a project leaves the startup loading placeholder untouched', () => {
    expect(projectlessCatalogNeedsDiscovery('electron', 'project', 'loading')).toBe(true)
    expect(projectlessCatalogNeedsDiscovery('electron', 'project')).toBe(true)
    expect(projectlessCatalogNeedsDiscovery('electron', 'projectless')).toBe(true)
    // The active general-chat load is owned by the provider; errors require a manual retry.
    expect(projectlessCatalogNeedsDiscovery('electron', 'projectless', 'loading')).toBe(false)
    for (const status of ['ready', 'notLoaded', 'error', 'unavailable', 'activationUnavailable']) {
      expect(projectlessCatalogNeedsDiscovery('electron', 'project', status)).toBe(false)
    }
    expect(projectlessCatalogNeedsDiscovery('unavailable', 'project')).toBe(false)
    expect(projectlessCatalogNeedsDiscovery('unavailable', 'project', 'loading')).toBe(false)
  })

  it('searches unloaded collapsed projects without changing saved expansion or reloading failures', () => {
    const expanded = new Map([['open', true], ['closed', false]])
    const projects = [
      { projectId: 'open', available: true },
      { projectId: 'closed', available: true },
      { projectId: 'loading', available: true, catalogStatus: 'loading' },
      { projectId: 'loaded', available: true, catalogStatus: 'ready' },
      { projectId: 'failed', available: true, catalogStatus: 'error' },
      { projectId: 'missing', available: false },
    ]
    expect(sessionCatalogLoadTargets(projects, expanded, false)).toEqual(['open'])
    expect(sessionCatalogLoadTargets(projects, expanded, true)).toEqual(['open', 'closed'])
    expect(sessionCatalogLoadTargets(projects, expanded, false, new Set(['closed', 'failed', 'missing']))).toEqual(['open', 'closed'])
    expect([...expanded]).toEqual([['open', true], ['closed', false]])
    expect(projects[1]?.catalogStatus).toBeUndefined()
  })
})

describe('workbench notification attention filter', () => {
  it('keeps exact warning/error records in arrival order and restores every info record on clear', () => {
    const notifications = [
      { id: 'warning-1', type: 'warning' as const, message: 'Review first.' },
      { id: 'info', type: 'info' as const, message: 'Progress.' },
      { id: 'error', type: 'error' as const, message: 'Exact failure.' },
      { id: 'warning-2', type: 'warning' as const, message: 'Review last.' },
    ]
    const attention = filterWorkbenchNotifications(notifications, 'attention')
    expect(attention.map((item) => item.id)).toEqual(['warning-1', 'error', 'warning-2'])
    expect(attention[0]).toBe(notifications[0])
    expect(filterWorkbenchNotifications(notifications, 'all')).toBe(notifications)
    expect(notifications).toHaveLength(4)
  })
})
