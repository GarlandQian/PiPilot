import { describe, expect, it } from 'vitest'
import {
  mcpConfigLoadContract,
  mcpConfigRestartContract,
  mcpConfigSaveContract,
} from '../../src/shared/ipc/contracts'

const context = { requestId: '7ce0eb26-d89f-4f0b-8b1a-89f3db46d6db' }

describe('MCP config IPC contracts', () => {
  it('accepts explicit scopes without accepting renderer paths', () => {
    expect(mcpConfigLoadContract.requestSchema.safeParse({
      context,
      target: { kind: 'global' },
    }).success).toBe(true)
    expect(mcpConfigLoadContract.requestSchema.safeParse({
      context,
      target: {
        kind: 'project',
        workspaceId: '00000000-0000-4000-8000-000000000901',
      },
    }).success).toBe(true)
    expect(mcpConfigLoadContract.requestSchema.safeParse({
      context,
      target: { kind: 'global', path: '/tmp/other.json' },
    }).success).toBe(false)
  })

  it('requires an expected fingerprint for saves and has a path-free restart request', () => {
    expect(mcpConfigSaveContract.requestSchema.safeParse({
      context,
      target: { kind: 'global' },
      content: '{ "mcpServers": {} }',
      expectedFingerprint: 'a'.repeat(64),
    }).success).toBe(true)
    expect(mcpConfigSaveContract.requestSchema.safeParse({
      context,
      target: { kind: 'global' },
      content: '{ "mcpServers": {} }',
    }).success).toBe(false)
    expect(mcpConfigRestartContract.requestSchema.safeParse({ context }).success).toBe(true)
  })
})
