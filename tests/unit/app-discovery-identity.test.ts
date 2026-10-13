import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { ExternalTerminalApps, type ExternalTerminalAppsOptions } from '../../src/main/terminal/external-terminal-apps'
import { ExternalEditors } from '../../src/main/editors/external-editors'
import { TerminalService } from '../../src/main/terminal/terminal-service'
import { DEFAULT_SETTINGS, type TerminalSettings } from '../../src/shared/settings'
import { matchesAppId } from '../../src/shared/app-identity'
import { externalEditorListSchema } from '../../src/shared/external-editors'
import { terminalExternalAppSchema } from '../../src/shared/terminal-profiles'
import type { TerminalCustomExternalApp } from '../../src/shared/terminal-profiles'

const local = 'C:\\Users\\person\\AppData\\Local'
const alias = `${local}\\Microsoft\\WindowsApps\\wt.exe`
const physical = 'C:\\Program Files\\WindowsApps\\Microsoft.WindowsTerminal_1.0_x64__publisher\\wt.exe'
const environment = { LOCALAPPDATA: local, PATH: physical.slice(0, -7) }
const hash = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 32)
const externalId = (path: string) => `external:detected:${hash(`windows-terminal:${path.toLowerCase()}`)}`
const files = new Set([alias, physical])
const resolveExecutable = async (path: string) => files.has(path) ? path : undefined
const resolveIdentity = async (path: string) => (path === alias ? physical : path).toLowerCase()

