import * as React from 'react'
import { buildConversationTree, type ConversationTree } from '@/renderer/pi-rpc/conversation-tree'
import type { LocalPiTreeRow } from '@/shared/local-pi'

type TreeRequest = (command: { type: 'get_tree' }) => Promise<{ rows: readonly LocalPiTreeRow[]; leafId: string | null }>

/**
 * The open conversation's session tree, read again whenever `key` changes
 * (a new message, a branch switch, a bookmark). Null while unavailable.
 */
export function useConversationTree(request: TreeRequest | null, key: string | null) {
  const [tree, setTree] = React.useState<ConversationTree | null>(null)
  const [tick, setTick] = React.useState(0)
  const reload = React.useCallback(() => setTick((value) => value + 1), [])
  React.useEffect(() => {
    if (!request || !key) { setTree(null); return }
    let cancelled = false
    request({ type: 'get_tree' }).then((result) => {
      if (!cancelled) setTree(buildConversationTree(result.rows, result.leafId))
    }, () => { if (!cancelled) setTree(null) })
    return () => { cancelled = true }
  }, [key, request, tick])
  return { tree, reload }
}
