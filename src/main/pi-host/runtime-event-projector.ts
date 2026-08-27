import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent'
import {
  localPiRpcEventSchema,
  type LocalPiRpcEvent,
} from '../../shared/local-pi'
import { projectPiHostDto } from './pi-host-dto'

/**
 * Reproduces Pi 0.84.2's public JSON/RPC event shape without importing the
 * stdio-owned `runRpcMode()` implementation. Streaming assistant snapshots are
 * intentionally removed; the bounded delta and cumulative usage remain.
 */
export function projectRuntimeEvent(event: AgentSessionEvent): LocalPiRpcEvent {
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
