import { describe, expect, it, vi } from 'vitest'
import { SessionComposerDrafts } from '../../src/renderer/composer/session-drafts'
import { plainTextToComposerDocument } from '../../src/renderer/composer/composer-mentions'
import type { ComposerImageAttachment } from '../../src/renderer/composer/composer-submission'
import type { ComposerDraftPersistence, StoredComposerDraft } from '../../src/renderer/composer/draft-persistence'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

class MemoryDrafts implements ComposerDraftPersistence {
  records = new Map<string, StoredComposerDraft>()
  beforeRead?: () => Promise<void>
  beforeWrite?: () => Promise<void>
  async read(key: string) { await this.beforeRead?.(); return structuredClone(this.records.get(key) ?? null) }
  async write(key: string, draft: StoredComposerDraft | null) {
    await this.beforeWrite?.()
    if (draft) this.records.set(key, structuredClone(draft))
    else this.records.delete(key)
  }
}

function attachment(id: string): ComposerImageAttachment {
  return { id, key: id, file: new File(['image'], `${id}.png`, { type: 'image/png' }), previewUrl: `blob:${id}` }
}

describe('conversation-owned composer drafts', () => {
  it('keeps text, trusted references and images isolated while switching conversations', () => {
    const release = vi.fn()
    const drafts = new SessionComposerDrafts(release)
    const document = { type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'text', text: 'Review ' },
      { type: 'mention', attrs: { kind: 'file', path: 'src/App.tsx', label: 'App.tsx' } },
    ] }] }
    drafts.updateDocument('project:A', {}, { revision: 1, document })
    drafts.updateAttachments('project:A', [attachment('A')])
    expect(drafts.get('project:B').attachments).toEqual([])
    drafts.updateDocument('project:B', {}, { revision: 1, document: plainTextToComposerDocument('Different prompt') })
    expect(drafts.get('project:A').document).toEqual(document)
    expect(drafts.get('project:A').attachments[0]?.id).toBe('A')
    expect(release).not.toHaveBeenCalled()
    drafts.dispose()
    expect(release).toHaveBeenCalledExactlyOnceWith('blob:A')
  })

  it('clears an accepted background draft without changing another conversation', () => {
    const drafts = new SessionComposerDrafts(vi.fn())
    drafts.updateDocument('A', {}, { revision: 1, document: plainTextToComposerDocument('sent') })
    const sent = drafts.get('A')
    drafts.updateDocument('B', {}, { revision: 1, document: plainTextToComposerDocument('unsent') })
    drafts.acknowledge('A', sent)
    expect(drafts.get('A').document).toEqual(plainTextToComposerDocument(''))
    expect(drafts.get('B').document).toEqual(plainTextToComposerDocument('unsent'))
  })

  it('preserves edits and newly attached images made before an older send is accepted', () => {
    const release = vi.fn()
    const drafts = new SessionComposerDrafts(release)
    const editor = {}
    drafts.updateDocument('A', editor, { revision: 1, document: plainTextToComposerDocument('sent') })
    const old = attachment('old')
    drafts.updateAttachments('A', [old])
    const sent = drafts.get('A')
    drafts.updateDocument('A', editor, { revision: 2, document: plainTextToComposerDocument('next') })
    drafts.updateAttachments('A', [old, attachment('new')])
    drafts.acknowledge('A', sent)
    expect(drafts.get('A').document).toEqual(plainTextToComposerDocument('next'))
    expect(drafts.get('A').attachments.map((item) => item.id)).toEqual(['new'])
    expect(release).toHaveBeenCalledExactlyOnceWith('blob:old')
  })

  it('clears a restored draft after late acceptance without mistaking remount for an edit', () => {
    const drafts = new SessionComposerDrafts(vi.fn())
    const document = plainTextToComposerDocument('sent before switching')
    drafts.updateDocument('A', {}, { revision: 3, document })
    const sent = drafts.get('A')
    drafts.updateDocument('B', {}, { revision: 1, document: plainTextToComposerDocument('other') })
    drafts.updateDocument('A', {}, { revision: 0, document: structuredClone(document) })
    expect(drafts.get('A').documentRevision).toBe(sent.documentRevision)
    const syncEditor = vi.fn()
    drafts.subscribe('A', syncEditor)
    drafts.acknowledge('A', sent)
    expect(syncEditor).toHaveBeenLastCalledWith(drafts.get('A').documentRevision)
    expect(drafts.get('A').document).toEqual(plainTextToComposerDocument(''))
    expect(drafts.get('B').document).toEqual(plainTextToComposerDocument('other'))
  })
})

