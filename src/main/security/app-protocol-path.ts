import { isAbsolute, relative, resolve, sep } from 'node:path'
import { APP_HOST, APP_SCHEME } from './url-policy'

function rawPathname(requestUrl: string): string | null {
  const match = /^[a-z][a-z\d+.-]*:\/\/[^/?#]*(?<path>[^?#]*)/i.exec(requestUrl)
  if (!match) return null
  return match.groups?.path || '/'
}

export function resolveAppProtocolPath(rendererRoot: string, requestUrl: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(requestUrl)
  } catch {
    return null
  }

  if (parsed.protocol !== `${APP_SCHEME}:` || parsed.hostname !== APP_HOST) return null

  const encodedPathname = rawPathname(requestUrl)
  if (encodedPathname === null) return null

  let pathname: string
  try {
    pathname = decodeURIComponent(encodedPathname)
  } catch {
    return null
  }

  const pathSegments = pathname.split('/')
  if (pathname.includes('\0') || pathname.includes('\\') || pathSegments.includes('..')) {
    return null
  }

  const requestedFile = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
  const absoluteRoot = resolve(rendererRoot)
  const candidate = resolve(absoluteRoot, requestedFile)
  const relativePath = relative(absoluteRoot, candidate)
  const escapedRoot =
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)

  return relativePath !== '' && !escapedRoot ? candidate : null
}
