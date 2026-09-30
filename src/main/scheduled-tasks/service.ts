import { createHash, randomUUID } from 'node:crypto'
import { isTerminalExternalControlStatus, type ExternalControlOperation } from '../../shared/external-control'
import { MAX_SCHEDULED_RUNS, MAX_SCHEDULED_TASKS, isScheduledRunActive, scheduledTaskInputSchema, type ScheduledRun, type ScheduledTaskInput, type ScheduledTasksSnapshot } from '../../shared/scheduled-tasks'
import type { ConversationMcpControlService } from '../external-control/conversation-control-service'
import type { ConversationMcpInventoryService } from '../external-control/conversation-inventory'
import { initialScheduledAt, nextScheduledAt } from './schedule'
import type { ScheduledTaskDocument, ScheduledTaskRepository } from './repository'

export class ScheduledTaskError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'ScheduledTaskError' }
}
type Control = Pick<ConversationMcpControlService, 'sendPrompt' | 'getOperation' | 'subscribeOperations'>
type Inventory = Pick<ConversationMcpInventoryService, 'resolveConversation' | 'listConversationTargets'>
export function scheduledTargetIdentity(target: { sessionId: string; headerIdentity: string }) {
  return createHash('sha256').update(JSON.stringify([target.sessionId, target.headerIdentity])).digest('base64url')
}
interface Options {
  repository: Pick<ScheduledTaskRepository, 'load' | 'save'>
  control: Control
  inventory: Inventory
  now?: () => number
  createId?: () => string
  notify?(run: ScheduledRun): void
  intervalMs?: number
}

/** App-local scheduler. Reservations are durable; uncertain dispatches are never replayed. */
export class ScheduledTaskService {
  private document: ScheduledTaskDocument = { tasks: [], runs: [] }
  private storageError: string | null = null
  private readonly listeners = new Set<(snapshot: ScheduledTasksSnapshot) => void>()
  private readonly now: () => number
  private readonly createId: () => string
  private detach?: () => unknown
  private timer?: ReturnType<typeof setInterval>
  private disposed = false
  private suspended = false
  private revision = 0
  private readonly dispatchControllers = new Map<string, AbortController>()
  private readonly pendingDispatches = new Set<Promise<void>>()
  constructor(private readonly options: Options) { this.now = options.now ?? Date.now; this.createId = options.createId ?? randomUUID }

