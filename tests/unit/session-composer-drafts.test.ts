import { describe, expect, it, vi } from 'vitest'
import { SessionComposerDrafts } from '../../src/renderer/composer/session-drafts'
import { plainTextToComposerDocument } from '../../src/renderer/composer/composer-mentions'
import type { ComposerImageAttachment } from '../../src/renderer/composer/composer-submission'

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
