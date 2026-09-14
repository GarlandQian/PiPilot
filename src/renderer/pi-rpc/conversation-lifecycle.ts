export interface PiHydrationSnapshot {
  scopeKey: string
  generation: number
  sessionId: string | null
  status: 'loading' | 'ready' | 'error'
  error: string | null
}

export interface PiConversationIdentity {
  scopeKey: string
  generation: number
  sessionId: string | null
}

type RefreshChannel = 'full' | 'conversation'
export interface PiRefreshTicket {
  readonly visit: number
  readonly request: number
  readonly channel: RefreshChannel
  readonly identity: PiConversationIdentity
}

/** Owns one visit, including A → B → A: matching path/generation is insufficient. */
export class PiConversationLifecycle {
  private visit = 0
  private requests = { full: 0, conversation: 0 }
  private snapshot: PiHydrationSnapshot

  // Read-only ref-shaped access keeps async command ownership independent of React.
  readonly ownerRevision: { readonly current: number }
  constructor(initial: PiHydrationSnapshot) {
    this.snapshot = initial
    const owner = this
    this.ownerRevision = { get current() { return owner.visit } }
  }

  get revision() { return this.visit }
  get hydration() { return this.snapshot }

  reset(next: PiHydrationSnapshot): PiHydrationSnapshot {
    this.visit += 1
    this.invalidate()
    return this.commit(next)
  }

  commit(next: PiHydrationSnapshot): PiHydrationSnapshot {
    this.snapshot = next
    return next
  }

  invalidate(channel?: RefreshChannel): void {
    if (channel) this.requests[channel] += 1
    else { this.requests.full += 1; this.requests.conversation += 1 }
  }

  begin(channel: RefreshChannel, identity: PiConversationIdentity): PiRefreshTicket {
    return { visit: this.visit, request: ++this.requests[channel], channel, identity: { ...identity } }
  }

  isCurrent(ticket: PiRefreshTicket, observed: PiConversationIdentity | null): boolean {
    return ticket.visit === this.visit && ticket.request === this.requests[ticket.channel] &&
      observed !== null && ticket.identity.scopeKey === observed.scopeKey &&
      ticket.identity.generation === observed.generation &&
      (ticket.identity.sessionId === null || ticket.identity.sessionId === observed.sessionId)
  }

  finish(ticket: PiRefreshTicket, observed: PiConversationIdentity, error: string | null = null): PiHydrationSnapshot | null {
    if (!this.isCurrent(ticket, observed)) return null
    return this.commit({ ...observed, status: error === null ? 'ready' : 'error', error })
  }
}
