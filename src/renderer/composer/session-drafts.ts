import type { JSONContent } from '@tiptap/core'
import { plainTextToComposerDocument, type ComposerDocumentSnapshot } from './composer-mentions'
import type { ComposerImageAttachment } from './composer-submission'

export interface SessionComposerDraft {
  document: JSONContent
  documentRevision: number
  attachments: readonly ComposerImageAttachment[]
}

/** In-memory, per-conversation drafts; Runtime generations do not own user input. */
export class SessionComposerDrafts {
  private readonly drafts = new Map<string, SessionComposerDraft>()
  private readonly editors = new Map<string, { owner: object; revision: number }>()
  private sequence = 0
  private readonly listeners = new Map<string, Set<(clearedRevision?: number) => void>>()

  constructor(private readonly releaseUrl = (url: string) => URL.revokeObjectURL(url)) {}

  subscribe(key: string, listener: (clearedRevision?: number) => void) {
    const listeners = this.listeners.get(key) ?? new Set<(clearedRevision?: number) => void>()
    this.listeners.set(key, listeners)
    listeners.add(listener)
    return () => { listeners.delete(listener); if (!listeners.size) this.listeners.delete(key) }
  }

  get(key: string): SessionComposerDraft {
    let draft = this.drafts.get(key)
    if (!draft) {
      draft = { document: plainTextToComposerDocument(''), documentRevision: ++this.sequence, attachments: [] }
      this.drafts.set(key, draft)
    }
    return draft
  }

  updateDocument(key: string, owner: object, snapshot: ComposerDocumentSnapshot) {
    const previous = this.editors.get(key)
    if (previous?.owner === owner && previous.revision === snapshot.revision) return
    this.editors.set(key, { owner, revision: snapshot.revision })
    // Restoring a draft into a new editor is not a user edit. Compare only on
    // mount, so typing does not repeatedly serialize the entire document.
    if (previous?.owner !== owner && JSON.stringify(this.get(key).document) === JSON.stringify(snapshot.document)) return
    this.drafts.set(key, { ...this.get(key), document: snapshot.document, documentRevision: ++this.sequence })
  }

  updateAttachments(key: string, attachments: readonly ComposerImageAttachment[]) {
    const keep = new Set(attachments.map((attachment) => attachment.previewUrl))
    for (const old of this.get(key).attachments) if (!keep.has(old.previewUrl)) this.releaseUrl(old.previewUrl)
    this.drafts.set(key, { ...this.get(key), attachments })
    for (const listener of this.listeners.get(key) ?? []) listener()
  }

  /** A late acceptance clears only its captured draft, never another conversation's input. */
  acknowledge(key: string, captured: SessionComposerDraft) {
    const current = this.get(key)
    let clearedRevision: number | undefined
    if (current.documentRevision === captured.documentRevision) {
      clearedRevision = ++this.sequence
      this.drafts.set(key, { ...current, document: plainTextToComposerDocument(''), documentRevision: clearedRevision })
      this.editors.delete(key)
    }
    const acceptedIds = new Set(captured.attachments.map((attachment) => attachment.id))
    this.updateAttachments(key, this.get(key).attachments.filter((attachment) => !acceptedIds.has(attachment.id)))
    if (clearedRevision !== undefined) {
      for (const listener of this.listeners.get(key) ?? []) listener(clearedRevision)
    }
    return this.get(key)
  }

  dispose() {
    for (const draft of this.drafts.values()) for (const attachment of draft.attachments) this.releaseUrl(attachment.previewUrl)
    this.drafts.clear()
    this.editors.clear()
    this.listeners.clear()
  }
}
