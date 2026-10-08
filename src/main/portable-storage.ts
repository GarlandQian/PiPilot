import { readFileSync, mkdirSync, accessSync, constants } from 'node:fs'
import { dirname, join, win32 } from 'node:path'

export function isPortableDistribution(resourcesPath: string | undefined): boolean {
  if (!resourcesPath) return false
  try {
    return JSON.parse(readFileSync(join(resourcesPath, 'app.asar', 'package.json'), 'utf8')).pipilotDistribution === 'portable'
  } catch { return false }
}

export function portableDataDirectory(options: {
  packaged: boolean
  portable: boolean
  platform?: NodeJS.Platform
  executablePath?: string
  environment?: NodeJS.ProcessEnv
}) {
  if (!options.packaged || !options.portable || (options.platform ?? process.platform) !== 'win32') return undefined
  const environment = options.environment ?? process.env
  const parent = environment.PORTABLE_EXECUTABLE_DIR || win32.dirname(options.executablePath ?? process.execPath)
  if (!win32.isAbsolute(parent) || /[\0\r\n]/u.test(parent)) throw new Error('Invalid portable application directory.')
  return win32.join(parent, 'data')
}

export function preparePortableDataDirectory(directory: string) {
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    accessSync(directory, constants.R_OK | constants.W_OK | constants.X_OK)
  } catch {
    throw new Error(`The portable data directory is not writable. Move PiPilot to a writable folder: ${dirname(directory)}`)
  }
}
