import { constants, type Stats } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TerminalProfileDiscovery } from '../../src/main/terminal/terminal-profile-discovery'
import { ExternalTerminalApps } from '../../src/main/terminal/external-terminal-apps'

const fs = vi.hoisted(() => ({ realpath: vi.fn(), stat: vi.fn(), lstat: vi.fn(), access: vi.fn() }))
vi.mock('node:fs/promises', async (importOriginal) => ({ ...await importOriginal<typeof import('node:fs/promises')>(), ...fs }))

const local = 'C:\\Users\\person\\AppData\\Local'
const windowsApps = `${local}\\Microsoft\\WindowsApps`
const pwsh = `${windowsApps}\\pwsh.exe`
const wt = `${windowsApps}\\wt.exe`
const environment = { localAppData: local }
const missing = () => Object.assign(new Error('not found'), { code: 'ENOENT' })
const details = (kind: 'file' | 'link' | 'directory' | 'other') => ({
  isFile: () => kind === 'file', isSymbolicLink: () => kind === 'link', isDirectory: () => kind === 'directory',
}) as Stats

beforeEach(() => {
  vi.resetAllMocks()
  fs.realpath.mockRejectedValue(Object.assign(new Error('Store target cannot be opened'), { code: 'EACCES' }))
  fs.stat.mockRejectedValue(missing())
  fs.lstat.mockRejectedValue(missing())
  fs.access.mockResolvedValue(undefined)
})

describe('known Windows terminal app execution aliases', () => {
  it.each(['file', 'link'] as const)('keeps an existing Store shell alias reported as a %s without dereferencing its target', async (kind) => {
    fs.lstat.mockResolvedValue(details(kind))
    const discovery = new TerminalProfileDiscovery({ platform: 'win32', environment })
    expect(await discovery.executable(pwsh)).toBe(pwsh)
    expect(fs.realpath).toHaveBeenCalledWith(pwsh)
    expect(fs.lstat).toHaveBeenCalledWith(pwsh)
    expect(fs.access).toHaveBeenCalledWith(pwsh, constants.F_OK)
    expect(fs.stat).not.toHaveBeenCalled()
  })

  it('supports case-insensitive WindowsApps identity and retains the alias instead of a protected package target', async () => {
    fs.lstat.mockResolvedValue(details('link'))
    const discovery = new TerminalProfileDiscovery({ platform: 'win32', environment })
    const candidate = `${windowsApps.toUpperCase()}\\PWSH.EXE`
    expect(await discovery.executable(candidate)).toBe(candidate)
  })

  it('makes the Store shell available to automatic selection and rechecks it at selection time', async () => {
    let installed = true
    fs.lstat.mockImplementation(async (candidate) => {
      if (candidate === pwsh && installed) return details('link')
      throw missing()
    })
    const discovery = new TerminalProfileDiscovery({ platform: 'win32', environment, readDirectory: async () => [] })
    expect((await discovery.automatic())?.file).toBe(pwsh)
    const selected = (await discovery.discover()).find((profile) => profile.executable === pwsh)!
    expect((await discovery.selected(selected.id))?.launch?.file).toBe(pwsh)
    installed = false
    expect(await discovery.selected(selected.id)).toBeUndefined()
  })

  it('discovers and revalidates the Windows Terminal alias through filesystem checks before handoff', async () => {
    let installed = true
    fs.lstat.mockImplementation(async (candidate) => {
      if (candidate === wt && installed) return details('link')
      throw missing()
    })
    const launchExternal = vi.fn(async () => undefined)
    const apps = new ExternalTerminalApps({ platform: 'win32', environment, launchExternal })
    const discovered = await apps.list()
    expect(discovered).toEqual([expect.objectContaining({ adapter: 'windows-terminal', executable: wt, available: true })])
    await apps.open(discovered[0].id, 'C:\\Projects\\中文')
    expect(launchExternal).toHaveBeenCalledWith(wt, ['-w', 'new', 'new-tab', '-d', 'C:\\Projects\\中文'], { cwd: 'C:\\Projects\\中文' })
    installed = false
    await expect(apps.open(discovered[0].id, 'C:\\Projects')).rejects.toMatchObject({ code: 'TERMINAL_EXTERNAL_APP_UNAVAILABLE' })
    expect(launchExternal).toHaveBeenCalledTimes(1)
  })

  it.each(['directory', 'other'] as const)('rejects a WindowsApps candidate that is a %s', async (kind) => {
    fs.lstat.mockResolvedValue(details(kind))
    expect(await new TerminalProfileDiscovery({ platform: 'win32', environment }).executable(pwsh)).toBeUndefined()
    expect(fs.access).not.toHaveBeenCalled()
  })

  it('rejects absent aliases and entries whose existence check fails', async () => {
    const discovery = new TerminalProfileDiscovery({ platform: 'win32', environment })
    expect(await discovery.executable(pwsh)).toBeUndefined()
    fs.lstat.mockResolvedValue(details('link'))
    fs.access.mockRejectedValue(missing())
    expect(await discovery.executable(pwsh)).toBeUndefined()
  })

  it('never broadens failed executable resolution to other names, descendants, directories, or platforms', async () => {
    fs.lstat.mockResolvedValue(details('link'))
    const discovery = new TerminalProfileDiscovery({ platform: 'win32', environment })
    for (const candidate of [`${windowsApps}\\unknown.exe`, `${windowsApps}\\package\\pwsh.exe`, `${local}\\Other\\pwsh.exe`, 'C:\\Other\\WindowsApps\\wt.exe', 'relative\\pwsh.exe']) {
      expect(await discovery.executable(candidate)).toBeUndefined()
    }
    expect(await new TerminalProfileDiscovery({ platform: 'linux', environment }).executable('/Microsoft/WindowsApps/pwsh.exe')).toBeUndefined()
    expect(await new TerminalProfileDiscovery({ platform: 'win32', environment: {} }).executable(pwsh)).toBeUndefined()
    expect(await new TerminalProfileDiscovery({ platform: 'win32', environment: { LOCALAPPDATA: 'relative' } }).executable(pwsh)).toBeUndefined()
    expect(fs.lstat).not.toHaveBeenCalled()
  })

  it('keeps normal canonical-file validation and never falls back after a later stat or access failure', async () => {
    fs.realpath.mockResolvedValue(pwsh)
    fs.stat.mockResolvedValue(details('file'))
    const discovery = new TerminalProfileDiscovery({ platform: 'win32', environment })
    expect(await discovery.executable(pwsh)).toBe(pwsh)
    fs.stat.mockRejectedValue(missing())
    expect(await discovery.executable(pwsh)).toBeUndefined()
    fs.stat.mockResolvedValue(details('file'))
    fs.access.mockRejectedValue(missing())
    expect(await discovery.executable(pwsh)).toBeUndefined()
    expect(fs.lstat).not.toHaveBeenCalled()
  })
})
