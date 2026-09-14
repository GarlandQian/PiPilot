import { isConfigDocumentDirty, type ConfigurationDocument, type ConfigDocumentSnapshot } from './configuration-documents'
import { ConfigurationEditTransactions } from './configuration-edit-transactions'

type ExitDocument = Pick<ConfigurationDocument<ConfigDocumentSnapshot>, 'getSnapshot' | 'save' | 'subscribe'>
interface ExitRegistry {
  values(): ExitDocument[]
  setShutdownLocked(locked: boolean): void
}

/** No serialization or persistence: operates directly on the in-memory document owners. */
export class ConfigurationDocumentExitGuard {
  private epoch = 0
  constructor(
    private readonly registries: ExitRegistry[],
    private readonly edits = new ConfigurationEditTransactions(),
  ) {}

  private documents() { return this.registries.flatMap((registry) => registry.values()) }

  isBusy = () => this.documents().some((document) => document.getSnapshot().phase !== 'idle')

  subscribe = (listener: () => void) => {
    const detach = [this.edits.subscribe(listener), ...this.documents().map((document) => document.subscribe(listener))]
    return () => { for (const unsubscribe of detach) unsubscribe() }
  }

  private lock() {
    for (const registry of this.registries) registry.setShutdownLocked(true)
    this.edits.setShutdownLocked(true)
    return true
  }

  unlock() {
    this.epoch += 1
    for (const registry of this.registries) registry.setShutdownLocked(false)
    this.edits.setShutdownLocked(false)
  }

  lockIfClean() {
    if (this.edits.isDirty()) return false
    if (this.documents().some((document) => {
      const state = document.getSnapshot()
      return state.phase !== 'idle' || isConfigDocumentDirty(state)
    })) return false
    return this.lock()
  }

  discardAndLock() {
    if (this.documents().some((document) => document.getSnapshot().phase !== 'idle')) return false
    // Keep the actual drafts intact in case Main cancels this shutdown.
    return this.lock()
  }

  async saveAndLock() {
    const epoch = this.epoch
    if (this.isBusy() || !this.edits.commit()) return false
    const documents = this.documents()
    const captured = documents.map((document) => ({ document, state: document.getSnapshot() }))
    if (captured.some(({ state }) => state.phase !== 'idle')) return false
    const revisions = await Promise.all(captured.map(async ({ document, state }) => {
      if (!isConfigDocumentDirty(state)) return state.revision
      const result = await document.save(false)
      if (!result) return null
      return state.revision + (result.snapshot.content === state.draftText ? 0 : 1)
    }))
    const current = this.documents()
    if (epoch !== this.epoch || this.edits.isDirty()) return false
    if (current.length !== documents.length || current.some((document) => !documents.includes(document))) return false
    if (captured.some(({ document }, index) => {
      const state = document.getSnapshot()
      return revisions[index] === null || state.revision !== revisions[index] ||
        state.phase !== 'idle' || isConfigDocumentDirty(state)
    })) return false
    return this.lock()
  }
}
