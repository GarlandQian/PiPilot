import { describe, expect, it, vi } from 'vitest'
import type { ExternalControlOperation } from '../../src/shared/external-control'
import type { ScheduledRun } from '../../src/shared/scheduled-tasks'
import { createScheduledFailureNotifier } from '../../src/main/scheduled-tasks/notifications'

const run: ScheduledRun = {
  id: '00000000-0000-4000-8000-000000000001', taskId: '00000000-0000-4000-8000-000000000002',
  taskName: 'Scheduled review', conversationId: `conv_${'c'.repeat(43)}`, scheduledAt: 0, startedAt: 0,
  trigger: 'scheduled', status: 'failed',
}
const operation: ExternalControlOperation = {
  operationId: `op_${'a'.repeat(32)}`, conversationId: run.conversationId, kind: 'send_prompt', status: 'failed',
  receivedAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:01Z',
}

function harness(patch: Partial<ExternalControlOperation> = {}) {
  const getOperation = vi.fn(() => ({ operation: { ...operation, ...patch } }))
  const reportScheduledPreflightFailure = vi.fn()
  return { getOperation, reportScheduledPreflightFailure,
    notify: createScheduledFailureNotifier({ getOperation }, { reportScheduledPreflightFailure }),
  }
}

describe('scheduled failure notifications', () => {
  it('keeps a failed dispatch bound to its ledger run and original unavailable conversation', () => {
    const h = harness()
    h.notify(run)
    expect(h.getOperation).not.toHaveBeenCalled()
    expect(h.reportScheduledPreflightFailure).toHaveBeenCalledExactlyOnceWith({ runId: run.id, conversationId: run.conversationId })
  })

  it('reports a matching operation that failed before Pi accepted it', () => {
    const h = harness()
    h.notify({ ...run, operationId: operation.operationId })
    expect(h.getOperation).toHaveBeenCalledExactlyOnceWith({ operationId: operation.operationId })
    expect(h.reportScheduledPreflightFailure).toHaveBeenCalledExactlyOnceWith({ runId: run.id, conversationId: run.conversationId })
  })

  it.each<Partial<ExternalControlOperation>>([
    { acceptedAt: '2026-10-01T00:00:00Z' },
    { operationId: `op_${'b'.repeat(32)}` },
    { conversationId: `conv_${'d'.repeat(43)}` },
    { kind: 'abort_conversation' },
    { status: 'accepted' },
    { status: 'completed' },
  ])('never duplicates an accepted Runtime outcome or retargets a mismatched operation: %j', (patch) => {
    const h = harness(patch)
    h.notify({ ...run, operationId: operation.operationId })
    expect(h.reportScheduledPreflightFailure).not.toHaveBeenCalled()
  })

  it('does not guess an outcome when the authoritative operation is unavailable', () => {
    const h = harness()
    h.getOperation.mockImplementationOnce(() => { throw new Error('operation evicted') })
    expect(() => h.notify({ ...run, operationId: operation.operationId })).not.toThrow()
    expect(h.reportScheduledPreflightFailure).not.toHaveBeenCalled()
  })

  it.each<ScheduledRun['status']>(['dispatching', 'starting', 'accepting', 'accepted', 'completed', 'aborted', 'runtime_replaced', 'interrupted', 'skipped'])(
    'leaves %s to the authoritative Runtime observer without fallback', (status) => {
      const h = harness()
      h.notify({ ...run, status })
      expect(h.getOperation).not.toHaveBeenCalled()
      expect(h.reportScheduledPreflightFailure).not.toHaveBeenCalled()
    },
  )
})
