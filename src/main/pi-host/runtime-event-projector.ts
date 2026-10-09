import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent'
import {
  localPiAssistantMessageSchema,
  localPiRpcEventSchema,
  type LocalPiAssistantMessage,
  type LocalPiRpcEvent,
} from '../../shared/local-pi'
import { projectPiHostDto } from './pi-host-dto'
import {
  applyAssistantMessageEvent,
  contentMap,
  type LocalPiAssistantContent,
} from '../../shared/pi-stream-projection'

export interface RuntimeLiveMessageState {
  message: LocalPiAssistantMessage | null
  isStreaming: boolean
  content: ReadonlyMap<number, LocalPiAssistantContent>
  toolCallDeltas: ReadonlyMap<number, string>
}

export function createRuntimeLiveMessageState(): RuntimeLiveMessageState {
  return { message: null, isStreaming: false, content: new Map(), toolCallDeltas: new Map() }
}

/** Keep the live snapshot at the same boundary as the emitted Host events. */
export function reduceRuntimeLiveMessageState(
  state: RuntimeLiveMessageState,
  event: LocalPiRpcEvent,
): RuntimeLiveMessageState {
  switch (event.type) {
    case 'agent_start':
    case 'turn_start':
      return { ...state, isStreaming: true }
    case 'agent_settled':
      return createRuntimeLiveMessageState()
    case 'message_start':
      return event.message.role === 'assistant' ? {
        message: event.message,
        content: contentMap(event.message),
        toolCallDeltas: new Map(),
        isStreaming: true,
      } : state
    case 'message_update': {
      if (!state.message) return state
      const projected = applyAssistantMessageEvent(
        state.message, state.content, state.toolCallDeltas, event.assistantMessageEvent,
      )
      return {
        message: { ...projected.message, ...(event.usage ? { usage: event.usage } : {}) },
        content: projected.content,
        toolCallDeltas: projected.toolCallDeltas,
        isStreaming: true,
      }
    }
    case 'message_end':
      return event.message.role === 'assistant'
        ? { ...createRuntimeLiveMessageState(), isStreaming: state.isStreaming }
        : state
    default:
      return state
  }
}

type RuntimeAssistantMessage = Extract<
  Extract<AgentSessionEvent, { type: 'message_start' }>['message'],
  { role: 'assistant' }
>

/** Copy a public partial message without the provider's mutable scratch buffers. */
export function projectRuntimeAssistantMessage(
  message: RuntimeAssistantMessage,
): LocalPiAssistantMessage {
  const content = message.content.map((block) => {
    const streamingBlock: typeof block & {
      index?: unknown
      partialArgs?: unknown
      customInput?: unknown
      streamIndex?: unknown
    } = block
    const { index: _index, ...withoutIndex } = streamingBlock
    if (block.type !== 'toolCall') return withoutIndex
    const {
      partialArgs: _partialArgs,
      customInput: _customInput,
      streamIndex: _streamIndex,
      ...toolCall
    } = withoutIndex as typeof block & {
      partialArgs?: unknown
      customInput?: unknown
      streamIndex?: unknown
    }
    return toolCall
  })
  return localPiAssistantMessageSchema.parse(projectPiHostDto({ ...message, content }))
}

/**
 * Reproduces Pi's public JSON/RPC event shape without importing the
 * stdio-owned `runRpcMode()` implementation. Streaming assistant snapshots are
 * intentionally removed; the bounded delta and cumulative usage remain.
 */
export function projectRuntimeEvent(event: AgentSessionEvent): LocalPiRpcEvent {
  if (event.type === 'message_start' && event.message.role === 'assistant') {
    // Pi shallow-copies message_start while tool blocks can still carry
    // the provider's scratch buffers. Final messages remain strictly validated.
    return localPiRpcEventSchema.parse(projectPiHostDto({
      ...event,
      message: projectRuntimeAssistantMessage(event.message),
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
