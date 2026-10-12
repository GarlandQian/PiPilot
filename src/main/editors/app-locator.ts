import { execFile } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { posix, win32 } from 'node:path'

export interface AppLocatorOptions {
  platform?: NodeJS.Platform
  environment?: NodeJS.ProcessEnv
  home?: string
  /** Electron's `shell.readShortcutLink` target (Windows). Without it, Start menu shortcuts are skipped. */
  readShortcutLink?: (path: string) => string | undefined
  /** Windows App Paths registrations, lower-cased executable name to path. Defaults to reading the registry. */
  readAppPaths?: () => Promise<Map<string, string>>
  /** A folder's entries; injectable so other platforms' layouts can be checked anywhere. */
  readDirectory?: (path: string) => Promise<DirectoryEntry[]>
}

export interface DirectoryEntry { name: string; directory: boolean }

async function readDirectory(path: string): Promise<DirectoryEntry[]> {
  return (await readdir(path, { withFileTypes: true })).map((entry) => ({ name: entry.name, directory: entry.isDirectory() }))
}

/** A command line read from a Linux .desktop entry, without its field codes. */
export interface DesktopLaunch { executable: string; args: string[] }

const CACHE_MS = 30_000
const MAX_SHORTCUT_DEPTH = 4
const MAX_SHORTCUT_ENTRIES = 4_000

/**
 * Where installed apps live, found without a shell: the macOS Applications
 * folders (also versioned names such as "IntelliJ IDEA 2026.1.app"), Windows
 * install roots, Start menu shortcuts, App Paths and scoop, and Linux PATH and
 * .desktop entries. It returns candidate paths; callers check each one.
 */
export class AppLocator {
  readonly platform: NodeJS.Platform
  readonly environment: NodeJS.ProcessEnv
  private shortcuts?: { at: number; index: Promise<Map<string, string[]>> }
  private readonly list: (path: string) => Promise<DirectoryEntry[]>
  private appPathIndex?: { at: number; index: Promise<Map<string, string>> }

  constructor(private readonly options: AppLocatorOptions = {}) {
    this.platform = options.platform ?? process.platform
    this.environment = options.environment ?? process.env
    this.list = options.readDirectory ?? readDirectory
  }

  private async names(path: string) {
    return (await this.list(path).catch(() => [] as DirectoryEntry[])).map(({ name }) => name)
  }

  get path() { return this.platform === 'win32' ? win32 : posix }

  env(name: string) {
    if (this.platform !== 'win32') return this.environment[name]
    const key = Object.keys(this.environment).find((entry) => entry.toLowerCase() === name.toLowerCase())
    return key === undefined ? undefined : this.environment[key]
  }

  private absolute(value: string | undefined) {
    return value && !/[\0\r\n]/.test(value) && this.path.isAbsolute(value) ? value : undefined
  }

  private home() { return this.absolute(this.options.home ?? this.env(this.platform === 'win32' ? 'USERPROFILE' : 'HOME') ?? homedir()) }

  pathDirectories() {
    return (this.env('PATH') ?? '').split(this.platform === 'win32' ? ';' : ':')
      .map((directory) => directory.replace(/^"|"$/g, ''))
      .filter((directory) => this.path.isAbsolute(directory)).slice(0, 128)
  }

  /** PATH entries for each name; on Windows a bare name means its .exe. */
  onPath(names: readonly string[]) {
    const files = names.flatMap((name) => this.platform === 'win32' && !win32.extname(name) ? [`${name}.exe`] : [name])
    return this.pathDirectories().flatMap((directory) => files.map((file) => this.path.join(directory, file)))
  }

  /** App bundles in /Applications and ~/Applications, by exact name or by a name prefix. */
  async macApplications(bundles: readonly string[], prefixes: readonly string[] = []) {
    const home = this.home()
    const roots = ['/Applications', ...(home ? [posix.join(home, 'Applications')] : [])]
    const exact = roots.flatMap((root) => bundles.map((bundle) => posix.join(root, bundle)))
    if (!prefixes.length) return exact
    const lowered = prefixes.map((prefix) => prefix.toLowerCase())
    const matched: string[] = []
    for (const root of roots) {
      for (const name of (await this.names(root)).sort()) {
        const lower = name.toLowerCase()
        if (lower.endsWith('.app') && lowered.some((prefix) => lower.startsWith(prefix))) matched.push(posix.join(root, name))
      }
    }
    return [...new Set([...exact, ...matched])]
  }

