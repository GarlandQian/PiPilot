import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { access, readFile, readdir, realpath, stat } from 'node:fs/promises'
import { posix, win32 } from 'node:path'
import type { TerminalCustomProfile, TerminalShellProfile } from '../../shared/terminal-profiles'
import { ExecutableIdentityResolver } from '../editors/executable-identity'
import { resolveWindowsAppExecutionAlias } from './windows-app-execution-alias'

export interface ShellLaunch {
  file: string
  args: string[]
  label: string
  env?: Record<string, string | null>
  distribution?: string
}

export interface ResolvedShellProfile extends TerminalShellProfile {
  launch?: ShellLaunch
}

export interface TerminalDiscoveryOptions {
  environment?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  resolveExecutable?: (candidate: string) => Promise<string | undefined>
  resolveIdentity?: (file: string) => Promise<string>
  readShellsFile?: () => Promise<string>
  readDirectory?: (directory: string) => Promise<string[]>
  probeProcess?: (file: string, args: string[]) => Promise<string | Buffer>
}

export function environmentValue(environment: NodeJS.ProcessEnv, name: string, platform: NodeJS.Platform) {
  if (platform !== 'win32') return environment[name]
  const key = Object.keys(environment).find((entry) => entry.toLowerCase() === name.toLowerCase())
  return key === undefined ? undefined : environment[key]
}

/** A locale that already reads and writes UTF-8 (en_US.UTF-8, C.UTF-8, zh_CN.utf8, ja_JP.eucJP …). */
function isMultibyteLocale(value: string | undefined) {
  return Boolean(value && /\.(utf-?8|euc)/iu.test(value))
}

/**
 * An app opened from the Dock or a desktop launcher inherits no LANG, so the
 * shell runs in the C locale and prints "中文.txt" as "????.txt" (Terminal.app
 * and VS Code set one for the same reason). Unless the user chose a locale,
 * give the terminal a UTF-8 one in the system's language.
 */
export function terminalLocaleEnvironment(
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  systemLocale: string | undefined,
  localeExists: (name: string) => boolean,
): Record<string, string> {
  if (platform === 'win32') return {}
  if (environment.LC_ALL || environment.LC_CTYPE || isMultibyteLocale(environment.LANG)) return {}
  // Linux distributions generate few locales; C.UTF-8 is the one always there.
  if (platform !== 'darwin') return { LANG: 'C.UTF-8' }
  // "zh-Hans-CN" → zh_CN: the region is the two-letter subtag, after any script.
  const [language, ...subtags] = (systemLocale ?? '').split(/[-_]/u)
  const region = subtags.find((subtag) => /^[a-z]{2}$/iu.test(subtag))
  const name = language && region ? `${language.toLowerCase()}_${region.toUpperCase()}.UTF-8` : ''
  return { LANG: name && localeExists(name) ? name : 'en_US.UTF-8' }
}

export function mergeTerminalEnvironment(
  inherited: NodeJS.ProcessEnv,
  overrides: Record<string, string | null>,
  platform: NodeJS.Platform,
) {
  const result: NodeJS.ProcessEnv = {}
  const assign = (key: string, value: string | null | undefined) => {
    if (platform === 'win32') {
      for (const existing of Object.keys(result)) {
        if (existing.toLowerCase() === key.toLowerCase()) delete result[existing]
      }
    }
    if (value !== null && value !== undefined) result[key] = value
    else delete result[key]
  }
  for (const [key, value] of Object.entries(inherited)) assign(key, value)
  for (const [key, value] of Object.entries(overrides)) assign(key, value)
  return result
}

function stableId(source: 'detected' | 'wsl', value: string) {
  return `${source}:${createHash('sha256').update(value).digest('hex').slice(0, 32)}`
}

