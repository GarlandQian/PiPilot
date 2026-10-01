import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { ConversationScope, OfficialPiSessionSummary } from '../../shared/conversation-scope'
import type { LocalPiRuntimeSnapshot } from '../../shared/local-pi'
import { MAX_SCHEDULED_RUNS } from '../../shared/scheduled-tasks'
import type { TaskNotification, TaskNotificationPresentation, TaskNotificationSnapshot } from '../../shared/task-notifications'
import { catalogIdentityForSession, type OfficialPiSessionCatalog } from '../conversations/official-pi-session-catalog'
import { conversationScopeKey } from '../conversations/conversation-scope-resolver'
import type { PiRuntimeControlSummary, PiRuntimeFrontend } from '../pi-host/pi-runtime-frontend'
import { NotificationRepository, retainedNotifications, type StoredTaskNotification } from './notification-repository'

type Kind = TaskNotification['kind']
interface ObservedRuntime {
  scope: ConversationScope
  sessionId: string
  sessionFile: string | null
  sourceSessionFile: string | null
  selectionToken?: string
  selected: boolean
  running: boolean
  execution: number
  input: boolean
}

export interface NativeTaskNotificationAdapter {
  supported(): boolean
  playCompletionSound(): void
  show(kind: Kind, onClick: () => void): { close(): void } | undefined
}

export interface TaskNotificationServiceOptions {
  filePath: string
  runtime: Pick<PiRuntimeFrontend, 'subscribe' | 'getSnapshot' | 'listControlRuntimes' | 'getControlWorkflowState'>
  catalog: Pick<OfficialPiSessionCatalog, 'listControlTargets' | 'revalidateControlTarget' | 'list' | 'resolve'>
  desktopEnabled(): boolean
  soundEnabled(): boolean
  isWindowForeground(): boolean
  revealWindow(): void
  projectName?(scope: ConversationScope): string | undefined
  native: NativeTaskNotificationAdapter
  now?: () => number
  createId?: () => string
  onDiagnostic?: () => void
}

export class TaskNotificationError extends Error {
  readonly code = 'NOTIFICATION_TARGET_UNAVAILABLE'
  constructor() { super('The task for this notification is no longer available.'); this.name = 'TaskNotificationError' }
}

function sameScope(left: ConversationScope, right: ConversationScope) {
  return conversationScopeKey(left) === conversationScopeKey(right)
}

/** Observes task outcomes without joining or delaying the runtime event pipeline. */
export class TaskNotificationService {
  private readonly repository: NotificationRepository
  private readonly now: () => number
  private readonly createId: () => string
  private readonly listeners = new Set<(snapshot: TaskNotificationSnapshot) => void>()
  private readonly observed = new Map<string, ObservedRuntime>()
  private readonly nativeHandles = new Map<string, { close(): void }>()
  private readonly scheduledFailures = new Map<string, { conversationId: string; handle?: { close(): void } }>()
  private readonly metadataRequests = new Map<string, ReturnType<OfficialPiSessionCatalog['listControlTargets']>>()
  private readonly pathRequests = new Map<string, Promise<string>>()
  private readonly recordPaths = new WeakMap<StoredTaskNotification, Promise<void>>()
  private readonly recordOwners = new WeakMap<StoredTaskNotification, ObservedRuntime>()
  private records: StoredTaskNotification[] = []
  private presentation: TaskNotificationPresentation = { scope: null, sessionId: null }
  private revision = 0
  private requestedId: string | null = null
  private detach?: () => unknown
  private disposed = false

  constructor(private readonly options: TaskNotificationServiceOptions) {
    this.now = options.now ?? Date.now
    this.createId = options.createId ?? randomUUID
    this.repository = new NotificationRepository(options.filePath, options.onDiagnostic)
  }

