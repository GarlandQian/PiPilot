import { accessSync, constants, statSync } from 'node:fs'
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

export function bundledNpmCommand(moduleUrl = import.meta.url, executablePath = process.execPath) {
  const directory = dirname(fileURLToPath(moduleUrl))
  const output = basename(directory) === 'chunks' ? dirname(directory) : directory
  // Pi uses the trailing -- npm to identify the package manager's argument dialect.
  return [executablePath, join(output, 'npm-runner.js'), '--', 'npm']
}

/** Use Pi's public getter, including after reload, without saving machine paths in settings.json. */
export function useBundledNpm(settings: PackageSettings, command = systemNpmAvailable() ? ['npm'] : bundledNpmCommand()) {
  const configured = settings.getNpmCommand.bind(settings)
  settings.getNpmCommand = () => {
    const value = configured()
    return !value?.length || (value.length === 1 && /^(npm|npm\.cmd)$/iu.test(value[0]!))
      ? [...command]
      : value
  }
}
