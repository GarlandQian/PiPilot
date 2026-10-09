import { accessSync, constants, existsSync, statSync } from 'node:fs'
import { basename, delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

interface PackageSettings {
  getNpmCommand(): string[] | undefined
}

function systemNpmAvailable() {
  const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === 'path')
  const candidates = process.platform === 'win32' ? ['npm.exe', 'npm.cmd', 'npm.bat'] : ['npm']
  return (process.env[pathKey ?? 'PATH'] ?? '').split(delimiter).filter(Boolean).some((directory) =>
    candidates.some((name) => {
      try {
        const file = join(directory.replace(/^"|"$/gu, ''), name)
        if (!statSync(file).isFile()) return false
        accessSync(file, process.platform === 'win32' ? constants.R_OK : constants.X_OK)
        return true
      } catch { return false }
    }),
  )
}

function mainOutputDirectory(moduleUrl: string) {
  const directory = dirname(fileURLToPath(moduleUrl))
  return basename(directory) === 'chunks' ? dirname(directory) : directory
}

export function bundledWindowsNodeDirectory(moduleUrl = import.meta.url) {
  if (process.platform !== 'win32') return undefined
  const directory = join(mainOutputDirectory(moduleUrl), '..', '..', '..', 'node')
  return existsSync(join(directory, 'node.exe')) ? directory : undefined
}

/** App-local only: never change the user's registry PATH or fnm installation. */
export function prependWindowsNodePath(environment: NodeJS.ProcessEnv, directory: string) {
  const keys = Object.keys(environment).filter((key) => key.toLowerCase() === 'path')
  const paths = keys.flatMap((key) => (environment[key] ?? '').split(';')).filter(Boolean)
  const seen = new Set<string>()
  const unique = [directory, ...paths].filter((entry) => {
    const normalized = entry.replace(/^"|"$/gu, '').replace(/[\\/]+$/u, '').toLowerCase()
    if (seen.has(normalized)) return false
    seen.add(normalized)
    return true
  })
  for (const key of keys) delete environment[key]
  environment.PATH = unique.join(';')
}

export function prepareBundledNodeEnvironment(environment = process.env, moduleUrl = import.meta.url) {
  const directory = bundledWindowsNodeDirectory(moduleUrl)
  if (directory) prependWindowsNodePath(environment, directory)
  return directory
}

export function bundledNpmCommand(moduleUrl = import.meta.url, executablePath = process.execPath) {
  const windowsNode = prepareBundledNodeEnvironment(process.env, moduleUrl)
  if (windowsNode) return [join(windowsNode, 'npm.cmd')]
  // Pi uses the trailing -- npm to identify the package manager's argument dialect.
  return [executablePath, join(mainOutputDirectory(moduleUrl), 'npm-runner.js'), '--', 'npm']
}

/** Use Pi's public getter, including after reload, without saving machine paths in settings.json. */
export function useBundledNpm(settings: PackageSettings, command = bundledWindowsNodeDirectory()
  ? bundledNpmCommand()
  : systemNpmAvailable() ? ['npm'] : bundledNpmCommand()) {
  const configured = settings.getNpmCommand.bind(settings)
  settings.getNpmCommand = () => {
    const value = configured()
    return !value?.length || (value.length === 1 && /^(npm|npm\.cmd)$/iu.test(value[0]!))
      ? [...command]
      : value
  }
}
