import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, win32 } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ExecutableIdentityResolver } from '../../src/main/editors/executable-identity'

const alias = 'C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe'
const physical = 'C:\\Program Files\\WindowsApps\\Microsoft.WindowsTerminal_1.0_x64\\WindowsTerminal.exe'
const failure = (code: string) => Object.assign(new Error(code), { code })

function windowsResolver(links: Record<string, string>, protectedTargets = new Set<string>()) {
  return new ExecutableIdentityResolver({
    platform: 'win32',
    realpath: async (path) => {
      if (path in links || protectedTargets.has(path)) throw failure('EACCES')
      throw failure('ENOENT')
    },
    readlink: async (path) => {
      if (path in links) return links[path]!
      throw failure(protectedTargets.has(path) ? 'EACCES' : 'ENOENT')
    },
  })
}

describe('executable identity', () => {
  it('unifies a Windows execution alias with its protected physical target without launching it', async () => {
    const resolver = windowsResolver({ [alias]: physical }, new Set([physical]))
    expect(await resolver.identity(alias)).toBe(await resolver.identity(physical))
    expect(await resolver.identity(alias)).toBe(physical.toLowerCase())
  })

  it('uses successful filesystem canonicalization first, including already resolved shortcut targets', async () => {
    const readlink = vi.fn(async () => { throw failure('EINVAL') })
    const resolver = new ExecutableIdentityResolver({ platform: 'win32', realpath: async () => physical, readlink })
    expect(await resolver.identity(alias)).toBe(await resolver.identity(physical))
    expect(readlink).not.toHaveBeenCalled()
  })

  it('follows relative and multiple links when the eventual executable is protected', async () => {
    const intermediate = 'C:\\Tools\\current.exe'
    const resolver = windowsResolver({ [alias]: intermediate, [intermediate]: '..\\Program Files\\WindowsApps\\Microsoft.WindowsTerminal_1.0_x64\\WindowsTerminal.exe' }, new Set([physical]))
    expect(await resolver.identity(alias)).toBe(physical.toLowerCase())
  })

  it('preserves separate stable, preview and portable installations with the same executable name', async () => {
    const preview = physical.replace('WindowsTerminal_1.0', 'WindowsTerminalPreview_1.0')
    const portable = 'D:\\Tools\\WindowsTerminal.exe'
    const resolver = windowsResolver({ [alias]: physical }, new Set([physical, preview, portable]))
    const identities = await Promise.all([alias, physical, preview, portable].map((path) => resolver.identity(path)))
    expect(new Set(identities).size).toBe(3)
  })

  it('normalizes Windows case, slash direction and extended drive or UNC prefixes', async () => {
    const resolver = windowsResolver({})
    expect(await resolver.identity('\\\\?\\C:\\Apps\\Terminal.exe')).toBe(await resolver.identity('c:/apps/terminal.exe'))
    expect(await resolver.identity('\\\\?\\UNC\\SERVER\\Share\\Terminal.exe')).toBe(await resolver.identity('\\\\server\\share\\terminal.exe'))
    expect(await resolver.identity('\\\\?\\UNC\\SERVER.example\\Share\\Terminal.exe')).toBe(await resolver.identity('\\\\server.example\\share\\terminal.exe'))
  })

  it('does not merge broken aliases with their missing target or each other', async () => {
    const other = 'C:\\Tools\\wt.exe'
    const resolver = windowsResolver({ [alias]: physical, [other]: physical })
    const identities = await Promise.all([alias, other, physical].map((path) => resolver.identity(path)))
    expect(new Set(identities).size).toBe(3)
  })

  it('keeps cyclic aliases distinct and stops traversing them', async () => {
    const resolver = windowsResolver({ [alias]: physical, [physical]: alias })
    expect(await resolver.identity(alias)).toBe(alias.toLowerCase())
    expect(await resolver.identity(physical)).toBe(physical.toLowerCase())
  })

  it.each(['', 'bad\0path', 'bad\npath', 'C:relative.exe', 'https://example.com/terminal.exe', '\\\\.\\pipe\\terminal'])('rejects malformed link target %j', async (target) => {
    const resolver = windowsResolver({ [alias]: target })
    expect(await resolver.identity(alias)).toBe(alias.toLowerCase())
  })

  it('bounds traversal of a very long chain', async () => {
    const readlink = vi.fn(async (path: string) => win32.join(win32.dirname(path), `${Number(win32.basename(path, '.exe')) + 1}.exe`))
    const resolver = new ExecutableIdentityResolver({ platform: 'win32', realpath: async () => { throw failure('ELOOP') }, readlink })
    expect(await resolver.identity('C:\\Tools\\0.exe')).toBe('c:\\tools\\0.exe')
    expect(readlink.mock.calls.length).toBeLessThanOrEqual(32)
  })

  it('shares concurrent resolution and refreshes aliases after clear', async () => {
    let target = physical
    const realpath = vi.fn(async () => target)
    const resolver = new ExecutableIdentityResolver({ platform: 'win32', realpath })
    expect(await Promise.all([resolver.identity(alias), resolver.identity(alias.toUpperCase())])).toEqual([physical.toLowerCase(), physical.toLowerCase()])
    expect(realpath).toHaveBeenCalledTimes(1)
    target = physical.replace('_1.0_', '_2.0_')
    resolver.clear()
    expect(await resolver.identity(alias)).toBe(target.toLowerCase())
    expect(realpath).toHaveBeenCalledTimes(2)
  })

  it('bounds its cache across repeated scans', async () => {
    const realpath = vi.fn(async (path: string) => path)
    const resolver = new ExecutableIdentityResolver({ platform: 'win32', realpath })
    await resolver.identity('C:\\Apps\\first.exe')
    for (let i = 0; i < 4_096; i += 1) await resolver.identity(`C:\\Apps\\${i}.exe`)
    await resolver.identity('C:\\Apps\\first.exe')
    expect(realpath.mock.calls.filter(([path]) => path === 'C:\\Apps\\first.exe')).toHaveLength(2)
  })

  it.skipIf(process.platform === 'win32')('canonicalizes a real POSIX symlink without merging case-distinct paths', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pipilot-executable-identity-'))
    try {
      const target = join(directory, 'terminal')
      const link = join(directory, 'terminal-link')
      await writeFile(target, '')
      await symlink(target, link)
      const resolver = new ExecutableIdentityResolver()
      expect(await resolver.identity(link)).toBe(await resolver.identity(target))
      const linux = new ExecutableIdentityResolver({ platform: 'linux', realpath: async (path) => path })
      expect(await linux.identity('/Apps/Terminal')).not.toBe(await linux.identity('/Apps/terminal'))
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
})
