import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager,
  type AgentSessionEvent, type AgentSessionRuntime,
} from '@earendil-works/pi-coding-agent'
import { describe, expect, it, vi } from 'vitest'
import { dispatchRuntimeCommand } from '../../src/main/pi-host/runtime-command-dispatcher'
import { PIPILOT_RUNTIME_MESSAGE_SANITIZER_EXTENSION } from '../../src/main/pi-host/runtime-message-sanitizer'
import { installRuntimeRetryPolicy } from '../../src/main/pi-host/runtime-retry-policy'
import { localPiRpcCommandSchema } from '../../src/shared/local-pi'
import { startPiSdkFixture, type PiSdkFixture } from '../electron/pi-sdk-fixture'

describe('response retry through the installed Pi SDK', () => {
  it.each(['exhausted', 'cancelled'] as const)('continues after %s automatic retries without replaying inputs or tools', async (outcome) => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'pipilot-response-retry-')))
    const agentDir = join(root, 'agent')
    const cwd = join(root, 'project')
    const output = join(cwd, 'evidence.md')
    const prompt = 'Write once and summarize'
    const responseChunks: Record<string, { chunks: string[]; intervalMs: number }> = {
      [prompt]: { chunks: [], intervalMs: 0 },
    }
    await mkdir(cwd)
    let fixture: PiSdkFixture | undefined
    let session: Awaited<ReturnType<typeof createAgentSession>>['session'] | undefined
    try {
      let manualRetry = false
      let manualRequests = 0
      const providerBodies: Array<{ messages: Array<{ role: string; content?: unknown }> }> = []
      fixture = await startPiSdkFixture({
        agentDir, retryEnabled: true, responseChunks,
        providerFault: ({ prompt: requestedPrompt }) => {
          const faults: Record<string, { status: number; message: string }> = {
            'Invalid token setting': { status: 400, message: 'max_tokens must not exceed 500' },
            'Invalid authentication': { status: 401, message: 'Authentication failed for endpoint https://localhost:5000/v1' },
            'Invalid request guidance': { status: 400, message: 'request failed; please retry your request' },
            'Temporary overload': { status: 503, message: 'Service unavailable' },
          }
          const fault = faults[requestedPrompt]
          return fault ? { kind: 'http', ...fault } : null
        },
        writeToolPrompts: { [prompt]: { path: output, content: 'Written once.' } },
        providerToolCall: ({ body }) => {
          providerBodies.push(body as typeof providerBodies[number])
          if (manualRetry && ++manualRequests > 1) responseChunks[prompt]!.chunks = ['Recovered answer.']
          return null
        },
      })
      const settingsManager = SettingsManager.create(cwd, agentDir)
      const loader = new DefaultResourceLoader({
        cwd, agentDir, settingsManager, noExtensions: true, noSkills: true,
        noPromptTemplates: true, noThemes: true, noContextFiles: true,
        extensionFactories: [PIPILOT_RUNTIME_MESSAGE_SANITIZER_EXTENSION],
      })
      await loader.reload()
      const modelRuntime = await ModelRuntime.create({
        modelsPath: join(agentDir, 'models.json'), authPath: join(agentDir, 'auth.json'),
        modelsStorePath: join(agentDir, 'models-store.json'), allowModelNetwork: false, refreshOnCreate: false,
      })
      const created = await createAgentSession({
        cwd, agentDir, modelRuntime, model: modelRuntime.getModel('fixture', 'fake-chat'),
        tools: ['write'], thinkingLevel: 'off', settingsManager, resourceLoader: loader,
        sessionManager: SessionManager.create(cwd, join(agentDir, 'sessions')),
      })
      session = created.session
      await session.bindExtensions({ mode: 'rpc' })
      const releaseRetryPolicy = installRuntimeRetryPolicy(session)
      settingsManager.applyOverrides({ retry: { enabled: true, maxRetries: 1, baseDelayMs: outcome === 'cancelled' ? 10_000 : 1 }, compaction: { enabled: false } })
      const events: AgentSessionEvent[] = []
      session.subscribe((event) => events.push(event))
      const initialRun = session.prompt(prompt)
      if (outcome === 'cancelled') {
        await vi.waitFor(() => expect(session!.isRetrying).toBe(true))
        expect((await dispatchRuntimeCommand({ session } as AgentSessionRuntime, { type: 'abort_retry' })).response.success).toBe(true)
      }
      await initialRun

      const failureEntry = [...session.sessionManager.getBranch()].reverse().find((entry) => entry.type === 'message' && entry.message.role === 'assistant')
      if (failureEntry?.type !== 'message') throw new Error('Expected a persisted failed attempt')
      const failure = failureEntry.message
      expect(failure).toMatchObject({ role: 'assistant', stopReason: 'error', content: [] })
      expect(events).toContainEqual(expect.objectContaining({ type: 'auto_retry_start', attempt: 1, maxAttempts: 1 }))
      expect(events).toContainEqual(expect.objectContaining({ type: 'auto_retry_end', success: false, attempt: 1 }))
      expect(events.filter((event) => event.type === 'tool_execution_start')).toHaveLength(1)
      expect(await readFile(output, 'utf8')).toBe('Written once.')
      expect(session.isIdle).toBe(true)
      if (outcome === 'cancelled') {
        const modelContext = session.messages
        expect(modelContext.some((message) => message.role === 'assistant' && message.timestamp === failure.timestamp)).toBe(false)
        const snapshot = await dispatchRuntimeCommand({ session } as AgentSessionRuntime, { type: 'get_messages' })
        expect(snapshot.response).toMatchObject({
          success: true, command: 'get_messages', data: { messages: expect.arrayContaining([
            expect.objectContaining({ role: 'assistant', timestamp: failure.timestamp, stopReason: 'error' }),
          ]) },
        })
        expect(session.messages).toBe(modelContext)
        expect(session.messages.some((message) => message.role === 'assistant' && message.timestamp === failure.timestamp)).toBe(false)
      }

      manualRetry = true
      settingsManager.applyOverrides({ retry: { baseDelayMs: 1 } })
      events.length = 0
      const command = { type: 'retry_response' as const, expectedSessionId: session.sessionId, expectedTimestamp: failure.timestamp }
      const runtime = { session } as AgentSessionRuntime
      const [accepted, duplicate] = await Promise.all([
        dispatchRuntimeCommand(runtime, command),
        dispatchRuntimeCommand(runtime, command),
      ])
      expect([accepted.response, duplicate.response].filter((response) => response.success)).toHaveLength(1)
      expect([accepted.response, duplicate.response].filter((response) => !response.success)).toHaveLength(1)
      await session.waitForIdle()
      expect(events).toContainEqual(expect.objectContaining({ type: 'auto_retry_start', attempt: 1, maxAttempts: 1 }))
      expect(events).toContainEqual(expect.objectContaining({ type: 'auto_retry_end', success: true, attempt: 1 }))
      expect(events).toContainEqual({ type: 'agent_settled', aborted: false })
      expect(events.filter((event) => event.type === 'tool_execution_start')).toHaveLength(0)
      expect(session.messages.filter((message) => message.role === 'user')).toHaveLength(1)
      expect(providerBodies.every((body) => body.messages.filter((message) => message.role === 'user').length === 1)).toBe(true)
      expect(providerBodies.every((body) => !JSON.stringify(body).includes('pipilot.response-retry'))).toBe(true)
      expect(JSON.stringify(session.messages[session.messages.length - 1])).toContain('Recovered answer.')
      expect((await dispatchRuntimeCommand(runtime, command)).response.success).toBe(false)
      const raw = await readFile(session.sessionFile!, 'utf8')
      expect(raw).toContain('pipilot.response-retry')
      expect(raw).not.toContain('[Empty assistant message]')

      // Pi's loose retry regex otherwise mistakes a field value/URL port or
      // echoed retry advice for a transient HTTP status. Keep these permanent.
      for (const invalidPrompt of ['Invalid token setting', 'Invalid authentication', 'Invalid request guidance']) {
        events.length = 0
        const requestCount = fixture.requests.length
        await session.prompt(invalidPrompt)
        expect(fixture.requests.length - requestCount).toBe(1)
        expect(events.filter((event) => event.type === 'auto_retry_start')).toEqual([])
        expect(session.messages[session.messages.length - 1]).toMatchObject({ role: 'assistant', stopReason: 'error' })
        expect(settingsManager.getRetrySettings()).toMatchObject({ enabled: true, maxRetries: 1 })
      }
      events.length = 0
      const requestCount = fixture.requests.length
      await session.prompt('Temporary overload')
      expect(fixture.requests.length - requestCount).toBe(2)
      expect(events).toContainEqual(expect.objectContaining({ type: 'auto_retry_start', attempt: 1, maxAttempts: 1 }))
      releaseRetryPolicy()
    } finally {
      await session?.abort()
      session?.dispose()
      await fixture?.close()
      await rm(root, { recursive: true, force: true })
    }
  }, 30_000)

  it('refuses stale identities, older failures, queued/running work before invoking the SDK', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pipilot-retry-identity-'))
    try {
      const sendCustomMessage = vi.fn()
      const session = {
        sessionId: 'session-current', isIdle: true, pendingMessageCount: 0,
        sessionManager: { getSessionDir: () => root }, sendCustomMessage,
        messages: [{ role: 'assistant', timestamp: 200, stopReason: 'error' }],
      }
      const runtime = { session } as unknown as AgentSessionRuntime
      const command = { type: 'retry_response' as const, expectedSessionId: 'session-current', expectedTimestamp: 200 }
      expect((await dispatchRuntimeCommand(runtime, { ...command, expectedSessionId: 'old-session' })).response.success).toBe(false)
      expect((await dispatchRuntimeCommand(runtime, { ...command, expectedTimestamp: 100 })).response.success).toBe(false)
      session.isIdle = false
      expect((await dispatchRuntimeCommand(runtime, command)).response.success).toBe(false)
      session.isIdle = true
      session.pendingMessageCount = 1
      expect((await dispatchRuntimeCommand(runtime, command)).response.success).toBe(false)
      session.pendingMessageCount = 0
      expect((await dispatchRuntimeCommand(runtime, command, {
        delivery: { snapshot: () => ({ items: [{ id: 'paused-item', status: 'frozen' }] }) } as never,
      })).response.success).toBe(false)
      expect(sendCustomMessage).not.toHaveBeenCalled()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('reloads only effective retry settings while preserving project precedence and live overrides', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pipilot-retry-settings-'))
    const agentDir = join(root, 'agent')
    const cwd = join(root, 'project')
    try {
      await mkdir(agentDir)
      await mkdir(join(cwd, '.pi'), { recursive: true })
      await writeFile(join(agentDir, 'settings.json'), JSON.stringify({ retry: { enabled: true, maxRetries: 7 }, defaultModel: 'saved-model' }))
      await writeFile(join(cwd, '.pi', 'settings.json'), JSON.stringify({ retry: { maxRetries: 2 } }))
      const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted: true })
      settingsManager.applyOverrides({ defaultModel: 'active-model', retry: { enabled: false, maxRetries: 0 } })
      const runtime = { session: { settingsManager, sessionManager: { getSessionDir: () => root, getCwd: () => cwd } } } as unknown as AgentSessionRuntime
      const result = await dispatchRuntimeCommand(runtime, { type: 'set_auto_retry', reloadSettings: true }, { agentDir })
      expect(result.response.success).toBe(true)
      expect(settingsManager.getRetrySettings()).toMatchObject({ enabled: true, maxRetries: 2 })
      expect(settingsManager.getDefaultModel()).toBe('active-model')
      expect(JSON.parse(await readFile(join(agentDir, 'settings.json'), 'utf8')).retry.maxRetries).toBe(7)
      expect((await dispatchRuntimeCommand(runtime, { type: 'set_auto_retry', maxRetries: 0, enabled: false })).response.success).toBe(true)
      expect(settingsManager.getRetrySettings()).toMatchObject({ enabled: false, maxRetries: 0 })
      expect(JSON.parse(await readFile(join(agentDir, 'settings.json'), 'utf8')).retry.maxRetries).toBe(7)
      expect(localPiRpcCommandSchema.safeParse({ type: 'set_auto_retry' }).success).toBe(false)
      expect(localPiRpcCommandSchema.safeParse({ type: 'set_auto_retry', maxRetries: -1 }).success).toBe(false)
      expect(localPiRpcCommandSchema.safeParse({ type: 'set_auto_retry', maxRetries: 101 }).success).toBe(false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
