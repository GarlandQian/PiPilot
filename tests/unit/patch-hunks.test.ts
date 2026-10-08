import { describe, expect, it } from 'vitest'
import { patchHunks } from '../../src/shared/patch-hunks'

const patch = [
  'diff --git a/app.ts b/app.ts', 'index 1111111..2222222 100644', '--- a/app.ts', '+++ b/app.ts',
  '@@ -1,3 +1,3 @@', ' one', '-two', '+TWO', ' three',
  '@@ -10,2 +10,3 @@', ' ten', '+ten and a half', ' eleven', '',
].join('\n')

describe('patch hunks', () => {
  it('splits a file diff into hunks Git can apply one at a time', () => {
    const hunks = patchHunks(patch)
    expect(hunks).toHaveLength(2)
    expect(hunks[0]).toMatchObject({ index: 0, anchor: { side: 'deletions', lineNumber: 2 }, added: 1, deleted: 1 })
    expect(hunks[1]).toMatchObject({ index: 1, anchor: { side: 'additions', lineNumber: 11 }, added: 1, deleted: 0 })
    // The row above each hunk's changes sits after its leading context.
    expect(hunks[0]!.top).toEqual({ side: 'additions', lineNumber: 1 })
    expect(hunks[1]!.top).toEqual({ side: 'additions', lineNumber: 10 })
    expect([hunks[1]!.newStart, hunks[1]!.newEnd]).toEqual([10, 12])
    expect(patchHunks(patch.replace(' one\n-two', '-two'))[0]!.top).toEqual({ side: 'additions', lineNumber: 0 })
    expect(hunks[1]!.patch).toBe('diff --git a/app.ts b/app.ts\nindex 1111111..2222222 100644\n--- a/app.ts\n+++ b/app.ts\n@@ -10,2 +10,3 @@\n ten\n+ten and a half\n eleven\n')
  })

  it('leaves renames and mode changes whole', () => {
    expect(patchHunks(patch.replace('index 1111111..2222222 100644', 'rename from old.ts\nrename to app.ts'))).toEqual([])
    expect(patchHunks('Binary files a/x and b/x differ\n')).toEqual([])
  })
})
