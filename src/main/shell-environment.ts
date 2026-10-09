import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { userInfo } from 'node:os'

const RESOLVE_TIMEOUT_MS = 5_000
const OUTPUT_LIMIT = 4 * 1024 * 1024
/** Variables that describe the probing shell itself, not the user's environment. */
const SHELL_SESSION_ONLY = new Set(['SHLVL', 'PWD', 'OLDPWD', '_', 'ELECTRON_RUN_AS_NODE', 'ELECTRON_NO_ATTACH_CONSOLE'])

/**
 * An app opened from the Dock, Finder or a desktop launcher inherits only the
 * system's minimal environment, without the PATH that the user's shell builds
 * (Homebrew, nvm, fnm, cargo…): `npx` or a globally installed MCP server then
 * fails with ENOENT. Started from a shell (SHLVL is set), it already has it.
 * Windows gives desktop apps the user's full PATH.
 */
export function needsShellEnvironment(environment: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform) {
  return platform !== 'win32' && !environment.SHLVL
}

function loginShell(environment: NodeJS.ProcessEnv) {
  try {
    return environment.SHELL || userInfo().shell || '/bin/sh'
  } catch {
    return environment.SHELL || '/bin/sh'
  }
}

const quote = (value: string) => `'${value.replace(/'/gu, `'\\''`)}'`

/** Arguments that run `command` in an interactive login shell, so both profile and rc files apply. */
export function loginShellArguments(shell: string, command: string) {
  return /(^|\/)t?csh$/u.test(shell) ? ['-ic', command] : ['-i', '-l', '-c', command]
}

/** The JSON environment between two markers, ignoring whatever the rc files print around it. */
export function parseShellEnvironment(output: string, marker: string): Record<string, string> | null {
  const start = output.indexOf(marker)
  const end = output.indexOf(marker, start + marker.length)
  if (start < 0 || end < 0) return null
  try {
    const value = JSON.parse(output.slice(start + marker.length, end)) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] =>
      typeof entry[1] === 'string' && !SHELL_SESSION_ONLY.has(entry[0])))
  } catch {
    return null
  }
}

/**
 * The environment the user's login shell builds, read once by running this
 * executable as Node inside it (as VS Code does). Null when the shell fails,
 * prints nothing usable or takes too long; the app then keeps its own.
 */
export function resolveShellEnvironment({ environment = process.env, executable = process.execPath, timeoutMs = RESOLVE_TIMEOUT_MS }: {
  environment?: NodeJS.ProcessEnv
  executable?: string
  timeoutMs?: number
} = {}): Promise<Record<string, string> | null> {
  return new Promise((resolve) => {
    const marker = `__PIPILOT_SHELL_ENV_${randomUUID()}__`
    const script = `process.stdout.write(${JSON.stringify(marker)} + JSON.stringify(process.env) + ${JSON.stringify(marker)})`
    const shell = loginShell(environment)
    let output = ''
    let settled = false
    const finish = (value: Record<string, string> | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(shell, loginShellArguments(shell, `${quote(executable)} -e ${quote(script)}`), {
        env: { ...environment, ELECTRON_RUN_AS_NODE: '1', ELECTRON_NO_ATTACH_CONSOLE: '1' },
        stdio: ['ignore', 'pipe', 'ignore'],
        detached: true,
      })
    } catch {
      resolve(null)
      return
    }
    const timer = setTimeout(() => {
      try { if (child.pid) process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') }
      finish(null)
    }, timeoutMs)
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      output += chunk
      if (output.length > OUTPUT_LIMIT) {
        child.kill('SIGKILL')
        finish(null)
      }
    })
    child.on('error', () => finish(null))
    child.on('close', () => finish(parseShellEnvironment(output, marker)))
  })
}

/** Adopt the shell's values, except for names the app sets on purpose. */
export function applyShellEnvironment(target: NodeJS.ProcessEnv, resolved: Record<string, string>, keep: readonly string[] = []) {
  const kept = new Set(keep)
  for (const [key, value] of Object.entries(resolved)) {
    if (!kept.has(key) && !SHELL_SESSION_ONLY.has(key)) target[key] = value
  }
}
