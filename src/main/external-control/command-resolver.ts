import { statSync } from 'node:fs'
import { posix, win32 } from 'node:path'
import {
  EXTERNAL_CONTROL_MCP_CONFIGURATION,
  type ExternalControlMcpConfiguration,
} from '../../shared/external-control'

export interface ExternalControlCommandResolverOptions {
  appImagePath?: string
  descriptorPath: string
  executablePath: string
  mcpExecutablePath?: string
  isPackaged: boolean
  platform?: NodeJS.Platform
  testExecutablePath?: string
  isExecutableFile?: (path: string) => boolean
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
): ExternalControlMcpConfiguration | null {
  const platform = options.platform ?? process.platform
  if (!isSafePath(options.descriptorPath, platform)) return null
  if (!options.isPackaged && !options.testExecutablePath) return null

  const source = resolveExternalControlLauncherSource(options)
  if (!source) return null
  return {
    command: EXTERNAL_CONTROL_MCP_CONFIGURATION.command,
    args: [],
  }
}

export function resolveExternalControlLauncherSource(
  options: ExternalControlCommandResolverOptions,
) {
  const platform = options.platform ?? process.platform
  const isExecutableFile = options.isExecutableFile ?? defaultIsExecutableFile
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
  return command
}
