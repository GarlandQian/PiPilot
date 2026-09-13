import type { LocalPiRpcEvent, SessionCatalogInvalidation } from '../../shared/local-pi'
import type { ConversationScope } from '../../shared/conversation-scope'
import type { PiRuntimeControlHandle, PiRuntimeFrontend } from '../pi-host/pi-runtime-frontend'
import type { ObservedPiSessionDirectoryRepository } from '../repositories/observed-pi-session-directory-repository'
import { conversationScopeKey } from './conversation-scope-resolver'
import type { OfficialPiSessionCatalog } from './official-pi-session-catalog'

const MAX_OBSERVATIONS = 4

/** Catalog metadata follows every exact Runtime, independently of selection. */
export class OfficialPiSessionCatalogObserver {
  private readonly detach: () => void
  private readonly listeners = new Set<(event: SessionCatalogInvalidation) => void>()
  private readonly changes = new Map<string, ConversationScope>()
  private readonly observations = new Map<string, PiRuntimeControlHandle>()
  private readonly observing = new Set<string>()
  private pending: NodeJS.Immediate | undefined
  private disposed = false
  private revision = 0

  constructor(
    private readonly runtime: Pick<PiRuntimeFrontend, 'subscribeAllEvents' | 'getControlRuntimeState'>,
    private readonly catalog: Pick<OfficialPiSessionCatalog, 'invalidate'>,
    private readonly directories: Pick<ObservedPiSessionDirectoryRepository, 'observe'>,
  ) {
    this.detach = runtime.subscribeAllEvents((event, handle) => this.onEvent(event, handle))
  }

  subscribe(listener: (event: SessionCatalogInvalidation) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  dispose() {
    this.disposed = true
    this.detach()
    if (this.pending) clearImmediate(this.pending)
    this.pending = undefined
    this.changes.clear()
    this.observations.clear()
    this.listeners.clear()
  }

  private onEvent(event: LocalPiRpcEvent, handle: PiRuntimeControlHandle) {
    if (this.disposed || !['agent_settled', 'entry_appended', 'session_info_changed'].includes(event.type)) return
    this.invalidate(handle.scope)
    if (event.type === 'agent_settled') this.observations.set(handle.runtimeId, handle)
    this.schedule()
  }

  private invalidate(scope: ConversationScope) {
    this.catalog.invalidate(scope)
    this.changes.set(conversationScopeKey(scope), scope)
  }

  private schedule() {
    if (this.disposed || this.pending) return
    // Neither filesystem work nor a state RPC retains the originating event credit.
    this.pending = setImmediate(() => {
      this.pending = undefined
      if (this.disposed) return
      for (const scope of this.changes.values()) {
        const event = { scope, revision: ++this.revision }
        for (const listener of this.listeners) {
          try { listener(event) } catch { /* isolate metadata consumers */ }
        }
      }
      this.changes.clear()
      for (const [runtimeId, handle] of this.observations) {
        if (this.observing.size >= MAX_OBSERVATIONS) break
        if (this.observing.has(runtimeId)) continue
        this.observations.delete(runtimeId)
        this.observing.add(runtimeId)
        void this.observe(handle).finally(() => {
          this.observing.delete(runtimeId)
          if (this.changes.size > 0 || this.observations.size > 0) this.schedule()
        })
      }
    })
  }

  private async observe(handle: PiRuntimeControlHandle) {
    try {
      const state = await this.runtime.getControlRuntimeState(handle)
      if (this.disposed) return
      await this.directories.observe(handle.scope, state.sessionFile)
      if (!this.disposed) this.invalidate(handle.scope)
    } catch {
      // Exact-handle validation can lose a race with retirement. Keep the prior observation.
    }
  }
}
