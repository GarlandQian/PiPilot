import type { AgentSession } from '@earendil-works/pi-coding-agent'
import { classifyConversationError } from '../../shared/conversation-errors'

type RetrySettings = ReturnType<AgentSession['settingsManager']['getRetrySettings']>
interface RuntimeRetryPolicy {
  suppressed: boolean
  desired: RetrySettings
}
const policies = new WeakMap<AgentSession, RuntimeRetryPolicy>()

export function getRuntimeRetrySettings(session: AgentSession): RetrySettings {
  const policy = policies.get(session)
  return policy?.suppressed ? { ...policy.desired } : session.settingsManager.getRetrySettings()
}

/** A live settings edit also updates the value restored after a permanent failure. */
export function applyRuntimeRetrySettings(session: AgentSession, settings: RetrySettings): void {
  const policy = policies.get(session)
  if (policy) policy.desired = { ...settings }
  session.settingsManager.applyOverrides({ retry: {
    ...settings,
    ...(policy?.suppressed ? { enabled: false } : {}),
  } })
}

/**
 * Pi 1.1 classifies retries with unanchored text patterns: a permanent HTTP 400
 * can match "500" in a parameter, or a 401 can match a URL's :5000 port. Keep
 * the original failure intact and gate its automatic retry through public
 * session/settings APIs. This override lasts only until settlement/the next
 * agent run; it is never persisted and is not reported as a user preference.
 */
export function installRuntimeRetryPolicy(session: AgentSession): () => void {
  const policy: RuntimeRetryPolicy = { suppressed: false, desired: session.settingsManager.getRetrySettings() }
  policies.set(session, policy)
  const restore = () => {
    if (!policy.suppressed) return
    policy.suppressed = false
    session.settingsManager.applyOverrides({ retry: policy.desired })
  }
  const unsubscribe = session.subscribe((event) => {
    if (event.type === 'agent_start' || event.type === 'agent_settled') {
      restore()
    } else if (event.type === 'message_end' && event.message.role === 'assistant' &&
        event.message.stopReason === 'error' &&
        ['authentication', 'configuration', 'cancelled'].includes(classifyConversationError(event.message.errorMessage).category)) {
      if (!policy.suppressed) policy.desired = session.settingsManager.getRetrySettings()
      policy.suppressed = true
      session.settingsManager.applyOverrides({ retry: { enabled: false } })
    }
  })
  return () => {
    unsubscribe()
    restore()
    if (policies.get(session) === policy) policies.delete(session)
  }
}
