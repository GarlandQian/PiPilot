import { createHash, randomUUID } from 'node:crypto'
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentSessionEvent, AgentSessionRuntime } from '@earendil-works/pi-coding-agent'
import {
  localPiDeliverySnapshotSchema,
  type LocalPiDeliveryItem,
  type LocalPiDeliveryReceipt,
  type LocalPiDeliverySnapshot,
  type LocalPiImageContent,
  type LocalPiRpcCommand,
} from '../../shared/local-pi'

type Submit = Extract<LocalPiRpcCommand, { type: 'submit_message' }>
type Mutation = Extract<LocalPiRpcCommand, { type: 'mutate_delivery' }>
type StoredItem = LocalPiDeliveryItem
interface StoredReceipt { receipt: LocalPiDeliveryReceipt; fingerprint: string }
interface Ledger {
  version: 1
  sessionId: string
  revision: number
  paused: boolean
  items: StoredItem[]
  records: StoredReceipt[]
}

class DeliveryInterrupted extends Error {}

function errorText(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2_048)
}

function fingerprint(command: Submit) {
  return createHash('sha256').update(JSON.stringify({
    message: command.message,
    images: command.images ?? [],
    mode: command.mode,
  })).digest('hex')
}

/**
 * Pi owns execution. Follow-ups stay in this durable queue until Pi settles;
 * editing never clears/replays SDK queues that may already have been drained.
 * A hand-off is persisted before calling Pi and is never blindly replayed.
 */
export class RuntimeDelivery {
  private ledger: Ledger | null = null
  private path: string | null = null
  private readonly inFlight = new Map<string, Promise<LocalPiDeliveryReceipt>>()
  private readonly reserved = new Set<string>()
  private pauseEpoch = 0
  private stopRequested = false
  private stopInFlight: Promise<void> | null = null
  private pumping = false
  private readonly nativeIdentities = new WeakMap<object, string>()
  private emptySteeringConsumed = 0
  private storageFailure: Error | null = null

  constructor(
    private readonly runtime: AgentSessionRuntime,
    private readonly directory: string,
    private readonly cwd: string,
    private readonly publish: (snapshot: LocalPiDeliverySnapshot) => void,
    private readonly requestPump: () => void = () => undefined,
  ) {}

