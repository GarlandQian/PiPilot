import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConversationScopeResolver } from '../../src/main/conversations/conversation-scope-resolver'
import {
  McpConfigController,
  McpConfigError,
  McpConfigService,
} from '../../src/main/mcp/mcp-config-service'
import type { ConversationScope } from '../../src/shared/conversation-scope'
import { ConfigApplyCoordinator } from '../../src/main/config-apply/config-apply-coordinator'
import { FakeConfigApplyRuntime } from './helpers/config-apply-runtime'
import { convertMcpConfigToNativeJson } from '../../src/shared/mcp-config-parser'

const workspaceId = '00000000-0000-4000-8000-000000000901'
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })))
})

async function fixture({ customAgentDirectory = false, assertNativeConfigurationWritable }: { customAgentDirectory?: boolean; assertNativeConfigurationWritable?: (target: import('../../src/shared/mcp-config').McpConfigTarget) => Promise<void> } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'pipilot-mcp-config-'))
  roots.push(root)
  const home = join(root, 'home')
  const projectDirectory = join(root, 'project')
  const projectless = join(root, 'projectless')
  await Promise.all([
    mkdir(home, { recursive: true }),
    mkdir(join(projectDirectory, '.pi'), { recursive: true }),
    mkdir(projectless, { recursive: true }),
  ])
  const project = await realpath(projectDirectory)
  let activeScope: ConversationScope = { kind: 'project', workspaceId }
  const resolver = new ConversationScopeResolver({
    getLocation(id) {
      return id === workspaceId
        ? { id: workspaceId, name: 'Project', path: project }
        : undefined
    },
  }, projectless)
  const service = new McpConfigService({
    homeDirectory: join(home, 'unused', '..'),
    ...(customAgentDirectory ? { agentDirectory: join(root, 'custom-agent') } : {}),
    getActiveScope: () => activeScope,
    scopeResolver: resolver,
    assertNativeConfigurationWritable,
  })
  return {
    home,
    project,
    service,
    setActiveScope(scope: ConversationScope) {
      activeScope = scope
    },
  }
}

