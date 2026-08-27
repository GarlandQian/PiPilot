import { describe, expect, it } from 'vitest'
import {
  mergeSubagentPresentation,
  presentToolCall,
  toolCallCopyText,
} from '../../src/renderer/pi-rpc/tool-presenters'

const realisticTask = `You are an agent in a team of agents.
Message Type: NEW_TASK
Task name: structured_activity_impl
Sender: root
Payload:
Implement bounded structured projection and focused tests.
Trellis task: .trellis/tasks/private
subagent_wait after completing the scheduler workflow.`

const schedulerAcknowledgement = `Run fan-out: 0/64 used, 64 remaining
Async workflow [325bb64b-1779-4163-b44c-9179e8092a26]

The async run is detached and running in the background.
You are in an interactive session. By default, return control to the user now; Pi will wake you on completion.
Do NOT call subagent_wait merely to wait.`

describe('tool presenter registry', () => {
  it('uses the exact subagent presenter without exposing scheduler boilerplate', () => {
    const call = presentToolCall({
      id: 'subagent-1',
      name: 'subagent',
      args: { agent: 'reviewer', task: realisticTask },
      phase: 'running',
    })

    expect(call).toMatchObject({
      title: 'subagent',
      status: 'running',
      summary: 'reviewer · Implement bounded structured projection and focused tests.',
      malformed: false,
      detached: false,
      body: '',
      details: undefined,
      subagent: {
        mode: 'single',
        malformed: false,
        omittedTaskCount: 0,
        tasks: [{
          agent: 'reviewer',
          markdown: expect.stringContaining('Implement bounded structured projection'),
          truncated: false,
        }],
      },
    })
    expect(call.summary).not.toMatch(/Trellis|scheduler|subagent_wait|workflow/iu)
    expect(call.subagent?.tasks[0]?.markdown).toContain('Trellis task')
    expect(toolCallCopyText(call)).toContain('Trellis task')
    expect(call.body).not.toContain('"agent"')
  })

  it('skips the real Trellis active-task path before choosing a collapsed summary', () => {
    const call = presentToolCall({
      id: 'subagent-active-task',
      name: 'subagent',
      args: {
        agent: 'trellis-implement',
        task: 'Active task: .trellis/tasks/08-17-global-ui-redesign\n\nImplement Phase 6A for the Controllers surface.',
      },
      phase: 'running',
    })

    expect(call.summary).toBe('trellis-implement · Implement Phase 6A for the Controllers surface.')
    expect(call.summary).not.toMatch(/\.trellis|Active task/iu)
    expect(call.subagent?.tasks[0]?.markdown).toBe('Implement Phase 6A for the Controllers surface.')
  })

  it('keeps realistic Markdown task content beyond the generic string-preview limit', () => {
    const markdown = `## Preserve behavior\n\n${'- Keep this contract.\n'.repeat(180)}`
    const call = presentToolCall({
      id: 'long-task',
      name: 'subagent',
      args: { agent: 'implementer', task: markdown },
      phase: 'running',
    })

    expect(markdown.length).toBeGreaterThan(2_048)
    expect(call.subagent?.tasks[0]).toMatchObject({ markdown: markdown.trim(), truncated: false })
  })

  it('does not put sensitive task material in the collapsed summary', () => {
    const call = presentToolCall({
      id: 'sensitive-task',
      name: 'subagent',
      args: {
        agent: 'reviewer',
        task: 'Use this API key:\nsecret-value\n\nVerify the provider.',
      },
      phase: 'queued',
    })

    expect(call.summary).toBe('reviewer')
    expect(call.subagent?.tasks[0]?.markdown).toContain('secret-value')
  })

  it.each([
    ['queued', { phase: 'queued' as const }, 'queued'],
    ['running', { phase: 'running' as const }, 'running'],
    ['completed', { phase: 'complete' as const }, 'success'],
    ['failed', { phase: 'complete' as const, isError: true }, 'failed'],
    [
      'detached',
      { phase: 'complete' as const, resultText: 'Subagent started in the background.' },
      'detached',
    ],
  ])('maps %s subagent state truthfully', (_label, state, status) => {
    expect(presentToolCall({
      id: 'subagent-state',
      name: 'subagent',
      args: { agent: 'reviewer', task: 'Inspect the changes.' },
      ...state,
    }).status).toBe(status)
  })

  it('supports parallel summaries and degrades malformed subagent payloads', () => {
    const parallel = presentToolCall({
      id: 'parallel',
      name: 'subagent',
      args: {
        tasks: [
          { agent: 'reviewer', task: 'Review the UI.' },
          { agent: 'tester', task: 'Run focused tests.' },
        ],
      },
      phase: 'running',
    })
    expect(parallel).toMatchObject({
      summary: 'reviewer, tester [2] · Review the UI.',
      malformed: false,
      subagent: {
        mode: 'parallel',
        omittedTaskCount: 0,
        tasks: [
          { agent: 'reviewer', markdown: 'Review the UI.' },
          { agent: 'tester', markdown: 'Run focused tests.' },
        ],
      },
    })

    const chain = presentToolCall({
      id: 'chain',
      name: 'subagent',
      args: {
        chain: [
          { agent: 'implementer', task: 'Implement the change.' },
          { agent: 'reviewer', task: 'Review the implementation.' },
        ],
      },
      phase: 'queued',
    })
    expect(chain).toMatchObject({
      summary: 'implementer, reviewer →2 · Implement the change.',
      subagent: { mode: 'chain' },
    })

    const malformed = presentToolCall({
      id: 'malformed',
      name: 'subagent',
      args: { agent: 'reviewer' },
      phase: 'queued',
    })
    expect(malformed).toMatchObject({
      malformed: true,
      status: 'queued',
      body: '',
      details: undefined,
      subagent: { mode: 'unknown', tasks: [], malformed: true },
    })
    expect(malformed.summary).toBeUndefined()
  })

  it('normalizes real output and suppresses detached scheduler acknowledgements', () => {
    const detached = presentToolCall({
      id: 'detached',
      name: 'subagent',
      args: { agent: 'reviewer', task: 'Review the implementation.' },
      phase: 'complete',
      resultText: schedulerAcknowledgement,
    })
    expect(detached).toMatchObject({
      status: 'detached',
      subagent: { output: null },
      details: undefined,
    })
    expect(toolCallCopyText(detached)).not.toMatch(/Run fan-out|Async workflow|subagent_wait/iu)

    const completed = presentToolCall({
      id: 'completed',
      name: 'subagent',
      args: { agent: 'reviewer', task: 'Review the implementation.' },
      phase: 'complete',
      resultText: '## Review complete\n\n- No blocking issues.',
    })
    expect(completed.subagent?.output).toEqual({
      kind: 'result',
      markdown: '## Review complete\n\n- No blocking issues.',
      truncated: false,
    })
  })

  it('projects cumulative subagent messages into an ordered bounded timeline', () => {
    const details = {
      mode: 'single',
      results: [{
        agent: 'worker',
        exitCode: 0,
        messages: [
          {
            role: 'assistant',
            content: [{
              type: 'toolCall',
              id: 'tool-1',
              name: 'read',
              arguments: { path: 'src/App.tsx' },
            }],
          },
          {
            role: 'toolResult',
            toolCallId: 'tool-1',
            toolName: 'read',
            isError: false,
            content: [{ type: 'text', text: 'Read the App shell.' }],
          },
          {
            role: 'assistant',
            content: [{ type: 'text', text: '## Review\n\nThe shell is ready.' }],
          },
        ],
      }],
    }
    const call = presentToolCall({
      id: 'timeline',
      name: 'subagent',
      args: { agent: 'worker', task: 'Review the shell.' },
      phase: 'complete',
      resultDetails: details,
      resultText: '## Review\n\nThe shell is ready.',
    })

    expect(call.subagent?.timeline).toEqual([
      expect.objectContaining({
        id: 'result:0:message:0:content:0:tool',
        sequence: 0,
        kind: 'tool',
        state: 'complete',
        toolName: 'read',
        markdown: expect.stringContaining('src/App.tsx'),
      }),
      expect.objectContaining({
        id: 'result:0:message:1:content:0:result',
        sequence: 1,
        kind: 'result',
        state: 'complete',
        markdown: 'Read the App shell.',
      }),
      expect.objectContaining({
        id: 'result:0:message:2:content:0:text',
        sequence: 2,
        kind: 'result',
        state: 'complete',
        markdown: '## Review\n\nThe shell is ready.',
      }),
    ])
    expect(call.subagent?.timeline?.some((event) => event.markdown.includes('"path"'))).toBe(false)
  })

  it('merges repeated cumulative updates by stable timeline identity', () => {
    const firstDetails = {
      results: [{
        agent: 'worker',
        exitCode: -1,
        messages: [{
          role: 'assistant',
          content: [{ type: 'toolCall', id: 'tool-1', name: 'bash', arguments: { command: 'pnpm test' } }],
        }],
      }],
    }
    const finalDetails = {
      results: [{
        agent: 'worker',
        exitCode: 0,
        messages: [
          firstDetails.results[0].messages[0],
          {
            role: 'toolResult',
            toolCallId: 'tool-1',
            toolName: 'bash',
            isError: false,
            content: [{ type: 'text', text: 'Tests passed.' }],
          },
        ],
      }],
    }
    const started = presentToolCall({
      id: 'timeline-merge',
      name: 'subagent',
      args: { agent: 'worker', task: 'Run tests.' },
      phase: 'running',
      resultDetails: firstDetails,
      resultIsPartial: true,
    })
    const finished = presentToolCall({
      id: 'timeline-merge',
      name: 'subagent',
      args: undefined,
      phase: 'complete',
      resultDetails: finalDetails,
      resultText: 'Tests passed.',
      resultIsPartial: false,
    })
    const merged = mergeSubagentPresentation(started.subagent, finished.subagent)
    expect(merged?.timeline).toEqual([
      expect.objectContaining({
        id: 'result:0:message:0:content:0:tool',
        state: 'complete',
      }),
      expect.objectContaining({
        id: 'result:0:message:1:content:0:result',
        markdown: 'Tests passed.',
      }),
    ])
    expect(merged?.tasks).toEqual(started.subagent?.tasks)
  })

  it('bounds timeline item count and retains the newest observable events', () => {
    const messages = Array.from({ length: 120 }, (_, index) => ({
      role: 'assistant',
      content: [{ type: 'text', text: `Progress ${index}` }],
    }))
    const call = presentToolCall({
      id: 'timeline-limit',
      name: 'subagent',
      args: { agent: 'worker', task: 'Run the workflow.' },
      phase: 'running',
      resultDetails: { results: [{ agent: 'worker', exitCode: -1, messages }] },
      resultIsPartial: true,
    })
    expect(call.subagent?.timeline).toHaveLength(96)
    expect(call.subagent?.timelineOmittedCount).toBe(24)
    expect(call.subagent?.timeline?.[0]?.sequence).toBe(24)
    const timeline = call.subagent?.timeline ?? []
    expect(timeline[timeline.length - 1]?.markdown).toBe('Progress 119')
  })

  it('merges result-only projections without losing the original tasks', () => {
    const started = presentToolCall({
      id: 'result-only',
      name: 'subagent',
      args: { agent: 'reviewer', task: 'Inspect the change.' },
      phase: 'running',
    })
    const result = presentToolCall({
      id: 'result-only',
      name: 'subagent',
      args: undefined,
      phase: 'complete',
      resultText: 'Completed the review.',
    })
    expect(result).toMatchObject({ status: 'success', title: 'subagent' })
    expect(result.summary).toBeUndefined()
    expect(result.subagent?.tasks).toEqual([])

    const merged = mergeSubagentPresentation(started.subagent, result.subagent)
    expect(merged).toMatchObject({
      mode: 'single',
      tasks: [{ agent: 'reviewer', markdown: 'Inspect the change.' }],
      output: { kind: 'result', markdown: 'Completed the review.' },
    })
  })

  it('keeps shell commands concise and omits the argument projection', () => {
    const call = presentToolCall({
      id: 'shell-no-args',
      name: 'bash',
      args: { command: 'pnpm test', cwd: '/workspace', timeout: 30_000 },
      phase: 'complete',
      resultText: 'All tests passed.',
    })

    expect(call).toMatchObject({
      kind: 'shell',
      body: 'pnpm test',
      summary: 'pnpm test',
      details: {
        result: expect.objectContaining({ copyText: 'All tests passed.' }),
      },
    })
    expect(call.details?.arguments).toBeUndefined()
    expect(toolCallCopyText(call)).toContain('pnpm test')
    expect(toolCallCopyText(call)).not.toContain('30_000')
  })

  it('matches package presenters by exact tool name and keeps a generic fallback', () => {
    const generic = presentToolCall({
      id: 'generic',
      name: 'SubAgent',
      args: { agent: 'reviewer', task: 'Inspect it.', nested: { count: 2 } },
      phase: 'running',
      resultText: '{"ok":true}',
      resultIsPartial: true,
    })
    expect(generic).toMatchObject({
      title: 'SubAgent',
      status: 'running',
      summary: '{3}',
      details: {
        arguments: { kind: 'object' },
        progress: { kind: 'json', summary: '{1}' },
      },
    })
    expect(generic.malformed).toBeUndefined()
  })

  it('keeps raw official tool result text out of the structured JSON parser', () => {
    const malformedArguments = presentToolCall({
      id: 'malformed-arguments',
      name: 'extension_tool',
      args: '{"task":',
      phase: 'running',
    })
    const call = presentToolCall({
      id: 'raw-result',
      name: 'extension_tool',
      args: { task: 'inspect' },
      phase: 'complete',
      resultText: '{"partial":',
      resultPresentation: 'plain-text',
    })
    const formattedRawResult = '{\n  "ok": true\n}'
    const formatted = presentToolCall({
      id: 'formatted-raw-result',
      name: 'extension_tool',
      args: { task: 'inspect' },
      phase: 'complete',
      resultText: formattedRawResult,
      resultPresentation: 'plain-text',
    })

    expect(malformedArguments).toMatchObject({
      malformed: true,
      details: { arguments: { kind: 'malformed', malformed: true } },
    })
    expect(call).toMatchObject({
      malformed: undefined,
      details: {
        result: {
          kind: 'text',
          copyText: '{"partial":',
          malformed: false,
        },
      },
    })
    expect(formatted.details?.result).toMatchObject({
      kind: 'text',
      copyText: formattedRawResult,
      nodes: [{ kind: 'scalar', value: formattedRawResult }],
    })
  })

  it('keeps specialized read and shell summaries while sharing bounded details', () => {
    const read = presentToolCall({
      id: 'read',
      name: 'read',
      args: { path: 'src/main.ts' },
      phase: 'running',
    })
    const shell = presentToolCall({
      id: 'shell',
      name: 'bash',
      args: { command: 'pnpm test' },
      phase: 'complete',
      resultText: 'all tests passed',
    })
    expect(read).toMatchObject({ kind: 'read', summary: 'src/main.ts' })
    expect(shell).toMatchObject({
      kind: 'shell',
      summary: 'pnpm test',
      details: { result: { summary: 'all tests passed' } },
    })
    expect(toolCallCopyText(shell)).toContain('pnpm test')
    expect(toolCallCopyText(shell)).toContain('all tests passed')
  })
})
