import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  AgentSessionEvent,
  AgentSession,
  ContextEvent,
  CreateAgentSessionServicesOptions,
  InlineExtension,
} from '@earendil-works/pi-coding-agent'
import {
  RuntimeManager,
} from '../../src/main/pi-host/runtime-manager'
import { PIPILOT_RUNTIME_MESSAGE_SANITIZER_EXTENSION_NAME } from '../../src/main/pi-host/runtime-message-sanitizer'
import { PIPILOT_CONVERSATION_TASK_EXTENSION_PATH } from '../../src/main/pi-host/runtime-conversation-task'

const managers = new Set<RuntimeManager>()
const roots = new Set<string>()

afterEach(async () => {
  await Promise.allSettled([...managers].map((manager) => manager.dispose()))
  managers.clear()
  await Promise.all([...roots].map((root) => rm(root, {
    recursive: true,
    force: true,
  })))
  roots.clear()
})

async function createFixture(
  extensionFactories: InlineExtension[] = [],
  extensionsOverride?: NonNullable<
    CreateAgentSessionServicesOptions['resourceLoaderOptions']
  >['extensionsOverride'],
) {
  const root = await mkdtemp(join(tmpdir(), 'pipilot-sdk-runtime-'))
  roots.add(root)
  const cwd = join(root, 'project')
  const agentDir = join(root, 'agent')
  const sessionDir = join(root, 'sessions')
  await Promise.all([
    mkdir(cwd, { recursive: true }),
    mkdir(agentDir, { recursive: true }),
    mkdir(sessionDir, { recursive: true }),
  ])
  const manager = new RuntimeManager({
    cwd,
    agentDir,
    operationTimeoutMs: 10_000,
    resourceLoaderOptions: {
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      extensionFactories,
      extensionsOverride,
    },
  })
  managers.add(manager)
  return { root, cwd, agentDir, sessionDir, manager }
}

function emitSessionEvent(
  manager: RuntimeManager,
  runtimeId: string,
  event: AgentSessionEvent,
): void {
  const runtimes = Reflect.get(manager, 'runtimes') as Map<string, {
    runtime: {
      session: { _emit(event: AgentSessionEvent): void }
    }
  }>
  const runtime = runtimes.get(runtimeId)
  if (!runtime) throw new Error(`Missing fixture Runtime: ${runtimeId}`)
  runtime.runtime.session._emit(event)
}

