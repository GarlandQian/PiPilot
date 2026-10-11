import { randomUUID } from 'node:crypto'
import type { BrowserWindow } from 'electron'
import { browserAnnotateContract, browserCancelAnnotationContract, browserCommandContract, browserGetContract, browserNavigateContract, browserOpenContract, browserPaneChannels, browserViewportContract } from '../../shared/ipc/browser-pane-contracts'
import { browserChangedEventSchema } from '../../shared/browser-pane'
import { BrowserPaneError, type BrowserPaneService } from '../browser/browser-pane-service'
import type { ApplicationUrlPolicy } from '../security/url-policy'
import { createTrustedSenderValidator, MainProcessError, registerValidatedHandler } from './validated-handler'

export function registerBrowserPaneIpc({ getMainWindow, policy, service }: {
  getMainWindow(): BrowserWindow | null
  policy: ApplicationUrlPolicy
  service: BrowserPaneService
}) {
  const trusted = createTrustedSenderValidator(policy, getMainWindow)
  const map = async <T>(action: () => T | Promise<T>) => {
    try { return await action() }
    catch (error) {
      if (error instanceof BrowserPaneError) throw new MainProcessError(error.code, error.message, true)
      throw new MainProcessError('BROWSER_FAILED', (error instanceof Error ? error.message : 'The browser action failed.').slice(0, 1_000), true)
    }
  }
  const detach = service.subscribe((snapshot) => {
    const window = getMainWindow()
    if (window && !window.isDestroyed()) window.webContents.send(browserPaneChannels.changed, browserChangedEventSchema.parse({ eventId: randomUUID(), snapshot }))
  })
  const unregister = [
    registerValidatedHandler(browserGetContract, trusted, ({ scopeKey }) => map(() => service.snapshot(scopeKey))),
    registerValidatedHandler(browserOpenContract, trusted, ({ scopeKey, url }) => map(() => service.open(scopeKey, url))),
    registerValidatedHandler(browserNavigateContract, trusted, ({ scopeKey, tabId, input }) => map(() => service.navigate(scopeKey, tabId, input))),
    registerValidatedHandler(browserCommandContract, trusted, ({ scopeKey, tabId, command }) => map(() => service.command(scopeKey, tabId, command))),
    registerValidatedHandler(browserViewportContract, trusted, ({ scopeKey, bounds }) => map(() => service.setViewport(scopeKey, bounds))),
    registerValidatedHandler(browserAnnotateContract, trusted, ({ scopeKey, tabId, mode }) => map(() => service.annotate(scopeKey, tabId, mode))),
    registerValidatedHandler(browserCancelAnnotationContract, trusted, ({ scopeKey, tabId }) => map(async () => { await service.cancelAnnotation(scopeKey, tabId); return { ok: true as const } })),
  ]
  return { dispose() { detach(); unregister.forEach((stop) => stop()) } }
}
