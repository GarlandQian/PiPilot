import { shell, type BrowserWindow } from 'electron'
import type { ApplicationUrlPolicy } from './url-policy'

type ExternalOpener = (url: string) => Promise<void>

export function installNavigationGuards(
  window: BrowserWindow,
  policy: ApplicationUrlPolicy,
  openExternal: ExternalOpener = (url) => shell.openExternal(url),
) {
  const preventUntrustedNavigation = (event: Electron.Event, url: string) => {
    if (!policy.isTrustedRendererUrl(url)) event.preventDefault()
  }

  window.webContents.on('will-navigate', preventUntrustedNavigation)
  window.webContents.on('will-redirect', preventUntrustedNavigation)
  window.webContents.on('will-attach-webview', (event) => event.preventDefault())
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (policy.isSafeExternalUrl(url)) {
      void openExternal(url).catch(() => {
        // The operating system rejected the URL. Nothing privileged is exposed.
      })
    }
    return { action: 'deny' }
  })
}
