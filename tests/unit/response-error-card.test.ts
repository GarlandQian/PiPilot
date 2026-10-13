import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ResponseErrorCard } from '../../src/components/chat/ResponseErrorCard'
import { classifyConversationError } from '../../src/shared/conversation-errors'
import { latestResponseFailureId, projectResponsePresentation } from '../../src/renderer/pi-rpc/response-presentation'
import type { Turn } from '../../src/types/chat'

vi.mock('@/i18n', () => ({
  useT: () => (key: string, params?: Record<string, string | number>) => `${key}${params ? ` ${JSON.stringify(params)}` : ''}`,
}))

const failed: Extract<Turn, { kind: 'response-error' }> = {
  kind: 'response-error', id: 'failed-response', timestamp: 2, provider: 'fixture', model: 'fixture-model', state: 'error',
  error: classifyConversationError("400: role 'developer' is not allowed"),
}

describe('provider response error card', () => {
  it('shows a useful cause and recovery actions with raw diagnostics collapsed', () => {
    const markup = renderToStaticMarkup(createElement(ResponseErrorCard, {
      turn: failed, sessionKey: 'session-a', current: true, disabled: false,
      onRetry: async () => {}, onConfigureModel: () => {},
    }))
    expect(markup).toContain('chat.failure.summary.configuration')
    expect(markup).toContain('chat.failure.noRetry.configuration')
    expect(markup).toContain('fixture / fixture-model')
    expect(markup).toContain('chat.failure.retryResponse')
    expect(markup).toContain('chat.failure.configure')
    expect(markup).toContain('aria-expanded="false"')
    expect(markup).not.toContain("role &#x27;developer&#x27;")
    expect(markup).not.toContain('[Empty assistant message]')
  })

  it('retains a disabled retry action for historical failures and does not assign current retry activity to them', () => {
    const markup = renderToStaticMarkup(createElement(ResponseErrorCard, {
      turn: { ...failed, error: classifyConversationError('503 service unavailable') },
      sessionKey: 'session-a', current: false, disabled: false, onRetry: async () => {},
      retryActivity: { kind: 'provider', phase: 'waiting', attempt: 1, maxAttempts: 3, deadline: 5_000, reason: 'temporary', cancelling: false },
    }))
    expect(markup).toContain('chat.failure.historical')
    expect(markup).toContain('disabled=""')
    expect(markup).not.toContain('retry.attempt')
  })

  it('shows whether automatic retry was disabled or exhausted for the current failure', () => {
    const props = { turn: { ...failed, error: classifyConversationError('503 service unavailable') }, sessionKey: 'session-a', current: true, disabled: false }
    const disabled = renderToStaticMarkup(createElement(ResponseErrorCard, { ...props, retryPolicy: { enabled: false, maxRetries: 3 } }))
    expect(disabled).toContain('chat.failure.retryDisabled')
    const exhausted = renderToStaticMarkup(createElement(ResponseErrorCard, { ...props, retryActivity: { kind: 'provider-result', success: false, attempt: 3, message: '503', settledAt: 4 } }))
    expect(exhausted).toContain('chat.failure.retryEnded')
    expect(exhausted).toContain('&quot;count&quot;:3')
  })

  it('only offers Stop while the official retry countdown is cancellable', () => {
    const props = { turn: failed, sessionKey: 'session-a', current: true, disabled: false, onStopRetry: async () => {} }
    const waiting = { kind: 'provider' as const, phase: 'waiting' as const, attempt: 1, maxAttempts: 3, deadline: Date.now() + 60_000, reason: '503', cancelling: false }
    expect(renderToStaticMarkup(createElement(ResponseErrorCard, { ...props, retryActivity: waiting }))).toContain('chat.failure.stopRetry')
    for (const activity of [{ ...waiting, deadline: Date.now() - 1 }, { ...waiting, phase: 'retrying' as const }, { ...waiting, cancelling: true }]) {
      const markup = renderToStaticMarkup(createElement(ResponseErrorCard, { ...props, retryActivity: activity }))
      expect(markup).not.toContain('chat.failure.stopRetry')
    }
  })

  it('prefers actual SDK retry events over an unfamiliar provider diagnostic', () => {
    const props = { turn: { ...failed, error: classifyConversationError('please retry your request') }, sessionKey: 'session-a', current: true, disabled: false }
    const waiting = renderToStaticMarkup(createElement(ResponseErrorCard, { ...props,
      retryActivity: { kind: 'provider', phase: 'waiting', attempt: 1, maxAttempts: 3, deadline: Date.now() + 10_000, reason: 'please retry your request', cancelling: false },
    }))
    expect(waiting).toContain('chat.failure.retryInProgress')
    expect(waiting).not.toContain('chat.failure.noRetry.unknown')
    const exhausted = renderToStaticMarkup(createElement(ResponseErrorCard, { ...props,
      retryActivity: { kind: 'provider-result', success: false, attempt: 3, message: 'please retry your request', settledAt: 4 },
    }))
    expect(exhausted).toContain('chat.failure.retryEnded')
  })

  it('retains the latest failure through synthetic surfaces but rejects subsequent conversation content', () => {
    const synthetic: Turn[] = [
      { kind: 'plan', id: 'plan-state', markdown: 'Plan still exists', lifecycle: 'implementing', actions: [] },
      { kind: 'notice', id: 'compacted', notice: 'compacted' },
      { kind: 'activity', id: 'retry', activity: { kind: 'retry', id: 'retry', retryKind: 'provider', phase: 'error', state: 'settled' } },
    ]
    expect(latestResponseFailureId([failed, ...synthetic])).toBe(failed.id)
    const followups: Turn[] = [
      { kind: 'user', id: 'next-user', text: 'A new request', time: '' },
      { kind: 'agent', id: 'next-agent', markdown: 'A newer answer', state: 'complete' },
      { kind: 'thinking', id: 'next-thinking', text: 'A new attempt has started', state: 'streaming' },
      { kind: 'tool', id: 'next-tool', call: { id: 'next-tool', kind: 'shell', title: 'bash', body: 'pwd', status: 'running' } },
      { ...failed, id: 'later-abort', state: 'aborted' },
      { kind: 'notice', id: 'later-empty-abort', notice: 'response-aborted' },
    ]
    for (const next of followups) expect(latestResponseFailureId([failed, ...synthetic, next])).toBeNull()
  })

  it('keeps provider failure in its own persistent segment after partial content and completed tools', () => {
    const response = projectResponsePresentation({ id: 'response', turns: [
      { kind: 'agent', id: 'partial', markdown: 'Partial content', state: 'error' },
      failed,
    ] }, { active: false, status: 'idle' })
    expect(response.status).toBe('failed')
    expect(response.segments).toEqual([
      expect.objectContaining({ region: 'answer', turn: expect.objectContaining({ kind: 'agent' }) }),
      expect.objectContaining({ region: 'persistent', turn: failed }),
    ])
    const aborted = projectResponsePresentation({ id: 'aborted', turns: [{ ...failed, state: 'aborted' }] }, { active: false, status: 'idle' })
    expect(aborted.status).toBe('cancelled')
  })
})
