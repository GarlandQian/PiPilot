import { describe, expect, it } from 'vitest'
import {
  piIntegrationsInstallContract,
  piIntegrationsLoadContract,
  piIntegrationsSetRetryContract,
  piIntegrationOperationEventSchema,
} from '../../src/shared/ipc/contracts'
import { PI_INTEGRATION_SOURCE_LIMIT } from '../../src/shared/pi-integrations'

const requestId = '00000000-0000-4000-8000-000000000555'
const workspaceId = '00000000-0000-4000-8000-000000000556'

describe('Pi integrations IPC contracts', () => {
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