  initialize() {
    try {
      this.document = this.options.repository.load()
      const interrupted = new Set(this.document.runs.filter(isScheduledRunActive).map((run) => run.taskId))
      if (interrupted.size) this.commit({
        tasks: this.document.tasks.map((task) => interrupted.has(task.id) ? { ...task, enabled: false, updatedAt: this.now() } : task),
        runs: this.document.runs.map((run) => isScheduledRunActive(run) ? { ...run, status: 'interrupted', finishedAt: this.now(), errorCode: 'outcome_unknown', error: 'PiPilot restarted before confirming the outcome. This attempt will not be sent again. Check the conversation before resuming.' } : run),
      })
      this.detach = this.options.control.subscribeOperations((operation) => this.observe(operation))
      this.timer = setInterval(() => this.tick(), this.options.intervalMs ?? 15_000)
      this.timer.unref()
      this.tick()
    } catch { this.storageError = 'Scheduled tasks are stopped because their saved ledger could not be read or safely written.'; this.publish() }
    return this.get()
  }
  get(): ScheduledTasksSnapshot { return structuredClone({ ...this.document, revision: this.revision, storageError: this.storageError }) }
  subscribe(listener: (snapshot: ScheduledTasksSnapshot) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  async listTargets(input: unknown) {
    const page = await this.options.inventory.listConversationTargets(input)
    return { nextCursor: page.nextCursor, diagnostics: page.diagnostics, conversations: page.targets.flatMap((target) => target.catalogTarget?.mode === 'open'
      ? [{ ...target.conversation, targetIdentity: scheduledTargetIdentity(target.catalogTarget) }] : []) }
  }

  async save(raw: ScheduledTaskInput) {
    this.assertAvailable()
    const input = scheduledTaskInputSchema.parse(raw)
    const target = await this.options.inventory.resolveConversation(input.conversationId)
    this.assertAvailable()
    if (!target.catalogTarget || target.catalogTarget.mode !== 'open') throw new ScheduledTaskError('SCHEDULE_TARGET_UNAVAILABLE', 'Select an existing saved Pi conversation.')
    if (input.targetIdentity !== scheduledTargetIdentity(target.catalogTarget)) throw new ScheduledTaskError('SCHEDULE_TARGET_UNAVAILABLE', 'The selected conversation was replaced. Refresh the conversation list and choose its target again.')
    const previous = input.id ? this.document.tasks.find((task) => task.id === input.id) : undefined
    if (input.id && !previous) throw new ScheduledTaskError('SCHEDULE_NOT_FOUND', 'The scheduled task no longer exists.')
    if (input.id && this.busy(input.id)) throw new ScheduledTaskError('SCHEDULE_BUSY', 'Wait for this task to finish before editing it.')
    if (!previous && this.document.tasks.length >= MAX_SCHEDULED_TASKS) throw new ScheduledTaskError('SCHEDULE_LIMIT', 'The scheduled task limit has been reached.')
    const now = this.now()
    const sameSchedule = previous && JSON.stringify(previous.schedule) === JSON.stringify(input.schedule)
    const task = { ...input, id: previous?.id ?? this.createId(), targetLabel: ([target.conversation.project, target.conversation.name].filter(Boolean).join(' · ') || input.conversationId).slice(0, 512), targetSessionId: target.catalogTarget.sessionId, targetHeaderIdentity: target.catalogTarget.headerIdentity, createdAt: previous?.createdAt ?? now, updatedAt: now, nextRunAt: sameSchedule ? previous.nextRunAt : initialScheduledAt(input.schedule, now) }
    this.commit({ ...this.document, tasks: previous ? this.document.tasks.map((item) => item.id === task.id ? task : item) : [...this.document.tasks, task] })
    this.tick()
    return this.get()
  }
  setEnabled(id: string, enabled: boolean) {
    this.assertAvailable()
    const task = this.requireTask(id)
    this.commit({ ...this.document, tasks: this.document.tasks.map((item) => item.id === id ? { ...task, enabled, updatedAt: this.now(), nextRunAt: task.nextRunAt ?? (task.schedule.kind === 'once' ? null : nextScheduledAt(task.schedule, this.now())) } : item) })
    this.tick()
    return this.get()
  }
  remove(id: string) {
    this.assertAvailable(); this.requireTask(id)
    if (this.busy(id)) throw new ScheduledTaskError('SCHEDULE_BUSY', 'Pause future runs and wait for the current run before deleting this task.')
    this.commit({ ...this.document, tasks: this.document.tasks.filter((task) => task.id !== id) })
    return this.get()
  }
  runNow(id: string) {
    this.assertAvailable(); this.requireTask(id)
    if (this.busy(id)) throw new ScheduledTaskError('SCHEDULE_BUSY', 'This task already has a run in progress.')
    this.launch(id, this.now(), 'manual')
    return this.get()
  }
  tick() {
    if (this.disposed || this.suspended || this.storageError) return
    try {
      const now = this.now()
      for (const task of [...this.document.tasks]) {
        if (!task.enabled || task.nextRunAt === null || task.nextRunAt > now) continue
        const late = now - task.nextRunAt > 60_000
        if (this.busy(task.id) || (late && task.missedPolicy === 'skip')) {
          const run: ScheduledRun = { id: this.createId(), taskId: task.id, taskName: task.name, conversationId: task.conversationId, scheduledAt: task.nextRunAt, startedAt: now, finishedAt: now, trigger: 'scheduled', status: 'skipped', errorCode: this.busy(task.id) ? 'previous_run_active' : 'missed_schedule' }
          this.commit({ tasks: this.advance(task.id, now), runs: this.retain([...this.document.runs, run]) })
        } else this.launch(task.id, task.nextRunAt, 'scheduled')
      }
    } catch { /* commit has latched the storage failure; no further dispatch is allowed. */ }
  }

  /** Stop scheduling before updater preparation; existing work is stopped by Runtime owners. */
  suspend() { this.suspended = true; for (const controller of this.dispatchControllers.values()) controller.abort() }
  resume() { if (!this.disposed) { this.suspended = false; this.tick() } }
  async dispose() {
    this.disposed = true
    this.suspend()
    clearInterval(this.timer)
    this.detach?.()
    // Do not wait for startup UI here. Runtime/Pool shutdown cancels it. The
    // durable nonterminal row deliberately recovers as outcome-unknown.
    this.listeners.clear()
  }
  private busy(id: string) { return this.document.runs.some((run) => run.taskId === id && isScheduledRunActive(run)) }
  private requireTask(id: string) {
    const task = this.document.tasks.find((item) => item.id === id)
    if (!task) throw new ScheduledTaskError('SCHEDULE_NOT_FOUND', 'The scheduled task no longer exists.')
    return task
  }
  private advance(id: string, now: number) { return this.document.tasks.map((task) => task.id === id ? { ...task, nextRunAt: nextScheduledAt(task.schedule, now) } : task) }
  private launch(id: string, scheduledAt: number, trigger: ScheduledRun['trigger']) {
    const task = this.requireTask(id)
    const run: ScheduledRun = { id: this.createId(), taskId: id, taskName: task.name, conversationId: task.conversationId, scheduledAt, startedAt: this.now(), trigger, status: 'dispatching' }
    // Commit both the reservation and schedule cursor before the first async
    // dispatch. A crash on either side of send is recovered without resending.
    this.commit({ tasks: trigger === 'scheduled' ? this.advance(id, this.now()) : this.document.tasks, runs: this.retain([...this.document.runs, run]) })
    const dispatch = this.dispatch(run, task.prompt)
    this.pendingDispatches.add(dispatch)
    void dispatch.then(() => this.pendingDispatches.delete(dispatch), () => this.pendingDispatches.delete(dispatch))
  }
  private async dispatch(run: ScheduledRun, prompt: string) {
    const controller = new AbortController()
    let reserved = false
    this.dispatchControllers.set(run.id, controller)
    try {
      if (this.disposed || this.suspended || this.storageError) return
      const task = this.requireTask(run.taskId)
      const receipt = await this.options.control.sendPrompt({ conversationId: run.conversationId, prompt, mode: 'prompt', idempotencyKey: `scheduled:${run.id}` }, { sessionId: task.targetSessionId, headerIdentity: task.targetHeaderIdentity, signal: controller.signal })
      reserved = true
      if (this.disposed || this.storageError) return
      this.updateRun(run.id, { operationId: receipt.operationId })
      this.observe(this.options.control.getOperation({ operationId: receipt.operationId }).operation)
    } catch (error) {
      if (this.disposed || this.storageError) return
      this.updateRun(run.id, reserved
        ? { status: 'interrupted', finishedAt: this.now(), errorCode: 'outcome_unknown', error: 'Pi accepted the operation receipt, but its outcome could not be confirmed. Check the conversation before resuming.' }
        : { status: 'failed', finishedAt: this.now(), errorCode: typeof error === 'object' && error && 'code' in error ? String(error.code).slice(0, 128) : 'dispatch_failed', error: error instanceof Error ? error.message.slice(0, 512) : 'The scheduled prompt could not be dispatched.' })
    } finally {
      const current = this.document.runs.find((item) => item.id === run.id)
      if (this.disposed || !current || !isScheduledRunActive(current)) this.dispatchControllers.delete(run.id)
    }
  }
  private observe(operation: ExternalControlOperation) {
    if (this.disposed || this.storageError) return
    const run = this.document.runs.find((item) => item.operationId === operation.operationId)
    if (!run || !isScheduledRunActive(run)) return
    try {
      this.updateRun(run.id, { status: operation.status === 'received' ? 'dispatching' : operation.status,
        ...(isTerminalExternalControlStatus(operation.status) ? { finishedAt: this.now() } : {}),
        ...(operation.error ? { errorCode: operation.error.code, error: operation.error.message } : {}),
        ...(operation.finalResponse ? { finalResponse: operation.finalResponse } : {}),
      })
    } catch { /* fail closed if the durable receipt cannot be updated */ }
  }
  private updateRun(id: string, patch: Partial<ScheduledRun>) {
    const previous = this.document.runs.find((run) => run.id === id)
    if (!previous) return
    const run = { ...previous, ...patch }
    this.commit({ ...this.document, runs: this.document.runs.map((item) => item.id === id ? run : item),
      tasks: ['interaction_required', 'conversation_not_found', 'conversation_unavailable', 'outcome_unknown'].includes(run.errorCode ?? '') ? this.document.tasks.map((task) => task.id === run.taskId ? { ...task, enabled: false } : task) : this.document.tasks,
    })
    if (isScheduledRunActive(previous) && !isScheduledRunActive(run)) {
      this.dispatchControllers.delete(id)
      try { this.options.notify?.(structuredClone(run)) } catch { /* notification transport does not alter the run outcome */ }
    }
  }
  private retain(runs: ScheduledRun[]) {
    while (runs.length > MAX_SCHEDULED_RUNS) {
      const index = runs.findIndex((run) => !isScheduledRunActive(run))
      if (index < 0) throw new ScheduledTaskError('SCHEDULE_LIMIT', 'The active run limit has been reached.')
      runs.splice(index, 1)
    }
    return runs
  }
  private commit(document: ScheduledTaskDocument) {
    try { this.options.repository.save(document) }
    catch { this.storageError = 'Scheduled tasks are stopped because the run ledger could not be safely saved.'; this.publish(); throw new ScheduledTaskError('SCHEDULE_STORAGE_FAILED', this.storageError) }
    this.document = document
    this.publish()
  }
  private publish() { this.revision += 1; const snapshot = this.get(); for (const listener of this.listeners) { try { listener(snapshot) } catch { /* isolate observers */ } } }
  private assertAvailable() {
    if (this.disposed || this.suspended) throw new ScheduledTaskError('SCHEDULE_UNAVAILABLE', 'Scheduled tasks are stopped while PiPilot is shutting down.')
    if (this.storageError) throw new ScheduledTaskError('SCHEDULE_STORAGE_FAILED', this.storageError)
  }
}
