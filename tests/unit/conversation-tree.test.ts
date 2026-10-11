import { describe, expect, it } from 'vitest'
import { branchLeaf, branchPoints, buildConversationTree } from '../../src/renderer/pi-rpc/conversation-tree'
import type { LocalPiTreeRow } from '../../src/shared/local-pi'

let order = 0
const row = (id: string, parentId: string | null, role: 'user' | 'assistant', text: string): LocalPiTreeRow => ({
  entry: { type: 'message', id, parentId, timestamp: '2026-10-01T00:00:00.000Z', message: role === 'user'
    ? { role, content: text, timestamp: 1 }
    : { role, content: [{ type: 'text', text }], api: 'x', provider: 'x', model: 'x', stopReason: 'stop', timestamp: 1,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } } },
  parentId, depth: 0, order: order++,
}) as LocalPiTreeRow

describe('conversation tree', () => {
  const rows = [
    row('q1', null, 'user', 'First'), row('a1', 'q1', 'assistant', 'One'),
    row('q2a', 'a1', 'user', 'Second'), row('a2a', 'q2a', 'assistant', 'Two'),
    row('q2b', 'a1', 'user', 'Second, edited'), row('a2b', 'q2b', 'assistant', 'Two again'),
  ]

  it('finds the edited question on the current branch and where each version ends', () => {
    const tree = buildConversationTree(rows, 'a2b')
    expect([...tree.path]).toEqual(['a2b', 'q2b', 'a1', 'q1'])
    expect(branchPoints(tree).get('q2b')).toEqual({ index: 1, count: 2, previous: 'a2a' })
    expect(branchPoints(tree).has('q1')).toBe(false)
    expect(branchLeaf(tree, 'q2a')).toBe('a2a')
  })

  it('follows the latest child to a branch end', () => {
    const tree = buildConversationTree([...rows, row('q3', 'a2a', 'user', 'Third'), row('a3', 'q3', 'assistant', 'Three')], 'a2b')
    expect(branchLeaf(tree, 'q2a')).toBe('a3')
    expect(branchPoints(buildConversationTree(tree.rows, 'a3')).get('q2a')).toEqual({ index: 0, count: 2, next: 'a2b' })
  })
})
