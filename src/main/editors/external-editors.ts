import { spawn, execFile } from 'node:child_process'
import { access, constants } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import type { ExternalEditor } from '../../shared/external-editors'

/** How an editor takes a line: `-g path:line`, `path:line`, or `--line N path`. */
type GotoStyle = 'vscode' | 'colon' | 'jetbrains' | 'xcode' | 'none'

interface EditorCandidate {
  id: string
  name: string
  goto: GotoStyle
  /** macOS bundles, and the CLI inside one that understands line numbers. */
  mac?: { apps: string[]; cli?: string }
  /** Windows executables (environment variables expanded) and PATH names. */
  windows?: { paths?: string[]; commands?: string[] }
  linux?: { commands: string[] }
}

const VSCODE_CLI = 'Contents/Resources/app/bin'
const CANDIDATES: readonly EditorCandidate[] = [
  { id: 'vscode', name: 'VS Code', goto: 'vscode',
    mac: { apps: ['Visual Studio Code.app'], cli: `${VSCODE_CLI}/code` },
    windows: { paths: ['%LOCALAPPDATA%\\Programs\\Microsoft VS Code\\Code.exe', '%ProgramFiles%\\Microsoft VS Code\\Code.exe'] },
    linux: { commands: ['code'] } },
  { id: 'vscode-insiders', name: 'VS Code Insiders', goto: 'vscode',
    mac: { apps: ['Visual Studio Code - Insiders.app'], cli: `${VSCODE_CLI}/code-insiders` },
    windows: { paths: ['%LOCALAPPDATA%\\Programs\\Microsoft VS Code Insiders\\Code - Insiders.exe'] },
    linux: { commands: ['code-insiders'] } },
  { id: 'cursor', name: 'Cursor', goto: 'vscode',
    mac: { apps: ['Cursor.app'], cli: `${VSCODE_CLI}/cursor` },
    windows: { paths: ['%LOCALAPPDATA%\\Programs\\cursor\\Cursor.exe'] },
    linux: { commands: ['cursor'] } },
  { id: 'windsurf', name: 'Windsurf', goto: 'vscode',
    mac: { apps: ['Windsurf.app'], cli: `${VSCODE_CLI}/windsurf` },
    windows: { paths: ['%LOCALAPPDATA%\\Programs\\Windsurf\\Windsurf.exe'] },
    linux: { commands: ['windsurf'] } },
  { id: 'zed', name: 'Zed', goto: 'colon',
    mac: { apps: ['Zed.app'], cli: 'Contents/MacOS/cli' },
    windows: { paths: ['%LOCALAPPDATA%\\Programs\\Zed\\Zed.exe'], commands: ['zed'] },
    linux: { commands: ['zed', 'zeditor'] } },
  { id: 'sublime', name: 'Sublime Text', goto: 'colon',
    mac: { apps: ['Sublime Text.app'], cli: 'Contents/SharedSupport/bin/subl' },
    windows: { paths: ['%ProgramFiles%\\Sublime Text\\subl.exe', '%ProgramFiles%\\Sublime Text 3\\subl.exe'], commands: ['subl'] },
    linux: { commands: ['subl'] } },
  { id: 'xcode', name: 'Xcode', goto: 'xcode', mac: { apps: ['Xcode.app'] } },
  { id: 'intellij', name: 'IntelliJ IDEA', goto: 'jetbrains', mac: { apps: ['IntelliJ IDEA.app', 'IntelliJ IDEA CE.app'] }, windows: { commands: ['idea64'] }, linux: { commands: ['idea', 'intellij-idea-ultimate', 'intellij-idea-community'] } },
  { id: 'webstorm', name: 'WebStorm', goto: 'jetbrains', mac: { apps: ['WebStorm.app'] }, windows: { commands: ['webstorm64'] }, linux: { commands: ['webstorm'] } },
  { id: 'pycharm', name: 'PyCharm', goto: 'jetbrains', mac: { apps: ['PyCharm.app', 'PyCharm CE.app'] }, windows: { commands: ['pycharm64'] }, linux: { commands: ['pycharm', 'pycharm-community'] } },
  { id: 'goland', name: 'GoLand', goto: 'jetbrains', mac: { apps: ['GoLand.app'] }, windows: { commands: ['goland64'] }, linux: { commands: ['goland'] } },
  { id: 'android-studio', name: 'Android Studio', goto: 'jetbrains', mac: { apps: ['Android Studio.app'] }, windows: { paths: ['%ProgramFiles%\\Android\\Android Studio\\bin\\studio64.exe'] }, linux: { commands: ['studio', 'android-studio'] } },
  { id: 'nova', name: 'Nova', goto: 'none', mac: { apps: ['Nova.app'] } },
]

