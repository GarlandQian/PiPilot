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
    onNewTask: () => undefined,
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
  it('uses one width-controlled column with a Settings row and notifications in its footer', () => {
    const markup = renderNavigation(true)

    expect(markup).toContain('data-navigation-layout="sidebar"')
    expect(markup).toContain('style="width:272px"')
    expect(markup).toContain('app.name')
    expect(markup).toContain('<nav aria-label="rail.nav"')
    expect(markup).toMatch(/<button[^>]+aria-label="rail.settings"/u)
    expect(markup).toContain('aria-label="notifications"')
    expect(markup).not.toContain('aria-label="nav.redesign.newTask"')
    expect(markup).toMatch(/aria-label="rail.togglePanel"[^>]+aria-expanded="true"/u)
    expect(markup).not.toContain('<h2')
  })

  it('hides the sidebar entirely while collapsed, keeping its body and leaving toggle and New task in the title bar', () => {
    const markup = renderNavigation(false, 'settings')

    expect(markup).toContain('data-navigation-layout="rail"')
    expect(markup).toMatch(/<aside hidden=""/u)
    expect(markup).toContain('<section hidden="" aria-label="rail.settings"')
    expect(markup).toContain('data-retained-body="true"')
    const titleBar = markup.slice(0, markup.indexOf('<aside'))
    expect(titleBar).toMatch(/aria-label="rail.togglePanel"[^>]+aria-expanded="false"/u)
    // In Settings the title bar leads back to the app instead of offering New task.
    expect(titleBar).toContain('aria-label="settings.backToApp"')
    expect(titleBar).not.toContain('aria-label="rail.settings"')
    expect(renderNavigation(false).slice(0, renderNavigation(false).indexOf('<aside'))).toContain('aria-label="nav.redesign.newTask"')
  })

  it('keeps the settings heading and current section identifiable', () => {
    const markup = renderToStaticMarkup(createElement(SettingsNavigation, {
      section: 'models',
      onSelect: () => undefined,
      onBack: () => undefined,
    }))

    expect(markup).toMatch(/<h2[^>]*>rail.settings<\/h2>/u)
    expect(markup).toContain('settings.backToApp')
    expect(markup).toMatch(/data-context-panel-nav-id="models"[^>]+aria-current="page"/u)
  })
})
