import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentSession } from '@earendil-works/pi-coding-agent'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RuntimeManager } from '../../src/main/pi-host/runtime-manager'
import { CONVERSATION_TASK_CUSTOM_TYPE, CONVERSATION_TASK_TOOL_NAME, getConversationTaskSnapshotFromBranch } from '../../src/shared/conversation-task'
import { startPiSdkFixture } from '../electron/pi-sdk-fixture'

const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose()
  vi.unstubAllEnvs()
})

describe('conversation overview official SDK integration', () => {
  it('persists branch metadata without registering commands or scheduling additional model turns', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pipilot-task-sdk-'))
    cleanup.push(() => rm(root, { recursive: true, force: true }))
    const agentDir = join(root, 'agent')
    const cwd = join(root, 'project')
    await Promise.all([mkdir(agentDir), mkdir(cwd)])
    vi.stubEnv('PI_CODING_AGENT_DIR', agentDir)
    const provider = await startPiSdkFixture({ agentDir })
    cleanup.push(() => provider.close())
    const manager = new RuntimeManager({
      cwd, agentDir,
      resourceLoaderOptions: { noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true },
    })
    cleanup.push(() => manager.dispose())
    const created = await manager.create({ runtimeId: 'task-runtime', sessionDir: join(root, 'sessions') })
    await manager.bindRuntime(created.runtimeId, created.generation)
    const runtimes = Reflect.get(manager, 'runtimes') as Map<string, { runtime: { session: AgentSession } }>
    const session = runtimes.get(created.runtimeId)!.runtime.session
    const commands = await manager.command(created.runtimeId, { type: 'get_commands' })
    expect(JSON.stringify(commands.response)).not.toContain('pipilot-plan')
    const tool = session.agent.state.tools.find((candidate) => candidate.name === CONVERSATION_TASK_TOOL_NAME)!
    expect(tool).toBeDefined()
    session.sessionManager.appendCustomEntry(CONVERSATION_TASK_CUSTOM_TYPE, {
      version: 1, updatedAt: 1, summary: 'Historical summary', blockers: [], nextActions: [],
      plan: { id: 'old', status: 'running', approvedAt: 1, steps: [] },
    })
    await session.prompt('Check the overview metadata', { source: 'rpc' })
    expect(provider.prompts).toHaveLength(1)
    expect(session.isIdle).toBe(true)
    await tool.execute('overview', { summary: 'Verified metadata only', blockers: [], nextActions: [] })
    expect(getConversationTaskSnapshotFromBranch(session.sessionManager.getBranch())).toMatchObject({
      version: 2, summary: 'Verified metadata only', blockers: [], nextActions: [],
    })
    expect(session.sessionManager.getBranch().some((entry) => entry.type === 'custom_message' && entry.customType === 'pipilot.plan-continuation')).toBe(false)
  }, 20_000)
})