describe('McpConfigService', () => {
  it('saves project setting overrides while allowing provider auth only in the global file', async () => {
    const { service } = await fixture()
    const projectTarget = { kind: 'project' as const, workspaceId }
    const globalTarget = { kind: 'global' as const }
    const initialProject = await service.load(projectTarget)
    const override = JSON.stringify({ mcpServers: { docs: { enabled: false } } })
    const saved = await service.save(projectTarget, override, initialProject.fingerprint)
    expect(saved).toMatchObject({ valid: true, servers: [{ transport: 'override' }] })
    expect(await service.load(projectTarget)).toMatchObject({ valid: true, content: override })

    const auth = JSON.stringify({ mcpServers: { docs: { url: 'https://example.test/mcp', auth: { provider: 'openai' } } } })
    await expect(service.save(projectTarget, auth, saved.fingerprint)).rejects.toMatchObject({ code: 'MCP_CONFIG_INVALID' })
    expect((await service.load(projectTarget)).content).toBe(override)
    const initialGlobal = await service.load(globalTarget)
    expect(await service.save(globalTarget, auth, initialGlobal.fingerprint)).toMatchObject({ valid: true })
    await expect(service.save(globalTarget, override, (await service.load(globalTarget)).fingerprint)).rejects.toMatchObject({ code: 'MCP_CONFIG_INVALID' })
  })

  it('rejects writes when an active extension would interpret native fields differently', async () => {
    const guard = vi.fn(async () => { throw new McpConfigError('MCP_CONFIG_EXTENSION_OVERRIDE', 'Disable the adapter before saving native configuration.') })
    const { project, service } = await fixture({ assertNativeConfigurationWritable: guard })
    const target = { kind: 'project' as const, workspaceId }
    const initial = await service.load(target)
    await expect(service.save(target, '{"mcpServers":{"disabledServer":{"command":"node","enabled":false}}}', initial.fingerprint))
      .rejects.toMatchObject({ code: 'MCP_CONFIG_EXTENSION_OVERRIDE' })
    expect(guard).toHaveBeenCalledWith(target)
    await expect(readFile(join(project, '.pi', 'mcp.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('offers old project data without writing it and applies explicit imports to the project cwd', async () => {
    const { project, service } = await fixture()
    const target = { kind: 'project' as const, workspaceId }
    const legacyPath = join(project, '.mcp.json')
    const legacy = '// retained original\n{"mcpServers":{"docs":{"command":"node","disabled":true,"future":42}}}\n'
    await writeFile(legacyPath, legacy)
    const initial = await service.load(target)
    expect(initial).toMatchObject({ exists: false, legacy: { path: legacyPath, content: legacy } })
    await expect(readFile(initial.path, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    const runtime = new FakeConfigApplyRuntime()
    const coordinator = new ConfigApplyCoordinator(runtime)
    try {
      const controller = new McpConfigController(service, coordinator, vi.fn())
      await controller.save(target, convertMcpConfigToNativeJson(legacy), initial.fingerprint)
      expect(runtime.applyConfiguration).toHaveBeenCalledWith(expect.objectContaining({ cwd: project }))
      expect(JSON.parse(await readFile(initial.path, 'utf8')).mcpServers.docs).toEqual({ command: 'node', enabled: false, future: 42 })
      await expect(readFile(legacyPath, 'utf8')).resolves.toBe(legacy)
      expect(await service.load(target)).toMatchObject({ exists: true, legacy: { content: legacy } })
      await expect(controller.save(target, '{"mcpServers":{}}', initial.fingerprint)).rejects.toMatchObject({ code: 'MCP_CONFIG_CONFLICT' })
    } finally { coordinator.dispose() }
  })

  it('keeps native configuration usable if an old legacy path cannot be read', async () => {
    const { project, service } = await fixture()
    await mkdir(join(project, '.mcp.json'))
    const snapshot = await service.load({ kind: 'project', workspaceId })
    expect(snapshot).toMatchObject({ valid: true, legacyUnavailablePath: join(project, '.mcp.json') })
  })

  it('uses the authoritative Agent directory without changing the project MCP path', async () => {
    const { home, project, service } = await fixture({ customAgentDirectory: true })
    const agentDirectory = join(home, '..', 'custom-agent')
    const defaultDirectory = join(home, '.pi', 'agent')
    await mkdir(defaultDirectory, { recursive: true })
    const defaultContent = '{ "mcpServers": { "untouched": { "command": "node" } } }'
    await writeFile(join(defaultDirectory, 'mcp.json'), defaultContent)
    const initial = await service.load({ kind: 'global' })
    expect(initial).toMatchObject({ path: join(agentDirectory, 'mcp.json'), exists: false })
    const content = '{ "mcpServers": { "custom": { "command": "node" } } }'
    await service.save({ kind: 'global' }, content, initial.fingerprint)
    await expect(readFile(join(agentDirectory, 'mcp.json'), 'utf8')).resolves.toBe(content)
    await expect(readFile(join(defaultDirectory, 'mcp.json'), 'utf8')).resolves.toBe(defaultContent)
    await expect(service.load({ kind: 'project', workspaceId }))
      .resolves.toMatchObject({ path: join(project, '.pi', 'mcp.json'), exists: false })
  })

  it('uses only the selected-project file and the exact Pi Agent global file', async () => {
    const { home, project, service } = await fixture()
    const projectTarget = { kind: 'project' as const, workspaceId }
    const oldGlobalPath = join(home, '.config', 'mcp', 'mcp.json')
    const oldGlobalContent = '{ "mcpServers": { "legacy": { "command": "ignored" } } }'
    await mkdir(join(home, '.config', 'mcp'), { recursive: true })
    await writeFile(oldGlobalPath, oldGlobalContent, 'utf8')
    const projectSnapshot = await service.load(projectTarget)
    const globalSnapshot = await service.load({ kind: 'global' })

    expect(projectSnapshot).toMatchObject({
      exists: false,
      path: join(project, '.pi', 'mcp.json'),
      valid: true,
    })
    expect(globalSnapshot).toMatchObject({
      exists: false,
      path: join(home, '.pi', 'agent', 'mcp.json'),
      servers: [],
    })

    const content = '{\n  "mcpServers": { "docs": { "command": "npx" } }\n}\n'
    const saved = await service.save(
      projectTarget,
      content,
      projectSnapshot.fingerprint,
    )
    expect(saved.exists).toBe(true)
    await expect(readFile(join(project, '.pi', 'mcp.json'), 'utf8')).resolves.toBe(content)

    const globalContent = '{\n  "mcpServers": { "global": { "command": "node" } }\n}\n'
    const savedGlobal = await service.save(
      { kind: 'global' },
      globalContent,
      globalSnapshot.fingerprint,
    )
    expect(savedGlobal.path).toBe(join(home, '.pi', 'agent', 'mcp.json'))
    await expect(readFile(join(home, '.pi', 'agent', 'mcp.json'), 'utf8'))
      .resolves.toBe(globalContent)
    await expect(readFile(oldGlobalPath, 'utf8')).resolves.toBe(oldGlobalContent)
  })

  it('keeps project scope on the canonical explicitly selected directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pipilot-mcp-project-link-'))
    roots.push(root)
    const home = join(root, 'home')
    const canonicalProject = join(root, 'canonical-project')
    const linkedProject = join(root, 'linked-project')
    const projectless = join(root, 'projectless')
    await Promise.all([
      mkdir(home, { recursive: true }),
      mkdir(canonicalProject, { recursive: true }),
      mkdir(projectless, { recursive: true }),
    ])
    await symlink(canonicalProject, linkedProject, 'dir')
    const resolver = new ConversationScopeResolver({
      getLocation(id) {
        return id === workspaceId
          ? { id: workspaceId, name: 'Linked project', path: linkedProject }
          : undefined
      },
    }, projectless)
    const service = new McpConfigService({
      homeDirectory: home,
      getActiveScope: () => ({ kind: 'project', workspaceId }),
      scopeResolver: resolver,
    })

    await expect(service.load({ kind: 'project', workspaceId })).rejects.toMatchObject({
      code: 'MCP_CONFIG_SCOPE_UNAVAILABLE',
    } satisfies Partial<McpConfigError>)
    await expect(readFile(join(canonicalProject, '.pi', 'mcp.json'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('retains saved target application across selection and applies only the latest fingerprint', async () => {
    const { service, setActiveScope } = await fixture()
    const target = { kind: 'project' as const, workspaceId }
    const initial = await service.load(target)
    const runtime = new FakeConfigApplyRuntime()
    const coordinator = new ConfigApplyCoordinator(runtime)
    const controller = new McpConfigController(service, coordinator, vi.fn())

    try {
      await expect(controller.save(
        target,
        '{ "mcpServers": { "first": { "command": "node" } } }',
        initial.fingerprint,
      )).resolves.toMatchObject({ apply: 'pending' })

      runtime.selectedGeneration = 8
      runtime.emitChange()
      expect(runtime.reload).not.toHaveBeenCalled()

      const current = await service.load(target)
      await expect(controller.save(
        target,
        '{ "mcpServers": { "second": { "command": "node" } } }',
        current.fingerprint,
      )).resolves.toMatchObject({ apply: 'pending' })
      const saved = await controller.load(target)
      setActiveScope({ kind: 'projectless' })
      runtime.busy = false
      runtime.emitChange()
      await vi.waitFor(() => expect(coordinator.getStatus(saved.path)).toMatchObject({
        state: 'applied', fingerprint: saved.fingerprint,
      }))
      expect(runtime.reload).toHaveBeenCalledTimes(1)
    } finally {
      coordinator.dispose()
    }
  })

  it('rejects external changes without overwriting them', async () => {
    const { project, service } = await fixture()
    const target = { kind: 'project' as const, workspaceId }
    const initial = await service.load(target)
    const external = '{ "mcpServers": { "external": { "url": "https://example.test/mcp" } } }'
    await writeFile(join(project, '.pi', 'mcp.json'), external, 'utf8')

    await expect(service.save(
      target,
      '{ "mcpServers": { "mine": { "command": "node" } } }',
      initial.fingerprint,
    )).rejects.toMatchObject({
      code: 'MCP_CONFIG_CONFLICT',
    } satisfies Partial<McpConfigError>)
    await expect(readFile(join(project, '.pi', 'mcp.json'), 'utf8')).resolves.toBe(external)
  })

  it('leaves disk unchanged for invalid JSONC or an inactive project target', async () => {
    const { project, service, setActiveScope } = await fixture()
    const target = { kind: 'project' as const, workspaceId }
    const initial = await service.load(target)
    await expect(service.save(
      target,
      '{ "mcpServers": { "broken": { "url": "x", "command": "y" } } }',
      initial.fingerprint,
    )).rejects.toMatchObject({ code: 'MCP_CONFIG_INVALID' } satisfies Partial<McpConfigError>)
    await expect(readFile(join(project, '.pi', 'mcp.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })

    setActiveScope({ kind: 'projectless' })
    expect(service.isTargetActive(target)).toBe(false)
    expect(service.isTargetActive({ kind: 'global' })).toBe(true)
    await expect(service.load(target)).rejects.toMatchObject({
      code: 'MCP_CONFIG_SCOPE_UNAVAILABLE',
    } satisfies Partial<McpConfigError>)
  })
})
