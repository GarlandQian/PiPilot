import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SettingsManager } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'
import {
  piIntegrationsInstallContract,
  piIntegrationsLoadContract,
  piIntegrationsSetRetryContract,
  piIntegrationOperationEventSchema,
} from '../../src/shared/ipc/contracts'
import { PI_INTEGRATION_SOURCE_LIMIT, piRetrySettingsSchema } from '../../src/shared/pi-integrations'

const requestId = '00000000-0000-4000-8000-000000000555'
const workspaceId = '00000000-0000-4000-8000-000000000556'

describe('Pi integrations IPC contracts', () => {
  it('preserves the actual SDK effective agent retry delay limit and project override', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pipilot-retry-sdk-'))
    try {
      const agentDir = join(root, 'agent')
      const cwd = join(root, 'project')
      await Promise.all([mkdir(agentDir), mkdir(join(cwd, '.pi'), { recursive: true })])
      await writeFile(join(agentDir, 'settings.json'), JSON.stringify({ retry: { enabled: false, maxAgentDelayMs: 91_000 } }))
      await writeFile(join(cwd, '.pi', 'settings.json'), JSON.stringify({ retry: { enabled: true, maxAgentDelayMs: 17_000 } }))
      const settings = SettingsManager.create(cwd, agentDir, { projectTrusted: true })
      const snapshot = piRetrySettingsSchema.parse({
        globalEnabled: settings.getGlobalSettings().retry?.enabled ?? true,
        effective: settings.getRetrySettings(),
      })
      expect(snapshot).toEqual({ globalEnabled: false, effective: {
        enabled: true, maxRetries: 3, baseDelayMs: 2000, maxAgentDelayMs: 17_000,
      } })
      expect(piRetrySettingsSchema.safeParse({
        ...snapshot, effective: { ...snapshot.effective, unrecognizedField: true },
      }).success).toBe(false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('accepts only strict global/project scopes and bounded package sources', () => {
    expect(piIntegrationsLoadContract.requestSchema.safeParse({
      context: { requestId },
      scope: { kind: 'global' },
    }).success).toBe(true)
    expect(piIntegrationsLoadContract.requestSchema.safeParse({
      context: { requestId },
      scope: { kind: 'project', workspaceId },
    }).success).toBe(true)
    expect(piIntegrationsLoadContract.requestSchema.safeParse({
      context: { requestId },
      scope: { kind: 'project', workspaceId: 'not-a-uuid' },
    }).success).toBe(false)
    expect(piIntegrationsInstallContract.requestSchema.safeParse({
      context: { requestId },
      scope: { kind: 'global' },
      source: `npm:${'x'.repeat(PI_INTEGRATION_SOURCE_LIMIT)}`,
    }).success).toBe(false)
    expect(piIntegrationsSetRetryContract.requestSchema.safeParse({
      context: { requestId },
      scope: { kind: 'global' },
      enabled: true,
      privateSetting: true,
    }).success).toBe(false)
  })

  it('rejects uncorrelated or recursively shaped operation events', () => {
    const valid = {
      eventId: requestId,
      operation: {
        operationId: workspaceId,
        kind: 'install',
        phase: 'progress',
        scope: { kind: 'global' },
        source: 'npm:fixture',
        progress: {
          type: 'progress',
          action: 'install',
          source: 'npm:fixture',
          message: 'Installing fixture',
        },
        startedAt: 1,
      },
    }
    expect(piIntegrationOperationEventSchema.safeParse(valid).success).toBe(true)
    expect(piIntegrationOperationEventSchema.safeParse({
      ...valid,
      operation: { ...valid.operation, rawPackageManager: { nested: true } },
    }).success).toBe(false)
  })
})
