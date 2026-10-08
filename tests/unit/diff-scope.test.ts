import { describe, expect, it } from 'vitest'
import { diffScopeCounts, filterDiffScope, lastTurnEditedPaths, touchedInLastTurn } from '../../src/components/inspector/diff-scope'
import type { LocalPiSessionEntry } from '../../src/shared/local-pi'

const message = (id: string, parentId: string | null, role: 'user' | 'assistant', content: unknown) =>
  ({ type: 'message', id, parentId, timestamp: '2026-10-08T00:00:00.000Z', message: { role, content, timestamp: 0 } }) as unknown as LocalPiSessionEntry
const edit = (name: string, path: string) => ({ type: 'toolCall', id: `${name}:${path}`, name, arguments: { path } })

describe('Changes scopes', () => {
  it('names the files Pi wrote or edited after the latest user message', () => {
    const entries = [
      message('u1', null, 'user', 'first'),
      message('a1', 'u1', 'assistant', [edit('write', 'old.ts')]),
      message('u2', 'a1', 'user', 'second'),
      message('a2', 'u2', 'assistant', [edit('edit', '/Users/me/project/src/app.ts'), edit('read', 'README.md'), edit('write', '.\\docs\\guide.md')]),
    ]
    expect(lastTurnEditedPaths(entries, 'a2')).toEqual(['/Users/me/project/src/app.ts', 'docs/guide.md'])
    expect(touchedInLastTurn('src/app.ts', ['/Users/me/project/src/app.ts'])).toBe(true)
    expect(touchedInLastTurn('app.ts', ['/Users/me/project/src/my-app.ts'])).toBe(false)
  })

  it('filters and counts by stage or by the last turn', () => {
    const files = [
      { path: 'src/app.ts', stage: 'staged' as const },
      { path: 'src/app.ts', stage: 'unstaged' as const },
      { path: 'other.ts', stage: 'unstaged' as const },
    ]
    const edited = ['src/app.ts']
    expect(filterDiffScope(files, 'staged', edited)).toEqual([files[0]])
    expect(filterDiffScope(files, 'lastTurn', edited)).toEqual([files[0], files[1]])
    expect(diffScopeCounts(files, edited)).toEqual({ unstaged: 2, staged: 1, lastTurn: 1 })
    // Branch and Commit bring their own lists.
    expect(filterDiffScope(files, 'commit', edited)).toEqual(files)
  })
})
