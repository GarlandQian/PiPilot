import * as React from 'react'
import {
  createConversationOperationFeedback,
  runConversationOperation,
} from './operation-feedback'

export function useConversationOperationFeedback(ownerKey: string) {
  // A new visit gets a new owner even if A -> B -> A restores the same key.
  const owner = React.useMemo(() => createConversationOperationFeedback(ownerKey), [ownerKey])
  const currentOwner = React.useRef<typeof owner | null>(owner)
  currentOwner.current = owner
  const snapshot = React.useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot)

  React.useEffect(() => {
    currentOwner.current = owner
    return () => {
      if (currentOwner.current === owner) currentOwner.current = null
    }
  }, [owner])

  const run = React.useCallback((
    action: string,
    operation: (isCurrent: () => boolean) => void | Promise<void>,
    fallback: string,
  ): Promise<boolean> => runConversationOperation(
    owner,
    () => currentOwner.current === owner,
    action,
    operation,
    fallback,
  ), [owner])

  return { ...snapshot, run, clearError: owner.clearError }
}
