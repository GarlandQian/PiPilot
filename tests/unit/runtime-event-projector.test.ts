import { describe, expect, it } from 'vitest'
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent'
import { projectRuntimeEvent } from '../../src/main/pi-host/runtime-event-projector'
import { localPiSessionEntrySchema } from '../../src/shared/local-pi'
import {
  applyLocalPiProjectorEvent,
  createLocalPiProjectorState,
} from '../../src/renderer/pi-rpc/projector'
import { projectLocalPiTurns } from '../../src/renderer/pi-rpc/presentation'

function assistantMessage(content: unknown[]) {
  return {
    role: 'assistant',
    content,
    api: 'openai-completions',
    provider: 'fixture',
    model: 'fixture-model',
    usage: {
      input: 2, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 5,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'toolUse',
    timestamp: 1,
  }
}

const publicToolCall = {
  type: 'toolCall',
  id: 'call-bash',
  name: 'bash',
  arguments: {
    command: 'pnpm test',
    partialArgs: 'a real argument',
    customInput: { mode: 'public argument' },
    streamIndex: 7,
  },
  thoughtSignature: 'tool-signature',
}

describe('embedded Pi event projection', () => {
  it.each([
    ['JSON arguments', { index: 0, partialArgs: '{"command":"pnpm test"', customInput: undefined, streamIndex: 0 }],
    ['grammar input', {
      index: 1,
      partialArgs: undefined,
      customInput: { property: 'input', jsonBuffer: { input: 'pnpm test', started: true, closed: false } },
      streamIndex: 1,
    }],
  ])('removes SDK %s scratch fields only from starting tool blocks', (_label, scratch) => {
    const text = Object.freeze({ type: 'text', text: 'Running tests', textSignature: 'text-signature' })
    const thinking = Object.freeze({ type: 'thinking', thinking: 'Checking the implementation', thinkingSignature: 'thinking-signature' })
    const toolCall = Object.freeze({ ...publicToolCall, ...scratch })
    const message = Object.freeze({
      ...assistantMessage([]),
      content: Object.freeze([text, thinking, toolCall]),
    })
    const event = Object.freeze({ type: 'message_start', message })
    const before = structuredClone(event)

    expect(projectRuntimeEvent(event as unknown as AgentSessionEvent)).toEqual({
      type: 'message_start',
      message: assistantMessage([text, thinking, publicToolCall]),
    })
    expect(event).toEqual(before)
    expect(event.message.content[2]).toBe(toolCall)
  })

  it('keeps final assistant content when the SDK emits it as message_start', () => {
    const event = {
      type: 'message_start',
      message: assistantMessage([
        { type: 'text', text: 'Completed the check' },
        { type: 'thinking', thinking: 'Checked the result' },
        publicToolCall,
      ]),
    }
    expect(projectRuntimeEvent(event as unknown as AgentSessionEvent)).toEqual(event)
  })

  it.each(['index', 'partialArgs', 'customInput', 'streamIndex', 'unknownProviderField'])(
    'rejects %s in final messages, completed tool calls and persisted entries',
    (field) => {
      const toolCall = { ...publicToolCall, [field]: 'not a public tool field' }
      const message = assistantMessage([toolCall])
      expect(() => projectRuntimeEvent({ type: 'message_end', message } as unknown as AgentSessionEvent)).toThrow()
      expect(() => projectRuntimeEvent({
        type: 'message_update',
        message,
        assistantMessageEvent: { type: 'toolcall_end', contentIndex: 0, toolCall, partial: message },
      } as unknown as AgentSessionEvent)).toThrow()
      expect(localPiSessionEntrySchema.safeParse({
        type: 'message', id: 'entry-assistant', parentId: null,
        timestamp: '2026-09-08T00:00:00.000Z', message,
      }).success).toBe(false)
    },
  )

  it('does not strip unknown tool fields or scratch-named fields from other start content', () => {
    for (const block of [
      { ...publicToolCall, partialArgs: '{}', unknownProviderField: true },
      { type: 'text', text: 'Hello', partialArgs: '{}' },
      { type: 'thinking', thinking: 'Checking', streamIndex: 0 },
    ]) {
      expect(() => projectRuntimeEvent({
        type: 'message_start', message: assistantMessage([block]),
      } as unknown as AgentSessionEvent)).toThrow()
    }
  })

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
