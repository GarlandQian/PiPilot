import { describe, expect, it } from 'vitest'
import { reconcileConfigApplyObservation } from '../../src/components/settings/useConfigApplyStatus'
import type { ConfigApplyStatus } from '../../src/shared/config-apply'

const fingerprint = 'a'.repeat(64)
const pending: ConfigApplyStatus = { fingerprint, state: 'pending', total: 2, applied: 0, failed: 0 }

describe('configuration apply presentation', () => {
  it('accepts progress only for the saved fingerprint', () => {
    const applied: ConfigApplyStatus = { ...pending, state: 'applied', applied: 2 }
    expect(reconcileConfigApplyObservation(fingerprint, pending, { fingerprint, applyStatus: applied }))
      .toBe(applied)
  })

  it('reports an externally superseded document without replacing its draft baseline', () => {
    const next = reconcileConfigApplyObservation(fingerprint, pending, { fingerprint: 'b'.repeat(64) })
    expect(next).toEqual({ ...pending, state: 'superseded' })
    expect(pending.state).toBe('pending')
  })

  it('does not borrow another saved revision or invent completion without metadata', () => {
    expect(reconcileConfigApplyObservation(fingerprint, pending, { fingerprint })).toBe(pending)
    expect(reconcileConfigApplyObservation(fingerprint, pending, {
      fingerprint,
      applyStatus: { ...pending, fingerprint: 'b'.repeat(64), state: 'applied' },
    })).toBe(pending)
  })
})
