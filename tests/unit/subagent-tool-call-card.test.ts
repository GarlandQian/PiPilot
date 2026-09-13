import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ToolCallCard } from '../../src/components/chat/ToolCallCard'
import { SubagentExecutionPanel } from '../../src/components/inspector/SubagentExecutionPanel'
import { TooltipProvider } from '../../src/components/ui/tooltip'
import { presentToolCall } from '../../src/renderer/pi-rpc/tool-presenters'
import type { ToolCall } from '../../src/types/chat'

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
      compactToolCards: false,
      showLineNumbers: true,
      wordWrap: true,
    },
  }),
}))

function renderSubagentCard() {
  const call = presentToolCall({
    id: 'subagent-card',
    name: 'subagent',
    args: {
      agent: 'project-worker',
      task: 'Active task: project/tasks/private\n\n## Preserve behavior\n\n- Keep the existing contract.\n- Render **Markdown**.',
    },
    phase: 'complete',
    resultText: `Run fan-out: 0/64 used, 64 remaining
Async workflow [325bb64b-1779-4163-b44c-9179e8092a26]

The async run is detached and running in the background.
Do NOT call subagent_wait merely to wait.`,
  })
  return renderToStaticMarkup(createElement(
    TooltipProvider,
    null,
    createElement(ToolCallCard, { call }),
  ))
}

function renderTimelineCard() {
  const call = presentToolCall({
    id: 'subagent-timeline-card',
    name: 'subagent',
    args: { agent: 'worker', task: 'Run the checks.' },
    phase: 'complete',
    resultDetails: {
      results: [{
        agent: 'worker',
        exitCode: 0,
        messages: [
          {
            role: 'assistant',
            content: [{ type: 'toolCall', id: 'tool-1', name: 'bash', arguments: { command: 'pnpm test' } }],
          },
          {
            role: 'toolResult',
            toolCallId: 'tool-1',
            toolName: 'bash',
            isError: false,
            content: [{ type: 'text', text: 'Focused checks passed.' }],
          },
          {
            role: 'assistant',
            content: [{ type: 'text', text: '## Done\n\nEverything is green.' }],
          },
        ],
      }],
    },
    resultText: '## Done\n\nEverything is green.',
  })
  return renderToStaticMarkup(createElement(
    TooltipProvider,
    null,
    createElement(ToolCallCard, { call }),
  ))
}

