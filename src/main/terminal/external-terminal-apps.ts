import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { access, readdir, realpath, stat } from 'node:fs/promises'
import { posix, win32 } from 'node:path'
import type { TerminalCustomExternalApp, TerminalExternalAdapter, TerminalExternalApp } from '../../shared/terminal-profiles'
import { AppLocator, type AppLocatorOptions } from '../editors/app-locator'
import { expandOpenArguments } from '../editors/open-arguments'
import { resolveWindowsAppExecutionAlias } from './windows-app-execution-alias'

export type ExternalTerminalErrorCode = 'TERMINAL_EXTERNAL_APP_UNAVAILABLE' | 'TERMINAL_CWD_UNAVAILABLE' | 'TERMINAL_EXTERNAL_LAUNCH_FAILED'

export class ExternalTerminalError extends Error {
  constructor(readonly code: ExternalTerminalErrorCode, message: string) {
    super(message)
    this.name = 'ExternalTerminalError'
  }
}

export interface ExternalTerminalAppsOptions {
  environment?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  /** Resolves an executable file, or a macOS application bundle, to its canonical path. */
  resolveExecutable?: (candidate: string) => Promise<string | undefined>
  launchExternal?: (file: string, args: string[], options?: { cwd?: string; helper?: boolean }) => Promise<void>
  /** Opens a URL with its registered app (Warp's `warp://` links on Windows and Linux). */
  openUri?: (uri: string) => Promise<void>
  /** Whether WSL has a distribution to open. Without it, WSL is not offered. */
  wslAvailable?: () => Promise<boolean>
  readShortcutLink?: AppLocatorOptions['readShortcutLink']
  readAppPaths?: AppLocatorOptions['readAppPaths']
}

/** Bundles whose main binary name is known; other bundles need any executable in Contents/MacOS. */
const MAC_BUNDLE_BINARIES: Partial<Record<TerminalExternalAdapter, string>> = {
  'mac-terminal': 'Terminal', 'mac-iterm': 'iTerm2', ghostty: 'ghostty',
}

const MAC_ADAPTERS = new Set<TerminalExternalAdapter>(['mac-terminal', 'mac-iterm', 'ghostty', 'warp', 'kitty', 'wezterm', 'alacritty', 'tabby', 'generic'])
const WINDOWS_ADAPTERS = new Set<TerminalExternalAdapter>([
  'windows-terminal', 'pwsh', 'windows-powershell', 'windows-cmd', 'git-bash', 'wsl', 'wezterm', 'alacritty', 'warp', 'tabby', 'cmder', 'generic',
])

const LINUX_APPS: { adapter: TerminalExternalAdapter; label: string; command: string }[] = [
  { adapter: 'kgx', label: 'Console', command: 'kgx' },
  { adapter: 'gnome-terminal', label: 'GNOME Terminal', command: 'gnome-terminal' },
  { adapter: 'konsole', label: 'Konsole', command: 'konsole' },
  { adapter: 'xfce4-terminal', label: 'Xfce Terminal', command: 'xfce4-terminal' },
  { adapter: 'mate-terminal', label: 'MATE Terminal', command: 'mate-terminal' },
  { adapter: 'tilix', label: 'Tilix', command: 'tilix' },
  { adapter: 'kitty', label: 'kitty', command: 'kitty' },
  { adapter: 'alacritty', label: 'Alacritty', command: 'alacritty' },
  { adapter: 'ghostty', label: 'Ghostty', command: 'ghostty' },
  { adapter: 'wezterm', label: 'WezTerm', command: 'wezterm' },
  { adapter: 'tabby', label: 'Tabby', command: 'tabby' },
]

/** An added app with no arguments of its own is opened like the known terminal it is, when its name says so. */
const KNOWN_NAMES: Record<string, TerminalExternalAdapter> = {
  terminal: 'mac-terminal', iterm: 'mac-iterm', iterm2: 'mac-iterm', ghostty: 'ghostty', warp: 'warp', kitty: 'kitty',
  wezterm: 'wezterm', 'wezterm-gui': 'wezterm', alacritty: 'alacritty', tabby: 'tabby', wt: 'windows-terminal', pwsh: 'pwsh',
  powershell: 'windows-powershell', cmd: 'windows-cmd', 'git-bash': 'git-bash', cmder: 'cmder', wsl: 'wsl', kgx: 'kgx',
  'gnome-terminal': 'gnome-terminal', konsole: 'konsole', 'xfce4-terminal': 'xfce4-terminal', 'mate-terminal': 'mate-terminal', tilix: 'tilix',
}