  private windowsRoots() {
    const local = this.absolute(this.env('LOCALAPPDATA'))
    return [...new Set([
      ...(local ? [win32.join(local, 'Programs')] : []),
      ...['ProgramFiles', 'ProgramW6432', 'ProgramFiles(x86)'].map((name) => this.absolute(this.env(name))).filter((root): root is string => Boolean(root)),
    ])]
  }

  /** Paths under the per-user and machine install roots (Programs, Program Files). */
  windowsPrograms(relative: ReadonlyArray<readonly string[]>) {
    return this.windowsRoots().flatMap((root) => relative.map((parts) => win32.join(root, ...parts)))
  }

  /** `<root>\<folder starting with prefix>\<relative>`, for versioned install folders such as JetBrains IDEs. */
  async windowsProgramFolders(prefixes: readonly string[], relative: ReadonlyArray<readonly string[]>, extraRoots: readonly string[] = []) {
    const roots = [...this.windowsRoots(), ...this.windowsRoots().map((root) => win32.join(root, 'JetBrains')), ...extraRoots]
    const lowered = prefixes.map((prefix) => prefix.toLowerCase())
    const found: string[] = []
    for (const root of roots) {
      for (const name of (await this.names(root)).sort().reverse()) {
        if (lowered.some((prefix) => name.toLowerCase().startsWith(prefix))) found.push(...relative.map((parts) => win32.join(root, name, ...parts)))
      }
    }
    return found
  }

  /** App execution aliases a Store app installs for this user. */
  windowsAppsAliases(names: readonly string[]) {
    const local = this.absolute(this.env('LOCALAPPDATA'))
    return local ? names.map((name) => win32.join(local, 'Microsoft', 'WindowsApps', name)) : []
  }

  /** scoop's current version of an app, per user and machine-wide. */
  scoop(entries: ReadonlyArray<readonly [app: string, relative: string]>) {
    const home = this.home()
    const roots = [
      this.absolute(this.env('SCOOP')) ?? (home ? win32.join(home, 'scoop') : undefined),
      this.absolute(this.env('SCOOP_GLOBAL')) ?? (this.absolute(this.env('ProgramData')) ? win32.join(this.env('ProgramData')!, 'scoop') : undefined),
    ].filter((root): root is string => Boolean(root))
    return roots.flatMap((root) => entries.map(([app, relative]) => win32.join(root, 'apps', app, 'current', relative)))
  }

  private shortcutIndex() {
    if (!this.shortcuts || Date.now() - this.shortcuts.at > CACHE_MS) {
      const roots = [this.env('APPDATA'), this.env('ProgramData')].map((root) => this.absolute(root))
        .filter((root): root is string => Boolean(root)).map((root) => win32.join(root, 'Microsoft', 'Windows', 'Start Menu', 'Programs'))
      this.shortcuts = { at: Date.now(), index: indexShortcuts(roots, this.list) }
    }
    return this.shortcuts.index
  }

  /** Targets of Start menu shortcuts with these file names ("Git Bash.lnk"). */
  async startMenu(names: readonly string[]) {
    if (this.platform !== 'win32' || !this.options.readShortcutLink || !names.length) return []
    const index = await this.shortcutIndex()
    const targets: string[] = []
    for (const name of names) {
      for (const shortcut of index.get(name.toLowerCase()) ?? []) {
        try {
          const target = this.absolute(this.options.readShortcutLink(shortcut))
          if (target) targets.push(target)
        } catch { /* A broken shortcut is skipped. */ }
      }
    }
    return targets
  }

  /** Paths registered for these executable names under App Paths. */
  async appPaths(executables: readonly string[]) {
    if (this.platform !== 'win32' || !executables.length) return []
    if (!this.appPathIndex || Date.now() - this.appPathIndex.at > CACHE_MS) {
      this.appPathIndex = { at: Date.now(), index: (this.options.readAppPaths ?? (() => this.readRegistryAppPaths()))().catch(() => new Map()) }
    }
    const index = await this.appPathIndex.index
    return executables.flatMap((name) => {
      const path = index.get(name.toLowerCase())
      return path && this.absolute(path) ? [path] : []
    })
  }