  async initialize() {
    this.records = (await this.repository.load(this.now())).map((record) => ({
      ...record,
      // A previous process cannot still own an actionable extension dialog.
      item: record.item.kind === 'input-required' ? { ...record.item, resolved: true } : record.item,
    }))
    this.publish()
    for (const record of this.records) {
      if (!record.item.catalogId || !record.item.sessionName) void this.enrichMetadata(record)
      else void this.canonicalizeRecord(record)
    }
    this.observe(this.options.runtime.getSnapshot())
    this.detach = this.options.runtime.subscribe((snapshot) => {
      try { this.observe(snapshot) } catch { this.options.onDiagnostic?.() }
    })
    return this.get()
  }

  get(): TaskNotificationSnapshot {
    const retained = retainedNotifications(this.records, this.now())
    if (retained.length !== this.records.length) {
      this.records = retained
      this.publish()
    }
    return {
      revision: this.revision,
      items: this.records.map(({ item }) => structuredClone(item)),
      requestedId: this.requestedId,
      desktopSupported: this.desktopSupported(),
    }
  }

  subscribe(listener: (snapshot: TaskNotificationSnapshot) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  setPresentation(presentation: TaskNotificationPresentation) {
    this.presentation = structuredClone(presentation)
    let changed = false
    if (this.options.isWindowForeground() && presentation.scope && presentation.sessionId) {
      const viewed = [...this.observed.values()].find((state) => state.selected &&
        sameScope(state.scope, presentation.scope!) && state.sessionId === presentation.sessionId)
      for (const record of this.records) {
        if (!record.item.read && viewed && this.sameTarget(record, viewed)) {
          record.item.read = true
          changed = true
        }
      }
    }
    if (changed) this.publish()
    return this.get()
  }

  refreshPresentation() {
    return this.setPresentation(this.presentation)
  }

  markRead(id?: string) {
    let changed = false
    for (const record of this.records) {
      if ((!id || record.item.id === id) && !record.item.read) { record.item.read = true; changed = true }
    }
    if (changed) this.publish()
    return this.get()
  }

  clear(id?: string) {
    const previousLength = this.records.length
    this.records = id ? this.records.filter(({ item }) => item.id !== id) : []
    if (!id || id === this.requestedId) this.requestedId = null
    if (this.records.length !== previousLength) this.publish()
    return this.get()
  }

  /** A failed preflight has no Runtime outcome to observe. Its exact target
   * remains in the scheduler ledger, including when that target was deleted.
   * Never fabricate a navigable conversation record or select another Session. */
  reportScheduledPreflightFailure({ runId, conversationId }: { runId: string; conversationId: string }) {
    if (this.disposed || this.scheduledFailures.has(runId)) return
    const record: { conversationId: string; handle?: { close(): void } } = { conversationId }
    this.scheduledFailures.set(runId, record)
    while (this.scheduledFailures.size > MAX_SCHEDULED_RUNS) {
      const oldest = this.scheduledFailures.keys().next().value
      if (oldest === undefined) break
      try { this.scheduledFailures.get(oldest)?.handle?.close() } catch { /* Best effort. */ }
      this.scheduledFailures.delete(oldest)
    }
    // Failures are silent. Successful Runtime settlement is the sole sound source.
    if (this.options.isWindowForeground() || !this.options.desktopEnabled() || !this.desktopSupported()) return
    try {
      record.handle = this.options.native.show('failed', () => {
        if (this.disposed || this.scheduledFailures.get(runId) !== record) return
        try { this.options.revealWindow() } catch { this.options.onDiagnostic?.() }
      })
    } catch { this.options.onDiagnostic?.() }
  }

  async resolveTarget(id: string): Promise<OfficialPiSessionSummary> {
    try {
      const record = this.records.find(({ item }) => item.id === id)
      if (!record?.sessionFile) throw new TaskNotificationError()
      await this.canonicalizeRecord(record)
      const catalog = this.options.catalog
      const targets = await catalog.listControlTargets(record.item.scope)
      const target = targets.targets.find((entry) => entry.sessionFile === record.sessionFile && entry.sessionId === record.item.sessionId)
      if (targets.status !== 'ready' || !target) throw new TaskNotificationError()
      if (record.item.catalogId && record.item.catalogId !== catalogIdentityForSession(record.item.scope, target.sessionFile, target.sessionId, target.createdAt)) {
        throw new TaskNotificationError()
      }
      await catalog.revalidateControlTarget(target)
      let page = await catalog.list(record.item.scope)
      while (page.status === 'ready') {
        for (const row of page.rows) {
          if (row.sessionId !== record.item.sessionId) continue
          const resolved = await catalog.resolve(row.scope, row.selectionToken).catch(() => undefined)
          if (!resolved) continue
          const file = resolved.mode === 'open' ? resolved.sessionFile : resolved.forkSessionFile
          if (file === target.sessionFile) return row
        }
        if (!page.nextCursor) break
        page = await catalog.list(record.item.scope, page.nextCursor)
      }
      throw new TaskNotificationError()
    } catch { throw new TaskNotificationError() }
    finally {
      if (this.requestedId === id) { this.requestedId = null; this.publish() }
    }
  }

  private observe(snapshot: LocalPiRuntimeSnapshot) {
    if (this.disposed) return
    const live = this.options.runtime.listControlRuntimes()
    const liveKeys = new Set<string>()
    let changed = false
    for (const summary of live) {
      if (!summary.sessionId) continue
      const key = `${summary.hostEpoch}:${summary.runtimeId}:${summary.generation}`
      liveKeys.add(key)
      const previous = this.observed.get(key)
      const sameSession = previous && sameScope(previous.scope, summary.scope) && previous.sessionId === summary.sessionId &&
        (!previous.sourceSessionFile || !summary.sessionFile || previous.sourceSessionFile === summary.sessionFile || previous.sessionFile === summary.sessionFile)
      if (previous && !sameSession && previous.input) changed = this.resolveInput(previous) || changed
      const state: ObservedRuntime = sameSession ? previous : {
        scope: summary.scope, sessionId: summary.sessionId, sessionFile: summary.sessionFile, sourceSessionFile: summary.sessionFile,
        selected: summary.selected, running: false, execution: 0, input: false,
      }
      state.scope = summary.scope
      state.sessionId = summary.sessionId
      const sourceChanged = summary.sessionFile !== null && state.sourceSessionFile !== summary.sessionFile
      if (sourceChanged) state.sessionFile = state.sourceSessionFile = summary.sessionFile
      state.selectionToken = summary.selectionToken
      state.selected = summary.selected
      this.observed.set(key, state)
      if (!sameSession || sourceChanged) void this.canonicalizeObserved(key, state)
      const input = summary.activity === 'interaction'
      if (input && !state.input) this.add('input-required', state, snapshot)
      if (!input && state.input) changed = this.resolveInput(state) || changed
      state.input = input
      // Reads, queued work cancelled before execution, and standalone extension
      // questions can all retain an old outcome. Only execution arms completion.
      if (summary.lifecycle !== 'idle' && summary.activity && summary.activity !== 'interaction' && !state.running) {
        state.running = true
        state.execution += 1
      }
      if (summary.lifecycle === 'idle' && state.running) {
        state.running = false
        if (summary.outcome === 'failed') this.add('failed', state, snapshot)
        else if (summary.outcome === 'completed') void this.confirmCompletion(key, state, summary, snapshot)
      }
    }
    for (const [key, state] of this.observed) {
      if (liveKeys.has(key)) continue
      const matches = (snapshot.sessionStatuses ?? []).filter((status) => sameScope(status.scope, state.scope) && status.sessionId === state.sessionId &&
        (state.selectionToken ? status.selectionToken === state.selectionToken : true))
      const ambiguous = !state.selectionToken && [...this.observed.values()].filter((entry) => sameScope(entry.scope, state.scope) && entry.sessionId === state.sessionId).length > 1
      if (state.running && !ambiguous && matches.length === 1 && matches[0].status === 'failed') this.add('failed', state, snapshot)
      if (state.input) changed = this.resolveInput(state) || changed
      this.observed.delete(key)
    }
    if (changed) this.publish()
  }

  private async confirmCompletion(key: string, state: ObservedRuntime, summary: PiRuntimeControlSummary, snapshot: LocalPiRuntimeSnapshot) {
    const execution = state.execution
    try {
      // Turn settlement is not Goal completion, nor approval of a saved plan.
      // PiPilot metadata never owns the execution lifecycle.
      const workflow = await this.options.runtime.getControlWorkflowState(summary)
      if (this.disposed || this.observed.get(key) !== state || state.running || state.execution !== execution) return
      if (workflow.plan?.enabled || workflow.plan?.awaitingAction || workflow.plan?.savedPlan) return
      if (workflow.goal && workflow.goal.status !== 'complete') return
      this.add('completed', state, snapshot)
    } catch {
      // A retiring/replaced runtime or unavailable task state must not produce
      // a misleading completion. Failure notifications retain their own path.
      if (!this.disposed) this.options.onDiagnostic?.()
    }
  }

  private resolveInput(state: ObservedRuntime) {
    let changed = false
    for (const record of this.records) {
      if (record.item.kind === 'input-required' && !record.item.resolved && this.sameTarget(record, state)) {
        record.item.resolved = true
        changed = true
      }
    }
    return changed
  }

  private add(kind: Kind, state: ObservedRuntime, snapshot: LocalPiRuntimeSnapshot) {
    const read = Boolean(this.options.isWindowForeground() && state.selected && this.presentation.scope &&
      sameScope(this.presentation.scope, state.scope) && this.presentation.sessionId === state.sessionId)
    const sessionName = state.selected && snapshot.sessionState?.sessionId === state.sessionId
      ? snapshot.sessionState.sessionName?.slice(0, 256) : undefined
    const projectName = this.options.projectName?.(state.scope)?.slice(0, 256)
    const item: TaskNotification = {
      id: this.createId(), kind, scope: structuredClone(state.scope), sessionId: state.sessionId,
      ...(sessionName ? { sessionName } : {}), ...(projectName ? { projectName } : {}),
      createdAt: this.now(), read, resolved: kind !== 'input-required',
    }
    const record = { item, sessionFile: state.sessionFile }
    this.recordOwners.set(record, state)
    this.records.push(record)
    this.publish()
    void this.enrichMetadata(record)
    // This is the live execution-to-idle edge, shared by interactive and
    // scheduled Runtime work. Never derive sound from a restored snapshot,
    // metadata updates, read-state changes or native notification delivery.
    if (kind === 'completed' && !read && this.options.soundEnabled()) {
      try { this.options.native.playCompletionSound() } catch { this.options.onDiagnostic?.() }
    }
    if (!this.options.isWindowForeground() && this.options.desktopEnabled() && this.desktopSupported()) {
      try {
        const handle = this.options.native.show(kind, () => {
          if (this.disposed || !this.records.some((record) => record.item.id === item.id)) return
          try {
            this.requestedId = item.id
            this.publish()
            this.options.revealWindow()
          } catch { this.options.onDiagnostic?.() }
        })
        if (handle) this.nativeHandles.set(item.id, handle)
      } catch { this.options.onDiagnostic?.() }
    }
  }

  private async enrichMetadata(record: StoredTaskNotification) {
    if (!record.sessionFile || this.disposed) return
    const canonicalized = this.canonicalizeRecord(record)
    const key = conversationScopeKey(record.item.scope)
    let request = this.metadataRequests.get(key)
    try {
      if (!request) {
        request = this.options.catalog.listControlTargets(record.item.scope)
        this.metadataRequests.set(key, request)
      }
      const [result] = await Promise.all([request, canonicalized])
      if (this.disposed || !this.records.includes(record) || result.status !== 'ready') return
      const target = result.targets.find((entry) => entry.sessionFile === record.sessionFile && entry.sessionId === record.item.sessionId)
      if (!target) return
      // This ID remains presentation-only; resolveTarget still revalidates the file.
      const catalogId = catalogIdentityForSession(record.item.scope, target.sessionFile, target.sessionId, target.createdAt)
      if (record.item.catalogId && record.item.catalogId !== catalogId) return
      const sessionName = record.item.sessionName || target.name?.slice(0, 256)
      if (record.item.catalogId === catalogId && record.item.sessionName === sessionName) return
      record.item = { ...record.item, catalogId, ...(sessionName ? { sessionName } : {}) }
      this.publish()
    } catch { /* Optional catalog labels must not affect task execution or delivery. */ }
    finally {
      if (this.metadataRequests.get(key) === request) this.metadataRequests.delete(key)
    }
  }

  private sameTarget(record: StoredTaskNotification, state: ObservedRuntime) {
    // The originating observation bridges asynchronous path resolution. A
    // different physical session gets a new observation, even with the same ID.
    return sameScope(record.item.scope, state.scope) && record.item.sessionId === state.sessionId &&
      (record.sessionFile === state.sessionFile || this.recordOwners.get(record) === state)
  }

  private canonicalSessionFile(file: string) {
    const pending = this.pathRequests.get(file)
    if (pending) return pending
    // Resolve parent aliases, including a symlinked Pi directory, without
    // following a symlink at the file itself (the catalog rejects those).
    // Pi assigns a file path before its first persisted assistant message.
    const request = realpath(dirname(file)).then((directory) => join(directory, basename(file)), () => file)
    this.pathRequests.set(file, request)
    void request.then(() => { if (this.pathRequests.get(file) === request) this.pathRequests.delete(file) })
    return request
  }

  private async canonicalizeObserved(key: string, state: ObservedRuntime) {
    const source = state.sourceSessionFile
    if (!source) return
    const canonical = await this.canonicalSessionFile(source)
    if (this.disposed || this.observed.get(key) !== state || state.sourceSessionFile !== source) return
    if (state.sessionFile === canonical) return
    state.sessionFile = canonical
    this.refreshPresentation()
  }

  private canonicalizeRecord(record: StoredTaskNotification): Promise<void> {
    const pending = this.recordPaths.get(record)
    if (pending) return pending
    const source = record.sessionFile
    if (!source) return Promise.resolve()
    const request = this.canonicalSessionFile(source).then((canonical) => {
      if (!this.records.includes(record) || record.sessionFile !== source || canonical === source) return
      record.sessionFile = canonical
      this.publish()
      if (!this.disposed) this.refreshPresentation()
    })
    this.recordPaths.set(record, request)
    return request
  }

  private desktopSupported() {
    try { return this.options.native.supported() } catch { return false }
  }

  private publish() {
    this.records = retainedNotifications(this.records, this.now())
    if (this.requestedId && !this.records.some(({ item }) => item.id === this.requestedId)) this.requestedId = null
    for (const [id, handle] of this.nativeHandles) {
      if (!this.records.some(({ item }) => item.id === id && !item.read && !(item.kind === 'input-required' && item.resolved))) {
        try { handle.close() } catch { /* OS presentation cannot affect a task. */ }
        this.nativeHandles.delete(id)
      }
    }
    this.revision += 1
    this.repository.save(this.records)
    const snapshot = this.get()
    for (const listener of this.listeners) {
      try { listener(snapshot) } catch { /* A renderer cannot interrupt runtime observation. */ }
    }
  }

  async dispose() {
    this.disposed = true
    this.detach?.()
    this.detach = undefined
    for (const handle of this.nativeHandles.values()) { try { handle.close() } catch { /* Best effort. */ } }
    this.nativeHandles.clear()
    for (const record of this.scheduledFailures.values()) { try { record.handle?.close() } catch { /* Best effort. */ } }
    this.scheduledFailures.clear()
    this.listeners.clear()
    await Promise.all(this.records.map((record) => this.recordPaths.get(record)))
    await this.repository.flush()
  }
}
