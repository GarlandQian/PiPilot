import { realpathSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createApplicationStoragePaths,
  resolveTestUserDataOverride,
} from '../../src/main/application-storage'
import {
  createScopedDiagnosticCode,
  MainDiagnostics,
} from '../../src/main/diagnostics/main-diagnostics'
import { PIPILOT_VERSION } from '../../src/shared/build-info'

const { repairPackagedTerminalHelpers } = createRequire(import.meta.url)('../../build/apply-electron-fuses.cjs') as {
  repairPackagedTerminalHelpers(context: {
    appOutDir: string
    electronPlatformName: string
    arch: number
    packager: { appInfo: { productFilename: string } }
  }): void
}

describe('build metadata', () => {
  it('stays aligned with the packaged application version', async () => {
    const manifest = JSON.parse(
      await readFile(join(process.cwd(), 'package.json'), 'utf8'),
    ) as {
      version: string
    }

    expect(PIPILOT_VERSION).toBe(manifest.version)
  })

  it('keeps only the Node-mode helper fuse enabled among Electron execution controls', async () => {
    const fuseHook = await readFile(
      join(process.cwd(), 'build', 'apply-electron-fuses.cjs'),
      'utf8',
    )

    expect(fuseHook).toContain('[FuseV1Options.RunAsNode]: true')
    expect(fuseHook).toContain('[FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false')
    expect(fuseHook).toContain('[FuseV1Options.EnableNodeCliInspectArguments]: false')
    expect(fuseHook).toContain('exports.default = async function applyElectronFuses(context) {\n  repairPackagedTerminalHelpers(context)')
  })
})

