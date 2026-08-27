import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  LocalPiManagementHost,
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
        effective: { enabled: true, maxRetries: 3, baseDelayMs: 1000 },
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
})