describe('ToolCallCard subagent details', () => {
  it('renders the cleaned task as Markdown without the generic JSON tree', () => {
    const markup = renderSubagentCard()

    expect(markup).toContain('<h2>Preserve behavior</h2>')
    expect(markup).toContain('<strong>Markdown</strong>')
    expect(markup).toContain('tool.subagent.task')
    expect(markup).not.toContain('project/tasks/private')
    expect(markup).not.toContain('tool.arguments')
    expect(markup).not.toContain('tool.result')
    expect(markup).not.toContain('tool.valueTruncated')
    expect(markup).not.toMatch(/Run fan-out|Async workflow|subagent_wait/iu)
  })

  it('renders observable subagent execution as a compact ordered timeline', () => {
    const markup = renderTimelineCard()

    expect(markup).toContain('tool.subagent.execution')
    expect(markup).toContain('pnpm test')
    expect(markup).toContain('Focused checks passed.')
    expect(markup).toContain('<h2>Done</h2>')
    expect(markup).toContain('Everything is green.')
    expect(markup).not.toContain('"arguments"')
  })

  it('renders Bash as a command and output without an arguments section', () => {
    const call = presentToolCall({
      id: 'shell-card',
      name: 'bash',
      args: { command: 'pnpm test', cwd: '/workspace', timeout: 30_000 },
      phase: 'complete',
      resultText: 'All tests passed.',
    })
    const markup = renderToStaticMarkup(createElement(
      TooltipProvider,
      null,
      createElement(ToolCallCard, { call }),
    ))

    expect(markup).toContain('pnpm test')
    expect(markup).toContain('All tests passed.')
    expect(markup).not.toContain('tool.arguments')
    expect(markup).not.toContain('30_000')
    expect(markup).toContain('data-tool-kind="shell"')
  })

  it('labels Bash output that was bounded before rendering', () => {
    const call = presentToolCall({
      id: 'shell-bounded-card',
      name: 'bash',
      args: { command: 'pnpm test' },
      phase: 'complete',
      resultText: 'bounded output…',
      resultPresentation: 'plain-text',
      resultTruncated: true,
    })
    const markup = renderToStaticMarkup(createElement(
      TooltipProvider,
      null,
      createElement(ToolCallCard, { call }),
    ))

    expect(markup).toContain('bounded output…')
    expect(markup).toContain('tool.outputTruncated')
    expect(markup).not.toContain('tool.arguments')
  })

  it('formats Markdown-shaped Bash evidence and retains a raw evidence view', () => {
    const call = presentToolCall({
      id: 'shell-markdown-card',
      name: 'bash',
      args: { command: 'pnpm test' },
      phase: 'complete',
      resultText: '## Checks\n\n- Unit tests passed.\n- Typecheck passed.',
    })
    const markup = renderToStaticMarkup(createElement(
      TooltipProvider,
      null,
      createElement(ToolCallCard, { call }),
    ))

    expect(markup).toContain('<h2>Checks</h2>')
    expect(markup).toContain('<li>Unit tests passed.</li>')
    expect(markup).toContain('tool.outputFormatted')
    expect(markup).toContain('tool.outputRaw')
    expect(markup).not.toContain('tool.arguments')
  })

  it.each(['README.md', 'report.txt'])('renders Markdown read from %s and retains original input through Source', (path) => {
    const call = presentToolCall({
      id: 'read-markdown-file',
      name: 'read',
      args: { path, offset: 20, limit: 40 },
      phase: 'complete',
      resultText: '## Notes\n\n- Keep **literal** Markdown.\n- Preserve this source.',
      resultPresentation: 'plain-text',
    })
    const markup = renderToStaticMarkup(createElement(
      TooltipProvider,
      null,
      createElement(ToolCallCard, { call }),
    ))

    expect(markup).toContain(path)
    expect(markup).toContain('<h2>Notes</h2>')
    expect(markup).toContain('<strong>literal</strong>')
    expect(markup).not.toContain('tool.arguments')
    expect(markup).toContain('tool.source')
  })

  it.each([
    ['single list', '- Only one item.', '<li>Only one item.</li>'],
    ['inline formatting', 'The check **passed**.', '<strong>passed</strong>'],
    ['indented heading', '  ## Checks', '<h2>Checks</h2>'],
    ['table', '| Name | State |\n| --- | --- |\n| Test | Pass |', '<th>Name</th>'],
    ['fenced code with tabs', '~~~ts\nconst value = 1;\n\tconsole.log(value);\n~~~', '<figcaption'],
  ])('renders %s in shell result Markdown without first switching views', (_label, source, expected) => {
    const call = presentToolCall({
      id: 'shell-readable-markdown',
      name: 'bash',
      args: { command: 'printf "# Literal command"' },
      phase: 'complete',
      resultText: source,
      resultPresentation: 'plain-text',
    })
    const markup = renderToStaticMarkup(createElement(
      TooltipProvider,
      null,
      createElement(ToolCallCard, { call }),
    ))

    expect(markup).toContain(expected)
    expect(markup).toContain('tool.command')
    expect(markup).toContain('tool.result')
    expect(markup).toContain('tool.outputRaw')
    expect(markup).not.toContain('<h1>Literal command</h1>')
  })

  it('preserves code file contents and terminal log spacing as source', () => {
    const cases = [
      presentToolCall({
        id: 'read-code',
        name: 'read',
        args: { path: 'script.sh' },
        phase: 'complete',
        resultText: '# Keep this comment\nprintf "**literal**"',
        resultPresentation: 'plain-text',
      }),
      presentToolCall({
        id: 'shell-logs',
        name: 'bash',
        args: { command: 'pnpm test' },
        phase: 'complete',
        resultText: '2026-09-08 INFO  start\n2026-09-08 INFO  done',
        resultPresentation: 'plain-text',
      }),
    ]
    const markup = renderToStaticMarkup(createElement(
      TooltipProvider,
      null,
      ...cases.map((call) => createElement(ToolCallCard, { key: call.id, call })),
    ))

    expect(markup).toContain('# Keep this comment')
    expect(markup).toContain('**literal**')
    expect(markup).not.toContain('<h1>Keep this comment</h1>')
    expect(markup).toContain('2026-09-08 INFO  start\n2026-09-08 INFO  done')
  })

  it.each([
    ['.env', '# Configuration\nTEMPLATE="<app>**literal**</app>"', '&lt;app&gt;**literal**&lt;/app&gt;'],
    ['config/.env.production.local', '# Configuration\nTEMPLATE="<app>**literal**</app>"', '&lt;app&gt;**literal**&lt;/app&gt;'],
    ['build.cjs', 'module.exports = "<app>**literal**</app>";', '&lt;app&gt;**literal**&lt;/app&gt;'],
    ['module.cts', 'export const template: string = "<app>**literal**</app>";', '&lt;app&gt;**literal**&lt;/app&gt;'],
    ['scripts/check.bash', '# Configuration\nprintf "<app>**literal**</app>"', '&lt;app&gt;**literal**&lt;/app&gt;'],
    ['assets/icon.svg', '<svg><title>**literal**</title></svg>', '&lt;title&gt;**literal**&lt;/title&gt;'],
  ])('keeps %s source content visible instead of treating it as Markdown', (path, source, visibleSource) => {
    const call = presentToolCall({
      id: 'read-source-fidelity',
      name: 'read',
      args: { path },
      phase: 'complete',
      resultText: source,
      resultPresentation: 'plain-text',
    })
    const markup = renderToStaticMarkup(createElement(
      TooltipProvider,
      null,
      createElement(ToolCallCard, { call }),
    ))

    expect(markup).toContain(visibleSource)
    expect(markup).not.toContain('<h1>Configuration</h1>')
    expect(markup).not.toContain('<strong>literal</strong>')
  })

  it('shows edit content directly without interpreting code as Markdown', () => {
    const call = presentToolCall({
      id: 'edit-markdown-file',
      name: 'edit',
      args: { path: 'README.md', oldText: '# Before', newText: '# After\n\n**Keep source**' },
      phase: 'complete',
      resultText: 'Successfully replaced text in README.md.',
      resultPresentation: 'plain-text',
    })
    const markup = renderToStaticMarkup(createElement(
      TooltipProvider,
      null,
      createElement(ToolCallCard, { call }),
    ))

    expect(markup).toContain('tool.previousContent')
    expect(markup).toContain('# Before')
    expect(markup).toContain('tool.newContent')
    expect(markup).toContain('**Keep source**')
    expect(markup).not.toContain('<h1>After</h1>')
    expect(markup).not.toContain('&quot;oldText&quot;')
  })

  it('shows structured result fields directly and keeps their serialized source secondary', () => {
    const call = presentToolCall({
      id: 'generic-result-fields',
      name: 'inspect',
      args: { path: 'src/main.ts' },
      phase: 'complete',
      resultDetails: { message: 'Inspection complete.', files: ['src/main.ts', 'src/App.tsx'] },
    })
    const markup = renderToStaticMarkup(createElement(
      TooltipProvider,
      null,
      createElement(ToolCallCard, { call }),
    ))

    expect(markup).toContain('Inspection complete.')
    expect(markup).toContain('src/App.tsx')
    expect(markup).toContain('tool.source')
    expect(markup).not.toContain('&quot;message&quot;')
    expect(markup).not.toContain('<summary')
  })

  it('renders Markdown inside structured result prose and keeps code fields literal', () => {
    const call = presentToolCall({
      id: 'structured-markdown-result',
      name: 'inspect',
      args: { path: 'src/main.ts' },
      phase: 'complete',
      resultDetails: {
        message: '## Inspection\n\n- One finding.',
        report: '| Check | State |\n| --- | --- |\n| Types | **Pass** |',
        source: '# Exact source\n**do not format**',
        files: ['src/[id].tsx'],
      },
    })
    const markup = renderToStaticMarkup(createElement(
      TooltipProvider,
      null,
      createElement(ToolCallCard, { call }),
    ))

    expect(markup).toContain('<h2>Inspection</h2>')
    expect(markup).toContain('<li>One finding.</li>')
    expect(markup).toContain('<th>Check</th>')
    expect(markup).toContain('<strong>Pass</strong>')
    expect(markup).toContain('# Exact source\n**do not format**')
    expect(markup).toContain('src/[id].tsx')
    expect(markup).toContain('tool.source')
  })

  it.each(['progress', 'output', 'error'] as const)('does not mistake fallback %s Markdown for malformed JSON', (field) => {
    const call: ToolCall = {
      id: `fallback-${field}`,
      kind: 'generic',
      title: 'inspect',
      body: '',
      status: field === 'error' ? 'failed' : 'success',
      [field]: '[Docs](https://example.com) describe **this result**.',
    }
    const markup = renderToStaticMarkup(createElement(
      TooltipProvider,
      null,
      createElement(ToolCallCard, { call }),
    ))

    expect(markup).toContain('href="https://example.com"')
    expect(markup).toContain('<strong>this result</strong>')
    expect(markup).not.toContain('tool.valueMalformed')
  })

  it('renders the same cleaned execution presentation in the contextual inspector', () => {
    const call = presentToolCall({
      id: 'subagent-inspector',
      name: 'subagent',
      args: {
        agent: 'reviewer',
        task: 'Active task: project/tasks/private\n\n## Review renderer\n\n- Check activity ordering.',
      },
      phase: 'complete',
      resultDetails: {
        results: [{
          agent: 'reviewer',
          exitCode: 0,
          messages: [{
            role: 'assistant',
            content: [{ type: 'text', text: '## Complete\n\nNo blocking issues.' }],
          }],
        }],
      },
      resultText: '## Complete\n\nNo blocking issues.',
    })
    const markup = renderToStaticMarkup(createElement(
      TooltipProvider,
      null,
      createElement(SubagentExecutionPanel, { call, onClose: () => undefined }),
    ))

    expect(markup).toContain('data-subagent-execution-panel="subagent-inspector"')
    expect(markup).toContain('aria-expanded="false"')
    expect(markup).toContain('tool.subagent.task')
    expect(markup).not.toContain('<h2>Review renderer</h2>')
    expect(markup).toContain('<h2>Complete</h2>')
    expect(markup).not.toContain('project/tasks/private')
    expect(markup).not.toContain('tool.arguments')
  })
})
