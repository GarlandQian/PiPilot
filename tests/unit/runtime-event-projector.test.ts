import { describe, expect, it } from 'vitest'
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent'
import { projectRuntimeEvent } from '../../src/main/pi-host/runtime-event-projector'

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
})
