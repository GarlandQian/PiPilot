import type { BrowserWindow } from 'electron'
import { providerLoginCancelContract, providerLoginChannels, providerLoginRespondContract, providerLoginStartContract } from '../../shared/ipc/provider-login-contracts'
import { ProviderLoginError, type ProviderLoginService } from '../models-config/provider-login-service'
import type { ApplicationUrlPolicy } from '../security/url-policy'
import { createTrustedSenderValidator, MainProcessError, registerValidatedHandler } from './validated-handler'

export function registerProviderLoginIpc({ getMainWindow, policy, service }: {
  getMainWindow(): BrowserWindow | null
  policy: ApplicationUrlPolicy
  service: ProviderLoginService
}) {
  const trusted = createTrustedSenderValidator(policy, getMainWindow)
  const map = async <T>(action: () => T | Promise<T>) => {
    try { return await action() }
    catch (error) {
      if (error instanceof ProviderLoginError) throw new MainProcessError(error.code, error.message.slice(0, 1_000), true)
      throw new MainProcessError('PROVIDER_LOGIN_FAILED', (error instanceof Error ? error.message : 'Sign-in could not start.').slice(0, 1_000), true)
    }
  }
  const detach = service.subscribe((event) => {
    const window = getMainWindow()
    if (window && !window.isDestroyed()) window.webContents.send(providerLoginChannels.event, event)
  })
  const unregister = [
    registerValidatedHandler(providerLoginStartContract, trusted, ({ providerId }) => map(() => service.start(providerId))),
    registerValidatedHandler(providerLoginRespondContract, trusted, ({ loginId, promptId, value }) => map(() => { service.respond(loginId, promptId, value); return { ok: true as const } })),
    registerValidatedHandler(providerLoginCancelContract, trusted, ({ loginId }) => map(() => { service.cancel(loginId); return { ok: true as const } })),
  ]
  return { dispose() { detach(); unregister.forEach((stop) => stop()) } }
}
