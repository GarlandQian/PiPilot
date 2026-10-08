import { describe, expect, it } from 'vitest'
import {
  EMPTY_PANEL_TABS,
  PANEL_MAX_FILE_TABS,
  closeOtherPanelTabs,
  closePanelTab,
  cyclePanelLayout,
  cyclePanelTab,
  movePanelTab,
  openPanelTab,
  panelDockOf,
  panelTab,
  reorderPanelTab,
  restorePanelTabs,
  retainPanelTabs,
  serializePanelTabs,
  setBottomOpen,
  showConversation,
  togglePanelFull,
  togglePanelTabs,
} from '../../src/components/inspector/panel-tabs'
import { PANEL_TABS_STORAGE_KEY, PanelTabsStore } from '../../src/components/inspector/panel-tabs-store'

const review = panelTab('review')
const files = panelTab('files')
const readme = panelTab('file', 'README.md')
const terminal = panelTab('terminal')

describe('panel tabs', () => {
  it('starts with nothing open and the right dock put away', () => {
    expect(EMPTY_PANEL_TABS.layout).toBe('hidden')
    expect(EMPTY_PANEL_TABS.right.tabIds).toEqual([])
    expect(EMPTY_PANEL_TABS.bottomOpen).toBe(false)
  })

  it('opens a tab at the end of its dock, selects it and shows the dock', () => {
    const state = openPanelTab(openPanelTab(EMPTY_PANEL_TABS, review), readme)
    expect(state.right).toEqual({ tabIds: ['review', 'file:README.md'], activeId: 'file:README.md' })
    expect(state.layout).toBe('split')
  })

  it('shows an already open tab where it is instead of opening another', () => {
    const opened = openPanelTab(openPanelTab(openPanelTab(EMPTY_PANEL_TABS, review), terminal, { dock: 'bottom' }), files)
    const again = openPanelTab(setBottomOpen(opened, false), terminal, { dock: 'right' })
    expect(panelDockOf(again, 'terminal')).toBe('bottom')
    expect(again.bottom.activeId).toBe('terminal')
    expect(again.bottomOpen).toBe(true)
    expect(again.right.tabIds).toEqual(['review', 'files'])
  })

  it('closing the active tab selects its neighbour; the last tab puts the dock away', () => {
    let state = [review, files, readme].reduce((next, tab) => openPanelTab(next, tab), EMPTY_PANEL_TABS)
    state = closePanelTab(state, 'files')
    expect(state.right.activeId).toBe('file:README.md')
    state = closePanelTab(state, 'file:README.md')
    expect(state.right).toEqual({ tabIds: ['review'], activeId: 'review' })
    state = closePanelTab(state, 'review')
    expect(state.layout).toBe('hidden')
    expect(state.tabs).toEqual({})
  })

  it('closes the other tabs of one dock only', () => {
    let state = [review, files, readme].reduce((next, tab) => openPanelTab(next, tab), EMPTY_PANEL_TABS)
    state = openPanelTab(state, terminal, { dock: 'bottom' })
    state = closeOtherPanelTabs(state, 'files')
    expect(state.right).toEqual({ tabIds: ['files'], activeId: 'files' })
    expect(state.bottom.tabIds).toEqual(['terminal'])
  })

  it('moves a tab between docks and settles the dock it left', () => {
    let state = openPanelTab(EMPTY_PANEL_TABS, terminal)
    state = movePanelTab(state, 'terminal', 'bottom')
    expect(state.right.tabIds).toEqual([])
    expect(state.layout).toBe('hidden')
    expect(state.bottom).toEqual({ tabIds: ['terminal'], activeId: 'terminal' })
    expect(state.bottomOpen).toBe(true)
    state = closePanelTab(state, 'terminal')
    expect(state.bottomOpen).toBe(false)
  })

  it('reorders within a dock and cycles through it', () => {
    let state = [review, files, readme].reduce((next, tab) => openPanelTab(next, tab), EMPTY_PANEL_TABS)
    state = reorderPanelTab(state, 'file:README.md', 0)
    expect(state.right.tabIds).toEqual(['file:README.md', 'review', 'files'])
    state = cyclePanelTab(state, 'right', 1)
    expect(state.right.activeId).toBe('review')
    state = cyclePanelTab(state, 'right', -1)
    state = cyclePanelTab(state, 'right', -1)
    expect(state.right.activeId).toBe('files')
  })

  it('cycles split, full view and hidden tabs, and remembers where to return', () => {
    let state = openPanelTab(EMPTY_PANEL_TABS, review)
    state = cyclePanelLayout(state)
    expect(state.layout).toBe('full')
    state = togglePanelTabs(state)
    expect(state.layout).toBe('hidden')
    state = togglePanelTabs(state)
    expect(state.layout).toBe('full')
    state = showConversation(state)
    expect(state.layout).toBe('split')
    state = togglePanelFull(togglePanelFull(state))
    expect(state.layout).toBe('split')
    state = cyclePanelLayout(cyclePanelLayout(state))
    expect(state.layout).toBe('hidden')
    expect(cyclePanelLayout(state).layout).toBe('split')
  })

  it('keeps a bounded set of opened files, sparing the selected ones', () => {
    let state = openPanelTab(EMPTY_PANEL_TABS, review)
    for (let index = 0; index <= PANEL_MAX_FILE_TABS; index += 1) state = openPanelTab(state, panelTab('file', `src/${index}.ts`))
    const opened = Object.values(state.tabs).filter((tab) => tab.kind === 'file')
    expect(opened).toHaveLength(PANEL_MAX_FILE_TABS)
    expect(state.tabs['file:src/0.ts']).toBeUndefined()
    expect(state.right.activeId).toBe(`file:src/${PANEL_MAX_FILE_TABS}.ts`)
  })

  it('remembers review, files, opened files and terminals, not passing tabs', () => {
    let state = [review, readme, panelTab('sidechat'), panelTab('subagent')].reduce((next, tab) => openPanelTab(next, tab), EMPTY_PANEL_TABS)
    state = openPanelTab(state, terminal, { dock: 'bottom' })
    state = openPanelTab(state, readme)
    const restored = restorePanelTabs(JSON.parse(JSON.stringify(serializePanelTabs(state))))
    expect(restored?.right).toEqual({ tabIds: ['review', 'file:README.md'], activeId: 'file:README.md' })
    expect(restored?.bottom).toEqual({ tabIds: ['terminal'], activeId: 'terminal' })
    expect(restored?.bottomOpen).toBe(true)
    expect(restored?.layout).toBe('split')
  })

  it('rejects damaged or unsafe stored tabs', () => {
    expect(restorePanelTabs({ version: 2 })).toBeNull()
    expect(restorePanelTabs({ version: 1, right: { tabs: [{ kind: 'file', path: '../secret' }], active: 0 }, bottom: { tabs: [], active: -1 }, layout: 'split', restoreLayout: 'split', bottomOpen: false })).toBeNull()
  })

  it('drops tabs whose content is gone', () => {
    const state = [review, readme].reduce((next, tab) => openPanelTab(next, tab), EMPTY_PANEL_TABS)
    const kept = retainPanelTabs(state, (tab) => tab.kind !== 'file')
    expect(kept.right).toEqual({ tabIds: ['review'], activeId: 'review' })
  })
})

