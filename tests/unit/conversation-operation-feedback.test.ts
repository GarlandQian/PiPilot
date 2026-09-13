import { describe, expect, it, vi } from 'vitest'
import {
  conversationOperationError,
  createConversationOperationFeedback,
  runConversationOperation,
} from '../../src/renderer/composer/operation-feedback'

describe('conversation operation feedback', () => {
  it.each(['resolve', 'reject'])(
    'ignores a delayed %s without closing, clearing, or disabling a newer visit', async (outcome) => {
      const a = createConversationOperationFeedback('A')
      let current = a
      let resolveDelayed!: () => void
      let rejectDelayed!: (error: Error) => void
      const delayed = new Promise<void>((resolve, reject) => {
        resolveDelayed = resolve
        rejectDelayed = reject
      })
      const closeOrClear = vi.fn()
      const first = runConversationOperation(a, () => current === a, 'model', async (isCurrent) => {
        await delayed
        if (isCurrent()) closeOrClear()
      }, 'failed')
      current = createConversationOperationFeedback('B')
      current = createConversationOperationFeedback('A')
      const nextToken = current.begin('model')!
      if (outcome === 'resolve') resolveDelayed()
      else rejectDelayed(new Error('old failure'))

      expect(await first).toBe(false)
      expect(closeOrClear).not.toHaveBeenCalled()
      expect(current.getSnapshot()).toEqual({ pending: nextToken, error: null })
    },
  )

  it('does not dispatch a callback retained by a replaced component', async () => {
    const owner = createConversationOperationFeedback('A')
    const operation = vi.fn()
    expect(await runConversationOperation(owner, () => false, 'submit', operation, 'failed')).toBe(false)
    expect(operation).not.toHaveBeenCalled()
  })

  it.each(['submit', 'stop', 'model', 'thinking', 'queue', 'compact', 'auto-compaction'])(
    'isolates delayed %s feedback from B and a later A visit', async (action) => {
      const firstA = createConversationOperationFeedback('A')
      const first = firstA.begin(action)!
      const finishOld = Promise.resolve().then(() => firstA.finish(first, 'old failure'))
      firstA.invalidate()
      const b = createConversationOperationFeedback('B')
      const nextA = createConversationOperationFeedback('A')
      const next = nextA.begin(action)!

      expect(await finishOld).toBe(false)
      expect(b.getSnapshot()).toEqual({ pending: null, error: null })
      expect(nextA.getSnapshot()).toEqual({ pending: next, error: null })
      expect(nextA.finish(first, 'old failure')).toBe(false)
      expect(nextA.finish(next)).toBe(true)
    },
  )

  it('rejects duplicate dispatch synchronously and stale same-owner cleanup', () => {
    const feedback = createConversationOperationFeedback('A')
    const first = feedback.begin('queue')!
    expect(feedback.begin('queue')).toBeNull()
    expect(feedback.finish(first, 'failed')).toBe(true)
    const second = feedback.begin('queue')!
    expect(feedback.getSnapshot().error).toBeNull()
    expect(feedback.finish(first, 'stale')).toBe(false)
    expect(feedback.getSnapshot().pending).toBe(second)
    expect(feedback.isCurrent(first)).toBe(false)
    expect(feedback.isCurrent(second)).toBe(true)
  })

  it('keeps errors local to the originating action owner', () => {
    const model = createConversationOperationFeedback('A')
    const queue = createConversationOperationFeedback('A')
    model.finish(model.begin('model')!, 'model failed')
    queue.finish(queue.begin('remove')!)
    expect(model.getSnapshot().error).toBe('model failed')
    expect(queue.getSnapshot().error).toBeNull()
    model.clearError()
    expect(model.getSnapshot().error).toBeNull()
  })

  it('notifies only subscribed listeners and invalidates unmounted owners', () => {
    const feedback = createConversationOperationFeedback('A')
    const listener = vi.fn()
    const unsubscribe = feedback.subscribe(listener)
    const token = feedback.begin('stop')!
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
    feedback.invalidate()
    expect(feedback.finish(token, 'late')).toBe(false)
    expect(feedback.begin('stop')).toBeNull()
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('bounds error details without inventing an error value', () => {
    expect(conversationOperationError(new Error('a'.repeat(4096)), 'failed')).toHaveLength(2048)
    expect(conversationOperationError(null, 'failed')).toBe('failed')
    expect(conversationOperationError(new Error(''), 'failed')).toBe('failed')
  })
})
