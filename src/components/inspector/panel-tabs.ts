import { z } from 'zod'
import { workspaceRelativePathSchema } from '@/shared/workspace-content'

/**
 * Codex's workspace tabs: nothing is fixed. Review, files, opened files,
 * terminals, side questions, agents and command output are tabs that open on
 * demand, live in the right or bottom dock, and close. Each conversation
 * remembers its own tabs and layout.
 */
export type PanelDock = 'right' | 'bottom'
/** `full`: the right dock fills the window. `hidden`: the right dock is put away. */
export type PanelLayout = 'split' | 'full' | 'hidden'
export type PanelTabKind = 'review' | 'files' | 'file' | 'terminal' | 'sidechat' | 'subagent' | 'command'
export type PanelTab =
  | { id: string; kind: Exclude<PanelTabKind, 'file'> }
  | { id: string; kind: 'file'; path: string }

export interface PanelDockState {
  tabIds: readonly string[]
  activeId: string | null
}

export interface PanelTabsState {
  tabs: Readonly<Record<string, PanelTab>>
  right: PanelDockState
  bottom: PanelDockState
  layout: PanelLayout
  /** Where showing the tabs again returns to. */
  restoreLayout: 'split' | 'full'
  bottomOpen: boolean
}

/** Tabs a conversation remembers across launches; the rest belong to the moment. */
const PERSISTED_KINDS = new Set<PanelTabKind>(['review', 'files', 'file', 'terminal'])
export const PANEL_MAX_FILE_TABS = 24

export const EMPTY_PANEL_TABS: PanelTabsState = Object.freeze({
  tabs: Object.freeze({}),
  right: Object.freeze({ tabIds: Object.freeze([]), activeId: null }),
  bottom: Object.freeze({ tabIds: Object.freeze([]), activeId: null }),
  layout: 'hidden',
  restoreLayout: 'split',
  bottomOpen: false,
}) as PanelTabsState

export function panelTab(kind: Exclude<PanelTabKind, 'file'>): PanelTab
export function panelTab(kind: 'file', path: string): PanelTab
export function panelTab(kind: PanelTabKind, path?: string): PanelTab {
  return kind === 'file' ? { id: `file:${path}`, kind, path: path! } : { id: kind, kind }
}

export function panelDockOf(state: PanelTabsState, id: string): PanelDock | null {
  if (state.right.tabIds.includes(id)) return 'right'
  if (state.bottom.tabIds.includes(id)) return 'bottom'
  return null
}

function reveal(state: PanelTabsState, dock: PanelDock): PanelTabsState {
  if (dock === 'bottom') return state.bottomOpen ? state : { ...state, bottomOpen: true }
  return state.layout === 'hidden' ? { ...state, layout: state.restoreLayout } : state
}

function withDock(state: PanelTabsState, dock: PanelDock, next: PanelDockState): PanelTabsState {
  return dock === 'right' ? { ...state, right: next } : { ...state, bottom: next }
}

/** A dock whose last tab closed puts itself away. */
function settle(state: PanelTabsState, dock: PanelDock): PanelTabsState {
  if (state[dock].tabIds.length) return state
  if (dock === 'bottom') return state.bottomOpen ? { ...state, bottomOpen: false } : state
  return state.layout === 'hidden' ? state : { ...state, layout: 'hidden' }
}

function neighbour(tabIds: readonly string[], removed: string) {
  const index = tabIds.indexOf(removed)
  const rest = tabIds.filter((id) => id !== removed)
  return rest[Math.min(index, rest.length - 1)] ?? null
}

/** Open a tab, or show it where it already is. New tabs join the end of their dock. */
export function openPanelTab(state: PanelTabsState, tab: PanelTab, options: { dock?: PanelDock; activate?: boolean } = {}): PanelTabsState {
  const activate = options.activate ?? true
  const current = panelDockOf(state, tab.id)
  if (current) return activate ? selectPanelTab(state, tab.id) : state
  const dock = options.dock ?? 'right'
  let next: PanelTabsState = { ...state, tabs: { ...state.tabs, [tab.id]: tab } }
  const target = next[dock]
  next = withDock(next, dock, { tabIds: [...target.tabIds, tab.id], activeId: activate || !target.activeId ? tab.id : target.activeId })
  if (tab.kind === 'file') next = boundFileTabs(next, tab.id)
  return activate ? reveal(next, dock) : next
}

