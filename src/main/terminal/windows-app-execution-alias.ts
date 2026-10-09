import { constants } from 'node:fs'
import { access, lstat } from 'node:fs/promises'
import { win32 } from 'node:path'

const TERMINAL_ALIASES = new Set(['wt.exe', 'pwsh.exe'])

/**
 * AppExecLink entries can be launched even when realpath cannot open their
 * protected Store target. libuv exposes recognized reparse entries as links
 * through lstat, while F_OK checks the entry's file attributes. Stats does not
 * expose the reparse tag, so this fallback is limited to our two known aliases
 * directly inside this user's WindowsApps directory. Spawn remains authoritative.
 */
export async function resolveWindowsAppExecutionAlias(candidate: string, environment: NodeJS.ProcessEnv): Promise<string | undefined> {
  const localKey = Object.keys(environment).find((key) => key.toLowerCase() === 'localappdata')
  const local = localKey === undefined ? undefined : environment[localKey]
  if (!local || !win32.isAbsolute(local) || /[\0\r\n]/.test(local) ||
      !win32.isAbsolute(candidate) || candidate.length > 4_096 || /[\0\r\n]/.test(candidate)) return undefined
  const alias = win32.normalize(candidate)
  const directory = win32.join(local, 'Microsoft', 'WindowsApps')
  if (win32.dirname(alias).toLowerCase() !== directory.toLowerCase() || !TERMINAL_ALIASES.has(win32.basename(alias).toLowerCase())) return undefined
  try {
    const entry = await lstat(alias)
    if (entry.isDirectory() || (!entry.isFile() && !entry.isSymbolicLink())) return undefined
    await access(alias, constants.F_OK)
    return alias
  } catch { return undefined }
}
