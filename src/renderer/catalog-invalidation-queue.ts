import type { ConversationScope } from '../shared/conversation-scope'
import type { SessionCatalogInvalidation } from '../shared/local-pi'

function scopeKey(scope: ConversationScope) {
  return scope.kind === 'project' ? `project:${scope.workspaceId}` : 'projectless'
}

interface CatalogInvalidationQueueOptions {
  eligible(scope: ConversationScope): boolean
  invalidate(scope: ConversationScope): void
  inFlight(scope: ConversationScope): Promise<unknown> | undefined
  reload(scope: ConversationScope): Promise<unknown>
  onError(error: unknown): void
}

/** Coalesce hints around complete paginated loads, retaining one trailing read. */
export class CatalogInvalidationQueue {
  private readonly revisions = new Map<string, number>()
  private readonly pending = new Map<string, ConversationScope>()
  private readonly running = new Set<string>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private disposed = false

  constructor(private readonly options: CatalogInvalidationQueueOptions) {}

  notify(event: SessionCatalogInvalidation) {
    if (this.disposed || !this.options.eligible(event.scope)) return
    const key = scopeKey(event.scope)
    if (event.revision <= (this.revisions.get(key) ?? -1)) return
    this.revisions.delete(key)
    this.revisions.set(key, event.revision)
    if (this.revisions.size > 256) this.revisions.delete(this.revisions.keys().next().value!)
    this.options.invalidate(event.scope)
    this.pending.set(key, event.scope)
    this.schedule()
  }

  dispose() {
    this.disposed = true
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    this.pending.clear()
    this.revisions.clear()
  }

  private schedule() {
    if (this.disposed || this.timer !== undefined) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      for (const [key, scope] of this.pending) {
        if (this.running.size >= 4) break
        if (this.running.has(key)) continue
        this.running.add(key)
        void this.refresh(key, scope).finally(() => {
          this.running.delete(key)
          if (this.pending.size > 0) this.schedule()
        })
      }
    }, 0)
  }

  private async refresh(key: string, scope: ConversationScope) {
    try {
      await this.options.inFlight(scope)?.catch(() => undefined)
      this.pending.delete(key)
      if (this.disposed || !this.options.eligible(scope)) return
      await this.options.reload(scope)
    } catch (error) {
      if (!this.disposed) {
        try { this.options.onError(error) } catch { /* isolate error presentation */ }
      }
    }
  }
}