describe('application identity through discovery and saved selection', () => {
  it('shows one Windows app but accepts both saved launch-path IDs', async () => {
    const launchExternal = vi.fn<NonNullable<ExternalTerminalAppsOptions['launchExternal']>>(async () => {})
    const apps = new ExternalTerminalApps({ platform: 'win32', environment, resolveExecutable, resolveIdentity, launchExternal })
    const listed = await apps.list()
    expect(listed).toHaveLength(1)
    expect(listed[0].label).toBe('Windows Terminal')
    expect(matchesAppId(listed[0], externalId(alias))).toBe(true)
    expect(matchesAppId(listed[0], externalId(physical))).toBe(true)
    expect(terminalExternalAppSchema.safeParse(listed[0]).success).toBe(true)
    await apps.open(externalId(alias), 'C:\\project')
    await apps.open(externalId(physical), 'C:\\project')
    expect(launchExternal.mock.calls.map(([file]) => file)).toEqual([alias, physical])
    listed[0].aliases?.push('external:detected:changed')
    expect((await apps.list())[0].aliases).not.toContain('external:detected:changed')
  })

  it('keeps independent installations and unknown alias targets separate', async () => {
    const apps = new ExternalTerminalApps({ platform: 'win32', environment, resolveExecutable,
      resolveIdentity: async (path) => path.toLowerCase() })
    expect(await apps.list()).toHaveLength(2)
    const preview = 'D:\\TerminalPreview\\wt.exe'
    const withPreview = new ExternalTerminalApps({ platform: 'win32', environment: { ...environment, PATH: environment.PATH + ';D:\\TerminalPreview' },
      resolveExecutable: async (path) => files.has(path) || path === preview ? path : undefined, resolveIdentity })
    expect((await withPreview.list()).map((app) => app.executable)).toEqual([alias, preview])
  })

  it('merges equivalent manual entries without mutating settings, preserving custom arguments', async () => {
    const customs: TerminalCustomExternalApp[] = [
      { id: 'external:custom:mine', name: 'My terminal', executable: physical, adapter: 'generic' },
      { id: 'external:custom:duplicate', name: 'Another name', executable: alias, adapter: 'windows-terminal', args: [] },
      { id: 'external:custom:args', name: 'Different arguments', executable: alias, adapter: 'generic', args: ['-w', '0', '-d', '{dir}'] },
    ]
    const original = structuredClone(customs)
    const launchExternal = vi.fn<NonNullable<ExternalTerminalAppsOptions['launchExternal']>>(async () => {})
    const apps = new ExternalTerminalApps({ platform: 'win32', environment, resolveExecutable, resolveIdentity, launchExternal })
    const listed = await apps.list(customs)
    expect(listed.map((app) => app.id)).toEqual(['external:custom:mine', 'external:custom:args'])
    expect(matchesAppId(listed[0], 'external:custom:duplicate')).toBe(true)
    expect(matchesAppId(listed[0], externalId(alias))).toBe(true)
    await apps.open('external:custom:duplicate', 'C:\\work', customs)
    await apps.open('external:custom:args', 'C:\\work', customs)
    expect(launchExternal.mock.calls[1]).toEqual([alias, ['-w', '0', '-d', 'C:\\work'], { cwd: 'C:\\work' }])
    expect(customs).toEqual(original)
  })

  it('does not mark a merged saved external-terminal default unavailable', async () => {
    const settings = { ...structuredClone(DEFAULT_SETTINGS.terminal), defaultExternalAppId: externalId(physical) }
    const service = new TerminalService(() => ({ kind: 'projectless' }), async () => ({ scope: { kind: 'projectless' }, cwd: 'C:\\work' }), {
      platform: 'win32', environment, resolveExecutable, resolveIdentity, getTerminalSettings: () => settings,
    })
    const listed = await service.listExternalApps()
    expect(listed).toHaveLength(1)
    expect(listed[0].available).toBe(true)
    expect(matchesAppId(listed[0], settings.defaultExternalAppId)).toBe(true)
  })

  it('keeps a detected shell default selected when its equivalent custom profile represents it', async () => {
    const executable = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'
    const selected = `detected:${hash(executable.toLowerCase())}`
    const settings: TerminalSettings = { ...structuredClone(DEFAULT_SETTINGS.terminal), defaultProfileId: selected,
      profiles: [{ id: 'custom:mine', name: 'My shell', executable, args: [], env: {} }] }
    const service = new TerminalService(() => ({ kind: 'projectless' }), async () => ({ scope: { kind: 'projectless' }, cwd: 'C:\\work' }), {
      platform: 'win32', environment: {}, readDirectory: async () => [],
      resolveExecutable: async (path) => path === executable ? path : undefined, resolveIdentity,
      resolveShell: () => ({ file: executable, args: ['-NoProfile'], label: 'Automatic PowerShell' }),
      getTerminalSettings: () => settings,
    })
    const listed = await service.listShellProfiles()
    expect(listed).toHaveLength(1)
    expect(listed[0]).toMatchObject({ id: 'custom:mine', available: true, isDefault: true })
    expect(matchesAppId(listed[0], selected)).toBe(true)
    settings.defaultProfileId = null
    expect((await service.listShellProfiles())[0].isDefault).toBe(true)
  })

  it('merges a plain manually added editor and preserves explicit argument variants', async () => {
    const executable = 'C:\\Editors\\Code.exe'
    const custom: TerminalCustomExternalApp[] = [
      { id: 'external:custom:code', name: 'My Code', kind: 'editor', adapter: 'generic', executable },
      { id: 'external:custom:new', name: 'New window', kind: 'editor', adapter: 'generic', executable, args: ['--new-window', '{path}'] },
      { id: 'external:custom:newcopy', name: 'New window copy', kind: 'editor', adapter: 'generic', executable, args: ['--new-window', '{path}'] },
    ]
    const editors = new ExternalEditors({ platform: 'win32', env: { PATH: 'C:\\Editors' }, readAppPaths: async () => new Map(),
      isExecutableFile: async (path) => path === executable, resolveIdentity: async (path) => path.toLowerCase(),
      customApps: () => custom, openPath: async () => '', showItemInFolder: () => {},
    })
    const listed = await editors.list()
    const found = listed.filter((app) => app.kind === 'editor')
    expect(found.map((app) => app.id)).toEqual(['vscode', 'external:custom:new'])
    expect(matchesAppId(found[0], 'external:custom:code')).toBe(true)
    expect(matchesAppId(found[1], 'external:custom:newcopy')).toBe(true)
    expect(externalEditorListSchema.safeParse({ editors: listed }).success).toBe(true)
    expect(custom).toHaveLength(3)
  })
})
