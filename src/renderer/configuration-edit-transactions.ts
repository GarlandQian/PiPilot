/** Form edits are staged separately from a configuration document's JSON draft. */
export interface ConfigurationEditTransaction {
  dirty: boolean
  revision: unknown
  commit(): boolean
}

export class ConfigurationEditTransactions {
  private readonly entries = new Map<object, ConfigurationEditTransaction>()
  private readonly committed = new Map<object, unknown>()
  private readonly listeners = new Set<() => void>()
  private locked = false

  isLocked = () => this.locked
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  private publish() { for (const listener of this.listeners) listener() }

  update(owner: object, transaction: ConfigurationEditTransaction | null) {
    if (transaction) this.entries.set(owner, transaction)
    else { this.entries.delete(owner); this.committed.delete(owner) }
    this.publish()
  }

  isDirty = () => [...this.entries].some(([owner, edit]) =>
    edit.dirty && (!this.committed.has(owner) || this.committed.get(owner) !== edit.revision))

  setShutdownLocked(locked: boolean) {
    if (this.locked === locked) return
    this.locked = locked
    this.publish()
  }

  /** Validate and stage each form before the exit guard captures document revisions. */
  commit() {
    if (this.locked) return false
    for (const [owner, edit] of [...this.entries]) {
      if (!edit.dirty || (this.committed.has(owner) && this.committed.get(owner) === edit.revision)) continue
      if (!edit.commit()) return false
      this.committed.set(owner, edit.revision)
    }
    this.publish()
    return !this.isDirty()
  }
}
