import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DefaultPackageManager, SettingsManager } from '@earendil-works/pi-coding-agent'
import { PI_RECOMMENDED_PACKAGES } from '../../src/shared/pi-package-adapters'
import { DefaultPackageRepository } from '../../src/main/local-pi-management/default-package-repository'
import {
  bootstrapRecommendedPackages,
  recommendedPackageSnapshot,
  recordRecommendedPackageMutation,
} from '../../src/main/local-pi-management/recommended-packages'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const agentDir = await mkdtemp(join(tmpdir(), 'pipilot-default-packages-'))
  roots.push(agentDir)
  const configured: Array<{ source: string; scope: 'user' | 'project'; filtered?: boolean; installedPath?: string }> = []
  const packageManager = {
    listConfiguredPackages: () => configured,
    getInstalledPath: vi.fn((): string | undefined => undefined),
    install: vi.fn(async (_source: string, _options: { local: boolean }) => undefined),
    addSourceToSettings: vi.fn((source: string, _options: { local: boolean }) => {
      configured.push({ source, scope: 'user' })
      return true
    }),
  }
  return { agentDir, configured, packageManager, reloadSettings: vi.fn(async () => undefined), flushSettings: vi.fn(async () => undefined), onProgress: vi.fn() }
}

describe('recommended global Pi packages', () => {
  it.each(['none', 'other-package', 'same-package'] as const)('uses actual SDK storage and preserves concurrent CLI changes (%s)', async (concurrentEdit) => {
    const work = await fixture()
    const cwd = join(work.agentDir, 'project')
    await mkdir(cwd)
    const runner = join(work.agentDir, 'fixture-npm.cjs')
    const logPath = join(work.agentDir, 'npm-commands.jsonl')
    const externalPackage = {
      source: concurrentEdit === 'same-package' ? 'npm:@narumitw/pi-plan-mode@9.0.0' : 'npm:user-added-package@1.0.0',
      autoload: false,
      extensions: ['!**/*'],
    }
    await writeFile(runner, `
const fs = require('node:fs');
const path = require('node:path');
const [log, ...args] = process.argv.slice(2);
fs.appendFileSync(log, JSON.stringify(args) + '\\n');
if (args[0] === 'root') { process.stdout.write(path.join(path.dirname(log), 'legacy-node-modules')); }
else if (args[0] === 'install') {
  const spec = args[1];
  const versionAt = spec.lastIndexOf('@');
  const name = spec.slice(0, versionAt);
  const prefix = args[args.indexOf('--prefix') + 1];
  const directory = path.join(prefix, 'node_modules', name);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name, version: spec.slice(versionAt + 1) }));
  if (name === '@narumitw/pi-plan-mode' && ${JSON.stringify(concurrentEdit)} !== 'none') {
    (async () => {
      const { SettingsManager } = await import(${JSON.stringify(import.meta.resolve('@earendil-works/pi-coding-agent'))});
      const settings = SettingsManager.create(${JSON.stringify(cwd)}, ${JSON.stringify(work.agentDir)}, { projectTrusted: true });
      settings.setPackages([...(settings.getGlobalSettings().packages ?? []), ${JSON.stringify(externalPackage)}]);
      if (${JSON.stringify(concurrentEdit)} === 'same-package') {
        fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name, version: '9.0.0' }));
      }
      await settings.flush();
      if (settings.drainErrors().length) throw new Error('Fixture CLI settings update failed');
    })().catch(() => { process.exitCode = 1; });
  }
} else { process.exitCode = 1; }
`)
    await writeFile(join(work.agentDir, 'settings.json'), JSON.stringify({
      npmCommand: [process.execPath, runner, logPath],
      defaultModel: 'keep-my-model',
    }))
    const settings = SettingsManager.create(cwd, work.agentDir, { projectTrusted: true })
    const packageManager = new DefaultPackageManager({ cwd, agentDir: work.agentDir, settingsManager: settings })
    const result = await bootstrapRecommendedPackages({
      agentDir: work.agentDir,
      packageManager,
      reloadSettings: async () => { await settings.reload(); expect(settings.drainErrors()).toEqual([]) },
      flushSettings: async () => {
        await settings.flush()
        expect(settings.drainErrors()).toEqual([])
      },
    })
    expect(result.packages.map((item) => item.status)).toEqual(concurrentEdit === 'same-package'
      ? ['existing', 'installed', 'installed'] : ['installed', 'installed', 'installed'])
    const persisted = JSON.parse(await readFile(join(work.agentDir, 'settings.json'), 'utf8'))
    expect(persisted.packages).toEqual([
      ...(concurrentEdit === 'none' ? [] : [externalPackage]),
      ...PI_RECOMMENDED_PACKAGES.filter((item) => concurrentEdit !== 'same-package' || item.packageName !== '@narumitw/pi-plan-mode').map((item) => item.source),
    ])
    expect(persisted.defaultModel).toBe('keep-my-model')
    if (concurrentEdit === 'same-package') {
      const installed = JSON.parse(await readFile(join(work.agentDir, 'npm', 'node_modules', '@narumitw/pi-plan-mode', 'package.json'), 'utf8'))
      expect(installed.version).toBe('9.0.0')
      expect(result.packages[0]?.source).toBe(externalPackage.source)
    }
    const commands = (await readFile(logPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line) as string[])
    const installs = commands.filter((args) => args[0] === 'install')
    expect(installs).toHaveLength(3)
    for (const args of installs) {
      expect(args).toContain('--prefix')
      expect(args).toContain(join(work.agentDir, 'npm'))
      expect(args).not.toContain('-g')
    }
    for (const item of PI_RECOMMENDED_PACKAGES) {
      expect(packageManager.getInstalledPath(item.source, 'user')).toBe(join(work.agentDir, 'npm', 'node_modules', item.packageName))
    }
  })

  it('installs pinned defaults through the official manager only once, using global scope', async () => {
    const work = await fixture()
    const result = await bootstrapRecommendedPackages(work)
    expect(result.changed).toBe(true)
    expect(result.packages.map((item) => item.status)).toEqual(['installed', 'installed', 'installed'])
    expect(work.packageManager.install.mock.calls).toEqual(
      PI_RECOMMENDED_PACKAGES.map((item) => [item.source, { local: false }]),
    )
    expect(work.flushSettings).toHaveBeenCalledTimes(3)
    await bootstrapRecommendedPackages(work)
    expect(work.packageManager.install).toHaveBeenCalledTimes(3)
    // A later removal from Pi's own settings is also authoritative on restart.
    work.configured.splice(0)
    const restarted = await bootstrapRecommendedPackages(work)
    expect(restarted.packages.every((item) => item.status === 'removed')).toBe(true)
    expect(work.packageManager.install).toHaveBeenCalledTimes(3)
  })

  it('preserves existing user versions and disabled package filters while ignoring project-only installs', async () => {
    const work = await fixture()
    work.configured.push(
      { source: 'npm:@narumitw/pi-plan-mode@0.50.1', scope: 'user', filtered: true },
      { source: 'npm:pi-subagents@custom-version', scope: 'user', filtered: true },
      { source: 'npm:@narumitw/pi-goal@0.52.2', scope: 'project' },
    )
    const previous = structuredClone(work.configured)
    const result = await bootstrapRecommendedPackages(work)
    expect(work.configured.slice(0, 3)).toEqual(previous)
    expect(result.packages.map((item) => item.status)).toEqual(['existing', 'existing', 'installed'])
    expect(work.packageManager.install.mock.calls).toEqual([
      [PI_RECOMMENDED_PACKAGES[2].source, { local: false }],
    ])
    work.configured.splice(0)
    await bootstrapRecommendedPackages(work)
    expect(work.packageManager.install).toHaveBeenCalledTimes(1)
  })

  it('does not duplicate or enable an existing unconfigured installation', async () => {
    const work = await fixture()
    await writeFile(join(work.agentDir, 'package.json'), JSON.stringify({ name: 'pi-subagents', version: '0.1.0' }))
    work.packageManager.getInstalledPath.mockImplementation((...args: unknown[]) =>
      args[0] === 'npm:pi-subagents' ? work.agentDir : undefined)
    const result = await bootstrapRecommendedPackages(work)
    expect(result.packages[1]?.status).toBe('existing')
    expect(work.packageManager.install.mock.calls.some(([source]) => source.includes('pi-subagents'))).toBe(false)
    expect(work.configured.some((item) => item.source.includes('pi-subagents'))).toBe(false)
  })

  it('records failures and interrupted attempts before side effects and only permits explicit retry', async () => {
    const work = await fixture()
    work.packageManager.install.mockImplementationOnce(async () => { throw new Error('Registry unavailable') })
    const repository = new DefaultPackageRepository(work.agentDir)
    await repository.claim({ ...PI_RECOMMENDED_PACKAGES[1], status: 'installing' })
    const result = await bootstrapRecommendedPackages(work)
    expect(result.packages[0]).toMatchObject({ status: 'failed', message: 'Registry unavailable' })
    expect(result.packages[1]).toMatchObject({ status: 'failed', message: expect.stringContaining('interrupted') })
    expect(work.onProgress).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', message: 'Registry unavailable' }))
    await bootstrapRecommendedPackages(work)
    expect(work.packageManager.install).toHaveBeenCalledTimes(2)

    await work.packageManager.install(PI_RECOMMENDED_PACKAGES[0].source, { local: false })
    work.packageManager.addSourceToSettings(PI_RECOMMENDED_PACKAGES[0].source, { local: false })
    await recordRecommendedPackageMutation(work.agentDir, PI_RECOMMENDED_PACKAGES[0].source, 'install')
    expect((await recommendedPackageSnapshot(work.agentDir, work.packageManager))[0]?.status).toBe('installed')
    await recordRecommendedPackageMutation(work.agentDir, PI_RECOMMENDED_PACKAGES[0].source, 'remove')
    expect((await recommendedPackageSnapshot(work.agentDir, work.packageManager))[0]?.status).toBe('removed')
    await bootstrapRecommendedPackages(work)
    expect(work.packageManager.install).toHaveBeenCalledTimes(3)
  })

  it('keeps settings persistence failures visible and does not automatically retry them', async () => {
    const work = await fixture()
    work.flushSettings.mockRejectedValueOnce(new Error('Settings are read-only'))
    const result = await bootstrapRecommendedPackages(work)
    expect(result.packages[0]).toMatchObject({ status: 'failed', message: 'Settings are read-only' })
    await bootstrapRecommendedPackages(work)
    expect(work.packageManager.install).toHaveBeenCalledTimes(3)
  })

  it.each(['failed', 'installing', 'removed'] as const)('adopts verified external user installs after %s without reinstalling or downgrading', async (status) => {
    const work = await fixture()
    const recommendation = PI_RECOMMENDED_PACKAGES[0]
    await new DefaultPackageRepository(work.agentDir).claim({ ...recommendation, status })
    await writeFile(join(work.agentDir, 'package.json'), JSON.stringify({ name: recommendation.packageName, version: '9.0.0' }))
    work.configured.push({ source: `npm:${recommendation.packageName}@9.0.0`, scope: 'user', filtered: true, installedPath: work.agentDir })
    const result = await bootstrapRecommendedPackages(work)
    expect(result.packages[0]).toMatchObject({ source: `npm:${recommendation.packageName}@9.0.0`, status: 'existing' })
    expect(work.packageManager.install.mock.calls.some(([source]) => source.includes(recommendation.packageName))).toBe(false)
    work.configured.splice(0)
    expect((await bootstrapRecommendedPackages(work)).packages[0]?.status).toBe('removed')
  })

  it('recognizes a verified external completion of the same pin after interrupted startup', async () => {
    const work = await fixture()
    const recommendation = PI_RECOMMENDED_PACKAGES[0]
    await new DefaultPackageRepository(work.agentDir).claim({ ...recommendation, status: 'installing' })
    await writeFile(join(work.agentDir, 'package.json'), JSON.stringify({ name: recommendation.packageName, version: recommendation.source.split('@').pop() }))
    work.configured.push({ source: recommendation.source, scope: 'user', installedPath: work.agentDir })
    expect((await recommendedPackageSnapshot(work.agentDir, work.packageManager))[0]?.status).toBe('installing')
    expect((await bootstrapRecommendedPackages(work)).packages[0]?.status).toBe('existing')
    expect(work.packageManager.install.mock.calls.some(([source]) => source === recommendation.source)).toBe(false)
  })

  it('offers the configured user source for explicit retry when it is still missing', async () => {
    const work = await fixture()
    const recommendation = PI_RECOMMENDED_PACKAGES[0]
    await new DefaultPackageRepository(work.agentDir).claim({ ...recommendation, status: 'failed', message: 'Previous attempt failed' })
    work.configured.push({ source: `npm:${recommendation.packageName}@9.0.0`, scope: 'user', filtered: true })
    const result = await bootstrapRecommendedPackages(work)
    expect(result.packages[0]).toMatchObject({ source: `npm:${recommendation.packageName}@9.0.0`, status: 'failed' })
    expect(work.packageManager.install.mock.calls.some(([source]) => source.includes(recommendation.packageName))).toBe(false)
  })

  it('makes a concurrent first-attempt claim exclusive', async () => {
    const work = await fixture()
    const first = new DefaultPackageRepository(work.agentDir)
    const second = new DefaultPackageRepository(work.agentDir)
    const value = { ...PI_RECOMMENDED_PACKAGES[0], status: 'installing' as const }
    const claims = await Promise.all([first.claim(value), second.claim(value)])
    expect(claims.sort()).toEqual([false, true])
    expect(await second.read(value.packageName)).toEqual(value)
  })

  it('does not treat an unreadable persisted decision as permission to install', async () => {
    const work = await fixture()
    const repository = new DefaultPackageRepository(work.agentDir)
    const recommendation = PI_RECOMMENDED_PACKAGES[0]
    await repository.claim({ ...recommendation, status: 'installed' })
    // Simulate a malformed record through the owned fixture repository path.
    const { createHash } = await import('node:crypto')
    await writeFile(join(work.agentDir, 'pipilot', 'default-packages-v1', `${createHash('sha256').update(recommendation.packageName).digest('hex')}.json`), '{')
    const result = await bootstrapRecommendedPackages(work)
    expect(result.packages[0]?.status).toBe('failed')
    expect(work.packageManager.install.mock.calls.some(([source]) => source === recommendation.source)).toBe(false)
  })
})