type ConsoleAdapter = 'windows-powershell' | 'pwsh' | 'windows-cmd' | 'wsl'

function windowsConsoleCommand(executable: string, cwd: string, adapter: ConsoleAdapter) {
  // Only Base64 data is inserted into this fixed script. The target receives
  // fixed arguments; neither path is interpreted as PowerShell or CMD source.
  const executableData = Buffer.from(executable, 'utf8').toString('base64')
  const directoryData = Buffer.from(cwd, 'utf8').toString('base64')
  // WSL starts in the Windows working directory it is given.
  const targetArguments = adapter === 'wsl' ? '' : ` -ArgumentList ${adapter === 'windows-cmd' ? "@('/K')" : "@('-NoLogo', '-NoExit')"}`
  const script = [
    'try {',
    `  $terminalExecutable = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${executableData}'))`,
    `  $terminalDirectory = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${directoryData}'))`,
    `  Start-Process -FilePath $terminalExecutable -WorkingDirectory $terminalDirectory${targetArguments} -WindowStyle Normal -ErrorAction Stop`,
    '  exit 0',
    '} catch {',
    '  [Console]::Error.WriteLine($_.Exception.Message)',
    '  exit 1',
    '}',
  ].join('\n')
  return ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')]
}

/** External app discovery is separate from the PTY shell inventory and never starts an app. */
export class ExternalTerminalApps {
  readonly platform: NodeJS.Platform
  readonly environment: NodeJS.ProcessEnv
  private detected?: Promise<TerminalExternalApp[]>
  private readonly locator: AppLocator

  constructor(private readonly options: ExternalTerminalAppsOptions = {}) {
    this.platform = options.platform ?? process.platform
    this.environment = options.environment ?? process.env
    this.locator = new AppLocator({ platform: this.platform, environment: this.environment, readShortcutLink: options.readShortcutLink, readAppPaths: options.readAppPaths })
  }

  private get path() { return this.platform === 'win32' ? win32 : posix }
  private identity(file: string) { return this.platform === 'win32' ? file.toLowerCase() : file }
  private env(name: string) {
    if (this.platform !== 'win32') return this.environment[name]
    const key = Object.keys(this.environment).find((entry) => entry.toLowerCase() === name.toLowerCase())
    return key === undefined ? undefined : this.environment[key]
  }

  private supports(adapter: TerminalExternalAdapter) {
    if (this.platform === 'darwin') return MAC_ADAPTERS.has(adapter)
    if (this.platform === 'win32') return WINDOWS_ADAPTERS.has(adapter)
    return this.platform === 'linux' && (adapter === 'generic' || LINUX_APPS.some((app) => app.adapter === adapter))
  }

  /** The launch recipe for an app: a generic one without arguments is opened like the terminal its name matches. */
  private adapterOf(app: { adapter: TerminalExternalAdapter; executable: string; args?: string[] }) {
    if (app.adapter !== 'generic' || app.args?.length) return app.adapter
    const name = this.path.basename(app.executable).replace(/\.(app|exe)$/i, '').toLowerCase()
    const known = KNOWN_NAMES[name]
    return known && this.supports(known) ? known : 'generic'
  }

  private terminalsOf(custom: readonly TerminalCustomExternalApp[]) {
    return custom.filter((app) => app.kind !== 'editor')
  }

