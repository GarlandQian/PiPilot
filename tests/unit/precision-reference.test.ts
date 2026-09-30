import type { JSONContent } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import { composerDocumentHasContent, serializeComposerDocument } from '../../src/renderer/composer/composer-mentions'
import { DiffReviewStore, selectedDiffText } from '../../src/renderer/composer/diff-review'
import { isPrecisionReference, MAX_REFERENCE_TEXT, referenceLineRange, serializePrecisionReference, type PrecisionReference } from '../../src/renderer/composer/precision-reference'

const reference = (overrides: Partial<PrecisionReference> = {}): PrecisionReference => ({
  id: 'comment-1', ownerKey: 'project:A:session-A', kind: 'diff', sourceId: 'unstaged:src/main.ts',
  label: 'src/main.ts', path: 'src/main.ts', text: 'const answer = 2', startLine: 2, endLine: 2,
  side: 'additions', stage: 'unstaged', revision: 'a'.repeat(64), comment: 'Keep the public contract.', ...overrides,
})

const patch = `diff --git a/src/main.ts b/src/main.ts
--- a/src/main.ts
+++ b/src/main.ts
@@ -1,4 +1,5 @@
 first
-old answer
+new answer
+inserted line
 third
 last
@@ -20,2 +21,2 @@
 far away
-old tail
+new tail
\\ No newline at end of file
`

describe('precise captured references', () => {
  it('preserves source, old/new lines, revision and an immutable snapshot in the actual prompt', () => {
    const captured = reference({ text: 'nested ``` fence\nand ```` literal', stale: true })
    const serialized = serializePrecisionReference(captured)
    expect(serialized).toContain('Review of project changes')
    expect(serialized).toContain(`src/main.ts · lines 2-2 · new side · unstaged · snapshot ${'a'.repeat(64)}`)
    expect(serialized).toContain('`````text\nnested ``` fence\nand ```` literal\n`````')
    expect(serialized).toContain('Comment: Keep the public contract.')
    expect(serialized).toContain('Warning: this snapshot is outdated')
    expect(serialized).not.toContain(captured.ownerKey)
  })

  it('serializes references alongside existing text and a skill without dropping the quoted content', () => {
    const captured = reference()
    const document: JSONContent = { type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'composerMention', attrs: { kind: 'skill', commandName: 'skill:audit', label: 'audit' } },
      { type: 'text', text: ' Please inspect this. ' },
      { type: 'precisionReference', attrs: { reference: captured } },
    ] }] }
    expect(composerDocumentHasContent(document)).toBe(true)
    expect(serializeComposerDocument(document)).toBe(`/skill:audit Please inspect this. ${serializePrecisionReference(captured)}`)
    expect(serializeComposerDocument({ type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'precisionReference', attrs: { reference: captured, hidden: 'untrusted' } },
    ] }] })).toBeNull()
  })

  it('rejects incomplete diff provenance, invalid ranges, oversized content and hidden fields', () => {
    expect(isPrecisionReference(reference())).toBe(true)
    for (const invalid of [
      { path: undefined }, { revision: undefined }, { side: undefined }, { stage: undefined },
      { startLine: undefined }, { endLine: 1 }, { startLine: 0 }, { startLine: 1.5 },
      { text: 'x'.repeat(MAX_REFERENCE_TEXT + 1) }, { text: '  ' }, { unexpected: true },
    ]) expect(isPrecisionReference({ ...reference(), ...invalid })).toBe(false)
    expect(isPrecisionReference({ id: 'quote', ownerKey: 'A', kind: 'message', sourceId: 'turn-A', label: 'Assistant message', text: 'Rendered Markdown selection' })).toBe(true)
  })

  it('maps literal selection offsets precisely without inventing an extra line for its final newline', () => {
    expect(referenceLineRange('one\ntwo\nthree', 4, 8)).toEqual({ startLine: 2, endLine: 2 })
    expect(referenceLineRange('one\ntwo\nthree', 5, 10)).toEqual({ startLine: 2, endLine: 3 })
    expect(referenceLineRange('one', 2, 2)).toBeUndefined()
    expect(referenceLineRange('one', 0, 4)).toBeUndefined()
  })
})

