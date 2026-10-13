import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsManager } from '@earendil-works/pi-coding-agent'
import { canonicalProjectPath, resolveProjectTrust } from '../../src/main/project-trust/project-trust-resolution'
import { ProjectTrustService } from '../../src/main/project-trust/project-trust-service'
import { RuntimeMaintenanceBusyError } from '../../src/main/pi-host/runtime-maintenance-gate'

let root: string
let agentDir: string
let project: string
let sessionFile: string

function withResources(path: string) {
  mkdirSync(join(path, '.pi', 'extensions'), { recursive: true })
  writeFileSync(join(path, '.pi', 'extensions', 'hello.ts'), 'export default () => {}\n')
}

function service(reloadRuntimes = vi.fn(async () => undefined), recent = [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', path: project }]) {
  return new ProjectTrustService({
    agentDir, sessionFile, migrationFile: join(root, 'migration.json'),
    workspaces: {
      get: () => ({ recent }),
      getLocation: (id) => recent.find((entry) => entry.id === id),
    },
    runtime: { reloadRuntimes, subscribeControlRuntimes: () => () => undefined },
  })
}
const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pipilot-trust-'))
  agentDir = join(root, 'agent')
  project = join(root, 'projects', 'demo')
  sessionFile = join(root, 'session.json')
  mkdirSync(agentDir, { recursive: true })
  mkdirSync(project, { recursive: true })
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('project trust resolution', () => {
  it('trusts a project without gated resources', () => {
    expect(resolveProjectTrust(project, agentDir, sessionFile)).toMatchObject({ state: 'not-required', trusted: true })
  })

  it('runs an undecided project untrusted, following the policy otherwise', () => {
    withResources(project)
    expect(resolveProjectTrust(project, agentDir, sessionFile)).toMatchObject({ state: 'undecided', trusted: false })
    writeFileSync(join(agentDir, 'settings.json'), JSON.stringify({ defaultProjectTrust: 'always' }))
    expect(resolveProjectTrust(project, agentDir, sessionFile)).toMatchObject({ state: 'trusted', trusted: true })
    writeFileSync(join(agentDir, 'settings.json'), JSON.stringify({ defaultProjectTrust: 'never' }))
    expect(resolveProjectTrust(project, agentDir, sessionFile)).toMatchObject({ state: 'untrusted', trusted: false })
  })

  it('matches Pi for a Windows UTF-8 BOM settings file', () => {
    withResources(project)
    writeFileSync(join(agentDir, 'settings.json'), `\uFEFF${JSON.stringify({ defaultProjectTrust: 'always' })}`)
    const sdk = SettingsManager.create(project, agentDir, { projectTrusted: false })
    expect(sdk.getDefaultProjectTrust()).toBe('always')
    expect(resolveProjectTrust(project, agentDir, sessionFile)).toMatchObject({ state: 'trusted', trusted: true, policy: 'always' })
  })

  it('prefers a session decision, then the nearest saved decision', () => {
    withResources(project)
    const parent = canonicalProjectPath(join(root, 'projects'))
    writeFileSync(join(agentDir, 'trust.json'), JSON.stringify({ [parent]: true }))
    expect(resolveProjectTrust(project, agentDir, sessionFile)).toMatchObject({ state: 'trusted', savedPath: parent })
    writeFileSync(sessionFile, JSON.stringify({ [canonicalProjectPath(project)]: false }))
    expect(resolveProjectTrust(project, agentDir, sessionFile)).toMatchObject({ state: 'untrusted', sessionOnly: true })
  })

  it('treats an unreadable session file as no decision', () => {
    withResources(project)
    writeFileSync(sessionFile, '{ not json')
    expect(resolveProjectTrust(project, agentDir, sessionFile)).toMatchObject({ state: 'undecided', trusted: false })
  })
})

describe('project trust service', () => {
  it('applies the saved default to newly added projects and asks again when that default is disabled', async () => {
    const recent: Array<{ id: string; path: string }> = []
    const trust = service(vi.fn(async () => undefined), recent)
    await trust.initialize()
    expect(await trust.setPolicy('always')).toBe('always')
    withResources(project)
    recent.push({ id: ID, path: project })
    expect(trust.status(ID)).toMatchObject({ state: 'trusted', trusted: true, policy: 'always' })
    expect(await trust.setPolicy('ask')).toBe('ask')
    expect(trust.status(ID)).toMatchObject({ state: 'undecided', trusted: false, policy: 'ask' })
    expect(() => readFileSync(join(agentDir, 'trust.json'), 'utf8')).toThrow()
    trust.dispose()
  })

  it('reports a settings failure instead of appearing to save a default that never took effect', async () => {
    const reloadRuntimes = vi.fn(async () => undefined)
    const trust = service(reloadRuntimes)
    await trust.initialize()
    const invalidSettings = '{ invalid settings'
    writeFileSync(join(agentDir, 'settings.json'), invalidSettings)
    await expect(trust.setPolicy('always')).rejects.toMatchObject({ code: 'PROJECT_TRUST_FAILED' })
    expect(reloadRuntimes).not.toHaveBeenCalled()
    expect(readFileSync(join(agentDir, 'settings.json'), 'utf8')).toBe(invalidSettings)
    trust.dispose()
  })

  it('migrates already added projects to trusted once', async () => {
    withResources(project)
    const trust = service()
    await trust.initialize()
    expect(JSON.parse(readFileSync(join(agentDir, 'trust.json'), 'utf8'))).toEqual({ [canonicalProjectPath(project)]: true })
    await trust.decide(ID, 'reset')
    await service().initialize()
    expect(trust.status(ID).state).toBe('undecided')
  })

  it('saves decisions in trust.json, keeps session ones out of it, and reloads the project', async () => {
    writeFileSync(join(root, 'migration.json'), '{}')
    withResources(project)
    const reloadRuntimes = vi.fn(async () => undefined)
    const trust = service(reloadRuntimes)
    await trust.initialize()
    expect((await trust.decide(ID, 'session'))).toMatchObject({ state: 'trusted', sessionOnly: true })
    expect(() => readFileSync(join(agentDir, 'trust.json'), 'utf8')).toThrow()
    expect((await trust.decide(ID, 'distrust'))).toMatchObject({ state: 'untrusted', sessionOnly: false })
    expect(JSON.parse(readFileSync(sessionFile, 'utf8'))).toEqual({})
    expect((await trust.decide(ID, 'trust-parent'))).toMatchObject({ state: 'trusted', savedPath: canonicalProjectPath(join(root, 'projects')) })
    expect(reloadRuntimes).toHaveBeenCalledWith(project)
  })

  it('reports a decision as pending while the project is busy', async () => {
    writeFileSync(join(root, 'migration.json'), '{}')
    withResources(project)
    const trust = service(vi.fn(async () => { throw new RuntimeMaintenanceBusyError() }))
    await trust.initialize()
    expect((await trust.decide(ID, 'trust'))).toMatchObject({ state: 'trusted', apply: 'pending' })
  })

  it('clears session decisions from a previous run', async () => {
    writeFileSync(join(root, 'migration.json'), '{}')
    withResources(project)
    writeFileSync(sessionFile, JSON.stringify({ [canonicalProjectPath(project)]: true }))
    const trust = service()
    await trust.initialize()
    expect(trust.status(ID).state).toBe('undecided')
  })
})
