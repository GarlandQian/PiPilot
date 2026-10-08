import * as React from 'react'
import {
  EMPTY_PANEL_TABS,
  closeOtherPanelTabs,
  closePanelTab,
  cyclePanelLayout,
  cyclePanelTab,
  movePanelTab,
  openPanelTab,
  panelDockOf,
  reorderPanelTab,
  retainPanelTabs,
  selectPanelTab,
  setBottomOpen,
  showConversation,
  togglePanelFull,
  togglePanelTabs,
  type PanelDock,
  type PanelTab,
  type PanelTabsState,
} from '@/components/inspector/panel-tabs'
import { PanelTabsStore } from '@/components/inspector/panel-tabs-store'

/**
 * The conversation's tabs and docks. Each conversation keeps its own; on a
 * narrow window the right dock is an overlay opened only on request.
 */
export function useConversationPanel({ conversationKey, compact, compactOpen, setCompactOpen, inherits }: {
  conversationKey: string
  compact: boolean
  compactOpen: boolean
  setCompactOpen(open: boolean): void
  /**
   * Whether `next` is the conversation `previous` was waiting to become (it
   * only now has a session): it keeps the tabs opened in the meantime.
   */
  inherits?: (previous: string, next: string) => boolean
}) {
  const [store] = React.useState(() => new PanelTabsStore())
  const [current, setCurrent] = React.useState(() => ({ key: conversationKey, state: store.get(conversationKey) }))
  // Switching conversations shows that conversation's tabs (derived during render).
  let view = current
  if (current.key !== conversationKey) {
    const own = store.get(conversationKey)
    const inherited = inherits?.(current.key, conversationKey) && !Object.keys(own.tabs).length && Object.keys(current.state.tabs).length > 0
    if (inherited) store.set(current.key, EMPTY_PANEL_TABS)
    else store.leave(current.key)
    view = { key: conversationKey, state: inherited ? current.state : own }
    setCurrent(view)
  }
  React.useEffect(() => { store.set(current.key, current.state) }, [current, store])
  React.useEffect(() => {
    const flush = () => store.flush()
    window.addEventListener('beforeunload', flush)
    return () => { window.removeEventListener('beforeunload', flush); flush() }
  }, [store])

  const state = view.state
  const stateRef = React.useRef(state)
  stateRef.current = state
  const compactRef = React.useRef({ compact, compactOpen })
  compactRef.current = { compact, compactOpen }

  /** Changes apply to the latest state at once, so several in one event compose. */
  const apply = React.useCallback((change: (state: PanelTabsState) => PanelTabsState) => {
    const before = stateRef.current
    const next = change(before)
    if (next !== before) {
      stateRef.current = next
      setCurrent((value) => ({ key: value.key, state: next }))
    }
    return next
  }, [])

  /** In the compact overlay, showing a right-dock tab opens the overlay; emptying it closes it. */
  const syncCompact = React.useCallback((next: PanelTabsState, revealed?: string) => {
    if (!compactRef.current.compact) return
    if (!next.right.tabIds.length) setCompactOpen(false)
    else if (revealed && panelDockOf(next, revealed) === 'right') setCompactOpen(true)
  }, [setCompactOpen])

  const open = React.useCallback((tab: PanelTab, options?: { dock?: PanelDock; activate?: boolean }) => {
    syncCompact(apply((value) => openPanelTab(value, tab, options)), options?.activate === false ? undefined : tab.id)
  }, [apply, syncCompact])
  const select = React.useCallback((id: string) => { syncCompact(apply((value) => selectPanelTab(value, id)), id) }, [apply, syncCompact])
  const close = React.useCallback((id: string) => { syncCompact(apply((value) => closePanelTab(value, id))) }, [apply, syncCompact])
  const closeOthers = React.useCallback((id: string) => { apply((value) => closeOtherPanelTabs(value, id)) }, [apply])
  const move = React.useCallback((id: string, dock: PanelDock) => { syncCompact(apply((value) => movePanelTab(value, id, dock)), id) }, [apply, syncCompact])
  /** A tab dropped on a dock's strip: reorder there, moving it first if it came from the other dock. */
  const drop = React.useCallback((id: string, dock: PanelDock, index: number) => {
    syncCompact(apply((value) => {
      const from = panelDockOf(value, id)
      if (!from) return value
      const moved = from === dock ? value : movePanelTab(value, id, dock)
      return reorderPanelTab(moved, id, from === dock && value[dock].tabIds.indexOf(id) < index ? index - 1 : index)
    }), id)
  }, [apply, syncCompact])
  const retain = React.useCallback((keep: (tab: PanelTab) => boolean) => { syncCompact(apply((value) => retainPanelTabs(value, keep))) }, [apply, syncCompact])

  /** The toolbar button and ⌘⌥B: hide the right dock, or bring it back. */
  const toggleTabs = React.useCallback(() => {
    if (compactRef.current.compact) setCompactOpen(!compactRef.current.compactOpen)
    else apply(togglePanelTabs)
  }, [apply, setCompactOpen])
  const cycleLayout = React.useCallback(() => {
    if (compactRef.current.compact) setCompactOpen(!compactRef.current.compactOpen)
    else apply(cyclePanelLayout)
  }, [apply, setCompactOpen])
  const toggleFull = React.useCallback(() => { if (!compactRef.current.compact) apply(togglePanelFull) }, [apply])
  /** Actions that land in the conversation leave full view (and the compact overlay). */
  const revealConversation = React.useCallback(() => {
    if (compactRef.current.compact) setCompactOpen(false)
    apply(showConversation)
  }, [apply, setCompactOpen])
  const hideRight = React.useCallback(() => {
    if (compactRef.current.compact) setCompactOpen(false)
    else apply((value) => value.layout === 'hidden' ? value : togglePanelTabs(value))
  }, [apply, setCompactOpen])
  const setBottom = React.useCallback((openBottom: boolean) => { apply((value) => setBottomOpen(value, openBottom)) }, [apply])
  const cycleTab = React.useCallback((dock: PanelDock, delta: 1 | -1) => { syncCompact(apply((value) => cyclePanelTab(value, dock, delta))) }, [apply, syncCompact])

  const rightVisible = compact ? compactOpen : state.layout !== 'hidden'
  const full = !compact && rightVisible && state.layout === 'full'
  const bottomVisible = state.bottomOpen && state.bottom.tabIds.length > 0
  const isVisible = React.useCallback((id: string) => {
    const dock = panelDockOf(state, id)
    if (dock === 'right') return rightVisible && state.right.activeId === id
    if (dock === 'bottom') return bottomVisible && !full && state.bottom.activeId === id
    return false
  }, [bottomVisible, full, rightVisible, state])

  return React.useMemo(() => ({
    state,
    rightVisible,
    bottomVisible: bottomVisible && !full,
    full,
    isVisible,
    open,
    select,
    close,
    closeOthers,
    move,
    drop,
    retain,
    toggleTabs,
    cycleLayout,
    toggleFull,
    revealConversation,
    hideRight,
    setBottom,
    cycleTab,
  }), [bottomVisible, close, closeOthers, cycleLayout, cycleTab, drop, full, hideRight, isVisible, move, open, retain, revealConversation, rightVisible, select, setBottom, state, toggleFull, toggleTabs])
}

export type ConversationPanel = ReturnType<typeof useConversationPanel>
export { EMPTY_PANEL_TABS }
