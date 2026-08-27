import { describe, expect, it } from 'vitest'
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent'
import { projectRuntimeEvent } from '../../src/main/pi-host/runtime-event-projector'
import {
  applyLocalPiProjectorEvent,
  createLocalPiProjectorState,
} from '../../src/renderer/pi-rpc/projector'
import { projectLocalPiTurns } from '../../src/renderer/pi-rpc/presentation'

describe('embedded Pi event projection', () => {
  it('keeps cumulative usage while removing assistant partial snapshots', () => {
    const event = {
      type: 'message_update',
      message: {
        role: 'assistant',
        usage: {
          input: 2,
          output: 3,
          cacheRead: 4,
          cacheWrite: 5,
          totalTokens: 14,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      },
      assistantMessageEvent: {
        type: 'text_delta',
        contentIndex: 0,
        delta: 'hello',
        partial: { role: 'assistant', content: [], api: 'openai-responses' },
      },
    } as unknown as AgentSessionEvent

    const projected = projectRuntimeEvent(event)
    // The SDK types message_update.message as the AgentMessage union; narrow by
    // role to the assistant variant that carries usage (as the projector does).
    const message = (event as Extract<AgentSessionEvent, { type: 'message_update' }>).message
    if (message.role !== 'assistant') {
      throw new Error('fixture message_update was not an assistant message')
    }
    expect(projected).toEqual({
      type: 'message_update',
      usage: message.usage,
      assistantMessageEvent: {
        type: 'text_delta',
        contentIndex: 0,
        delta: 'hello',
      },
    })
  })

  it('passes ordinary session events through the bounded DTO schema', () => {
    expect(projectRuntimeEvent({ type: 'agent_start' })).toEqual({
      type: 'agent_start',
    })
  })

  it('projects the official successful write result without details through presentation', () => {
    const writeEnd = {
      type: 'tool_execution_end',
      toolCallId: 'call-write',
      toolName: 'write',
      result: {
        content: [{
          type: 'text',
          text: 'Successfully wrote 12 bytes to implement.md',
        }],
        details: undefined,
      },
      isError: false,
    } as AgentSessionEvent

    const projected = projectRuntimeEvent(writeEnd)
    expect(projected).toEqual({
      type: 'tool_execution_end',
      toolCallId: 'call-write',
      toolName: 'write',
      result: {
        content: [{
          type: 'text',
          text: 'Successfully wrote 12 bytes to implement.md',
        }],
      },
      isError: false,
    })

    let state = createLocalPiProjectorState({
      generation: 1,
      sessionId: 'session-write',
    })
    state = applyLocalPiProjectorEvent(state, {
      eventId: '00000000-0000-4000-8000-000000000001',
      generation: 1,
      event: {
        type: 'tool_execution_start',
        toolCallId: 'call-write',
        toolName: 'write',
        args: { path: 'implement.md', content: 'test content' },
      },
    })
    state = applyLocalPiProjectorEvent(state, {
      eventId: '00000000-0000-4000-8000-000000000002',
      generation: 1,
      event: projected,
    })

    expect(state.tools.get('call-write')).toMatchObject({
      phase: 'complete',
      resultIsPartial: false,
      isError: false,
    })
    expect(projectLocalPiTurns(state)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'tool',
        call: expect.objectContaining({
          id: 'call-write',
          status: 'success',
        }),
      }),
    ]))
  })
})
