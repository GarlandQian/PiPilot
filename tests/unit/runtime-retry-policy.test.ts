import { SettingsManager, type AgentSession, type AgentSessionEvent } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'
import { applyRuntimeRetrySettings, getRuntimeRetrySettings, installRuntimeRetryPolicy } from '../../src/main/pi-host/runtime-retry-policy'

describe('runtime retry policy lifecycle', () => {
  it('suppresses only the permanent attempt and restores settings edited while it settles', () => {
    const settingsManager = SettingsManager.inMemory({ retry: { enabled: true, maxRetries: 3 } })
    const listeners = new Set<(event: AgentSessionEvent) => void>()
    const session = {
      settingsManager,
      subscribe(listener: (event: AgentSessionEvent) => void) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    } as unknown as AgentSession
    const emit = (event: unknown) => { for (const listener of listeners) listener(event as AgentSessionEvent) }
    const release = installRuntimeRetryPolicy(session)
    const error = { role: 'assistant', stopReason: 'error', errorMessage: '400: max_tokens must not exceed 500' }
    emit({ type: 'message_end', message: error })
    expect(settingsManager.getRetrySettings().enabled).toBe(false)
    expect(getRuntimeRetrySettings(session)).toMatchObject({ enabled: true, maxRetries: 3 })
    expect(error.errorMessage).toBe('400: max_tokens must not exceed 500')
    applyRuntimeRetrySettings(session, { ...getRuntimeRetrySettings(session), enabled: true, maxRetries: 7 })
    expect(settingsManager.getRetrySettings().enabled).toBe(false)
    expect(getRuntimeRetrySettings(session)).toMatchObject({ enabled: true, maxRetries: 7 })
    emit({ type: 'agent_settled', aborted: false })
    expect(settingsManager.getRetrySettings()).toMatchObject({ enabled: true, maxRetries: 7 })
    emit({ type: 'message_end', message: { role: 'assistant', stopReason: 'error', errorMessage: '503: Service unavailable' } })
    expect(settingsManager.getRetrySettings().enabled).toBe(true)
    emit({ type: 'message_end', message: error })
    expect(settingsManager.getRetrySettings().enabled).toBe(false)
    release()
    expect(settingsManager.getRetrySettings()).toMatchObject({ enabled: true, maxRetries: 7 })
    expect(settingsManager.getGlobalSettings().retry).toEqual({ enabled: true, maxRetries: 3 })
    expect(listeners.size).toBe(0)
  })
})
