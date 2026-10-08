import { randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExternalControlError, type ExternalControlOperation } from '../../src/shared/external-control'
import { type ScheduledTaskInput } from '../../src/shared/scheduled-tasks'
import { ScheduledTaskService, scheduledTargetIdentity } from '../../src/main/scheduled-tasks/service'
import { ScheduledTaskRepository, type ScheduledTaskDocument } from '../../src/main/scheduled-tasks/repository'
import { nextScheduledAt } from '../../src/main/scheduled-tasks/schedule'
import type { ConversationMcpResolvedTarget } from '../../src/main/external-control/conversation-inventory'
import { scheduledTasksRunContract, scheduledTasksSaveContract } from '../../src/shared/ipc/scheduled-tasks-contracts'
import { createValidatedInvokeHandler } from '../../src/main/ipc/validated-invoke'
import type { IpcMainInvokeEvent } from 'electron'

const conversationId = `conv_${'c'.repeat(43)}`
const NOW = Date.parse('2026-09-29T00:00:00Z')
const target: ConversationMcpResolvedTarget = {
  conversation: { conversationId, name: 'Saved conversation', lifecycle: 'inactive', createdAt: '2026-09-28T00:00:00Z', modifiedAt: '2026-09-28T00:00:00Z' },
  catalogTarget: { scope: { kind: 'projectless' }, cwd: '/fixture', sessionId: 'saved-session', sessionFile: '/fixture/session.jsonl', mode: 'open', createdAt: '2026-09-28T00:00:00Z', modifiedAt: '2026-09-28T00:00:00Z', root: '/fixture', headerIdentity: 'original-header', contentDigest: 'digest', identity: { dev: 1, ino: 1, size: 1, mtimeMs: 1, ctimeMs: 1 } },
}
const services: ScheduledTaskService[] = []
const directories: string[] = []
afterEach(async () => { await Promise.all(services.splice(0).map((service) => service.dispose())); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })
const flush = () => new Promise<void>((resolve) => setImmediate(resolve))

function harness(repository?: { load(): ScheduledTaskDocument; save(value: ScheduledTaskDocument): void }) {
  let clock = NOW
  let saved: ScheduledTaskDocument = { tasks: [], runs: [] }
  const memory = repository ?? { load: () => structuredClone(saved), save: (value: ScheduledTaskDocument) => { saved = structuredClone(value) } }
  const operations = new Map<string, ExternalControlOperation>()
  const listeners = new Set<(operation: ExternalControlOperation) => void>()
  const control = {
    sendPrompt: vi.fn(async (_input: unknown, _expected?: { sessionId: string; headerIdentity: string; signal?: AbortSignal }) => {
      const operation: ExternalControlOperation = { operationId: `op_${randomUUID().replace(/-/g, '')}`, conversationId, kind: 'send_prompt', status: 'accepted', requestedMode: 'prompt', acceptedMode: 'prompt', receivedAt: new Date(clock).toISOString(), updatedAt: new Date(clock).toISOString() }
      operations.set(operation.operationId, operation)
      return operation
    }),
    getOperation: ({ operationId }: { operationId: string }) => ({ operation: operations.get(operationId)! }),
    subscribeOperations: (listener: (operation: ExternalControlOperation) => void) => { listeners.add(listener); return () => listeners.delete(listener) },
  }
  const inventory = { resolveConversation: vi.fn(async () => structuredClone(target)), listConversationTargets: vi.fn(async () => ({ targets: [structuredClone(target)], nextCursor: null, diagnostics: [] })) }
  const notify = vi.fn()
  const service = new ScheduledTaskService({ repository: memory, control, inventory, now: () => clock, notify })
  services.push(service)
  service.initialize()
  const input = (overrides: Partial<ScheduledTaskInput> = {}): ScheduledTaskInput => ({ name: 'Daily review', conversationId, targetIdentity: scheduledTargetIdentity(target.catalogTarget!), prompt: 'Review my project', schedule: { kind: 'once', at: NOW + 60_000 }, enabled: true, missedPolicy: 'catch-up-once', ...overrides })
  return { service, control, inventory, notify, memory, input, now(value: number) { clock = value }, emit(patch: Partial<ExternalControlOperation>) {
    const previous = [...operations.values()][operations.size - 1]!
    const operation = { ...previous, ...patch }
    operations.set(operation.operationId, operation)
    listeners.forEach((listener) => listener(operation))
  } }
}

