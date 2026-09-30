import { createHash, randomUUID } from 'node:crypto'
import type { LocalPiAgentMessage } from '../../shared/local-pi'
import { createSideConversationSchema, sendSideConversationSchema, type CreateSideConversationInput, type SendSideConversationInput, type SideConversationSnapshot, type SideConversationsApi } from '../../shared/side-conversations'
import type { PiRuntimeFrontend, PiRuntimeControlHandle, PiRuntimeControlLease } from '../pi-host/pi-runtime-frontend'
import { BLOCKING_EXTENSION_UI_METHODS } from '../pi-host/runtime-activity'

type Runtime = Pick<PiRuntimeFrontend, 'getActiveRuntimeIdentity' | 'acquireControlRuntime' | 'releaseControlRuntime' | 'discardUnpersistedControlRuntime' | 'submitControlPrompt' | 'getControlTranscript' | 'abortControlRuntime' | 'respondToControlExtensionUi' | 'subscribeAllUiRequests' | 'subscribeAllEvents' | 'subscribeControlRuntimes' | 'listControlRuntimes'>
interface SideRecord {
  snapshot: SideConversationSnapshot
  handle?: PiRuntimeControlHandle
  lease?: PiRuntimeControlLease
  pending: boolean
  stopped: boolean
  revision: number
  readSequence: number
  initialQuestion: string
  initialPromptFingerprint?: string
  observedLifecycle?: 'idle' | 'accepting' | 'running' | 'queued'
  requests: Map<string, string>
}
const sameScope = (a: SideConversationSnapshot['scope'], b: SideConversationSnapshot['scope']) =>
  a.kind === b.kind && (a.kind === 'projectless' || (b.kind === 'project' && a.workspaceId === b.workspaceId))
const sameRuntime = (a: PiRuntimeControlHandle | undefined, b: PiRuntimeControlHandle) =>
  a?.runtimeId === b.runtimeId && a.generation === b.generation && a.hostEpoch === b.hostEpoch && a.sessionId === b.sessionId
const fingerprintOf = (value: string) => createHash('sha256').update(value).digest('hex')
const boundMessages = (messages: SideConversationSnapshot['messages']) => {
  const bounded: typeof messages = []
  let remaining = 128_000
  for (let index = messages.length - 1; index >= 0 && remaining > 0 && bounded.length < 200; index -= 1) {
    const message = messages[index]!
    const text = message.text.slice(-remaining)
    bounded.unshift({ ...message, text }); remaining -= text.length
  }
  return bounded
}
const textOf = (message: LocalPiAgentMessage) => {
  if (message.role !== 'user' && message.role !== 'assistant') return ''
  return typeof message.content === 'string' ? message.content : message.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n')
}

