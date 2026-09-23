import type { FileNode } from '@/types/chat'

/** Keep cached descendants mounted while refreshed directory entries are revalidated. */
export function replaceFileTreeChildren(
  root: FileNode,
  path: string,
  children: FileNode[],
  truncated: boolean,
  invalidateCached = true,
): FileNode {
  if (root.path === path) {
    const previous = new Map(root.children?.map((child) => [child.path, child]))
    const merged = children.map((child) => {
      const cached = previous.get(child.path)
      return child.type === 'dir' && cached?.type === 'dir' && cached.children !== undefined
        ? { ...child, children: cached.children, truncated: cached.truncated, loaded: invalidateCached ? child.loaded : cached.loaded }
        : child
    })
    return { ...root, children: merged, loaded: true, truncated }
  }
  return {
    ...root,
    children: root.children?.map((child) => child.type === 'dir' &&
      (child.path === path || path.startsWith(`${child.path}/`))
      ? replaceFileTreeChildren(child, path, children, truncated, invalidateCached)
      : child),
  }
}

export function adjacentFileRowIndex(key: string, index: number, count: number): number | null {
  if (count === 0) return null
  if (key === 'ArrowDown') return Math.min(index + 1, count - 1)
  if (key === 'ArrowUp') return Math.max(index - 1, 0)
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  return null
}
