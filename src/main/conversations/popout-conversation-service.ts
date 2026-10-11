import { randomUUID } from 'node:crypto'
import type { LocalPiAgentMessage } from '../../shared/local-pi'
import type { ConversationScope } from '../../shared/conversation-scope'
import { popoutTargetSchema, type PopoutSnapshot, type PopoutTarget } from '../../shared/popout'
import type { PiRuntimeControlHandle, PiRuntimeControlLease, PiRuntimeFrontend } from '../pi-host/pi-runtime-frontend'

type Runtime = Pick<PiRuntimeFrontend, 'getActiveRuntimeIdentity' | 'getSnapshot' | 'acquireControlRuntime' | 'releaseControlRuntime' |
  'submitControlPrompt' | 'getControlTranscript' | 'abortControlRuntime' | 'subscribeAllEvents' | 'subscribeControlRuntimes' | 'listControlRuntimes'>

interface Catalog {
  resolveReadTarget(scope: ConversationScope, selectionToken: string): Promise<{ sessionFile: string; sessionId: string; name?: string | null }>
}

export class PopoutConversationError extends Error {
  readonly code = 'POPOUT_FAILED'
}

interface PopoutRecord {
  snapshot: PopoutSnapshot
  scope: ConversationScope
  sessionFile: string
  sessionId: string
  handle?: PiRuntimeControlHandle
  lease?: PiRuntimeControlLease
  requests: Set<string>
  refreshTimer?: ReturnType<typeof setTimeout>
  reading: boolean
  rereadRequested: boolean
}

const MAX_MESSAGES = 200
const MAX_TEXT = 128_000

function messagesOf(messages: readonly LocalPiAgentMessage[], live?: LocalPiAgentMessage | null): PopoutSnapshot['messages'] {
  const result: PopoutSnapshot['messages'] = []
  const push = (message: LocalPiAgentMessage, partial: boolean) => {
    if (message.role === 'user') {
      const text = typeof message.content === 'string' ? message.content
        : message.content.flatMap((part) => part.type === 'text' ? [part.text] : []).join('\n')
      if (text.trim()) result.push({ role: 'user', text: text.slice(-MAX_TEXT) })
    } else if (message.role === 'assistant') {
      const text = message.content.flatMap((part) => part.type === 'text' ? [part.text] : []).join('\n')
      const tools = message.content.filter((part) => part.type === 'toolCall').length
      // Consecutive tool-using steps of one reply read as one bubble.
      const previous = result[result.length - 1]
      if (previous?.role === 'assistant' && !previous.text.trim()) {
        previous.text = text.slice(-MAX_TEXT)
        previous.tools = (previous.tools ?? 0) + tools
        if (partial) previous.partial = true
        return
      }
      if (!text.trim() && !tools) return
      result.push({ role: 'assistant', text: text.slice(-MAX_TEXT), ...(tools ? { tools } : {}), ...(partial ? { partial: true } : {}) })
    }
  }
  for (const message of messages) push(message, false)
  if (live) push(live, true)
  return result.slice(-MAX_MESSAGES)
}

/**
 * A conversation in its own small window. Main holds a lease on its exact
 * Runtime (the same one the main window uses when that conversation is open
 * there), so a reply keeps running whichever window shows it.
 */
export class PopoutConversationService {
  private readonly records = new Map<string, PopoutRecord>()
  private readonly listeners = new Set<(snapshot: PopoutSnapshot) => void>()
  private readonly detach: Array<() => void>
  private disposed = false

