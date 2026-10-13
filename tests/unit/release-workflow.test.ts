import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const builderRequire = createRequire(require.resolve('electron-builder'))
const libraryRequire = createRequire(builderRequire.resolve('app-builder-lib'))
const yaml = libraryRequire('js-yaml') as { load: (source: string) => Workflow }

interface Step {
  name?: string
  uses?: string
  run?: string
  if?: string
  'continue-on-error'?: boolean
  with?: Record<string, unknown>
}

interface Job {
  needs?: string | string[]
  if?: string
  permissions?: Record<string, string>
  'continue-on-error'?: boolean
  steps?: Step[]
  strategy?: {
    'fail-fast'?: boolean
    matrix: { include?: Array<Record<string, unknown>>; shard?: number[] }
  }
}

interface Workflow { jobs: Record<string, Job> }

async function workflow(name: string) {
  return yaml.load(await readFile(`.github/workflows/${name}.yml`, 'utf8'))
}

function step(job: Job, name: string) {
  const match = job.steps?.find((candidate) => candidate.name === name)
  expect(match, `Missing required workflow step: ${name}`).toBeDefined()
  return match!
}

describe('release workflow gates', () => {
  it('overlaps candidate builds with verification without allowing early publication', async () => {
    const { jobs } = await workflow('release')
    expect(jobs.package.needs).toBe('preflight')
    expect(jobs['package-macos'].needs).toBe('preflight')
    expect(jobs['package-macos-intel-smoke'].needs).toEqual(['preflight', 'package-macos'])

    const gates = ['preflight', 'verify', 'package', 'package-macos', 'package-macos-intel-smoke']
    const assembly = jobs.assemble
    expect(assembly.needs).toEqual(gates)
    const expression = assembly.if!
    expect(expression).not.toMatch(/\|\||always\(|failure\(/)
    for (const gate of gates) {
      const accessor = gate.includes('-') ? `needs['${gate}']` : `needs.${gate}`
      expect(expression).toContain(`${accessor}.result == 'success'`)
      expect(jobs[gate]['continue-on-error']).not.toBe(true)
      expect(jobs[gate].steps?.some((item) => item['continue-on-error'])).not.toBe(true)
    }

    for (const [name, job] of Object.entries(jobs)) {
      if (name !== 'assemble') expect(job.permissions?.contents).not.toBe('write')
    }
    const names = assembly.steps!.map((item) => item.name)
    expect(names.indexOf('Validate manifests')).toBeLessThan(names.indexOf('Stage complete draft Release'))
    expect(names.indexOf('Verify staged Release assets')).toBeLessThan(names.indexOf('Publish staged Release'))
  })

  it('keeps every platform inventory and native smoke/update contract', async () => {
    const { jobs } = await workflow('release')
    const inventory = jobs.package.strategy!.matrix.include!
    expect(inventory.map((item) => item.inventory).sort()).toEqual(['linux', 'linux-arm64', 'windows'])
    expect(inventory.map((item) => item.command)).toEqual([
      'pnpm package:win:update', 'pnpm package:linux:update', 'pnpm package:linux:arm64:update',
    ])
    expect(jobs.package.strategy!['fail-fast']).toBe(false)
    expect(step(jobs.package, 'Smoke-test package').run).toBe('${{ matrix.smoke }}')
    expect(step(jobs.package, 'Verify unsigned Windows installation and native A-to-B update').run)
      .toContain('windows-update-canary.spec.ts')
    expect(step(jobs.package, 'Verify Linux AppImage native update and DEB installation').run)
      .toContain('linux-package-canary.spec.ts')
    expect(step(jobs['package-macos'], 'Build package').run).toBe('pnpm package:mac')
    expect(step(jobs['package-macos'], 'Create manifest and checksums').run)
      .toBe('node build/release-manifest.cjs macos release')
    expect(step(jobs['package-macos'], 'Smoke-test macOS ARM64 package').run).toContain('test:packaged')
    expect(step(jobs['package-macos-intel-smoke'], 'Download macOS release candidate').with?.name)
      .toBe('pipilot-macos-${{ needs.preflight.outputs.version }}')
    expect(step(jobs['package-macos-intel-smoke'], 'Smoke-test macOS Intel package').run)
      .toContain('test:packaged')
  })

  it('shards Electron contracts across machines while retaining isolated desktop workers', async () => {
    const { jobs } = await workflow('verify')
    expect(jobs.desktop.strategy?.matrix.shard).toEqual([1, 2])
    expect(jobs.desktop.strategy?.['fail-fast']).toBe(false)
    expect(step(jobs.desktop, 'Electron E2E and integration contracts').run)
      .toBe('pnpm test:electron --shard=${{ matrix.shard }}/2')
    expect(step(jobs.desktop, 'Upload failure artifacts').with?.name).toContain('${{ matrix.shard }}')
    const config = await readFile('playwright.electron.config.ts', 'utf8')
    expect(config).toMatch(/workers:\s*1/)
    expect(config).toMatch(/fullyParallel:\s*false/)
  })

  it('caches only downloaded tools and avoids recompressing release archives', async () => {
    const release = await workflow('release')
    const verify = await workflow('verify')
    for (const job of [...Object.values(release.jobs), ...Object.values(verify.jobs)]) {
      for (const item of job.steps ?? []) {
        if (!item.uses?.startsWith('actions/cache@')) continue
        expect(item.uses).toMatch(/^actions\/cache@[a-f0-9]{40}$/)
        expect(item.with?.path).toMatch(/^\.cache\/(electron|electron-builder)$/)
        expect(item.with?.key).toContain('${{ runner.os }}-${{ runner.arch }}')
        expect(item.with?.key).toContain("${{ hashFiles('pnpm-lock.yaml') }}")
        expect(item.with?.['restore-keys']).toContain('${{ runner.os }}-${{ runner.arch }}')
      }
    }
    expect(step(release.jobs.package, 'Upload release candidate').with?.['compression-level']).toBe(0)
    expect(step(release.jobs['package-macos'], 'Upload release candidate').with?.['compression-level']).toBe(0)
    expect(step(verify.jobs.desktop, 'Upload failure artifacts').with?.['compression-level']).toBeUndefined()
  })

  it('lets the dual-architecture macOS build save its complete cache after restoring a verification cache', async () => {
    const release = await workflow('release')
    const verify = await workflow('verify')
    const macCache = step(release.jobs['package-macos'], 'Cache Electron downloads').with!
    const singleArchitectureCaches = [
      release.jobs.package, release.jobs['package-macos-intel-smoke'], verify.jobs.unit, verify.jobs.desktop,
    ].map((job) => step(job, 'Cache Electron downloads').with!)

    expect(macCache.key).toBe("electron-downloads-${{ runner.os }}-${{ runner.arch }}-dual-arch-${{ hashFiles('pnpm-lock.yaml') }}")
    expect((macCache['restore-keys'] as string).trim().split('\n')).toEqual([
      'electron-downloads-${{ runner.os }}-${{ runner.arch }}-dual-arch-',
      'electron-downloads-${{ runner.os }}-${{ runner.arch }}-',
    ])
    for (const cache of singleArchitectureCaches) {
      expect(cache.key).not.toBe(macCache.key)
      expect(cache.key).toBe("electron-downloads-${{ runner.os }}-${{ runner.arch }}-${{ hashFiles('pnpm-lock.yaml') }}")
      expect(macCache['restore-keys']).toContain(cache['restore-keys'])
    }
  })
})
