import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ActivityRail } from '../../src/components/frame/ActivityRail'
import { ContextPanel } from '../../src/components/frame/ContextPanel'
import { SettingsNavigation } from '../../src/components/frame/SettingsNavigation'
import { TooltipProvider } from '../../src/components/ui/tooltip'

vi.mock('@/i18n', () => ({ useT: () => (key: string) => key }))
vi.mock('@/components/frame/GlobalNotifications', () => ({
  GlobalNotifications: () => createElement('button', { 'aria-label': 'notifications' }),
}))

function renderNavigation(open: boolean, rail: 'sessions' | 'settings' = 'sessions') {
  return renderToStaticMarkup(createElement(TooltipProvider, null, createElement(ActivityRail, {
    rail,
    contextPanelOpen: open,
    width: 272,
    onRailChange: () => undefined,
    onToggleContextPanel: () => undefined,
    onOpenPalette: () => undefined,
    onOpenAbout: () => undefined,
    onOpenNotification: async () => undefined,
  }, createElement(ContextPanel, {
    rail,
    hidden: !open,
    showHeader: false,
    children: createElement('div', { 'data-retained-body': true }, 'sessions'),
  }))))
}

describe('unified sidebar presentation', () => {
  it('uses one width-controlled column with branded Sessions and footer navigation', () => {
    const markup = renderNavigation(true)

    expect(markup).toContain('data-navigation-layout="sidebar"')
    expect(markup).toContain('style="width:272px"')
    expect(markup).toContain('app.name')
    expect(markup).toContain('<nav aria-label="rail.nav"')
    expect(markup.match(/aria-label="rail.sessions"/gu)).toHaveLength(2)
    expect(markup.match(/<button[^>]+aria-label="rail.sessions"/gu)).toHaveLength(1)
    expect(markup).toMatch(/aria-label="rail.sessions"[^>]+aria-current="page"/u)
    expect(markup).toMatch(/aria-label="rail.togglePanel"[^>]+aria-expanded="true"/u)
    expect(markup).not.toContain('<h2')
  })

  it('retains the sidebar body and every shortcut destination while collapsed', () => {
    const markup = renderNavigation(false, 'settings')

    expect(markup).toContain('data-navigation-layout="rail"')
    expect(markup).not.toContain('style="width:272px"')
    expect(markup).toContain('<section hidden="" aria-label="rail.settings"')
    expect(markup).toContain('data-retained-body="true"')
    for (const label of ['rail.sessions', 'rail.settings', 'rail.palette', 'rail.togglePanel', 'notifications']) {
      expect(markup).toContain(`aria-label="${label}"`)
    }
    expect(markup).toMatch(/aria-label="rail.settings"[^>]+aria-current="page"/u)
    expect(markup).toMatch(/aria-label="rail.togglePanel"[^>]+aria-expanded="false"/u)
  })

  it('keeps the settings heading and current section identifiable', () => {
    const markup = renderToStaticMarkup(createElement(SettingsNavigation, {
      section: 'models',
      onSelect: () => undefined,
    }))

    expect(markup).toMatch(/<h2[^>]*>rail.settings<\/h2>/u)
    expect(markup).toMatch(/data-context-panel-nav-id="models"[^>]+aria-current="page"/u)
  })
})