interface Located { candidate: EditorCandidate; app?: string; executable?: string }

async function exists(path: string) {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

function expandWindows(path: string, env: NodeJS.ProcessEnv) {
  return path.replace(/%([^%]+)%/gu, (match, name: string) => env[name] ?? env[name.toUpperCase()] ?? match)
}

async function onPath(command: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform) {
  const names = platform === 'win32' ? [`${command}.exe`] : [command]
  for (const directory of (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean)) {
    for (const name of names) {
      const candidate = join(directory, name)
      if (await exists(candidate)) return candidate
    }
  }
  return undefined
}

/**
 * Editors installed on this computer, found without running a shell: macOS
 * app bundles, Windows install folders and PATH, Linux PATH.
 */
export class ExternalEditors {
  private located: Promise<Located[]> | undefined
  private locatedAt = 0

  constructor(private readonly options: {
    platform?: NodeJS.Platform
    env?: NodeJS.ProcessEnv
    home?: string
    openPath(path: string): Promise<string>
    showItemInFolder(path: string): void
    /** The icon a file or app bundle shows in Finder or File Explorer. */
    iconFor?(path: string): Promise<string | undefined>
  }) {}

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

  private locate() {
    if (!this.located || Date.now() - this.locatedAt > 60_000) {
      this.locatedAt = Date.now()
      this.located = this.scan()
    }
    return this.located
  }

  private async scan(): Promise<Located[]> {
    const found: Located[] = []
    for (const candidate of CANDIDATES) {
      if (this.platform === 'darwin' && candidate.mac) {
        const roots = ['/Applications', join(this.options.home ?? homedir(), 'Applications')]
        let app: string | undefined
        for (const root of roots) for (const bundle of candidate.mac.apps) {
          if (!app && await exists(join(root, bundle))) app = join(root, bundle)
        }
        if (app) {
          const cli = candidate.mac.cli ? join(app, candidate.mac.cli) : undefined
          found.push({ candidate, app, ...(cli && await exists(cli) ? { executable: cli } : {}) })
        }
      } else if (this.platform === 'win32' && candidate.windows) {
        let executable: string | undefined
        for (const path of candidate.windows.paths ?? []) {
          const expanded = expandWindows(path, this.env)
          if (!executable && !expanded.includes('%') && await exists(expanded)) executable = expanded
        }
        for (const command of candidate.windows.commands ?? []) executable ??= await onPath(command, this.env, 'win32')
        if (executable) found.push({ candidate, executable })
      } else if (this.platform === 'linux' && candidate.linux) {
        let executable: string | undefined
        for (const command of candidate.linux.commands) executable ??= await onPath(command, this.env, 'linux')
        if (executable) found.push({ candidate, executable })
      }
    }
    return found
  }

  /** Detected editors, then the system's default app and file manager. */
  async list(): Promise<ExternalEditor[]> {
    const located = await this.locate()
    const withIcon = async <T extends ExternalEditor>(editor: T, path: string | undefined): Promise<T> => {
      const icon = await this.icon(path)
      return icon ? { ...editor, icon } : editor
    }
    return Promise.all([
      ...located.map(({ candidate, app, executable }) => withIcon({ id: candidate.id, name: candidate.name, kind: 'editor' as const }, app ?? executable)),
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
    const located = (await this.locate()).find((item) => item.candidate.id === editorId)
    if (!located) throw new Error('This editor is no longer installed.')
    const at = !directory && line && line > 0 ? Math.floor(line) : undefined
    const { candidate } = located
    if (located.executable && (this.platform !== 'darwin' || candidate.goto !== 'none')) {
      const args = at === undefined ? [target]
        : candidate.goto === 'vscode' ? ['-g', `${target}:${at}`]
          : candidate.goto === 'colon' ? [`${target}:${at}`]
            : candidate.goto === 'jetbrains' ? ['--line', String(at), target]
              : [target]
      await launch(located.executable, args)
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
      await run('/usr/bin/open', ['-a', located.app, target])
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
