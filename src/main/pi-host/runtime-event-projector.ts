import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent'
import {
  localPiRpcEventSchema,
  type LocalPiRpcEvent,
} from '../../shared/local-pi'
import { projectPiHostDto } from './pi-host-dto'

/**
 * Reproduces Pi 0.85.1's public JSON/RPC event shape without importing the
 * stdio-owned `runRpcMode()` implementation. Streaming assistant snapshots are
 * intentionally removed; the bounded delta and cumulative usage remain.
 */
export function projectRuntimeEvent(event: AgentSessionEvent): LocalPiRpcEvent {
  if (event.type === 'message_start' && event.message.role === 'assistant') {
    // Pi 0.85.1 shallow-copies message_start while tool blocks can still carry
    // the provider's scratch buffers. Final messages remain strictly validated.
    const content = event.message.content.map((block) => {
      if (block.type !== 'toolCall') return block
      const streamingBlock: typeof block & {
        index?: unknown
        partialArgs?: unknown
        customInput?: unknown
        streamIndex?: unknown
      } = block
      const {
        index: _index,
        partialArgs: _partialArgs,
        customInput: _customInput,
        streamIndex: _streamIndex,
        ...toolCall
      } = streamingBlock
      return toolCall
    })
    return localPiRpcEventSchema.parse(projectPiHostDto({
      ...event,
      message: { ...event.message, content },
    }))
  }
  if (event.type !== 'message_update') {
    return localPiRpcEventSchema.parse(projectPiHostDto(event))
  }
  if (event.message.role !== 'assistant') {
    throw new Error('Pi message_update did not contain an assistant message.')
  }
  const rawAssistantMessageEvent = event.assistantMessageEvent
  const assistantMessageEvent = 'partial' in rawAssistantMessageEvent
    ? (({ partial: _partial, ...delta }) => delta)(rawAssistantMessageEvent)
    : rawAssistantMessageEvent
  return localPiRpcEventSchema.parse(projectPiHostDto({
    type: 'message_update',
    usage: event.message.usage,
    assistantMessageEvent,
  }))
}
