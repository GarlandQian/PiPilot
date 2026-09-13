import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

interface ResolvePiAgentDirectoryOptions {
  homeDirectory: string
  environment?: NodeJS.ProcessEnv
  cwd?: string
  isolatedTest?: boolean
}

// Match Pi 0.85.1 getAgentDir/normalizePath without loading the SDK into Main.
export function resolvePiAgentDirectory({
  homeDirectory,
  environment = process.env,
  cwd = process.cwd(),
  isolatedTest = false,
}: ResolvePiAgentDirectoryOptions) {
  if (!isAbsolute(homeDirectory)) {
    throw new Error('The Pi Agent home directory must be absolute.')
  }
  // Only a validated test-userData override may opt into this fixture contract.
  const override = isolatedTest
    ? environment.PIPILOT_E2E_AGENT_DIR
    : environment.PI_CODING_AGENT_DIR
  let directory = override || join(homeDirectory, '.pi', 'agent')
  if (process.platform === 'win32' && !directory.startsWith('//') && !directory.includes('\\')) {
    const drivePath = directory.match(/^\/(?:mnt\/|cygdrive\/)?([a-z])(?:\/(.*))?$/i)
    if (drivePath) {
      directory = `${drivePath[1].toUpperCase()}:\\${drivePath[2]?.replace(/\//g, '\\') ?? ''}`
    }
  }
  if (directory === '~') directory = homeDirectory
  else if (directory.startsWith('~/') || (process.platform === 'win32' && directory.startsWith('~\\'))) {
    directory = join(homeDirectory, directory.slice(2))
  } else if (directory.startsWith('file://')) {
    directory = fileURLToPath(directory)
  }
  return resolve(cwd, directory)
}

export function displayPiAgentPath(path: string, homeDirectory: string) {
  const child = relative(homeDirectory, path)
  return child && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child)
    ? `~/${child.split(sep).join('/')}`
    : path
}
