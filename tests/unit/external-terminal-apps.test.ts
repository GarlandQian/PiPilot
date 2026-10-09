import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExternalTerminalApps, type ExternalTerminalAppsOptions } from '../../src/main/terminal/external-terminal-apps'
import type { TerminalCustomExternalApp, TerminalExternalAdapter } from '../../src/shared/terminal-profiles'

const spawn = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({ spawn }))
const windowsHelper = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'

function custom(adapter: TerminalExternalAdapter, executable: string): TerminalCustomExternalApp {
  return { id: 'external:custom:work', name: 'Work terminal', adapter, executable }
}

afterEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('ExternalTerminalApps discovery', () => {
  it('discovers macOS bundles in system and user Applications, canonicalizes aliases, and keeps IDs stable', async () => {
    const terminal = '/System/Applications/Utilities/Terminal.app'
    const installed = new Set([terminal, '/Applications/iTerm.app', '/Users/person/Applications/Ghostty.app'])
    const apps = new ExternalTerminalApps({
      platform: 'darwin', environment: { HOME: '/Users/person' },
      resolveExecutable: async (candidate) => candidate === '/Applications/Utilities/Terminal.app' ? terminal : installed.has(candidate) ? candidate : undefined,
    })
    const first = await apps.list()
    expect(first.map(({ adapter }) => adapter)).toEqual(['mac-terminal', 'mac-iterm', 'ghostty'])
    expect(first.map(({ executable }) => executable)).toEqual([...installed])
    expect(first.every(({ available, source, id }) => available && source === 'detected' && id.startsWith('external:detected:'))).toBe(true)
    expect(await apps.list([], true)).toEqual(first)
  })

  it('shares the detected inventory until refresh and does not let a caller mutate its cache', async () => {
    const installed = new Set(['/tools/kitty'])
    const resolveExecutable = vi.fn(async (candidate: string) => installed.has(candidate) ? candidate : undefined)
    const apps = new ExternalTerminalApps({ platform: 'linux', environment: { PATH: 'relative:/tools' }, resolveExecutable })
    const [first, simultaneous] = await Promise.all([apps.list(), apps.list()])
    const calls = resolveExecutable.mock.calls.length
    expect(first).toEqual(simultaneous)
    expect(first.map(({ executable }) => executable)).toEqual(['/tools/kitty'])
    first[0].label = 'mutated'
    installed.add('/tools/ghostty')
    expect((await apps.list())[0].label).toBe('kitty')
    expect(resolveExecutable).toHaveBeenCalledTimes(calls)
    expect((await apps.list([], true)).map(({ adapter }) => adapter)).toEqual(['kitty', 'ghostty'])
    expect(resolveExecutable.mock.calls.every(([candidate]) => !candidate.startsWith('relative'))).toBe(true)
  })

  it('discovers Windows Terminal first, followed by safe native console fallbacks', async () => {
    const wt = 'C:\\Users\\person\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe'
    const powershell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
    const cmd = 'C:\\Windows\\System32\\cmd.exe'
    const installed = new Set([wt, powershell, cmd].map((file) => file.toLowerCase()))
    const apps = new ExternalTerminalApps({
      platform: 'win32', environment: { localAppData: 'C:\\Users\\person\\AppData\\Local', pAtH: '"C:\\Users\\person\\AppData\\Local\\Microsoft\\WindowsApps"' },
      resolveExecutable: async (candidate) => installed.has(candidate.toLowerCase()) ? candidate : undefined,
    })
    expect((await apps.list()).map(({ adapter }) => adapter)).toEqual(['windows-terminal', 'windows-powershell', 'windows-cmd'])
  })

  it('retains missing and unsupported custom apps, refreshing custom paths without a discovery refresh', async () => {
    const installed = new Set(['/custom/my-kitty'])
    const resolveExecutable = vi.fn(async (candidate: string) => installed.has(candidate) ? candidate : undefined)
    const apps = new ExternalTerminalApps({ platform: 'linux', environment: { PATH: '/custom' }, resolveExecutable })
    const entries = [custom('kitty', 'my-kitty'), { ...custom('mac-terminal', '/Applications/Terminal.app'), id: 'external:custom:mac' }, { ...custom('alacritty', 'missing'), id: 'external:custom:missing' }]
    expect(await apps.list(entries)).toEqual([
      expect.objectContaining({ executable: '/custom/my-kitty', available: true }),
      expect.objectContaining({ available: false, unavailableReason: 'unsupported-platform' }),
      expect.objectContaining({ available: false, unavailableReason: 'executable-not-found' }),
    ])
    installed.delete('/custom/my-kitty')
    expect((await apps.list(entries))[0]).toMatchObject({ available: false, unavailableReason: 'executable-not-found' })
    expect(resolveExecutable).not.toHaveBeenCalledWith('/Applications/Terminal.app')
  })
})