/** Opened files are cheap to reopen; past the cap the oldest inactive one goes. */
function boundFileTabs(state: PanelTabsState, keep: string): PanelTabsState {
  const files = Object.values(state.tabs).filter((tab) => tab.kind === 'file')
  if (files.length <= PANEL_MAX_FILE_TABS) return state
  const active = new Set([state.right.activeId, state.bottom.activeId, keep])
  const ordered = [...state.right.tabIds, ...state.bottom.tabIds]
  const evict = ordered.find((id) => state.tabs[id]?.kind === 'file' && !active.has(id))
  return evict ? closePanelTab(state, evict) : state
}

export function selectPanelTab(state: PanelTabsState, id: string): PanelTabsState {
  const dock = panelDockOf(state, id)
  if (!dock) return state
  const next = state[dock].activeId === id ? state : withDock(state, dock, { ...state[dock], activeId: id })
  return reveal(next, dock)
}

export function closePanelTab(state: PanelTabsState, id: string): PanelTabsState {
  const dock = panelDockOf(state, id)
  if (!dock) return state
  const { [id]: _removed, ...tabs } = state.tabs
  const current = state[dock]
  const activeId = current.activeId === id ? neighbour(current.tabIds, id) : current.activeId
  return settle(withDock({ ...state, tabs }, dock, { tabIds: current.tabIds.filter((value) => value !== id), activeId }), dock)
}

export function closeOtherPanelTabs(state: PanelTabsState, id: string): PanelTabsState {
  const dock = panelDockOf(state, id)
  if (!dock) return state
  return state[dock].tabIds.filter((value) => value !== id).reduce(closePanelTab, state)
}

/** Move a tab to the other dock and show it there. */
export function movePanelTab(state: PanelTabsState, id: string, dock: PanelDock): PanelTabsState {
  const from = panelDockOf(state, id)
  const tab = state.tabs[id]
  if (!from || from === dock || !tab) return state
  return openPanelTab(closePanelTab(state, id), tab, { dock })
}

export function reorderPanelTab(state: PanelTabsState, id: string, index: number): PanelTabsState {
  const dock = panelDockOf(state, id)
  if (!dock) return state
  const rest = state[dock].tabIds.filter((value) => value !== id)
  const target = Math.max(0, Math.min(rest.length, Math.round(index)))
  const tabIds = [...rest.slice(0, target), id, ...rest.slice(target)]
  if (tabIds.every((value, position) => value === state[dock].tabIds[position])) return state
  return withDock(state, dock, { ...state[dock], tabIds })
}

/** ⌃Tab / ⌃⇧Tab within one dock. */
export function cyclePanelTab(state: PanelTabsState, dock: PanelDock, delta: 1 | -1): PanelTabsState {
  const { tabIds, activeId } = state[dock]
  if (tabIds.length < 2) return state
  const index = activeId ? tabIds.indexOf(activeId) : -1
  return selectPanelTab(state, tabIds[(index + delta + tabIds.length) % tabIds.length]!)
}

export function setPanelLayout(state: PanelTabsState, layout: PanelLayout): PanelTabsState {
  if (state.layout === layout) return state
  return layout === 'hidden' ? { ...state, layout } : { ...state, layout, restoreLayout: layout }
}

/** ⌘⌥B and the toolbar button: hide the tabs, or bring them back as they were. */
export function togglePanelTabs(state: PanelTabsState): PanelTabsState {
  return state.layout === 'hidden' ? setPanelLayout(state, state.restoreLayout) : setPanelLayout(state, 'hidden')
}

