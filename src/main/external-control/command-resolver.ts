import { statSync } from 'node:fs'
import { posix, win32 } from 'node:path'

export interface ExternalControlCommandResolverOptions {
  appImagePath?: string
  descriptorPath: string
  executablePath: string
  mcpEntryPath?: string
  mcpExecutablePath?: string
  isPackaged: boolean
  platform?: NodeJS.Platform
  testExecutablePath?: string
  isExecutableFile?: (path: string) => boolean
  isFile?: (path: string) => boolean
}

function defaultIsFile(path: string) {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function defaultIsExecutableFile(path: string) {
  try {
    const details = statSync(path)
    if (!details.isFile()) return false
    return process.platform === 'win32' || (details.mode & 0o111) !== 0
  } catch {
    return false
  }
}

function isAbsoluteForPlatform(path: string, platform: NodeJS.Platform) {
  return platform === 'win32'
    ? win32.isAbsolute(path)
    : posix.isAbsolute(path)
}

function isSafePath(path: string, platform: NodeJS.Platform) {
  if (!path || path.includes('\0') || !isAbsoluteForPlatform(path, platform)) {
    return false
  }
  const normalized = platform === 'win32'
    ? path.replace(/\\/gu, '/').toLowerCase()
    : path
  return !normalized.includes('.asar/')
}

export function resolveExternalControlMcpConfiguration(
  options: ExternalControlCommandResolverOptions,
) {
  const platform = options.platform ?? process.platform
  const isExecutableFile = options.isExecutableFile ?? defaultIsExecutableFile
  const isFile = options.isFile ?? defaultIsFile
  if (!isSafePath(options.descriptorPath, platform)) return null
  if (!options.isPackaged && !options.testExecutablePath) return null

  let command = options.testExecutablePath ?? options.executablePath
  const isWindowsPackaged = options.isPackaged && platform === 'win32'
  if (isWindowsPackaged) {
    command = options.mcpExecutablePath ?? ''
  }
  if (
    options.isPackaged &&
    platform === 'linux' &&
    options.appImagePath !== undefined
  ) {
    command = options.appImagePath
  }
  if (!isSafePath(command, platform) || !isExecutableFile(command)) return null

  if (
    isWindowsPackaged &&
    (!options.mcpEntryPath ||
      !isAbsoluteForPlatform(options.mcpEntryPath, platform) ||
      options.mcpEntryPath.includes('\0') ||
      !isFile(options.mcpEntryPath))
  ) return null

  const args = [
    ...(isWindowsPackaged ? [options.mcpEntryPath!] : []),
    '--pipilot-mcp-stdio',
    '--descriptor',
    options.descriptorPath,
  ]

  return {
    command,
    args,
    ...(isWindowsPackaged ? { env: { ELECTRON_RUN_AS_NODE: '1' } } : {}),
  }
}