  private async readRegistryAppPaths() {
    const index = new Map<string, string>()
    const systemRoot = this.absolute(this.env('SystemRoot'))
    // reg.exe exists only on a real Windows host; never on a simulated one.
    if (process.platform !== 'win32' || !systemRoot) return index
    const registry = win32.join(systemRoot, 'System32', 'reg.exe')
    for (const hive of ['HKCU', 'HKLM']) {
      const output = await new Promise<string>((resolve) => {
        execFile(registry, ['query', `${hive}\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths`, '/s', '/ve'],
          { timeout: 5_000, windowsHide: true, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => resolve(error ? '' : stdout))
      })
      for (const [name, value] of parseAppPaths(output)) {
        const expanded = value.replace(/%([^%]+)%/g, (match, variable: string) => this.env(variable) ?? match)
        if (!index.has(name)) index.set(name, expanded)
      }
    }
    return index
  }

  /** Commands from .desktop entries in the XDG, Flatpak and Snap application folders. */
  async linuxDesktop(ids: readonly string[]): Promise<DesktopLaunch[]> {
    if (this.platform !== 'linux' || !ids.length) return []
    const home = this.home()
    const dataHome = this.absolute(this.env('XDG_DATA_HOME')) ?? (home ? posix.join(home, '.local', 'share') : undefined)
    // A desktop session lists Flatpak and Snap exports in XDG_DATA_DIRS; these defaults stand in when it is unset.
    const dataDirs = (this.env('XDG_DATA_DIRS') || '/usr/local/share:/usr/share:/var/lib/flatpak/exports/share:/var/lib/snapd/desktop')
      .split(':').filter((directory) => posix.isAbsolute(directory))
    const directories = [...new Set([
      ...(dataHome ? [posix.join(dataHome, 'applications'), posix.join(dataHome, 'flatpak', 'exports', 'share', 'applications')] : []),
      ...dataDirs.map((directory) => posix.join(directory, 'applications')),
    ])]
    const launches: DesktopLaunch[] = []
    for (const id of ids) {
      if (!/^[\w.@+-]+\.desktop$/.test(id)) continue
      for (const directory of directories) {
        const text = await readFile(posix.join(directory, id), 'utf8').catch(() => undefined)
        const launch = text ? desktopExec(text) : undefined
        if (launch) launches.push(launch)
      }
    }
    return launches
  }
}

async function indexShortcuts(roots: readonly string[], list: (path: string) => Promise<DirectoryEntry[]>) {
  const index = new Map<string, string[]>()
  let seen = 0
  const visit = async (directory: string, depth: number) => {
    if (depth > MAX_SHORTCUT_DEPTH || seen > MAX_SHORTCUT_ENTRIES) return
    const entries = await list(directory).catch(() => [] as DirectoryEntry[])
    for (const entry of entries) {
      if (++seen > MAX_SHORTCUT_ENTRIES) return
      const path = win32.join(directory, entry.name)
      if (entry.directory) await visit(path, depth + 1)
      else if (entry.name.toLowerCase().endsWith('.lnk')) {
        const key = entry.name.toLowerCase()
        index.set(key, [...(index.get(key) ?? []), path])
      }
    }
  }
  for (const root of roots) await visit(root, 0)
  return index
}

/** `reg query <App Paths> /s /ve` output: each key line, then its default value. */
export function parseAppPaths(output: string) {
  const entries: Array<[string, string]> = []
  let current: string | undefined
  for (const line of output.split(/\r?\n/)) {
    const key = /\\App Paths\\([^\\]+)$/i.exec(line.trim())
    if (key && !line.startsWith(' ')) { current = key[1]!.toLowerCase(); continue }
    const value = /^\s+.*?\s+REG_(?:EXPAND_)?SZ\s+(.+?)\s*$/.exec(line)
    if (current && value) {
      entries.push([current, value[1]!.replace(/^"(.*)"$/, '$1')])
      current = undefined
    }
  }
  return entries
}

/** The Exec line of a .desktop entry's main section, split as the spec says, without field codes. */
export function desktopExec(text: string): DesktopLaunch | undefined {
  let section = ''
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.startsWith('[')) { section = line; continue }
    if (section !== '[Desktop Entry]' || !line.startsWith('Exec=')) continue
    const tokens: string[] = []
    let token = ''
    let quoted = false
    let started = false
    const value = line.slice(5)
    for (let index = 0; index < value.length; index += 1) {
      const character = value[index]!
      if (quoted && character === '\\' && index + 1 < value.length) { token += value[++index]; continue }
      if (character === '"') { quoted = !quoted; started = true; continue }
      if (!quoted && /\s/.test(character)) {
        if (started || token) tokens.push(token)
        token = ''
        started = false
        continue
      }
      token += character
    }
    if (started || token) tokens.push(token)
    const args = tokens.filter((part) => !/^%[fFuUdDnNickvm]$/.test(part)).map((part) => part.replace(/%%/g, '%'))
    const [executable, ...rest] = args
    if (!executable || executable.includes('=') || /[\0\r\n]/.test(executable)) return undefined
    return { executable, args: rest.filter((part) => !part.includes('%')) }
  }
  return undefined
}
