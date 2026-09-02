import { describe, expect, it } from 'vitest'
import {
  APP_ROUTE_LAYOUT_KEY,
  CONTEXT_PANEL_LAYOUT_KEY,
  PANEL_LAYOUT_KEY,
  PROJECT_EXPANSION_LAYOUT_KEY,
  deriveFrameLayoutMode,
  expandedProjectIdsNeedingCatalogLoad,
  normalizeAppRoute,
  normalizePanelLayout,
  readAppRoute,
  readContextPanelOpen,
  readPanelLayout,
  readProjectExpansionPreferences,
  writeAppRoute,
  writeContextPanelOpen,
  writePanelLayout,
  writeProjectExpansionPreferences,
  type LayoutPreferenceStorage,
} from '../../src/renderer/layout-preferences'

class MemoryStorage implements LayoutPreferenceStorage {
  private readonly values = new Map<string, string>()

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

function projectId(index: number) {
  return `00000000-0000-4000-8000-${index.toString().padStart(12, '0')}`
}

describe('renderer layout preferences', () => {
  it('normalizes the app route and migrates known legacy destinations', () => {
    expect(normalizeAppRoute({ workspace: 'conversation', context: 'activity' })).toEqual({
      workspace: 'conversation',
      context: 'sessions',
    })
    expect(normalizeAppRoute('integrations')).toEqual({
      workspace: 'settings',
      section: 'integrations',
    })
    expect(normalizeAppRoute('unknown')).toEqual({
      workspace: 'conversation',
      context: 'sessions',
    })
  })

  it('round-trips the discriminated app route and rejects corrupt documents', () => {
    const storage = new MemoryStorage()
    writeAppRoute({ workspace: 'settings', section: 'models' }, storage)

    expect(readAppRoute(storage)).toEqual({ workspace: 'settings', section: 'models' })
    expect(JSON.parse(storage.getItem(APP_ROUTE_LAYOUT_KEY)!)).toEqual({
      version: 1,
      route: { workspace: 'settings', section: 'models' },
    })

    storage.setItem(APP_ROUTE_LAYOUT_KEY, JSON.stringify({
      version: 1,
      route: { workspace: 'conversation', context: 'activity' },
    }))
    expect(readAppRoute(storage)).toEqual({
      workspace: 'conversation',
      context: 'sessions',
    })

    storage.setItem(APP_ROUTE_LAYOUT_KEY, JSON.stringify({
      version: 1,
      route: { workspace: 'settings', section: 'missing' },
    }))
    expect(readAppRoute(storage)).toEqual({
      workspace: 'conversation',
      context: 'sessions',
    })
  })

  it('derives explicit wide and compact frame compositions', () => {
    expect(deriveFrameLayoutMode(
      { workspace: 'conversation', context: 'sessions' },
      1_440,
    )).toBe('conversation-wide')
    expect(deriveFrameLayoutMode(
      { workspace: 'conversation', context: 'sessions' },
      1_100,
    )).toBe('conversation-compact')
    expect(deriveFrameLayoutMode(
      { workspace: 'settings', section: 'integrations' },
      1_440,
    )).toBe('settings-wide')
    expect(deriveFrameLayoutMode(
      { workspace: 'settings', section: 'appearance' },
      Number.NaN,
    )).toBe('settings-compact')
  })

  it('bounds and persists panel layout preferences', () => {
    const storage = new MemoryStorage()
    writePanelLayout({
      contextPanelWidth: 999,
      inspectorWidth: 10,
      inspectorOpen: false,
    }, storage)

    expect(readPanelLayout(storage)).toEqual({
      contextPanelWidth: 320,
      inspectorWidth: 280,
      inspectorOpen: false,
    })
    expect(JSON.parse(storage.getItem(PANEL_LAYOUT_KEY)!)).toEqual({
      version: 1,
      contextPanelWidth: 320,
      inspectorWidth: 280,
      inspectorOpen: false,
    })
    expect(normalizePanelLayout({ contextPanelWidth: Number.NaN })).toEqual({
      contextPanelWidth: 240,
      inspectorWidth: 360,
      inspectorOpen: true,
    })
  })

  it('round-trips the context-panel state through a versioned document', () => {
    const storage = new MemoryStorage()

    expect(readContextPanelOpen(storage)).toBe(true)
    writeContextPanelOpen(false, storage)

    expect(readContextPanelOpen(storage)).toBe(false)
    expect(JSON.parse(storage.getItem(CONTEXT_PANEL_LAYOUT_KEY)!)).toEqual({
      version: 1,
      open: false,
    })
  })

  it('round-trips explicit expanded and collapsed project choices', () => {
    const storage = new MemoryStorage()
    const first = projectId(1)
    const second = projectId(2)

    writeProjectExpansionPreferences([
      [first, true],
      [second, true],
      [first, false],
    ], storage)

    expect([...readProjectExpansionPreferences(storage)]).toEqual([
      [second, true],
      [first, false],
    ])
    expect(JSON.parse(storage.getItem(PROJECT_EXPANSION_LAYOUT_KEY)!)).toEqual({
      version: 1,
      projects: [
        { projectId: second, expanded: true },
        { projectId: first, expanded: false },
      ],
    })
  })

  it('restores expanded available projects as catalog load intent', () => {
    const expandedMissing = projectId(1)
    const collapsedMissing = projectId(2)
    const expandedLoaded = projectId(3)
    const expandedUnavailable = projectId(4)

    expect(expandedProjectIdsNeedingCatalogLoad(new Map([
      [expandedMissing, true],
      [collapsedMissing, false],
      [expandedLoaded, true],
      [expandedUnavailable, true],
    ]), [
      { projectId: expandedMissing, available: true, hasCatalog: false },
      { projectId: collapsedMissing, available: true, hasCatalog: false },
      { projectId: expandedLoaded, available: true, hasCatalog: true },
      { projectId: expandedUnavailable, available: false, hasCatalog: false },
    ])).toEqual([expandedMissing])
  })

  it('falls back safely for corrupt, future, or invalid persisted documents', () => {
    const storage = new MemoryStorage()
    storage.setItem(CONTEXT_PANEL_LAYOUT_KEY, '{broken')
    storage.setItem(PROJECT_EXPANSION_LAYOUT_KEY, JSON.stringify({
      version: 2,
      projects: [{ projectId: projectId(1), expanded: true }],
    }))

    expect(readContextPanelOpen(storage)).toBe(true)
    expect([...readProjectExpansionPreferences(storage)]).toEqual([])

    storage.setItem(CONTEXT_PANEL_LAYOUT_KEY, JSON.stringify({ version: 1, open: 'yes' }))
    storage.setItem(PROJECT_EXPANSION_LAYOUT_KEY, JSON.stringify({
      version: 1,
      projects: [{ projectId: 'not-a-project-id', expanded: true }],
    }))

    expect(readContextPanelOpen(storage)).toBe(true)
    expect([...readProjectExpansionPreferences(storage)]).toEqual([])
  })

  it('bounds expanded projects and tolerates unavailable storage', () => {
    const storage = new MemoryStorage()
    const ids = Array.from({ length: 105 }, (_, index) => projectId(index + 1))

    writeProjectExpansionPreferences(ids.map((id) => [id, true] as const), storage)
    expect([...readProjectExpansionPreferences(storage).keys()]).toEqual(ids.slice(-100))

    expect(readContextPanelOpen()).toBe(true)
    expect([...readProjectExpansionPreferences()]).toEqual([])
    expect(() => writeContextPanelOpen(false)).not.toThrow()
    expect(() => writeProjectExpansionPreferences([[projectId(1), false]])).not.toThrow()

    const unavailable: LayoutPreferenceStorage = {
      getItem() {
        throw new Error('unavailable')
      },
      setItem() {
        throw new Error('unavailable')
      },
    }
    expect(readContextPanelOpen(unavailable)).toBe(true)
    expect([...readProjectExpansionPreferences(unavailable)]).toEqual([])
    expect(() => writeContextPanelOpen(false, unavailable)).not.toThrow()
    expect(() => writeProjectExpansionPreferences([[projectId(1), false]], unavailable))
      .not.toThrow()
  })
})
