import { describe, expect, it } from 'vitest'
import {
  applyLocalPiProjectorEvent,
  createLocalPiProjectorState,
} from '../../src/renderer/pi-rpc/projector'
import { projectLocalPiTurns } from '../../src/renderer/pi-rpc/presentation'
import type {
  LocalPiAssistantMessage,
  LocalPiRpcEvent,
  LocalPiRpcEventMessage,
} from '../../src/shared/local-pi'

const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
}

function assistant(
  content: LocalPiAssistantMessage['content'],
  stopReason: LocalPiAssistantMessage['stopReason'] = 'stop',
): LocalPiAssistantMessage {
  return {
    role: 'assistant',
    content,
    api: 'anthropic-messages',
    provider: 'fixture',
    model: 'fixture-model',
    usage,
    stopReason,
    timestamp: 2,
  }
}

let eventId = 0

function envelope(event: LocalPiRpcEvent): LocalPiRpcEventMessage {
  eventId += 1
  return {
    eventId: `00000000-0000-4000-8000-${String(eventId).padStart(12, '0')}`,
    generation: 4,
    event,
  }
}

describe('official Pi transcript presentation', () => {
  it('preserves user image attachments in the projected transcript', () => {
    const state = createLocalPiProjectorState({
      generation: 4,
      sessionId: 'session-a',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'Inspect this image' },
          { type: 'image', data: 'cGl4ZWw=', mimeType: 'image/png' },
        ],
        timestamp: 1,
      }],
    })

    expect(projectLocalPiTurns(state)).toMatchObject([{
      kind: 'user',
      text: 'Inspect this image',
      images: [{
        id: expect.stringMatching(/:message:0:1:image:1$/u),
        data: 'cGl4ZWw=',
        mimeType: 'image/png',
      }],
    }])
  })

  it('merges the authoritative tool result into one tool turn', () => {
    const state = createLocalPiProjectorState({
      generation: 4,
      sessionId: 'session-a',
      messages: [
        { role: 'user', content: 'Run it', timestamp: 1 },
        assistant([
          { type: 'text', text: 'Running.' },
          {
            type: 'toolCall',
            id: 'call-1',
            name: 'bash',
            arguments: { command: 'pnpm test' },
          },
        ], 'toolUse'),
        {
          role: 'toolResult',
          toolCallId: 'call-1',
          toolName: 'bash',
          content: [{ type: 'text', text: 'all tests passed' }],
          isError: false,
          timestamp: 3,
        },
      ],
    })

    const turns = projectLocalPiTurns(state)
    expect(turns.filter((turn) => turn.kind === 'tool')).toHaveLength(1)
    expect(turns).toMatchObject([
      { kind: 'user', text: 'Run it' },
      { kind: 'agent', markdown: 'Running.', state: 'complete' },
      {
        kind: 'tool',
        call: {
          id: 'call-1',
          status: 'success',
          body: 'pnpm test',
          output: 'all tests passed',
        },
      },
    ])
  })

  it('shows current-generation streaming text and live tool progress', () => {
    let state = createLocalPiProjectorState({
      generation: 4,
      sessionId: 'session-a',
    })
    state = applyLocalPiProjectorEvent(state, envelope({
      type: 'message_start',
      message: assistant([], 'pending'),
    }))
    state = applyLocalPiProjectorEvent(state, envelope({
      type: 'message_update',
      usage,
      assistantMessageEvent: { type: 'text_start', contentIndex: 0 },
    }))
    state = applyLocalPiProjectorEvent(state, envelope({
      type: 'message_update',
      usage,
      assistantMessageEvent: {
        type: 'text_delta',
        contentIndex: 0,
        delta: 'Working',
      },
    }))
    state = applyLocalPiProjectorEvent(state, envelope({
      type: 'tool_execution_start',
      toolCallId: 'call-live',
      toolName: 'read',
      args: { path: 'src/main.ts' },
    }))

    const turns = projectLocalPiTurns(state)
    expect(turns).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'agent',
        markdown: 'Working',
        state: 'streaming',
      }),
      expect.objectContaining({
        kind: 'tool',
        call: expect.objectContaining({
          id: 'call-live',
          kind: 'read',
          status: 'running',
          body: 'src/main.ts',
        }),
      }),
    ]))
  })

  it('keeps incomplete official tool-call deltas as raw text instead of malformed arguments', () => {
    let state = createLocalPiProjectorState({
      generation: 4,
      sessionId: 'session-a',
    })
    state = applyLocalPiProjectorEvent(state, envelope({
      type: 'message_start',
      message: assistant([], 'pending'),
    }))
    state = applyLocalPiProjectorEvent(state, envelope({
      type: 'message_update',
      usage,
      assistantMessageEvent: { type: 'toolcall_start', contentIndex: 0 },
    }))
    state = applyLocalPiProjectorEvent(state, envelope({
      type: 'message_update',
      usage,
      assistantMessageEvent: {
        type: 'toolcall_delta',
        contentIndex: 0,
        delta: '{"command":',
      },
    }))

    const tool = projectLocalPiTurns(state).find((turn) => turn.kind === 'tool')
    expect(tool).toMatchObject({
      kind: 'tool',
      call: {
        status: 'running',
        malformed: undefined,
        details: {
          arguments: {
            kind: 'text',
            copyText: '{"command":',
            malformed: false,
          },
        },
      },
    })
  })

  it('keeps official tool result content as raw text when it resembles incomplete JSON', () => {
    let state = createLocalPiProjectorState({
      generation: 4,
      sessionId: 'session-a',
    })
    state = applyLocalPiProjectorEvent(state, envelope({
      type: 'tool_execution_start',
      toolCallId: 'call-raw-result',
      toolName: 'extension_tool',
      args: { task: 'inspect' },
    }))
    state = applyLocalPiProjectorEvent(state, envelope({
      type: 'tool_execution_end',
      toolCallId: 'call-raw-result',
      toolName: 'extension_tool',
      result: {
        content: [{ type: 'text', text: '{"partial":' }],
      },
      isError: false,
    }))

    const tool = projectLocalPiTurns(state).find((turn) => turn.kind === 'tool')
    expect(tool).toMatchObject({
      kind: 'tool',
      call: {
        status: 'success',
        details: {
          result: {
            kind: 'text',
            copyText: '{"partial":',
            malformed: false,
          },
        },
      },
    })
  })

  it('renders unknown extension tools as bounded generic activity with progress and errors', () => {
    let state = createLocalPiProjectorState({
      generation: 4,
      sessionId: 'session-a',
    })
    state = applyLocalPiProjectorEvent(state, envelope({
      type: 'tool_execution_start',
      toolCallId: 'call-subagent',
      toolName: 'subagent',
      args: { agent: 'reviewer', task: 'Inspect the change' },
    }))
    state = applyLocalPiProjectorEvent(state, envelope({
      type: 'tool_execution_update',
      toolCallId: 'call-subagent',
      toolName: 'subagent',
      args: { agent: 'reviewer', task: 'Inspect the change' },
      partialResult: {
        content: [{ type: 'text', text: 'Reviewing files' }],
        details: null,
      },
    }))

    expect(projectLocalPiTurns(state)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'tool',
        call: expect.objectContaining({
          id: 'call-subagent',
          kind: 'generic',
          status: 'running',
          summary: 'reviewer · Inspect the change',
          body: '',
          details: undefined,
          subagent: expect.objectContaining({
            mode: 'single',
            tasks: [expect.objectContaining({
              agent: 'reviewer',
              markdown: 'Inspect the change',
            })],
            output: expect.objectContaining({
              kind: 'progress',
              markdown: 'Reviewing files',
            }),
          }),
        }),
      }),
    ]))

    const completedOutput = 'x'.repeat(30_000)
    state = applyLocalPiProjectorEvent(state, envelope({
      type: 'tool_execution_end',
      toolCallId: 'call-subagent',
      toolName: 'subagent',
      result: {
        content: [{ type: 'text', text: completedOutput }],
        details: null,
      },
      isError: true,
    }))
    const tool = projectLocalPiTurns(state).find((turn) => turn.kind === 'tool')
    expect(tool).toMatchObject({
      kind: 'tool',
      call: {
        kind: 'generic',
        status: 'failed',
        summary: 'reviewer · Inspect the change',
        progress: undefined,
        error: undefined,
        details: undefined,
      },
    })
    expect(tool?.kind === 'tool' ? tool.call.subagent?.output : undefined).toEqual({
      kind: 'error',
      markdown: completedOutput,
      truncated: false,
    })
  })

  it('keeps cumulative pi-subagents execution messages visible through hydration', () => {
    let state = createLocalPiProjectorState({
      generation: 4,
      sessionId: 'session-a',
    })
    state = applyLocalPiProjectorEvent(state, envelope({
      type: 'tool_execution_start',
      toolCallId: 'call-timeline',
      toolName: 'subagent',
      args: { agent: 'worker', task: 'Run the checks.' },
    }))
    state = applyLocalPiProjectorEvent(state, envelope({
      type: 'tool_execution_update',
      toolCallId: 'call-timeline',
      toolName: 'subagent',
      args: { agent: 'worker', task: 'Run the checks.' },
      partialResult: {
        content: [{ type: 'text', text: 'Running checks.' }],
        details: {
          results: [{
            agent: 'worker',
            exitCode: -1,
            messages: [{
              role: 'assistant',
              content: [{
                type: 'toolCall',
                id: 'nested-tool',
                name: 'bash',
                arguments: { command: 'pnpm test' },
              }],
            }],
          }],
        },
      },
    }))

    const running = projectLocalPiTurns(state).find((turn) => turn.kind === 'tool')
    expect(running?.kind === 'tool' ? running.call.subagent?.timeline : undefined).toEqual([
      expect.objectContaining({
        kind: 'tool',
        state: 'active',
        toolName: 'bash',
      }),
    ])

    state = applyLocalPiProjectorEvent(state, envelope({
      type: 'tool_execution_end',
      toolCallId: 'call-timeline',
      toolName: 'subagent',
      result: {
        content: [{ type: 'text', text: 'Checks passed.' }],
        details: {
          results: [{
            agent: 'worker',
            exitCode: 0,
            messages: [
              {
                role: 'assistant',
                content: [{
                  type: 'toolCall',
                  id: 'nested-tool',
                  name: 'bash',
                  arguments: { command: 'pnpm test' },
                }],
              },
              {
                role: 'toolResult',
                toolCallId: 'nested-tool',
                toolName: 'bash',
                isError: false,
                content: [{ type: 'text', text: 'Checks passed.' }],
              },
            ],
          }],
        },
      },
      isError: false,
    }))
    const finished = projectLocalPiTurns(state).find((turn) => turn.kind === 'tool')
    expect(finished?.kind === 'tool' ? finished.call.subagent?.timeline : undefined).toEqual([
      expect.objectContaining({ kind: 'tool', state: 'complete' }),
      expect.objectContaining({ kind: 'result', markdown: 'Checks passed.' }),
    ])
  })

  it('keeps empty official error and aborted responses visible', () => {
    const failed = assistant([], 'error')
    failed.errorMessage = 'The provider rejected this request.'
    const state = createLocalPiProjectorState({
      generation: 4,
      sessionId: 'session-a',
      messages: [
        failed,
        { ...assistant([], 'aborted'), timestamp: 3 },
      ],
    })

    expect(projectLocalPiTurns(state)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'agent',
        markdown: 'The provider rejected this request.',
        state: 'error',
      }),
      expect.objectContaining({
        kind: 'notice',
        notice: 'response-aborted',
      }),
    ]))
  })
})