/** WSL accepts Linux paths; drive paths use its standard /mnt/<drive> mount. */
export function wslWorkingDirectory(cwd: string, distribution: string): string | undefined {
  const normalized = cwd.replace(/\//g, '\\').replace(/^\\\\\?\\UNC\\/i, '\\\\').replace(/^\\\\\?\\/, '')
  const unc = /^\\\\(?:wsl\$|wsl\.localhost)\\([^\\]+)(?:\\(.*))?$/i.exec(normalized)
  if (unc) {
    if (unc[1].toLowerCase() !== distribution.toLowerCase()) return undefined
    return `/${(unc[2] ?? '').replace(/\\/g, '/')}`
  }
  const drive = /^([a-z]):\\(.*)$/i.exec(normalized)
  return drive ? `/mnt/${drive[1].toLowerCase()}/${drive[2].replace(/\\/g, '/')}` : undefined
}

export function parseWslDistributions(output: string | Buffer) {
  const text = typeof output === 'string' ? output : output.toString(output.includes(0) ? 'utf16le' : 'utf8')
  return [...new Set(text.replace(/^\uFEFF/, '').split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line.length <= 128 && !/[\0\r\n\\/]/.test(line)))].slice(0, 64)
}

/**
 * Shells every macOS/Linux install lists in /etc/shells that people rarely
 * use interactively. They appear only when one is the user's login shell.
 */
const LEGACY_SHELLS = new Set(['sh', 'csh', 'tcsh', 'ksh', 'dash'])

/** Interactive PTYs need no command string. Only shells supporting login mode get it. */
export function shellArguments(file: string, platform: NodeJS.Platform): string[] {
  const name = (platform === 'win32' ? win32 : posix).basename(file).toLowerCase().replace(/\.exe$/, '')
  if (platform === 'win32') return name === 'bash' ? ['--login', '-i'] : []
  if (name === 'pwsh') return ['-Login', '-NoLogo']
  if (name === 'nu') return ['--login']
  if (name === 'elvish') return []
  if (name === 'xonsh') return ['--login', '--interactive']
  return ['bash', 'zsh', 'fish', 'sh', 'dash', 'ksh', 'csh', 'tcsh'].includes(name) ? ['-l'] : []
}

export class TerminalProfileDiscovery {
  readonly platform: NodeJS.Platform
  readonly environment: NodeJS.ProcessEnv
  private nativeInventory?: Promise<Array<ResolvedShellProfile & { legacy?: boolean }>>
  private wslInventory?: Promise<ResolvedShellProfile[]>
  private readonly identityResolver: ExecutableIdentityResolver

  constructor(private readonly options: TerminalDiscoveryOptions = {}) {
    this.platform = options.platform ?? process.platform
    this.environment = options.environment ?? process.env
    this.identityResolver = new ExecutableIdentityResolver({ platform: this.platform })
  }

  private get path() { return this.platform === 'win32' ? win32 : posix }
  private env(name: string) { return environmentValue(this.environment, name, this.platform) }
  private identity(file: string) { return this.platform === 'win32' ? file.toLowerCase() : file }
  private executableIdentity(file: string) { return this.options.resolveIdentity?.(file) ?? this.identityResolver.identity(file) }

  private profileIds(profile: ResolvedShellProfile) { return [profile.id, ...(profile.aliases ?? [])] }

  private mergeAliases(target: ResolvedShellProfile, other: ResolvedShellProfile) {
    const aliases = [...new Set([...this.profileIds(target), ...this.profileIds(other)])].filter((id) => id !== target.id)
    if (aliases.length) target.aliases = aliases
  }

  private async launchIdentity(launch: ShellLaunch) {
    // Match the override semantics used when spawning. Windows keys are case-insensitive;
    // Unix keys, argument order, and removal (null) remain meaningful.
    const environment = new Map<string, string | null>()
    for (const [key, value] of Object.entries(launch.env ?? {})) {
      environment.set(this.platform === 'win32' ? key.toLowerCase() : key, value)
    }
    // Detected WSL profiles map the project directory into their distribution.
    // A custom wsl.exe launch with the same arguments does not promise that mapping.
    const distribution = this.platform === 'win32' ? launch.distribution?.toLowerCase() : launch.distribution
    return JSON.stringify([await this.executableIdentity(launch.file), launch.args,
      [...environment].sort(([left], [right]) => left.localeCompare(right)), distribution ?? null])
  }

  async sameLaunch(left: ShellLaunch, right: ShellLaunch) {
    return await this.launchIdentity(left) === await this.launchIdentity(right)
  }

  async sameExecutable(left: string, right: string) {
    return await this.executableIdentity(left) === await this.executableIdentity(right)
  }

