import type { ContextEvent } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'
import {
  sanitizeRuntimeFinalizedMessage,
  sanitizeRuntimeProviderContext,
} from '../../src/main/pi-host/runtime-message-sanitizer'

type RuntimeMessage = ContextEvent['messages'][number]

function runtimeMessage(value: unknown): RuntimeMessage {
  return value as RuntimeMessage
}

describe('Runtime message sanitizer', () => {
  it('persists image-only user messages without an empty text block', () => {
    const image = {
      type: 'image' as const,
      data: 'aW1hZ2U=',
      mimeType: 'image/png',
    }
    const message = runtimeMessage({
      role: 'user',
      content: [{ type: 'text', text: '   ' }, image],
      timestamp: 1,
    })

    const sanitized = sanitizeRuntimeFinalizedMessage(message)

    expect(sanitized).not.toBe(message)
    expect(sanitized).toMatchObject({
      role: 'user',
      content: [image],
      timestamp: 1,
    })
    expect(message).toMatchObject({
      content: [{ type: 'text', text: '   ' }, image],
    })
  })

  it('repairs bad persisted history before each provider context', () => {
    const historical = runtimeMessage({
      role: 'user',
      content: [
        { type: 'text', text: '' },
        { type: 'image', data: 'aW1hZ2U=', mimeType: 'image/jpeg' },
      ],
      timestamp: 1,
    })
    const current = runtimeMessage({
      role: 'user',
      content: [{ type: 'text', text: 'continue' }],
      timestamp: 2,
    })

    const sanitized = sanitizeRuntimeProviderContext([historical, current])

    expect(sanitized).toEqual([
      {
        role: 'user',
        content: [{ type: 'image', data: 'aW1hZ2U=', mimeType: 'image/jpeg' }],
        timestamp: 1,
      },
      current,
    ])
    expect(sanitized[1]).toBe(current)
  })

  it('uses a stable non-empty fallback for empty tool results', () => {
    const message = runtimeMessage({
      role: 'toolResult',
      toolCallId: 'call-1',
      toolName: 'fixture',
      content: [{ type: 'text', text: '\n\t' }],
      isError: false,
      timestamp: 1,
    })

    expect(sanitizeRuntimeFinalizedMessage(message)).toEqual({
      role: 'toolResult',
      toolCallId: 'call-1',
      toolName: 'fixture',
      content: [{ type: 'text', text: '[Tool returned no content.]' }],
      isError: false,
      timestamp: 1,
    })
  })

  it('preserves non-empty messages and context identity', () => {
    const message = runtimeMessage({
      role: 'user',
      content: [
        { type: 'text', text: '  keep exact whitespace  ' },
        { type: 'image', data: 'aW1hZ2U=', mimeType: 'image/png' },
      ],
      timestamp: 1,
    })
    const messages = [message]

    expect(sanitizeRuntimeFinalizedMessage(message)).toBe(message)
    expect(sanitizeRuntimeProviderContext(messages)).toBe(messages)
  })

  it('omits empty custom string content but preserves non-empty custom content', () => {
    const empty = runtimeMessage({
      role: 'custom',
      customType: 'fixture-empty',
      content: '  \n ',
      display: true,
      timestamp: 1,
    })
    const nonEmpty = runtimeMessage({
      role: 'custom',
      customType: 'fixture-visible',
      content: ' keep exact ',
      display: true,
      timestamp: 2,
    })

    const sanitized = sanitizeRuntimeProviderContext([empty, nonEmpty])

    expect(sanitized).toEqual([nonEmpty])
    expect(sanitized[0]).toBe(nonEmpty)
  })

  it('sanitizes provider copies without rewriting extension-owned custom messages', () => {
    const image = {
      type: 'image' as const,
      data: 'aW1hZ2U=',
      mimeType: 'image/png',
    }
    const message = runtimeMessage({
      role: 'custom',
      customType: 'fixture-image',
      content: [{ type: 'text', text: '' }, image],
      display: true,
      timestamp: 1,
    })

    expect(sanitizeRuntimeFinalizedMessage(message)).toBe(message)
    expect(sanitizeRuntimeProviderContext([message])).toEqual([{
      ...message,
      content: [image],
    }])
    expect(message).toMatchObject({
      content: [{ type: 'text', text: '' }, image],
    })
  })
})
