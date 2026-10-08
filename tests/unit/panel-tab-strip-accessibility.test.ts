import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { PanelTabStrip, panelTabDomId, panelViewDomId } from '../../src/components/inspector/PanelTabStrip'
import { RightDock } from '../../src/components/inspector/PanelDocks'
import { TooltipProvider } from '../../src/components/ui/tooltip'

vi.mock('@/i18n', () => ({ useT: () => (key: string, values?: Record<string, string>) => values?.name ? `${key}:${values.name}` : key }))

const tabs = [
  { id: 'review', label: 'Review', icon: null },
  { id: 'file:src/index.ts', label: 'index.ts', title: 'src/index.ts', icon: null },
]
const noop = () => undefined

function strip(activeId: string | null) {
  return renderToStaticMarkup(createElement(TooltipProvider, null, createElement(PanelTabStrip, {
    dock: 'right', tabs, activeId, onSelect: noop, onClose: noop, onCloseOthers: noop, onMove: noop, onDropTab: noop,
    newTabItems: [{ id: 'terminal', label: 'Terminal', icon: null, onSelect: noop }],
  })))
}

describe('panel tab strip accessibility', () => {
  it('is a labelled tablist whose tabs control their own panels', () => {
    const markup = strip('file:src/index.ts')
    expect(markup).toContain('role="tablist"')
    expect(markup).toContain('aria-label="panel.dock.right"')
    for (const tab of tabs) {
      expect(markup).toContain(`id="${panelTabDomId(tab.id)}"`)
      expect(markup).toContain(`aria-controls="${panelViewDomId(tab.id)}"`)
    }
    // Only the selected tab is in the tab order; the others move with the arrow keys.
    expect(markup).toMatch(/aria-selected="true" aria-controls="panel-view-file_src_index_ts" tabindex="0"/u)
    expect(markup).toMatch(/aria-selected="false" aria-controls="panel-view-review" tabindex="-1"/u)
  })

  it('names every close button after its tab, and offers a new tab', () => {
    const markup = strip('review')
    expect(markup).toContain('aria-label="inspector.tab.close:Review"')
    expect(markup).toContain('aria-label="inspector.tab.close:index.ts"')
    expect(markup).toContain('aria-label="inspector.tab.new"')
  })

  it('makes ids safe for any file path', () => {
    expect(panelTabDomId('file:a b/ü.ts')).toBe('panel-tab-file_a_b___ts')
  })

  it('shows what can be opened when the right dock has no tabs', () => {
    const markup = renderToStaticMarkup(createElement(TooltipProvider, null, createElement(RightDock, {
      width: 360, full: false, containers: { get: () => null, release: noop } as never, tabIds: [],
      tabs: [], activeId: null, onSelect: noop, onClose: noop, onCloseOthers: noop, onMove: noop, onDropTab: noop, onHide: noop, onToggleFull: noop,
      newTabItems: [{ id: 'review', label: 'Review', icon: null, shortcut: '⌃⇧G', onSelect: noop }],
    })))
    expect(markup).toContain('data-panel-launcher')
    expect(markup).toContain('⌃⇧G')
    expect(markup).toContain('aria-label="panel.layout.full"')
    expect(markup).toContain('aria-label="inspector.close"')
  })
})