  async executable(candidate: string): Promise<string | undefined> {
    if (!candidate || candidate.length > 4_096 || /[\0\r\n]/.test(candidate) || !this.path.isAbsolute(candidate)) return undefined
    if (this.options.resolveExecutable) return this.options.resolveExecutable(candidate)
    let canonical: string
    try { canonical = await realpath(candidate) } catch {
      return this.platform === 'win32' ? resolveWindowsAppExecutionAlias(candidate, this.environment) : undefined
    }
    try {
      const details = await stat(canonical)
      await access(canonical, this.platform === 'win32' ? constants.F_OK : constants.X_OK)
      return details.isFile() ? canonical : undefined
    } catch { return undefined }
  }

  private candidates(command: string, known: string[] = [], environment = this.environment) {
    const windows = this.platform === 'win32'
    const directories = (environmentValue(environment, 'PATH', this.platform) ?? '').split(windows ? ';' : ':')
      .map((directory) => directory.replace(/^"|"$/g, ''))
      .filter((directory) => this.path.isAbsolute(directory)).slice(0, 128)
    const commands = windows && !win32.extname(command) ? [command, `${command}.exe`, `${command}.com`] : [command]
    return [...new Set([...known, ...directories.flatMap((directory) => commands.map((entry) => this.path.join(directory, entry)))])]
  }

  async resolveCommand(command: string, environment = this.environment) {
    if (this.path.isAbsolute(command)) return this.executable(command)
    if (!command || /[\0\r\n/\\]/.test(command)) return undefined
    for (const candidate of this.candidates(command, [], environment)) {
      const file = await this.executable(candidate)
      if (file) return file
    }
    return undefined
  }

  private async directory(directory: string) {
    try { return (await (this.options.readDirectory?.(directory) ?? readdir(directory))).slice(0, 64) }
    catch { return [] }
  }

