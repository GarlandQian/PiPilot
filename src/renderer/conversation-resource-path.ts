import { workspaceRelativePathSchema } from '../shared/workspace-content'

interface AbsolutePath {
  volume: string
  parts: string[]
}

function normalizeParts(parts: readonly string[]): string[] | null {
  const normalized: string[] = []
  for (const part of parts) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (!normalized.length) return null
      normalized.pop()
    } else {
      normalized.push(part)
    }
  }
  return normalized
}

function absolutePath(path: string, windows: boolean): AbsolutePath | null {
  if (windows) {
    const normalized = path.replace(/\\/gu, '/')
    const drive = /^([a-z]):\/(.*)$/iu.exec(normalized)
    const unc = /^\/\/([^/]+)\/([^/]+)(?:\/(.*))?$/u.exec(normalized)
    // Device paths need OS-specific resolution and are not workspace routes.
    if (unc && (unc[1] === '?' || unc[1] === '.')) return null
    const volume = drive ? `${drive[1]}:` : unc ? `//${unc[1]}/${unc[2]}` : null
    if (!volume) return null
    const parts = normalizeParts((drive?.[2] ?? unc?.[3] ?? '').split('/'))
    return parts ? { volume, parts } : null
  }
  if (!path.startsWith('/')) return null
  const parts = normalizeParts(path.split('/'))
  return parts ? { volume: '/', parts } : null
}

/**
 * Routes native file-tool evidence to the existing read-only workspace viewer.
 * This is lexical UI routing; the main process still checks existence, file
 * type, and confinement after resolving symlinks before reading any content.
 */
export function conversationResourcePath(path: string, workspaceRoot: string): string | null {
  if (!path || !workspaceRoot || path.includes('\0') || workspaceRoot.includes('\0')) return null
  // Do not guess a home directory or interpret a URI as a relative file name.
  if (path.startsWith('~')) return null
  const windows = /^[a-z]:[/\\]/iu.test(workspaceRoot) || /^[/\\]{2}/u.test(workspaceRoot)
  const root = absolutePath(workspaceRoot, windows)
  if (!root) return null

  const windowsAbsolute = /^[a-z]:[/\\]/iu.test(path) || /^[/\\]{2}/u.test(path)
  if (!windowsAbsolute && /^[a-z][a-z\d+.-]*:/iu.test(path)) return null
  const absolute = windowsAbsolute || path.startsWith('/') || path.startsWith('\\')
  let parts: string[] | null
  if (absolute) {
    if (!windows && (windowsAbsolute || path.startsWith('\\'))) return null
    const candidate = absolutePath(path, windows)
    if (!candidate) return null
    const same = (left: string, right: string) => windows
      ? left.toLowerCase() === right.toLowerCase()
      : left === right
    if (!same(root.volume, candidate.volume) || root.parts.some((part, index) =>
      !same(part, candidate.parts[index] ?? ''),
    )) return null
    parts = candidate.parts.slice(root.parts.length)
  } else {
    parts = normalizeParts((windows ? path.replace(/\\/gu, '/') : path).split('/'))
  }
  if (!parts?.length) return null
  // Windows alternate streams and drive-relative components are not file routes.
  if (windows && parts.some((part) => part.includes(':'))) return null
  const relativePath = parts.join('/')
  const parsed = workspaceRelativePathSchema.safeParse(relativePath)
  return parsed.success ? parsed.data : null
}
