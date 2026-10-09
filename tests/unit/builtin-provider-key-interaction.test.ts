import { describe, expect, it } from 'vitest'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { createBuiltinProviderKeyInteraction } from '../../src/main/local-pi-management/builtin-provider-key-interaction'

const fixtureKey = 'fixture-api-key'
const secretPrompt = { type: 'secret' as const, message: 'Enter API key' }

const methodCases = [
  {
    provider: { id: 'google-vertex', name: 'Google Vertex AI' },
    method: 'api-key',
    alternatives: ['adc', 'service-account'],
  },
  {
    provider: { id: 'amazon-bedrock', name: 'Amazon Bedrock' },
    method: 'bearer-token',
    alternatives: ['aws-profile', 'credential-chain'],
  },
]

describe('GUI built-in provider API-key interaction', () => {
  it.each(['anthropic', 'openai', 'google-vertex', 'amazon-bedrock', 'azure'])(
    'matches the installed SDK API-key login steps for %s without accessing credentials',
    async (providerId) => {
      const forbiddenStorage = async (): Promise<never> => { throw new Error('Unexpected credential storage access') }
      const runtime = await ModelRuntime.create({
        modelsPath: null,
        allowModelNetwork: false,
        refreshOnCreate: false,
        credentials: {
          read: forbiddenStorage, list: forbiddenStorage,
          modify: forbiddenStorage, delete: forbiddenStorage,
        },
      })
      const provider = runtime.getProvider(providerId)
      expect(provider?.auth.apiKey?.login).toBeDefined()
      if (!provider?.auth.apiKey?.login) throw new Error('Missing SDK API-key login')
      const interaction = createBuiltinProviderKeyInteraction(provider, fixtureKey)
      await expect(provider.auth.apiKey.login({
        ...interaction, signal: new AbortController().signal,
      })).resolves.toMatchObject({ type: 'api_key', key: fixtureKey })
    },
  )

  it('answers one secret prompt for an ordinary API-key provider', async () => {
    const interaction = createBuiltinProviderKeyInteraction({ id: 'anthropic', name: 'Anthropic' }, fixtureKey)
    await expect(interaction.prompt(secretPrompt)).resolves.toBe(fixtureKey)
    await expect(interaction.prompt(secretPrompt)).rejects.toThrow('set it up with the Pi CLI')
  })

  it.each(methodCases)('selects the known key method for $provider.id before answering its secret prompt', async ({ provider, method, alternatives }) => {
    const interaction = createBuiltinProviderKeyInteraction(provider, fixtureKey)
    // Place the desired option last and use unrelated display text: only IDs matter.
    await expect(interaction.prompt({
      type: 'select',
      message: 'Choose authentication',
      options: [...alternatives, method].map((id) => ({ id, label: 'Localized option' })),
    })).resolves.toBe(method)
    await expect(interaction.prompt(secretPrompt)).resolves.toBe(fixtureKey)
    await expect(interaction.prompt(secretPrompt)).rejects.toThrow('set it up with the Pi CLI')
  })

  it.each(methodCases)('refuses a missing or ambiguous key method for $provider.id', async ({ provider, method, alternatives }) => {
    for (const ids of [alternatives, [method, method]]) {
      const interaction = createBuiltinProviderKeyInteraction(provider, fixtureKey)
      await expect(interaction.prompt({
        type: 'select',
        message: 'Choose authentication',
        options: ids.map((id) => ({ id, label: 'API key' })),
      })).rejects.toThrow('set it up with the Pi CLI')
      await expect(interaction.prompt(secretPrompt)).rejects.toThrow('set it up with the Pi CLI')
    }
  })

  it.each(methodCases)('refuses unexpected steps before and after the known method for $provider.id', async ({ provider, method }) => {
    const selection = { type: 'select' as const, message: 'Choose', options: [{ id: method, label: 'API key' }] }
    const before = createBuiltinProviderKeyInteraction(provider, fixtureKey)
    await expect(before.prompt(secretPrompt)).rejects.toThrow('set it up with the Pi CLI')

    const repeated = createBuiltinProviderKeyInteraction(provider, fixtureKey)
    await repeated.prompt(selection)
    await expect(repeated.prompt(selection)).rejects.toThrow('set it up with the Pi CLI')

    const text = createBuiltinProviderKeyInteraction(provider, fixtureKey)
    await text.prompt(selection)
    await expect(text.prompt({ type: 'text', message: 'Enter account or project' })).rejects.toThrow('set it up with the Pi CLI')
  })

  it('does not infer an auth selection for an unrelated provider, even with a known option ID', async () => {
    const interaction = createBuiltinProviderKeyInteraction({ id: 'other-provider', name: 'Other' }, fixtureKey)
    await expect(interaction.prompt({
      type: 'select',
      message: 'API key',
      options: [{ id: 'api-key', label: 'API key' }, { id: 'oauth', label: 'OAuth' }],
    })).rejects.toThrow('set it up with the Pi CLI')
  })

  it.each(['text', 'manual_code'] as const)('never submits the key to a %s prompt', async (type) => {
    const interaction = createBuiltinProviderKeyInteraction({ id: 'openai', name: 'OpenAI' }, fixtureKey)
    await expect(interaction.prompt({ type, message: 'Enter API key' })).rejects.toThrow('set it up with the Pi CLI')
  })

  it('refuses OAuth notifications without including the key in the error', async () => {
    for (const event of [
      { type: 'auth_url' as const, url: 'https://auth.example.test' },
      { type: 'device_code' as const, userCode: 'fixture-code', verificationUri: 'https://auth.example.test' },
    ]) {
      const interaction = createBuiltinProviderKeyInteraction({ id: 'openai', name: 'OpenAI' }, fixtureKey)
      expect(() => interaction.notify(event)).toThrow('set it up with the Pi CLI')
      await expect(interaction.prompt(secretPrompt)).rejects.not.toThrow(fixtureKey)
    }
  })

  it('honors prompt cancellation without supplying the key', async () => {
    const interaction = createBuiltinProviderKeyInteraction({ id: 'anthropic', name: 'Anthropic' }, fixtureKey)
    const controller = new AbortController()
    controller.abort(new Error('Cancelled fixture'))
    await expect(interaction.prompt({ ...secretPrompt, signal: controller.signal })).rejects.toThrow('Cancelled fixture')
  })
})