describe('Pi Host RuntimeManager', () => {
  it('reuses a completed import identity after a lost response without duplicating file or history', async () => {
    const { manager, sessionDir } = await createFixture()
    const importHistory = { importId: 'a24daef3-ac83-43c4-9d56-d926cfe693bf', title: 'Import retry', messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'Only one historical message' }] }] }
    const first = await manager.create({ runtimeId: 'rt_import_first', sessionDir, importHistory })
    expect(first.sessionId).toBe(importHistory.importId)
    await manager.disposeRuntime(first.runtimeId, first.generation)
    const second = await manager.create({ runtimeId: 'rt_import_retry', sessionDir, importHistory })
    expect(second.sessionId).toBe(first.sessionId)
    expect(second.sessionFile).toBe(first.sessionFile)
    expect((await readdir(sessionDir)).filter((name) => name.endsWith('.jsonl'))).toHaveLength(1)
    expect((await readFile(second.sessionFile!, 'utf8')).match(/Only one historical message/gu)).toHaveLength(1)
  })

  it('does not write imported history when SDK resource initialization fails', async () => {
    const { manager, sessionDir } = await createFixture([], () => { throw new Error('Fixture resource failure') })
    await expect(manager.create({ runtimeId: 'rt_import_resource_fail', sessionDir, importHistory: { title: 'Never persisted', messages: [{ role: 'user', content: [{ type: 'text', text: 'Document' }] }] } })).rejects.toThrow('Fixture resource failure')
    expect((await readdir(sessionDir)).filter((name) => name.endsWith('.jsonl'))).toEqual([])
  })

  it('creates imported history as a fresh idle SDK Runtime without replaying old inputs or tools', async () => {
    const seenInputs: string[] = []
    const { manager, sessionDir } = await createFixture([{ name: 'watch-import-input', factory: (pi) => {
      pi.on('input', async (event) => { seenInputs.push(event.text); return { action: 'continue' } })
    } }])
    const original = await manager.create({ runtimeId: 'rt_original_import', sessionDir })
    await manager.bindRuntime(original.runtimeId, original.generation)
    const imported = await manager.create({ runtimeId: 'rt_imported_history', sessionDir, importHistory: {
      title: 'Imported conversation', messages: [
        { role: 'user', content: [{ type: 'text', text: '/pipilot-plan approve old-plan' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'Historical answer' }] },
        { role: 'context', content: [{ type: 'text', text: 'Historical tool: bash\nDo not run this' }] },
      ],
    } })
    await manager.bindRuntime(imported.runtimeId, imported.generation)
    expect(imported.sessionId).not.toBe(original.sessionId)
    expect(imported.sessionFile).not.toBe(original.sessionFile)
    expect(seenInputs).toEqual([])
    const state = await manager.command(imported.runtimeId, { type: 'get_state' })
    expect(state.response).toMatchObject({ success: true, data: { sessionId: imported.sessionId, isStreaming: false, pendingMessageCount: 0, sessionName: 'Imported conversation' } })
    const messages = await manager.command(imported.runtimeId, { type: 'get_messages' })
    expect(messages.response).toMatchObject({ success: true, data: { messages: [
      expect.objectContaining({ role: 'user', content: [{ type: 'text', text: '/pipilot-plan approve old-plan' }] }),
      expect.objectContaining({ role: 'assistant', provider: 'pipilot-import', model: 'markdown-import' }),
      expect.objectContaining({ role: 'custom', customType: 'pipilot.imported-context' }),
    ] } })
    const originalState = await manager.command(original.runtimeId, { type: 'get_state' })
    expect(originalState.response).toMatchObject({ success: true, data: { sessionId: original.sessionId, messageCount: 0 } })
    const raw = await readFile(imported.sessionFile!, 'utf8')
    expect(raw).not.toContain('pipilot.task-state')
  })

  it('awaits SDK input hooks when promoting a managed follow-up and preserves its image identity', async () => {
    const sources: string[] = []
    const { manager, sessionDir } = await createFixture([{ name: 'async-input-transform', factory: (pi) => {
      pi.on('input', async (event) => {
        sources.push(event.source)
        await Promise.resolve()
        return { action: 'transform', text: `transformed: ${event.text}`, images: event.images }
      })
    } }])
    const created = await manager.create({ runtimeId: 'rt_async_promote', sessionDir })
    await manager.bindRuntime(created.runtimeId, created.generation)
    const entries = Reflect.get(manager, 'runtimes') as Map<string, { runtime: { session: AgentSession } }>
    const session = entries.get(created.runtimeId)!.runtime.session
    vi.spyOn(session, 'isStreaming', 'get').mockReturnValue(true)
    const steer = vi.spyOn(session.agent, 'steer')
    const images = [{ type: 'image' as const, data: 'cGl4ZWw=', mimeType: 'image/png' }]
    const queued = await manager.command(created.runtimeId, {
      type: 'submit_message', submissionId: 'async-image', message: 'original', images, mode: 'auto',
    })
    if (!queued.response.success || queued.response.command !== 'submit_message') throw new Error('Queue submission failed')
    expect(sources).toEqual([])
    const promoted = await manager.command(created.runtimeId, {
      type: 'mutate_delivery', itemId: queued.response.data.receipt.itemId!,
      revision: queued.response.data.delivery.revision, action: 'promote',
    })
    expect(promoted.response.success).toBe(true)
    expect(sources).toEqual(['rpc'])
    expect(session.getSteeringMessages()).toEqual(['transformed: original'])
    const native = steer.mock.calls[0]![0]
    expect(native).toMatchObject({ role: 'user', content: [
      { type: 'text', text: 'transformed: original' }, ...images,
    ] })
    emitSessionEvent(manager, created.runtimeId, { type: 'message_start', message: native })
    const delivered = await manager.command(created.runtimeId, { type: 'get_delivery_state' })
    expect(delivered.response).toMatchObject({ success: true, data: { items: [], receipts: [{ status: 'consumed' }] } })
  })

  it('treats an SDK handled steering input as consumed without creating a phantom pending message', async () => {
    const { manager, sessionDir } = await createFixture([{ name: 'async-input-handled', factory: (pi) => {
      pi.on('input', async () => { await Promise.resolve(); return { action: 'handled' } })
    } }])
    const created = await manager.create({ runtimeId: 'rt_async_handled', sessionDir })
    await manager.bindRuntime(created.runtimeId, created.generation)
    const entries = Reflect.get(manager, 'runtimes') as Map<string, { runtime: { session: AgentSession } }>
    const session = entries.get(created.runtimeId)!.runtime.session
    vi.spyOn(session, 'isStreaming', 'get').mockReturnValue(true)
    const steer = vi.spyOn(session.agent, 'steer')
    const result = await manager.command(created.runtimeId, {
      type: 'submit_message', submissionId: 'handled-input', message: 'Handled by extension', mode: 'steer',
    })
    expect(result.response).toMatchObject({ success: true, data: { receipt: { status: 'consumed' }, delivery: { items: [] } } })
    expect(steer).not.toHaveBeenCalled()
    expect(session.getSteeringMessages()).toEqual([])
  })

  it('prevents a real SDK input hook from queueing steering after Stop returned', async () => {
    let release!: () => void
    let entered = false
    const gate = new Promise<void>((resolve) => { release = resolve })
    const { manager, sessionDir } = await createFixture([{ name: 'async-input-blocked', factory: (pi) => {
      pi.on('input', async () => { entered = true; await gate; return { action: 'continue' } })
    } }])
    const created = await manager.create({ runtimeId: 'rt_async_stop', sessionDir })
    await manager.bindRuntime(created.runtimeId, created.generation)
    const entries = Reflect.get(manager, 'runtimes') as Map<string, { runtime: { session: AgentSession } }>
    const session = entries.get(created.runtimeId)!.runtime.session
    const streaming = vi.spyOn(session, 'isStreaming', 'get').mockReturnValue(true)
    const steer = vi.spyOn(session.agent, 'steer')
    const images = [{ type: 'image' as const, data: 'cGl4ZWw=', mimeType: 'image/png' }]
    const pending = manager.command(created.runtimeId, {
      type: 'submit_message', submissionId: 'blocked-input', message: 'Keep this message', images, mode: 'steer',
    })
    try {
      await vi.waitFor(() => expect(entered).toBe(true))
      const stopped = await manager.command(created.runtimeId, { type: 'abort' })
      expect(stopped.response.success).toBe(true)
      streaming.mockReturnValue(false)
      release()
      expect((await pending).response.success).toBe(false)
      expect(steer).not.toHaveBeenCalled()
      expect(session.getSteeringMessages()).toEqual([])
      const snapshot = await manager.command(created.runtimeId, { type: 'get_delivery_state' })
      expect(snapshot.response).toMatchObject({ success: true, data: {
        paused: true, items: [{ status: 'frozen', message: 'Keep this message', images }],
      } })
    } finally {
      release()
      await pending
    }
  })

  it('loads the hidden PiPilot sanitizer after caller extensions', async () => {
    const callerExtension: InlineExtension = {
      name: 'fixture-caller-extension',
      factory: (pi) => {
        pi.on('context', (event) => ({
          messages: event.messages.map((message) => (
            message.role === 'user' && Array.isArray(message.content)
              ? {
                  ...message,
                  content: [
                    ...message.content,
                    { type: 'text' as const, text: '' },
                  ],
                }
              : message
          )),
        }))
      },
    }
    const { manager, sessionDir } = await createFixture(
      [callerExtension],
      (base) => ({ ...base, extensions: [...base.extensions].reverse() }),
    )
    const created = await manager.create({
      runtimeId: 'rt_sanitizer_extension',
      sessionDir,
    })
    const runtimes = Reflect.get(manager, 'runtimes') as Map<string, {
      runtime: {
        session: {
          extensionRunner: {
            emitContext(messages: ContextEvent['messages']): Promise<ContextEvent['messages']>
          }
        }
        services: {
          resourceLoader: {
            getExtensions(): {
              extensions: Array<{ path: string; hidden?: boolean }>
            }
          }
        }
      }
    }>
    const runtime = runtimes.get(created.runtimeId)?.runtime
    const extensions = runtime?.services
      .resourceLoader.getExtensions().extensions

    expect(extensions).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '<inline:fixture-caller-extension>' }),
      expect.objectContaining({ path: PIPILOT_CONVERSATION_TASK_EXTENSION_PATH, hidden: true }),
    ]))
    expect(extensions?.[extensions.length - 1]).toMatchObject({
      path: `<inline:${PIPILOT_RUNTIME_MESSAGE_SANITIZER_EXTENSION_NAME}>`,
      hidden: true,
    })
    await expect(runtime?.session.extensionRunner.emitContext([{
      role: 'user',
      content: [{ type: 'image', data: 'aW1hZ2U=', mimeType: 'image/png' }],
      timestamp: 1,
    }])).resolves.toEqual([{
      role: 'user',
      content: [{ type: 'image', data: 'aW1hZ2U=', mimeType: 'image/png' }],
      timestamp: 1,
    }])
  })

  it('creates an isolated public-SDK runtime and projects the proof commands', async () => {
    const { manager, cwd, sessionDir } = await createFixture()
    const created = await manager.create({
      runtimeId: 'rt_primary',
      sessionDir,
    })

    expect(created).toMatchObject({
      runtimeId: 'rt_primary',
      generation: 1,
      cwd,
    })
    expect(created.sessionFile).toContain(sessionDir)
    await expect(manager.command('rt_primary', { type: 'get_state' }))
      .rejects.toMatchObject({ code: 'RUNTIME_NOT_BOUND' })
    await manager.bindRuntime(created.runtimeId, created.generation)

    const state = await manager.command('rt_primary', { type: 'get_state' })
    expect(state.response).toMatchObject({
      type: 'response',
      command: 'get_state',
      success: true,
      data: {
        sessionId: created.sessionId,
        messageCount: 0,
        pendingMessageCount: 0,
      },
    })
    const messages = await manager.command('rt_primary', {
      type: 'get_messages',
    })
    expect(messages.response).toMatchObject({
      command: 'get_messages',
      success: true,
      data: { messages: [], live: { message: null, isStreaming: false, sequence: 0 } },
    })
    const commands = await manager.command('rt_primary', {
      type: 'get_commands',
    })
    expect(commands.response).toMatchObject({
      command: 'get_commands',
      success: true,
      data: { commands: [] },
    })
  })

  it('keeps projection defects Runtime-scoped and continues with later valid events', async () => {
    const { manager, sessionDir } = await createFixture()
    const events: Array<{ event: { type: string; code?: string } }> = []
    const fatalErrors: unknown[] = []
    manager.subscribeEvents((record) => events.push(record))
    manager.subscribeFatalErrors((error) => fatalErrors.push(error))
    const created = await manager.create({
      runtimeId: 'rt_projection_boundary',
      sessionDir,
    })

    emitSessionEvent(manager, created.runtimeId, {
      type: 'tool_execution_end',
      toolCallId: 'call-malformed',
      toolName: 'write',
      result: { details: undefined },
      isError: false,
    } as AgentSessionEvent)
    emitSessionEvent(manager, created.runtimeId, { type: 'agent_start' })

    expect(fatalErrors).toEqual([])
    expect(events.map(({ event }) => event)).toEqual([
      {
        type: 'runtime_diagnostic',
        code: 'RUNTIME_EVENT_PROJECTION_FAILED',
      },
      { type: 'agent_start' },
    ])
  })

  it('hydrates a running public SDK thinking message at the recorded Host event boundary', async () => {
    let releaseDelta!: () => void
    const deltaGate = new Promise<void>((resolve) => { releaseDelta = resolve })
    let deltaBlocked = false
    let releaseFinal!: () => void
    const finalGate = new Promise<void>((resolve) => { releaseFinal = resolve })
    let finalBlocked = false
    const { manager, agentDir, sessionDir } = await createFixture([{
      name: 'fixture-delayed-thinking',
      factory: (pi) => {
        pi.on('message_update', async (event) => {
          if (event.assistantMessageEvent.type === 'thinking_delta' &&
            event.assistantMessageEvent.delta === ' the solution') {
            deltaBlocked = true
            await deltaGate
          }
        })
        pi.on('message_end', async (event) => {
          if (event.message.role === 'assistant') {
            finalBlocked = true
            await finalGate
          }
        })
      },
    }])
    await writeFile(join(agentDir, 'models.json'), JSON.stringify({ providers: {
      'fixture-stream': {
        baseUrl: 'https://fixture.invalid/v1', api: 'openai-completions', apiKey: 'fixture-no-network',
        models: [{ id: 'stream-model', reasoning: true }],
      },
    } }))
    const created = await manager.create({ runtimeId: 'rt_live_thinking', sessionDir })
    await manager.bindRuntime(created.runtimeId, created.generation)
    await manager.command(created.runtimeId, { type: 'set_model', provider: 'fixture-stream', modelId: 'stream-model' })
    const runtimes = Reflect.get(manager, 'runtimes') as Map<string, { runtime: { session: AgentSession } }>
    const session = runtimes.get(created.runtimeId)!.runtime.session
    const events: Array<{ sequence: number; event: { type: string } }> = []
    manager.subscribeEvents((record) => events.push(record))
    let stream!: ReadableStreamDefaultController<Uint8Array>
    const encoder = new TextEncoder()
    const enqueue = (delta: Record<string, string>, finishReason: string | null = null) => {
      stream.enqueue(encoder.encode(`data: ${JSON.stringify({
        id: 'fixture', object: 'chat.completion.chunk',
        choices: [{ index: 0, delta, finish_reason: finishReason }],
      })}\n\n`))
    }
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(
      new ReadableStream<Uint8Array>({ start(controller) { stream = controller } }),
      { headers: { 'content-type': 'text/event-stream' } },
    ))
    const prompt = session.prompt('Keep thinking while I switch conversations.')
    try {
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
      enqueue({ role: 'assistant', reasoning_content: 'Considering' })
      await vi.waitFor(() => expect(session.agent.state.streamingMessage).toMatchObject({
        role: 'assistant', content: [expect.objectContaining({ type: 'thinking', thinking: 'Considering' })],
      }))

      const snapshot = await manager.command(created.runtimeId, { type: 'get_messages' })
      expect(snapshot.response.success, JSON.stringify(snapshot.response)).toBe(true)
      expect(snapshot.response).toMatchObject({ success: true, command: 'get_messages', data: {
        messages: [expect.objectContaining({ role: 'system' }), expect.objectContaining({ role: 'user' })],
        live: { sequence: events[events.length - 1]!.sequence, isStreaming: true, message: {
          role: 'assistant', content: [{ type: 'thinking', thinking: 'Considering' }],
        } },
      } })
      if (!snapshot.response.success || snapshot.response.command !== 'get_messages') throw new Error('Missing live snapshot')
      const boundary = snapshot.response.data.live!.sequence

      enqueue({ reasoning_content: ' the solution' })
      await vi.waitFor(() => expect(deltaBlocked).toBe(true))
      expect(session.agent.state.streamingMessage).toMatchObject({
        content: [expect.objectContaining({ thinking: 'Considering the solution' })],
      })
      // The SDK updates its public state before awaited extensions notify Host.
      // A snapshot must retain the emitted boundary, not duplicate this delta.
      const whileBlocked = await manager.command(created.runtimeId, { type: 'get_messages' })
      expect(whileBlocked.response).toMatchObject({ success: true, data: {
        live: { sequence: boundary, isStreaming: true, message: {
          content: [{ type: 'thinking', thinking: 'Considering' }],
        } },
      } })
      releaseDelta()
      await vi.waitFor(() => expect(session.agent.state.streamingMessage).toMatchObject({
        content: [expect.objectContaining({ thinking: 'Considering the solution' })],
      }))
      await vi.waitFor(() => expect(events[events.length - 1]!.sequence).toBeGreaterThan(boundary))
      expect(events[events.length - 1]!.sequence).toBeGreaterThan(boundary)
      expect(snapshot.response.data.live!.message!.content[0]).toEqual({ type: 'thinking', thinking: 'Considering' })
      enqueue({ content: 'Done' }, 'stop')
      stream.enqueue(encoder.encode('data: [DONE]\n\n'))
      stream.close()
      await vi.waitFor(() => expect(finalBlocked).toBe(true))
      expect(session.messages[session.messages.length - 1]).toMatchObject({ role: 'assistant' })
      const finalizing = await manager.command(created.runtimeId, { type: 'get_messages' })
      expect(finalizing.response).toMatchObject({ success: true, data: {
        messages: [expect.objectContaining({ role: 'system' }), expect.objectContaining({ role: 'user' })],
        live: { isStreaming: true, message: { role: 'assistant', content: [
          { type: 'thinking', thinking: 'Considering the solution' },
          { type: 'text', text: 'Done' },
        ] } },
      } })
      releaseFinal()
      await prompt
      const settled = await manager.command(created.runtimeId, { type: 'get_messages' })
      expect(settled.response).toMatchObject({ success: true, data: { live: { message: null, isStreaming: false } } })
    } finally {
      releaseDelta()
      releaseFinal()
      try { stream?.error(new Error('Fixture stream closed')) } catch { /* already settled */ }
      await session.abort()
      await prompt
      fetch.mockRestore()
    }
  })

  it('retains sparse content indices and incomplete tool argument prefixes until the tool call ends', async () => {
    const { manager, sessionDir } = await createFixture()
    const created = await manager.create({ runtimeId: 'rt_live_tool_arguments', sessionDir })
    await manager.bindRuntime(created.runtimeId, created.generation)
    const message = {
      role: 'assistant' as const, content: [], api: 'openai-completions',
      provider: 'fixture', model: 'fixture-model', stopReason: 'pending' as const, timestamp: 1,
      usage: {
        input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    }
    emitSessionEvent(manager, created.runtimeId, { type: 'message_start', message })
    emitSessionEvent(manager, created.runtimeId, {
      type: 'message_update', message,
      assistantMessageEvent: { type: 'toolcall_start', contentIndex: 0, partial: message },
    })
    emitSessionEvent(manager, created.runtimeId, {
      type: 'message_update', message,
      assistantMessageEvent: {
        type: 'toolcall_delta', contentIndex: 0, delta: '{"command":"pn', partial: message,
      },
    })
    emitSessionEvent(manager, created.runtimeId, {
      type: 'message_update', message,
      assistantMessageEvent: { type: 'text_start', contentIndex: 2, partial: message },
    })
    emitSessionEvent(manager, created.runtimeId, {
      type: 'message_update', message,
      assistantMessageEvent: { type: 'text_delta', contentIndex: 2, delta: 'Still working', partial: message },
    })

    const partial = await manager.command(created.runtimeId, { type: 'get_messages' })
    expect(partial.response).toMatchObject({ success: true, command: 'get_messages', data: {
      live: {
        message: { content: [{ type: 'text', text: 'Still working' }] },
        isStreaming: true, sequence: 5, contentIndices: [2],
        toolCallDeltas: [[0, '{"command":"pn']],
      },
    } })

    emitSessionEvent(manager, created.runtimeId, {
      type: 'message_update', message,
      assistantMessageEvent: {
        type: 'toolcall_end', contentIndex: 0, partial: message,
        toolCall: { type: 'toolCall', id: 'call-1', name: 'bash', arguments: { command: 'pnpm test' } },
      },
    })
    const complete = await manager.command(created.runtimeId, { type: 'get_messages' })
    expect(complete.response).toMatchObject({ success: true, data: {
      live: { sequence: 6, toolCallDeltas: [], contentIndices: [0, 2], message: { content: [
        { type: 'toolCall', id: 'call-1', name: 'bash', arguments: { command: 'pnpm test' } },
        { type: 'text', text: 'Still working' },
      ] } },
    } })
    expect(partial.response).toMatchObject({ data: { live: { toolCallDeltas: [[0, '{"command":"pn']] } } })
  })

  it('checks delivery ownership at admission and returns durable queue payloads after Stop', async () => {
    const { manager, sessionDir } = await createFixture()
    const created = await manager.create({ runtimeId: 'rt_delivery', sessionDir })
    await manager.bindRuntime(created.runtimeId, created.generation)
    const runtimes = Reflect.get(manager, 'runtimes') as Map<string, { runtime: { session: AgentSession } }>
    const session = runtimes.get(created.runtimeId)!.runtime.session
    vi.spyOn(session, 'isStreaming', 'get').mockReturnValue(true)
    vi.spyOn(session, 'abort').mockResolvedValue(undefined)
    const command = { type: 'submit_message' as const, submissionId: 'durable-1', message: 'queued payload', mode: 'auto' as const, expectedSessionId: created.sessionId }
    await expect(manager.command(created.runtimeId, { ...command, expectedSessionId: 'another-session' })).rejects.toMatchObject({ code: 'RUNTIME_STALE_GENERATION' })
    expect((await manager.command(created.runtimeId, command)).response).toMatchObject({ success: true, command: 'submit_message', data: { receipt: { status: 'accepted', acceptedMode: 'follow_up' } } })
    expect(session.getFollowUpMessages()).toEqual([])
    await manager.command(created.runtimeId, { type: 'abort' })
    expect(session.getFollowUpMessages()).toEqual([])
    expect((await manager.command(created.runtimeId, { type: 'get_delivery_state', submissionId: 'durable-1', expectedSessionId: created.sessionId })).response).toMatchObject({
      success: true, data: { paused: true, items: [{ submissionId: 'durable-1', message: 'queued payload', status: 'frozen' }] },
    })
  })

  it('delivers one managed follow-up through the command lane after the agent settles', async () => {
    const { manager, sessionDir } = await createFixture()
    const created = await manager.create({ runtimeId: 'rt_delivery_pump', sessionDir })
    await manager.bindRuntime(created.runtimeId, created.generation)
    const runtimes = Reflect.get(manager, 'runtimes') as Map<string, { runtime: { session: AgentSession } }>
    const session = runtimes.get(created.runtimeId)!.runtime.session
    const streaming = vi.spyOn(session, 'isStreaming', 'get').mockReturnValue(true)
    const prompt = vi.spyOn(session, 'prompt').mockImplementation(async (_message, options) => {
      options?.preflightResult?.('started')
      streaming.mockReturnValue(true)
    })
    for (const submissionId of ['one', 'two']) await manager.command(created.runtimeId, { type: 'submit_message', submissionId, message: submissionId, mode: 'auto' })
    expect(prompt).not.toHaveBeenCalled()
    expect(session.getFollowUpMessages()).toEqual([])
    streaming.mockReturnValue(false)
    emitSessionEvent(manager, created.runtimeId, { type: 'agent_settled' })
    await manager.command(created.runtimeId, { type: 'get_state' })
    expect(prompt).toHaveBeenCalledTimes(1)
    expect(prompt).toHaveBeenCalledWith('one', expect.any(Object))
    const remaining = await manager.command(created.runtimeId, { type: 'get_delivery_state' })
    expect(remaining.response).toMatchObject({ success: true, data: { items: [{ message: 'two', status: 'queued' }] } })
    streaming.mockReturnValue(false)
    emitSessionEvent(manager, created.runtimeId, { type: 'agent_settled' })
    await manager.command(created.runtimeId, { type: 'get_state' })
    expect(prompt).toHaveBeenCalledTimes(2)
    expect(prompt).toHaveBeenLastCalledWith('two', expect.any(Object))
  })

  it('increments generation after new and switch while keeping the Host cwd', async () => {
    const { manager, cwd, sessionDir } = await createFixture()
    const created = await manager.create({
      runtimeId: 'rt_replace',
      sessionDir,
    })
    await manager.bindRuntime(created.runtimeId, created.generation)
    const next = await manager.command('rt_replace', { type: 'new_session' })

    expect(next.runtime).toMatchObject({
      runtimeId: 'rt_replace',
      generation: 2,
      cwd,
    })
    expect(next.runtime.sessionId).not.toBe(created.sessionId)

    const sessionFile = join(sessionDir, 'fixture-session.jsonl')
    await writeFile(sessionFile, `${JSON.stringify({
      type: 'session',
      version: 3,
      id: 'fixture-session',
      timestamp: '2026-08-14T00:00:00.000Z',
      cwd,
    })}\n`, 'utf8')
    const switched = await manager.command('rt_replace', {
      type: 'switch_session',
      sessionPath: sessionFile,
    })

    expect(switched.response).toMatchObject({
      command: 'switch_session',
      success: true,
      data: { cancelled: false },
    })
    expect(switched.runtime).toMatchObject({
      generation: 3,
      sessionId: 'fixture-session',
      sessionFile,
      cwd,
    })
  })

  it('reloads SDK resources in place and advances the Runtime generation', async () => {
    const { manager, sessionDir } = await createFixture()
    const created = await manager.create({ runtimeId: 'rt_reload', sessionDir })
    await manager.bindRuntime(created.runtimeId, created.generation)

    const reloaded = await manager.reloadRuntime(
      created.runtimeId,
      created.generation,
    )

    expect(reloaded).toMatchObject({
      runtimeId: created.runtimeId,
      generation: created.generation + 1,
      sessionId: created.sessionId,
      sessionFile: created.sessionFile,
    })
    await expect(manager.command(
      created.runtimeId,
      { type: 'get_state' },
      created.generation,
    )).rejects.toMatchObject({ code: 'RUNTIME_STALE_GENERATION' })
    await expect(manager.command(
      created.runtimeId,
      { type: 'get_state' },
      reloaded.generation,
    )).resolves.toMatchObject({ runtime: { generation: reloaded.generation } })
  })

  it('refuses queued work before shutting down SDK extensions during configuration reload', async () => {
    let shutdowns = 0
    const { manager, sessionDir } = await createFixture([{
      name: 'reload-safety',
      factory: (pi) => { pi.on('session_shutdown', () => { shutdowns += 1 }) },
    }])
    const created = await manager.create({ runtimeId: 'rt_protected_reload', sessionDir })
    await manager.bindRuntime(created.runtimeId, created.generation)
    await manager.command(created.runtimeId, { type: 'follow_up', message: 'queued payload' }, created.generation)
    await expect(manager.reloadRuntime(created.runtimeId, created.generation, undefined, true))
      .rejects.toMatchObject({ code: 'RUNTIME_CONFIGURATION_BUSY' })
    expect(shutdowns).toBe(0)
    expect(manager.get(created.runtimeId)?.generation).toBe(created.generation)
    expect((await manager.command(created.runtimeId, { type: 'get_state' })).response)
      .toMatchObject({ data: { pendingMessageCount: 1 } })
  })

  it('rereads models.json through the public model runtime API during safe reload', async () => {
    const { manager, agentDir, sessionDir } = await createFixture()
    const created = await manager.create({ runtimeId: 'rt_model_reload', sessionDir })
    await manager.bindRuntime(created.runtimeId, created.generation)
    await writeFile(join(agentDir, 'models.json'), JSON.stringify({ providers: {
      'fixture-config-apply': {
        baseUrl: 'https://fixture.invalid/v1', api: 'openai-completions', apiKey: 'fixture-no-network',
        models: [{ id: 'configured-model', name: 'Configured model' }],
      },
    } }))
    const reloaded = await manager.reloadRuntime(created.runtimeId, created.generation, undefined, true)
    const models = await manager.command(created.runtimeId, { type: 'get_available_models' }, reloaded.generation)
    expect(models.response.success, JSON.stringify(models.response)).toBe(true)
    expect(models.response).toMatchObject({ success: true, data: { models: expect.arrayContaining([
      expect.objectContaining({ provider: 'fixture-config-apply', id: 'configured-model' }),
    ]) } })
  })

  it('uses refreshed model metadata and baseUrl for the next provider request without changing defaults or history', async () => {
    const { manager, agentDir, sessionDir } = await createFixture()
    const document = (baseUrl: string, contextWindow: number, supportsStore: boolean) => JSON.stringify({ providers: {
      'fixture-config-apply': {
        baseUrl, api: 'openai-completions', apiKey: 'fixture-no-network',
        models: [{ id: 'configured-model', name: 'Configured model', contextWindow, maxTokens: 512,
          compat: { supportsStore } }],
      },
    } })
    await writeFile(join(agentDir, 'models.json'), document('https://fixture.invalid/old/v1', 8_000, true))
    // Model selection is session-scoped in Pi 0.85; seed explicit defaults to
    // verify configuration reload neither changes nor creates them implicitly.
    await writeFile(join(agentDir, 'settings.json'), JSON.stringify({
      defaultProvider: 'fixture-config-apply', defaultModel: 'configured-model',
    }))
    const created = await manager.create({ runtimeId: 'rt_model_request', sessionDir })
    await manager.bindRuntime(created.runtimeId, created.generation)
    await manager.command(created.runtimeId, {
      type: 'set_model', provider: 'fixture-config-apply', modelId: 'configured-model',
    }, created.generation)
    const runtimes = Reflect.get(manager, 'runtimes') as Map<string, { runtime: { session: AgentSession } }>
    const session = runtimes.get(created.runtimeId)!.runtime.session
    await session.settingsManager.flush()
    const defaults = await readFile(join(agentDir, 'settings.json'), 'utf8')
    const entries = session.sessionManager.getEntries()
    const thinking = session.thinkingLevel
    await writeFile(join(agentDir, 'models.json'), document('https://fixture.invalid/new/v1', 12_000, false))
    await manager.reloadRuntime(created.runtimeId, created.generation, undefined, true)
    await session.settingsManager.flush()
    expect(await readFile(join(agentDir, 'settings.json'), 'utf8')).toBe(defaults)
    expect(session.sessionManager.getEntries()).toEqual(entries)
    expect(session.thinkingLevel).toBe(thinking)
    expect(session.model).toMatchObject({ baseUrl: 'https://fixture.invalid/new/v1', contextWindow: 12_000, compat: { supportsStore: false } })

    const requests: Request[] = []
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      requests.push(new Request(input, init))
      return new Response([
        'data: {"id":"fixture","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","content":"Applied"},"finish_reason":null}]}',
        'data: {"id":"fixture","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}',
        'data: [DONE]',
        '',
      ].join('\n\n'), { headers: { 'content-type': 'text/event-stream' } })
    })
    try {
      await session.prompt('Verify the applied model configuration.')
      expect(requests).toHaveLength(1)
      expect(requests[0]!.url).toBe('https://fixture.invalid/new/v1/chat/completions')
      const payload = await requests[0]!.json()
      expect(payload).toMatchObject({ model: 'configured-model', stream: true })
      expect(payload).not.toHaveProperty('store')
      expect(session.messages[session.messages.length - 1]).toMatchObject({ role: 'assistant', stopReason: 'stop' })
    } finally {
      fetch.mockRestore()
    }
  })

  it('reports a removed selected model as failed instead of claiming configuration application', async () => {
    const { manager, agentDir, sessionDir } = await createFixture()
    await writeFile(join(agentDir, 'models.json'), JSON.stringify({ providers: { 'fixture-config-apply': {
      baseUrl: 'https://fixture.invalid/v1', api: 'openai-completions', apiKey: 'fixture-no-network',
      models: [{ id: 'configured-model' }],
    } } }))
    const created = await manager.create({ runtimeId: 'rt_removed_model', sessionDir })
    await manager.bindRuntime(created.runtimeId, created.generation)
    await manager.command(created.runtimeId, { type: 'set_model', provider: 'fixture-config-apply', modelId: 'configured-model' })
    await writeFile(join(agentDir, 'models.json'), '{}')
    await expect(manager.reloadRuntime(created.runtimeId, created.generation, undefined, true)).rejects.toMatchObject({
      code: 'RUNTIME_CONFIGURATION_INVALID',
    })
    await expect(manager.reloadRuntime(created.runtimeId, created.generation, undefined, true)).rejects.toMatchObject({
      code: 'RUNTIME_CONFIGURATION_INVALID',
    })
    expect(manager.get(created.runtimeId)?.generation).toBe(created.generation)
  })

  it('cancels only new configuration-reload dialogs and leaves ordinary startup, reload and commands interactive', async () => {
    const confirmations: Array<{ source: string; value: boolean }> = []
    const { manager, sessionDir } = await createFixture([{
      name: 'configuration-interaction-fixture',
      factory: (pi) => {
        pi.on('session_shutdown', async (event, context) => {
          if (event.reason !== 'reload') return
          confirmations.push({ source: 'shutdown', value: await context.ui.confirm('Reload shutdown', 'Continue?') })
        })
        pi.on('session_start', async (event, context) => {
          confirmations.push({ source: event.reason, value: await context.ui.confirm('Session start', 'Continue?') })
        })
        pi.registerCommand('ordinary-confirm', {
          description: 'Fixture confirmation',
          handler: async (_args, context) => {
            confirmations.push({ source: 'command', value: await context.ui.confirm('Ordinary command', 'Continue?') })
          },
        })
      },
    }])
    let respond = true
    const observed: Array<{ runtimeId: string; generation: number; id: string }> = []
    manager.subscribeUiRequests((record) => {
      if (record.request.method !== 'confirm') return
      observed.push({ runtimeId: record.runtimeId, generation: record.generation, id: record.request.id })
      if (respond) manager.respondToExtensionUi({ type: 'extension_ui_response', id: record.request.id, confirmed: true }, record.runtimeId, record.generation)
    })
    const created = await manager.create({ runtimeId: 'rt_reload_dialogs', sessionDir })
    await manager.bindRuntime(created.runtimeId, created.generation)
    expect(confirmations).toContainEqual({ source: 'startup', value: true })
    const runtimes = Reflect.get(manager, 'runtimes') as Map<string, { runtime: { session: AgentSession } }>
    const session = runtimes.get(created.runtimeId)!.runtime.session

    respond = false
    const ordinary = session.prompt('/ordinary-confirm')
    await vi.waitFor(() => expect(observed).toHaveLength(2))
    await expect(manager.reloadRuntime(created.runtimeId, created.generation, undefined, true))
      .rejects.toMatchObject({ code: 'RUNTIME_CONFIGURATION_BUSY' })
    expect(confirmations.filter((result) => result.source === 'command')).toEqual([])
    manager.respondToExtensionUi({ type: 'extension_ui_response', id: observed[1]!.id, confirmed: true }, created.runtimeId, created.generation)
    await ordinary

    const reloaded = await manager.reloadRuntime(created.runtimeId, created.generation, undefined, true)
    expect(reloaded).toMatchObject({ generation: 2, interactionRequired: true })
    expect(confirmations).toContainEqual({ source: 'shutdown', value: false })
    expect(confirmations).toContainEqual({ source: 'reload', value: false })
    expect(observed).toHaveLength(2)
    respond = true
    await session.prompt('/ordinary-confirm')
    expect(confirmations[confirmations.length - 1]).toEqual({ source: 'command', value: true })
    const interactiveReload = await manager.reloadRuntime(created.runtimeId, reloaded.generation)
    expect(interactiveReload).not.toHaveProperty('interactionRequired')
    expect(confirmations[confirmations.length - 1]).toEqual({ source: 'reload', value: true })
  })

  it('returns the actual generation when a configuration reload fails after SDK startup advances identity', async () => {
    const { manager, sessionDir } = await createFixture()
    const created = await manager.create({ runtimeId: 'rt_partial_reload', sessionDir })
    await manager.bindRuntime(created.runtimeId, created.generation)
    const runtimes = Reflect.get(manager, 'runtimes') as Map<string, { runtime: { session: AgentSession } }>
    const session = runtimes.get(created.runtimeId)!.runtime.session
    const reload = vi.spyOn(session, 'reload').mockImplementationOnce(async (options) => {
      await options?.beforeSessionStart?.()
      throw new Error('startup reload failed')
    })
    try {
      await expect(manager.reloadRuntime(created.runtimeId, created.generation, undefined, true)).resolves.toMatchObject({
        generation: 2, runtimeId: created.runtimeId, sessionId: created.sessionId, reloadFailed: true,
      })
      await expect(manager.command(created.runtimeId, { type: 'get_state' }, 2)).resolves.toMatchObject({ response: { success: true } })
    } finally {
      reload.mockRestore()
    }
  })

  it('keeps more than the former default Runtime count until explicit disposal', async () => {
    const { manager, sessionDir } = await createFixture()
    const created = await Promise.all(Array.from({ length: 5 }, (_, index) =>
      manager.create({
        runtimeId: `rt_retained_${index}`,
        sessionDir,
      }),
    ))

    expect(manager.size).toBe(5)
    expect(manager.list()).toHaveLength(5)

    await manager.dispose()
    expect(manager.size).toBe(0)
    await expect(manager.command('rt_retained_0', { type: 'get_state' }))
      .rejects.toMatchObject({ code: 'RUNTIME_MANAGER_DISPOSED' })
    expect(created.every((runtime) => runtime.sessionFile?.startsWith(sessionDir))).toBe(true)
  })

  it('disposes SDK Runtime memory without deleting its persisted Session file', async () => {
    const { manager, cwd, sessionDir } = await createFixture()
    const sessionFile = join(sessionDir, 'persisted.jsonl')
    const content = `${JSON.stringify({
      type: 'session',
      version: 3,
      id: 'persisted-session',
      timestamp: '2026-08-16T00:00:00.000Z',
      cwd,
    })}\n`
    await writeFile(sessionFile, content, 'utf8')
    const created = await manager.create({
      runtimeId: 'rt_persisted',
      sessionDir,
      sessionFile,
    })
    await manager.bindRuntime(created.runtimeId, created.generation)

    await manager.disposeRuntime(created.runtimeId, created.generation)

    const persisted = await readFile(sessionFile, 'utf8')
    expect(persisted.startsWith(content)).toBe(true)
    expect(manager.size).toBe(0)
  })

  it('rejects a Session whose header cwd belongs to another Host', async () => {
    const { manager, sessionDir } = await createFixture()
    const sessionFile = join(sessionDir, 'wrong-scope.jsonl')
    await writeFile(sessionFile, `${JSON.stringify({
      type: 'session',
      version: 3,
      id: 'wrong-scope',
      timestamp: '2026-08-14T00:00:00.000Z',
      cwd: '/tmp/another-pipilot-project',
    })}\n`, 'utf8')

    await expect(manager.create({
      runtimeId: 'rt_wrong_scope',
      sessionDir,
      sessionFile,
    })).rejects.toMatchObject({ code: 'RUNTIME_SCOPE_MISMATCH' })

    await expect(manager.create({
      runtimeId: 'rt_wrong_scope',
      sessionDir,
    })).resolves.toMatchObject({ generation: 1 })
  })

  it('recovers a moved Session by forking it into the current Host cwd', async () => {
    const { manager, cwd, root, sessionDir } = await createFixture()
    const sourceFile = join(sessionDir, 'moved-source.jsonl')
    const missingCwd = join(root, 'moved-away-project')
    await writeFile(sourceFile, `${JSON.stringify({
      type: 'session',
      version: 3,
      id: 'moved-source',
      timestamp: '2026-08-14T00:00:00.000Z',
      cwd: missingCwd,
    })}\n`, 'utf8')

    const recovered = await manager.create({
      runtimeId: 'rt_recovered',
      sessionDir,
      forkSessionFile: sourceFile,
    })
    await manager.bindRuntime(recovered.runtimeId, recovered.generation)

    expect(recovered).toMatchObject({
      runtimeId: 'rt_recovered',
      generation: 1,
      cwd,
    })
    expect(recovered.sessionFile).not.toBe(sourceFile)
    const state = await manager.command('rt_recovered', { type: 'get_state' })
    expect(state.response).toMatchObject({
      command: 'get_state',
      success: true,
      data: { sessionId: recovered.sessionId },
    })
  })

  it('checks expected generation inside the serialized Runtime lifecycle', async () => {
    const { manager, sessionDir } = await createFixture()
    const created = await manager.create({ runtimeId: 'rt_generation', sessionDir })
    await manager.bindRuntime(created.runtimeId, created.generation)

    const replaced = await manager.command(
      'rt_generation',
      { type: 'new_session' },
      1,
    )
    expect(replaced.runtime.generation).toBe(2)
    await expect(manager.command(
      'rt_generation',
      { type: 'get_state' },
      1,
    )).rejects.toMatchObject({ code: 'RUNTIME_STALE_GENERATION' })
    await expect(manager.disposeRuntime('rt_generation', 1))
      .rejects.toMatchObject({ code: 'RUNTIME_STALE_GENERATION' })
    await expect(manager.command(
      'rt_generation',
      { type: 'get_state' },
      2,
    )).resolves.toMatchObject({ runtime: { generation: 2 } })
  })

  it('reports extension abort persistence failures without rejecting an unobserved Promise', async () => {
    let requestAbort!: () => void
    const { manager, sessionDir, agentDir } = await createFixture([{
      name: 'abort-error-boundary',
      factory: (pi) => {
        pi.on('session_start', (_event, context) => { requestAbort = () => context.abort() })
      },
    }])
    const events: Array<{ event: { type: string; event?: string; extensionPath?: string; error?: string } }> = []
    const fatalErrors: unknown[] = []
    manager.subscribeEvents((record) => events.push(record))
    manager.subscribeFatalErrors((error) => fatalErrors.push(error))
    const created = await manager.create({ runtimeId: 'rt_extension_abort_error', sessionDir })
    await manager.bindRuntime(created.runtimeId, created.generation)
    const runtimes = Reflect.get(manager, 'runtimes') as Map<string, { runtime: { session: AgentSession } }>
    const abort = vi.spyOn(runtimes.get(created.runtimeId)!.runtime.session, 'abort')
    // A filesystem obstruction makes the durable Stop fail after cancellation
    // is requested, even though the SDK's actual abort can still complete.
    await mkdir(join(agentDir, 'pipilot'), { recursive: true })
    await writeFile(join(agentDir, 'pipilot', 'outbox'), 'not a directory')

    requestAbort()
    await vi.waitFor(() => expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ event: expect.objectContaining({
        type: 'extension_error', extensionPath: '<pipilot:delivery>', event: 'abort', error: expect.any(String),
      }) }),
    ])))
    expect(abort).toHaveBeenCalledOnce()
    expect(fatalErrors).toEqual([])
    expect((await manager.command(created.runtimeId, { type: 'get_state' })).response.success).toBe(true)
  })

  it('lets abort preempt a streaming command that has not returned', async () => {
    const { manager, sessionDir } = await createFixture()
    const created = await manager.create({ runtimeId: 'rt_abort_lane', sessionDir })
    await manager.bindRuntime(created.runtimeId, created.generation)
    const runtimes = Reflect.get(manager, 'runtimes') as Map<string, {
      runtime: {
        session: {
          isStreaming: boolean
          prompt: (message: string) => Promise<void>
          abort: () => Promise<void>
        }
      }
    }>
    const session = runtimes.get(created.runtimeId)?.runtime.session
    if (!session) throw new Error('Missing fixture Runtime session.')

    let releasePrompt!: () => void
    const pendingPrompt = new Promise<void>((resolve) => {
      releasePrompt = resolve
    })
    Object.defineProperty(session, 'isStreaming', {
      configurable: true,
      get: () => true,
    })
    session.prompt = vi.fn(() => pendingPrompt)
    session.abort = vi.fn(async () => {
      releasePrompt()
    })

    const prompt = manager.command(created.runtimeId, {
      type: 'prompt',
      message: 'Run the blocking tool.',
    }, created.generation)
    await Promise.resolve()

    await expect(manager.command(
      created.runtimeId,
      { type: 'abort' },
      created.generation,
      250,
    )).resolves.toMatchObject({
      response: { command: 'abort', success: true },
    })
    await expect(prompt).resolves.toMatchObject({
      response: { command: 'prompt', success: true },
    })
    expect(session.abort).toHaveBeenCalledOnce()
  })
})
