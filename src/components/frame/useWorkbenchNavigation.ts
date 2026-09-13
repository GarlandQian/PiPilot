import * as React from 'react'
import {
  deriveFrameLayoutMode,
  readAppRoute,
  readContextPanelOpen,
  readPanelLayout,
  writeAppRoute,
  writeContextPanelOpen,
  writePanelLayout,
  type SettingsRouteId,
} from '@/renderer/layout-preferences'
import {
  createWorkbenchNavigationState,
  reduceWorkbenchNavigation,
} from '@/renderer/workbench-navigation'
import type { RailDestination } from './ActivityRail'

/** Owns route intent, persisted geometry, shortcuts, and compact focus return. */
export function useWorkbenchNavigation() {
  const [frameNav, dispatch] = React.useReducer(reduceWorkbenchNavigation, undefined, () =>
    createWorkbenchNavigationState(readAppRoute(), readContextPanelOpen()))
  const [panelLayout, setPanelLayout] = React.useState(readPanelLayout)
  const [frameWidth, setFrameWidth] = React.useState(() =>
    typeof window === 'undefined' ? 1_440 : window.innerWidth)
  const [compactSettingsDetailOpen, setCompactSettingsDetailOpen] = React.useState(false)
  const compactSettingsReturnFocusRef = React.useRef<SettingsRouteId | null>(null)
  const [compactInspectorOpen, setCompactInspectorOpen] = React.useState(false)
  const compactInspectorReturnFocusRef = React.useRef<HTMLElement | null>(null)
  const frameLayoutMode = deriveFrameLayoutMode(frameNav.route, frameWidth)
  const compactConversation = frameLayoutMode === 'conversation-compact'

  React.useEffect(() => writeAppRoute(frameNav.route), [frameNav.route])
  React.useEffect(() => writeContextPanelOpen(frameNav.contextPanelOpen), [frameNav.contextPanelOpen])
  React.useEffect(() => writePanelLayout(panelLayout), [panelLayout])
  React.useLayoutEffect(() => {
    const updateWidth = () => setFrameWidth(window.innerWidth)
    updateWidth()
    window.addEventListener('resize', updateWidth)
    return () => window.removeEventListener('resize', updateWidth)
  }, [])

  const setRail = React.useCallback((destination: RailDestination) => {
    setCompactSettingsDetailOpen(false)
    dispatch({ type: 'destination', destination })
  }, [])
  const setSettingsSection = React.useCallback((section: SettingsRouteId) => {
    if (deriveFrameLayoutMode({ workspace: 'settings', section }, frameWidth) === 'settings-compact') {
      compactSettingsReturnFocusRef.current = section
      setCompactSettingsDetailOpen(true)
    }
    dispatch({ type: 'settings-section', section })
  }, [frameWidth])
  const closeCompactSettingsDetail = React.useCallback(() => {
    setCompactSettingsDetailOpen(false)
    const target = compactSettingsReturnFocusRef.current
    compactSettingsReturnFocusRef.current = null
    requestAnimationFrame(() => {
      if (!target) return
      document.querySelector<HTMLElement>(`[data-context-panel-nav-id="${target}"]`)?.focus()
    })
  }, [])
  const toggleContextPanel = React.useCallback(() => dispatch({ type: 'toggle-context-panel' }), [])
  const setPaletteOpen = React.useCallback((open: boolean) => dispatch({ type: 'palette', open }), [])
  const openPalette = React.useCallback(() => setPaletteOpen(true), [setPaletteOpen])
  const toggleInspector = React.useCallback(() => {
    if (compactConversation) {
      setCompactInspectorOpen((current) => {
        if (!current) {
          compactInspectorReturnFocusRef.current = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null
        }
        return !current
      })
    } else {
      setPanelLayout((current) => ({ ...current, inspectorOpen: !current.inspectorOpen }))
    }
  }, [compactConversation])

  React.useEffect(() => {
    if (!compactConversation) setCompactInspectorOpen(false)
  }, [compactConversation])
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.isComposing || event.keyCode === 229) return
      const key = event.key.toLowerCase()
      if (key === 'b') {
        event.preventDefault()
        toggleContextPanel()
      } else if (key === 'j') {
        event.preventDefault()
        toggleInspector()
      } else if (key === 'k') {
        event.preventDefault()
        setPaletteOpen(!frameNav.paletteOpen)
      } else if (key === '1' || key === '2') {
        if (event.target instanceof Element && event.target.closest('[role="dialog"], [role="alertdialog"]')) return
        event.preventDefault()
        setRail(key === '1' ? 'sessions' : 'settings')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [frameNav.paletteOpen, setPaletteOpen, setRail, toggleContextPanel, toggleInspector])

  return {
    frameNav,
    rail: frameNav.route.workspace === 'settings' ? 'settings' as const : frameNav.route.context,
    settingsSection: frameNav.route.workspace === 'settings'
      ? frameNav.route.section : frameNav.lastSettingsSection,
    conversationWorkspace: frameNav.route.workspace === 'conversation',
    frameLayoutMode,
    compactConversation,
    panelLayout,
    setPanelLayout,
    compactSettingsDetailOpen,
    closeCompactSettingsDetail,
    compactInspectorOpen,
    setCompactInspectorOpen,
    compactInspectorReturnFocusRef,
    setRail,
    setSettingsSection,
    setPaletteOpen,
    openPalette,
    toggleContextPanel,
    toggleInspector,
  }
}
