import { describe, expect, it } from 'vitest'
import { adjacentFileRowIndex, replaceFileTreeChildren } from '../../src/components/inspector/file-tree-state'
import type { FileNode } from '../../src/types/chat'

function directory(path: string, children?: FileNode[]): FileNode {
  return { path, name: path.split('/').pop()!, type: 'dir', loaded: children !== undefined, children }
}
const file = (path: string): FileNode => ({ path, name: path.split('/').pop()!, type: 'file' })

describe('file tree refresh ownership', () => {
  it('retains cached descendants while the new directory entry is marked for revalidation', () => {
    const child = directory('src/nested', [file('src/nested/entry.ts')])
    const src = directory('src', [child])
    const obsolete = file('obsolete.ts')
    const original = directory('.', [src, obsolete])
    const updated = replaceFileTreeChildren(original, '.', [directory('src'), file('README.md')], false)

    expect(updated.children?.map((entry) => entry.path)).toEqual(['src', 'README.md'])
    expect(updated.children?.[0]?.loaded).toBe(false)
    expect(updated.children?.[0]?.children).toBe(src.children)
    expect(updated.children?.[0]?.children?.[0]).toBe(child)
    expect(original.children).toEqual([src, obsolete])
    expect(original.children?.[0]?.loaded).toBe(true)
  })

  it('replaces only the refreshed directory and drops removed descendants authoritatively', () => {
    const unchanged = directory('src-other', [file('src-other/keep.ts')])
    const src = directory('src', [directory('src/nested', [file('src/nested/old.ts')])])
    const original = directory('.', [src, unchanged])
    const updated = replaceFileTreeChildren(original, 'src/nested', [file('src/nested/new.ts')], true)

    expect(updated.children?.[1]).toBe(unchanged)
    const nested = updated.children?.[0]?.children?.[0]
    expect(nested?.loaded).toBe(true)
    expect(nested?.truncated).toBe(true)
    expect(nested?.children?.map((entry) => entry.path)).toEqual(['src/nested/new.ts'])
    expect(src.children?.[0]?.children?.[0]?.path).toBe('src/nested/old.ts')
  })

  it('does not carry directory contents onto a same-path replacement file', () => {
    const original = directory('.', [directory('changed', [file('changed/old.txt')])])
    const updated = replaceFileTreeChildren(original, '.', [file('changed')], false)
    expect(updated.children?.[0]?.type).toBe('file')
    expect(updated.children?.[0]?.children).toBeUndefined()
  })
})

describe('file tree keyboard navigation', () => {
  it('moves through stable row indices without wrapping or moving beyond the list', () => {
    expect(adjacentFileRowIndex('ArrowDown', -1, 3)).toBe(0)
    expect(adjacentFileRowIndex('ArrowDown', 1, 3)).toBe(2)
    expect(adjacentFileRowIndex('ArrowDown', 2, 3)).toBe(2)
    expect(adjacentFileRowIndex('ArrowUp', 0, 3)).toBe(0)
    expect(adjacentFileRowIndex('Home', 2, 3)).toBe(0)
    expect(adjacentFileRowIndex('End', 0, 3)).toBe(2)
    expect(adjacentFileRowIndex('Enter', 0, 3)).toBeNull()
    expect(adjacentFileRowIndex('ArrowDown', 0, 0)).toBeNull()
  })
})