describe('ExternalTerminalApps opening', () => {
  const cwd = '/projects/中文 space \' " ; $(touch nope) `whoami`\nfolder'

  it.each([
    ['gnome-terminal', ['--window', `--working-directory=${cwd}`]],
    ['konsole', ['--workdir', cwd]],
    ['xfce4-terminal', ['--window', `--working-directory=${cwd}`]],
    ['kitty', ['--directory', cwd]],
    ['alacritty', ['--working-directory', cwd]],
    ['ghostty', [`--working-directory=${cwd}`, '--window-inherit-working-directory=false', '--gtk-single-instance=false']],
  ] as [TerminalExternalAdapter, string[]][])('passes hostile directory names as literal argv for %s', async (adapter, args) => {
    const launchExternal = vi.fn(async () => {})
    const resolveExecutable = vi.fn(async (candidate: string) => candidate === '/custom/terminal' ? candidate : undefined)
    const apps = new ExternalTerminalApps({ platform: 'linux', environment: {}, resolveExecutable, launchExternal })
    expect(await apps.open('external:custom:work', cwd, [custom(adapter, '/custom/terminal')])).toEqual({ appId: 'external:custom:work' })
    expect(launchExternal).toHaveBeenCalledWith('/custom/terminal', args, { cwd })
    expect(resolveExecutable.mock.calls).toEqual([['/custom/terminal'], ['/custom/terminal']])
  })

  it.each(['mac-terminal', 'mac-iterm'] as const)('opens a directory through the selected %s application bundle without shell text', async (adapter) => {
    const launchExternal = vi.fn(async () => {})
    const executable = '/Applications/My Terminal.app'
    const apps = new ExternalTerminalApps({ platform: 'darwin', environment: {}, resolveExecutable: async (candidate) => candidate === executable ? candidate : undefined, launchExternal })
    await apps.open('external:custom:work', cwd, [custom(adapter, executable)])
    expect(launchExternal).toHaveBeenCalledWith('/usr/bin/open', ['-a', executable, cwd], { cwd })
  })

  it('opens Ghostty in a fresh macOS instance without restoring or inheriting another directory', async () => {
    const launchExternal = vi.fn(async () => {})
    const executable = '/Applications/Ghostty.app'
    const apps = new ExternalTerminalApps({ platform: 'darwin', environment: {}, resolveExecutable: async (candidate) => candidate === executable ? candidate : undefined, launchExternal })
    await apps.open('external:custom:work', cwd, [custom('ghostty', executable)])
    expect(launchExternal).toHaveBeenCalledWith('/usr/bin/open', ['-n', '-a', executable, '--args', `--working-directory=${cwd}`, '--window-inherit-working-directory=false', '--window-save-state=never'], { cwd })
  })

  it('escapes Windows Terminal command delimiters even within a single argument', async () => {
    const launchExternal = vi.fn(async () => {})
    const executable = 'C:\\Tools\\wt.exe'
    const directory = 'C:\\Projects\\;new-tab powershell & whoami;中文'
    const apps = new ExternalTerminalApps({ platform: 'win32', environment: {}, resolveExecutable: async (candidate) => candidate === executable ? candidate : undefined, launchExternal })
    await apps.open('external:custom:work', directory, [custom('windows-terminal', executable)])
    expect(launchExternal).toHaveBeenCalledWith(executable, ['-w', 'new', 'new-tab', '-d', 'C:\\Projects\\\\;new-tab powershell & whoami\\;中文'], { cwd: directory })
  })

  it.each([
    ['windows-powershell', "@('-NoLogo', '-NoExit')"],
    ['windows-cmd', "@('/K')"],
  ] as [TerminalExternalAdapter, string][])('opens %s with a visible-console helper and preserves paths as encoded data', async (adapter, argumentList) => {
    const launchExternal = vi.fn<NonNullable<ExternalTerminalAppsOptions['launchExternal']>>(async () => {})
    const executable = 'C:\\Tools\\%PATH% ! &; \' " 中文\\terminal.exe'
    const directory = 'C:\\Projects\\%PATH% ! & ; \' " 中文 $(whoami)'
    const resolveExecutable = vi.fn(async (candidate: string) => [executable, windowsHelper].includes(candidate) ? candidate : undefined)
    const apps = new ExternalTerminalApps({ platform: 'win32', environment: {}, resolveExecutable, launchExternal })
    await apps.open('external:custom:work', directory, [custom(adapter, executable)])
    const [file, args, options] = launchExternal.mock.calls[0]
    expect(file).toBe(windowsHelper)
    expect(args.slice(0, 4)).toEqual(['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand'])
    expect(args).toHaveLength(5)
    expect(options).toEqual({ cwd: directory, helper: true })
    const script = Buffer.from(args[4], 'base64').toString('utf16le')
    const data = [...script.matchAll(/FromBase64String\('([A-Za-z0-9+/=]+)'\)/g)].map((match) => Buffer.from(match[1], 'base64').toString('utf8'))
    expect(data).toEqual([executable, directory])
    expect(script).toContain(`Start-Process -FilePath $terminalExecutable -WorkingDirectory $terminalDirectory -ArgumentList ${argumentList} -WindowStyle Normal -ErrorAction Stop`)
    expect(script).toContain('} catch {')
    expect(script).toContain('exit 1')
    expect(script).not.toContain(executable)
    expect(script).not.toContain(directory)
    expect(resolveExecutable.mock.calls).toEqual([[executable], [executable], [windowsHelper]])
  })

  it('revalidates the system PowerShell helper rather than resolving a similarly named PATH command', async () => {
    const executable = 'C:\\Tools\\cmd.exe'
    const systemHelper = 'D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
    const installed = new Set([executable, systemHelper, 'C:\\untrusted\\powershell.exe'])
    const calls: string[] = []
    const launchExternal = vi.fn(async () => { calls.push('launch') })
    const apps = new ExternalTerminalApps({
      platform: 'win32', environment: { SystemRoot: 'D:\\Windows', PATH: 'C:\\untrusted' },
      resolveExecutable: async (candidate) => { calls.push(candidate); return installed.has(candidate) ? candidate : undefined },
      launchExternal,
    })
    await apps.open('external:custom:work', 'C:\\projects', [custom('windows-cmd', executable)], async () => { calls.push('scope-check') })
    expect(calls).toEqual([executable, executable, systemHelper, 'scope-check', 'launch'])
    installed.delete(systemHelper)
    await expect(apps.open('external:custom:work', 'C:\\projects', [custom('windows-cmd', executable)])).rejects.toMatchObject({ code: 'TERMINAL_EXTERNAL_APP_UNAVAILABLE', message: expect.stringContaining('System Windows PowerShell') })
    expect(launchExternal).toHaveBeenCalledOnce()
    expect(calls).not.toContain('C:\\untrusted\\powershell.exe')
  })

  it('rejects a CMD network directory and malformed working directories before launching', async () => {
    const launchExternal = vi.fn(async () => {})
    const apps = new ExternalTerminalApps({ platform: 'win32', environment: {}, resolveExecutable: async (candidate) => candidate, launchExternal })
    for (const directory of ['\\\\server\\share', 'relative', 'C:relative', 'C:\\bad\0path']) {
      await expect(apps.open('external:custom:work', directory, [custom('windows-cmd', 'C:\\cmd.exe')])).rejects.toMatchObject({ code: 'TERMINAL_CWD_UNAVAILABLE' })
    }
    expect(launchExternal).not.toHaveBeenCalled()
  })

  it('uses the first detected app automatically and rechecks project context immediately before launch', async () => {
    const calls: string[] = []
    const apps = new ExternalTerminalApps({
      platform: 'darwin', environment: {},
      resolveExecutable: async (candidate) => { calls.push(`resolve:${candidate}`); return ['/System/Applications/Utilities/Terminal.app', '/Applications/iTerm.app'].includes(candidate) ? candidate : undefined },
      launchExternal: async () => { calls.push('launch') },
    })
    const available = await apps.list()
    calls.length = 0
    expect(await apps.open(undefined, '/projects', [], async () => { calls.push('scope-check') })).toEqual({ appId: available[0].id })
    expect(calls).toEqual(['resolve:/System/Applications/Utilities/Terminal.app', 'scope-check', 'launch'])
  })

  it('does not fall back when the selected cached app disappears, and honors a failed scope recheck', async () => {
    const installed = new Set(['/usr/bin/kitty', '/usr/bin/alacritty'])
    const launchExternal = vi.fn(async () => {})
    const apps = new ExternalTerminalApps({ platform: 'linux', environment: {}, resolveExecutable: async (candidate) => installed.has(candidate) ? candidate : undefined, launchExternal })
    const available = await apps.list()
    installed.delete('/usr/bin/kitty')
    await expect(apps.open(available[0].id, '/projects')).rejects.toMatchObject({ code: 'TERMINAL_EXTERNAL_APP_UNAVAILABLE' })
    await expect(apps.open('external:detected:missing', '/projects')).rejects.toMatchObject({ code: 'TERMINAL_EXTERNAL_APP_UNAVAILABLE' })
    const scopeError = new Error('project changed')
    await expect(apps.open(available[1].id, '/projects', [], async () => { throw scopeError })).rejects.toBe(scopeError)
    expect(launchExternal).not.toHaveBeenCalled()
  })

  it('revalidates cached automatic candidates and falls back when the first application disappears', async () => {
    const installed = new Set(['/usr/bin/kitty', '/usr/bin/alacritty'])
    const launchExternal = vi.fn(async () => {})
    const resolveExecutable = vi.fn(async (candidate: string) => installed.has(candidate) ? candidate : undefined)
    const apps = new ExternalTerminalApps({ platform: 'linux', environment: {}, resolveExecutable, launchExternal })
    const available = await apps.list()
    installed.delete('/usr/bin/kitty')
    resolveExecutable.mockClear()
    expect(await apps.open(undefined, '/projects')).toEqual({ appId: available[1].id })
    expect(resolveExecutable.mock.calls).toEqual([['/usr/bin/kitty'], ['/usr/bin/alacritty']])
    expect(launchExternal).toHaveBeenCalledWith('/usr/bin/alacritty', ['--working-directory', '/projects'], { cwd: '/projects' })
  })

  it('reports launch errors and does not execute malformed custom commands or incompatible adapters', async () => {
    const launchExternal = vi.fn(async () => { throw new Error('permission denied') })
    const apps = new ExternalTerminalApps({ platform: 'linux', environment: {}, resolveExecutable: async (candidate) => candidate, launchExternal })
    await expect(apps.open('external:custom:work', '/projects', [custom('kitty', '/custom/kitty')])).rejects.toMatchObject({ code: 'TERMINAL_EXTERNAL_LAUNCH_FAILED', message: expect.stringContaining('permission denied') })
    for (const app of [custom('kitty', '/bad\nfile'), custom('kitty', 'relative/kitty'), custom('windows-terminal', 'C:\\wt.exe')]) {
      await expect(apps.open(app.id, '/projects', [app])).rejects.toMatchObject({ code: 'TERMINAL_EXTERNAL_APP_UNAVAILABLE' })
    }
    expect(launchExternal).toHaveBeenCalledTimes(1)
  })
})

