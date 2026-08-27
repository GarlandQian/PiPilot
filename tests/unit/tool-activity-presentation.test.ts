import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ToolActivityRegion } from '../../src/components/chat/ToolActivityRegion'
import { TooltipProvider } from '../../src/components/ui/tooltip'
import {
  projectShellEvidence,
  projectToolActivitySequence,
} from '../../src/renderer/pi-rpc/tool-activity'
import type { ToolCall, Turn } from '../../src/types/chat'

vi.mock('@/i18n', () => ({
  useT: () => (key: string, params?: Record<string, string | number>) => {
    if (!params) return key
    return Object.entries(params).reduce(
      (message, [name, value]) => message.replace(`{${name}}`, String(value)),
      key,
    )
  },
}))

vi.mock('@/store/settings', () => ({
  useSettings: () => ({
    appearance: {
      compactToolCards: true,
      reducedMotion: true,
      showLineNumbers: true,
      wordWrap: true,
    },
  }),
}))

function call(id: string, kind: ToolCall['kind'], status: ToolCall['status'] = 'success'): ToolCall {
  return { id, kind, status, title: id, body: id }
}

function tool(value: ToolCall): Turn {
  return { kind: 'tool', id: `turn:${value.id}`, call: value }
}

describe('tool activity presentation', () => {
  it('groups only contiguous compatible tool activity and preserves narrative order', () => {
    const sequence = projectToolActivitySequence([
      { kind: 'agent', id: 'a1', markdown: 'Starting.' },
      tool(call('bash-1', 'shell')),
      tool(call('bash-2', 'shell', 'failed')),
      tool(call('read-1', 'read')),
      { kind: 'agent', id: 'a2', markdown: 'Done.' },
      tool(call('bash-3', 'shell')),
    ])

    expect(sequence.map((item) => item.id)).toEqual([
      'a1',
      'tool-activity-run:bash-1',
      'a2',
      'tool-activity-run:bash-3',
    ])
    const firstRun = sequence[1]
    expect(firstRun?.kind).toBe('activity-run')
    if (firstRun?.kind !== 'activity-run') return
    expect(firstRun.run.sections.map((section) => section.category)).toEqual([
      'commands',
      'files',
    ])
    expect(firstRun.run.sections[0]).toMatchObject({
      id: 'tool-activity-section:commands:bash-1',
      status: 'failed',
      failedCount: 1,
    })
    expect(firstRun.run.sections[0]?.items.map((item) => item.id)).toEqual(['bash-1', 'bash-2'])
  })

  it('uses exact subagent presentation rather than a generic title heuristic', () => {
    const generic = call('generic-subagent-title', 'generic')
    generic.title = 'subagent'
    const actual = call('actual-subagent', 'generic', 'running')
    actual.subagent = {
      mode: 'single',
      tasks: [{ id: 'task', agent: 'worker', markdown: 'Do work.', truncated: false }],
      omittedTaskCount: 0,
      malformed: false,
    }
    const sequence = projectToolActivitySequence([tool(generic), tool(actual)])
    const run = sequence[0]
    expect(run?.kind).toBe('activity-run')
    if (run?.kind !== 'activity-run') return
    expect(run.run.sections.map((section) => section.category)).toEqual(['other', 'subagents'])
  })

  it('does not move commands across an intervening file operation', () => {
    const sequence = projectToolActivitySequence([
      tool(call('bash-before', 'shell')),
      tool(call('read-middle', 'read')),
      tool(call('bash-after', 'shell')),
    ])
    const run = sequence[0]
    expect(run?.kind).toBe('activity-run')
    if (run?.kind !== 'activity-run') return
    expect(run.run.sections.map((section) => ({
      category: section.category,
      items: section.items.map((item) => item.id),
    }))).toEqual([
      { category: 'commands', items: ['bash-before'] },
      { category: 'files', items: ['read-middle'] },
      { category: 'commands', items: ['bash-after'] },
    ])
  })

  it.each([
    ['heading', '# Results\n\nEverything passed.', 'formatted'],
    ['list', '- First\n- Second', 'formatted'],
    ['table', '| Name | State |\n| --- | --- |\n| Test | Pass |', 'formatted'],
    ['plain', 'All tests passed.', 'raw'],
    ['json', '{"ok":true}', 'raw'],
    ['ansi', '\u001b[32mSuccess\u001b[0m\n- item\n- item', 'raw'],
    ['logs', '2026-08-20 INFO start\n2026-08-20 INFO done', 'raw'],
    ['tabs', '# Report\nname\tvalue', 'raw'],
    ['progress', '50%\r100%\n- done\n- complete', 'raw'],
  ])('classifies %s shell evidence conservatively', (_name, source, expected) => {
    const evidence = projectShellEvidence(source)
    expect(evidence.defaultView).toBe(expected)
    expect(evidence.source).toBe(source)
    expect(Boolean(evidence.formattedMarkdown)).toBe(expected === 'formatted')
  })

  it('bounds evidence without changing the copy source for retained content', () => {
    const evidence = projectShellEvidence(`# Result\n\n${'x'.repeat(100_000)}`)
    expect(evidence.truncated).toBe(true)
    expect(new TextEncoder().encode(evidence.source).byteLength).toBeLessThanOrEqual(96 * 1_024)
    expect(evidence.source.endsWith('…')).toBe(true)
    expect(evidence.formattedMarkdown).toBe(evidence.source)
  })

  it('bounds UTF-8 evidence without splitting surrogate pairs', () => {
    const source = `# Result\n\n${'界'.repeat(40_000)}😀`
    const evidence = projectShellEvidence(source)
    expect(evidence.truncated).toBe(true)
    expect(new TextEncoder().encode(evidence.source).byteLength).toBeLessThanOrEqual(96 * 1_024)
    expect(evidence.source).not.toContain('\uFFFD')
    expect(() => encodeURIComponent(evidence.source)).not.toThrow()
  })

  it('renders repeated commands as one compact category disclosure', () => {
    const sequence = projectToolActivitySequence([
      tool(call('bash-one', 'shell')),
      tool(call('bash-two', 'shell')),
    ])
    const item = sequence[0]
    expect(item?.kind).toBe('activity-run')
    if (item?.kind !== 'activity-run') return

    const markup = renderToStaticMarkup(createElement(
      TooltipProvider,
      null,
      createElement(ToolActivityRegion, {
        run: item.run,
        sessionKey: 'session:1',
      }),
    ))
    expect(markup).toContain('data-tool-activity-category="commands"')
    expect(markup).toContain('tool.activity.commands')
    expect(markup).toContain('aria-expanded="false"')
  })

  it('renders a single subagent as an inspector target instead of inline details', () => {
    const subagent = call('subagent-one', 'generic', 'running')
    subagent.summary = 'reviewer · Review the renderer.'
    subagent.subagent = {
      mode: 'single',
      tasks: [{
        id: 'task-one',
        agent: 'reviewer',
        markdown: '## Review\n\nInspect the renderer.',
        truncated: false,
      }],
      omittedTaskCount: 0,
      malformed: false,
    }
    const sequence = projectToolActivitySequence([tool(subagent)])
    const item = sequence[0]
    expect(item?.kind).toBe('activity-run')
    if (item?.kind !== 'activity-run') return
    const markup = renderToStaticMarkup(createElement(
      TooltipProvider,
      null,
      createElement(ToolActivityRegion, {
        run: item.run,
        sessionKey: 'session:1',
        onOpenSubagent: () => undefined,
      }),
    ))
    expect(markup).toContain('data-subagent-call-id="subagent-one"')
    expect(markup).toContain('aria-controls="subagent-execution-panel"')
    expect(markup).not.toContain('<h2>Review</h2>')
  })
})
