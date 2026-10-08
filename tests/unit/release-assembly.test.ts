import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { PIPILOT_VERSION } from '../../src/shared/build-info'

const execFileAsync = promisify(execFile)
const temporaryDirectories: string[] = []
const { renderReleaseNotes } = createRequire(import.meta.url)('../../build/release-notes.cjs') as {
  renderReleaseNotes: (options: { version: string; changelog: string; directory?: string; preview?: boolean }) => string
}

type Platform = 'macos' | 'windows' | 'linux' | 'linux-arm64'

const platformPolicy: Record<Platform, {
  architectures: string[]
  trust: string
  updateCapability: string
}> = {
  macos: {
    architectures: ['arm64', 'x64'],
    trust: 'adhoc-no-developer-id',
    updateCapability: 'manual-release',
  },
  windows: {
    architectures: ['x64'],
    trust: 'unsigned',
    updateCapability: 'native-install',
  },
  'linux-arm64': {
    architectures: ['arm64'], trust: 'unsigned', updateCapability: 'native-install',
  },
  linux: {
    architectures: ['x64'],
    trust: 'unsigned',
    updateCapability: 'native-install',
  },
}

async function createReleaseFixture(options: {
  invalidWindowsSha512?: boolean
  omitLinuxDebMetadata?: boolean
  omitMacosPlatform?: boolean
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'pipilot-release-assembly-'))
  temporaryDirectories.push(root)
  const version = PIPILOT_VERSION
  const assets: Record<Platform, string[]> = {
    macos: [
      `PiPilot-${version}-macos-arm64.dmg`,
      `PiPilot-${version}-macos-arm64.zip`,
      `PiPilot-${version}-macos-x64.dmg`,
      `PiPilot-${version}-macos-x64.zip`,
    ],
    windows: [
      `PiPilot-${version}-windows-x64-setup.exe`,
      `PiPilot-${version}-windows-x64-setup.exe.blockmap`,
      `PiPilot-${version}-windows-x64-portable.exe`,
      `PiPilot-${version}-windows-x64-portable.zip`,
      'latest.yml',
    ],
    'linux-arm64': [
      `PiPilot-${version}-linux-arm64.AppImage`,
      `PiPilot-${version}-linux-arm64.deb`,
      `PiPilot-${version}-linux-aarch64.rpm`,
      'latest-linux-arm64.yml',
    ],
    linux: [
      `PiPilot-${version}-linux-x86_64.AppImage`,
      `PiPilot-${version}-linux-amd64.deb`,
      `PiPilot-${version}-linux-x86_64.rpm`,
      'latest-linux.yml',
    ],
  }

  if (options.omitMacosPlatform) {
    assets.macos = assets.macos.map((name) => name.replace('-macos-', '-'))
  }

  for (const name of Object.values(assets).flat()) {
    if (!name.endsWith('.yml')) await writeFile(join(root, name), `fixture:${name}`)
  }

  const writeMetadata = async (
    metadataFile: string,
    packageFiles: readonly string[],
    primaryPackage: string,
    invalidSha512 = false,
  ) => {
    const entries = await Promise.all(packageFiles.map(async (packageFile) => {
      const packagePath = join(root, packageFile)
      const packageStat = await stat(packagePath)
      const checksum = createHash('sha512')
        .update(await readFile(packagePath))
        .digest('base64')
      return { checksum, packageFile, packageStat }
    }))
    const primary = entries.find((entry) => entry.packageFile === primaryPackage)
    if (!primary) throw new Error(`Missing primary package fixture: ${primaryPackage}`)
    const metadataChecksum = invalidSha512
      ? createHash('sha512').update('wrong').digest('base64')
      : primary.checksum
    await writeFile(
      join(root, metadataFile),
      `version: ${version}\nfiles:\n${entries.map((entry) =>
        `  - url: ${entry.packageFile}\n    sha512: ${entry.packageFile === primaryPackage ? metadataChecksum : entry.checksum}\n    size: ${entry.packageStat.size}\n`).join('')}path: ${primaryPackage}\nsha512: ${metadataChecksum}\nreleaseDate: '2026-08-13T00:00:00.000Z'\n`,
    )
  }

  await writeMetadata(
    'latest.yml',
    [`PiPilot-${version}-windows-x64-setup.exe`],
    `PiPilot-${version}-windows-x64-setup.exe`,
    options.invalidWindowsSha512,
  )
  await writeMetadata(
    'latest-linux.yml',
    options.omitLinuxDebMetadata
      ? [`PiPilot-${version}-linux-x86_64.AppImage`]
      : [
          `PiPilot-${version}-linux-x86_64.AppImage`,
          `PiPilot-${version}-linux-amd64.deb`,
          `PiPilot-${version}-linux-x86_64.rpm`,
        ],
    `PiPilot-${version}-linux-x86_64.AppImage`,
  )

  await writeMetadata('latest-linux-arm64.yml', [
    `PiPilot-${version}-linux-arm64.AppImage`, `PiPilot-${version}-linux-arm64.deb`, `PiPilot-${version}-linux-aarch64.rpm`,
  ], `PiPilot-${version}-linux-arm64.AppImage`)

  for (const platform of Object.keys(assets) as Platform[]) {
    const files = []
    for (const name of assets[platform].slice().sort()) {
      const content = await readFile(join(root, name))
      files.push({
        name,
        size: content.length,
        sha256: createHash('sha256').update(content).digest('hex'),
      })
    }
    await writeFile(
      join(root, `${platform}-manifest.json`),
      `${JSON.stringify({ version, platform, ...platformPolicy[platform], files }, null, 2)}\n`,
    )
    await writeFile(
      join(root, `${platform}-SHA256SUMS.txt`),
      `${files.map((file) => `${file.sha256}  ${file.name}`).join('\n')}\n`,
    )
  }

  return { root, version }
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true }),
  ))
})