describe('scheduled task dispatch ledger', () => {
  it('saves a durable reservation before submission and records acceptance separately from completion', async () => {
    const h = harness()
    const original = h.control.sendPrompt.getMockImplementation()!
    h.control.sendPrompt.mockImplementation(async (...args) => {
      const persisted = h.memory.load()
      expect(persisted.runs).toHaveLength(1)
      expect(persisted.runs[0].status).toBe('dispatching')
      expect(persisted.tasks[0].nextRunAt).toBeNull()
      return original(...args)
    })
    await h.service.save(h.input({ schedule: { kind: 'once', at: NOW } }))
    await flush()
    expect(h.service.get().runs[0]).toMatchObject({ status: 'accepted' })
    expect(h.service.get().runs[0].finishedAt).toBeUndefined()
    expect(h.notify).not.toHaveBeenCalled()
    expect(h.control.sendPrompt).toHaveBeenCalledWith(expect.objectContaining({ mode: 'prompt', idempotencyKey: expect.stringMatching(/^scheduled:/) }), expect.objectContaining({ sessionId: 'saved-session', headerIdentity: 'original-header' }))
    h.emit({ status: 'completed', finalResponse: 'Done' })
    expect(h.service.get().runs[0]).toMatchObject({ status: 'completed', finalResponse: 'Done', finishedAt: NOW })
    expect(h.notify).toHaveBeenCalledTimes(1)
  })

  it('binds the picker to an exact official session and rejects replacement between choosing and saving', async () => {
    const h = harness()
    const page = await h.service.listTargets({ limit: 50 })
    const chosen = page.conversations[0]
    expect(chosen.targetIdentity).toBe(scheduledTargetIdentity(target.catalogTarget!))
    h.inventory.resolveConversation.mockResolvedValue({ ...target, catalogTarget: { ...target.catalogTarget!, sessionId: 'replacement', headerIdentity: 'new-header' } })
    await expect(h.service.save(h.input({ targetIdentity: chosen.targetIdentity }))).rejects.toMatchObject({ code: 'SCHEDULE_TARGET_UNAVAILABLE' })
    expect(h.service.get().tasks).toHaveLength(0)
    expect(h.control.sendPrompt).not.toHaveBeenCalled()
  })

  it('persists maximum-length official project and conversation names without disabling the ledger', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'pipilot-scheduled-label-'))
    directories.push(directory)
    const repository = new ScheduledTaskRepository(join(directory, 'ledger.json'))
    const h = harness(repository)
    h.inventory.resolveConversation.mockResolvedValue({ ...target, conversation: { ...target.conversation, project: 'p'.repeat(256), name: 'n'.repeat(256) } })
    await h.service.save(h.input())
    expect(repository.load().tasks[0].targetLabel).toHaveLength(512)
    expect(h.service.get().storageError).toBeNull()
  })

  it('restores an uncertain accepted run without replaying it or allowing automatic overlap', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'pipilot-scheduled-'))
    directories.push(directory)
    const repository = new ScheduledTaskRepository(join(directory, 'ledger.json'))
    const first = harness(repository)
    await first.service.save(first.input({ schedule: { kind: 'interval', startsAt: NOW, minutes: 1 } }))
    await flush()
    expect(repository.load().runs[0].status).toBe('accepted')
    await first.service.dispose()
    const second = harness(repository)
    second.now(NOW + 5 * 60_000)
    second.service.tick()
    expect(second.control.sendPrompt).not.toHaveBeenCalled()
    expect(second.service.get().tasks[0].enabled).toBe(false)
    expect(repository.load().runs[0]).toMatchObject({ status: 'interrupted', errorCode: 'outcome_unknown' })
  })

  it('recovers a crash after reservation but before any receipt as unknown, never as a failed safe-to-retry send', async () => {
    const h = harness()
    h.control.sendPrompt.mockImplementation(() => new Promise(() => {}))
    await h.service.save(h.input({ schedule: { kind: 'once', at: NOW } }))
    expect(h.memory.load().runs[0].status).toBe('dispatching')
    await h.service.dispose()
    const next = harness(h.memory)
    expect(next.service.get().runs[0].status).toBe('interrupted')
    next.service.tick()
    next.service.setEnabled(next.service.get().tasks[0].id, true)
    expect(next.control.sendPrompt).not.toHaveBeenCalled()
  })

  it('does not submit when the reservation cannot be persisted', async () => {
    const h = harness()
    await h.service.save(h.input())
    const save = vi.spyOn(h.memory, 'save').mockImplementation(() => { throw new Error('disk full') })
    h.now(NOW + 60_000)
    h.service.tick()
    expect(h.control.sendPrompt).not.toHaveBeenCalled()
    expect(h.service.get().storageError).toBeTruthy()
    save.mockRestore()
    h.service.tick()
    expect(h.control.sendPrompt).not.toHaveBeenCalled()
  })

  it('pauses with an unknown outcome if the accepted operation receipt cannot be inspected', async () => {
    const h = harness()
    vi.spyOn(h.control, 'getOperation').mockImplementation(() => { throw new Error('Operation registry unavailable') })
    await h.service.save(h.input({ schedule: { kind: 'interval', startsAt: NOW, minutes: 1 } }))
    await flush()
    expect(h.service.get().runs[0]).toMatchObject({ status: 'interrupted', errorCode: 'outcome_unknown' })
    expect(h.service.get().tasks[0].enabled).toBe(false)
    h.now(NOW + 300_000); h.service.tick()
    expect(h.control.sendPrompt).toHaveBeenCalledTimes(1)
  })

  it('keeps corrupt ledgers intact and disables all mutations', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'pipilot-scheduled-'))
    directories.push(directory)
    const file = join(directory, 'ledger.json')
    writeFileSync(file, '{broken')
    const h = harness(new ScheduledTaskRepository(file))
    expect(h.service.get().storageError).toBeTruthy()
    await expect(h.service.save(h.input())).rejects.toMatchObject({ code: 'SCHEDULE_STORAGE_FAILED' })
    expect(readFileSync(file, 'utf8')).toBe('{broken')
    expect(h.control.sendPrompt).not.toHaveBeenCalled()
  })

  it('collapses many missed interval occurrences into one catch-up and advances the cursor', async () => {
    const h = harness()
    await h.service.save(h.input({ schedule: { kind: 'interval', startsAt: NOW - 60 * 60_000, minutes: 1 } }))
    await flush()
    h.service.tick(); h.service.tick()
    expect(h.control.sendPrompt).toHaveBeenCalledTimes(1)
    expect(h.service.get().tasks[0].nextRunAt).toBe(NOW + 60_000)
  })

  it('records deliberately skipped missed occurrences without sending', async () => {
    const h = harness()
    await h.service.save(h.input({ schedule: { kind: 'once', at: NOW - 120_000 }, missedPolicy: 'skip' }))
    expect(h.control.sendPrompt).not.toHaveBeenCalled()
    expect(h.service.get().runs[0]).toMatchObject({ status: 'skipped', errorCode: 'missed_schedule' })
    expect(h.service.get().tasks[0].nextRunAt).toBeNull()
  })

  it('rejects concurrent manual runs and editing/deletion, while allowing pause during a run', async () => {
    const h = harness()
    await h.service.save(h.input({ schedule: { kind: 'interval', startsAt: NOW, minutes: 1 } }))
    await flush()
    const task = h.service.get().tasks[0]
    expect(() => h.service.runNow(task.id)).toThrow('already has a run')
    expect(() => h.service.remove(task.id)).toThrow('current run')
    await expect(h.service.save(h.input({ id: task.id }))).rejects.toMatchObject({ code: 'SCHEDULE_BUSY' })
    h.now(NOW + 60_000)
    h.service.tick()
    expect(h.service.get().runs[1]).toMatchObject({ status: 'skipped', errorCode: 'previous_run_active' })
    h.service.setEnabled(task.id, false)
    expect(h.service.get().runs[0].status).toBe('accepted')
    expect(h.control.sendPrompt).toHaveBeenCalledTimes(1)
  })

  it('runs a paused task manually without consuming its future scheduled occurrence', async () => {
    const h = harness()
    await h.service.save(h.input({ enabled: false }))
    const task = h.service.get().tasks[0]
    h.service.runNow(task.id)
    await flush()
    expect(h.service.get().tasks[0]).toMatchObject({ enabled: false, nextRunAt: NOW + 60_000 })
    expect(h.service.get().runs[0].trigger).toBe('manual')
  })

  it.each(['once', 'interval'] as const)('does not replay an already consumed %s occurrence when editing its name or prompt', async (kind) => {
    const h = harness()
    const schedule = kind === 'once' ? { kind, at: NOW } as const : { kind, startsAt: NOW, minutes: 5 } as const
    await h.service.save(h.input({ schedule }))
    await flush(); h.emit({ status: 'completed' })
    const task = h.service.get().tasks[0]
    await h.service.save(h.input({ id: task.id, schedule, name: 'Renamed', prompt: 'Updated future prompt' }))
    await flush()
    expect(h.control.sendPrompt).toHaveBeenCalledTimes(1)
    expect(h.service.get().tasks[0].nextRunAt).toBe(task.nextRunAt)
  })

  it.each(['interaction_required', 'conversation_not_found', 'conversation_unavailable'] as const)('pauses on %s instead of repeatedly sending', async (code) => {
    const h = harness()
    h.control.sendPrompt.mockRejectedValue(new ExternalControlError(code, 'Needs attention'))
    await h.service.save(h.input({ schedule: { kind: 'interval', startsAt: NOW, minutes: 1 } }))
    await flush()
    expect(h.service.get().tasks[0].enabled).toBe(false)
    expect(h.service.get().runs[0]).toMatchObject({ status: 'failed', errorCode: code })
    h.now(NOW + 600_000); h.service.tick()
    expect(h.control.sendPrompt).toHaveBeenCalledTimes(1)
  })

  it('pauses on interactive input after acceptance and retains the error reason', async () => {
    const h = harness()
    await h.service.save(h.input({ schedule: { kind: 'once', at: NOW } }))
    await flush()
    h.emit({ status: 'failed', error: { code: 'interaction_required', message: 'Confirmation was cancelled.' } })
    expect(h.service.get().tasks[0].enabled).toBe(false)
    expect(h.service.get().runs[0].error).toBe('Confirmation was cancelled.')
    expect(h.notify).toHaveBeenCalledOnce()
  })

  it('aborts still-preparing sends before updater suspension and stops scheduling', async () => {
    const h = harness()
    await h.service.save(h.input({ schedule: { kind: 'once', at: NOW } }))
    await flush()
    const signal = h.control.sendPrompt.mock.calls[0][1]!.signal!
    h.service.suspend()
    expect(signal.aborted).toBe(true)
    expect(() => h.service.runNow(h.service.get().tasks[0].id)).toThrow('shutting down')
  })

  it('retains bounded history across deletion without dropping an active reservation', async () => {
    // Exercise the real 500-entry retention boundary. Cloning and validating
    // all 505 dispatches can exceed Vitest's default 5s on Windows runners.
    const h = harness()
    await h.service.save(h.input({ enabled: false }))
    const task = h.service.get().tasks[0]
    for (let index = 0; index < 505; index += 1) {
      h.service.runNow(task.id); await flush(); h.emit({ status: 'completed' })
    }
    h.service.remove(task.id)
    expect(h.service.get().tasks).toHaveLength(0)
    expect(h.service.get().runs).toHaveLength(500)
    expect(h.service.get().runs.every((run) => run.taskName === task.name)).toBe(true)
  }, 20_000)
})

