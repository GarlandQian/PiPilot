import { describe, expect, it } from 'vitest'
import {
  externalControlGetContract,
  externalControlLauncherGetContract,
  externalControlLauncherInstallContract,
  externalControlLauncherUninstallContract,
  externalControlSetEnabledContract,
} from '../../src/shared/ipc/contracts'
import {
  externalControlDescriptorSchema,
  externalControlLauncherSnapshotSchema,
  externalControlSettingsChangedEventSchema,
  externalControlSettingsSnapshotSchema,
  type ExternalControlSettingsSnapshot,
} from '../../src/shared/external-control'
import { selectExternalControlSnapshot } from '../../src/store/external-control'

const requestId = '00000000-0000-4000-8000-000000000821'
const timestamp = '2026-08-22T00:00:00.000Z'

function snapshot(revision: number): ExternalControlSettingsSnapshot {
  return externalControlSettingsSnapshotSchema.parse({
    revision,
    enabled: true,
    state: 'ready',
    connectedClients: 1,
    configuration: {
      command: 'pipilot-mcp',
      args: [],
    },
    recentOperations: [{
      presentationId: `row_${'r'.repeat(43)}`,
      conversationLabel: 'Planning session',
      action: 'send_prompt',
      status: 'completed',
      timestamp,
    }],
  })
}

describe('External Control settings contracts', () => {
  it('accepts only strict get and enable requests', () => {
    expect(externalControlGetContract.requestSchema.safeParse({
      context: { requestId },
    }).success).toBe(true)
    expect(externalControlGetContract.requestSchema.safeParse({
      context: { requestId },
      enabled: true,
    }).success).toBe(false)
    expect(externalControlSetEnabledContract.requestSchema.safeParse({
      context: { requestId },
      enabled: true,
    }).success).toBe(true)
    expect(externalControlSetEnabledContract.requestSchema.safeParse({
      context: { requestId },
      enabled: true,
      descriptorPath: '/private/descriptor.json',
    }).success).toBe(false)
    expect(externalControlLauncherGetContract.requestSchema.safeParse({
      context: { requestId },
    }).success).toBe(true)
    expect(externalControlLauncherInstallContract.requestSchema.safeParse({
      context: { requestId },
      target: '/tmp/bin',
    }).success).toBe(false)
    expect(externalControlLauncherUninstallContract.requestSchema.safeParse({
      context: { requestId },
    }).success).toBe(true)
    expect(externalControlLauncherUninstallContract.requestSchema.safeParse({
      context: { requestId },
      path: '/tmp/pipilot-mcp',
    }).success).toBe(false)
  })

  it('rejects a NUL byte in a published bridge endpoint', () => {
    expect(externalControlDescriptorSchema.safeParse({
      protocolVersion: 1,
      instanceId: requestId,
      endpoint: '/private/pipilot/bridge.sock\0suffix',
      token: 't'.repeat(43),
      createdAt: timestamp,
    }).success).toBe(false)
  })

  it('projects metadata-only rows and token-free client configuration', () => {
    const valid = snapshot(4)
    expect(externalControlSettingsChangedEventSchema.safeParse({
      eventId: requestId,
      snapshot: valid,
    }).success).toBe(true)
    expect(JSON.stringify(valid)).not.toContain('token')
    expect(externalControlSettingsSnapshotSchema.safeParse({
      ...valid,
      configuration: { ...valid.configuration, token: 'private-token' },
    }).success).toBe(false)
    expect(externalControlSettingsSnapshotSchema.safeParse({
      ...valid,
      configuration: {
        ...valid.configuration,
        env: { ELECTRON_RUN_AS_NODE: '1' },
      },
    }).success).toBe(false)
    expect(externalControlSettingsSnapshotSchema.safeParse({
      ...valid,
      configuration: {
        ...valid.configuration,
        args: ['--descriptor', '/private/descriptor.json'],
      },
    }).success).toBe(false)
    expect(externalControlSettingsSnapshotSchema.safeParse({
      ...valid,
      configuration: {
        ...valid.configuration,
        command: '/Applications/PiPilot.app/Contents/MacOS/PiPilot',
      },
    }).success).toBe(false)
    expect(externalControlSettingsSnapshotSchema.safeParse({
      ...valid,
      configuration: {
        ...valid.configuration,
        args: ['--pipilot-mcp-stdio', '--descriptor', 'descriptor.json'],
      },
    }).success).toBe(false)
    expect(externalControlSettingsSnapshotSchema.safeParse({
      ...valid,
      recentOperations: [{
        ...valid.recentOperations[0],
        operationId: `op_${'o'.repeat(43)}`,
      }],
    }).success).toBe(false)
    expect(externalControlSettingsSnapshotSchema.safeParse({
      ...valid,
      recentOperations: [{
        ...valid.recentOperations[0],
        conversationId: `conv_${'c'.repeat(43)}`,
        finalResponse: 'private response',
      }],
    }).success).toBe(false)
  })

  it('rejects platform paths and accepts only the stable empty-args entry', () => {
    const valid = snapshot(4)
    expect(externalControlSettingsSnapshotSchema.safeParse({
      ...valid,
      configuration: {
        command: 'C:\\Program Files\\PiPilot\\PiPilot-mcp.exe',
        args: [],
      },
    }).success).toBe(false)
    expect(externalControlSettingsSnapshotSchema.safeParse({
      ...valid,
      configuration: { command: 'pipilot-mcp', args: [] },
    }).success).toBe(true)
  })

  it('keeps launcher status bounded and path-free', () => {
    expect(externalControlLauncherSnapshotSchema.safeParse({
      state: 'installed',
      managed: true,
      requiresClientRestart: false,
    }).success).toBe(true)
    expect(externalControlLauncherSnapshotSchema.safeParse({
      state: 'missing',
      managed: false,
      requiresClientRestart: false,
      path: '/Users/test/.local/bin/pipilot-mcp',
    }).success).toBe(false)
    expect(externalControlLauncherSnapshotSchema.safeParse({
      state: 'unsupported',
      managed: false,
      requiresClientRestart: false,
      error: {
        code: 'launcher_unsafe_target',
        message: 'No secure launcher directory is available.',
      },
    }).success).toBe(true)
    expect(externalControlLauncherSnapshotSchema.safeParse({
      state: 'installed',
      requiresClientRestart: false,
    }).success).toBe(false)
  })

  it('does not let an older invoke response replace a newer event snapshot', () => {
    const current = snapshot(7)
    const stale = snapshot(6)
    const selected = selectExternalControlSnapshot(current, stale)
    expect(selected).toBe(current)

    const newer = snapshot(8)
    const accepted = selectExternalControlSnapshot(current, newer)
    expect(accepted).toEqual(newer)
    expect(accepted).not.toBe(newer)
  })
})