describe('persistent conversation drafts', () => {
  function create(storage = new MemoryDrafts()) {
    const release = vi.fn()
    const drafts = new SessionComposerDrafts(release, storage, () => 'blob:restored')
    const edit = (key: string, text: string) => drafts.updateDocument(key, {}, {
      revision: 1, document: plainTextToComposerDocument(text),
    })
    return { drafts, storage, release, edit }
  }

  it('restores complete documents, trusted mentions and Blob attachments after recreation', async () => {
    const { drafts, storage } = create()
    await drafts.load('A')
    const document = { type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'text', text: 'Review ' },
      { type: 'composerMention', attrs: { kind: 'file', path: 'src/App.tsx', label: 'App.tsx' } },
    ] }] }
    drafts.updateDocument('A', {}, { revision: 1, document })
    drafts.updateAttachments('A', [attachment('screenshot')])
    await drafts.flushAll()
    drafts.dispose()
    const restored = create(storage)
    await restored.drafts.load('A')
    expect(restored.drafts.get('A').document).toEqual(document)
    const image = restored.drafts.get('A').attachments[0]!
    expect(image.file.name).toBe('screenshot.png')
    expect(await image.file.text()).toBe('image')
    expect(image.previewUrl).toBe('blob:restored')
    expect(restored.drafts.storageState('A')).toBe('ready')
    restored.drafts.dispose()
    expect(restored.release).toHaveBeenCalledExactlyOnceWith('blob:restored')
  })

  it('coalesces edits during a write without dropping the last text or attachment', async () => {
    const { drafts, storage, edit } = create()
    await drafts.load('A')
    const gate = deferred()
    const entered = deferred()
    storage.beforeWrite = async () => { entered.resolve(); await gate.promise }
    edit('A', 'first')
    await entered.promise
    edit('A', 'latest')
    drafts.updateAttachments('A', [attachment('new')])
    gate.resolve()
    await drafts.flush('A')
    expect(storage.records.get('A')?.document).toEqual(plainTextToComposerDocument('latest'))
    expect(storage.records.get('A')?.attachments[0]?.name).toBe('new.png')
  })

  it('never replaces a newer edit with a delayed restore', async () => {
    const { drafts, storage, edit } = create()
    storage.records.set('A', { document: plainTextToComposerDocument('old'), attachments: [] })
    const gate = deferred()
    storage.beforeRead = () => gate.promise
    const load = drafts.load('A')
    edit('A', 'new')
    gate.resolve()
    await load
    await drafts.flush('A')
    expect(drafts.get('A').document).toEqual(plainTextToComposerDocument('new'))
    expect(storage.records.get('A')?.document).toEqual(plainTextToComposerDocument('new'))
  })

  it('keeps failed saves retryable without discarding any input', async () => {
    const { drafts, storage, edit } = create()
    await drafts.load('A')
    storage.beforeWrite = async () => { throw new Error('disk full') }
    edit('A', 'unsaved')
    await expect(drafts.flush('A')).rejects.toThrow('disk full')
    expect(drafts.storageState('A')).toBe('error')
    expect(drafts.get('A').document).toEqual(plainTextToComposerDocument('unsaved'))
    storage.beforeWrite = undefined
    await drafts.flushAll()
    expect(drafts.storageState('A')).toBe('ready')
    expect(storage.records.get('A')?.document).toEqual(plainTextToComposerDocument('unsaved'))
  })

  it('deletes after in-flight writes and prevents late editor/acceptance resurrection', async () => {
    const { drafts, storage, edit } = create()
    await drafts.load('A')
    const gate = deferred()
    const entered = deferred()
    storage.beforeWrite = async () => { entered.resolve(); await gate.promise }
    edit('A', 'deleted')
    const captured = drafts.get('A')
    await entered.promise
    const removal = drafts.remove('A')
    edit('A', 'late')
    drafts.acknowledge('A', captured)
    gate.resolve()
    await removal
    expect(storage.records.has('A')).toBe(false)
    const replacement = create(storage)
    await replacement.drafts.load('A')
    expect(replacement.drafts.get('A').document).toEqual(plainTextToComposerDocument(''))
  })

  it('does not restore a deleted draft when its read completes late', async () => {
    const { drafts, storage } = create()
    storage.records.set('A', { document: plainTextToComposerDocument('deleted'), attachments: [] })
    const gate = deferred()
    storage.beforeRead = () => gate.promise
    const load = drafts.load('A')
    await drafts.remove('A')
    gate.resolve()
    await load
    expect(drafts.get('A').document).toEqual(plainTextToComposerDocument(''))
    expect(storage.records.has('A')).toBe(false)
  })

  it('saves empty drafts as removal and isolates other conversations', async () => {
    const { drafts, storage, edit } = create()
    await Promise.all([drafts.load('A'), drafts.load('B')])
    edit('A', 'sent')
    edit('B', 'keep')
    await drafts.flushAll()
    drafts.acknowledge('A', drafts.get('A'))
    await drafts.flushAll()
    expect(storage.records.has('A')).toBe(false)
    expect(storage.records.get('B')?.document).toEqual(plainTextToComposerDocument('keep'))
  })

  it('locks input for shutdown, flushes it and unlocks on cancelled shutdown', async () => {
    const { drafts, storage, edit } = create()
    await drafts.load('A')
    edit('A', 'before shutdown')
    drafts.setLocked(true)
    edit('A', 'ignored')
    drafts.updateAttachments('A', [attachment('ignored')])
    await drafts.flushAll()
    expect(storage.records.get('A')?.document).toEqual(plainTextToComposerDocument('before shutdown'))
    expect(storage.records.get('A')?.attachments).toEqual([])
    drafts.setLocked(false)
    edit('A', 'after cancel')
    await drafts.flushAll()
    expect(storage.records.get('A')?.document).toEqual(plainTextToComposerDocument('after cancel'))
  })
})
