export interface ConversationOperationToken {
  readonly owner: string
  readonly sequence: number
  readonly action: string
}

export interface ConversationOperationSnapshot {
  readonly pending: ConversationOperationToken | null
  readonly error: string | null
}

/** One visit's feedback, never the authoritative command or payload state. */
export function createConversationOperationFeedback(owner: string) {
  let sequence = 0
  let active = true
  let snapshot: ConversationOperationSnapshot = { pending: null, error: null }
  const listeners = new Set<() => void>()
  const publish = (next: ConversationOperationSnapshot) => {
    snapshot = next
    for (const listener of listeners) listener()
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    begin(action: string): ConversationOperationToken | null {
      if (!active || snapshot.pending) return null
      const token = { owner, sequence: ++sequence, action }
      publish({ pending: token, error: null })
      return token
    },
    isCurrent(token: ConversationOperationToken) {
      return active && snapshot.pending === token
    },
    finish(token: ConversationOperationToken, error: string | null = null) {
      if (!active || snapshot.pending !== token) return false
      publish({ pending: null, error })
      return true
    },
    clearError() {
      if (active && snapshot.error !== null) publish({ ...snapshot, error: null })
    },
    invalidate() {
      active = false
      snapshot = { pending: null, error: null }
      listeners.clear()
    },
  }
}

export function conversationOperationError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message.slice(0, 2048) : fallback
}

export async function runConversationOperation(
  owner: ReturnType<typeof createConversationOperationFeedback>,
  isOwnerCurrent: () => boolean,
  action: string,
  operation: (isCurrent: () => boolean) => void | Promise<void>,
  fallback: string,
): Promise<boolean> {
  if (!isOwnerCurrent()) return false
  const token = owner.begin(action)
  if (!token) return false
  const isCurrent = () => isOwnerCurrent() && owner.isCurrent(token)
  try {
    await operation(isCurrent)
    if (!isCurrent()) return false
    owner.finish(token)
    return true
  } catch (error) {
    if (isCurrent()) owner.finish(token, conversationOperationError(error, fallback))
    return false
  }
}
