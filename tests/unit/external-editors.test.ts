import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ExternalEditors, externalEditorInternals } from '../../src/main/editors/external-editors'
import { cleanCommitMessage } from '../../src/main/ipc/register-workspace-ipc'
import { suggestedBranchName } from '../../src/components/inspector/CommitControls'
import { openTargetsOf, preferredTarget } from '../../src/renderer/open-targets'
import { AppLocator, desktopExec, parseAppPaths } from '../../src/main/editors/app-locator'

// Preserve real process launch and argument handling without relying on /bin/sh.
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return {
    ...actual,
    spawn(file: string, args: string[], options: import('node:child_process').SpawnOptions) {
      if (file.includes('pipilot-editors-')) {
        return actual.spawn(process.execPath, [file, ...args], options)
      }
      return actual.spawn(file, args, options)
    },
  }
})

async function waitFor(path: string) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { return await readFile(path, 'utf8') } catch { await new Promise((resolve) => setTimeout(resolve, 50)) }
  }
  throw new Error(`${path} never appeared`)
}

describe('external editors', () => {
  it('finds editors on PATH without a shell, and always offers the default app and file manager', async () => {
    const bin = await mkdtemp(join(tmpdir(), 'pipilot-editors-'))
    try {
      await writeFile(join(bin, 'code'), `require('node:fs').writeFileSync(require('node:path').join(__dirname, 'opened'), process.argv.slice(2).join(' '))`, 'utf8')
      await chmod(join(bin, 'code'), 0o755)
      const openPath = vi.fn(async () => '')
      const showItemInFolder = vi.fn()
      const editors = new ExternalEditors({ platform: 'linux', env: { PATH: bin, XDG_DATA_DIRS: bin, XDG_DATA_HOME: bin }, openPath, showItemInFolder })
      expect((await editors.list()).map((editor) => `${editor.kind}:${editor.id}`)).toEqual(['editor:vscode', 'system:system', 'file-manager:file-manager'])
      await editors.open('vscode', '/project/src/app.ts', 12)
      expect((await waitFor(join(bin, 'opened'))).trim()).toBe('-g /project/src/app.ts:12')
      await editors.open('file-manager', '/project/src/app.ts')
      expect(showItemInFolder).toHaveBeenCalledWith('/project/src/app.ts')
      await editors.open('system', '/project')
      expect(openPath).toHaveBeenCalledWith('/project')
      await expect(editors.open('zed', '/project')).rejects.toThrow()
    } finally {
      await rm(bin, { recursive: true, force: true })
    }
  })

  it('finds macOS app bundles in either Applications folder', async () => {
    const home = await mkdtemp(join(tmpdir(), 'pipilot-home-'))
    try {
      await mkdir(join(home, 'Applications', 'Zed.app'), { recursive: true })
      const editors = new ExternalEditors({ platform: 'darwin', env: {}, home, openPath: async () => '', showItemInFolder: () => undefined })
      expect((await editors.list()).some((editor) => editor.id === 'zed')).toBe(true)
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('expands Windows environment variables in install paths', () => {
    expect(externalEditorInternals.expandWindows('%LOCALAPPDATA%\\Programs\\cursor\\Cursor.exe', { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' }))
      .toBe('C:\\Users\\me\\AppData\\Local\\Programs\\cursor\\Cursor.exe')
    expect(externalEditorInternals.expandWindows('%MISSING%\\x.exe', {})).toBe('%MISSING%\\x.exe')
  })

  it('defaults to the remembered app, editor or terminal, else the first editor, else the default app', () => {
    const editors = [
      { id: 'cursor', name: 'Cursor', kind: 'editor' as const },
      { id: 'zed', name: 'Zed', kind: 'editor' as const },
      { id: 'external:custom:gone', name: 'Gone', kind: 'editor' as const, source: 'custom' as const, available: false },
      { id: 'system', name: '', kind: 'system' as const },
      { id: 'file-manager', name: '', kind: 'file-manager' as const },
    ]
    const terminals = [{ id: 'external:detected:ghostty', label: 'Ghostty', source: 'detected' as const, adapter: 'ghostty' as const, executable: '/Applications/Ghostty.app', available: true }]
    const targets = openTargetsOf({ editors, terminals })
    expect(targets.map(({ group, id }) => `${group}:${id}`)).toEqual([
      'editor:cursor', 'editor:zed', 'editor:external:custom:gone', 'terminal:external:detected:ghostty', 'other:system', 'other:file-manager',
    ])
    expect(preferredTarget(targets, 'zed')?.id).toBe('zed')
    expect(preferredTarget(targets, 'external:detected:ghostty')?.id).toBe('external:detected:ghostty')
    expect(preferredTarget(targets, 'external:custom:gone')?.id).toBe('cursor')
    expect(preferredTarget(targets, 'file-manager')?.id).toBe('cursor')
    expect(preferredTarget(openTargetsOf({ editors: editors.slice(3), terminals: [] }), null)?.id).toBe('system')
  })

  it('finds Windows editors through a CLI shim, the install roots and Start menu shortcuts', async () => {
    const files = new Set([
      'C:\\Users\\me\\AppData\\Local\\Programs\\Microsoft VS Code\\bin\\code.cmd',
      'C:\\Users\\me\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe',
      'D:\\Tools\\Zed\\Zed.exe',
      'C:\\Program Files\\JetBrains\\WebStorm 2026.2\\bin\\webstorm64.exe',
    ])
    const startMenu = 'C:\\Users\\me\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs'
    const directories: Record<string, Array<{ name: string; directory: boolean }>> = {
      [startMenu]: [{ name: 'Zed', directory: true }],
      [`${startMenu}\\Zed`]: [{ name: 'Zed.lnk', directory: false }],
      'C:\\Program Files\\JetBrains': [{ name: 'WebStorm 2026.2', directory: true }],
    }
    const editors = new ExternalEditors({
      platform: 'win32',
      env: { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local', APPDATA: 'C:\\Users\\me\\AppData\\Roaming', ProgramFiles: 'C:\\Program Files', PATH: 'C:\\Users\\me\\AppData\\Local\\Programs\\Microsoft VS Code\\bin' },
      readShortcutLink: (path) => path.endsWith('Zed.lnk') ? 'D:\\Tools\\Zed\\Zed.exe' : undefined,
      readAppPaths: async () => new Map(),
      readDirectory: async (path) => directories[path] ?? [],
      isExecutableFile: async (path) => files.has(path),
      pathExists: async (path) => files.has(path),
      openPath: async () => '', showItemInFolder: () => undefined,
    })
    expect((await editors.list()).filter((editor) => editor.kind === 'editor').map(({ id, path }) => [id, path])).toEqual([
      ['vscode', 'C:\\Users\\me\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe'],
      ['zed', 'D:\\Tools\\Zed\\Zed.exe'],
      ['webstorm', 'C:\\Program Files\\JetBrains\\WebStorm 2026.2\\bin\\webstorm64.exe'],
    ])
  })

  it('finds versioned macOS bundles by name prefix', async () => {
    const editors = new ExternalEditors({
      platform: 'darwin', env: {}, home: '/Users/me',
      readDirectory: async (path) => path === '/Users/me/Applications' ? [{ name: 'IntelliJ IDEA Ultimate.app', directory: true }, { name: 'Notes.app', directory: true }] : [],
      pathExists: async (path) => path === '/Users/me/Applications/IntelliJ IDEA Ultimate.app',
      openPath: async () => '', showItemInFolder: () => undefined,
    })
    expect((await editors.list()).filter((editor) => editor.kind === 'editor').map(({ id, path }) => [id, path])).toEqual([['intellij', '/Users/me/Applications/IntelliJ IDEA Ultimate.app']])
  })

  it('lists an added editor, marks it missing, and opens it with its argument template', async () => {
    const bin = await mkdtemp(join(tmpdir(), 'pipilot-editors-'))
    try {
      const script = join(bin, 'my-editor')
      await writeFile(script, `require('node:fs').writeFileSync(require('node:path').join(__dirname, 'opened'), process.argv.slice(2).join('|'))`, 'utf8')
      await chmod(script, 0o755)
      const apps = [
        { id: 'external:custom:mine', name: 'My editor', executable: script, adapter: 'generic' as const, kind: 'editor' as const, args: ['--goto', '{path}:{line}', '--in={dir}'] },
        { id: 'external:custom:gone', name: 'Gone', executable: '/missing/editor', adapter: 'generic' as const, kind: 'editor' as const },
        { id: 'external:custom:term', name: 'A terminal', executable: script, adapter: 'generic' as const },
      ]
      const editors = new ExternalEditors({ platform: 'linux', env: { PATH: '', XDG_DATA_DIRS: bin, XDG_DATA_HOME: bin }, openPath: async () => '', showItemInFolder: () => undefined, customApps: () => apps })
      expect((await editors.list()).filter((editor) => editor.source === 'custom').map(({ id, available }) => [id, available])).toEqual([['external:custom:mine', true], ['external:custom:gone', false]])
      await editors.open('external:custom:mine', '/project/src/app.ts', 7)
      expect(await waitFor(join(bin, 'opened'))).toBe('--goto|/project/src/app.ts:7|--in=/project/src')
      await expect(editors.open('external:custom:gone', '/project')).rejects.toThrow()
    } finally {
      await rm(bin, { recursive: true, force: true })
    }
  })

  it('reads Linux .desktop launchers and keeps their arguments without field codes', async () => {
    const data = await mkdtemp(join(tmpdir(), 'pipilot-desktop-'))
    try {
      const program = join(data, 'code-app')
      await writeFile(program, '')
      await chmod(program, 0o755)
      await mkdir(join(data, 'applications'), { recursive: true })
      await writeFile(join(data, 'applications', 'code.desktop'), `[Desktop Action new]\nExec=/wrong\n[Desktop Entry]\nName=Code\nExec="${program}" --unity-launch %F\n`)
      const locator = new AppLocator({ platform: 'linux', environment: { XDG_DATA_DIRS: data, XDG_DATA_HOME: join(data, 'none') } })
      expect(await locator.linuxDesktop(['code.desktop', '../escape.desktop'])).toEqual([{ executable: program, args: ['--unity-launch'] }])
      expect(desktopExec('[Desktop Entry]\nExec=flatpak run --command=zed dev.zed.Zed %U\n')).toEqual({ executable: 'flatpak', args: ['run', '--command=zed', 'dev.zed.Zed'] })
      expect(desktopExec('[Desktop Entry]\nName=No command\n')).toBeUndefined()
    } finally {
      await rm(data, { recursive: true, force: true })
    }
  })

  it('parses App Paths registrations whatever the default value is called', () => {
    const output = [
      'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\wezterm-gui.exe',
      '    (默认)    REG_SZ    C:\\Program Files\\WezTerm\\wezterm-gui.exe',
      '',
      'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Code.exe',
      '    (Default)    REG_EXPAND_SZ    "%LOCALAPPDATA%\\Programs\\Microsoft VS Code\\Code.exe"',
    ].join('\r\n')
    expect(parseAppPaths(output)).toEqual([
      ['wezterm-gui.exe', 'C:\\Program Files\\WezTerm\\wezterm-gui.exe'],
      ['code.exe', '%LOCALAPPDATA%\\Programs\\Microsoft VS Code\\Code.exe'],
    ])
  })
})

describe('commit helpers', () => {
  it('keeps only the message a model wrote', () => {
    expect(cleanCommitMessage('```\nFix the parser\n```')).toBe('Fix the parser')
    expect(cleanCommitMessage('"Fix the parser"')).toBe('Fix the parser')
    expect(cleanCommitMessage('  Fix the parser\n\nBody.  ')).toBe('Fix the parser\n\nBody.')
  })

  it('names a pull request branch after the message, or after the time', () => {
    const now = new Date(2026, 9, 8, 9, 5)
    expect(suggestedBranchName('Fix the review header\n\nMore.', now)).toBe('pipilot/fix-the-review-header')
    expect(suggestedBranchName('修复审阅标题', now)).toBe('pipilot/changes-20261008-0905')
  })
})