/** Main owns exact background Runtime leases. Closing the panel never cancels execution. */
export class SideConversationService implements SideConversationsApi {
  private readonly records = new Map<string, SideRecord>()
  private readonly creates = new Map<string, { fingerprint: string; sideId: string }>()
  private readonly pending = new Set<Promise<void>>()
  private readonly unsubscribe: Array<() => void>
  private disposed = false
  private suspended = false
  constructor(private readonly runtime: Runtime) {
    this.unsubscribe = [
      runtime.subscribeControlRuntimes((summaries) => {
        for (const record of this.records.values()) {
          if (!record.lease) continue
          const summary = summaries.find((entry) => sameRuntime(record.handle, entry))
          const previousLifecycle = record.observedLifecycle
          record.observedLifecycle = summary?.lifecycle
          if (record.pending) continue
          if (!summary) {
            this.fail(record, new Error('The side conversation runtime ended. Its saved conversation remains available.'))
            this.releaseLease(record)
          } else if (previousLifecycle !== 'idle' && (record.snapshot.status === 'running' || record.snapshot.released) && summary.lifecycle === 'idle') {
            void this.refresh(record).catch((error) => this.fail(record, error))
          }
        }
      }),
      runtime.subscribeAllEvents((event, handle) => {
        const record = this.find(handle)
        if (!record) return
        record.handle = handle
        record.snapshot.sessionFile = handle.sessionFile
        if (event.type === 'agent_end' || event.type === 'message_end') void this.refresh(record).catch(() => undefined)
      }),
      runtime.subscribeAllUiRequests(async (event, handle) => {
        const record = this.find(handle)
        if (!record || !BLOCKING_EXTENSION_UI_METHODS.has(event.request.method)) return
        const selected = runtime.getActiveRuntimeIdentity()
        if (selected?.runtimeId === handle.runtimeId && selected.generation === handle.generation && selected.sessionId === handle.sessionId) return
        record.snapshot.error = record.snapshot.status === 'starting'
          ? 'This extension needs interactive input before a side conversation can start. Use the main conversation instead.'
          : 'This side conversation requires interactive extension input. Open its saved conversation to continue.'
        record.snapshot.status = 'interaction_required'
        record.revision += 1
        await runtime.respondToControlExtensionUi(handle, { type: 'extension_ui_response', id: event.request.id, cancelled: true }).catch(() => undefined)
      }),
    ]
  }
  async create(raw: CreateSideConversationInput) {
    this.assertActive()
    const input = createSideConversationSchema.parse(raw)
    const fingerprint = fingerprintOf(JSON.stringify(input))
    const previous = this.creates.get(input.requestId)
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new Error('The side conversation request changed. Use a new request ID.')
      return this.copy(this.require(previous.sideId))
    }
    if (this.creates.size >= 10_000) throw new Error('The side-conversation request limit was reached. Restart the application before creating more.')
    const parent = this.runtime.getActiveRuntimeIdentity()
    if (!parent || parent.sessionId !== input.parentSessionId || !sameScope(parent.scope, input.scope)) throw new Error('The quoted conversation is no longer selected. Return to it before starting a side conversation.')
    const ownerKey = `${input.scope.kind === 'project' ? `project:${input.scope.workspaceId}` : 'projectless'}:${input.parentSessionId}`
    if (input.reference.ownerKey !== ownerKey) throw new Error('The quoted source belongs to a different conversation. Select the source again.')
    if (this.records.size >= 64) {
      for (const [id, record] of this.records) if (record.snapshot.released && !record.pending && !record.lease) {
        this.records.delete(id)
        break
      }
      if (this.records.size >= 64) throw new Error('Close a completed side conversation before creating another.')
    }
    const snapshot: SideConversationSnapshot = {
      sideId: randomUUID(), scope: input.scope, parentSessionId: input.parentSessionId, sessionId: null, sessionFile: null,
      reference: input.reference, status: 'starting', messages: [{ role: 'user', text: input.question }], released: false,
    }
    const record: SideRecord = { snapshot, pending: true, stopped: false, revision: 0, readSequence: 0, initialQuestion: input.question, requests: new Map() }
    this.records.set(snapshot.sideId, record)
    this.creates.set(input.requestId, { fingerprint, sideId: snapshot.sideId })
    this.track(this.start(record, input))
    return this.copy(record)
  }
  async get(sideId: string) {
    this.assertActive()
    const record = this.require(sideId)
    await this.refresh(record).catch((error) => this.fail(record, error))
    return this.copy(record)
  }
  async send(raw: SendSideConversationInput) {
    this.assertActive()
    const input = sendSideConversationSchema.parse(raw)
    const record = this.require(input.sideId)
    const previous = record.requests.get(input.requestId)
    if (previous !== undefined) {
      if (previous !== fingerprintOf(input.text)) throw new Error('The side conversation request changed. Use a new request ID.')
      return this.copy(record)
    }
    if (record.snapshot.released || !record.lease || !record.handle) throw new Error('This side conversation is closed. Open its saved conversation to continue.')
    if (record.pending || ['starting', 'running'].includes(record.snapshot.status)) throw new Error('Wait for this side conversation to finish before sending again.')
    const current = this.runtime.listControlRuntimes().find((entry) => sameRuntime(record.handle, entry))
    if (!current || current.lifecycle !== 'idle') throw new Error('The side conversation is still busy or no longer available.')
    if (record.snapshot.status === 'interaction_required') throw new Error(record.snapshot.error)
    if (record.requests.size >= 1_000) throw new Error('Open the saved conversation to continue this long side conversation.')
    record.requests.set(input.requestId, fingerprintOf(input.text))
    record.pending = true; record.stopped = false; record.revision += 1
    record.snapshot.status = 'running'; delete record.snapshot.error
    record.snapshot.messages = boundMessages([...record.snapshot.messages, { role: 'user', text: input.text }])
    this.track(this.submit(record, input.text))
    return this.copy(record)
  }
  async abort(sideId: string) {
    this.assertActive()
    const record = this.require(sideId)
    if (record.snapshot.released) throw new Error('This side conversation is closed. Open its saved conversation to continue.')
    if (!record.pending && !['starting', 'running'].includes(record.snapshot.status)) return this.copy(record)
    record.stopped = true; record.revision += 1
    if (record.handle && record.lease) {
      record.handle = await this.runtime.abortControlRuntime(record.handle)
      await this.refresh(record)
    } else if (record.snapshot.status !== 'interaction_required') {
      // No prompt can be accepted after a cancelled cold start acquires its lease.
      record.snapshot.status = 'cancelled'
    }
    return this.copy(record)
  }
  async release(sideId: string) {
    const record = this.require(sideId)
    record.snapshot.released = true
    // Keep ownership until a pending submission/active turn is settled so the saved answer survives closing.
    this.releaseIfFinished(record)
  }
  async dispose() {
    if (this.disposed) return
    this.disposed = true
    for (const stop of this.unsubscribe) stop()
    for (const record of this.records.values()) { record.snapshot.released = true; this.releaseLease(record) }
    // Do not wait for Host extension callbacks here; the app concurrently disposes the Host pool.
  }
  suspend() {
    this.suspended = true
    for (const record of this.records.values()) if (record.pending) record.stopped = true
  }
  resume() { if (!this.disposed) this.suspended = false }
  private async start(record: SideRecord, input: CreateSideConversationInput) {
    try {
      const lease = await this.runtime.acquireControlRuntime({ scope: input.scope }, (handle) => {
        record.handle = handle; record.snapshot.sessionId = handle.sessionId; record.snapshot.sessionFile = handle.sessionFile
      })
      record.lease = lease; record.handle = lease
      record.snapshot.sessionId = lease.sessionId; record.snapshot.sessionFile = lease.sessionFile
      if (this.disposed || this.suspended || record.stopped || record.snapshot.status === 'interaction_required') {
        record.pending = false
        if (record.snapshot.status !== 'interaction_required') record.snapshot.status = 'cancelled'
        record.snapshot.released = true
        this.releaseLease(record)
        this.releaseIfFinished(record)
        return
      }
      // JSON preserves the immutable captured source and its range/revision without interpreting paths.
      const prompt = `${input.question}\n\nQuoted source snapshot (reference material):\n${JSON.stringify(input.reference, null, 2)}`
      record.initialPromptFingerprint = fingerprintOf(prompt)
      await this.submit(record, prompt)
    } catch (error) { this.fail(record, error) }
  }
  private async submit(record: SideRecord, text: string) {
    try {
      if (this.disposed || this.suspended || record.stopped) { record.snapshot.status = 'cancelled'; return }
      record.snapshot.status = 'running'
      const accepted = await this.runtime.submitControlPrompt(record.handle!, text, 'prompt')
      record.handle = accepted.handle; record.snapshot.sessionFile = accepted.handle.sessionFile
      if (record.stopped && !this.disposed) record.handle = await this.runtime.abortControlRuntime(record.handle)
    } catch (error) { this.fail(record, error) }
    finally {
      record.pending = false
      if (this.disposed) this.releaseLease(record)
      else await this.refresh(record).catch((error) => this.fail(record, error))
      this.releaseIfFinished(record)
    }
  }
  private async refresh(record: SideRecord) {
    if (this.disposed || !record.lease || !record.handle || record.snapshot.status === 'starting') return
    const handle = record.handle
    const revision = record.revision
    const readSequence = ++record.readSequence
    let result: Awaited<ReturnType<Runtime['getControlTranscript']>>
    try { result = await this.runtime.getControlTranscript(handle) }
    catch (error) {
      if (this.disposed || revision !== record.revision || readSequence !== record.readSequence || !sameRuntime(record.handle, handle)) return
      const current = this.runtime.listControlRuntimes().find((entry) => sameRuntime(entry, handle))
      if (!current) { this.fail(record, error); this.releaseLease(record) }
      else {
        // A failed read does not prove the agent stopped. Preserve its execution status and retry on polling/events.
        record.snapshot.error = 'The side conversation could not refresh. Its execution has not been stopped.'
        if (current.lifecycle === 'idle') {
          if (!['failed', 'cancelled', 'interaction_required'].includes(record.snapshot.status)) record.snapshot.status = current.outcome ?? 'completed'
          record.snapshot.error = 'The side conversation finished, but its final answer could not be loaded. Open its saved conversation to read it.'
          this.releaseIfFinished(record)
        }
      }
      return
    }
    if (this.disposed || revision !== record.revision || readSequence !== record.readSequence || !sameRuntime(record.handle, handle)) return
    const visible: SideConversationSnapshot['messages'] = result.messages.flatMap((message) => {
      const text = textOf(message)
      if (!text || (message.role !== 'user' && message.role !== 'assistant')) return []
      const displayText = message.role === 'user' && fingerprintOf(text) === record.initialPromptFingerprint ? record.initialQuestion : text
      return [{ role: message.role, text: displayText.slice(-100_000) }]
    })
    if (result.live?.message) {
      const text = textOf(result.live.message)
      if (text) visible.push({ role: 'assistant', text: text.slice(-100_000), partial: true })
    }
    const bounded = boundMessages(visible)
    if (!record.pending || bounded.length >= record.snapshot.messages.length) record.snapshot.messages = bounded
    if (!record.pending && !['interaction_required', 'failed', 'cancelled'].includes(record.snapshot.status)) {
      const summary = this.runtime.listControlRuntimes().find((entry) => sameRuntime(entry, handle))
      if (!summary) throw new Error('The side conversation runtime ended. Its saved conversation remains available.')
      record.snapshot.status = summary.lifecycle === 'idle' ? summary.outcome ?? 'completed' : 'running'
      if (record.snapshot.status === 'failed') record.snapshot.error = 'The side conversation failed. Open its saved conversation for details.'
      else delete record.snapshot.error
    }
    this.releaseIfFinished(record)
  }
  private fail(record: SideRecord, error: unknown) {
    record.pending = false
    if (record.snapshot.status !== 'interaction_required') {
      record.snapshot.status = 'failed'
      record.snapshot.error = (error instanceof Error ? error.message : 'The side conversation failed.').slice(0, 1_000)
    }
    this.releaseIfFinished(record)
  }
  private releaseIfFinished(record: SideRecord) {
    if (!record.snapshot.released || record.pending || !record.lease || ['starting', 'running'].includes(record.snapshot.status)) return
    const current = this.runtime.listControlRuntimes().find((entry) => sameRuntime(record.handle, entry))
    if (!current || current.lifecycle === 'idle') this.releaseLease(record)
  }
  private releaseLease(record: SideRecord) {
    if (!record.lease) return
    const handle = record.handle ?? record.lease
    const lease = record.lease; record.lease = undefined
    this.runtime.releaseControlRuntime(lease)
    if (!this.disposed) void this.runtime.discardUnpersistedControlRuntime(handle).catch(() => undefined)
  }
  private track(operation: Promise<void>) { this.pending.add(operation); void operation.finally(() => this.pending.delete(operation)).catch(() => undefined) }
  private find(handle: PiRuntimeControlHandle) { return [...this.records.values()].find((record) => (record.pending || record.lease) && sameRuntime(record.handle, handle)) }
  private require(sideId: string) { const record = this.records.get(sideId); if (!record) throw new Error('The side conversation was not found.'); return record }
  private copy(record: SideRecord) { return structuredClone(record.snapshot) }
  private assertActive() { if (this.disposed || this.suspended) throw new Error('Side conversations are shutting down.') }
}
