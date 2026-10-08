import { describe, expect, it, vi } from 'vitest'
import { mergeTerminalEnvironment, parseWslDistributions, TerminalProfileDiscovery, terminalLocaleEnvironment, wslWorkingDirectory } from '../../src/main/terminal/terminal-profile-discovery'

describe('TerminalProfileDiscovery', () => {
  it('discovers arbitrary login shells, /etc/shells entries and PATH/Homebrew shells with stable per-install IDs', async () => {
    const installed = new Set(['/opt/custom/my-shell', '/usr/local/bin/fish', '/opt/homebrew/bin/nu', '/tools/fish', '/bin/zsh'])
    const legacy = ['/bin/sh', '/bin/csh', '/bin/tcsh', '/bin/ksh', '/bin/dash']
    const discovery = new TerminalProfileDiscovery({
      platform: 'darwin', environment: { SHELL: '/opt/custom/my-shell', PATH: 'relative:/tools:/usr/local/bin' },
      readShellsFile: async () => `# login shells\n${legacy.join('\n')}\n/bin/zsh\n/opt/custom/my-shell\n/not-installed\nrelative\n`,
      resolveExecutable: async (candidate) => installed.has(candidate) || legacy.includes(candidate) ? candidate : undefined,
    })
    const profiles = await discovery.discover()
    // The shells macOS ships but nobody picks (csh, ksh, …) stay out of the list.
    expect(profiles.map(({ executable }) => executable).sort()).toEqual([...installed].sort())
    expect(new Set(profiles.map(({ id }) => id)).size).toBe(installed.size)
    // The default shell and a chosen profile stay listed even when legacy.
    const kept = await discovery.discover([], { files: ['/bin/sh'] })
    expect(kept.map(({ executable }) => executable)).toContain('/bin/sh')
    expect(kept.map(({ executable }) => executable)).not.toContain('/bin/ksh')
    const ksh = (await discovery.discover([], { files: ['/bin/ksh'] })).find(({ executable }) => executable === '/bin/ksh')!
    expect((await discovery.discover([], { ids: [ksh.id] })).map(({ executable }) => executable)).toContain('/bin/ksh')
    // Two fish installs are told apart by location.
    expect(profiles.filter(({ label }) => label.startsWith('fish')).map(({ label }) => label).sort()).toEqual(['fish · /tools', 'fish · /usr/local/bin'])
    expect(profiles.every(({ id, source, available, args }) => id.startsWith('detected:') && source === 'detected' && available && args[0] === '-l')).toBe(true)
    const originalFish = profiles.find(({ executable }) => executable === '/tools/fish')!
    installed.delete('/usr/local/bin/fish')
    expect((await discovery.discover()).find(({ executable }) => executable === '/tools/fish')?.id).toBe(originalFish.id)
    expect(await discovery.automatic()).toMatchObject({ file: '/opt/custom/my-shell' })
  })

  it('deduplicates executable aliases after canonicalization', async () => {
    const discovery = new TerminalProfileDiscovery({
      platform: 'linux', environment: { SHELL: '/bin/sh' }, readShellsFile: async () => '/bin/sh\n/usr/bin/sh',
      resolveExecutable: async (candidate) => ['/bin/sh', '/usr/bin/sh'].includes(candidate) ? '/usr/bin/dash' : undefined,
    })
    expect(await discovery.discover()).toEqual([expect.objectContaining({ executable: '/usr/bin/dash', label: 'sh' })])
  })

  it('discovers multiple PowerShell installations, Git Bash and installed WSL distributions', async () => {
    const cmd = 'C:\\Windows\\System32\\cmd.exe'
    const powershell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
    const pwsh7 = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'
    const pwshPreview = 'C:\\Program Files\\PowerShell\\7-preview\\pwsh.exe'
    const gitBash = 'C:\\Program Files\\Git\\bin\\bash.exe'
    const wsl = 'C:\\Windows\\System32\\wsl.exe'
    const installed = new Set([cmd, powershell, pwsh7, pwshPreview, gitBash, wsl])
    const probe = vi.fn(async () => Buffer.from('\uFEFFUbuntu\r\nDebian\r\n', 'utf16le'))
    const discovery = new TerminalProfileDiscovery({
      platform: 'win32', environment: { comspec: cmd, pAtH: 'C:\\Program Files\\PowerShell\\7' },
      readDirectory: async (directory) => directory === 'C:\\Program Files\\PowerShell' ? ['7', '7-preview', '..', '../escape'] : [],
      resolveExecutable: async (candidate) => installed.has(candidate) ? candidate : undefined,
      probeProcess: probe,
    })
    const profiles = await discovery.discover()
    expect(profiles.filter(({ source }) => source === 'detected').map(({ executable }) => executable).sort()).toEqual([cmd, powershell, pwsh7, pwshPreview, gitBash].sort())
    expect(profiles.filter(({ label }) => label.startsWith('PowerShell · ')).map(({ label }) => label).sort())
      .toEqual([`PowerShell · ${pwsh7.replace(/\\pwsh\.exe$/u, '')}`, `PowerShell · ${pwshPreview.replace(/\\pwsh\.exe$/u, '')}`].sort())
    expect(profiles.find(({ label }) => label === 'Git Bash')).toMatchObject({ args: ['--login', '-i'] })
    expect(probe).toHaveBeenCalledWith(wsl, ['--list', '--quiet'])
    const distros = profiles.filter(({ source }) => source === 'wsl')
    expect(distros).toEqual([
      expect.objectContaining({ id: expect.stringMatching(/^wsl:/), label: 'Ubuntu (WSL)', args: ['--distribution', 'Ubuntu'], available: true }),
      expect.objectContaining({ id: expect.stringMatching(/^wsl:/), label: 'Debian (WSL)', args: ['--distribution', 'Debian'], available: true }),
    ])
    expect(distros[0].id).not.toBe(distros[1].id)
    expect((await discovery.discover()).filter(({ source }) => source === 'wsl').map(({ id }) => id)).toEqual(distros.map(({ id }) => id))
    expect(await discovery.automatic()).toMatchObject({ file: cmd })
  })

  it('does not probe missing WSL and tolerates a failed installed WSL probe', async () => {
    const probe = vi.fn(async () => { throw new Error('WSL unavailable') })
    const options = { platform: 'win32' as const, environment: {}, readDirectory: async () => [], probeProcess: probe }
    expect(await new TerminalProfileDiscovery({ ...options, resolveExecutable: async () => undefined }).discover()).toEqual([])
    expect(probe).not.toHaveBeenCalled()
    expect(await new TerminalProfileDiscovery({ ...options, resolveExecutable: async (candidate) => candidate.endsWith('wsl.exe') ? candidate : undefined }).discover()).toEqual([])
    expect(probe).toHaveBeenCalledTimes(1)
  })

  it('resolves custom executable names with profile PATH overrides and retains unavailable profiles', async () => {
    const discovery = new TerminalProfileDiscovery({
      platform: 'linux', environment: { PATH: '/inherited' }, readShellsFile: async () => '',
      resolveExecutable: async (candidate) => candidate === '/custom/my-shell' ? candidate : undefined,
    })
    const profiles = await discovery.discover([
      { id: 'custom:work', name: 'Work', executable: 'my-shell', args: ['a b', ';literal'], env: { PATH: '/custom' } },
      { id: 'custom:missing', name: 'Missing', executable: 'missing', args: [], env: {} },
      { id: 'custom:not_a_command', name: 'Invalid command line', executable: 'my-shell --flag', args: [], env: { PATH: '/custom' } },
    ])
    expect(profiles[0]).toMatchObject({ executable: '/custom/my-shell', available: true, launch: { args: ['a b', ';literal'], env: { PATH: '/custom' } } })
    expect(profiles.slice(1)).toEqual([
      expect.objectContaining({ available: false, unavailableReason: 'executable-not-found' }),
      expect.objectContaining({ available: false, unavailableReason: 'executable-not-found' }),
    ])
  })

  it('rejects relative, empty and malformed executable paths before probing', async () => {
    const resolveExecutable = vi.fn(async (candidate: string) => candidate)
    const discovery = new TerminalProfileDiscovery({ platform: 'linux', environment: {}, resolveExecutable })
    for (const candidate of ['', 'relative/shell', '/bad\0shell', '/bad\nshell', 'x'.repeat(4097)]) expect(await discovery.executable(candidate)).toBeUndefined()
    expect(resolveExecutable).not.toHaveBeenCalled()
  })
})

