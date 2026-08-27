import type {
  ContextEvent,
  InlineExtension,
  MessageEndEvent,
} from '@earendil-works/pi-coding-agent'

export const PIPILOT_RUNTIME_MESSAGE_SANITIZER_EXTENSION_NAME =
  'pipilot-message-sanitizer'
export const PIPILOT_RUNTIME_MESSAGE_SANITIZER_EXTENSION_PATH =
  `<inline:${PIPILOT_RUNTIME_MESSAGE_SANITIZER_EXTENSION_NAME}>`

type RuntimeMessage = ContextEvent['messages'][number]

const EMPTY_CONTENT_FALLBACKS = {
  user: '[Empty user message]',
  assistant: '[Empty assistant message]',
  toolResult: '[Tool returned no content.]',
} as const

function isEmptyTextBlock(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const block = value as { type?: unknown; text?: unknown }
  return block.type === 'text'
    && typeof block.text === 'string'
    && block.text.trim().length === 0
}

function fallbackFor(message: RuntimeMessage): string | null {
  switch (message.role) {
    case 'user':
      return EMPTY_CONTENT_FALLBACKS.user
    case 'assistant':
      return EMPTY_CONTENT_FALLBACKS.assistant
    case 'toolResult':
      return EMPTY_CONTENT_FALLBACKS.toolResult
    default:
      return null
  }
}

/**
 * Remove provider-invalid empty text blocks without mutating official Pi
 * messages. Unchanged messages retain their original identity.
 */
function sanitizeRuntimeMessageContent<T extends RuntimeMessage>(
  message: T,
): T {
  if (!('content' in message)) return message

  const content = message.content
  if (typeof content === 'string') {
    if (content.trim().length > 0) return message
    const fallback = fallbackFor(message)
    return {
      ...message,
      content: fallback === null
        ? []
        : [{ type: 'text', text: fallback }],
    } as T
  }
  if (!Array.isArray(content)) return message

  const filtered = content.filter((block) => !isEmptyTextBlock(block))
  if (filtered.length === content.length && filtered.length > 0) return message

  const fallback = filtered.length === 0 ? fallbackFor(message) : null
  if (fallback !== null) {
    return {
      ...message,
      content: [{ type: 'text', text: fallback }],
    } as T
  }
  if (filtered.length === content.length) return message
  return { ...message, content: filtered } as T
}

export function sanitizeRuntimeFinalizedMessage<T extends RuntimeMessage>(
  message: T,
): T {
  // Custom messages are extension-owned UI/session records. Provider context
  // is sanitized from a copy below; message_end must not rewrite persistence.
  if (message.role === 'custom') return message
  return sanitizeRuntimeMessageContent(message)
}

function isEmptyCustomMessage(message: RuntimeMessage): boolean {
  if (message.role !== 'custom') return false
  if (typeof message.content === 'string') {
    return message.content.trim().length === 0
  }
  return message.content.length === 0
}

/**
 * Sanitize the final extension-projected provider context. Empty custom
 * display/state messages are omitted because Pi converts them into user text.
 */
export function sanitizeRuntimeProviderContext(
  messages: readonly RuntimeMessage[],
): RuntimeMessage[] {
  let changed = false
  const sanitized: RuntimeMessage[] = []

  for (const message of messages) {
    const next = sanitizeRuntimeMessageContent(message)
    if (next !== message) changed = true
    if (isEmptyCustomMessage(next)) {
      changed = true
      continue
    }
    sanitized.push(next)
  }

  return changed ? sanitized : messages as RuntimeMessage[]
}

export const PIPILOT_RUNTIME_MESSAGE_SANITIZER_EXTENSION: InlineExtension = {
  name: PIPILOT_RUNTIME_MESSAGE_SANITIZER_EXTENSION_NAME,
  hidden: true,
  factory: (pi) => {
    pi.on('context', (event) => {
      const messages = sanitizeRuntimeProviderContext(event.messages)
      return messages === event.messages ? undefined : { messages }
    })
    pi.on('message_end', (event: MessageEndEvent) => {
      const message = sanitizeRuntimeFinalizedMessage(event.message)
      return message === event.message ? undefined : { message }
    })
  },
}
