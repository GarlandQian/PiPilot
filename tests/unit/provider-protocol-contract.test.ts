import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAgentSession, ModelRuntime, SessionManager, type AgentSessionEvent } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'
import { startPiSdkFixture, type PiSdkFixture } from '../electron/pi-sdk-fixture'
import { FIXTURE_PROVIDER_PROTOCOLS } from '../electron/pi-sdk-fixture-protocols'
import { projectRuntimeEvent } from '../../src/main/pi-host/runtime-event-projector'

describe('installed Pi SDK provider contracts', () => {
  it.each(FIXTURE_PROVIDER_PROTOCOLS)('%s streams, executes a real write, consumes the tool result, and accepts the next prompt', async (protocol) => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'pipilot-provider-contract-')))
    const agentDir = join(root, 'agent')
    const cwd = join(root, 'project')
    const output = join(cwd, 'evidence.md')
    const prompt = 'Write the protocol evidence'
    const content = `# ${protocol}\n\nExecuted by the real installed Pi SDK.\n`
    await mkdir(cwd)
    let fixture: PiSdkFixture | undefined
    let session: Awaited<ReturnType<typeof createAgentSession>>['session'] | undefined
    try {
      fixture = await startPiSdkFixture({
        agentDir,
        protocol,
        writeToolPrompts: { [prompt]: { path: output, content } },
        writeToolCommentary: { [prompt]: { text: 'Writing the evidence now.', delayMs: 0 } },
      })
      // Explicit paths prevent any access to the developer's real Pi resources.
      // Static custom models do not require a model catalog network refresh.
      const modelRuntime = await ModelRuntime.create({
        modelsPath: join(agentDir, 'models.json'),
        authPath: join(agentDir, 'auth.json'),
        modelsStorePath: join(agentDir, 'models-store.json'),
        allowModelNetwork: false,
        refreshOnCreate: false,
      })
      const model = modelRuntime.getModel('fixture', 'fake-chat')
      expect(model, modelRuntime.getError()).toBeDefined()
      const created = await createAgentSession({
        cwd, agentDir, modelRuntime, model, tools: ['write'], thinkingLevel: 'off',
        sessionManager: SessionManager.create(cwd, join(agentDir, 'sessions')),
      })
      session = created.session
      const events: AgentSessionEvent[] = []
      const projectionFailures: string[] = []
      session.subscribe((event) => {
        events.push(event)
        try { projectRuntimeEvent(event) } catch (error) {
          projectionFailures.push(`${event.type}: ${error instanceof Error ? error.message : String(error)}`)
        }
      })
      await session.prompt(prompt)

      expect(session.messages.filter((message) => message.role === 'assistant' && message.stopReason === 'error')
        .map((message) => message.role === 'assistant' ? message.errorMessage : '')).toEqual([])
      expect(projectionFailures).toEqual([])
      expect(await readFile(output, 'utf8')).toBe(content)
      expect(fixture.requests.filter((request) => request.prompt === prompt).map((request) => request.hasWriteResult))
        .toEqual([false, true])
      expect(events.some((event) => event.type === 'tool_execution_start' && event.toolName === 'write')).toBe(true)
      expect(events.some((event) => event.type === 'tool_execution_end' && event.isError === false)).toBe(true)
      expect(events.some((event) => event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta')).toBe(true)
      expect(events.some((event) => event.type === 'message_update' && event.assistantMessageEvent.type === 'toolcall_delta')).toBe(true)
      expect(session.messages.filter((message) => message.role === 'assistant').every((message) => (
        message.stopReason === 'stop' || message.stopReason === 'toolUse'
      ))).toBe(true)
      const answer = session.messages[session.messages.length - 1]
      expect(answer?.role).toBe('assistant')
      expect(answer && 'content' in answer ? JSON.stringify(answer.content) : '').toContain(`Fixture response: ${prompt}`)

      await session.prompt('Continue after the tool result')
      expect(fixture.prompts[fixture.prompts.length - 1]).toBe('Continue after the tool result')
      expect(JSON.stringify(session.messages[session.messages.length - 1])).toContain('Fixture response: Continue after the tool result')
      expect(session.isStreaming).toBe(false)
      expect(projectionFailures).toEqual([])
    } finally {
      await session?.abort()
      session?.dispose()
      await fixture?.close()
      await rm(root, { recursive: true, force: true })
    }
  }, 30_000)
})