  private load(): Ledger {
    const sessionId = this.runtime.session.sessionId
    if (this.ledger?.sessionId === sessionId) return this.ledger
    const key = createHash('sha256').update(JSON.stringify([this.cwd, sessionId])).digest('hex')
    this.path = join(this.directory, `${key}.json`)
    let ledger: Ledger
    try {
      ledger = JSON.parse(readFileSync(this.path, 'utf8')) as Ledger
      if (ledger.version !== 1 || ledger.sessionId !== sessionId || !Array.isArray(ledger.records)) {
        throw new Error('Unsupported PiPilot delivery journal.')
      }
      localPiDeliverySnapshotSchema.parse({
        revision: ledger.revision,
        paused: ledger.paused,
        items: ledger.items,
        receipts: ledger.records.map((record) => record.receipt),
      })
      if (ledger.records.some((record) => typeof record.fingerprint !== 'string')) {
        throw new Error('Invalid PiPilot delivery journal fingerprint.')
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      ledger = { version: 1, sessionId, revision: 0, paused: false, items: [], records: [] }
    }
    this.ledger = ledger
    this.emptySteeringConsumed = 0
    let changed = false
    for (const item of ledger.items) {
      if (item.status === 'queued') {
        item.status = 'frozen'
        changed = true
      } else if (item.status === 'delivering') {
        item.status = 'unknown'
        const record = ledger.records.find(({ receipt }) => receipt.submissionId === item.submissionId)
        if (record) record.receipt = { ...record.receipt, status: 'unknown', error: 'The previous runtime stopped before delivery could be confirmed.' }
        changed = true
      }
    }
    for (const record of ledger.records) {
      if (record.receipt.status !== 'accepting') continue
      record.receipt = { ...record.receipt, status: 'unknown', error: 'The previous runtime stopped before acceptance could be confirmed.' }
      changed = true
    }
    if (changed) {
      ledger.paused = true
      this.commit()
    }
    return ledger
  }

  snapshot(submissionId?: string): LocalPiDeliverySnapshot {
    this.assertStorage()
    const ledger = this.load()
    // Retain all deduplication records on disk. Limit only the presentation of
    // old terminal receipts; unresolved deliveries are never dropped.
    const isTerminal = ({ receipt }: StoredReceipt) => ['consumed', 'removed', 'rejected'].includes(receipt.status) || (receipt.status === 'accepted' && !receipt.itemId)
    const terminal = ledger.records.filter(isTerminal)
    const visible = new Set(terminal.slice(-200))
    return structuredClone({
      revision: ledger.revision,
      paused: ledger.paused,
      items: ledger.items,
      receipts: ledger.records.filter((record) => record.receipt.submissionId === submissionId || visible.has(record) || !isTerminal(record))
        .map(({ receipt }) => receipt),
    })
  }

  private commit() {
    this.assertStorage()
    const ledger = this.ledger!
    ledger.revision += 1
    try {
      mkdirSync(this.directory, { recursive: true, mode: 0o700 })
      const temporary = `${this.path}.${randomUUID()}.tmp`
      const fd = openSync(temporary, 'wx', 0o600)
      try {
        writeFileSync(fd, JSON.stringify(ledger), 'utf8')
        fsyncSync(fd)
      } finally {
        closeSync(fd)
      }
      renameSync(temporary, this.path!)
      // Windows cannot open directories through fs.open; rename still provides
      // atomic replacement there. Unix additionally durably commits the rename.
      if (process.platform !== 'win32') {
        const directoryFd = openSync(this.directory, 'r')
        try { fsyncSync(directoryFd) } finally { closeSync(directoryFd) }
      }
    } catch (error) {
      // A failed rename/fsync may have committed either version. Do not infer
      // rollback, publish unsaved edits as confirmed, or let a later pump hand
      // them to Pi. Recovery reloads the journal and requires explicit resume.
      ledger.paused = true
      this.storageFailure = new Error(`Message storage failed. Reconnect before sending or resuming: ${errorText(error)}`)
      throw this.storageFailure
    }
    this.publish(this.snapshot())
  }

  private assertStorage() {
    if (this.storageFailure) throw this.storageFailure
  }

  reserve(command: Submit) {
    this.assertStorage()
    const ledger = this.load()
    const digest = fingerprint(command)
    const existing = ledger.records.find(({ receipt }) => receipt.submissionId === command.submissionId)
    if (existing) {
      if (existing.fingerprint !== digest) throw new Error('This submission ID already belongs to a different message.')
      return existing
    }
    if (!command.message.trim() && !command.images?.length) throw new Error('A message or image is required.')
    const record: StoredReceipt = { fingerprint: digest, receipt: { submissionId: command.submissionId, status: 'accepting' } }
    ledger.records.push(record)
    try { this.commit() } catch (error) {
      ledger.records = ledger.records.filter((candidate) => candidate !== record)
      throw error
    }
    this.reserved.add(command.submissionId)
    return record
  }

  async submit(command: Submit) {
    const record = this.reserve(command)
    if (!this.reserved.delete(command.submissionId)) {
      const pending = this.inFlight.get(command.submissionId)
      const receipt = pending ? await pending : record.receipt
      return { receipt: structuredClone(receipt), delivery: this.snapshot(command.submissionId) }
    }
    const operation = this.accept(command, record)
    this.inFlight.set(command.submissionId, operation)
    try {
      const receipt = await operation
      return { receipt: structuredClone(receipt), delivery: this.snapshot() }
    } finally {
      this.inFlight.delete(command.submissionId)
    }
  }

  private async accept(command: Submit, record: StoredReceipt): Promise<LocalPiDeliveryReceipt> {
    this.assertStorage()
    const ledger = this.load()
    const mode = command.mode === 'command' ? 'command'
      : ledger.paused || this.runtime.session.isStreaming || ledger.items.some((item) => item.status === 'queued')
        ? command.mode === 'steer' ? 'steer' : 'follow_up' : 'prompt'
    record.receipt.acceptedMode = mode
    if (mode === 'prompt' || mode === 'command') {
      try {
        await this.acceptPrompt(command.message, command.images, mode === 'command')
        record.receipt = { ...record.receipt, status: 'accepted' }
      } catch (error) {
        record.receipt = { ...record.receipt, status: error instanceof DeliveryInterrupted ? 'unknown' : 'rejected', error: errorText(error) }
      }
      this.commit()
      return record.receipt
    }
    const item: StoredItem = {
      id: randomUUID(), submissionId: command.submissionId,
      message: command.message,
      ...(command.images?.length ? { images: structuredClone(command.images) } : {}),
      mode, status: ledger.paused ? 'frozen' : 'queued',
    }
    ledger.items.push(item)
    record.receipt.itemId = item.id
    record.receipt.status = 'accepted'
    this.commit()
    if (item.status === 'queued' && item.mode === 'steer' && this.runtime.session.isStreaming) await this.handoffSteer(item)
    else if (!ledger.paused) this.requestPump()
    return record.receipt
  }

  private acceptPrompt(message: string, images?: readonly LocalPiImageContent[], command = false) {
    this.assertStorage()
    const epoch = this.pauseEpoch
    return new Promise<void>((resolve, reject) => {
      let settled = false
      const finish = (accepted: boolean, error?: unknown) => {
        if (settled) return
        settled = true
        if (accepted) resolve()
        else reject(error ?? new Error('Pi rejected the message before acceptance.'))
      }
      void this.runtime.session.prompt(message, {
        images: images ? [...images] : undefined,
        source: 'rpc',
        preflightResult: (accepted) => {
          if (!accepted) return
          // Pi invokes this immediately before starting the agent. Throwing
          // here prevents a delayed auth/input preflight from starting a new
          // run after Stop already returned. Intercepting extensions may have
          // acted, so the receipt is unknown rather than safely retryable.
          if (!command && (epoch !== this.pauseEpoch || this.stopRequested || this.load().paused)) {
            throw new DeliveryInterrupted('Stopped during acceptance. Check the conversation before sending this message again.')
          }
          finish(true)
        },
      }).then(
        () => { if (!settled) finish(false, new Error('Pi completed submission without confirming acceptance.')) },
        (error: unknown) => finish(false, error),
      )
    })
  }

  private async handoffSteer(item: StoredItem) {
    this.assertStorage()
    if (this.stopInFlight) throw new Error('Pi is still stopping. Wait before resuming.')
    const ledger = this.load()
    item.status = 'delivering'
    this.commit()
    const session = this.runtime.session
    // Observe the exact message object passed through the public Agent API.
    // Pi keeps this object through its queue and message_start event, so equal
    // text/image payloads cannot accidentally acknowledge another submission.
    // Session.steer still owns skill/template expansion and normal Pi behavior.
    const agent = session.agent
    const steer = agent.steer
    const captured: object[] = []
    agent.steer = (message) => {
      captured.push(message)
      steer.call(agent, message)
    }
    let pending: Promise<void>
    try { pending = session.steer(item.message, item.images) }
    finally { agent.steer = steer }
    const nativeMessage = captured[captured.length - 1]
    if (nativeMessage) this.nativeIdentities.set(nativeMessage, item.id)
    try {
      await pending
      if (!nativeMessage && ledger.items.includes(item)) throw new Error('Pi did not confirm the steering message hand-off.')
    } catch (error) {
      if (ledger.items.includes(item)) {
        item.status = nativeMessage ? 'unknown' : 'frozen'
        ledger.paused = true
        for (const pending of ledger.items) if (pending.status === 'queued') pending.status = 'frozen'
        const record = ledger.records.find(({ receipt }) => receipt.submissionId === item.submissionId)
        if (record) record.receipt = { ...record.receipt, status: nativeMessage ? 'unknown' : 'accepted', error: errorText(error) }
        this.commit()
        throw error
      }
    }
  }

  observe(event: AgentSessionEvent) {
    if (event.type === 'queue_update' && this.stopRequested &&
      (event.steering.length > 0 || event.followUp.length > 0)) {
      const epoch = this.pauseEpoch
      queueMicrotask(() => {
        if (this.stopRequested && epoch === this.pauseEpoch) this.runtime.session.clearQueue()
      })
    }
    const ledger = this.load()
    if (event.type === 'queue_update' && !this.stopRequested && ledger.paused &&
      (event.steering.length > 0 || event.followUp.length > 0)) {
      // Session emits queue_update immediately before its core enqueue. Run
      // after that synchronous insertion, ahead of any continuation awaiting
      // extension event completion.
      const epoch = this.pauseEpoch
      queueMicrotask(() => {
        if (this.load().paused && epoch === this.pauseEpoch) this.runtime.session.clearQueue()
      })
    }
    if (event.type === 'message_start' && event.message.role === 'user') {
      const itemId = this.nativeIdentities.get(event.message)
      const item = ledger.items.find((candidate) => candidate.id === itemId)
      if (!item) return
      ledger.items = ledger.items.filter((candidate) => candidate !== item)
      const record = ledger.records.find(({ receipt }) => receipt.submissionId === item.submissionId)
      if (record) record.receipt = { ...record.receipt, status: 'consumed' }
      if (!item.message) this.emptySteeringConsumed += 1
      this.commit()
    } else if (event.type === 'agent_settled') {
      // Pi's text-only queue mirror does not remove image-only entries. Clear
      // only proven empty-text ghosts, after execution, without touching any
      // remaining managed or extension payload.
      const session = this.runtime.session
      if (ledger.items.every((item) => item.status !== 'delivering') &&
        session.getSteeringMessages().length === this.emptySteeringConsumed &&
        session.getSteeringMessages().every((text) => text === '') &&
        session.getFollowUpMessages().length === 0 && this.emptySteeringConsumed > 0) {
        session.clearQueue()
        this.emptySteeringConsumed = 0
      }
      if (!ledger.paused) this.requestPump()
    }
  }

  pauseAndAbort(): Promise<void> {
    if (this.stopInFlight) return this.stopInFlight
    let resolve!: () => void
    let reject!: (error: unknown) => void
    const stopping = new Promise<void>((accept, fail) => { resolve = accept; reject = fail })
    // Install the gate before clearing queues or emitting paused state. Stop
    // bypasses the command lane, so Resume must not re-arm work during abort.
    this.stopInFlight = stopping
    void this.performPauseAndAbort().then(() => {
      this.stopInFlight = null
      resolve()
    }, (error: unknown) => {
      this.stopInFlight = null
      reject(error)
    })
    return stopping
  }

  private async performPauseAndAbort() {
    this.pauseEpoch += 1
    this.stopRequested = true
    // No await may precede this: otherwise Pi can consume a follow-up while
    // Stop is waiting for its own persistence/abort operation.
    this.runtime.session.clearQueue()
    this.emptySteeringConsumed = 0
    let persistenceError: unknown
    try {
      const ledger = this.load()
      ledger.paused = true
      for (const item of ledger.items) {
        if (item.status === 'queued') item.status = 'frozen'
        else if (item.status === 'delivering') {
          item.status = 'unknown'
          const record = ledger.records.find(({ receipt }) => receipt.submissionId === item.submissionId)
          if (record) record.receipt = { ...record.receipt, status: 'unknown', error: 'Stopped after hand-off. Check the conversation before sending this message again.' }
        }
      }
      this.commit()
    } catch (error) { persistenceError = error }
    try {
      await this.runtime.session.abort()
    } finally {
      // Storage failure must never prevent cancellation itself. Extensions may
      // also enqueue while observing abort, so disarm native work once more.
      this.runtime.session.clearQueue()
    }
    if (persistenceError) throw persistenceError
    this.commit()
  }

  private assertRevision(revision: number) {
    this.assertStorage()
    if (revision !== this.load().revision) throw new Error('The delivery queue changed. Refresh it before editing.')
  }

  async mutate(command: Mutation) {
    this.assertRevision(command.revision)
    const ledger = this.load()
    const item = ledger.items.find((candidate) => candidate.id === command.itemId)
    if (!item) throw new Error('This queued message was already consumed or removed.')
    if (item.status === 'delivering') throw new Error('Pi has already taken this message. It can no longer be edited or removed.')
    if (item.status === 'unknown' && command.action !== 'remove') throw new Error('Delivery is unconfirmed. Review its outcome before submitting a new message.')
    if (command.action === 'promote' && item.mode !== 'follow_up') throw new Error('Only a queued follow-up can be promoted.')
    if (command.action === 'edit' && !command.message?.trim() && !command.images?.length) throw new Error('An edited message or image is required.')
    if (command.action === 'remove') {
      ledger.items = ledger.items.filter((candidate) => candidate !== item)
      const record = ledger.records.find(({ receipt }) => receipt.submissionId === item.submissionId)
      if (record) record.receipt = { ...record.receipt, status: 'removed' }
    } else if (command.action === 'promote') {
      item.mode = 'steer'
      const record = ledger.records.find(({ receipt }) => receipt.submissionId === item.submissionId)
      if (record) record.receipt.acceptedMode = 'steer'
      ledger.items = [...ledger.items.filter((candidate) => candidate !== item), item]
    } else {
      item.message = command.message ?? ''
      item.images = command.images ? structuredClone(command.images) : undefined
    }
    this.commit()
    if (command.action === 'promote' && item.status === 'queued' && !ledger.paused && this.runtime.session.isStreaming) await this.handoffSteer(item)
    else if (!ledger.paused) this.requestPump()
    return this.snapshot()
  }

  clear(revision: number) {
    this.assertRevision(revision)
    const ledger = this.load()
    const removed = new Set(ledger.items.filter((item) => item.status === 'queued' || item.status === 'frozen')
      .map((item) => item.submissionId))
    ledger.items = ledger.items.filter((item) => !removed.has(item.submissionId))
    for (const record of ledger.records) {
      if (removed.has(record.receipt.submissionId)) record.receipt = { ...record.receipt, status: 'removed' }
    }
    this.commit()
    return this.snapshot()
  }

  async resume(revision?: number) {
    this.assertStorage()
    if (this.stopInFlight) throw new Error('Pi is still stopping. Wait before resuming.')
    if (revision !== undefined) this.assertRevision(revision)
    const ledger = this.load()
    if (ledger.items.some((item) => item.status === 'unknown')) throw new Error('Resolve unconfirmed deliveries before resuming the queue.')
    ledger.paused = false
    for (const item of ledger.items) if (item.status === 'frozen') item.status = 'queued'
    this.commit()
    this.stopRequested = false
    if (this.runtime.session.isStreaming) {
      for (const item of [...ledger.items]) {
        if (ledger.paused) break
        if (item.status === 'queued' && item.mode === 'steer') await this.handoffSteer(item)
      }
    }
    await this.pump()
    return this.snapshot()
  }

  /** Called only through RuntimeManager's serialized command lane. */
  async pump() {
    this.assertStorage()
    const ledger = this.load()
    if (this.stopInFlight || this.pumping || ledger.paused || this.runtime.session.isStreaming) return
    const item = ledger.items.find((candidate) => candidate.status === 'queued' && candidate.mode === 'steer') ??
      ledger.items.find((candidate) => candidate.status === 'queued')
    if (!item) return
    this.pumping = true
    item.status = 'delivering'
    this.commit()
    const record = ledger.records.find(({ receipt }) => receipt.submissionId === item.submissionId)
    try {
      await this.acceptPrompt(item.message, item.images)
      ledger.items = ledger.items.filter((candidate) => candidate !== item)
      if (record) record.receipt = { ...record.receipt, status: 'consumed' }
      this.commit()
    } catch (error) {
      ledger.paused = true
      for (const pending of ledger.items) if (pending.status === 'queued') pending.status = 'frozen'
      item.status = error instanceof DeliveryInterrupted ? 'unknown' : 'frozen'
      if (record) record.receipt = { ...record.receipt, status: item.status === 'unknown' ? 'unknown' : 'accepted', error: errorText(error) }
      this.commit()
      throw error
    } finally {
      this.pumping = false
      if (!ledger.paused && !this.runtime.session.isStreaming) this.requestPump()
    }
  }
}
