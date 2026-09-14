import { describe, expect, it } from 'vitest'
import { PiConversationLifecycle, type PiHydrationSnapshot } from '../../src/renderer/pi-rpc/conversation-lifecycle'

const a: PiHydrationSnapshot = { scopeKey: 'project:a', generation: 7, sessionId: 'a', status: 'loading', error: null }
const b: PiHydrationSnapshot = { ...a, scopeKey: 'project:b', sessionId: 'b' }

describe('conversation visit lifecycle', () => {
  it('rejects ready and error callbacks from an earlier A visit after A → B → A', () => {
    const owner = new PiConversationLifecycle(a)
    const first = owner.begin('full', a)
    const revision = owner.ownerRevision.current
    owner.reset(b)
    owner.reset(a)
    expect(owner.ownerRevision.current).toBeGreaterThan(revision)
    expect(owner.finish(first, a)).toBeNull()
    expect(owner.finish(first, a, 'late failure')).toBeNull()
    expect(owner.hydration.status).toBe('loading')
    const current = owner.begin('full', a)
    expect(owner.finish(current, a)?.status).toBe('ready')
  })

  it('supersedes only the matching refresh channel and invalidates both on reset', () => {
    const owner = new PiConversationLifecycle(a)
    const first = owner.begin('full', a)
    const history = owner.begin('conversation', a)
    const second = owner.begin('full', a)
    expect(owner.isCurrent(first, a)).toBe(false)
    expect(owner.isCurrent(history, a)).toBe(true)
    expect(owner.finish(second, a, 'connection lost')?.status).toBe('error')
    expect(owner.finish(owner.begin('full', a), a)?.status).toBe('ready')
    owner.reset({ ...a, generation: 8 })
    expect(owner.isCurrent(history, a)).toBe(false)
    expect(owner.isCurrent(second, a)).toBe(false)
  })

  it('requires the actual current scope, generation, and session before committing hydration', () => {
    const owner = new PiConversationLifecycle(a)
    const ticket = owner.begin('full', a)
    for (const observed of [null, b, { ...a, generation: 8 }, { ...a, sessionId: 'replacement' }]) {
      expect(owner.isCurrent(ticket, observed)).toBe(false)
    }
    owner.invalidate()
    expect(owner.finish(ticket, a)).toBeNull()
    expect(owner.hydration).toBe(a)
  })
})
