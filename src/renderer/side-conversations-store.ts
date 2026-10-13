import type { ConversationScope } from '@/shared/conversation-scope'
import type { SideConversationConfiguration, SideConversationSnapshot } from '@/shared/side-conversations'
import type { PrecisionReference } from './composer/precision-reference'

export interface SideQuestionRequest { id: string; scope: ConversationScope; parentSessionId: string; reference: PrecisionReference }
export interface SideThread extends SideQuestionRequest {
  snapshot?: SideConversationSnapshot
  text: string
  busy: boolean
  interactionBusy?: boolean
  error?: string
  configuration?: SideConversationConfiguration
  submission?: { requestId: string; text: string; configuration?: SideConversationConfiguration }
}
interface SideViews { threads: readonly SideThread[]; selected: Readonly<Record<string, string>> }

/** View lifetime is independent of the panel. Main owns execution and official session history. */
export class SideConversationsStore {
  private state: SideViews = { threads: [], selected: {} }
  private listeners = new Set<() => void>()
  private seen = new Set<string>()
  private closed = new Set<string>()
  getSnapshot = () => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private publish(next: SideViews) { this.state = next; for (const listener of this.listeners) listener() }
  add(request: SideQuestionRequest) {
    if (this.seen.has(request.id)) return
    this.seen.add(request.id)
    this.publish({ threads: [...this.state.threads, { ...request, text: '', busy: false }], selected: { ...this.state.selected, [request.reference.ownerKey]: request.id } })
  }
  update(id: string, patch: Partial<SideThread>) {
    this.publish({ ...this.state, threads: this.state.threads.map((thread) => thread.id === id ? { ...thread, ...patch } : thread) })
  }
  select(ownerKey: string, id: string) { this.publish({ ...this.state, selected: { ...this.state.selected, [ownerKey]: id } }) }
  accept(id: string, snapshot: SideConversationSnapshot, submittedText: string) {
    const thread = this.state.threads.find((item) => item.id === id)
    if (!thread) return
    this.publish({ ...this.state, threads: this.state.threads.filter((item) => item.id === id || item.snapshot?.sideId !== snapshot.sideId).map((item) => item.id === id
      ? { ...item, snapshot, text: item.text === submittedText ? '' : item.text, busy: false, submission: undefined, configuration: undefined, error: undefined } : item) })
  }
  merge(ownerKey: string, snapshots: readonly SideConversationSnapshot[]) {
    let threads = [...this.state.threads]
    for (const snapshot of snapshots) {
      if (snapshot.reference.ownerKey !== ownerKey || this.closed.has(snapshot.sideId)) continue
      const existing = threads.find((item) => item.snapshot?.sideId === snapshot.sideId || (!item.snapshot && item.busy && item.reference.id === snapshot.reference.id && item.reference.ownerKey === ownerKey))
      // An in-flight send/configuration response is newer than this inventory read.
      if (existing) { if (!existing.busy) threads = threads.map((item) => item === existing ? { ...item, snapshot } : item); continue }
      threads.push({ id: snapshot.sideId, scope: snapshot.scope, parentSessionId: snapshot.parentSessionId, reference: snapshot.reference, snapshot, text: '', busy: false })
    }
    const current = this.state.selected[ownerKey]
    const selected = threads.some((item) => item.id === current && item.reference.ownerKey === ownerKey) ? current : threads.find((item) => item.reference.ownerKey === ownerKey)?.id
    this.publish({ threads, selected: selected ? { ...this.state.selected, [ownerKey]: selected } : this.state.selected })
  }
  close(id: string) {
    const thread = this.state.threads.find((item) => item.id === id)
    if (!thread) return
    if (thread.snapshot) this.closed.add(thread.snapshot.sideId)
    const threads = this.state.threads.filter((item) => item.id !== id)
    const owner = thread.reference.ownerKey
    this.publish({ threads, selected: { ...this.state.selected, [owner]: this.state.selected[owner] === id ? threads.find((item) => item.reference.ownerKey === owner)?.id ?? '' : this.state.selected[owner] } })
  }
}

export const sideConversationsStore = new SideConversationsStore()
