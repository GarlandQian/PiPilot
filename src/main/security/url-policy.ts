import { isSafeExternalUrl as validateExternalUrl } from '../../shared/external-url'

export const APP_SCHEME = 'pipilot'
export const APP_HOST = 'app'
export const APP_URL = `${APP_SCHEME}://${APP_HOST}/`

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost'])
function parseUrl(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

function resolveDevelopmentOrigin(developmentUrl?: string): string | null {
  if (!developmentUrl) return null

  const parsed = parseUrl(developmentUrl)
  if (
    !parsed ||
    parsed.protocol !== 'http:' ||
    !LOOPBACK_HOSTS.has(parsed.hostname) ||
    parsed.username !== '' ||
    parsed.password !== ''
  ) {
    throw new Error('Electron development URL must use HTTP on an exact loopback host')
  }

  return parsed.origin
}

export interface ApplicationUrlPolicy {
  readonly developmentOrigin: string | null
  isSafeExternalUrl(value: string): boolean
  isTrustedRendererUrl(value: string): boolean
}

export function createApplicationUrlPolicy(developmentUrl?: string): ApplicationUrlPolicy {
  const developmentOrigin = resolveDevelopmentOrigin(developmentUrl)

  return Object.freeze({
    developmentOrigin,
    isSafeExternalUrl(value: string) {
      return validateExternalUrl(value)
    },
    isTrustedRendererUrl(value: string) {
      const parsed = parseUrl(value)
      if (!parsed || parsed.username !== '' || parsed.password !== '') return false

      if (developmentOrigin) {
        return parsed.origin === developmentOrigin
      }

      return (
        parsed.protocol === `${APP_SCHEME}:` &&
        parsed.hostname === APP_HOST &&
        parsed.port === ''
      )
    },
  })
}
