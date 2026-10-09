import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentSession } from '@earendil-works/pi-coding-agent'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RuntimeManager } from '../../src/main/pi-host/runtime-manager'
import { getGoalSnapshotFromBranch } from '../../src/shared/goal-state'
import { PI_GOAL_PACKAGE, PI_GOAL_VERSION, PI_PLAN_MODE_PACKAGE, PI_PLAN_MODE_VERSION, PI_SUBAGENTS_PACKAGE, PI_SUBAGENTS_VERSION } from '../../src/shared/pi-package-adapters'
import { parsePlanCompletionDetails, projectPlanMode } from '../../src/renderer/pi-rpc/adapters/plan-mode'
import { createLocalPiProjectorState } from '../../src/renderer/pi-rpc/projector'
import { startPiSdkFixture } from '../electron/pi-sdk-fixture'

// Opt in with an isolated npm prefix containing the published pinned packages:
// PIPILOT_PLUGIN_SMOKE_ROOT=/temporary/prefix/node_modules pnpm exec vitest run tests/unit/real-plugin-runtime-sdk.test.ts
// No real Pi profile or network is used by this suite; only the provider is mocked.
const pluginRoot = process.env.PIPILOT_PLUGIN_SMOKE_ROOT
const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose()
  vi.unstubAllEnvs()
})

