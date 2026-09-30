import type { JSONContent } from '@tiptap/core'
import { IndexedDbRecordStore } from '../indexeddb-record-store'
import { isComposerMentionAttrs } from './composer-mentions'
import { validateComposerImageBatch } from './composer-submission'
import { isPrecisionReference, PRECISION_REFERENCE_NODE } from './precision-reference'

export interface StoredComposerDraft {
  document: JSONContent
  attachments: { id: string; key: string; name: string; lastModified: number; blob: Blob }[]
}

export interface ComposerDraftPersistence {
  read(key: string): Promise<StoredComposerDraft | null>
  write(key: string, draft: StoredComposerDraft | null): Promise<void>
}

// Validate structure rather than sendability: an unfinished draft may contain
// duplicate mentions or two skills which the user has not resolved yet.
function validDocument(value: unknown): value is JSONContent {
  if (!value || typeof value !== 'object') return false
  const doc = value as JSONContent
  if (doc.type !== 'doc' || !Array.isArray(doc.content)) return false
  return doc.content.every((paragraph) => paragraph?.type === 'paragraph' &&
    (paragraph.content === undefined || (Array.isArray(paragraph.content) && paragraph.content.every((node) =>
      node?.type === 'text' ? typeof node.text === 'string' :
        node?.type === 'hardBreak' || (node?.type === 'composerMention' && isComposerMentionAttrs(node.attrs)) ||
        (node?.type === PRECISION_REFERENCE_NODE && isPrecisionReference(node.attrs?.reference))))))
}

export class IndexedDbDraftPersistence implements ComposerDraftPersistence {
  private readonly records = new IndexedDbRecordStore('pipilot-composer-drafts', 'conversations')

  async read(key: string): Promise<StoredComposerDraft | null> {
    const value = await this.records.read(key)
    if (value === undefined) return null
    const draft = value as StoredComposerDraft
    if (!draft || !validDocument(draft.document) || !Array.isArray(draft.attachments)) {
      throw new Error('The saved draft is invalid.')
    }
    const ids = new Set<string>()
    for (const item of draft.attachments) {
      if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id) ||
        typeof item.key !== 'string' || typeof item.name !== 'string' ||
        !Number.isFinite(item.lastModified) || !(item.blob instanceof Blob)) {
        throw new Error('The saved draft attachments are invalid.')
      }
      ids.add(item.id)
    }
    const files = draft.attachments.map((item) => new File([item.blob], item.name, {
      type: item.blob.type, lastModified: item.lastModified,
    }))
    if (validateComposerImageBatch([], files)) throw new Error('The saved draft images are invalid.')
    return draft
  }

  write(key: string, draft: StoredComposerDraft | null): Promise<void> {
    return this.records.write(key, draft ? { document: draft.document, attachments: draft.attachments } : undefined)
  }
}
