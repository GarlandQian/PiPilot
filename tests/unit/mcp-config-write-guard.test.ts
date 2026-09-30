import { describe, expect, it, vi } from 'vitest'
import { createMcpConfigWriteGuard } from '../../src/main/mcp/mcp-config-write-guard'
import type { LocalPiSlashCommand } from '../../src/shared/local-pi'
import type { PiIntegrationSnapshot } from '../../src/shared/pi-integrations'

const project = { kind: 'project' as const, workspaceId: '00000000-0000-4000-8000-000000000901' }
const otherProject = { kind: 'project' as const, workspaceId: '00000000-0000-4000-8000-000000000902' }

function integrations(adapter?: 'enabled' | 'disabled' | 'package-only'): PiIntegrationSnapshot {
  return {
    state: 'ready', generation: 1, executable: { path: 'bundled', version: '0.99.1' },
    scope: project, updates: [], retry: null, restartRequired: false, diagnostics: [], checkedAt: 1,
    packages: adapter ? [{
      id: 'adapter', source: 'npm:pi-mcp-adapter@0.9.0', sourceType: 'npm', displayName: 'pi-mcp-adapter',
      scope: 'global', pinned: false, filtered: false,
      resourceCounts: { extension: 1, skill: 0, prompt: 0, theme: 0 },
      compatibility: 'not-observed', updateAvailable: false,
    }] : [],
    resources: adapter && adapter !== 'package-only' ? [{
      id: 'adapter-extension', packageId: 'adapter', kind: 'extension', label: 'MCP',
      path: '/fixture/adapter/index.ts', source: 'npm:pi-mcp-adapter@0.9.0', scope: 'global',
      effectiveState: adapter, compatibility: 'not-observed',
    }] : [],
  }
}

function command(path: string): LocalPiSlashCommand {
  return {
    name: 'mcp', description: 'Manage MCP servers', source: 'extension',
    sourceInfo: { path, source: path, scope: 'user', origin: 'top-level' },
  }
}

describe('native MCP configuration write guard', () => {
  it('checks fresh package state for the actual target even without a running session', async () => {
    const loadIntegrations = vi.fn(async () => integrations('enabled'))
    const guard = createMcpConfigWriteGuard({ loadIntegrations, getRuntime: () => undefined })
    await expect(guard(project)).rejects.toMatchObject({ code: 'MCP_CONFIG_EXTENSION_OVERRIDE' })
    expect(loadIntegrations).toHaveBeenCalledWith(project)
  })

  it.each(['disabled', 'package-only'] as const)('allows retained %s adapters without an active override', async (state) => {
    const guard = createMcpConfigWriteGuard({
      loadIntegrations: async () => integrations(state),
      getRuntime: () => ({ scope: project, snapshot: { state: 'ready', commands: [command('builtin:mcp')] } }),
    })
    await expect(guard(project)).resolves.toBeUndefined()
  })

  it('blocks a still-loaded custom override after its package has been disabled', async () => {
    const guard = createMcpConfigWriteGuard({
      loadIntegrations: async () => integrations('disabled'),
      getRuntime: () => ({ scope: project, snapshot: { state: 'ready', commands: [command('/fixture/custom-mcp.ts')] } }),
    })
    await expect(guard(project)).rejects.toMatchObject({ code: 'MCP_CONFIG_EXTENSION_OVERRIDE' })
    await expect(guard({ kind: 'global' })).rejects.toMatchObject({ code: 'MCP_CONFIG_EXTENSION_OVERRIDE' })
    await expect(guard(otherProject)).resolves.toBeUndefined()
  })

  it('fails closed when current package state cannot be established', async () => {
    const guard = createMcpConfigWriteGuard({
      loadIntegrations: async () => ({ ...integrations(), state: 'unavailable' }),
      getRuntime: () => undefined,
    })
    await expect(guard(project)).rejects.toMatchObject({ code: 'MCP_CONFIG_RUNTIME_UNAVAILABLE' })
    const failed = createMcpConfigWriteGuard({
      loadIntegrations: async () => { throw new Error('Helper disconnected') }, getRuntime: () => undefined,
    })
    await expect(failed(project)).rejects.toThrow('Helper disconnected')
  })
})
