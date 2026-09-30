import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentSession, InlineExtension } from '@earendil-works/pi-coding-agent'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RuntimeManager } from '../../src/main/pi-host/runtime-manager'
import { loadRuntimeMcpConfig } from '../../src/main/pi-host/runtime-native-mcp'
import { localPiRpcEventSchema, localPiSessionEntrySchema } from '../../src/shared/local-pi'
import { NATIVE_MCP_CANARY_TEXT, startNativeMcpFixture } from '../helpers/native-mcp-fixture'
import { startPiSdkFixture } from '../electron/pi-sdk-fixture'

const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose()
  vi.unstubAllEnvs()
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'pipilot-native-mcp-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const agentDir = join(root, 'agent')
  const cwd = join(root, 'project')
  await Promise.all([mkdir(agentDir), mkdir(join(cwd, '.pi'), { recursive: true })])
  return { root, agentDir, cwd }
}

async function config(path: string, value: unknown) {
  await writeFile(path, JSON.stringify(value), 'utf8')
}

async function runtime(
  paths: Awaited<ReturnType<typeof fixture>>,
  extensionFactories: InlineExtension[] = [],
) {
  vi.stubEnv('PI_CODING_AGENT_DIR', paths.agentDir)
  const manager = new RuntimeManager({
    cwd: paths.cwd, agentDir: paths.agentDir,
    resourceLoaderOptions: {
      noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      extensionFactories,
    },
  })
  cleanup.push(() => manager.dispose())
  const created = await manager.create({ runtimeId: 'native-mcp', sessionDir: join(paths.root, 'sessions') })
  const events: unknown[] = []
  manager.subscribeEvents((record) => events.push(record.event))
  await manager.bindRuntime(created.runtimeId, created.generation)
  const entries = Reflect.get(manager, 'runtimes') as Map<string, { runtime: { session: AgentSession } }>
  return { manager, created, session: entries.get(created.runtimeId)!.runtime.session, events }
}