/** ⌘⇧B: side by side, then full view, then tabs hidden. */
export function cyclePanelLayout(state: PanelTabsState): PanelTabsState {
  return setPanelLayout(state, state.layout === 'split' ? 'full' : state.layout === 'full' ? 'hidden' : 'split')
}

/** ⌘⇧F: enter or leave full view. */
export function togglePanelFull(state: PanelTabsState): PanelTabsState {
  return setPanelLayout(state, state.layout === 'full' ? 'split' : 'full')
}

/** Leave full view so the conversation shows again (for actions that land there). */
export function showConversation(state: PanelTabsState): PanelTabsState {
  return state.layout === 'full' ? setPanelLayout(state, 'split') : state
}

export function setBottomOpen(state: PanelTabsState, open: boolean): PanelTabsState {
  const bottomOpen = open && state.bottom.tabIds.length > 0
  return state.bottomOpen === bottomOpen ? state : { ...state, bottomOpen }
}

/** Drop the tabs `keep` rejects, settling any dock left empty. */
export function retainPanelTabs(state: PanelTabsState, keep: (tab: PanelTab) => boolean): PanelTabsState {
  return Object.values(state.tabs).filter((tab) => !keep(tab)).reduce((next, tab) => closePanelTab(next, tab.id), state)
}

const tabSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('file'), path: workspaceRelativePathSchema }).strict(),
  z.object({ kind: z.enum(['review', 'files', 'terminal']) }).strict(),
])
const dockSchema = z.object({ tabs: z.array(tabSchema).max(64), active: z.number().int().min(-1).max(63) }).strict()
const persistedSchema = z.object({
  version: z.literal(1),
  right: dockSchema,
  bottom: dockSchema,
  layout: z.enum(['split', 'full', 'hidden']),
  restoreLayout: z.enum(['split', 'full']),
  bottomOpen: z.boolean(),
}).strict()
export type PersistedPanelTabs = z.infer<typeof persistedSchema>

export function serializePanelTabs(state: PanelTabsState): PersistedPanelTabs {
  const dock = (value: PanelDockState) => {
    const tabs = value.tabIds.map((id) => state.tabs[id]).filter((tab): tab is PanelTab => Boolean(tab && PERSISTED_KINDS.has(tab.kind)))
    return {
      tabs: tabs.map((tab) => tab.kind === 'file' ? { kind: 'file' as const, path: tab.path } : { kind: tab.kind as 'review' | 'files' | 'terminal' }),
      active: tabs.findIndex((tab) => tab.id === value.activeId),
    }
  }
  const right = dock(state.right)
  const bottom = dock(state.bottom)
  return {
    version: 1,
    right,
    bottom,
    layout: right.tabs.length ? state.layout : 'hidden',
    restoreLayout: state.restoreLayout,
    bottomOpen: state.bottomOpen && bottom.tabs.length > 0,
  }
}

export function restorePanelTabs(value: unknown): PanelTabsState | null {
  const parsed = persistedSchema.safeParse(value)
  if (!parsed.success) return null
  const tabs: Record<string, PanelTab> = {}
  const dock = (input: PersistedPanelTabs['right']): PanelDockState => {
    const ids: string[] = []
    for (const item of input.tabs) {
      const tab = item.kind === 'file' ? panelTab('file', item.path) : panelTab(item.kind)
      if (tabs[tab.id]) continue
      tabs[tab.id] = tab
      ids.push(tab.id)
    }
    const active = input.tabs[input.active]
    const activeId = active ? (active.kind === 'file' ? `file:${active.path}` : active.kind) : null
    return { tabIds: ids, activeId: activeId && ids.includes(activeId) ? activeId : ids[0] ?? null }
  }
  const right = dock(parsed.data.right)
  const bottom = dock(parsed.data.bottom)
  return {
    tabs,
    right,
    bottom,
    layout: right.tabIds.length ? parsed.data.layout : 'hidden',
    restoreLayout: parsed.data.restoreLayout,
    bottomOpen: parsed.data.bottomOpen && bottom.tabIds.length > 0,
  }
}
