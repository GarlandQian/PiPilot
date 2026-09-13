import type { AppRoute, SettingsRouteId } from './layout-preferences'

export interface WorkbenchNavigationState {
  route: AppRoute
  lastSettingsSection: SettingsRouteId
  contextPanelOpen: boolean
  paletteOpen: boolean
  settingsVisited: boolean
}

export type WorkbenchNavigationIntent =
  | { type: 'destination'; destination: 'sessions' | 'settings' }
  | { type: 'settings-section'; section: SettingsRouteId }
  | { type: 'toggle-context-panel' }
  | { type: 'palette'; open: boolean }

export function createWorkbenchNavigationState(
  route: AppRoute,
  contextPanelOpen: boolean,
): WorkbenchNavigationState {
  return {
    route,
    contextPanelOpen,
    paletteOpen: false,
    lastSettingsSection: route.workspace === 'settings' ? route.section : 'appearance',
    settingsVisited: route.workspace === 'settings',
  }
}

export function reduceWorkbenchNavigation(
  state: WorkbenchNavigationState,
  intent: WorkbenchNavigationIntent,
): WorkbenchNavigationState {
  switch (intent.type) {
    case 'destination':
      return {
        ...state,
        route: intent.destination === 'settings'
          ? { workspace: 'settings', section: state.lastSettingsSection }
          : { workspace: 'conversation', context: 'sessions' },
        settingsVisited: state.settingsVisited || intent.destination === 'settings',
      }
    case 'settings-section':
      return {
        ...state,
        route: { workspace: 'settings', section: intent.section },
        lastSettingsSection: intent.section,
        settingsVisited: true,
      }
    case 'toggle-context-panel':
      return { ...state, contextPanelOpen: !state.contextPanelOpen }
    case 'palette':
      return state.paletteOpen === intent.open ? state : { ...state, paletteOpen: intent.open }
  }
}
