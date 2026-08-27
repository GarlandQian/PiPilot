import type { LocalPiProjectorState } from '../projector'

export type RetryActivityProjection =
  | { kind: 'idle' }
  | {
      kind: 'provider'
      phase: 'waiting' | 'retrying'
      attempt: number
      maxAttempts: number
      deadline: number | null
      reason: string
      cancelling: boolean
    }
  | {
      kind: 'provider-result'
      success: boolean
      attempt: number
      message: string | null
      settledAt: number
    }
  | {
      kind: 'summarization'
      phase: 'waiting' | 'attempting' | 'finished'
      attempt?: number
      maxAttempts?: number
      delayMs?: number
      reason?: string
    }

function boundedReason(value: string | undefined) {
  const reason = (value ?? '').trim()
  if (!reason) return 'Provider request failed.'
  return reason.length <= 1_000 ? reason : `${reason.slice(0, 1_000)}\n...`
}

export function projectRetryActivity(
  state: LocalPiProjectorState,
): RetryActivityProjection {
  const retry = state.retry
  if (retry.kind === 'auto' && retry.phase === 'waiting') {
    return {
      kind: 'provider',
      phase: 'waiting',
      attempt: retry.attempt,
      maxAttempts: retry.maxAttempts,
      deadline: state.retryTiming.deadline,
      reason: boundedReason(retry.errorMessage),
      cancelling: state.retryTiming.cancelling,
    }
  }
  if (retry.kind === 'auto' && retry.phase === 'finished') {
    return {
      kind: 'provider-result',
      success: retry.success,
      attempt: retry.attempt,
      message: retry.finalError ? boundedReason(retry.finalError) : null,
      settledAt: state.retryTiming.settledAt ?? 0,
    }
  }
  if (retry.kind === 'summarization') {
    if (retry.phase === 'waiting') {
      return {
        kind: 'summarization',
        phase: 'waiting',
        attempt: retry.attempt,
        maxAttempts: retry.maxAttempts,
        delayMs: retry.delayMs,
        reason: boundedReason(retry.errorMessage),
      }
    }
    if (retry.phase === 'attempting') {
      return {
        kind: 'summarization',
        phase: 'attempting',
        reason: retry.source === 'compaction' ? retry.reason ?? undefined : retry.source,
      }
    }
    return { kind: 'summarization', phase: 'finished' }
  }
  return { kind: 'idle' }
}

export function isRetryStopAllowed(activity: RetryActivityProjection, now = Date.now()) {
  return activity.kind === 'provider' &&
    activity.phase === 'waiting' &&
    !activity.cancelling &&
    activity.deadline !== null &&
    now < activity.deadline
}
