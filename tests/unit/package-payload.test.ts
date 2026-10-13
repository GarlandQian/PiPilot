import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const builderRequire = createRequire(require.resolve('electron-builder'))
const libraryRequire = createRequire(builderRequire.resolve('app-builder-lib'))
const { getMainFileMatchers, getNodeModuleFileMatcher } = builderRequire('app-builder-lib/out/fileMatcher')
const { doMergeConfigs } = builderRequire('app-builder-lib/out/util/config/config')
const { expandMacro } = builderRequire('app-builder-lib/out/util/macroExpander')
const { buildElectronArtifactConfig } = builderRequire('app-builder-lib/out/util/electronGet')
// Production normalizes root files into FileSet objects before computing its
// matchers. Skipping this step hides extra matchers introduced by platform files.
const configuration = doMergeConfigs([libraryRequire('js-yaml').load(
  readFileSync(join(process.cwd(), 'electron-builder.yml'), 'utf8'),
)])
const nativePlatforms = { mac: 'darwin', win: 'win32', linux: 'linux' } as const

function macroExpander(platform: 'mac' | 'win' | 'linux', architecture: 'x64' | 'arm64') {
  // Simulate the native OS of each release runner, then use builder's real
  // expansion for the selected architecture and directory glob macro.
  return (pattern: string): string => expandMacro(
    pattern.replace(/\$\{platform\}/gu, nativePlatforms[platform]),
    architecture,
    {},
    { '/*': '{,/**/*}' },
  )
}

function payloadFilter(platform: 'mac' | 'win' | 'linux', architecture: 'x64' | 'arm64') {
  const root = join(process.cwd(), 'fixture-app')
  const matcher = getNodeModuleFileMatcher(
    root,
    join(root, 'packaged'),
    macroExpander(platform, architecture),
    configuration[platform],
    { config: configuration, debugLogger: { isEnabled: false } },
  )
  const filter = matcher.createFilter()
  return (relativePath: string, directory = false): boolean => filter(
    join(root, relativePath),
    { isDirectory: () => directory },
  )
}

describe('packaged application allowlist', () => {
  it('uses native operating system names for the platform macro', () => {
    expect(expandMacro('${platform}', 'arm64', {})).toBe(process.platform)
  })

  it.each([
    ['mac', 'x64'], ['mac', 'arm64'],
    ['win', 'x64'], ['win', 'arm64'],
    ['linux', 'x64'], ['linux', 'arm64'],
  ] as const)('does not broaden the %s %s payload when pruning native helpers', (platform, architecture) => {
    const root = join(process.cwd(), 'fixture-app')
    const matchers = getMainFileMatchers(
      root,
      join(root, 'release', 'app'),
      macroExpander(platform, architecture),
      configuration[platform],
      {
        info: {
          config: configuration,
          projectDir: root,
          buildResourcesDir: 'build',
          isPrepackedAppAsar: false,
          debugLogger: { isEnabled: false },
        },
      },
      join(root, 'release'),
      false,
    )
    expect(matchers).toHaveLength(1)
    const filter = matchers[0].createFilter()
    const included = (relativePath: string): boolean => filter(
      join(root, relativePath),
      { isDirectory: () => false },
    )
    for (const file of [
      'package.json', 'out/main/index.js', 'out/preload/index.cjs',
      'out/renderer/index.html', 'out/renderer/assets/chat.js',
    ]) {
      expect(included(file), file).toBe(true)
    }
    for (const file of [
      'src/main/index.ts', 'tests/electron/app.spec.ts', 'test-results/screenshot.png',
      '.agents/skills/example/SKILL.md', '.trellis/tasks/example/prd.md',
      '.cache/electron/electron.zip', '.pnpm-store/package.js', 'README.md',
      'release/PiPilot.zip', 'out/main/index.js.map', 'node_modules/electron/index.js',
    ]) {
      expect(included(file), file).toBe(false)
    }
  })
})

describe('packaged terminal native payload', () => {
  it.each([
    ['mac', 'darwin', 'x64'],
    ['mac', 'darwin', 'arm64'],
    ['win', 'win32', 'x64'],
    ['win', 'win32', 'arm64'],
    ['linux', 'linux', 'x64'],
    ['linux', 'linux', 'arm64'],
  ] as const)('keeps only %s %s-%s prebuilds without affecting rebuilt helpers', (platform, nativePlatform, architecture) => {
    const included = payloadFilter(platform, architecture)
    const target = `node_modules/node-pty/prebuilds/${nativePlatform}-${architecture}`

    // Check directories as well as files: the collector must be able to walk to
    // the current target and must skip whole directories for other targets.
    expect(included('node_modules/node-pty/prebuilds', true)).toBe(true)
    expect(included(target, true)).toBe(true)
    for (const name of ['pty.node', 'spawn-helper', 'conpty.node', 'conpty/conpty.dll', 'conpty/OpenConsole.exe']) {
      expect(included(`${target}/${name}`)).toBe(true)
    }

    for (const otherPlatform of ['darwin', 'win32', 'linux']) {
      for (const otherArchitecture of ['x64', 'arm64', 'ia32']) {
        if (otherPlatform === nativePlatform && otherArchitecture === architecture) continue
        const other = `node_modules/node-pty/prebuilds/${otherPlatform}-${otherArchitecture}`
        expect(included(other, true)).toBe(false)
        expect(included(`${other}/pty.node`)).toBe(false)
        expect(included(`${other}/conpty/OpenConsole.exe`)).toBe(false)
      }
    }

    for (const runtimeFile of [
      'node_modules/node-pty/build/Release/pty.node',
      'node_modules/node-pty/build/Release/spawn-helper',
      'node_modules/node-pty/build/Release/conpty/conpty.dll',
      'node_modules/node-pty/lib/index.js',
      'node_modules/@earendil-works/pi-tui/native/prebuilds/win32-x64/tui.node',
    ]) {
      expect(included(runtimeFile)).toBe(true)
    }
  })
})

it('uses the Actions download cache for packaging as well as installation', async () => {
  const artifact = await buildElectronArtifactConfig({
    electronDownload: configuration.electronDownload,
    platformName: 'darwin',
    arch: 'arm64',
    version: require('electron/package.json').version,
    artifactName: 'electron',
  })
  expect(artifact.cacheRoot).toBe('.cache/electron')
})
