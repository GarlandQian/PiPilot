import type { BrowserWindow, Session, WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import {
  configureSessionSecurity,
  PRODUCTION_CSP,
} from '../../src/main/security/session-security'
import { createApplicationUrlPolicy } from '../../src/main/security/url-policy'

describe('Electron session security', () => {
  it('allows renderer-owned Blob image previews without allowing remote images', () => {
    expect(PRODUCTION_CSP).toContain("img-src 'self' data: blob:")
    expect(PRODUCTION_CSP).not.toContain('https:')
  })

  it('limits clipboard checks to the current trusted main window', () => {
    type PermissionRequestHandler = Parameters<Session['setPermissionRequestHandler']>[0]
    type PermissionCheckHandler = Parameters<Session['setPermissionCheckHandler']>[0]
    let requestPermission: PermissionRequestHandler | undefined
    let checkPermission: PermissionCheckHandler | undefined
    const electronSession = {
      setPermissionRequestHandler: vi.fn((handler: PermissionRequestHandler) => {
        requestPermission = handler
      }),
      setPermissionCheckHandler: vi.fn((handler: PermissionCheckHandler) => {
        checkPermission = handler
      }),
      webRequest: { onHeadersReceived: vi.fn() },
    } as unknown as Session
    const trustedContents = {
      getURL: () => 'pipilot://app/',
    } as unknown as WebContents
    let window: BrowserWindow | null = {
      isDestroyed: () => false,
      webContents: trustedContents,
    } as unknown as BrowserWindow

    configureSessionSecurity(
      electronSession,
      createApplicationUrlPolicy(),
      () => window,
    )

    const request = (
      contents: WebContents,
      permission: Parameters<NonNullable<PermissionRequestHandler>>[1],
      requestingUrl = 'pipilot://app/',
    ) => {
      let granted: boolean | undefined
      requestPermission?.(
        contents,
        permission,
        (value) => { granted = value },
        { isMainFrame: true, requestingUrl },
      )
      return granted
    }

    expect(request(trustedContents, 'clipboard-sanitized-write')).toBe(true)
    expect(request(trustedContents, 'geolocation')).toBe(false)
    expect(request(
      { getURL: () => 'pipilot://app/' } as WebContents,
      'clipboard-sanitized-write',
    )).toBe(false)

    expect(checkPermission?.(
      trustedContents,
      'clipboard-sanitized-write',
      'pipilot://app/',
      { isMainFrame: true },
    )).toBe(true)
    expect(checkPermission?.(
      { getURL: () => 'pipilot://app/' } as WebContents,
      'clipboard-sanitized-write',
      'pipilot://app/',
      { isMainFrame: true },
    )).toBe(false)
    expect(checkPermission?.(
      trustedContents,
      'geolocation',
      'pipilot://app/',
      { isMainFrame: true },
    )).toBe(false)

    window = null
    expect(checkPermission?.(
      trustedContents,
      'clipboard-sanitized-write',
      'pipilot://app/',
      { isMainFrame: true },
    )).toBe(false)
  })
})