describe('real diff line selections', () => {
  it('captures each side using its own line numbers, including reverse drag and context', () => {
    expect(selectedDiffText(patch, { start: 2, end: 4, side: 'additions' })).toEqual({
      text: 'new answer\ninserted line\nthird', startLine: 2, endLine: 4, side: 'additions',
    })
    expect(selectedDiffText(patch, { start: 3, end: 2, side: 'deletions' })).toEqual({
      text: 'old answer\nthird', startLine: 2, endLine: 3, side: 'deletions',
    })
    expect(selectedDiffText(patch, { start: 22, end: 22 })).toEqual({ text: 'new tail', startLine: 22, endLine: 22, side: 'additions' })
  })

  it('rejects cross-side ranges, hidden hunk gaps and invalid or oversized selection', () => {
    for (const range of [
      { start: 2, end: 4, side: 'additions' as const, endSide: 'deletions' as const },
      { start: 4, end: 21 }, { start: 0, end: 2 }, { start: 1, end: 1.5 }, { start: 1, end: Infinity },
    ]) expect(selectedDiffText(patch, range)).toBeNull()
    expect(selectedDiffText(`@@ -0,0 +1 @@\n+${'x'.repeat(MAX_REFERENCE_TEXT + 1)}`, { start: 1, end: 1 })).toBeNull()
    expect(selectedDiffText('@@ -0,0 +1 @@\n+new file', { start: 1, end: 1 })).toMatchObject({ text: 'new file', side: 'additions' })
  })
})

function memoryReviews() {
  const rows = new Map<string, Record<string, unknown>>()
  let fail = false
  return { rows, setFail(value: boolean) { fail = value },
    persistence: {
      async read(key: string) { return structuredClone(rows.get(key)) },
      async write(key: string, value?: Record<string, unknown>) {
        if (fail) throw new Error('disk full')
        if (value) rows.set(key, structuredClone(value)); else rows.delete(key)
      },
    },
  }
}

describe('durable session and workspace owned diff review drafts', () => {
  it('restores comments after restart and isolates both session and workspace owners', async () => {
    const memory = memoryReviews(), store = new DiffReviewStore(memory.persistence)
    const a = reference(), b = reference({ id: 'B', ownerKey: 'project:A:session-B' }), c = reference({ id: 'C', ownerKey: 'project:B:session-C' })
    for (const [key, comment] of [['A', a], ['B', b], ['C', c]] as const) await store.change(key, comment.ownerKey, () => [comment])
    const restored = new DiffReviewStore(memory.persistence)
    await restored.load('A', a.ownerKey)
    expect(restored.get('A').comments).toEqual([a])
    expect(restored.get('B').loaded).toBe(false)
    await restored.change('A', a.ownerKey, () => [])
    expect(memory.rows.has('A')).toBe(false)
    expect(memory.rows.get('B')).toEqual({ comments: [b] })
    expect(memory.rows.get('C')).toEqual({ comments: [c] })
  })

  it('serializes concurrent edits and publishes only durable commits; failed cleanup remains retryable', async () => {
    const memory = memoryReviews(), store = new DiffReviewStore(memory.persistence), a = reference()
    await Promise.all([
      store.change('A', a.ownerKey, () => [a]),
      store.change('A', a.ownerKey, (comments) => [...comments, reference({ id: 'second' })]),
    ])
    expect(store.get('A').comments).toHaveLength(2)
    memory.setFail(true)
    await expect(store.change('A', a.ownerKey, () => [])).rejects.toThrow('disk full')
    expect(store.get('A').comments).toHaveLength(2)
    memory.setFail(false)
    await store.change('A', a.ownerKey, (comments) => comments.map((comment) => ({ ...comment, comment: 'Revised comment' })))
    expect(store.get('A').comments.map((comment) => comment.comment)).toEqual(['Revised comment', 'Revised comment'])
  })

  it('does not let failed loads, forged owners or duplicate comment identities replace a valid draft', async () => {
    const memory = memoryReviews(), a = reference(), store = new DiffReviewStore(memory.persistence)
    memory.rows.set('corrupt', { comments: [reference({ ownerKey: 'different session' })] })
    await expect(store.load('corrupt', a.ownerKey)).rejects.toThrow('Invalid review draft')
    expect(store.get('corrupt').loaded).toBe(false)
    await store.change('A', a.ownerKey, () => [a])
    await expect(store.change('A', a.ownerKey, () => [a, a])).rejects.toThrow('Invalid review draft')
    await expect(store.change('A', a.ownerKey, () => [reference({ ownerKey: 'different session' })])).rejects.toThrow('Invalid review draft')
    expect(store.get('A').comments).toEqual([a])
    a.text = 'changed externally'
    expect(store.get('A').comments[0]?.text).toBe('const answer = 2')
  })
})