describe('schedule clock rules', () => {
  it('preserves interval cadence and never schedules in the past', () => {
    expect(nextScheduledAt({ kind: 'interval', startsAt: 1_000, minutes: 5 }, 900)).toBe(1_000)
    expect(nextScheduledAt({ kind: 'interval', startsAt: 1_000, minutes: 5 }, 901_000)).toBe(1_201_000)
    expect(nextScheduledAt({ kind: 'once', at: 1_000 }, 1_000)).toBeNull()
  })
  it('skips nonexistent daily wall times at the spring DST transition', () => {
    expect(nextScheduledAt({ kind: 'daily', hour: 2, minute: 30, timeZone: 'America/New_York' }, Date.parse('2026-03-08T05:00:00Z'))).toBe(Date.parse('2026-03-09T06:30:00Z'))
  })
  it('runs ambiguous daily wall times once, including restarting between the repeated times', () => {
    const schedule = { kind: 'daily', hour: 1, minute: 30, timeZone: 'America/New_York' } as const
    expect(nextScheduledAt(schedule, Date.parse('2026-11-01T04:00:00Z'))).toBe(Date.parse('2026-11-01T05:30:00Z'))
    expect(nextScheduledAt(schedule, Date.parse('2026-11-01T05:40:00Z'))).toBe(Date.parse('2026-11-02T06:30:00Z'))
  })
  it('handles fractional time zone offsets and date rollover', () => {
    expect(nextScheduledAt({ kind: 'daily', hour: 0, minute: 5, timeZone: 'Asia/Kathmandu' }, Date.parse('2026-09-29T18:30:00Z'))).toBe(Date.parse('2026-09-30T18:20:00Z'))
  })
  it('skips a date removed by an international date-line transition', () => {
    expect(nextScheduledAt({ kind: 'daily', hour: 9, minute: 0, timeZone: 'Pacific/Apia' }, Date.parse('2011-12-29T19:01:00Z'))).toBe(Date.parse('2011-12-30T19:00:00Z'))
  })
})