describe('WSL working directory mapping', () => {
  it.each([
    ['C:\\Projects\\My project', 'Ubuntu', '/mnt/c/Projects/My project'],
    ['D:/code', 'Ubuntu', '/mnt/d/code'],
    ['C:\\', 'Ubuntu', '/mnt/c/'],
    ['\\\\?\\C:\\Projects', 'Ubuntu', '/mnt/c/Projects'],
    ['\\\\?\\UNC\\wsl$\\Ubuntu\\home\\user', 'Ubuntu', '/home/user'],
    ['\\\\wsl$\\Ubuntu\\home\\user\\work', 'ubuntu', '/home/user/work'],
    ['\\\\wsl.localhost\\Debian', 'Debian', '/'],
    ['\\\\wsl$\\Debian\\home\\user', 'Ubuntu', undefined],
    ['\\\\server\\share\\work', 'Ubuntu', undefined],
    ['C:relative', 'Ubuntu', undefined],
    ['/unix/path', 'Ubuntu', undefined],
  ])('maps %s for %s', (cwd, distribution, expected) => {
    expect(wslWorkingDirectory(cwd, distribution)).toBe(expected)
  })

  it('parses UTF-16 and UTF-8 distro inventories without shell evaluation', () => {
    expect(parseWslDistributions(Buffer.from('\uFEFFUbuntu\r\nDebian\r\nUbuntu\r\n', 'utf16le'))).toEqual(['Ubuntu', 'Debian'])
    expect(parseWslDistributions('Ubuntu\n发行版\n\ninvalid/name\n')).toEqual(['Ubuntu', '发行版'])
  })
})

