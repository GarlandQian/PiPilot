import type { BrowserWindow, Session, WebContents } from 'electron'
import type { ApplicationUrlPolicy } from './url-policy'
import { APP_SCHEME } from './url-policy'

export const PRODUCTION_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "worker-src 'none'",
].join('; ')

export function configureSessionSecurity(
  electronSession: Session,
  policy: ApplicationUrlPolicy,
  getMainWindow: () => BrowserWindow | null,
) {
  const allowsClipboardWrite = (
    webContents: WebContents | null,
    permission: string,
    requestingUrl: string,
  ) => {
    const window = getMainWindow()
    return (
      permission === 'clipboard-sanitized-write' &&
      window !== null &&
      !window.isDestroyed() &&
      webContents !== null &&
      webContents === window.webContents &&
      policy.isTrustedRendererUrl(webContents.getURL()) &&
      policy.isTrustedRendererUrl(requestingUrl)
    )
  }

  electronSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(allowsClipboardWrite(webContents, permission, details.requestingUrl))
  })

  electronSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    return allowsClipboardWrite(webContents, permission, requestingOrigin)
  })

  electronSession.webRequest.onHeadersReceived((details, callback) => {
    if (details.url.startsWith(`${APP_SCHEME}://`)) {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [PRODUCTION_CSP],
        },
      })
      return
    }

    callback({ responseHeaders: details.responseHeaders })
  })
}