describe('native Pi MCP Host integration', () => {
  it('loads standard global and trusted project config, preserving disabled state and project precedence', async () => {
    const { agentDir, cwd } = await fixture()
    await config(join(agentDir, 'mcp.json'), { autoEnableCodemode: true, mcpServers: {
      global: { command: 'global-command' }, shared: { url: 'https://global.invalid/mcp' },
    } })
    await config(join(cwd, '.pi', 'mcp.json'), { autoEnableCodemode: false, mcpServers: {
      shared: { url: 'https://project.invalid/mcp', enabled: false },
    } })
    expect(loadRuntimeMcpConfig(agentDir, cwd, true)).toMatchObject({
      autoEnableCodemode: false, errors: [], servers: [
        { name: 'global', scope: 'global' },
        { name: 'shared', scope: 'project', config: { enabled: false, url: 'https://project.invalid/mcp' } },
      ],
    })
    expect(loadRuntimeMcpConfig(agentDir, cwd, false)).toMatchObject({
      autoEnableCodemode: true, servers: [
        { name: 'global', scope: 'global' },
        { name: 'shared', scope: 'global', config: { url: 'https://global.invalid/mcp' } },
      ],
    })
  })

  it('does not activate legacy disabled entries or fall back to a global server for an invalid project override', async () => {
    const { agentDir, cwd } = await fixture()
    await config(join(agentDir, 'mcp.json'), { mcpServers: {
      shared: { command: 'do-not-start' }, legacy: { command: 'do-not-start', disabled: true },
      socket: { socket: '/unused.sock' }, native: { command: 'native-disabled', enabled: false },
    } })
    await config(join(cwd, '.pi', 'mcp.json'), { mcpServers: { shared: { command: 'do-not-start', disabled: true } } })
    const loaded = loadRuntimeMcpConfig(agentDir, cwd, true)
    expect(loaded.servers).toEqual([expect.objectContaining({ name: 'native', config: { command: 'native-disabled', enabled: false } })])
    expect(loaded.errors).toHaveLength(3)
  })

  it('rejects JSONC and never includes malformed credential text in diagnostics', async () => {
    const { agentDir, cwd } = await fixture()
    await writeFile(join(agentDir, 'mcp.json'), '{"mcpServers": {/* secret-fixture-do-not-echo */}}')
    const loaded = loadRuntimeMcpConfig(agentDir, cwd, true)
    expect(loaded.servers).toEqual([])
    expect(loaded.errors).toHaveLength(1)
    expect(loaded.errors.join()).not.toContain('secret-fixture-do-not-echo')
  })

  it('connects a real MCP endpoint, executes it through native codemode, and projects nested events', async () => {
    const paths = await fixture()
    const mcp = await startNativeMcpFixture()
    cleanup.push(() => mcp.close())
    await config(join(paths.agentDir, 'mcp.json'), { mcpServers: {
      canary: { url: mcp.url, exposure: 'codemode' },
    } })
    const provider = await startPiSdkFixture({ agentDir: paths.agentDir, codemodeToolPrompts: {
      'Run native MCP': 'const result = await tools.mcp__canary__get_test_value({}); text(result.content[0].text)',
    } })
    cleanup.push(() => provider.close())
    const { manager, created, session, events } = await runtime(paths)
    const failures: unknown[] = []
    manager.subscribeFatalErrors((error) => failures.push(error))
    const commands = await manager.command(created.runtimeId, { type: 'get_commands' })
    expect(commands.response).toMatchObject({ success: true, data: { commands: expect.arrayContaining([
      expect.objectContaining({ name: 'mcp', sourceInfo: expect.objectContaining({ path: 'builtin:mcp' }) }),
    ]) } })
    await vi.waitFor(() => expect(mcp.calls.some((call) => call.method === 'tools/list')).toBe(true))
    await vi.waitFor(() => expect(session.agent.state.tools.some((tool) => tool.name === 'codemode')).toBe(true))
    await session.prompt('Run native MCP', { source: 'rpc' })
    expect(provider.codemodeResults.join('\n')).toContain(NATIVE_MCP_CANARY_TEXT)
    expect(mcp.calls).toContainEqual({ method: 'tools/call', name: 'get_test_value' })
    expect(events).toContainEqual(expect.objectContaining({ type: 'tool_execution_start', parentToolCallId: expect.any(String) }))
    expect(events).toContainEqual(expect.objectContaining({ type: 'tool_execution_end', parentToolCallId: expect.any(String) }))
    expect(failures).toEqual([])
    expect(events.every((event) => localPiRpcEventSchema.safeParse(event).success)).toBe(true)
  }, 20_000)

  it('respects an installed user extension that already owns /mcp', async () => {
    const paths = await fixture()
    const { manager, created } = await runtime(paths, [{ name: 'existing-mcp-owner', factory: (pi) => {
      pi.registerCommand('mcp', { description: 'Fixture MCP owner', handler: async () => {} })
    } }])
    const commands = await manager.command(created.runtimeId, { type: 'get_commands' })
    expect(commands.response).toMatchObject({ success: true, data: { commands: expect.arrayContaining([
      expect.objectContaining({ name: 'mcp', sourceInfo: expect.objectContaining({ path: '<inline:existing-mcp-owner>' }) }),
    ]) } })
    if (!commands.response.success || commands.response.command !== 'get_commands') throw new Error('Missing commands')
    expect(commands.response.data.commands.filter((command) => command.name === 'mcp')).toHaveLength(1)
  })

  it('accepts new SDK context edit entries', () => {
    const base = { id: 'entry', parentId: null, timestamp: '2026-09-30T00:00:00Z' }
    expect(localPiSessionEntrySchema.safeParse({ ...base, type: 'context_edit', targetId: 'user-1', replacement: { content: 'Revised input' } }).success).toBe(true)
    expect(localPiSessionEntrySchema.safeParse({ ...base, type: 'context_edit', targetId: 'user-1', replacement: null }).success).toBe(true)
  })
})
