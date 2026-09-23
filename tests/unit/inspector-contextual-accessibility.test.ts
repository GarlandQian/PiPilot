import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { InspectorPanel } from '../../src/components/inspector/InspectorPanel'
import { INSPECTOR_TABS, isInspectorTab } from '../../src/components/inspector/InspectorView'
import { TooltipProvider } from '../../src/components/ui/tooltip'
import { presentToolCall } from '../../src/renderer/pi-rpc/tool-presenters'

const workspace = vi.hoisted(() => ({ project: false, available: true, stale: false }))

vi.mock('@/i18n', () => ({ useT: () => (key: string) => key }))
vi.mock('@/store/settings', () => ({ useSettings: () => ({ appearance: { reducedMotion: true } }) }))
vi.mock('@/store/workspace', () => ({
  useWorkspaceStore: () => ({
    mode: 'electron',
    activeScope: workspace.project ? { kind: 'project', workspaceId: 'project-a' } : { kind: 'projectless' },
    workspace: workspace.project ? { id: workspace.stale ? 'project-b' : 'project-a', name: 'Project A', available: workspace.available } : null,
  }),
}))
vi.mock('@/renderer/adapters/workspace-adapter', () => ({ createDefaultWorkspaceAdapter: () => ({ files: {}, changes: {} }) }))

const call = presentToolCall({
  id: 'contextual-subagent', name: 'subagent', phase: 'complete',
  args: { agent: 'reviewer', task: 'Review current work.' },
  resultText: 'Review complete.',
})

function renderInspector(detail: boolean) {
  return renderToStaticMarkup(createElement(TooltipProvider, null, createElement(InspectorPanel, {
    width: 360,
    activeTab: detail ? 'subagent' : 'files',
    conversation: { status: 'loading' },
    sessionKey: 'session-a',
    subagentCall: detail ? call : null,
    onCloseSubagent: () => undefined,
  })))
}

describe('contextual Inspector accessibility', () => {
  it('shows project resources independently of a loading conversation, and keeps an honest no-project state', () => {
    workspace.project = true
    workspace.available = true
    workspace.stale = false
    const loadingConversation = renderInspector(false)
    expect(loadingConversation).toContain('data-workspace-tree')
    expect(loadingConversation).toContain('Project A')
    expect(loadingConversation).not.toContain('inspector.session.loading')
    expect(loadingConversation).not.toContain('inspector.session.noSession')
    workspace.project = false
    expect(renderInspector(false)).toContain('inspector.project.required')
    workspace.project = true
    workspace.available = false
    expect(renderInspector(false)).toContain('inspector.project.unavailable')
    workspace.available = true
    workspace.stale = true
    expect(renderInspector(false)).not.toContain('data-workspace-tree')
    workspace.stale = false
  })
  it.each([false, true])('retains resource tabs and inactive subtrees when a child conversation opens (project=%s)', (project) => {
    workspace.project = project
    const detailMarkup = renderInspector(true)
    const coveredTabs = detailMarkup.match(/<div[^>]*data-inspector-views="true"[^>]*>/u)?.[0]
    expect(coveredTabs).not.toContain('inert=')
    expect(coveredTabs).not.toContain('aria-hidden=')
    expect(detailMarkup).toMatch(/<section[^>]*data-inspector-view="files"[^>]*hidden=""/u)
    expect(detailMarkup).not.toContain('aria-controls="resource-view-subagent"')
    expect(detailMarkup).toMatch(/<section[^>]*role="region"[^>]*data-inspector-view="subagent"/u)
    expect(detailMarkup).toContain('inspector.resource.back')
    expect(detailMarkup).toContain('inspector.tab.files')
    expect(detailMarkup).toContain('data-subagent-execution-panel="contextual-subagent"')

    const ordinaryMarkup = renderInspector(false)
    const ordinaryTabs = ordinaryMarkup.match(/<div[^>]*data-inspector-views="true"[^>]*>/u)?.[0]
    expect(ordinaryTabs).toBeDefined()
    expect(ordinaryTabs).not.toContain('inert=')
    expect(ordinaryTabs).not.toContain('aria-hidden=')
    expect(ordinaryMarkup).not.toContain('data-subagent-execution-panel=')
  })

  it('connects keyboard navigable resource tabs to retained labelled panels', () => {
    workspace.project = true
    const markup = renderInspector(false)
    expect(markup).toContain('role="tablist"')
    expect(markup).toContain('role="tabpanel"')
    const views = markup.match(/<section[^>]*data-inspector-view="[^"]+"[^>]*>/gu) ?? []
    expect(views).toHaveLength(2)
    expect(views[0]).toContain('aria-label="inspector.tab.files"')
    expect(views[0]).not.toContain('hidden=')
    for (const view of views.slice(1)) expect(view).toContain('hidden=""')
    for (const tab of INSPECTOR_TABS) {
      expect(markup).toContain(`id="resource-tab-${tab}"`)
      expect(markup).toContain(`aria-controls="resource-view-${tab}"`)
      expect(markup).toContain(`id="resource-view-${tab}"`)
      expect(markup).toContain(`aria-labelledby="resource-tab-${tab}"`)
    }
    expect(INSPECTOR_TABS).toEqual(['files', 'diff'])
    expect(isInspectorTab('terminal')).toBe(false)
    expect(isInspectorTab('outline')).toBe(false)
    expect(markup).not.toContain('inspector.tab.outline')
  })
})
