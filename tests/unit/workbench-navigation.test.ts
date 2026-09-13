import { describe, expect, it } from 'vitest'
import {
  createWorkbenchNavigationState,
  reduceWorkbenchNavigation,
} from '../../src/renderer/workbench-navigation'

describe('workbench navigation ownership', () => {
  it('opens an exact settings route atomically even after a different prior section', () => {
    const initial = createWorkbenchNavigationState({ workspace: 'settings', section: 'models' }, true)
    const selected = reduceWorkbenchNavigation(initial, { type: 'settings-section', section: 'general' })
    const reopened = reduceWorkbenchNavigation(selected, { type: 'destination', destination: 'settings' })
    expect(reopened.route).toEqual({ workspace: 'settings', section: 'general' })
    expect(reopened.lastSettingsSection).toBe('general')
  })

  it('retains visited settings ownership across conversation navigation', () => {
    const initial = createWorkbenchNavigationState({ workspace: 'conversation', context: 'sessions' }, true)
    expect(initial.settingsVisited).toBe(false)
    const models = reduceWorkbenchNavigation(initial, { type: 'settings-section', section: 'models' })
    const conversation = reduceWorkbenchNavigation(models, { type: 'destination', destination: 'sessions' })
    expect(conversation.route).toEqual({ workspace: 'conversation', context: 'sessions' })
    expect(conversation.settingsVisited).toBe(true)
    expect(reduceWorkbenchNavigation(conversation, { type: 'destination', destination: 'settings' }).route)
      .toEqual({ workspace: 'settings', section: 'models' })
  })

  it('keeps panel and palette actions independent of route identity', () => {
    const initial = createWorkbenchNavigationState({ workspace: 'settings', section: 'integrations' }, false)
    const toggled = reduceWorkbenchNavigation(initial, { type: 'toggle-context-panel' })
    const opened = reduceWorkbenchNavigation(toggled, { type: 'palette', open: true })
    expect(opened.contextPanelOpen).toBe(true)
    expect(opened.paletteOpen).toBe(true)
    expect(opened.route).toBe(initial.route)
    expect(reduceWorkbenchNavigation(opened, { type: 'palette', open: true })).toBe(opened)
  })
})