describe('external process handoff', () => {
  function processFixture(platform: 'linux' | 'darwin' | 'win32' = 'linux') {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn(), kill: vi.fn() })
    spawn.mockReturnValue(child)
    const apps = new ExternalTerminalApps({ platform, environment: { EXAMPLE: 'value' }, resolveExecutable: async (candidate) => candidate })
    const entry = platform === 'win32' ? custom('windows-powershell', 'C:\\Tools\\powershell.exe') : custom(platform === 'darwin' ? 'mac-terminal' : 'kitty', platform === 'darwin' ? '/Applications/Terminal.app' : '/custom/kitty')
    return { child, opened: apps.open(entry.id, platform === 'win32' ? 'C:\\projects' : '/projects', [entry]) }
  }

  it('starts without shell evaluation, detaches a long-lived app after a bounded initial error window', async () => {
    vi.useFakeTimers()
    const { child, opened } = processFixture()
    await vi.advanceTimersByTimeAsync(0)
    expect(spawn).toHaveBeenCalledWith('/custom/kitty', ['--directory', '/projects'], { cwd: '/projects', env: { EXAMPLE: 'value' }, shell: false, detached: true, stdio: 'ignore', windowsHide: false })
    child.emit('spawn')
    await vi.advanceTimersByTimeAsync(300)
    await expect(opened).resolves.toEqual({ appId: 'external:custom:work' })
    expect(child.unref).toHaveBeenCalledOnce()
    expect(child.kill).not.toHaveBeenCalled()
  })

  it.each(['error', 'exit'] as const)('reports an initial process %s', async (event) => {
    vi.useFakeTimers()
    const { child, opened } = processFixture()
    const assertion = expect(opened).rejects.toMatchObject({ code: 'TERMINAL_EXTERNAL_LAUNCH_FAILED' })
    await vi.advanceTimersByTimeAsync(0)
    child.emit('spawn')
    if (event === 'error') child.emit('error', new Error('spawn failed'))
    else child.emit('exit', 2, null)
    await assertion
    expect(child.unref).toHaveBeenCalledOnce()
  })

  it('hides the Windows helper and waits for its handoff exit instead of returning after the GUI startup window', async () => {
    vi.useFakeTimers()
    const { child, opened } = processFixture('win32')
    let completed = false
    void opened.then(() => { completed = true })
    await vi.advanceTimersByTimeAsync(0)
    expect(spawn).toHaveBeenCalledWith(windowsHelper, expect.arrayContaining(['-NoProfile', '-NonInteractive', '-EncodedCommand']), { cwd: 'C:\\projects', env: { EXAMPLE: 'value' }, shell: false, detached: false, stdio: 'ignore', windowsHide: true })
    child.emit('spawn')
    await vi.advanceTimersByTimeAsync(300)
    expect(completed).toBe(false)
    child.emit('exit', 0, null)
    await expect(opened).resolves.toEqual({ appId: 'external:custom:work' })
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('reports a failed Windows console handoff', async () => {
    vi.useFakeTimers()
    const { child, opened } = processFixture('win32')
    const assertion = expect(opened).rejects.toMatchObject({ code: 'TERMINAL_EXTERNAL_LAUNCH_FAILED', message: expect.stringContaining('code 1') })
    await vi.advanceTimersByTimeAsync(0)
    child.emit('spawn')
    child.emit('exit', 1, null)
    await assertion
  })

  it('bounds a stalled Windows helper and only terminates that helper process', async () => {
    vi.useFakeTimers()
    const { child, opened } = processFixture('win32')
    const assertion = expect(opened).rejects.toMatchObject({ code: 'TERMINAL_EXTERNAL_LAUNCH_FAILED', message: expect.stringContaining('Timed out') })
    await vi.advanceTimersByTimeAsync(0)
    child.emit('spawn')
    await vi.advanceTimersByTimeAsync(5_000)
    await assertion
    expect(spawn).toHaveBeenCalledOnce()
    expect(child.kill).toHaveBeenCalledOnce()
  })

  it('waits for macOS open to return and bounds a stalled launcher without waiting for the GUI lifetime', async () => {
    vi.useFakeTimers()
    const { child, opened } = processFixture('darwin')
    const assertion = expect(opened).rejects.toMatchObject({ code: 'TERMINAL_EXTERNAL_LAUNCH_FAILED', message: expect.stringContaining('Timed out') })
    await vi.advanceTimersByTimeAsync(0)
    child.emit('spawn')
    await vi.advanceTimersByTimeAsync(5_000)
    await assertion
    expect(child.kill).toHaveBeenCalledOnce()
  })
})