describe('terminal environment merging', () => {
  it('removes and replaces Windows keys case-insensitively without mutating inputs', () => {
    const inherited = { Path: 'old', TOKEN: 'secret', Preserve: 'yes' }
    expect(mergeTerminalEnvironment(inherited, { PATH: 'new', token: null }, 'win32')).toEqual({ PATH: 'new', Preserve: 'yes' })
    expect(inherited).toEqual({ Path: 'old', TOKEN: 'secret', Preserve: 'yes' })
  })

  it('keeps Unix environment names case-sensitive', () => {
    expect(mergeTerminalEnvironment({ PATH: '/bin', path: '/other' }, { path: null }, 'linux')).toEqual({ PATH: '/bin' })
  })
})

describe('terminal locale', () => {
  const exists = (names: string[]) => (name: string) => names.includes(name)

  it('gives a terminal launched without a locale a UTF-8 one in the system language', () => {
    expect(terminalLocaleEnvironment({}, 'darwin', 'zh-CN', exists(['zh_CN.UTF-8']))).toEqual({ LANG: 'zh_CN.UTF-8' })
    expect(terminalLocaleEnvironment({ LANG: '' }, 'darwin', 'zh-Hans-CN', exists(['zh_CN.UTF-8']))).toEqual({ LANG: 'zh_CN.UTF-8' })
    expect(terminalLocaleEnvironment({}, 'darwin', 'zh-Hans', exists(['zh_CN.UTF-8']))).toEqual({ LANG: 'en_US.UTF-8' })
    expect(terminalLocaleEnvironment({ LANG: 'C' }, 'darwin', 'en', exists([]))).toEqual({ LANG: 'en_US.UTF-8' })
    expect(terminalLocaleEnvironment({}, 'linux', 'zh-CN', exists(['zh_CN.UTF-8']))).toEqual({ LANG: 'C.UTF-8' })
  })

  it('keeps a locale the user chose, and leaves Windows alone', () => {
    expect(terminalLocaleEnvironment({ LANG: 'zh_CN.UTF-8' }, 'darwin', 'en-US', exists(['en_US.UTF-8']))).toEqual({})
    expect(terminalLocaleEnvironment({ LANG: 'C.utf8' }, 'linux', 'en-US', exists([]))).toEqual({})
    expect(terminalLocaleEnvironment({ LC_ALL: 'C' }, 'linux', 'en-US', exists([]))).toEqual({})
    expect(terminalLocaleEnvironment({ LC_CTYPE: 'UTF-8' }, 'darwin', 'en-US', exists([]))).toEqual({})
    expect(terminalLocaleEnvironment({}, 'win32', 'zh-CN', exists([]))).toEqual({})
  })
})
