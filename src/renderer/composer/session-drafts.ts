import type { JSONContent } from '@tiptap/core'
import { plainTextToComposerDocument, type ComposerDocumentSnapshot } from './composer-mentions'
import type { ComposerImageAttachment } from './composer-submission'
import { IndexedDbDraftPersistence, type ComposerDraftPersistence, type StoredComposerDraft } from './draft-persistence'

export interface SessionComposerDraft {
  document: JSONContent
  documentRevision: number
  attachments: readonly ComposerImageAttachment[]
}

export type DraftStorageState = 'loading' | 'ready' | 'saving' | 'error'

/** Per-conversation drafts; Runtime generations do not own user input. */
export class SessionComposerDrafts {
  private readonly drafts = new Map<string, SessionComposerDraft>()
  private readonly editors = new Map<string, { owner: object; revision: number }>()
  private sequence = 0
  private readonly listeners = new Map<string, Set<(clearedRevision?: number) => void>>()
  private readonly storageListeners = new Set<() => void>()
  private readonly loaded = new Set<string>()
  private readonly loads = new Map<string, Promise<void>>()
  private readonly writes = new Map<string, Promise<void>>()
  private readonly revisions = new Map<string, number>()
  private readonly dirty = new Set<string>()
  private readonly errors = new Set<string>()
  private readonly deleted = new Set<string>()
  private disposed = false
  private locked = false

  constructor(
    private readonly releaseUrl = (url: string) => URL.revokeObjectURL(url),
    private readonly persistence?: ComposerDraftPersistence,
    private readonly createUrl = (blob: Blob) => URL.createObjectURL(blob),
  ) {}

  subscribeStorage = (listener: () => void) => {
    this.storageListeners.add(listener)
    return () => { this.storageListeners.delete(listener) }
  }

  isLocked = () => this.locked
  setLocked(locked: boolean) { this.locked = locked; this.publishStorage() }

  isLoaded(key: string) { return !this.persistence || this.loaded.has(key) }
  storageState(key: string): DraftStorageState {
    if (this.errors.has(key)) return 'error'
    if (!this.isLoaded(key)) return 'loading'
    return this.dirty.has(key) ? 'saving' : 'ready'
  }
  private publishStorage() { for (const listener of this.storageListeners) listener() }

  load(key: string): Promise<void> {
    if (this.isLoaded(key) || this.deleted.has(key)) return Promise.resolve()
    const existing = this.loads.get(key)
    if (existing) return existing
    const revision = this.revisions.get(key)
    this.errors.delete(key)
    const pending = this.persistence!.read(key).then((stored) => {
      if (this.disposed || this.deleted.has(key)) return
      // A delayed restore must never replace edits made while it was in flight.
      if (stored && this.revisions.get(key) === revision) {
        this.drafts.set(key, {
          document: stored.document, documentRevision: ++this.sequence,
          attachments: stored.attachments.map((item) => ({
            id: item.id, key: item.key,
            file: new File([item.blob], item.name, { type: item.blob.type, lastModified: item.lastModified }),
            previewUrl: this.createUrl(item.blob),
          })),
        })
      }
      this.loaded.add(key)
    }).catch((error) => { this.errors.add(key); throw error }).finally(() => {
      this.loads.delete(key)
      this.publishStorage()
    })
    this.loads.set(key, pending)
    this.publishStorage()
    return pending
  }

  private changed(key: string) {
    if (!this.persistence || this.deleted.has(key) || this.disposed) return
    this.revisions.set(key, (this.revisions.get(key) ?? 0) + 1)
    this.dirty.add(key)
    // No debounce window to lose the last keystroke at close. In-flight writes
    // coalesce to the latest revision rather than queue every typed character.
    void this.flush(key).catch(() => undefined)
  }

  private stored(key: string): StoredComposerDraft | null {
    const draft = this.drafts.get(key)
    if (!draft || this.deleted.has(key)) return null
    const hasInput = draft.document.content?.some((paragraph) => paragraph.content?.length)
    if (!hasInput && !draft.attachments.length) return null
    return {
      document: structuredClone(draft.document),
      attachments: draft.attachments.map(({ id, key, file }) => ({ id, key,
        name: file.name, lastModified: file.lastModified, blob: file })),
    }
  }

  flush(key: string): Promise<void> {
    const existing = this.writes.get(key)
    if (existing) return existing
    if (!this.persistence || !this.dirty.has(key)) return Promise.resolve()
    this.errors.delete(key)
    const pending = (async () => {
      await this.load(key)
      while (this.dirty.has(key)) {
        const revision = this.revisions.get(key)
        await this.persistence!.write(key, this.stored(key))
        if (this.revisions.get(key) === revision) this.dirty.delete(key)
      }
    })().catch((error) => { this.errors.add(key); throw error }).finally(() => {
      this.writes.delete(key)
      this.publishStorage()
    })
    this.writes.set(key, pending)
    this.publishStorage()
    return pending
  }

  async flushAll() {
    if (!this.persistence) return
    while (this.dirty.size) await Promise.all([...this.dirty].map((key) => this.flush(key)))
  }

  async remove(key: string) {
    // Tombstone first: an editor unmount or late acceptance cannot resurrect it.
    this.deleted.add(key)
    for (const attachment of this.drafts.get(key)?.attachments ?? []) this.releaseUrl(attachment.previewUrl)
    this.drafts.delete(key)
    this.editors.delete(key)
    this.loaded.add(key)
    this.revisions.set(key, (this.revisions.get(key) ?? 0) + 1)
    if (this.persistence) this.dirty.add(key)
    await this.flush(key)
  }

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
    if (this.deleted.has(key) || this.locked) return
    const previous = this.editors.get(key)
    if (previous?.owner === owner && previous.revision === snapshot.revision) return
    this.editors.set(key, { owner, revision: snapshot.revision })
    // Restoring a draft into a new editor is not a user edit. Compare only on
    // mount, so typing does not repeatedly serialize the entire document.
    if (previous?.owner !== owner && JSON.stringify(this.get(key).document) === JSON.stringify(snapshot.document)) return
    this.drafts.set(key, { ...this.get(key), document: snapshot.document, documentRevision: ++this.sequence })
    this.changed(key)
  }

  updateAttachments(key: string, attachments: readonly ComposerImageAttachment[], accepted = false) {
    if (this.deleted.has(key) || (this.locked && !accepted)) return
    const keep = new Set(attachments.map((attachment) => attachment.previewUrl))
    for (const old of this.get(key).attachments) if (!keep.has(old.previewUrl)) this.releaseUrl(old.previewUrl)
    this.drafts.set(key, { ...this.get(key), attachments })
    this.changed(key)
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
    this.updateAttachments(key, this.get(key).attachments.filter((attachment) => !acceptedIds.has(attachment.id)), true)
    if (clearedRevision !== undefined) {
      for (const listener of this.listeners.get(key) ?? []) listener(clearedRevision)
    }
    return this.get(key)
  }

  dispose() {
    this.disposed = true
    for (const draft of this.drafts.values()) for (const attachment of draft.attachments) this.releaseUrl(attachment.previewUrl)
    this.drafts.clear()
    this.editors.clear()
    this.listeners.clear()
    this.storageListeners.clear()
  }
}

/** Shared with deletion/shutdown; component unmounts do not discard input. */
export const sessionComposerDrafts = new SessionComposerDrafts(undefined, new IndexedDbDraftPersistence())