describe('release assembly validation', () => {
  it('renders exact package links and only the selected version changes', async () => {
    const fixture = await createReleaseFixture()
    const notes = renderReleaseNotes({
      version: fixture.version,
      directory: fixture.root,
      changelog: `## Unreleased\nFuture work\n## ${fixture.version}\nCurrent changes\n## 0.0.1\nOlder changes\n`,
    })

    const downloads = [...notes.matchAll(/https:\/\/github\.com\/GarlandQian\/PiPilot\/releases\/download\/v[^)]+/g)]
      .map((match) => decodeURIComponent(match[0].split('/').pop()!))
    const packages = downloads.filter((name) => !name.endsWith('SHA256SUMS.txt'))
    expect(packages).toHaveLength(13)
    expect(new Set(packages).size).toBe(13)
    for (const name of downloads) await expect(stat(join(fixture.root, name))).resolves.toBeDefined()
    expect(packages).toContain(`PiPilot-${fixture.version}-linux-amd64.deb`)
    expect(packages).toContain(`PiPilot-${fixture.version}-linux-aarch64.rpm`)
    expect(notes).toContain('Current changes')
    expect(notes).not.toContain('Future work')
    expect(notes).not.toContain('Older changes')
    expect(notes).toContain(`/compare/v0.0.1...v${fixture.version}`)
  })

  it('requires release-specific changes and complete manifests for publication', async () => {
    const fixture = await createReleaseFixture()
    expect(() => renderReleaseNotes({
      version: fixture.version, directory: fixture.root, changelog: '## Unreleased\nFuture work',
    })).toThrow('Missing non-empty CHANGELOG section')
    await rm(join(fixture.root, 'linux-arm64-manifest.json'))
    expect(() => renderReleaseNotes({
      version: fixture.version, directory: fixture.root, changelog: `## ${fixture.version}\nCurrent changes`,
    })).toThrow()
  })

  it('allows an unpublished preview without fabricated download links', () => {
    const changelog = '## Unreleased\nPending changes'
    const notes = renderReleaseNotes({ version: '9.9.9', changelog, preview: true })
    expect(notes).toContain('Pending changes')
    expect(notes).toContain('Preview only')
    expect(notes).not.toContain('/releases/download/')
    expect(notes).not.toContain('/compare/')
    expect(() => renderReleaseNotes({ version: '9.9.9', changelog })).toThrow('require an asset directory')
  })

  it('cleans prior Actions runs before mutating only the initial Release', async () => {
    const workflow = await readFile(
      join(process.cwd(), '.github', 'workflows', 'release.yml'),
      'utf8',
    )
    const validationIndex = workflow.indexOf('- name: Validate manifests')
    const cleanupIndex = workflow.indexOf('- name: Remove all previous Actions runs')
    const stageIndex = workflow.indexOf('- name: Stage complete draft Release')

    expect(validationIndex).toBeGreaterThanOrEqual(0)
    expect(cleanupIndex).toBeGreaterThan(validationIndex)
    expect(stageIndex).toBeGreaterThan(cleanupIndex)

    const cleanupStep = workflow.slice(cleanupIndex, stageIndex)
    expect(cleanupStep).toContain("needs.preflight.outputs.version == '0.0.1'")
    expect(cleanupStep).toContain('actions/runs?per_page=100')
    expect(cleanupStep).toContain('run_id" != "$GITHUB_RUN_ID')
  })

  it('removes generated macOS updater metadata from the manual-download candidate', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pipilot-macos-manifest-'))
    temporaryDirectories.push(root)
    const version = PIPILOT_VERSION
    const packages = [
      `PiPilot-${version}-macos-arm64.dmg`,
      `PiPilot-${version}-macos-arm64.zip`,
      `PiPilot-${version}-macos-x64.dmg`,
      `PiPilot-${version}-macos-x64.zip`,
    ]
    await Promise.all([
      ...packages.map((name) => writeFile(join(root, name), `fixture:${name}`)),
      writeFile(join(root, 'latest-mac.yml'), `version: ${version}\n`),
    ])

    await execFileAsync(
      process.execPath,
      ['build/release-manifest.cjs', 'macos', root],
      { cwd: process.cwd() },
    )

    await expect(readFile(join(root, 'latest-mac.yml'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })
    const manifest = JSON.parse(
      await readFile(join(root, 'macos-manifest.json'), 'utf8'),
    ) as { files: Array<{ name: string }> }
    expect(manifest.files.map((file) => file.name)).toEqual(packages.slice().sort())
  })

  it('accepts one complete cross-platform release inventory', async () => {
    const fixture = await createReleaseFixture()
    const result = await execFileAsync(
      process.execPath,
      ['build/validate-release-assembly.cjs', fixture.root, fixture.version],
      { cwd: process.cwd() },
    )

    expect(JSON.parse(result.stdout)).toEqual({ version: fixture.version, assets: 25 })
  })

  it('rejects packages without a system identifier even when their checksums match', async () => {
    const fixture = await createReleaseFixture({ omitMacosPlatform: true })
    await expect(execFileAsync(
      process.execPath,
      ['build/validate-release-assembly.cjs', fixture.root, fixture.version],
      { cwd: process.cwd() },
    )).rejects.toMatchObject({
      stderr: expect.stringContaining('package must identify its version and platform'),
    })
  })

  it('rejects updater metadata whose SHA-512 does not match the installer', async () => {
    const fixture = await createReleaseFixture({ invalidWindowsSha512: true })

    await expect(execFileAsync(
      process.execPath,
      ['build/validate-release-assembly.cjs', fixture.root, fixture.version],
      { cwd: process.cwd() },
    )).rejects.toMatchObject({
      stderr: expect.stringContaining('latest.yml SHA-512 does not match'),
    })
  })

  it('rejects Linux updater metadata that omits one packaged installer', async () => {
    const fixture = await createReleaseFixture({ omitLinuxDebMetadata: true })

    await expect(execFileAsync(
      process.execPath,
      ['build/validate-release-assembly.cjs', fixture.root, fixture.version],
      { cwd: process.cwd() },
    )).rejects.toMatchObject({
      stderr: expect.stringContaining(
        'latest-linux.yml package inventory does not match its platform manifest',
      ),
    })
  })
})
