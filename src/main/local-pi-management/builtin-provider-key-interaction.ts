import type { ModelRuntime } from '@earendil-works/pi-coding-agent'

type KeyLoginInteraction = Parameters<ModelRuntime['login']>[2]

// Pi asks these providers to choose a credential kind before the secret.
// Keep this keyed by provider and option IDs; display text is not an auth contract.
const KEY_AUTH_METHODS = new Map([
  ['google-vertex', 'api-key'],
  ['amazon-bedrock', 'bearer-token'],
])

/** Respond only to the API-key steps supported by the GUI's single-key form. */
export function createBuiltinProviderKeyInteraction(
  provider: { id: string; name: string },
  key: string,
): KeyLoginInteraction {
  const method = KEY_AUTH_METHODS.get(provider.id)
  let step: 'method' | 'key' | 'done' | 'failed' = method ? 'method' : 'key'
  const unsupported = (): never => {
    step = 'failed'
    throw new Error(`${provider.name} needs more than an API key; set it up with the Pi CLI.`)
  }

  return {
    prompt: async (prompt) => {
      prompt.signal?.throwIfAborted()
      if (step === 'method' && prompt.type === 'select' && method
        && prompt.options.filter((option) => option.id === method).length === 1) {
        step = 'key'
        return method
      }
      if (step === 'key' && prompt.type === 'secret') {
        step = 'done'
        return key
      }
      // Text can mean an account, project, profile, or a credentials file path.
      // Never send the submitted secret to one of those fields or to OAuth.
      return unsupported()
    },
    notify: (event) => {
      if (event.type === 'auth_url' || event.type === 'device_code') unsupported()
    },
  }
}