describe('scheduled task IPC boundary', () => {
  it('rejects an untrusted sender before running a task', async () => {
    const run = vi.fn()
    const handler = createValidatedInvokeHandler(scheduledTasksRunContract, () => false, run)
    const result = await handler({} as IpcMainInvokeEvent, { context: { requestId: randomUUID() }, id: randomUUID() })
    expect(result).toMatchObject({ ok: false, error: { code: 'IPC_UNTRUSTED_SENDER' } })
    expect(run).not.toHaveBeenCalled()
  })
  it('rejects arbitrary paths, unknown schedule kinds and invalid time zones', () => {
    const h = harness()
    const request = { context: { requestId: randomUUID() }, task: h.input() }
    expect(scheduledTasksSaveContract.requestSchema.safeParse({ ...request, task: { ...request.task, sessionFile: '/arbitrary/path' } }).success).toBe(false)
    expect(scheduledTasksSaveContract.requestSchema.safeParse({ ...request, task: { ...request.task, schedule: { kind: 'cron', command: 'anything' } } }).success).toBe(false)
    expect(scheduledTasksSaveContract.requestSchema.safeParse({ ...request, task: { ...request.task, schedule: { kind: 'daily', hour: 10, minute: 0, timeZone: 'not/a-zone' } } }).success).toBe(false)
  })
})
