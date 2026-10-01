import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  LocalPiManagementHost,
  terminatePiManagementProcess,
  type LocalPiManagementHostError,
} from '../../src/main/local-pi-management/local-pi-management-host'
import type { PiManagementHelperCommand } from '../../src/shared/pi-integrations'

const hosts = new Set<LocalPiManagementHost>()
const operationId = '00000000-0000-4000-8000-000000000111'

function command(action: 'snapshot' | 'install' = 'snapshot'): PiManagementHelperCommand {
  const base = {
    protocolVersion: 1 as const,
    operationId,
    cwd: '/fixture/workspace',
    scope: { kind: 'global' as const },
  }
  return action === 'install'
    ? { ...base, action, source: 'npm:fixture' }
    : { ...base, action }
}

afterEach(async () => {
  await Promise.all([...hosts].map((host) => host.dispose()))
  hosts.clear()
})

function createHost(mode?: string) {
  const host = new LocalPiManagementHost({
    helperEntryPath: resolve('tests/fixtures/fake-pi-management-host.mjs'),
    electronExecutablePath: process.execPath,
    environment: {
      ...process.env,
      ...(mode ? { FAKE_PI_MANAGEMENT_HOST_MODE: mode } : {}),
    },
    timeoutMs: 1_000,
    mutationTimeoutMs: 1_000,
    killGraceMs: 50,
  })
  hosts.add(host)
  return host
}

describe('LocalPiManagementHost', () => {
  it('correlates strict result and bounded progress records', async () => {
    const host = createHost()
    const progress: string[] = []
    const result = await host.run(command('install'), (event) => progress.push(event.message ?? ''))

    expect(progress).toEqual(['Installing fixture'])
    expect(result).toMatchObject({
      packages: [],
      retry: {
        globalEnabled: true,
        effective: { enabled: true, maxRetries: 3, baseDelayMs: 1000, maxAgentDelayMs: 60_000 },
      },
    })
  })

  it.each(['malformed', 'duplicate', 'post-final-progress'] as const)(
    'rejects %s helper output instead of accepting ambiguous results',
    async (mode) => {
      const host = createHost(mode)
      await expect(host.run(command())).rejects.toMatchObject({
        code: 'PI_MANAGEMENT_HELPER_PROTOCOL_ERROR',
      } satisfies Partial<LocalPiManagementHostError>)
    },
  )

  it('enforces a deadline and force-settles an uncooperative helper', async () => {
    const host = createHost('hang')
    await expect(host.run(command())).rejects.toMatchObject({
      code: 'PI_MANAGEMENT_HELPER_TIMEOUT',
    } satisfies Partial<LocalPiManagementHostError>)
  })

  it('constructs Windows descendant termination only for a validated owned PID', () => {
    const runFile = vi.fn()
    const kill = vi.fn()
    const signalGroup = vi.fn()
    terminatePiManagementProcess({ pid: 123, kill }, 'win32', runFile as never, signalGroup as never)
    expect(runFile).toHaveBeenCalledWith('taskkill', ['/PID', '123', '/T', '/F'], { windowsHide: true }, expect.any(Function))
    terminatePiManagementProcess({ pid: -1, kill }, 'win32', runFile as never, signalGroup as never)
    terminatePiManagementProcess({ pid: undefined, kill }, 'win32', runFile as never, signalGroup as never)
    expect(runFile).toHaveBeenCalledOnce()
    expect(kill).not.toHaveBeenCalled()
    expect(signalGroup).not.toHaveBeenCalled()
  })

  it.skipIf(process.platform === 'win32')('terminates a real owned npm-like descendant on helper timeout', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pipilot-helper-process-tree-'))
    const pidPath = join(root, 'child.pid')
    const helperPath = join(root, 'hanging-helper.mjs')
    let descendant: number | undefined
    try {
      await writeFile(helperPath, `
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const child = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { stdio: 'ignore' });
writeFileSync(${JSON.stringify(pidPath)}, String(child.pid));
process.on('SIGTERM', () => {});
setInterval(() => {}, 1000);
`)
      const host = new LocalPiManagementHost({ helperEntryPath: helperPath, electronExecutablePath: process.execPath, timeoutMs: 1_000, mutationTimeoutMs: 1_000, killGraceMs: 50 })
      hosts.add(host)
      const result = host.run(command('install'))
      const rejected = expect(result).rejects.toMatchObject({ code: 'PI_MANAGEMENT_HELPER_TIMEOUT' })
      await vi.waitFor(async () => { descendant = Number(await readFile(pidPath, 'utf8')); expect(descendant).toBeGreaterThan(0) })
      await rejected
      await vi.waitFor(() => expect(() => process.kill(descendant!, 0)).toThrow(), { timeout: 3_000 })
    } finally {
      if (descendant && Number.isSafeInteger(descendant) && descendant > 0) {
        try { process.kill(descendant, 'SIGKILL') } catch { /* already terminated */ }
      }
      await rm(root, { recursive: true, force: true })
    }
  })
})
