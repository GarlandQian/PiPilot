import type * as React from 'react'
import { usePiTranscript } from '@/store/pi-rpc'
import { ChatHeader, type ChatHeaderProps } from './ChatHeader'
import { MessageList } from './MessageList'

/** Subscribe where transcript changes are rendered, leaving navigation and input idle. */
export function ConversationTranscript(props: Omit<React.ComponentProps<typeof MessageList>, 'turns' | 'revision'>) {
  const transcript = usePiTranscript()
  return <MessageList {...props} turns={transcript.turns} revision={transcript.revision} />
}

export function ConversationHeader(props: Omit<ChatHeaderProps, 'outline'>) {
  const transcript = usePiTranscript()
  return <ChatHeader {...props} outline={props.sessionVisible ? transcript.outline : []} />
}
