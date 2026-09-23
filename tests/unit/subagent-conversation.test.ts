import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { SubagentConversation, subagentConversationViews } from '../../src/components/chat/SubagentConversation'
import { SubagentExecutionPanel } from '../../src/components/inspector/SubagentExecutionPanel'
import { TooltipProvider } from '../../src/components/ui/tooltip'
import { mergeSubagentPresentation, presentToolCall } from '../../src/renderer/pi-rpc/tool-presenters'
import type { SubagentPresentation } from '../../src/types/chat'

vi.mock('@/i18n', () => ({ useT: () => (key: string) => key }))
vi.mock('@/store/settings', () => ({ useSettings: () => ({ appearance: { wordWrap: true, showLineNumbers: true, reducedMotion: true } }) }))

const tasks = [
  { agent: 'worker', task: '## First task\n\nReview the UI.' },
  { agent: 'worker', task: '## Second task\n\nRun the tests.' },
]
const message = (text: string) => ({ role: 'assistant', content: [{ type: 'text', text }] })
function parallel(results: unknown[], partial = true) {
  return presentToolCall({ id: 'parallel', name: 'subagent', args: { tasks }, phase: partial ? 'running' : 'complete', resultIsPartial: partial, resultDetails: { results } })
}
function render(presentation: SubagentPresentation, selectedViewId?: string) {
  return renderToStaticMarkup(createElement(TooltipProvider, null, createElement(SubagentConversation, { presentation, selectedViewId })))
}

