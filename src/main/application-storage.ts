import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path'

const PACKAGED_SMOKE_DIRECTORY_PREFIX = 'pipilot-packaged-smoke-'

interface ResolveTestUserDataOptions {
  candidate?: string
  isPackaged: boolean
  packagedSmoke?: string
  temporaryDirectory?: string
}

export interface ApplicationStoragePaths {
  browserDataDirectory: string
  crashDirectory: string
  logDirectory: string
  mainLogFile: string
}

function isPathInside(parent: string, candidate: string) {
  const child = relative(parent, candidate)
  return (
    child !== '' &&
    child !== '..' &&
    !child.startsWith(`..${sep}`) &&
    !isAbsolute(child)
  )
}

function canonicalizePath(value: string) {
  let current = resolve(value)
  const suffix: string[] = []
  while (true) {
    try {
      let canonical = realpathSync.native(current)
      for (const segment of suffix.reverse()) canonical = join(canonical, segment)
      return canonical
    } catch {
      const parent = dirname(current)
      if (parent === current) return resolve(value)
      suffix.push(basename(current))
      current = parent
    }
  }
}

export function resolveTestUserDataOverride({
  candidate,
  isPackaged,
  packagedSmoke,
  temporaryDirectory = tmpdir(),
}: ResolveTestUserDataOptions) {
  if (!candidate) return undefined

  const resolvedCandidate = resolve(candidate)
  if (!isPackaged) return resolvedCandidate
  if (packagedSmoke !== '1') return undefined

  const resolvedTemporaryDirectory = resolve(temporaryDirectory)
  const canonicalTemporaryDirectory = canonicalizePath(resolvedTemporaryDirectory)
  const canonicalCandidate = canonicalizePath(resolvedCandidate)
  if (!isPathInside(canonicalTemporaryDirectory, canonicalCandidate)) return undefined

  const topLevelDirectory = relative(
    canonicalTemporaryDirectory,
    canonicalCandidate,
  ).split(sep)[0]
  if (!topLevelDirectory.startsWith(PACKAGED_SMOKE_DIRECTORY_PREFIX)) {
    return undefined
  }

  return canonicalCandidate
}

export function createApplicationStoragePaths(
  userDataDirectory: string,
): ApplicationStoragePaths {
  const logDirectory = join(userDataDirectory, 'logs')
  return {
    browserDataDirectory: join(userDataDirectory, 'browser-data'),
    crashDirectory: join(userDataDirectory, 'crash-reports'),
    logDirectory,
    mainLogFile: join(logDirectory, 'main.log'),
  }
}
