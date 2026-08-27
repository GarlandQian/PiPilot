import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
    })).toBe(allowed)
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