  private async executable(candidate: string, adapter: TerminalExternalAdapter): Promise<string | undefined> {
    if (!candidate || candidate.length > 4_096 || /[\0\r\n]/.test(candidate) || !this.path.isAbsolute(candidate)) return undefined
    // Launch Services needs an application bundle, not its internal Mach-O binary.
    if (this.platform === 'darwin' && !candidate.endsWith('.app')) return undefined
    if (this.platform === 'win32' && !candidate.toLowerCase().endsWith('.exe')) return undefined
    try {
      if (this.options.resolveExecutable) return await this.options.resolveExecutable(candidate)
      let canonical: string
      try { canonical = await realpath(candidate) } catch {
        return this.platform === 'win32' ? resolveWindowsAppExecutionAlias(candidate, this.environment) : undefined
      }
      const details = await stat(canonical)
      if (this.platform === 'darwin') {
        if (!details.isDirectory()) return undefined
        const binary = MAC_BUNDLE_BINARIES[adapter]
        const directory = posix.join(canonical, 'Contents', 'MacOS')
        const binaries = binary ? [binary] : (await readdir(directory)).sort()
        let found = false
        for (const name of binaries) {
          const executable = posix.join(directory, name)
          try {
            if (!(await stat(executable)).isFile()) continue
            await access(executable, constants.X_OK)
            found = true
            break
          } catch { /* Try the next binary. */ }
        }
        if (!found) return undefined
      } else {
        if (!details.isFile()) return undefined
        await access(canonical, this.platform === 'win32' ? constants.F_OK : constants.X_OK)
      }
      return canonical
    } catch { return undefined }
  }

  private candidates(command: string, known: string[] = []) {
    const directories = (this.env('PATH') ?? '').split(this.platform === 'win32' ? ';' : ':')
      .map((directory) => directory.replace(/^"|"$/g, ''))
      .filter((directory) => this.path.isAbsolute(directory)).slice(0, 128)
    return [...new Set([...known, ...directories.map((directory) => this.path.join(directory, command))])]
  }

  private async resolveCustom(app: TerminalCustomExternalApp): Promise<TerminalExternalApp> {
    const adapter = this.adapterOf(app)
    const base = { id: app.id, label: app.name, source: 'custom' as const, adapter, executable: app.executable }
    if (!this.supports(adapter)) return { ...base, available: false, unavailableReason: 'unsupported-platform' }
    const absolute = this.path.isAbsolute(app.executable)
    const command = this.platform === 'win32' && !win32.extname(app.executable) ? `${app.executable}.exe` : app.executable
    const candidates = absolute ? [app.executable] : !/[\0\r\n/\\]/.test(command) ? this.candidates(command) : []
    for (const candidate of candidates) {
      const executable = await this.executable(candidate, adapter)
      if (executable) return { ...base, executable, available: true }
    }
    return { ...base, available: false, unavailableReason: 'executable-not-found' }
  }

  private async macDefinitions() {
    const bundles = (names: string[]) => this.locator.macApplications(names)
    return [
      { adapter: 'mac-terminal' as const, label: 'Terminal', candidates: ['/System/Applications/Utilities/Terminal.app', '/Applications/Utilities/Terminal.app', ...await bundles(['Terminal.app'])] },
      { adapter: 'mac-iterm' as const, label: 'iTerm2', candidates: await bundles(['iTerm.app', 'iTerm2.app']) },
      { adapter: 'ghostty' as const, label: 'Ghostty', candidates: await bundles(['Ghostty.app']) },
      { adapter: 'warp' as const, label: 'Warp', candidates: await bundles(['Warp.app']) },
      { adapter: 'kitty' as const, label: 'kitty', candidates: await bundles(['kitty.app']) },
      { adapter: 'wezterm' as const, label: 'WezTerm', candidates: await bundles(['WezTerm.app']) },
      { adapter: 'alacritty' as const, label: 'Alacritty', candidates: await bundles(['Alacritty.app']) },
      { adapter: 'tabby' as const, label: 'Tabby', candidates: await bundles(['Tabby.app']) },
    ]
  }

