import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProviderLoginEvent } from '../../src/shared/provider-login'

type Interaction = { signal: AbortSignal; prompt(prompt: Record<string, unknown>): Promise<string>; notify(event: Record<string, unknown>): void }
const fake = vi.hoisted(() => ({ login: null as null | ((interaction: Interaction) => Promise<unknown>) }))

vi.mock('@earendil-works/pi-coding-agent', () => ({
  ModelRuntime: {
    create: async () => ({
      getProvider: (id: string) => id === 'anthropic' ? { id, name: 'Anthropic', auth: { oauth: { name: 'Anthropic (Claude Pro/Max)' } } } : { id, name: id, auth: {} },
      login: (_id: string, _type: string, interaction: Interaction) => fake.login!(interaction),
    }),
  },
  SettingsManager: { create: () => ({ getOrCreateDeviceId: () => 'device-1' }) },
}))

const { ProviderLoginService } = await import('../../src/main/models-config/provider-login-service')

function service() {
  const events: ProviderLoginEvent[] = []
  const openExternal = vi.fn(async () => undefined)
  const refreshAuth = vi.fn(async () => ({ providers: [], apply: 'applied' as const }))
  const login = new ProviderLoginService({ agentDir: '/tmp/agent', openExternal, refreshAuth })
  login.subscribe((event) => events.push(event))
  return { login, events, openExternal, refreshAuth }
}
const waitFor = async (check: () => boolean) => { for (let i = 0; i < 100 && !check(); i += 1) await new Promise((resolve) => setTimeout(resolve, 5)) }

afterEach(() => { fake.login = null })

describe('provider login service', () => {
  it('opens the sign-in page, relays a pasted code and finishes', async () => {
    fake.login = async (interaction) => {
      interaction.notify({ type: 'auth_url', url: 'https://claude.ai/oauth/authorize?x=1' })
      interaction.notify({ type: 'auth_url', url: 'javascript:alert(1)' })
      const code = await interaction.prompt({ type: 'manual_code', message: 'Paste the code' })
      expect(code).toBe('abc#123')
      return { type: 'oauth' }
    }
    const { login, events, openExternal, refreshAuth } = service()
    const { loginId } = await login.start('anthropic')
    await waitFor(() => events.some((event) => event.type === 'prompt'))
    expect(openExternal).toHaveBeenCalledTimes(1)
    expect(openExternal).toHaveBeenCalledWith('https://claude.ai/oauth/authorize?x=1')
    const prompt = events.find((event) => event.type === 'prompt')!
    expect(prompt).toMatchObject({ loginId, prompt: { type: 'manual_code', message: 'Paste the code' } })
    login.respond(loginId, (prompt as Extract<ProviderLoginEvent, { type: 'prompt' }>).promptId, 'abc#123')
    await waitFor(() => events.some((event) => event.type === 'finished'))
    expect(refreshAuth).toHaveBeenCalled()
    expect(events[events.length - 1]).toMatchObject({ type: 'finished', loginId, apply: 'applied' })
  })

  it('cancels a waiting sign-in', async () => {
    fake.login = (interaction) => new Promise((_resolve, reject) => {
      interaction.notify({ type: 'device_code', userCode: 'ABCD-1234', verificationUri: 'https://github.com/login/device' })
      interaction.signal.addEventListener('abort', () => reject(new Error('aborted')))
    })
    const { login, events } = service()
    const { loginId } = await login.start('anthropic')
    expect(events[0]).toMatchObject({ type: 'device_code', userCode: 'ABCD-1234' })
    login.cancel(loginId)
    await waitFor(() => events.some((event) => event.type === 'cancelled'))
    expect(events[events.length - 1]).toEqual({ type: 'cancelled', loginId })
  })

  it('reports a busy callback port and refuses providers without sign-in', async () => {
    fake.login = async () => { throw new Error('listen EADDRINUSE: address already in use 127.0.0.1:1455') }
    const { login, events } = service()
    await login.start('anthropic')
    await waitFor(() => events.some((event) => event.type === 'failed'))
    expect(events[events.length - 1]).toMatchObject({ type: 'failed', code: 'PORT_IN_USE' })
    await expect(login.start('deepseek')).rejects.toThrow('no subscription sign-in')
  })
})
