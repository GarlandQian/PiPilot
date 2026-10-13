import type { z } from 'zod'
import type { LocalPiAgentMessage, localPiMessagesResponseDataSchema } from '../../shared/local-pi'
import type { SideConversationTimelineItem } from '../../shared/side-conversations'

/** A bounded presentation of the official transcript, including live reasoning and tools. */
export function projectSideConversationTimeline(
  result: z.infer<typeof localPiMessagesResponseDataSchema>,
  displayUser: (text: string) => string,
): SideConversationTimelineItem[] {
  const items: SideConversationTimelineItem[] = []
  const tools = new Map<string, SideConversationTimelineItem>()
  function append(message: LocalPiAgentMessage, position: number, partial = false) {
    const id = `${message.role}:${'timestamp' in message ? message.timestamp : ''}:${position}`
    if (message.role === 'user') {
      const text = typeof message.content === 'string' ? message.content : message.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n')
      if (text) items.push({ id, kind: 'user', text: displayUser(text).slice(-100_000) })
    } else if (message.role === 'assistant') {
      message.content.forEach((part, index) => {
        if (part.type === 'text' && part.text) items.push({ id: `${id}:${index}`, kind: 'assistant', text: part.text.slice(-100_000), ...(partial ? { partial } : {}) })
        else if (part.type === 'thinking' && part.thinking && !part.redacted) items.push({ id: `${id}:${index}`, kind: 'thinking', text: part.thinking.slice(-100_000), ...(partial ? { partial } : {}) })
        else if (part.type === 'toolCall') {
          const item: SideConversationTimelineItem = { id: `tool:${part.id}`, kind: 'tool', text: '', toolCallId: part.id, toolName: part.name, arguments: JSON.stringify(part.arguments).slice(0, 20_000), status: 'running' }
          tools.set(part.id, item); items.push(item)
        }
      })
    } else if (message.role === 'toolResult') {
      const text = message.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n').slice(-100_000)
      const item = tools.get(message.toolCallId)
      if (item) { item.text = text; item.status = message.isError ? 'failed' : 'completed' }
      else items.push({ id: `tool:${message.toolCallId}`, kind: 'tool', text, toolName: message.toolName, toolCallId: message.toolCallId, status: message.isError ? 'failed' : 'completed' })
    }
  }
  result.messages.forEach((message, index) => append(message, index))
  if (result.live?.message) append(result.live.message, result.messages.length, true)
  return boundSideConversationTimeline(items)
}

export function boundSideConversationTimeline(items: SideConversationTimelineItem[]) {
  const bounded: SideConversationTimelineItem[] = []
  let remaining = 256_000
  for (let index = items.length - 1; index >= 0 && remaining > 0 && bounded.length < 400; index -= 1) {
    const item = items[index]!
    const args = item.arguments?.slice(0, remaining)
    remaining -= args?.length ?? 0
    const text = remaining > 0 ? item.text.slice(-remaining) : ''
    remaining -= text.length
    bounded.unshift({ ...item, text, ...(args === undefined ? {} : { arguments: args }) })
  }
  return bounded
}