describe('reported subagent conversations', () => {
  it('keeps same-named parallel workers and out-of-order completions attached to their own tasks', () => {
    const call = parallel([
      { ...tasks[1], exitCode: 0, messages: [message('## Test result\n\nChecks **passed**.')] },
      { ...tasks[0], exitCode: -1, messages: [message('Review in progress.')] },
    ], false)
    const views = subagentConversationViews(call.subagent!)
    expect(views).toHaveLength(2)
    expect(views[0]).toMatchObject({ task: { id: 'tasks:1' }, status: 'success', events: [{ kind: 'result', state: 'complete' }] })
    expect(views[1]).toMatchObject({ task: { id: 'tasks:0' }, status: 'running', events: [{ kind: 'progress', state: 'active' }] })
    const markup = render(call.subagent!, 'result:0')
    expect(markup).toContain('<h2>Second task</h2>')
    expect(markup).toContain('<h2>Test result</h2>')
    expect(markup).toContain('<strong>passed</strong>')
    expect(markup).not.toContain('<h2>First task</h2>')
    expect(markup).not.toContain('Review in progress.')
    expect(markup).toContain('inspector.subagent.redesign.selectAgent')
  })

  it('does not guess which repeated agent name owns a result without task identity', () => {
    const call = parallel([{ agent: 'worker', exitCode: 0, messages: [message('A reported result.')] }])
    const views = subagentConversationViews(call.subagent!)
    expect(views[0]?.task).toBeUndefined()
    expect(views.slice(1).every((view) => view.events.length === 0)).toBe(true)
    const markup = render(call.subagent!, 'result:0')
    expect(markup).toContain('inspector.subagent.redesign.unmatchedTask')
    expect(markup).not.toContain('<h2>First task</h2>')
    expect(markup).not.toContain('<h2>Second task</h2>')
  })

  it('keeps the aggregate dispatch summary behind a disclosure while viewing one parallel child', () => {
    const call = parallel([{ ...tasks[0], exitCode: 0, messages: [message('Selected task result.')] }, { ...tasks[1], exitCode: 0, messages: [message('Other task result.')] }], false)
    const presentation = { ...call.subagent!, output: { kind: 'result' as const, markdown: 'Combined report includes the other task.', truncated: false } }
    const markup = render(presentation, 'result:0')
    expect(markup).toContain('Selected task result.')
    expect(markup).not.toContain('Other task result.')
    expect(markup).not.toContain('Combined report includes the other task.')
    expect(markup).toContain('inspector.subagent.redesign.runSummary')
  })

  it.each([
    [{ exitCode: 0 }, 'success'],
    [{ exitCode: 2 }, 'failed'],
    [{ exitCode: 0, stopReason: 'aborted' }, 'cancelled'],
    [{ exitCode: 130, stopReason: 'aborted' }, 'cancelled'],
    [{ exitCode: -1, detached: true }, 'detached'],
    [{ exitCode: 0, detached: true }, 'success'],
    [{ exitCode: -1 }, 'running'],
    [{}, undefined],
  ] as const)('uses authoritative run state %j', (state, expected) => {
    const call = parallel([{ ...tasks[0], ...state, messages: [message('This text claims everything is successful.')] }], false)
    expect(subagentConversationViews(call.subagent!)[0]?.status).toBe(expected)
  })

  it('does not treat the official Pi streaming exitCode zero placeholder as completion', () => {
    const call = parallel([{ ...tasks[0], exitCode: 0, messages: [message('Still producing output.')] }])
    expect(call.subagent?.runs?.[0]).toMatchObject({ awaitingCompletion: true })
    expect(call.subagent?.runs?.[0]?.status).toBeUndefined()
    expect(call.subagent?.timeline?.[0]).toMatchObject({ kind: 'progress', state: 'active' })
    expect(render(call.subagent!)).toContain('inspector.subagent.redesign.awaitingCompletion')
  })

  it('keeps repeated identical task names in their official parallel slots through partial and final updates', () => {
    const identical = [tasks[0], tasks[0]]
    const started = presentToolCall({ id: 'same-agent', name: 'subagent', args: { tasks: identical }, phase: 'running', resultIsPartial: true, resultDetails: { mode: 'parallel', results: [
      { ...tasks[0], exitCode: -1, messages: [] },
      { ...tasks[0], exitCode: 0, messages: [message('Second task output.')] },
    ] } })
    const finished = presentToolCall({ id: 'same-agent', name: 'subagent', args: undefined, phase: 'complete', resultDetails: { mode: 'parallel', results: [
      { agent: 'worker', exitCode: 2, messages: [message('First task failed.')] },
      { agent: 'worker', exitCode: 0, messages: [message('Second task complete.')] },
    ] } })
    const views = subagentConversationViews(mergeSubagentPresentation(started.subagent, finished.subagent)!)
    expect(views).toHaveLength(2)
    expect(views[0]).toMatchObject({ task: { id: 'tasks:0' }, status: 'failed', events: [{ markdown: 'First task failed.' }] })
    expect(views[1]).toMatchObject({ task: { id: 'tasks:1' }, status: 'success', events: [{ markdown: 'Second task complete.' }] })
  })

  it('matches chained tasks by the reported step and shows the actual substituted instructions', () => {
    const call = presentToolCall({ id: 'chain', name: 'subagent', args: { chain: [{ agent: 'worker', task: 'Inspect.' }, { agent: 'worker', task: 'Review {previous}' }] }, phase: 'running', resultIsPartial: true, resultDetails: { mode: 'chain', results: [
      { agent: 'worker', task: 'Inspect.', step: 1, exitCode: 0, messages: [message('First result.')] },
      { agent: 'worker', task: 'Review First result.', step: 2, exitCode: 0, messages: [message('Reviewing.')] },
    ] } })
    const views = subagentConversationViews(call.subagent!)
    expect(views).toHaveLength(2)
    expect(views[0]).toMatchObject({ task: { id: 'chain:0' }, status: 'success' })
    expect(views[1]).toMatchObject({ task: { id: 'chain:1', markdown: 'Review First result.' }, awaitingCompletion: true })
    expect(render(call.subagent!, 'result:1')).toContain('Review First result.')
  })

  it('keeps reported child failure and cancellation visible after a successful dispatch', () => {
    for (const [state, expected] of [[{ exitCode: 2 }, 'failed'], [{ exitCode: 130, stopReason: 'aborted' }, 'cancelled']] as const) {
      const call = presentToolCall({ id: 'settled-child', name: 'subagent', args: tasks[0], phase: 'complete', resultDetails: { results: [{ ...tasks[0], ...state, messages: [message('Last reported message.')] }] } })
      expect(call.status).toBe(expected)
      expect(call.subagent?.timeline?.[0]?.state).toBe(expected)
      expect(call.subagent?.timeline?.[0]?.kind).toBe(expected === 'failed' ? 'error' : 'result')
    }
  })

  it('shows the official aborted result as cancelled even when its tool return sets isError', () => {
    const call = presentToolCall({ id: 'aborted', name: 'subagent', args: tasks[0], phase: 'complete', isError: true, resultDetails: { results: [{ ...tasks[0], exitCode: 130, stopReason: 'aborted', errorMessage: 'The task was cancelled.' }] } })
    expect(call.status).toBe('cancelled')
    expect(call.subagent?.runs?.[0]?.summary?.markdown).toBe('The task was cancelled.')
  })

  it('labels summary-only results without fabricating a child transcript or completion state', () => {
    const call = presentToolCall({ id: 'summary', name: 'subagent', args: tasks[0], phase: 'complete', resultText: '## Summary\n\nReviewed **the shell**.' })
    const markup = render(call.subagent!)
    expect(markup).toContain('inspector.subagent.redesign.summaryOnly')
    expect(markup).toContain('<h2>Summary</h2>')
    expect(markup).toContain('<strong>the shell</strong>')
    expect(markup).not.toContain('data-subagent-event=')
    expect(markup).toContain('inspector.subagent.redesign.unreportedStatus')
  })

  it('shows an individual run summary while explicitly noting that child messages are unavailable', () => {
    const call = parallel([{ ...tasks[1], exitCode: 2, output: '## Failed check\n\nOne test failed.' }])
    const markup = render(call.subagent!, 'result:0')
    expect(markup).toContain('inspector.subagent.redesign.summaryOnly')
    expect(markup).toContain('<h2>Failed check</h2>')
    expect(markup).toContain('tool.status.failed')
    expect(markup).not.toContain('data-subagent-event=')
  })

  it('keeps Bash commands and output literal and leaves an unreported tool outcome unknown', () => {
    const call = parallel([{ ...tasks[0], exitCode: 0, messages: [
      { role: 'assistant', content: [{ type: 'toolCall', id: 'bash-1', name: 'bash', arguments: { command: '# literal command\nprintf test' } }] },
    ] }], false)
    expect(call.subagent?.timeline?.[0]?.state).toBe('unknown')
    const markup = render(call.subagent!)
    expect(markup).toContain('# literal command')
    expect(markup).toContain('printf test')
    expect(markup).not.toContain('<h1>literal command</h1>')
    expect(markup).toContain('inspector.subagent.redesign.unreportedStatus')
  })

  it('preserves literal child tool output including terminal and scheduler-like lines', () => {
    const output = '\u001b[32mready\u001b[0m\rupdated\nRun fan-out: actual tool output'
    const call = parallel([{ ...tasks[0], exitCode: 0, messages: [{ role: 'toolResult', toolName: 'bash', isError: false, content: [{ type: 'text', text: output }] }] }])
    expect(call.subagent?.timeline?.[0]?.markdown).toBe(output)
    expect(call.subagent?.timeline?.[0]).toMatchObject({ source: 'tool', state: 'complete' })
    expect(render(call.subagent!)).toContain('Run fan-out: actual tool output')
  })

  it('reconnects result-only updates to original task instructions', () => {
    const started = parallel([{ ...tasks[0], exitCode: -1, messages: [message('Working.')] }])
    const finished = presentToolCall({ id: 'parallel', name: 'subagent', args: undefined, phase: 'complete', resultDetails: { results: [{ ...tasks[0], exitCode: 0, messages: [message('Done.')] }] } })
    const merged = mergeSubagentPresentation(started.subagent, finished.subagent)!
    expect(subagentConversationViews(merged)[0]).toMatchObject({ task: { id: 'tasks:0' }, status: 'success' })
    expect(subagentConversationViews(merged)[0]?.events.map((event) => event.markdown)).toEqual(['Done.'])
  })

  it('preserves observed messages without keeping an unmatched tool active after a summary-only completion', () => {
    const started = parallel([{ ...tasks[0], exitCode: -1, messages: [{ role: 'assistant', content: [{ type: 'toolCall', name: 'bash', id: 'tool-1', arguments: { command: 'pnpm test' } }] }] }])
    const finished = presentToolCall({ id: 'parallel', name: 'subagent', args: undefined, phase: 'complete', resultDetails: { results: [{ ...tasks[0], exitCode: 0, summary: 'Checks completed.' }] } })
    const merged = mergeSubagentPresentation(started.subagent, finished.subagent)!
    expect(subagentConversationViews(merged)[0]).toMatchObject({ status: 'success', events: [{ kind: 'tool', state: 'unknown', markdown: 'pnpm test' }] })
    expect(render(merged)).toContain('Checks completed.')
  })

  it('drops stale events when a compatibility result snapshot changes the task assigned to a slot', () => {
    const started = parallel([{ ...tasks[0], exitCode: -1, messages: [message('First message.'), message('Only first task.')] }])
    const changed = parallel([{ ...tasks[1], exitCode: 0, messages: [message('Second message.')] }], false)
    const merged = mergeSubagentPresentation(started.subagent, changed.subagent)!
    expect(subagentConversationViews(merged)[0]?.events.map((event) => event.markdown)).toEqual(['Second message.'])
    expect(render(merged)).not.toContain('Only first task.')
  })

  it('renders a normal flex panel with expansion and no replacement composer', () => {
    const call = parallel([{ ...tasks[0], exitCode: -1, messages: [message('Working.')] }])
    const markup = renderToStaticMarkup(createElement(TooltipProvider, null, createElement(SubagentExecutionPanel, { call, onClose: () => undefined, onExpand: () => undefined })))
    const root = markup.match(/<section[^>]*data-subagent-execution-panel="parallel"[^>]*>/u)?.[0]
    expect(root).toContain('flex h-full min-h-0')
    expect(root).not.toContain('absolute')
    expect(markup).toContain('inspector.subagent.redesign.expand')
    expect(markup).toContain('inspector.subagent.redesign.readOnly')
    expect(markup).not.toContain('<textarea')
    expect(markup).not.toContain('<form')
  })
})
