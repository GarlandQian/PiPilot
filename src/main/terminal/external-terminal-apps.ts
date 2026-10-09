import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { access, realpath, stat } from 'node:fs/promises'
import { posix, win32 } from 'node:path'
import type { TerminalCustomExternalApp, TerminalExternalAdapter, TerminalExternalApp } from '../../shared/terminal-profiles'
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
}

const MAC_BUNDLE_BINARIES: Partial<Record<TerminalExternalAdapter, string>> = {
  'mac-terminal': 'Terminal', 'mac-iterm': 'iTerm2', ghostty: 'ghostty',
}

const LINUX_APPS: { adapter: TerminalExternalAdapter; label: string; command: string }[] = [
  { adapter: 'gnome-terminal', label: 'GNOME Terminal', command: 'gnome-terminal' },
  { adapter: 'konsole', label: 'Konsole', command: 'konsole' },
  { adapter: 'xfce4-terminal', label: 'Xfce Terminal', command: 'xfce4-terminal' },
  { adapter: 'kitty', label: 'kitty', command: 'kitty' },
  { adapter: 'alacritty', label: 'Alacritty', command: 'alacritty' },
  { adapter: 'ghostty', label: 'Ghostty', command: 'ghostty' },
]

function windowsConsoleCommand(executable: string, cwd: string, adapter: 'windows-powershell' | 'windows-cmd') {
  // Only Base64 data is inserted into this fixed script. The target receives
  // fixed arguments; neither path is interpreted as PowerShell or CMD source.
  const executableData = Buffer.from(executable, 'utf8').toString('base64')
  const directoryData = Buffer.from(cwd, 'utf8').toString('base64')
  const targetArguments = adapter === 'windows-powershell' ? "@('-NoLogo', '-NoExit')" : "@('/K')"
  const script = [
    'try {',
    `  $terminalExecutable = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${executableData}'))`,
    `  $terminalDirectory = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${directoryData}'))`,
    `  Start-Process -FilePath $terminalExecutable -WorkingDirectory $terminalDirectory -ArgumentList ${targetArguments} -WindowStyle Normal -ErrorAction Stop`,
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

  constructor(private readonly options: ExternalTerminalAppsOptions = {}) {
    this.platform = options.platform ?? process.platform
    this.environment = options.environment ?? process.env
  }

  private get path() { return this.platform === 'win32' ? win32 : posix }
  private identity(file: string) { return this.platform === 'win32' ? file.toLowerCase() : file }
  private env(name: string) {
    if (this.platform !== 'win32') return this.environment[name]
    const key = Object.keys(this.environment).find((entry) => entry.toLowerCase() === name.toLowerCase())
    return key === undefined ? undefined : this.environment[key]
  }

  private supports(adapter: TerminalExternalAdapter) {
    if (this.platform === 'darwin') return adapter === 'mac-terminal' || adapter === 'mac-iterm' || adapter === 'ghostty'
    if (this.platform === 'win32') return adapter === 'windows-terminal' || adapter === 'windows-powershell' || adapter === 'windows-cmd'
    return this.platform === 'linux' && LINUX_APPS.some((app) => app.adapter === adapter)
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
        const binary = MAC_BUNDLE_BINARIES[adapter]
        if (!details.isDirectory() || !binary) return undefined
        const executable = posix.join(canonical, 'Contents', 'MacOS', binary)
        if (!(await stat(executable)).isFile()) return undefined
        await access(executable, constants.X_OK)
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
    const base = { id: app.id, label: app.name, source: 'custom' as const, adapter: app.adapter, executable: app.executable }
    if (!this.supports(app.adapter)) return { ...base, available: false, unavailableReason: 'unsupported-platform' }
    const absolute = this.path.isAbsolute(app.executable)
    const command = this.platform === 'win32' && !win32.extname(app.executable) ? `${app.executable}.exe` : app.executable
    const candidates = absolute ? [app.executable] : !/[\0\r\n/\\]/.test(command) ? this.candidates(command) : []
    for (const candidate of candidates) {
      const executable = await this.executable(candidate, app.adapter)
      if (executable) return { ...base, executable, available: true }
    }
    return { ...base, available: false, unavailableReason: 'executable-not-found' }
  }

  private async discover(): Promise<TerminalExternalApp[]> {
    const definitions: { adapter: TerminalExternalAdapter; label: string; candidates: string[] }[] = []
    if (this.platform === 'darwin') {
      const userApplications = this.env('HOME') && posix.isAbsolute(this.env('HOME')!) ? posix.join(this.env('HOME')!, 'Applications') : undefined
      const roots = ['/Applications', ...(userApplications ? [userApplications] : [])]
      definitions.push(
        { adapter: 'mac-terminal', label: 'Terminal', candidates: ['/System/Applications/Utilities/Terminal.app', '/Applications/Utilities/Terminal.app', ...roots.map((root) => posix.join(root, 'Terminal.app'))] },
        { adapter: 'mac-iterm', label: 'iTerm2', candidates: roots.flatMap((root) => ['iTerm.app', 'iTerm2.app'].map((name) => posix.join(root, name))) },
        { adapter: 'ghostty', label: 'Ghostty', candidates: roots.map((root) => posix.join(root, 'Ghostty.app')) },
      )
    } else if (this.platform === 'win32') {
      const local = this.env('LOCALAPPDATA')
      const systemRoot = this.env('SystemRoot') ?? 'C:\\Windows'
      definitions.push(
        { adapter: 'windows-terminal', label: 'Windows Terminal', candidates: this.candidates('wt.exe', local ? [win32.join(local, 'Microsoft', 'WindowsApps', 'wt.exe')] : []) },
        { adapter: 'windows-powershell', label: 'Windows PowerShell', candidates: this.candidates('powershell.exe', [win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')]) },
        { adapter: 'windows-cmd', label: 'Command Prompt (CMD)', candidates: this.candidates('cmd.exe', [win32.join(systemRoot, 'System32', 'cmd.exe')]) },
      )
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
    const [detected, configured] = await Promise.all([this.inventory(refresh), Promise.all(custom.map((app) => this.resolveCustom(app)))])
    return [...detected.map((app) => ({ ...app })), ...configured]
  }

  /** cwd is resolved and checked against the active project by the caller. */
  async open(appId: string | undefined, cwd: string, custom: TerminalCustomExternalApp[] = [], beforeLaunch?: () => Promise<void>): Promise<{ appId: string }> {
    if (!cwd || cwd.length > 4_096 || cwd.includes('\0') || !this.path.isAbsolute(cwd)) {
      throw new ExternalTerminalError('TERMINAL_CWD_UNAVAILABLE', 'The external terminal needs an absolute working directory.')
    }
    const configured = custom.find((app) => app.id === appId)
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
    if (this.platform === 'darwin') {
      file = '/usr/bin/open'
      // Terminal and iTerm2 handle directory-open events themselves. No shell
      // script, typing into an existing session, or Automation permission is needed.
      args = app.adapter === 'ghostty'
        ? ['-n', '-a', executable, '--args', `--working-directory=${cwd}`, '--window-inherit-working-directory=false', '--window-save-state=never']
        : ['-a', executable, cwd]
    } else {
      switch (app.adapter) {
        case 'windows-terminal':
          // wt parses command delimiters inside argv too. Its documented parser
          // removes one backslash before each escaped semicolon.
          args = ['-w', 'new', 'new-tab', '-d', cwd.replace(/;/g, '\\;')]
          break
        case 'windows-powershell':
        case 'windows-cmd':
          if (app.adapter === 'windows-cmd' && !/^[a-z]:[\\/]/i.test(cwd)) throw new ExternalTerminalError('TERMINAL_CWD_UNAVAILABLE', 'Command Prompt cannot start in a network directory. Choose Windows Terminal or PowerShell.')
          // A detached Node child has no interactive console. A short-lived,
          // hidden system PowerShell asks Windows to create a visible window.
          file = await this.executable(win32.join(this.env('SystemRoot') ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), 'windows-powershell') ?? ''
          if (!file) throw new ExternalTerminalError('TERMINAL_EXTERNAL_APP_UNAVAILABLE', 'System Windows PowerShell is required to open a new console window and could not be found.')
          args = windowsConsoleCommand(executable, cwd, app.adapter)
          helper = true
          break
        case 'gnome-terminal': args = ['--window', `--working-directory=${cwd}`]; break
        case 'konsole': args = ['--workdir', cwd]; break
        case 'xfce4-terminal': args = ['--window', `--working-directory=${cwd}`]; break
        case 'kitty': args = ['--directory', cwd]; break
        case 'alacritty': args = ['--working-directory', cwd]; break
        case 'ghostty': args = [`--working-directory=${cwd}`, '--window-inherit-working-directory=false', '--gtk-single-instance=false']; break
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
