import {
  LOCAL_PI_SESSION_TREE_MAX_DEPTH,
  LOCAL_PI_SESSION_TREE_MAX_NODES,
  localPiRendererRpcResponseSchema,
  type LocalPiRendererRpcResponse,
  type LocalPiRpcResponse,
  type LocalPiSessionTreeNode,
  type LocalPiTreeRow,
} from '../../../shared/local-pi'
import { PiRuntimeFrontendError } from '../../pi-host/pi-runtime-frontend'

interface PendingTreeNode {
  node: LocalPiSessionTreeNode
  parentId: string | null
  depth: number
}

function projectionError(command: string) {
  return new PiRuntimeFrontendError(
    'PI_RUNTIME_OPERATION_FAILED',
    `Pi RPC response ${command} could not be projected for Electron IPC.`,
    false,
  )
}

function projectTreeRows(roots: readonly LocalPiSessionTreeNode[]) {
  const rows: LocalPiTreeRow[] = []
  const pending: PendingTreeNode[] = roots
    .map((node) => ({ node, parentId: null, depth: 0 }))
    .reverse()

  while (pending.length > 0) {
    const current = pending.pop()
    if (!current) break
    if (rows.length >= LOCAL_PI_SESSION_TREE_MAX_NODES) {
      throw projectionError('get_tree')
    }
    if (current.depth > LOCAL_PI_SESSION_TREE_MAX_DEPTH) {
      throw projectionError('get_tree')
    }

    rows.push({
      entry: current.node.entry,
      parentId: current.parentId,
      depth: current.depth,
      order: rows.length,
      ...(current.node.label === undefined ? {} : { label: current.node.label }),
      ...(current.node.labelTimestamp === undefined
        ? {}
        : { labelTimestamp: current.node.labelTimestamp }),
    })

    for (let index = current.node.children.length - 1; index >= 0; index -= 1) {
      pending.push({
        node: current.node.children[index]!,
        parentId: current.node.entry.id,
        depth: current.depth + 1,
      })
    }
  }

  return rows
}

export function projectLocalPiRendererRpcResponse(
  response: LocalPiRpcResponse,
): LocalPiRendererRpcResponse {
  try {
    const projected = response.success && response.command === 'get_tree'
      ? {
          ...response,
          data: {
            rows: projectTreeRows(response.data.tree),
            leafId: response.data.leafId,
          },
        }
      : response
    const parsed = localPiRendererRpcResponseSchema.parse(projected)
    return structuredClone(parsed)
  } catch (error) {
    if (error instanceof PiRuntimeFrontendError) throw error
    throw projectionError(response.command)
  }
}
