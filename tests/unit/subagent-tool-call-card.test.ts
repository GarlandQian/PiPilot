import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ToolCallCard } from '../../src/components/chat/ToolCallCard'
import { SubagentExecutionPanel } from '../../src/components/inspector/SubagentExecutionPanel'
import { TooltipProvider } from '../../src/components/ui/tooltip'
import { presentToolCall } from '../../src/renderer/pi-rpc/tool-presenters'

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
      agent: 'trellis-implement',
      task: 'Active task: .trellis/tasks/private\n\n## Preserve behavior\n\n- Keep the existing contract.\n- Render **Markdown**.',
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
    expect(markup).not.toContain('.trellis/tasks/private')
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

  it('renders the same cleaned execution presentation in the contextual inspector', () => {
    const call = presentToolCall({
      id: 'subagent-inspector',
      name: 'subagent',
      args: {
        agent: 'reviewer',
        task: 'Active task: .trellis/tasks/private\n\n## Review renderer\n\n- Check activity ordering.',
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
    expect(markup).not.toContain('.trellis/tasks/private')
    expect(markup).not.toContain('tool.arguments')
  })
})
