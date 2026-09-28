import type { LocalPiAssistantMessage, LocalPiAssistantMessageEvent } from './local-pi'

export type LocalPiAssistantContent = LocalPiAssistantMessage['content'][number]

export function contentMap(message: LocalPiAssistantMessage) {
  return new Map(message.content.map((content, index) => [index, content]))
}

export function messageWithContent(
  message: LocalPiAssistantMessage,
  content: ReadonlyMap<number, LocalPiAssistantContent>,
): LocalPiAssistantMessage {
  return {
    ...message,
    content: [...content.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, value]) => value),
  }
}

interface DeltaProjection {
  message: LocalPiAssistantMessage
  content: ReadonlyMap<number, LocalPiAssistantContent>
  toolCallDeltas: ReadonlyMap<number, string>
  uncertain: boolean
}

/** Reconstruct only emitted public content; SDK partial objects can mutate ahead. */
export function applyAssistantMessageEvent(
  message: LocalPiAssistantMessage,
  currentContent: ReadonlyMap<number, LocalPiAssistantContent>,
  currentToolCallDeltas: ReadonlyMap<number, string>,
  event: LocalPiAssistantMessageEvent,
): DeltaProjection {
  const content = new Map(currentContent)
  const toolCallDeltas = new Map(currentToolCallDeltas)
  const current = content.get(event.contentIndex)
  let uncertain = false

  switch (event.type) {
    case 'text_start':
      content.set(event.contentIndex, { type: 'text', text: '' })
      break
    case 'text_delta':
      if (current?.type !== 'text') uncertain = true
      content.set(event.contentIndex, {
        type: 'text',
        text: `${current?.type === 'text' ? current.text : ''}${event.delta}`,
      })
      break
    case 'text_end':
      content.set(event.contentIndex, { type: 'text', text: event.content })
      break
    case 'thinking_start':
      content.set(event.contentIndex, { type: 'thinking', thinking: '' })
      break
    case 'thinking_delta':
      if (current?.type !== 'thinking') uncertain = true
      content.set(event.contentIndex, {
        type: 'thinking',
        thinking: `${current?.type === 'thinking' ? current.thinking : ''}${event.delta}`,
      })
      break
    case 'thinking_end':
      content.set(event.contentIndex, { type: 'thinking', thinking: event.content })
      break
    case 'toolcall_start':
      toolCallDeltas.set(event.contentIndex, '')
      break
    case 'toolcall_delta':
      if (!toolCallDeltas.has(event.contentIndex)) uncertain = true
      toolCallDeltas.set(event.contentIndex, `${toolCallDeltas.get(event.contentIndex) ?? ''}${event.delta}`)
      break
    case 'toolcall_end':
      content.set(event.contentIndex, event.toolCall)
      toolCallDeltas.delete(event.contentIndex)
      break
  }

  return { message: messageWithContent(message, content), content, toolCallDeltas, uncertain }
}