describe.skipIf(process.platform === 'win32')('packaged macOS terminal helper permissions', () => {
  it.each([['x64', 1], ['arm64', 3]] as const)('repairs only the %s helper shipped for the target architecture', async (architecture, arch) => {
    const root = await mkdtemp(join(tmpdir(), 'pipilot-packaged-terminal-'))
    const packageRoot = join(root, 'PiPilot.app', 'Contents', 'Resources', 'app.asar.unpacked', 'node_modules', 'node-pty')
    const target = join(packageRoot, 'prebuilds', `darwin-${architecture}`, 'spawn-helper')
    const other = join(packageRoot, 'prebuilds', `darwin-${architecture === 'x64' ? 'arm64' : 'x64'}`, 'spawn-helper')
    const nativeModule = join(packageRoot, 'prebuilds', `darwin-${architecture}`, 'pty.node')
    try {
      for (const file of [target, other]) {
        await mkdir(dirname(file), { recursive: true })
        await writeFile(file, 'fixture helper')
        await chmod(file, 0o644)
      }
      await writeFile(nativeModule, 'fixture native module', { mode: 0o644 })
      repairPackagedTerminalHelpers({ appOutDir: root, electronPlatformName: 'darwin', arch, packager: { appInfo: { productFilename: 'PiPilot' } } })
      expect((await stat(target)).mode & 0o777).toBe(0o755)
      expect((await stat(other)).mode & 0o777).toBe(0o644)
      expect((await stat(nativeModule)).mode & 0o777).toBe(0o644)
      expect(await readFile(target, 'utf8')).toBe('fixture helper')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('repairs a rebuilt Release helper without requiring a prebuilt helper', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pipilot-packaged-terminal-release-'))
    const helper = join(root, 'PiPilot.app', 'Contents', 'Resources', 'app.asar.unpacked', 'node_modules', 'node-pty', 'build', 'Release', 'spawn-helper')
    try {
      await mkdir(dirname(helper), { recursive: true })
      await writeFile(helper, 'fixture helper')
      await chmod(helper, 0o640)
      repairPackagedTerminalHelpers({ appOutDir: root, electronPlatformName: 'darwin', arch: 3, packager: { appInfo: { productFilename: 'PiPilot' } } })
      expect((await stat(helper)).mode & 0o777).toBe(0o751)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('fails packaging for a missing helper and refuses to chmod a symlink target', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pipilot-packaged-terminal-missing-'))
    const helper = join(root, 'PiPilot.app', 'Contents', 'Resources', 'app.asar.unpacked', 'node_modules', 'node-pty', 'prebuilds', 'darwin-arm64', 'spawn-helper')
    const external = join(root, 'unrelated-file')
    const context = { appOutDir: root, electronPlatformName: 'darwin', arch: 3, packager: { appInfo: { productFilename: 'PiPilot' } } }
    try {
      expect(() => repairPackagedTerminalHelpers(context)).toThrow('spawn helper is missing for darwin-arm64')
      await mkdir(dirname(helper), { recursive: true })
      await writeFile(external, 'unrelated', { mode: 0o644 })
      await symlink(external, helper)
      expect(() => repairPackagedTerminalHelpers(context)).toThrow('must be a regular file')
      expect((await stat(external)).mode & 0o777).toBe(0o644)
      expect(() => repairPackagedTerminalHelpers({ ...context, electronPlatformName: 'win32' })).not.toThrow()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('packaged runtime storage', () => {
  it('only permits packaged smoke data inside a dedicated temporary directory', () => {
    const temporaryDirectory = join(tmpdir(), 'pipilot-storage-test')
    const allowed = join(temporaryDirectory, 'pipilot-packaged-smoke-123')
    expect(resolveTestUserDataOverride({
      candidate: allowed,
      isPackaged: true,
      packagedSmoke: '1',
      temporaryDirectory,
    })).toBe(join(
      realpathSync.native(tmpdir()),
      'pipilot-storage-test',
      'pipilot-packaged-smoke-123',
    ))
    expect(resolveTestUserDataOverride({
      candidate: join(temporaryDirectory, 'unrelated'),
      isPackaged: true,
      packagedSmoke: '1',
      temporaryDirectory,
    })).toBeUndefined()
    expect(resolveTestUserDataOverride({
      candidate: join(temporaryDirectory, '..', 'outside'),
      isPackaged: true,
      packagedSmoke: '1',
      temporaryDirectory,
    })).toBeUndefined()
    expect(resolveTestUserDataOverride({
      candidate: allowed,
      isPackaged: true,
      packagedSmoke: undefined,
      temporaryDirectory,
    })).toBeUndefined()
  })

  it('separates browser, log, crash, and state locations', () => {
    expect(createApplicationStoragePaths('/application-data')).toEqual({
      browserDataDirectory: join('/application-data', 'browser-data'),
      crashDirectory: join('/application-data', 'crash-reports'),
      logDirectory: join('/application-data', 'logs'),
      mainLogFile: join('/application-data', 'logs', 'main.log'),
    })
  })
})

describe('production diagnostics', () => {
  it('writes bounded structured codes without raw path data', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pipilot-diagnostics-'))
    const logFile = join(root, 'logs', 'main.log')
    try {
      const diagnostics = new MainDiagnostics({
        enabled: true,
        logFile,
        maxLogBytes: 128,
      })
      diagnostics.initialize()
      diagnostics.scoped('warn', 'agent-runtime', 'stale-event')
      diagnostics.record('error', '/Users/example/private-key')

      const contents = await readFile(logFile, 'utf8')
      expect(contents).toContain('AGENT_RUNTIME_STALE_EVENT')
      expect(contents).toContain('UNSAFE_DIAGNOSTIC_CODE_REJECTED')
      expect(contents).not.toContain('/Users/example')

      await writeFile(logFile, 'x'.repeat(128), 'utf8')
      diagnostics.record('info', 'APPLICATION_READY')
      expect(await readFile(join(root, 'logs', 'main.previous.log'), 'utf8'))
        .toBe('x'.repeat(128))
      expect(await readFile(logFile, 'utf8')).toContain('APPLICATION_READY')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects diagnostic values that could contain unbounded details', () => {
    expect(createScopedDiagnosticCode('agent-runtime', 'worker-ready'))
      .toBe('AGENT_RUNTIME_WORKER_READY')
    expect(createScopedDiagnosticCode('agent', 'path/to/file'))
      .toBe('UNSAFE_DIAGNOSTIC_CODE_REJECTED')
  })
})
