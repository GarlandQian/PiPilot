import { spawn, execFile } from 'node:child_process'
import { access, constants, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { posix, win32 } from 'node:path'
import type { ExternalEditor } from '../../shared/external-editors'
import type { TerminalCustomExternalApp } from '../../shared/terminal-profiles'
import { AppLocator, type AppLocatorOptions } from './app-locator'
import { expandOpenArguments } from './open-arguments'

/** How an editor takes a line: `-g path:line`, `path:line`, `--line N path`, Xcode's xed, `+line path`, or not at all. */
type GotoStyle = 'vscode' | 'colon' | 'jetbrains' | 'xcode' | 'plus' | 'none'

interface EditorCandidate {
  id: string
  name: string
  goto: GotoStyle
  /** Opens folders only (GitHub Desktop): a file opens its folder. */
  folderOnly?: boolean
  /** macOS bundles (also by name prefix), and the CLI inside one that understands line numbers. */
  mac?: { apps: string[]; prefixes?: string[]; cli?: string }
  /**
   * Windows: PATH / App Paths names (a CLI shim in `bin` resolves to the app
   * next to it, `exe`), folders under the install roots, versioned install
   * folders, Start menu shortcuts and scoop apps.
   */
  windows?: {
    commands?: string[]
    exe?: string
    programs?: string[][]
    folders?: { prefixes: string[]; relative: string[][] }
    shortcuts?: string[]
    scoop?: Array<[string, string]>
  }
  linux?: { commands: string[]; desktop?: string[] }
}

const VSCODE_CLI = 'Contents/Resources/app/bin'
const jetbrains = (id: string, name: string, prefix: string, command: string, desktop: string[]): EditorCandidate => ({
  id, name, goto: 'jetbrains',
  mac: { apps: [], prefixes: [prefix] },
  windows: { commands: [`${command}64`, command], folders: { prefixes: [prefix], relative: [['bin', `${command}64.exe`]] }, shortcuts: [`${prefix}.lnk`] },
  linux: { commands: [command], desktop },
})

/** The editors "Open in" knows, in the order Codex lists them. */
const CANDIDATES: readonly EditorCandidate[] = [
  { id: 'vscode', name: 'VS Code', goto: 'vscode',
    mac: { apps: ['Visual Studio Code.app', 'Code.app'], cli: `${VSCODE_CLI}/code` },
    windows: { commands: ['code'], exe: 'Code.exe', programs: [['Microsoft VS Code', 'Code.exe']], shortcuts: ['Visual Studio Code.lnk'], scoop: [['vscode', 'Code.exe']] },
    linux: { commands: ['code', 'code-oss'], desktop: ['code.desktop', 'code-oss.desktop', 'com.visualstudio.code.desktop', 'code_code.desktop'] } },
  { id: 'vscode-insiders', name: 'VS Code Insiders', goto: 'vscode',
    mac: { apps: ['Visual Studio Code - Insiders.app', 'Code - Insiders.app'], cli: `${VSCODE_CLI}/code-insiders` },
    windows: { commands: ['code-insiders'], exe: 'Code - Insiders.exe', programs: [['Microsoft VS Code Insiders', 'Code - Insiders.exe']], shortcuts: ['Visual Studio Code - Insiders.lnk'] },
    linux: { commands: ['code-insiders'], desktop: ['code-insiders.desktop'] } },
  { id: 'cursor', name: 'Cursor', goto: 'vscode',
    mac: { apps: ['Cursor.app'], cli: `${VSCODE_CLI}/cursor` },
    windows: { commands: ['cursor'], exe: 'Cursor.exe', programs: [['cursor', 'Cursor.exe'], ['Cursor', 'Cursor.exe']], shortcuts: ['Cursor.lnk'] },
    linux: { commands: ['cursor'], desktop: ['cursor.desktop'] } },
  { id: 'windsurf', name: 'Windsurf', goto: 'vscode',
    mac: { apps: ['Windsurf.app'], cli: `${VSCODE_CLI}/windsurf` },
    windows: { commands: ['windsurf'], exe: 'Windsurf.exe', programs: [['Windsurf', 'Windsurf.exe']], shortcuts: ['Windsurf.lnk'] },
    linux: { commands: ['windsurf'], desktop: ['windsurf.desktop'] } },
  { id: 'antigravity', name: 'Antigravity', goto: 'vscode',
    mac: { apps: ['Antigravity.app'], cli: `${VSCODE_CLI}/antigravity` },
    windows: { commands: ['antigravity'], exe: 'Antigravity.exe', programs: [['Antigravity', 'Antigravity.exe']], shortcuts: ['Antigravity.lnk'] },
    linux: { commands: ['antigravity-ide', 'antigravity'], desktop: ['antigravity-ide.desktop'] } },
  { id: 'devin', name: 'Devin Desktop', goto: 'vscode', mac: { apps: ['Devin.app'], cli: `${VSCODE_CLI}/devin-desktop` } },
  { id: 'zed', name: 'Zed', goto: 'colon',
    mac: { apps: ['Zed.app', 'Zed Preview.app'], cli: 'Contents/MacOS/cli' },
    windows: { commands: ['zed'], exe: 'Zed.exe', programs: [['Zed', 'Zed.exe']], shortcuts: ['Zed.lnk'], scoop: [['zed', 'zed.exe']] },
    linux: { commands: ['zed', 'zeditor'], desktop: ['dev.zed.Zed.desktop', 'dev.zed.Zed-Preview.desktop', 'zed.desktop'] } },
  { id: 'sublime', name: 'Sublime Text', goto: 'colon',
    mac: { apps: ['Sublime Text.app'], cli: 'Contents/SharedSupport/bin/subl' },
    windows: { commands: ['subl'], exe: 'sublime_text.exe', programs: [['Sublime Text', 'subl.exe'], ['Sublime Text 3', 'subl.exe']], shortcuts: ['Sublime Text.lnk'], scoop: [['sublime-text', 'subl.exe']] },
    linux: { commands: ['subl', 'sublime_text'], desktop: ['sublime_text.desktop', 'com.sublimetext.three.desktop', 'sublime-text_subl.desktop'] } },
  { id: 'xcode', name: 'Xcode', goto: 'xcode', mac: { apps: ['Xcode.app'], prefixes: ['Xcode'] } },
  jetbrains('intellij', 'IntelliJ IDEA', 'IntelliJ IDEA', 'idea', ['jetbrains-idea.desktop', 'jetbrains-idea-ce.desktop', 'intellij-idea-ultimate_intellij-idea-ultimate.desktop', 'com.jetbrains.IntelliJ-IDEA-Ultimate.desktop']),
  jetbrains('rider', 'Rider', 'Rider', 'rider', ['jetbrains-rider.desktop', 'rider_rider.desktop', 'com.jetbrains.Rider.desktop']),
  jetbrains('goland', 'GoLand', 'GoLand', 'goland', ['jetbrains-goland.desktop', 'goland_goland.desktop', 'com.jetbrains.GoLand.desktop']),
  jetbrains('rustrover', 'RustRover', 'RustRover', 'rustrover', ['jetbrains-rustrover.desktop', 'rustrover_rustrover.desktop', 'com.jetbrains.RustRover.desktop']),
  jetbrains('pycharm', 'PyCharm', 'PyCharm', 'pycharm', ['jetbrains-pycharm.desktop', 'jetbrains-pycharm-ce.desktop', 'pycharm-professional_pycharm-professional.desktop', 'com.jetbrains.PyCharm-Professional.desktop']),
  jetbrains('webstorm', 'WebStorm', 'WebStorm', 'webstorm', ['jetbrains-webstorm.desktop', 'webstorm_webstorm.desktop', 'com.jetbrains.WebStorm.desktop']),
  jetbrains('phpstorm', 'PhpStorm', 'PhpStorm', 'phpstorm', ['jetbrains-phpstorm.desktop', 'phpstorm_phpstorm.desktop', 'com.jetbrains.PhpStorm.desktop']),
  { ...jetbrains('android-studio', 'Android Studio', 'Android Studio', 'studio', ['jetbrains-studio.desktop', 'android-studio.desktop', 'com.google.AndroidStudio.desktop']),
    windows: { commands: ['studio64', 'studio'], programs: [['Android', 'Android Studio', 'bin', 'studio64.exe']], folders: { prefixes: ['Android Studio'], relative: [['bin', 'studio64.exe']] }, shortcuts: ['Android Studio.lnk'] },
    linux: { commands: ['studio', 'android-studio'], desktop: ['jetbrains-studio.desktop', 'android-studio.desktop', 'com.google.AndroidStudio.desktop'] } },
  { id: 'visual-studio', name: 'Visual Studio', goto: 'none',
    windows: { commands: ['devenv'], programs: ['2022', '2019', '2017'].flatMap((year) => ['Community', 'Professional', 'Enterprise', 'Preview']
      .map((edition) => ['Microsoft Visual Studio', year, edition, 'Common7', 'IDE', 'devenv.exe'])) } },
  { id: 'github-desktop', name: 'GitHub Desktop', goto: 'none', folderOnly: true,
    mac: { apps: ['GitHub Desktop.app'] },
    windows: { commands: ['github'], exe: 'GitHubDesktop.exe', programs: [['GitHubDesktop', 'GitHubDesktop.exe'], ['GitHub Desktop', 'GitHubDesktop.exe']], shortcuts: ['GitHub Desktop.lnk'] } },
  { id: 'nova', name: 'Nova', goto: 'none', mac: { apps: ['Nova.app'] } },
  { id: 'bbedit', name: 'BBEdit', goto: 'none', mac: { apps: ['BBEdit.app'], prefixes: ['BBEdit'] } },
  { id: 'textmate', name: 'TextMate', goto: 'none', mac: { apps: ['TextMate.app'] } },
  { id: 'emacs', name: 'Emacs', goto: 'plus', mac: { apps: ['Emacs.app'] }, linux: { commands: ['emacs'], desktop: ['emacs.desktop', 'org.gnu.emacs.desktop'] } },
]

interface Located { candidate: EditorCandidate; app?: string; executable?: string; baseArgs?: string[] }

async function pathExists(path: string) {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function executableFile(path: string, platform: NodeJS.Platform) {
  try {
    if (!(await stat(path)).isFile()) return false
    await access(path, platform === 'win32' ? constants.F_OK : constants.X_OK)
    return true
  } catch {
    return false
  }
}

function expandWindows(path: string, env: NodeJS.ProcessEnv) {
  return path.replace(/%([^%]+)%/gu, (match, name: string) => env[name] ?? env[name.toUpperCase()] ?? match)
}

/**
 * Editors installed on this computer, found without running a shell: macOS
 * app bundles, Windows install folders, PATH, App Paths, Start menu and scoop,
 * Linux PATH and .desktop entries. Editors the user added come after them.
 */
export class ExternalEditors {
  private located: Promise<Located[]> | undefined
  private locatedAt = 0
  private readonly locator: AppLocator

  constructor(private readonly options: {
    platform?: NodeJS.Platform
    env?: NodeJS.ProcessEnv
    home?: string
    openPath(path: string): Promise<string>
    showItemInFolder(path: string): void
    /** The icon a file or app bundle shows in Finder or File Explorer. */
    iconFor?(path: string): Promise<string | undefined>
    /** Apps added in Settings; the editors among them appear here. */
    customApps?(): readonly TerminalCustomExternalApp[]
    readShortcutLink?: AppLocatorOptions['readShortcutLink']
    readAppPaths?: AppLocatorOptions['readAppPaths']
    readDirectory?: AppLocatorOptions['readDirectory']
    /** Whether a path exists, and whether it is a runnable file; injectable so other platforms' layouts can be checked anywhere. */
    pathExists?(path: string): Promise<boolean>
    isExecutableFile?(path: string): Promise<boolean>
  }) {
    this.locator = new AppLocator({
      platform: this.platform, environment: this.env, home: options.home ?? homedir(),
      readShortcutLink: options.readShortcutLink, readAppPaths: options.readAppPaths, readDirectory: options.readDirectory,
    })
  }

  private exists(path: string) { return this.options.pathExists ? this.options.pathExists(path) : pathExists(path) }
  private isExecutableFile(path: string, platform = this.platform) {
    return this.options.isExecutableFile ? this.options.isExecutableFile(path) : executableFile(path, platform)
  }

  private readonly icons = new Map<string, Promise<string | undefined>>()

  private icon(path: string | undefined) {
    if (!path || !this.options.iconFor) return Promise.resolve(undefined)
    let icon = this.icons.get(path)
    if (!icon) {
      icon = this.options.iconFor(path).catch(() => undefined)
      this.icons.set(path, icon)
    }
    return icon
  }

  private fileManagerPath() {
    if (this.platform === 'darwin') return '/System/Library/CoreServices/Finder.app'
    if (this.platform === 'win32') return expandWindows('%SystemRoot%\\explorer.exe', this.env)
    return undefined
  }

  private get platform() { return this.options.platform ?? process.platform }
  private get env() { return this.options.env ?? process.env }

  /** Every menu opening rescans (Codex); a scan already running is shared. */
  private locate(refresh = false) {
    if (!this.located || refresh || Date.now() - this.locatedAt > 60_000) {
      this.locatedAt = Date.now()
      this.located = this.scan()
    }
    return this.located
  }

  private async findWindows(spec: NonNullable<EditorCandidate['windows']>) {
    const locator = this.locator
    const fromCommand = async (path: string) => {
      if (!spec.exe) return path.toLowerCase().endsWith('.exe') && await this.isExecutableFile(path) ? path : undefined
      // A CLI shim (bin\code.cmd) opens the app next to it, which takes the same arguments.
      const directory = win32.dirname(path)
      for (const candidate of [win32.join(win32.basename(directory).toLowerCase() === 'bin' ? win32.dirname(directory) : directory, spec.exe), path]) {
        if (candidate.toLowerCase().endsWith('.exe') && await this.isExecutableFile(candidate)) return candidate
      }
      return undefined
    }
    const commands = (spec.commands ?? []).flatMap((command) => ['.exe', '.cmd'].map((extension) => `${command}${extension}`))
    for (const path of [...locator.onPath(commands), ...await locator.appPaths(commands)]) {
      const found = await fromCommand(path)
      if (found) return found
    }
    const direct = [
      ...locator.windowsPrograms(spec.programs ?? []),
      ...(spec.folders ? await locator.windowsProgramFolders(spec.folders.prefixes, spec.folders.relative) : []),
      ...await locator.startMenu(spec.shortcuts ?? []),
      ...locator.scoop(spec.scoop ?? []),
    ]
    for (const path of direct) if (path.toLowerCase().endsWith('.exe') && await this.isExecutableFile(path)) return path
    return undefined
  }

  private async findLinux(spec: NonNullable<EditorCandidate['linux']>): Promise<{ executable: string; baseArgs?: string[] } | undefined> {
    for (const path of this.locator.onPath(spec.commands)) if (await this.isExecutableFile(path)) return { executable: path }
    for (const launch of await this.locator.linuxDesktop(spec.desktop ?? [])) {
      const executable = posix.isAbsolute(launch.executable) ? launch.executable
        : await (async () => { for (const path of this.locator.onPath([launch.executable])) if (await this.isExecutableFile(path)) return path })()
      if (executable && await this.isExecutableFile(executable)) return { executable, baseArgs: launch.args }
    }
    return undefined
  }

  private async scan(): Promise<Located[]> {
    const found: Located[] = []
    for (const candidate of CANDIDATES) {
      try {
        if (this.platform === 'darwin' && candidate.mac) {
          let app: string | undefined
          for (const bundle of await this.locator.macApplications(candidate.mac.apps, candidate.mac.prefixes)) {
            if (await this.exists(bundle)) { app = bundle; break }
          }
          if (app) {
            const cli = candidate.mac.cli ? posix.join(app, candidate.mac.cli) : undefined
            found.push({ candidate, app, ...(cli && await this.exists(cli) ? { executable: cli } : {}) })
          }
        } else if (this.platform === 'win32' && candidate.windows) {
          const executable = await this.findWindows({
            ...candidate.windows,
            programs: candidate.windows.programs?.map((parts) => parts.map((part) => expandWindows(part, this.env))),
          })
          if (executable) found.push({ candidate, executable })
        } else if (this.platform === 'linux' && candidate.linux) {
          const launch = await this.findLinux(candidate.linux)
          if (launch) found.push({ candidate, ...launch })
        }
      } catch { /* One unreadable location never hides the other editors. */ }
    }
    return found
  }

  private customEditors() {
    return (this.options.customApps?.() ?? []).filter((app) => app.kind === 'editor')
  }

  /** An added editor's app: a macOS bundle, or an executable (a bare name is looked up on PATH). */
  private async resolveCustom(app: TerminalCustomExternalApp) {
    const path = this.platform === 'win32' ? win32 : posix
    if (path.isAbsolute(app.executable)) {
      if (this.platform === 'darwin' && app.executable.endsWith('.app')) return await this.exists(app.executable) ? app.executable : undefined
      return await this.isExecutableFile(app.executable) ? app.executable : undefined
    }
    if (/[\\/]/.test(app.executable)) return undefined
    for (const candidate of this.locator.onPath([app.executable])) if (await this.isExecutableFile(candidate)) return candidate
    return undefined
  }

  /** Detected editors, editors the user added, then the system's default app and file manager. */
  async list(refresh = false): Promise<ExternalEditor[]> {
    const located = await this.locate(refresh)
    const withIcon = async <T extends ExternalEditor>(editor: T, path: string | undefined): Promise<T> => {
      const icon = await this.icon(path)
      return icon ? { ...editor, icon } : editor
    }
    const custom = await Promise.all(this.customEditors().map(async (app) => {
      const resolved = await this.resolveCustom(app)
      return withIcon({ id: app.id, name: app.name.slice(0, 128), kind: 'editor' as const, source: 'custom' as const, path: app.executable.slice(0, 4_096), available: Boolean(resolved) }, resolved)
    }))
    return Promise.all([
      ...located.map(({ candidate, app, executable }) => withIcon({
        id: candidate.id, name: candidate.name, kind: 'editor' as const, source: 'detected' as const, ...(app ?? executable ? { path: (app ?? executable)!.slice(0, 4_096) } : {}),
      }, app ?? executable)),
      ...custom,
      Promise.resolve({ id: 'system', name: '', kind: 'system' as const }),
      withIcon({ id: 'file-manager', name: '', kind: 'file-manager' as const }, this.fileManagerPath()),
    ])
  }

  /** Open a file (at a line) or a folder in one editor. Paths are already checked by the caller. */
  async open(editorId: string, target: string, line?: number, directory = false) {
    if (editorId === 'file-manager') {
      this.options.showItemInFolder(target)
      return
    }
    if (editorId === 'system') {
      const failure = await this.options.openPath(target)
      if (failure) throw new Error(failure)
      return
    }
    const path = this.platform === 'win32' ? win32 : posix
    const at = !directory && line && line > 0 ? Math.floor(line) : undefined
    const custom = this.customEditors().find((app) => app.id === editorId)
    if (custom) {
      const executable = await this.resolveCustom(custom)
      if (!executable) throw new Error('This editor is no longer installed.')
      const values = { path: target, dir: directory ? target : path.dirname(target), ...(at ? { line: at } : {}) }
      const args = custom.args?.length ? expandOpenArguments(custom.args, values) : undefined
      if (this.platform === 'darwin' && executable.endsWith('.app')) {
        await run('/usr/bin/open', args ? ['-n', '-a', executable, '--args', ...args] : ['-a', executable, target])
      } else await launch(executable, args ?? [target])
      return
    }
    const located = (await this.locate()).find((item) => item.candidate.id === editorId)
    if (!located) throw new Error('This editor is no longer installed.')
    const { candidate } = located
    const opened = candidate.folderOnly && !directory ? path.dirname(target) : target
    if (located.executable && (this.platform !== 'darwin' || candidate.goto !== 'none')) {
      const args = at === undefined || candidate.folderOnly ? [opened]
        : candidate.goto === 'vscode' ? ['-g', `${target}:${at}`]
          : candidate.goto === 'colon' ? [`${target}:${at}`]
            : candidate.goto === 'jetbrains' ? ['--line', String(at), target]
              : candidate.goto === 'plus' ? [`+${at}`, target]
                : [target]
      await launch(located.executable, [...located.baseArgs ?? [], ...args])
      return
    }
    if (this.platform === 'darwin' && located.app) {
      if (candidate.goto === 'xcode' && at !== undefined) {
        await run('/usr/bin/xed', ['--line', String(at), target]).catch(() => run('/usr/bin/open', ['-a', located.app!, target]))
        return
      }
      if (candidate.goto === 'jetbrains' && at !== undefined) {
        await run('/usr/bin/open', ['-na', located.app, '--args', '--line', String(at), target])
        return
      }
      await run('/usr/bin/open', ['-a', located.app, opened])
    }
  }
}

/** Start an editor and let it outlive PiPilot; no shell, arguments as given. */
function launch(executable: string, args: string[]) {
  return new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(executable, args, { detached: true, stdio: 'ignore', windowsHide: false })
    child.once('error', rejectPromise)
    child.once('spawn', () => {
      child.unref()
      resolvePromise()
    })
  })
}

function run(executable: string, args: string[]) {
  return new Promise<void>((resolvePromise, rejectPromise) => {
    execFile(executable, args, { timeout: 15_000 }, (error) => error ? rejectPromise(error) : resolvePromise())
  })
}

export const externalEditorInternals = { CANDIDATES, expandWindows }
