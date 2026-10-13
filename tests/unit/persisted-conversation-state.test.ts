import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkspaceRepository } from '../../src/main/repositories/workspace-repository'
import { ConversationNavigationRepository } from '../../src/main/repositories/conversation-navigation-repository'
import { ObservedPiSessionDirectoryRepository } from '../../src/main/repositories/observed-pi-session-directory-repository'
import { SettingsRepository } from '../../src/main/repositories/settings-repository'
import { PiDirectoryPreference } from '../../src/main/pi-directory-preference'
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION } from '../../src/shared/settings'

const roots: string[] = []
async function fixtureRoot() {
  const root = await mkdtemp(join(tmpdir(), 'pipilot-persisted-state-'))
  roots.push(root)
  return root
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('persisted conversation state', () => {
  it('reopens projects, session locations and preferences written with a Windows UTF-8 BOM', async () => {
    const root = await fixtureRoot()
    const project = join(root, '项目 With Spaces')
    const agent = join(root, 'agent')
    const sessionDirectory = join(agent, 'sessions', 'fixture')
    await Promise.all([mkdir(project), mkdir(sessionDirectory, { recursive: true })])
    const workspacesFile = join(root, 'workspaces.json')
    const navigationFile = join(root, 'conversation-navigation.json')
    const observationsFile = join(root, 'observed-pi-session-directories.json')
    const settingsFile = join(root, 'settings.json')
    const directoryFile = join(root, 'pi-directory.json')
    const workspaces = new WorkspaceRepository(workspacesFile)
    await workspaces.initialize()
    const opened = await workspaces.activatePath(project)
    workspaces.setPinned(opened.id, true)
    const scope = { kind: 'project', workspaceId: opened.id } as const
    const navigation = new ConversationNavigationRepository(navigationFile)
    navigation.initialize()
    navigation.setActiveScope(scope)
    const observations = new ObservedPiSessionDirectoryRepository(observationsFile)
    await observations.initialize()
    const observed = await observations.observe(scope, join(sessionDirectory, 'session.jsonl'))
    expect(observed.status).toBe('observed')
    await writeFile(settingsFile, JSON.stringify({
      version: SETTINGS_SCHEMA_VERSION,
      settings: { ...DEFAULT_SETTINGS, locale: 'zh-CN' },
    }))
    await writeFile(directoryFile, JSON.stringify({ directory: agent }))
    for (const file of [workspacesFile, navigationFile, observationsFile, settingsFile, directoryFile]) {
      await writeFile(file, `\uFEFF${await readFile(file, 'utf8')}`)
    }

    const restoredProjects = await new WorkspaceRepository(workspacesFile).initialize()
    expect(restoredProjects.recent).toEqual([expect.objectContaining({ id: opened.id, pinned: true, available: true })])
    expect(new ConversationNavigationRepository(navigationFile).initialize().activeScope).toEqual(scope)
    const restoredObservations = new ObservedPiSessionDirectoryRepository(observationsFile)
    await restoredObservations.initialize()
    expect(restoredObservations.getState(scope)).toEqual(observed)
    expect(new SettingsRepository(settingsFile).initialize().settings.locale).toBe('zh-CN')
    expect(new PiDirectoryPreference(directoryFile, root).activeDirectory).toBe(agent)
    expect((await readdir(root)).some((name) => name.includes('.corrupt-'))).toBe(false)
  })

  for (const Repository of [WorkspaceRepository, ConversationNavigationRepository, ObservedPiSessionDirectoryRepository]) {
    it(`${Repository.name} preserves existing storage when the file cannot be read`, async () => {
      const root = await fixtureRoot()
      const file = join(root, 'state.json')
      // A directory gives a deterministic I/O failure on every supported OS,
      // including elevated Windows runners where chmod cannot simulate EACCES.
      await mkdir(file)
      await writeFile(join(file, 'retained'), 'do not replace unreadable storage')
      const diagnostics: string[] = []
      const repository = new Repository(file, { onDiagnostic: (code) => diagnostics.push(code) })
      await expect((async () => { await repository.initialize() })()).rejects.toThrow()
      await repository.flush()
      expect(diagnostics).toEqual([])
      expect((await stat(file)).isDirectory()).toBe(true)
      expect(await readFile(join(file, 'retained'), 'utf8')).toBe('do not replace unreadable storage')
      expect(await readdir(root)).toEqual(['state.json'])
    })
  }
})
