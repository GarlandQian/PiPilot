import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { InspectorPanel } from '../../src/components/inspector/InspectorPanel'
import { INSPECTOR_TABS, isInspectorTab } from '../../src/components/inspector/InspectorView'
import { TooltipProvider } from '../../src/components/ui/tooltip'
import { presentToolCall } from '../../src/renderer/pi-rpc/tool-presenters'

const workspace = vi.hoisted(() => ({ project: false }))

vi.mock('@/i18n', () => ({ useT: () => (key: string) => key }))
vi.mock('@/store/settings', () => ({ useSettings: () => ({ appearance: { reducedMotion: true } }) }))
vi.mock('@/store/workspace', () => ({
  useWorkspaceStore: () => ({
    mode: 'electron',
    activeScope: { kind: 'projectless' },
    workspace: workspace.project ? { id: 'project-a', name: 'Project A', available: true } : null,
  }),
}))
vi.mock('@/renderer/adapters/workspace-adapter', () => ({ createDefaultWorkspaceAdapter: () => null }))

const call = presentToolCall({
  id: 'contextual-subagent', name: 'subagent', phase: 'complete',
  args: { agent: 'reviewer', task: 'Review current work.' },
  resultText: 'Review complete.',
})

function renderInspector(detail: boolean) {
  return renderToStaticMarkup(createElement(TooltipProvider, null, createElement(InspectorPanel, {
    width: 360,
    conversation: { status: 'loading' },
    sessionKey: 'session-a',
    subagentCall: detail ? call : null,
    onCloseSubagent: () => undefined,
  })))
}

describe('contextual Inspector accessibility', () => {
  it.each([false, true])('makes covered views inert while retaining their subtree (project=%s)', (project) => {
    workspace.project = project
    const detailMarkup = renderInspector(true)
    const coveredTabs = detailMarkup.match(/<div[^>]*data-inspector-views="true"[^>]*>/u)?.[0]
    expect(coveredTabs).toContain('inert=""')
    expect(coveredTabs).toContain('aria-hidden="true"')
    expect(detailMarkup).toContain('inspector.tab.files')
    expect(detailMarkup).toContain('data-subagent-execution-panel="contextual-subagent"')

    const ordinaryMarkup = renderInspector(false)
    const ordinaryTabs = ordinaryMarkup.match(/<div[^>]*data-inspector-views="true"[^>]*>/u)?.[0]
    expect(ordinaryTabs).toBeDefined()
    expect(ordinaryTabs).not.toContain('inert=')
    expect(ordinaryTabs).not.toContain('aria-hidden=')
    expect(ordinaryMarkup).not.toContain('data-subagent-execution-panel=')
  })

  it('uses a menu trigger and labelled views without a fake inspector tablist', () => {
    workspace.project = true
    const markup = renderInspector(false)
    expect(markup).toMatch(/<button[^>]*aria-label="inspector.switchView"[^>]*aria-haspopup="menu"/u)
    expect(markup).not.toContain('role="tablist"')
    expect(markup).not.toContain('role="tabpanel"')
    const views = markup.match(/<section[^>]*data-inspector-view="[^"]+"[^>]*>/gu) ?? []
    expect(views).toHaveLength(3)
    expect(views[0]).toContain('aria-label="inspector.tab.files"')
    expect(views[0]).not.toContain('hidden=')
    for (const view of views.slice(1)) expect(view).toContain('hidden=""')
    expect(INSPECTOR_TABS).toEqual(['files', 'diff', 'terminal'])
    expect(isInspectorTab('outline')).toBe(false)
    expect(markup).not.toContain('inspector.tab.outline')
  })
})
