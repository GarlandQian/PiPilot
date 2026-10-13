import * as React from 'react'
import { buildConversationTree, type ConversationTree } from '@/renderer/pi-rpc/conversation-tree'
import type { LocalPiTreeOutlineRow } from '@/shared/local-pi'

type TreeRequest = (command: { type: 'get_tree_outline' }) => Promise<{ rows: readonly LocalPiTreeOutlineRow[]; leafId: string | null }>

/**
 * The open conversation's session tree, read again whenever `key` changes
 * (a new message, a branch switch, a bookmark). Null while unavailable.
 */
export function useConversationTree(request: TreeRequest | null, key: string | null, ownerKey: string | null = key) {
  const [snapshot, setSnapshot] = React.useState<{ ownerKey: string; tree: ConversationTree } | null>(null)
  const [tick, setTick] = React.useState(0)
  const reload = React.useCallback(() => setTick((value) => value + 1), [])
  // Read again only when the key changes, never because the caller re-rendered.
  const requestRef = React.useRef(request)
  requestRef.current = request
  const enabled = request !== null
  React.useEffect(() => {
    const read = requestRef.current
    if (!enabled || !read || !key || !ownerKey) { setSnapshot(null); return }
    let cancelled = false
    // A large tree waits for the transcript to settle before it is read.
    const timer = setTimeout(() => {
      read({ type: 'get_tree_outline' }).then((result) => {
        if (!cancelled) setSnapshot({ ownerKey, tree: buildConversationTree(result.rows, result.leafId) })
      }, () => { if (!cancelled) setSnapshot(null) })
    }, 300)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [enabled, key, ownerKey, tick])
  return { tree: enabled && key && snapshot?.ownerKey === ownerKey ? snapshot.tree : null, reload }
}