  private async windowsDefinitions() {
    const locator = this.locator
    const systemRoot = this.env('SystemRoot') ?? 'C:\\Windows'
    const programFiles = ['ProgramFiles', 'ProgramW6432'].map((name) => this.env(name)).filter((root): root is string => Boolean(root && win32.isAbsolute(root)))
    const cmderRoot = this.env('CMDER_ROOT')
    const found = async (executable: string, extra: { programs?: string[][]; shortcuts?: string[]; scoop?: Array<[string, string]>; known?: string[] }) => [
      ...(extra.known ?? []),
      ...this.candidates(executable),
      ...await locator.appPaths([executable]),
      ...locator.windowsPrograms(extra.programs ?? []),
      ...await locator.startMenu(extra.shortcuts ?? []),
      ...locator.scoop(extra.scoop ?? []),
    ]
    const definitions: { adapter: TerminalExternalAdapter; label: string; candidates: string[] }[] = [
      { adapter: 'windows-terminal', label: 'Windows Terminal', candidates: [...this.candidates('wt.exe', locator.windowsAppsAliases(['wt.exe'])), ...locator.scoop([['windows-terminal', 'wt.exe']])] },
      { adapter: 'pwsh', label: 'PowerShell', candidates: await found('pwsh.exe', {
        known: [...programFiles.flatMap((root) => ['7', '7-preview'].map((version) => win32.join(root, 'PowerShell', version, 'pwsh.exe'))), ...locator.windowsAppsAliases(['pwsh.exe'])],
        scoop: [['pwsh', 'pwsh.exe']],
      }) },
      { adapter: 'windows-powershell', label: 'Windows PowerShell', candidates: this.candidates('powershell.exe', [win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')]) },
      { adapter: 'windows-cmd', label: 'Command Prompt (CMD)', candidates: this.candidates('cmd.exe', [win32.join(systemRoot, 'System32', 'cmd.exe')]) },
      { adapter: 'git-bash', label: 'Git Bash', candidates: await found('git-bash.exe', { programs: [['Git', 'git-bash.exe']], shortcuts: ['Git Bash.lnk'], scoop: [['git', 'git-bash.exe']] }) },
      ...await this.options.wslAvailable?.().catch(() => false)
        ? [{ adapter: 'wsl' as const, label: 'WSL', candidates: [win32.join(systemRoot, 'System32', 'wsl.exe'), ...locator.windowsAppsAliases(['wsl.exe'])] }] : [],
      { adapter: 'wezterm', label: 'WezTerm', candidates: await found('wezterm-gui.exe', { programs: [['WezTerm', 'wezterm-gui.exe']], shortcuts: ['WezTerm.lnk'], scoop: [['wezterm', 'wezterm-gui.exe']] }) },
      { adapter: 'alacritty', label: 'Alacritty', candidates: await found('alacritty.exe', { programs: [['Alacritty', 'alacritty.exe']], shortcuts: ['Alacritty.lnk'], scoop: [['alacritty', 'alacritty.exe']] }) },
      { adapter: 'warp', label: 'Warp', candidates: await found('warp.exe', { programs: [['Warp', 'warp.exe']], shortcuts: ['Warp.lnk'] }) },
      { adapter: 'tabby', label: 'Tabby', candidates: await found('Tabby.exe', { programs: [['Tabby', 'Tabby.exe']], shortcuts: ['Tabby.lnk'], scoop: [['tabby', 'Tabby.exe']] }) },
      { adapter: 'cmder', label: 'Cmder', candidates: await found('Cmder.exe', {
        known: [...(cmderRoot && win32.isAbsolute(cmderRoot) ? [win32.join(cmderRoot, 'Cmder.exe')] : []), 'C:\\tools\\cmder\\Cmder.exe'],
        shortcuts: ['Cmder.lnk'], scoop: [['cmder', 'Cmder.exe'], ['cmder-full', 'Cmder.exe']],
      }) },
    ]
    return definitions
  }

  private async discover(): Promise<TerminalExternalApp[]> {
    const definitions: { adapter: TerminalExternalAdapter; label: string; candidates: string[] }[] = []
    if (this.platform === 'darwin') {
      definitions.push(...await this.macDefinitions())
    } else if (this.platform === 'win32') {
      definitions.push(...await this.windowsDefinitions())
    } else if (this.platform === 'linux') {
      definitions.push(...LINUX_APPS.map(({ adapter, label, command }) => ({ adapter, label, candidates: this.candidates(command, [`/usr/bin/${command}`, `/usr/local/bin/${command}`]) })))
    }
    const apps: TerminalExternalApp[] = []
    const seen = new Set<string>()
    for (const definition of definitions) {
      for (const candidate of definition.candidates) {
        const executable = await this.executable(candidate, definition.adapter)
        if (!executable || seen.has(this.identity(executable))) continue
        seen.add(this.identity(executable))
        const id = `external:detected:${createHash('sha256').update(`${definition.adapter}:${this.identity(executable)}`).digest('hex').slice(0, 32)}`
        apps.push({ id, label: definition.label, source: 'detected', adapter: definition.adapter, executable, available: true })
      }
    }
    const labels = new Map<string, number>()
    for (const app of apps) labels.set(app.label, (labels.get(app.label) ?? 0) + 1)
    return apps.map((app) => (labels.get(app.label) ?? 0) > 1 ? { ...app, label: `${app.label} · ${this.path.dirname(app.executable)}`.slice(0, 128) } : app)
  }

  private inventory(refresh = false) {
    if (refresh || !this.detected) {
      const pending = this.discover()
      this.detected = pending
      void pending.catch(() => { if (this.detected === pending) this.detected = undefined })
    }
    return this.detected
  }

  async list(custom: TerminalCustomExternalApp[] = [], refresh = false): Promise<TerminalExternalApp[]> {
    const [detected, configured] = await Promise.all([this.inventory(refresh), Promise.all(this.terminalsOf(custom).map((app) => this.resolveCustom(app)))])
    return [...detected.map((app) => ({ ...app })), ...configured]
  }

  /** cwd is resolved and checked against the active project by the caller. */
  async open(appId: string | undefined, cwd: string, custom: TerminalCustomExternalApp[] = [], beforeLaunch?: () => Promise<void>): Promise<{ appId: string }> {
    if (!cwd || cwd.length > 4_096 || cwd.includes('\0') || !this.path.isAbsolute(cwd)) {
      throw new ExternalTerminalError('TERMINAL_CWD_UNAVAILABLE', 'The external terminal needs an absolute working directory.')
    }
    const configured = this.terminalsOf(custom).find((app) => app.id === appId)
    const candidates = configured ? [await this.resolveCustom(configured)] : (await this.inventory()).filter((app) => appId === undefined || app.id === appId)
    let app: TerminalExternalApp | undefined = candidates[0]
    let executable: string | undefined
    if (appId === undefined) {
      app = undefined
      // Automatic selection can move to another installed app. An explicit
      // selection below never silently changes the user's chosen application.
      for (const candidate of candidates) {
        if (!candidate.available || !this.supports(candidate.adapter)) continue
        executable = await this.executable(candidate.executable, candidate.adapter)
        if (executable) { app = candidate; break }
      }
    }
    if (!app) throw new ExternalTerminalError('TERMINAL_EXTERNAL_APP_UNAVAILABLE', appId ? 'The selected external terminal is no longer available. Refresh the application list or choose another terminal.' : 'No supported external terminal application was found.')
    if (!this.supports(app.adapter)) throw new ExternalTerminalError('TERMINAL_EXTERNAL_APP_UNAVAILABLE', `${app.label} is not supported on this platform.`)
    if (appId !== undefined) executable = app.available ? await this.executable(app.executable, app.adapter) : undefined
    if (!executable) throw new ExternalTerminalError('TERMINAL_EXTERNAL_APP_UNAVAILABLE', `${app.label} could not be found. Refresh the application list or update its path.`)

    let file = executable
    let args: string[]
    let helper = false
    const templated = configured?.args?.length ? expandOpenArguments(configured.args, { path: cwd, dir: cwd }) : undefined
    if (app.adapter === 'warp' && this.platform !== 'darwin') {
      // Warp opens a folder through its documented link, not a command line.
      await beforeLaunch?.()
      try {
        await (this.options.openUri ?? defaultOpenUri)(`warp://action/new_window?path=${encodeURIComponent(cwd)}`)
      } catch (error) {
        throw new ExternalTerminalError('TERMINAL_EXTERNAL_LAUNCH_FAILED', `Could not open ${app.label}: ${error instanceof Error ? error.message : 'the application could not be started'}`)
      }
      return { appId: app.id }
    }
    if (this.platform === 'darwin') {
      file = '/usr/bin/open'
      // Terminal, iTerm2, Warp and kitty handle directory-open events themselves. No shell
      // script, typing into an existing session, or Automation permission is needed.
      switch (app.adapter) {
        case 'ghostty': args = ['-n', '-a', executable, '--args', `--working-directory=${cwd}`, '--window-inherit-working-directory=false', '--window-save-state=never']; break
        case 'wezterm': args = ['-n', '-a', executable, '--args', 'start', '--cwd', cwd]; break
        case 'alacritty': args = ['-n', '-a', executable, '--args', '--working-directory', cwd]; break
        case 'tabby': args = ['-n', '-a', executable, '--args', 'open', cwd]; break
        default: args = templated ? ['-n', '-a', executable, '--args', ...templated] : ['-a', executable, cwd]
      }
    } else {
      switch (app.adapter) {
        case 'windows-terminal':
          // wt parses command delimiters inside argv too. Its documented parser
          // removes one backslash before each escaped semicolon.
          args = ['-w', 'new', 'new-tab', '-d', cwd.replace(/;/g, '\\;')]
          break
        case 'windows-powershell':
        case 'pwsh':
        case 'wsl':
        case 'windows-cmd':
          if (app.adapter === 'windows-cmd' && !/^[a-z]:[\\/]/i.test(cwd)) throw new ExternalTerminalError('TERMINAL_CWD_UNAVAILABLE', 'Command Prompt cannot start in a network directory. Choose Windows Terminal or PowerShell.')
          // A detached Node child has no interactive console. A short-lived,
          // hidden system PowerShell asks Windows to create a visible window.
          file = await this.executable(win32.join(this.env('SystemRoot') ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), 'windows-powershell') ?? ''
          if (!file) throw new ExternalTerminalError('TERMINAL_EXTERNAL_APP_UNAVAILABLE', 'System Windows PowerShell is required to open a new console window and could not be found.')
          args = windowsConsoleCommand(executable, cwd, app.adapter)
          helper = true
          break
        case 'git-bash': args = [`--cd=${cwd}`]; break
        case 'cmder': args = ['/START', cwd]; break
        case 'tabby': args = ['open', cwd]; break
        case 'wezterm': args = ['start', '--cwd', cwd]; break
        case 'gnome-terminal': args = ['--window', `--working-directory=${cwd}`]; break
        case 'konsole': args = ['--workdir', cwd]; break
        case 'xfce4-terminal': args = ['--window', `--working-directory=${cwd}`]; break
        case 'mate-terminal': args = ['--window', `--working-directory=${cwd}`]; break
        case 'kgx':
        case 'tilix': args = [`--working-directory=${cwd}`]; break
        case 'kitty': args = ['--directory', cwd]; break
        case 'alacritty': args = ['--working-directory', cwd]; break
        case 'ghostty': args = [`--working-directory=${cwd}`, '--window-inherit-working-directory=false', '--gtk-single-instance=false']; break
        case 'generic': args = templated ?? []; break
        default: throw new ExternalTerminalError('TERMINAL_EXTERNAL_APP_UNAVAILABLE', `${app.label} is not supported on this platform.`)
      }
    }
    await beforeLaunch?.()
    try {
      if (this.options.launchExternal) await this.options.launchExternal(file, args, { cwd, ...(helper ? { helper } : {}) })
      else await this.launch(file, args, cwd, helper)
    } catch (error) {
      throw new ExternalTerminalError('TERMINAL_EXTERNAL_LAUNCH_FAILED', `Could not open ${app.label}: ${error instanceof Error ? error.message : 'the application could not be started'}`)
    }
    return { appId: app.id }
  }

  private launch(file: string, args: string[], cwd: string, helper: boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(file, args, { cwd, env: this.environment, shell: false, detached: !helper, stdio: 'ignore', windowsHide: helper })
      // Launch Services and the Windows console helper exit after handoff.
      // Other apps may remain alive for the GUI session; observe initial failure.
      const isLauncher = this.platform === 'darwin' || helper
      let settled = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const finish = (error?: Error) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        child.unref()
        if (error) reject(error)
        else resolve()
      }
      child.once('error', finish)
      child.once('exit', (code, signal) => finish(code === 0 ? undefined : new Error(signal ? `Application exited with signal ${signal}.` : `Application exited with code ${code}.`)))
      child.once('spawn', () => {
        timer = setTimeout(() => {
          if (isLauncher) {
            child.kill()
            finish(new Error('Timed out while asking the system to open the terminal.'))
          } else finish()
        }, isLauncher ? 5_000 : 300)
      })
    })
  }
}

async function defaultOpenUri(uri: string) {
  const { shell } = await import('electron')
  await shell.openExternal(uri)
}