describe('panel tabs store', () => {
  function memoryStorage() {
    const values = new Map<string, string>()
    return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
  }

  it('keeps each conversation apart and writes them for the next launch', () => {
    const storage = memoryStorage()
    const store = new PanelTabsStore(storage)
    store.set('a', openPanelTab(EMPTY_PANEL_TABS, review))
    store.set('b', openPanelTab(EMPTY_PANEL_TABS, files))
    store.flush()
    expect(storage.values.has(PANEL_TABS_STORAGE_KEY)).toBe(true)
    const next = new PanelTabsStore(storage)
    expect(next.get('a').right.tabIds).toEqual(['review'])
    expect(next.get('b').right.tabIds).toEqual(['files'])
    expect(next.get('c')).toBe(EMPTY_PANEL_TABS)
  })

  it('forgets passing tabs when leaving a conversation', () => {
    const store = new PanelTabsStore(null)
    store.set('a', [review, panelTab('command')].reduce((next, tab) => openPanelTab(next, tab), EMPTY_PANEL_TABS))
    store.leave('a')
    expect(store.get('a').right.tabIds).toEqual(['review'])
  })

  it('survives unreadable storage', () => {
    const store = new PanelTabsStore({ getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } })
    store.set('a', openPanelTab(EMPTY_PANEL_TABS, review))
    expect(() => store.flush()).not.toThrow()
    expect(store.get('a').right.tabIds).toEqual(['review'])
  })
})
