import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LocalPiRpcEvent, LocalPiRpcEventMessage } from '../../src/shared/local-pi'
import {
  isRetryStopAllowed,
  projectRetryActivity,
} from '../../src/renderer/pi-rpc/adapters'
import {
  applyLocalPiProjectorEvent,
  createLocalPiProjectorState,
  replaceLocalPiProjectorSnapshot,
  setLocalPiRetryCancelling,
} from '../../src/renderer/pi-rpc/projector'

let sequence = 0

function apply(
  state: ReturnType<typeof createLocalPiProjectorState>,
  event: LocalPiRpcEvent,
  generation = 7,
) {
  const envelope: LocalPiRpcEventMessage = {
    eventId: `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`,
    generation,
    event,
  }
  return applyLocalPiProjectorEvent(state, envelope)
}

afterEach(() => {
  vi.useRealTimers()
})

describe('official Retry projection', () => {
  it('keeps official waiting cancellable without package status enrichment', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-10T00:00:00.000Z'))
    let state = createLocalPiProjectorState({ generation: 7, sessionId: 'session-a' })
    state = apply(state, {
      type: 'auto_retry_start',
      attempt: 2,
      maxAttempts: 4,
      delayMs: 2_000,
      errorMessage: 'Provider overloaded',
    })

    const activity = projectRetryActivity(state)
    expect(activity).toMatchObject({
      kind: 'provider',
      phase: 'waiting',
      attempt: 2,
      maxAttempts: 4,
      deadline: Date.now() + 2_000,
    })
    expect(isRetryStopAllowed(activity, Date.now() + 1_999)).toBe(true)
    expect(isRetryStopAllowed(activity, Date.now() + 2_000)).toBe(false)
  })

  it('projects official Retry without pi-retry and never synthesizes counters', () => {
    let state = createLocalPiProjectorState({ generation: 7, sessionId: 'session-a' })
    state = apply(state, {
      type: 'auto_retry_start',
      attempt: 1,
      maxAttempts: 3,
      delayMs: 0,
      errorMessage: 'Network error',
    })
    expect(projectRetryActivity(state)).toMatchObject({
      kind: 'provider',
      attempt: 1,
      maxAttempts: 3,
    })
    state = apply(state, {
      type: 'auto_retry_end',
      success: false,
      attempt: 3,
      finalError: 'Final error',
    })
    expect(projectRetryActivity(state)).toEqual({
      kind: 'provider-result',
      success: false,
      attempt: 3,
      message: 'Final error',
      settledAt: expect.any(Number),
    })
    expect(projectRetryActivity(state)).not.toHaveProperty('maxAttempts')
  })

  it('keeps cancelling until the official end event and retains state across same-session refresh', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-10T00:00:00.000Z'))
    let state = createLocalPiProjectorState({ generation: 7, sessionId: 'session-a' })
    state = apply(state, {
      type: 'auto_retry_start',
      attempt: 1,
      maxAttempts: 3,
      delayMs: 5_000,
      errorMessage: 'Overloaded',
    })
    state = setLocalPiRetryCancelling(state, true)
    expect(projectRetryActivity(state)).toMatchObject({
      kind: 'provider',
      cancelling: true,
    })
    state = replaceLocalPiProjectorSnapshot(state, {
      generation: 7,
      sessionId: 'session-a',
      messages: [],
      pendingMessageCount: 0,
      isStreaming: true,
      isCompacting: false,
      entrySnapshot: null,
    })
    expect(projectRetryActivity(state)).toMatchObject({
      kind: 'provider',
      cancelling: true,
    })
    state = apply(state, {
      type: 'auto_retry_end',
      success: false,
      attempt: 1,
      finalError: 'Retry cancelled',
    })
    expect(projectRetryActivity(state)).toMatchObject({
      kind: 'provider-result',
      success: false,
    })
  })

  it('clears on session replacement and ignores old-generation events', () => {
    let state = createLocalPiProjectorState({ generation: 7, sessionId: 'session-a' })
    state = apply(state, {
      type: 'auto_retry_start',
      attempt: 1,
      maxAttempts: 3,
      delayMs: 5_000,
      errorMessage: 'Overloaded',
    })
    state = replaceLocalPiProjectorSnapshot(state, {
      generation: 8,
      sessionId: 'session-b',
      messages: [],
      pendingMessageCount: 0,
      isStreaming: false,
      isCompacting: false,
      entrySnapshot: null,
    })
    expect(projectRetryActivity(state)).toEqual({ kind: 'idle' })
    state = apply(state, {
      type: 'auto_retry_start',
      attempt: 9,
      maxAttempts: 9,
      delayMs: 9_000,
      errorMessage: 'Late',
    }, 7)
    expect(projectRetryActivity(state)).toEqual({ kind: 'idle' })
  })

  it('keeps summarization Retry separate and never exposes Stop', () => {
    let state = createLocalPiProjectorState({ generation: 7, sessionId: 'session-a' })
    state = apply(state, {
      type: 'summarization_retry_scheduled',
      attempt: 1,
      maxAttempts: 3,
      delayMs: 500,
      errorMessage: 'Summary failed',
    })
    const activity = projectRetryActivity(state)
    expect(activity).toMatchObject({
      kind: 'summarization',
      phase: 'waiting',
      attempt: 1,
      maxAttempts: 3,
    })
    expect(isRetryStopAllowed(activity)).toBe(false)
  })
})
