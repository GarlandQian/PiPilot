import { describe, expect, it } from 'vitest'
import {
  fileTreeSearchAction,
  normalizeFileTreeSearchQuery,
  projectFileTreeSearchResult,
} from '../../src/components/inspector/file-tree-search'
import type { WorkspacePathSearchResult } from '../../src/shared/workspace-content'

const workspaceId = '00000000-0000-4000-8000-000000000101'

function result(
  overrides: Partial<WorkspacePathSearchResult> = {},
): WorkspacePathSearchResult {
  return {
    workspaceId,
    query: 'readme',
    entries: [{ name: 'README.md', path: 'docs/README.md', type: 'file' }],
    truncated: false,
    ...overrides,
  }
}

describe('file tree search projection', () => {
  it('normalizes and bounds the query before dispatch', () => {
    expect(normalizeFileTreeSearchQuery('  readme  ')).toBe('readme')
    expect(normalizeFileTreeSearchQuery('x'.repeat(600))).toHaveLength(512)
  })

  it('accepts only the exact workspace and query result', () => {
    expect(projectFileTreeSearchResult(workspaceId, 'readme', result())).toEqual({
      status: 'ready',
      entries: [{ name: 'README.md', path: 'docs/README.md', type: 'file' }],
      truncated: false,
    })
    expect(projectFileTreeSearchResult(
      '00000000-0000-4000-8000-000000000102',
      'readme',
      result(),
    )).toBeNull()
    expect(projectFileTreeSearchResult(workspaceId, 'source', result())).toBeNull()
  })

  it('opens files and drills into directory results without inventing paths', () => {
    expect(fileTreeSearchAction({
      name: 'README.md',
      path: 'docs/README.md',
      type: 'file',
    })).toEqual({ type: 'preview', path: 'docs/README.md' })
    expect(fileTreeSearchAction({
      name: 'components',
      path: 'src/components',
      type: 'dir',
    })).toEqual({ type: 'search', query: 'src/components/' })
  })
})