type ToolReply = { id: string; name: string; arguments: Record<string, unknown> } | null
async function runtime(reply: (request: { prompt: string; body: unknown }, session: () => AgentSession) => ToolReply) {
  const root = await mkdtemp(join(tmpdir(), 'pipilot-real-plugins-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const agentDir = join(root, 'agent')
  const cwd = join(root, 'project')
  await Promise.all([mkdir(agentDir), mkdir(cwd)])
  vi.stubEnv('PI_CODING_AGENT_DIR', agentDir)
  const extensions: string[] = []
  for (const [name, version] of [[PI_PLAN_MODE_PACKAGE, PI_PLAN_MODE_VERSION], [PI_GOAL_PACKAGE, PI_GOAL_VERSION], [PI_SUBAGENTS_PACKAGE, PI_SUBAGENTS_VERSION]]) {
    const packageDir = join(pluginRoot!, name!)
    const manifest = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8')) as { version: string; pi: { extensions: string[] } }
    expect(manifest.version).toBe(version)
    extensions.push(...manifest.pi.extensions.map((path) => join(packageDir, path)))
  }
  let session!: AgentSession
  const provider = await startPiSdkFixture({ agentDir, providerToolCall: (request) => reply(request, () => session) })
  cleanup.push(() => provider.close())
  const manager = new RuntimeManager({ cwd, agentDir, resourceLoaderOptions: {
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    additionalExtensionPaths: extensions,
  } })
  cleanup.push(() => manager.dispose())
  manager.subscribeUiRequests(({ request, runtimeId, generation }) => {
    if (request.method !== 'select') return
    const stay = request.options.find((option) => option.includes('Stay in Plan mode'))
    manager.respondToExtensionUi({ type: 'extension_ui_response', id: request.id, ...(stay ? { value: stay } : { cancelled: true }) }, runtimeId, generation)
  })
  const created = await manager.create({ runtimeId: 'plugins', sessionDir: join(root, 'sessions') })
  await manager.bindRuntime(created.runtimeId, created.generation)
  const runtimes = Reflect.get(manager, 'runtimes') as Map<string, { runtime: { session: AgentSession } }>
  session = runtimes.get(created.runtimeId)!.runtime.session
  const branch = () => session.sessionManager.getBranch()
  const goal = () => getGoalSnapshotFromBranch(branch())
  const plan = () => {
    const entry = branch().reverse().find((entry) => entry.type === 'custom' && entry.customType === 'plan-mode-state')
    return entry?.type === 'custom' ? entry.data as { enabled: boolean; latestPlan?: string; savedPlan?: { plan: string }; activeImplementation?: { plan: string } } : undefined
  }
  return { session, manager, provider, cwd, branch, goal, plan }
}

describe.skipIf(!pluginRoot)('published recommended plugins on the bundled Pi SDK', () => {
  it('loads all three packages and delegates Plan read-only, completion, save, handoff, and clear to the real plugin', async () => {
    let planningCalls = 0
    let implementing = false
    const fixture = await runtime(() => {
      if (implementing) return null
      planningCalls += 1
      return planningCalls === 1
        ? { id: 'denied-write', name: 'bash', arguments: { command: 'printf unsafe > denied.txt' } }
        : { id: 'ready-plan', name: 'plan_mode_complete', arguments: { plan: '# Verified plan\n\n1. Implement the scoped change.\n2. Run the focused tests.' } }
    })
    const commands = await fixture.manager.command('plugins', { type: 'get_commands' })
    expect(commands.response).toMatchObject({ success: true, data: { commands: expect.arrayContaining([
      expect.objectContaining({ name: 'plan' }), expect.objectContaining({ name: 'goal' }),
    ]) } })
    expect(fixture.session.agent.state.tools.some((tool) => tool.name === 'subagent')).toBe(true)
    await fixture.session.prompt('/plan start', { source: 'rpc' })
    expect(fixture.plan()).toMatchObject({ enabled: true })
    await fixture.session.prompt('/goal This cannot own the active Plan workflow.', { source: 'rpc' })
    expect(fixture.goal()).toBeUndefined()
    expect(fixture.provider.prompts).toHaveLength(0)
    await fixture.session.prompt('Prepare a plan and verify the read-only boundary.', { source: 'rpc' })
    expect(fixture.plan()?.latestPlan).toContain('# Verified plan')
    await expect(access(join(fixture.cwd, 'denied.txt'))).rejects.toThrow()
    const denied = fixture.session.messages.find((message) => message.role === 'toolResult' && message.toolCallId === 'denied-write')
    expect(denied).toMatchObject({ role: 'toolResult', isError: true })
    const completion = fixture.session.messages.find((message) => message.role === 'toolResult' && message.toolName === 'plan_mode_complete')
    expect(completion?.role === 'toolResult' && parsePlanCompletionDetails(completion.details)?.plan).toContain('# Verified plan')
    await fixture.session.prompt('/plan save', { source: 'rpc' })
    expect(fixture.plan()).toMatchObject({ enabled: false, savedPlan: { plan: expect.stringContaining('# Verified plan') } })
    await fixture.manager.reloadRuntime('plugins')
    expect(fixture.plan()).toMatchObject({ enabled: false, savedPlan: { plan: expect.stringContaining('# Verified plan') } })
    expect(fixture.provider.prompts).toHaveLength(2)
    implementing = true
    await fixture.session.prompt('/plan implement', { source: 'rpc' })
    await vi.waitFor(() => expect(fixture.session.isIdle).toBe(true), { timeout: 10_000 })
    // The published default clears the reinjection state at handoff and puts
    // the approved plan into the implementation prompt's ordinary history.
    await vi.waitFor(() => expect(fixture.provider.prompts.length).toBeGreaterThan(2), { timeout: 10_000 })
    expect(fixture.plan()?.activeImplementation).toBeUndefined()
    expect(fixture.plan()?.savedPlan).toBeUndefined()
    expect(fixture.provider.prompts[fixture.provider.prompts.length - 1]).toContain('# Verified plan')
    expect(fixture.goal()).toBeUndefined()
    await fixture.session.prompt('/plan exit', { source: 'rpc' })
    expect(fixture.plan()).toMatchObject({ enabled: false })
    expect(fixture.plan()?.activeImplementation).toBeUndefined()
  }, 30_000)

  it('lets Goal continue, wait, pause, resume, and complete without any PiPilot continuation', async () => {
    let calls = 0
    let complete = false
    const fixture = await runtime((_request, getSession) => {
      calls += 1
      const goal = getGoalSnapshotFromBranch(getSession().sessionManager.getBranch())
      if (complete) return { id: 'goal-done', name: 'goal_complete', arguments: { goal_id: goal!.id, summary: 'Verified all requested acceptance checks.' } }
      if (calls === 1) return null
      return { id: 'goal-wait', name: 'goal_wait', arguments: { goal_id: goal!.id, reason: 'Waiting for isolated fixture acceptance', resume_after_ms: 60_000 } }
    })
    await fixture.session.prompt('/goal --tokens 10000 Complete the isolated acceptance checks.', { source: 'rpc' })
    await vi.waitFor(() => expect(fixture.goal()?.waiting).toBeDefined(), { timeout: 10_000 })
    await vi.waitFor(() => expect(fixture.session.isIdle).toBe(true), { timeout: 10_000 })
    expect(fixture.provider.prompts.length).toBeGreaterThanOrEqual(2)
    expect(fixture.goal()).toMatchObject({ status: 'active', tokenBudget: 10_000 })
    await fixture.session.prompt('/goal pause', { source: 'rpc' })
    expect(fixture.goal()?.status).toBe('paused')
    const pausedRequests = fixture.provider.prompts.length
    await fixture.manager.reloadRuntime('plugins')
    expect(fixture.goal()?.status).toBe('paused')
    expect(fixture.provider.prompts).toHaveLength(pausedRequests)
    complete = true
    await fixture.session.prompt('/goal resume', { source: 'rpc' })
    await vi.waitFor(() => expect(fixture.goal()).toBeNull(), { timeout: 10_000 })
    await vi.waitFor(() => expect(fixture.session.isIdle).toBe(true), { timeout: 10_000 })
    expect(fixture.branch()).toContainEqual(expect.objectContaining({ type: 'custom', customType: 'goal-state', data: expect.objectContaining({ goal: expect.objectContaining({ status: 'complete' }) }) }))
    expect(fixture.branch().some((entry) => entry.type === 'custom_message' && entry.customType === 'pipilot.plan-continuation')).toBe(false)
  }, 30_000)

  it('lets Goal enforce its real token budget and refuses an exhausted resume', async () => {
    const fixture = await runtime(() => null)
    await fixture.session.prompt('/goal --tokens 1 Check the isolated token budget.', { source: 'rpc' })
    await vi.waitFor(() => expect(fixture.goal()?.status).toBe('budget_limited'), { timeout: 10_000 })
    await vi.waitFor(() => expect(fixture.session.isIdle).toBe(true), { timeout: 10_000 })
    const requests = fixture.provider.prompts.length
    expect(fixture.goal()!.tokensUsed).toBeGreaterThanOrEqual(1)
    await fixture.session.prompt('/goal resume', { source: 'rpc' })
    expect(fixture.goal()?.status).toBe('budget_limited')
    expect(fixture.provider.prompts).toHaveLength(requests)
  }, 30_000)

  it('treats the SDK Stop action as a paused Goal with no queued continuation', async () => {
    const fixture = await runtime(() => null)
    let stopped = false
    fixture.session.subscribe((event) => {
      if (event.type !== 'message_update' || stopped) return
      stopped = true
      void fixture.session.abort()
    })
    await fixture.session.prompt('/goal --tokens 10000 Exercise explicit Stop.', { source: 'rpc' })
    await vi.waitFor(() => expect(fixture.goal()?.status).toBe('paused'), { timeout: 10_000 })
    await vi.waitFor(() => expect(fixture.session.isIdle).toBe(true), { timeout: 10_000 })
    expect(stopped).toBe(true)
    expect(fixture.session.pendingMessageCount).toBe(0)
    expect(fixture.provider.prompts).toHaveLength(1)
    await fixture.session.prompt('/goal clear', { source: 'rpc' })
    expect(fixture.goal()).toBeNull()
  }, 30_000)

  it('guards GUI handoff while a Goal is unfinished and records the raw plugin command limitation', async () => {
    let phase: 'plan' | 'goal' | 'implement' = 'plan'
    const fixture = await runtime((_request, getSession) => {
      if (phase === 'plan') return { id: 'saved-plan', name: 'plan_mode_complete', arguments: { plan: '# Saved workflow\n\nImplement only after Goal releases ownership.' } }
      if (phase === 'goal') {
        const goal = getGoalSnapshotFromBranch(getSession().sessionManager.getBranch())!
        return { id: 'owned-goal', name: 'goal_wait', arguments: { goal_id: goal.id, reason: 'Holding the current Goal workflow', resume_after_ms: 60_000 } }
      }
      return null
    })
    await fixture.session.prompt('/plan start', { source: 'rpc' })
    await fixture.session.prompt('Prepare a saved plan.', { source: 'rpc' })
    await fixture.session.prompt('/plan save', { source: 'rpc' })
    phase = 'goal'
    await fixture.session.prompt('/goal Complete the other explicitly requested objective.', { source: 'rpc' })
    await vi.waitFor(() => expect(fixture.goal()?.waiting).toBeDefined(), { timeout: 10_000 })
    await vi.waitFor(() => expect(fixture.session.isIdle).toBe(true), { timeout: 10_000 })
    const requests = fixture.provider.prompts.length
    const { response, runtime: descriptor } = await fixture.manager.command('plugins', { type: 'get_entries' })
    if (!response.success || response.command !== 'get_entries') throw new Error('Missing official entry snapshot')
    const projection = projectPlanMode(createLocalPiProjectorState({
      generation: descriptor.generation, sessionId: descriptor.sessionId,
      entrySnapshot: { generation: descriptor.generation, sessionId: descriptor.sessionId, cursor: null, ...response.data },
    }), {
      id: 'plan-mode', packageName: PI_PLAN_MODE_PACKAGE, version: PI_PLAN_MODE_VERSION,
      packageSource: `npm:${PI_PLAN_MODE_PACKAGE}@${PI_PLAN_MODE_VERSION}`,
      commandSource: `npm:${PI_PLAN_MODE_PACKAGE}@${PI_PLAN_MODE_VERSION}`, commandScope: 'user', commandName: 'plan',
    }, { scopeKey: 'isolated-smoke' })
    expect(projection?.actions).toEqual(['show', 'exit', 'export'])
    expect(fixture.provider.prompts).toHaveLength(requests)
    // Upstream 0.58.3 authenticates a saved handoff but does not acquire its
    // workflow mutex. Raw slash commands retain that published behavior.
    await fixture.session.prompt('/plan implement', { source: 'rpc' })
    await vi.waitFor(() => expect(fixture.provider.prompts.length).toBeGreaterThan(requests), { timeout: 10_000 })
    await vi.waitFor(() => expect(fixture.session.isIdle).toBe(true), { timeout: 10_000 })
    expect(fixture.plan()?.savedPlan).toBeUndefined()
    expect(fixture.goal()?.status).toBe('active')
    expect(fixture.goal()?.text).toBe('Complete the other explicitly requested objective.')
    await fixture.session.prompt('/goal clear', { source: 'rpc' })
  }, 30_000)
})