  constructor(private readonly options: {
    runtime: Runtime
    catalog: Catalog
    scopeLabel(scope: ConversationScope): string
    untitled(): string
  }) {
    const { runtime } = options
    this.detach = [
      runtime.subscribeAllEvents((event, handle) => {
        const record = this.find(handle)
        if (!record) return
        record.handle = handle
        // Streaming text arrives in bursts; read at most a few times a second.
        this.scheduleRefresh(record, event.type === 'message_update' ? 150 : 0)
      }),
      runtime.subscribeControlRuntimes((summaries) => {
        for (const record of this.records.values()) {
          if (!record.lease) continue
          const summary = summaries.find((entry) => entry.runtimeId === record.handle?.runtimeId && entry.sessionId === record.sessionId)
          if (!summary) continue
          record.handle = summary
          const status = summary.lifecycle === 'idle' ? (summary.outcome === 'failed' ? 'failed' : 'idle') : 'running'
          const needsMainWindow = summary.activity === 'interaction'
          if (status !== record.snapshot.status || needsMainWindow !== record.snapshot.needsMainWindow || summary.queueCount !== record.snapshot.queued) {
            record.snapshot = { ...record.snapshot, status, needsMainWindow, queued: summary.queueCount }
            this.emit(record)
            if (status !== 'running') this.scheduleRefresh(record, 0)
          }
        }
      }),
    ]
  }