  private async windowsDefinitions() {
    const systemRoot = this.env('SystemRoot') ?? 'C:\\Windows'
    const roots = [...new Set([this.env('ProgramFiles') ?? 'C:\\Program Files', this.env('ProgramFiles(x86)') ?? 'C:\\Program Files (x86)'])]
    const local = this.env('LOCALAPPDATA')
    const powershellRoots = [...roots.map((root) => win32.join(root, 'PowerShell')), ...(local ? [win32.join(local, 'Microsoft', 'PowerShell')] : [])]
    const versions = await Promise.all(powershellRoots.map(async (root) => (await this.directory(root))
      .filter((name) => name !== '.' && name !== '..' && /^[\w.-]+$/.test(name)).sort().map((name) => win32.join(root, name, 'pwsh.exe'))))
    return [
      { label: 'Command Prompt (CMD)', candidates: this.candidates('cmd.exe', [this.env('ComSpec') ?? '', win32.join(systemRoot, 'System32', 'cmd.exe')]), args: [] },
      { label: 'Windows PowerShell', candidates: this.candidates('powershell.exe', [win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')]), args: [] },
      { label: 'PowerShell', candidates: this.candidates('pwsh.exe', [...versions.flat(), ...roots.map((root) => win32.join(root, 'PowerShell', '7', 'pwsh.exe')), ...(local ? [win32.join(local, 'Microsoft', 'WindowsApps', 'pwsh.exe')] : [])]), args: [] },
      { label: 'Git Bash', candidates: this.candidates('bash.exe', [...roots.flatMap((root) => [win32.join(root, 'Git', 'bin', 'bash.exe'), win32.join(root, 'Git', 'usr', 'bin', 'bash.exe')]), ...(local ? [win32.join(local, 'Programs', 'Git', 'bin', 'bash.exe')] : [])]).filter((candidate) => /[\\/]git[\\/]/i.test(candidate)), args: ['--login', '-i'] },
    ]
  }

  private async unixDefinitions() {
    let listed = ''
    try { listed = await (this.options.readShellsFile?.() ?? readFile('/etc/shells', 'utf8')) } catch { /* Optional inventory. */ }
    const registered = listed.split(/\r?\n/).map((line) => line.split('#')[0].trim())
      .filter((line) => posix.isAbsolute(line)).slice(0, 128)
    const login = this.env('SHELL') ?? ''
    const candidates = [...new Set([
      login, ...registered,
      ...['zsh', 'bash', 'fish', 'nu', 'pwsh', 'elvish', 'xonsh'].flatMap((command) => this.candidates(command, [`/bin/${command}`, `/usr/bin/${command}`, `/usr/local/bin/${command}`, `/opt/homebrew/bin/${command}`])),
    ])]
    return candidates.map((candidate) => ({
      label: posix.basename(candidate), candidates: [candidate], args: shellArguments(candidate, this.platform),
      legacy: candidate !== login && LEGACY_SHELLS.has(posix.basename(candidate)),
    }))
  }

  private async wslProfiles(): Promise<ResolvedShellProfile[]> {
    if (this.platform !== 'win32') return []
    const candidates = this.candidates('wsl.exe', [win32.join(this.env('SystemRoot') ?? 'C:\\Windows', 'System32', 'wsl.exe')])
    let file: string | undefined
    for (const candidate of candidates) {
      file = await this.executable(candidate)
      if (file) break
    }
    if (!file) return []
    try {
      const output = await (this.options.probeProcess?.(file, ['--list', '--quiet']) ?? new Promise<Buffer>((resolve, reject) => {
        execFile(file!, ['--list', '--quiet'], { encoding: 'buffer', timeout: 3_000, maxBuffer: 64 * 1024, windowsHide: true }, (error, stdout) => error ? reject(error) : resolve(stdout))
      }))
      return parseWslDistributions(output).map((distribution) => {
        const args = ['--distribution', distribution]
        const label = `${distribution} (WSL)`.slice(0, 128)
        return { id: stableId('wsl', `${this.identity(file!)}:${distribution.toLowerCase()}`), label, isDefault: false, source: 'wsl', executable: file!, args, available: true, launch: { file: file!, args, label, distribution } }
      })
    } catch { return [] }
  }

  /** `keep` names shells listed even if legacy: the default shell and a chosen profile. */
  private async scanNative(): Promise<Array<ResolvedShellProfile & { legacy?: boolean }>> {
    const definitions: { label: string; candidates: string[]; args: string[]; legacy?: boolean }[] =
      await (this.platform === 'win32' ? this.windowsDefinitions() : this.unixDefinitions())
    const profiles: Array<ResolvedShellProfile & { legacy?: boolean }> = []
    const seen = new Map<string, typeof profiles[number]>()
    for (const definition of definitions) {
      for (const candidate of definition.candidates) {
        const file = await this.executable(candidate)
        if (!file) continue
        const id = stableId('detected', this.identity(file))
        const label = definition.label.slice(0, 128) || this.path.basename(file)
        const profile = { id, label, isDefault: false, source: 'detected' as const, executable: file, args: definition.args, available: true, legacy: definition.legacy, launch: { file, args: definition.args, label } }
        const key = await this.launchIdentity(profile.launch)
        const existing = seen.get(key)
        // A shell reached through differently named symlinks may need different
        // arguments. Retain the historical path ID for its first launch profile.
        if (profiles.some((entry) => entry !== existing && this.profileIds(entry).includes(profile.id))) {
          profile.id = stableId('detected', JSON.stringify([this.identity(file), definition.args]))
        }
        if (existing) {
          this.mergeAliases(existing, profile)
          existing.legacy = Boolean(existing.legacy && profile.legacy)
        } else {
          seen.set(key, profile)
          profiles.push(profile)
        }
      }
    }
    // The same shell installed twice (system bash and Homebrew bash, PowerShell 7
    // and a preview) is told apart by where it lives.
    const labels = new Map<string, number>()
    for (const profile of profiles) labels.set(profile.label, (labels.get(profile.label) ?? 0) + 1)
    for (const profile of profiles) {
      if ((labels.get(profile.label) ?? 0) > 1) profile.label = `${profile.label} · ${this.path.dirname(profile.executable)}`.slice(0, 128)
    }
    return profiles
  }

  invalidate() {
    this.nativeInventory = undefined
    this.wslInventory = undefined
    this.identityResolver.clear()
  }

  private nativeProfiles() { return this.nativeInventory ??= this.scanNative() }
  private distributionProfiles() { return this.wslInventory ??= this.wslProfiles() }

  /** Whether WSL has a distribution to open (Windows). */
  async hasWslDistribution() {
    return this.platform === 'win32' && (await this.distributionProfiles()).length > 0
  }

  async discover(custom: TerminalCustomProfile[] = [], keep: { files?: readonly string[]; ids?: readonly string[] } = {}, refresh = false): Promise<ResolvedShellProfile[]> {
    if (refresh) this.invalidate()
    const [native, wsl, configured] = await Promise.all([
      this.nativeProfiles(), this.distributionProfiles(), Promise.all(custom.map((profile) => this.resolveCustom(profile))),
    ])
    const keptFiles = new Set(await Promise.all((keep.files ?? []).map((file) => this.executableIdentity(file))))
    const keptIds = new Set(keep.ids)
    const visible = await Promise.all(native.map(async ({ legacy, ...profile }) =>
      !legacy || this.profileIds(profile).some((id) => keptIds.has(id)) || keptFiles.has(await this.executableIdentity(profile.executable))
        ? structuredClone(profile) : undefined))
    const profiles: ResolvedShellProfile[] = []
    const seen = new Map<string, number>()
    for (const profile of [...visible, ...structuredClone(wsl), ...configured]) {
      if (!profile) continue
      if (!profile.launch) { profiles.push(profile); continue }
      const key = await this.launchIdentity(profile.launch)
      const index = seen.get(key)
      if (index === undefined) { seen.set(key, profiles.length); profiles.push(profile); continue }
      const existing = profiles[index]
      // Keep a user-configured row editable, preferring their selected configuration
      // when several equivalent custom profiles exist. Saved configurations stay intact.
      const prefer = profile.source === 'custom' && (existing.source !== 'custom' ||
        (keptIds.has(profile.id) && !keptIds.has(existing.id)))
      if (prefer) { this.mergeAliases(profile, existing); profiles[index] = profile }
      else this.mergeAliases(existing, profile)
    }
    return profiles
  }

  /** A native selection never waits for the unrelated WSL inventory. Recheck only its executable. */
  async selected(id: string): Promise<ResolvedShellProfile | undefined> {
    const profiles = id.startsWith('wsl:') ? await this.distributionProfiles() : await this.nativeProfiles()
    const profile = profiles.find((entry) => this.profileIds(entry).includes(id))
    if (!profile || !profile.launch || !await this.executable(profile.executable)) return undefined
    return structuredClone(profile)
  }

  async distributionAvailable(file: string, distribution: string) {
    return (await this.distributionProfiles()).some((profile) =>
      profile.launch?.distribution?.toLowerCase() === distribution.toLowerCase() && this.identity(profile.executable) === this.identity(file))
  }

  async resolveCustom(profile: TerminalCustomProfile): Promise<ResolvedShellProfile> {
    const environment = mergeTerminalEnvironment(this.environment, profile.env, this.platform)
    const file = await this.resolveCommand(profile.executable, environment)
    return { id: profile.id, label: profile.name, isDefault: false, source: 'custom', executable: file ?? profile.executable, args: [...profile.args], available: Boolean(file), ...(file ? { launch: { file, args: [...profile.args], label: profile.name, env: { ...profile.env } } } : { unavailableReason: 'executable-not-found' as const }) }
  }

  async automatic(): Promise<ShellLaunch | undefined> {
    if (this.platform === 'win32') {
      const profiles = await this.nativeProfiles()
      // Prefer stable PowerShell installations. A preview never supersedes a stable shell.
      for (const label of ['PowerShell', 'Windows PowerShell', 'Command Prompt (CMD)']) {
        for (const profile of profiles.filter((entry) => entry.launch?.label === label)) {
          if (label === 'PowerShell' && /preview/i.test(profile.executable)) continue
          const file = await this.executable(profile.executable)
          if (file && profile.launch) return { ...profile.launch, file }
        }
      }
      return undefined
    }
    const configured = this.env('SHELL')
    const candidates = [configured ?? '', this.platform === 'darwin' ? '/bin/zsh' : '/bin/bash', '/bin/sh']
    for (const candidate of candidates) {
      const file = await this.executable(candidate)
      if (file) return { file, args: shellArguments(file, this.platform), label: this.path.basename(file).slice(0, 128) }
    }
    const fallback = (await this.nativeProfiles())[0]
    return fallback?.launch
  }
}