  subscribe(listener: (snapshot: PopoutSnapshot) => void) {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Opens (or finds) the pop-out of one conversation. */
  async open(raw: PopoutTarget): Promise<{ popoutId: string; created: boolean }> {
    this.assertActive()
    const target = popoutTargetSchema.parse(raw)
    let sessionFile: string
    let sessionId: string
    let title: string | undefined
    if (target.kind === 'active') {
      const identity = this.options.runtime.getActiveRuntimeIdentity()
      if (!identity || identity.sessionId !== target.sessionId || JSON.stringify(identity.scope) !== JSON.stringify(target.scope)) {
        throw new PopoutConversationError('The conversation changed. Open it again, then pop it out.')
      }
      if (!identity.sessionFile) throw new PopoutConversationError('Send a first message before opening this conversation in its own window.')
      sessionFile = identity.sessionFile
      sessionId = identity.sessionId
      title = this.options.runtime.getSnapshot().sessionState?.sessionName ?? undefined
    } else {
      const resolved = await this.options.catalog.resolveReadTarget(target.scope, target.selectionToken).catch(() => {
        throw new PopoutConversationError('The conversation changed. Refresh the list and try again.')
      })
      sessionFile = resolved.sessionFile
      sessionId = resolved.sessionId
      title = resolved.name ?? undefined
    }
    const existing = [...this.records.values()].find((record) => record.sessionFile === sessionFile)
    if (existing) return { popoutId: existing.snapshot.popoutId, created: false }
    if (this.records.size >= 12) throw new PopoutConversationError('Close a conversation window before opening another.')
    const record: PopoutRecord = {
      scope: target.scope, sessionFile, sessionId, requests: new Set(), reading: false, rereadRequested: false,
      snapshot: {
        popoutId: randomUUID(), title: (title || this.options.untitled()).slice(0, 512), scopeLabel: this.options.scopeLabel(target.scope).slice(0, 512),
        status: 'starting', pinned: false, messages: [], queued: 0, needsMainWindow: false,
      },
    }
    this.records.set(record.snapshot.popoutId, record)
    void this.attach(record)
    return { popoutId: record.snapshot.popoutId, created: true }
  }

  get(popoutId: string) {
    const record = this.require(popoutId)
    this.scheduleRefresh(record, 0)
    return structuredClone(record.snapshot)
  }

  async send(popoutId: string, text: string, requestId: string) {
    this.assertActive()
    const record = this.require(popoutId)
    if (record.requests.has(requestId)) return structuredClone(record.snapshot)
    if (!record.handle || !record.lease) throw new PopoutConversationError('This conversation is still opening.')
    record.requests.add(requestId)
    try {
      const accepted = await this.options.runtime.submitControlPrompt(record.handle, text, 'auto')
      record.handle = accepted.handle
      record.snapshot = { ...record.snapshot, status: 'running', messages: [...record.snapshot.messages, { role: 'user' as const, text }].slice(-MAX_MESSAGES) }
      delete record.snapshot.error
      this.emit(record)
    } catch (error) {
      record.requests.delete(requestId)
      throw new PopoutConversationError(error instanceof Error ? error.message.slice(0, 1_000) : 'The message could not be sent.')
    }
    return structuredClone(record.snapshot)
  }

  async abort(popoutId: string) {
    const record = this.require(popoutId)
    if (record.handle && record.lease) {
      record.handle = await this.options.runtime.abortControlRuntime(record.handle)
      this.scheduleRefresh(record, 0)
    }
    return structuredClone(record.snapshot)
  }

  setPinned(popoutId: string, pinned: boolean) {
    const record = this.require(popoutId)
    record.snapshot = { ...record.snapshot, pinned }
    this.emit(record)
    return structuredClone(record.snapshot)
  }

  /** The window closed: let the Runtime go (a running reply keeps running). */
  close(popoutId: string) {
    const record = this.records.get(popoutId)
    if (!record) return
    this.records.delete(popoutId)
    if (record.refreshTimer) clearTimeout(record.refreshTimer)
    if (record.lease) this.options.runtime.releaseControlRuntime(record.lease)
    record.lease = undefined
  }

  sessionFileOf(popoutId: string) { return this.records.get(popoutId)?.sessionFile }

  dispose() {
    this.disposed = true
    for (const stop of this.detach) stop()
    for (const id of [...this.records.keys()]) this.close(id)
    this.listeners.clear()
  }

  private async attach(record: PopoutRecord) {
    try {
      const lease = await this.options.runtime.acquireControlRuntime({ scope: record.scope, sessionFile: record.sessionFile })
      if (!this.records.has(record.snapshot.popoutId) || this.disposed) { this.options.runtime.releaseControlRuntime(lease); return }
      record.lease = lease
      record.handle = lease
      record.snapshot = { ...record.snapshot, status: 'idle' }
      await this.refresh(record)
    } catch (error) {
      record.snapshot = { ...record.snapshot, status: 'failed', error: (error instanceof Error ? error.message : 'The conversation could not be opened.').slice(0, 1_000) }
      this.emit(record)
    }
  }

  private scheduleRefresh(record: PopoutRecord, delay: number) {
    if (record.refreshTimer) return
    record.refreshTimer = setTimeout(() => {
      record.refreshTimer = undefined
      void this.refresh(record)
    }, delay)
    record.refreshTimer.unref?.()
  }

  private async refresh(record: PopoutRecord) {
    if (!record.handle || !record.lease || !this.records.has(record.snapshot.popoutId)) return
    if (record.reading) { record.rereadRequested = true; return }
    record.reading = true
    try {
      const transcript = await this.options.runtime.getControlTranscript(record.handle)
      const summary = this.options.runtime.listControlRuntimes().find((entry) => entry.runtimeId === record.handle?.runtimeId)
      record.snapshot = {
        ...record.snapshot,
        messages: messagesOf(transcript.messages, transcript.live?.message ?? null),
        ...(summary ? {
          status: summary.lifecycle === 'idle' ? (summary.outcome === 'failed' ? 'failed' as const : 'idle' as const) : 'running' as const,
          queued: summary.queueCount, needsMainWindow: summary.activity === 'interaction',
        } : {}),
      }
      if (record.snapshot.status !== 'failed') delete record.snapshot.error
      this.emit(record)
    } catch {
      // A busy or replaced Runtime answers on the next event.
    } finally {
      record.reading = false
      if (record.rereadRequested) { record.rereadRequested = false; this.scheduleRefresh(record, 100) }
    }
  }

  private find(handle: PiRuntimeControlHandle) {
    return [...this.records.values()].find((record) => record.lease && record.handle?.runtimeId === handle.runtimeId && handle.sessionId === record.sessionId)
  }

  private require(popoutId: string) {
    const record = this.records.get(popoutId)
    if (!record) throw new PopoutConversationError('This conversation window is closed.')
    return record
  }

  private emit(record: PopoutRecord) {
    const snapshot = structuredClone(record.snapshot)
    for (const listener of this.listeners) {
      try { listener(snapshot) } catch { /* isolate observers */ }
    }
  }

  private assertActive() {
    if (this.disposed) throw new PopoutConversationError('Conversation windows are shutting down.')
  }
}
