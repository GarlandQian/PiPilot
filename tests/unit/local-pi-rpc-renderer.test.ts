import { describe, expect, it } from 'vitest'
import {
  localPiAgentMessageSchema,
  localPiModelSchema,
  localPiRpcEventSchema,
  localPiRpcResponseSchema,
  localPiSessionStatsSchema,
  type LocalPiAssistantMessage,
  type LocalPiAgentMessage,
  type LocalPiRpcEvent,
  type LocalPiRpcEventMessage,
  type LocalPiSessionEntry,
} from '../../src/shared/local-pi'
import {
  applyLocalPiProjectorEvent,
  createLocalPiProjectorState,
  replaceLocalPiProjectorSnapshot,
  resetLocalPiProjectorState,
} from '../../src/renderer/pi-rpc/projector'
import {
  projectConversationOutline,
  projectLocalPiTurns,
} from '../../src/renderer/pi-rpc/presentation'
import {
  alignLocalPiMessageOrigins,
} from '../../src/renderer/pi-rpc/response-provenance'
import {
  cancelPiGenerationHydrationWaiter,
  derivePiConversationPresentation,
  piForkDraftHydrationOutcome,
  piGenerationHydrationOutcome,
} from '../../src/store/pi-rpc'

const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
}

function assistant(
  content: LocalPiAssistantMessage['content'] = [],
  stopReason: LocalPiAssistantMessage['stopReason'] = 'pending',
): LocalPiAssistantMessage {
  return {
    role: 'assistant',
    content,
    api: 'anthropic-messages',
    provider: 'anthropic',
    model: 'claude-test',
    usage,
    stopReason,
    timestamp: 1,
  }
}

function user(content: string, timestamp = 1): LocalPiAgentMessage {
  return { role: 'user', content, timestamp }
}

function messageEntry(
  id: string,
  parentId: string | null,
  message: LocalPiAgentMessage,
): LocalPiSessionEntry {
  return {
    type: 'message',
    id,
    parentId,
    timestamp: `2026-08-09T00:00:${String(message.timestamp).padStart(2, '0')}.000Z`,
    message,
  }
}

let eventSequence = 0

function envelope(
  event: LocalPiRpcEvent,
  generation = 7,
): LocalPiRpcEventMessage {
  eventSequence += 1
  return {
    eventId: `00000000-0000-4000-8000-${String(eventSequence).padStart(12, '0')}`,
    generation,
    event,
  }
}

function apply(
  state: ReturnType<typeof createLocalPiProjectorState>,
  event: LocalPiRpcEvent,
) {
  return applyLocalPiProjectorEvent(state, envelope(event))
}

describe('official local Pi RPC DTOs', () => {
  it('validates full model, message, stats, response, and event payloads', () => {
    const model = {
      id: 'claude-test',
      name: 'Claude Test',
      api: 'anthropic-messages',
      provider: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      reasoning: true,
      input: ['text', 'image'],
      cost: {
        input: 3,
        output: 15,
        cacheRead: 0.3,
        cacheWrite: 3.75,
      },
      contextWindow: 200_000,
      maxTokens: 16_384,
    }
    expect(localPiModelSchema.parse(model)).toEqual(model)

    const message = assistant([
      { type: 'text', text: 'Hello' },
      { type: 'thinking', thinking: 'Reasoning' },
      {
        type: 'toolCall',
        id: 'call-1',
        name: 'bash',
        arguments: { command: 'pwd' },
      },
    ], 'toolUse')
    expect(localPiAgentMessageSchema.parse(message)).toEqual(message)

    const stats = {
      sessionFile: '/tmp/session.jsonl',
      sessionId: 'session-a',
      userMessages: 1,
      assistantMessages: 1,
      toolCalls: 1,
      toolResults: 1,
      totalMessages: 4,
      tokens: {
        input: 100,
        output: 50,
        cacheRead: 25,
        cacheWrite: 0,
        total: 175,
      },
      cost: 0.02,
      contextUsage: {
        tokens: null,
        contextWindow: 200_000,
        percent: null,
      },
    }
    expect(localPiSessionStatsSchema.parse(stats)).toEqual(stats)

    expect(localPiRpcResponseSchema.safeParse({
      type: 'response',
      command: 'get_available_models',
      success: true,
      data: { models: [model] },
    }).success).toBe(true)
    expect(localPiRpcEventSchema.safeParse({
      type: 'message_update',
      usage,
      assistantMessageEvent: {
        type: 'text_delta',
        contentIndex: 0,
        delta: 'Hello',
      },
    }).success).toBe(true)
    expect(localPiRpcEventSchema.safeParse({
      type: 'message_update',
      assistantMessageEvent: {
        type: 'text_delta',
        contentIndex: 0,
        delta: 'Missing cumulative usage',
      },
    }).success).toBe(false)
    expect(localPiRpcEventSchema.safeParse({
      type: 'entry_appended',
      entry: {
        type: 'custom',
        id: 'entry-1',
        parentId: null,
        timestamp: '2026-08-09T00:00:00.000Z',
        customType: 'fixture',
        data: { ready: true },
      },
    }).success).toBe(true)
    expect(localPiRpcEventSchema.safeParse({
      type: 'session_info_changed',
      name: 'Renamed session',
    }).success).toBe(true)
    expect(localPiRpcEventSchema.safeParse({
      type: 'thinking_level_changed',
      level: 'high',
    }).success).toBe(true)

    expect(localPiRpcResponseSchema.safeParse({
      type: 'response',
      command: 'get_commands',
      success: true,
      data: {
        commands: [{
          name: 'review',
          source: 'extension',
          sourceInfo: {
            path: '/tmp/review.ts',
            source: 'review',
            scope: 'temporary',
            origin: 'top-level',
          },
        }],
      },
    }).success).toBe(true)
    expect(localPiRpcResponseSchema.safeParse({
      type: 'response',
      command: 'get_fork_messages',
      success: true,
      data: { messages: [{ entryId: 'entry-user', text: 'Fork here' }] },
    }).success).toBe(true)
    expect(localPiRpcResponseSchema.safeParse({
      type: 'response',
      command: 'fork',
      success: true,
      data: { text: 'Fork here', cancelled: false },
    }).success).toBe(true)
  })

  it('rejects malformed command-specific and cumulative streaming payloads', () => {
    expect(localPiRpcResponseSchema.safeParse({
      type: 'response',
      command: 'get_messages',
      success: true,
      data: { messages: [{ role: 'assistant' }] },
    }).success).toBe(false)

    expect(localPiRpcResponseSchema.safeParse({
      type: 'response',
      command: 'prompt',
      success: true,
      data: { accepted: true },
    }).success).toBe(false)

    expect(localPiRpcEventSchema.safeParse({
      type: 'message_update',
      usage,
      assistantMessageEvent: {
        type: 'text_delta',
        contentIndex: 0,
        delta: 'Hello',
        partial: assistant(),
      },
    }).success).toBe(false)

    expect(localPiRpcResponseSchema.safeParse({
      type: 'response',
      command: 'get_commands',
      success: true,
      data: {
        commands: [{
          name: 'review',
          source: 'extension',
          sourceInfo: {},
        }],
      },
    }).success).toBe(false)

    expect(localPiRpcResponseSchema.safeParse({
      type: 'response',
      command: 'get_messages',
      success: true,
      data: {
        messages: [{
          role: 'user',
          content: 'Legacy attachment payload',
          timestamp: 1,
          attachments: [],
        }],
      },
    }).success).toBe(false)

    expect(localPiRpcEventSchema.safeParse({
      type: 'entry_appended',
      entry: {
        type: 'custom',
        id: 'entry-1',
        parentId: null,
        timestamp: '2026-08-09T00:00:00.000Z',
        customType: 'fixture',
        legacyField: true,
      },
    }).success).toBe(false)

    expect(localPiRpcEventSchema.safeParse({
      type: 'tool_execution_update',
      toolCallId: 'call-1',
      toolName: 'bash',
      args: { command: 'pwd' },
      partialResult: {
        content: [{ type: 'text', text: 'output' }],
      },
    }).success).toBe(false)

    expect(localPiRpcEventSchema.safeParse({
      type: 'compaction_end',
      reason: 'manual',
      result: null,
      aborted: true,
      willRetry: false,
    }).success).toBe(false)
  })

  it('validates a deeply nested official session tree without using the call stack', () => {
    const depth = 2_000
    let children: unknown[] = []
    for (let index = depth - 1; index >= 0; index -= 1) {
      const id = `entry-${index}`
      children = [{
        entry: {
          type: 'session_info',
          id,
          parentId: index === 0 ? null : `entry-${index - 1}`,
          timestamp: '2026-08-09T00:00:00.000Z',
          name: `Entry ${index}`,
        },
        children,
      }]
    }

    const parsed = localPiRpcResponseSchema.safeParse({
      type: 'response',
      command: 'get_tree',
      success: true,
      data: { tree: children, leafId: `entry-${depth - 1}` },
    })

    expect(parsed.success).toBe(true)
    if (!parsed.success || !parsed.data.success || parsed.data.command !== 'get_tree') return
    let node = parsed.data.data.tree[0]
    let count = 0
    while (node) {
      count += 1
      node = node.children[0]
    }
    expect(count).toBe(depth)
  })
})

describe('local Pi generation hydration', () => {
  const scopeKey = 'project:workspace-b'
  const sessionState = { sessionId: 'session-b' } as never
  const session = { sessionId: 'session-b' }
  const loadingHydration = {
    scopeKey,
    generation: 8,
    sessionId: 'session-b',
    status: 'loading' as const,
    error: null,
  }
  const readyHydration = { ...loadingHydration, status: 'ready' as const }

  it('cancels and releases an abandoned hydration waiter exactly once', async () => {
    let resolveHydration: (success: boolean) => void = () => undefined
    const hydration = new Promise<boolean>((resolve) => {
      resolveHydration = resolve
    })
    const opening = { resolveHydration }
    const openingRef = { current: opening as typeof opening | null }

    expect(cancelPiGenerationHydrationWaiter(openingRef)).toBe(opening)
    expect(openingRef.current).toBeNull()
    await expect(hydration).resolves.toBe(false)
    expect(cancelPiGenerationHydrationWaiter(openingRef)).toBeNull()
  })

  it('settles only after the confirmed activation generation and transcript are hydrated', () => {
    expect(piGenerationHydrationOutcome(
      null,
      scopeKey,
      'session-b',
      { generation: 8, state: 'ready', sessionState },
      session,
      readyHydration,
      false,
      false,
    )).toBe('pending')
    expect(piGenerationHydrationOutcome(
      { scopeKey, generation: 8, sessionId: 'session-b' },
      scopeKey,
      'session-b',
      { generation: 7, state: 'ready', sessionState },
      session,
      readyHydration,
      false,
      false,
    )).toBe('pending')
    expect(piGenerationHydrationOutcome(
      { scopeKey, generation: 8, sessionId: 'session-b' },
      scopeKey,
      'session-b',
      { generation: 8, state: 'ready', sessionState },
      session,
      loadingHydration,
      true,
      false,
    )).toBe('pending')
    expect(piGenerationHydrationOutcome(
      { scopeKey, generation: 8, sessionId: 'session-b' },
      scopeKey,
      'session-b',
      { generation: 8, state: 'ready', sessionState },
      { sessionId: 'session-c' },
      readyHydration,
      false,
      false,
    )).toBe('pending')
    expect(piGenerationHydrationOutcome(
      { scopeKey, generation: 8, sessionId: 'session-b' },
      scopeKey,
      'session-b',
      { generation: 8, state: 'ready', sessionState },
      session,
      { ...readyHydration, scopeKey: 'project:workspace-a' },
      false,
      false,
    )).toBe('pending')
    expect(piGenerationHydrationOutcome(
      { scopeKey, generation: 8, sessionId: 'session-b' },
      scopeKey,
      'session-b',
      { generation: 8, state: 'ready', sessionState },
      session,
      readyHydration,
      false,
      false,
    )).toBe('ready')
    expect(piGenerationHydrationOutcome(
      { scopeKey, generation: 8, sessionId: 'session-b' },
      scopeKey,
      'session-b',
      { generation: 9, state: 'ready', sessionState },
      session,
      readyHydration,
      false,
      false,
    )).toBe('pending')
  })

  it('accepts a confirmed target whose per-Runtime generation is lower than the previous view', () => {
    const target = { scopeKey, generation: 3, sessionId: 'session-c' }
    const nextSessionState = { sessionId: 'session-c' } as never
    const nextSession = { sessionId: 'session-c' }
    const nextHydration = {
      scopeKey,
      generation: 3,
      sessionId: 'session-c',
      status: 'ready' as const,
      error: null,
    }

    expect(piGenerationHydrationOutcome(
      target,
      scopeKey,
      'session-c',
      { generation: 8, state: 'ready', sessionState },
      session,
      readyHydration,
      false,
      false,
    )).toBe('pending')
    expect(piGenerationHydrationOutcome(
      target,
      scopeKey,
      'session-c',
      { generation: 3, state: 'ready', sessionState: nextSessionState },
      nextSession,
      nextHydration,
      false,
      false,
    )).toBe('ready')
  })

  it('derives one presentation state that hides stale session data', () => {
    const runtime = {
      generation: 8,
      state: 'ready' as const,
      sessionState,
      stderr: '',
      diagnostics: [],
    }
    const input = {
      activeScopeKey: scopeKey,
      activeSessionId: 'session-b',
      activation: null,
      runtime,
      session,
      hydration: readyHydration,
      runtimeLoading: false,
      transcriptLoading: false,
    }

    expect(derivePiConversationPresentation({
      ...input,
      activeSessionId: '',
    })).toEqual({ status: 'empty' })
    expect(derivePiConversationPresentation({
      ...input,
      activation: { status: 'loading' },
    })).toEqual({ status: 'loading' })
    expect(derivePiConversationPresentation({
      ...input,
      activeSessionId: '',
      activation: { status: 'error', error: 'Activation failed.' },
    })).toEqual({ status: 'error', error: 'Activation failed.' })
    expect(derivePiConversationPresentation({
      ...input,
      activeScopeKey: 'project:workspace-c',
    })).toEqual({ status: 'loading' })
    expect(derivePiConversationPresentation({
      ...input,
      session: { sessionId: 'session-a' },
    })).toEqual({ status: 'loading' })
    expect(derivePiConversationPresentation(input)).toEqual({
      status: 'ready',
      sessionId: 'session-b',
    })
    expect(derivePiConversationPresentation({
      ...input,
      hydration: {
        ...readyHydration,
        status: 'error',
        error: 'Hydration failed.',
      },
    })).toEqual({ status: 'error', error: 'Hydration failed.' })
  })

  it('ends a switch with an error when the new runtime generation fails', () => {
    const runtime = {
      generation: 8,
      state: 'crashed' as const,
      sessionState: null,
      stderr: 'Pi exited.',
      diagnostics: [],
    }
    const hydration = {
      scopeKey,
      generation: 8,
      sessionId: null,
      status: 'error' as const,
      error: 'Pi exited.',
    }

    expect(piGenerationHydrationOutcome(
      { scopeKey, generation: 8, sessionId: 'session-b' },
      scopeKey,
      'session-b',
      runtime,
      null,
      hydration,
      false,
      false,
    )).toBe('error')
    expect(derivePiConversationPresentation({
      activeScopeKey: scopeKey,
      activeSessionId: 'session-b',
      activation: null,
      runtime,
      session: null,
      hydration,
      runtimeLoading: false,
      transcriptLoading: false,
    })).toEqual({ status: 'error', error: 'Pi exited.' })
  })

  it('applies a fork draft only after the replacement session is hydrated', () => {
    const target = {
      scopeKey,
      generation: 8,
      sessionId: 'session-b',
      text: 'Fork from this prompt',
    }
    expect(piForkDraftHydrationOutcome(
      target,
      scopeKey,
      { generation: 8, state: 'ready', sessionState },
      readyHydration,
    )).toBe('pending')
    expect(piForkDraftHydrationOutcome(
      target,
      scopeKey,
      {
        generation: 9,
        state: 'ready',
        sessionState: { sessionId: 'session-c' } as never,
      },
      { ...loadingHydration, generation: 9, sessionId: 'session-c' },
    )).toBe('pending')
    expect(piForkDraftHydrationOutcome(
      target,
      scopeKey,
      {
        generation: 9,
        state: 'ready',
        sessionState: { sessionId: 'session-c' } as never,
      },
      { ...readyHydration, generation: 9, sessionId: 'session-c' },
    )).toBe('apply')
  })

  it('discards a pending fork draft for another scope or failed replacement', () => {
    const target = {
      scopeKey,
      generation: 8,
      sessionId: 'session-b',
      text: 'Fork from this prompt',
    }
    expect(piForkDraftHydrationOutcome(
      target,
      'project:workspace-c',
      {
        generation: 9,
        state: 'ready',
        sessionState: { sessionId: 'session-c' } as never,
      },
      { ...readyHydration, generation: 9, sessionId: 'session-c' },
    )).toBe('discard')
    expect(piForkDraftHydrationOutcome(
      target,
      scopeKey,
      { generation: 9, state: 'crashed', sessionState: null },
      {
        ...readyHydration,
        generation: 9,
        sessionId: null,
        status: 'error',
        error: 'Pi exited.',
      },
    )).toBe('discard')
  })
})

describe('local Pi transcript projector', () => {
  it('projects one exact response action from the active official entry branch', () => {
    const activeUser = user('Repeat this prompt', 2)
    const toolAssistant = {
      ...assistant([
        { type: 'text' as const, text: 'First **fragment**' },
        {
          type: 'toolCall' as const,
          id: 'call-active',
          name: 'bash',
          arguments: { command: 'pwd' },
        },
      ], 'toolUse'),
      timestamp: 3,
    }
    const toolResult: LocalPiAgentMessage = {
      role: 'toolResult',
      toolCallId: 'call-active',
      toolName: 'bash',
      content: [{ type: 'text', text: '/workspace' }],
      isError: false,
      timestamp: 4,
    }
    const finalAssistant = {
      ...assistant([{ type: 'text', text: '\nSecond fragment' }], 'stop'),
      timestamp: 5,
    }
    const abandonedUser = user('Repeat this prompt', 1)
    const abandonedAssistant = {
      ...assistant([{ type: 'text', text: 'Abandoned answer' }], 'stop'),
      timestamp: 2,
    }
    const root: LocalPiSessionEntry = {
      type: 'custom',
      id: 'entry-root',
      parentId: null,
      timestamp: '2026-08-09T00:00:00.000Z',
      customType: 'root',
    }
    const entries: LocalPiSessionEntry[] = [
      root,
      messageEntry('entry-user-abandoned', root.id, abandonedUser),
      messageEntry('entry-assistant-abandoned', 'entry-user-abandoned', abandonedAssistant),
      messageEntry('entry-user-active', root.id, activeUser),
      messageEntry('entry-assistant-tool', 'entry-user-active', toolAssistant),
      messageEntry('entry-tool-result', 'entry-assistant-tool', toolResult),
      messageEntry('entry-assistant-final', 'entry-tool-result', finalAssistant),
    ]
    const messages = [activeUser, toolAssistant, toolResult, finalAssistant]
    const state = createLocalPiProjectorState({
      generation: 7,
      sessionId: 'session-a',
      messages,
      entrySnapshot: {
        generation: 7,
        sessionId: 'session-a',
        entries,
        leafId: 'entry-assistant-final',
        cursor: 'entry-assistant-final',
      },
    })

    const turns = projectLocalPiTurns(state)
    const actions = turns.filter((turn) => turn.kind === 'response-actions')
    expect(actions).toEqual([{
      kind: 'response-actions',
      id: '7:session-a:message:0:2:response-actions',
      copyMarkdown: 'First **fragment**\n\nSecond fragment',
      anchorEntryId: 'entry-user-active',
      forkEntryId: 'entry-user-active',
    }])
    expect(turns[turns.length - 1]).toEqual(actions[0])
    expect(projectConversationOutline(turns)).toEqual([{
      entryId: 'entry-user-active',
      title: 'Repeat this prompt',
      summary: 'First **fragment**',
      status: 'complete',
      time: '',
      timestamp: 2,
    }])
  })

  it('aligns retained compaction origins through a deep active path iteratively', () => {
    const oldUser = user('Summarized prompt', 1)
    const keptUser = user('Retained prompt', 2)
    const keptAssistant = {
      ...assistant([{ type: 'text', text: 'Retained answer' }], 'stop'),
      timestamp: 3,
    }
    const entries: LocalPiSessionEntry[] = [
      messageEntry('entry-old-user', null, oldUser),
      messageEntry('entry-kept-user', 'entry-old-user', keptUser),
      messageEntry('entry-kept-assistant', 'entry-kept-user', keptAssistant),
    ]
    let parentId = 'entry-kept-assistant'
    for (let index = 0; index < 2_500; index += 1) {
      const id = `entry-model-${index}`
      entries.push({
        type: 'model_change',
        id,
        parentId,
        timestamp: '2026-08-09T00:00:04.000Z',
        provider: 'fixture',
        modelId: `model-${index}`,
      })
      parentId = id
    }
    entries.push({
      type: 'compaction',
      id: 'entry-compaction',
      parentId,
      timestamp: '2026-08-09T00:00:05.000Z',
      summary: 'Earlier context summary',
      firstKeptEntryId: 'entry-kept-user',
      tokensBefore: 50_000,
    })
    const messages: LocalPiAgentMessage[] = [
      {
        role: 'compactionSummary',
        summary: 'Earlier context summary',
        tokensBefore: 50_000,
        timestamp: 5,
      },
      keptUser,
      keptAssistant,
    ]
    const entrySnapshot = {
      generation: 7,
      sessionId: 'session-a',
      entries,
      leafId: 'entry-compaction',
      cursor: 'entry-compaction',
    }

    expect(alignLocalPiMessageOrigins(entrySnapshot, messages)).toEqual([
      {
        entryId: 'entry-compaction',
        role: 'compactionSummary',
        forkEntryId: null,
      },
      {
        entryId: 'entry-kept-user',
        role: 'user',
        forkEntryId: 'entry-kept-user',
      },
      {
        entryId: 'entry-kept-assistant',
        role: 'assistant',
        forkEntryId: null,
      },
    ])
    const turns = projectLocalPiTurns(createLocalPiProjectorState({
      generation: 7,
      sessionId: 'session-a',
      messages,
      entrySnapshot,
    }))
    expect(turns.filter((turn) => turn.kind === 'response-actions')).toEqual([
      expect.objectContaining({
        copyMarkdown: 'Retained answer',
        anchorEntryId: 'entry-kept-user',
        forkEntryId: 'entry-kept-user',
      }),
    ])
    expect(projectConversationOutline(turns).map((item) => item.entryId)).toEqual([
      'entry-kept-user',
    ])
  })

  it('keeps Copy but disables Fork when official entry roles do not align', () => {
    const prompt = user('Prompt', 1)
    const response = {
      ...assistant([{ type: 'text', text: 'Copy remains available' }], 'stop'),
      timestamp: 2,
    }
    const entries: LocalPiSessionEntry[] = [
      messageEntry('entry-user', null, prompt),
      {
        type: 'custom_message',
        id: 'entry-custom',
        parentId: 'entry-user',
        timestamp: '2026-08-09T00:00:02.000Z',
        customType: 'fixture',
        content: 'Not an assistant origin',
        display: true,
      },
    ]
    const state = createLocalPiProjectorState({
      generation: 7,
      sessionId: 'session-a',
      messages: [prompt, response],
      entrySnapshot: {
        generation: 7,
        sessionId: 'session-a',
        entries,
        leafId: 'entry-custom',
        cursor: 'entry-custom',
      },
    })

    expect(alignLocalPiMessageOrigins(state.entrySnapshot!, state.messages)).toBeNull()
    expect(projectLocalPiTurns(state).filter((turn) =>
      turn.kind === 'response-actions')).toEqual([{
      kind: 'response-actions',
      id: '7:session-a:message:0:1:response-actions',
      copyMarkdown: 'Copy remains available',
    }])
    expect(projectConversationOutline(projectLocalPiTurns(state))).toEqual([])
  })

  it('omits response actions while provenance is loading or the response is incomplete', () => {
    const prompt = user('Prompt', 1)
    const response = {
      ...assistant([{ type: 'text', text: 'Not settled' }], 'stop'),
      timestamp: 2,
    }
    const entries = [
      messageEntry('entry-user', null, prompt),
      messageEntry('entry-assistant', 'entry-user', response),
    ]
    const base = {
      generation: 7,
      sessionId: 'session-a',
      messages: [prompt, response],
    }

    expect(projectLocalPiTurns(createLocalPiProjectorState(base))).not.toContainEqual(
      expect.objectContaining({ kind: 'response-actions' }),
    )
    expect(projectLocalPiTurns(createLocalPiProjectorState({
      ...base,
      isStreaming: true,
      entrySnapshot: {
        generation: 7,
        sessionId: 'session-a',
        entries,
        leafId: 'entry-assistant',
        cursor: 'entry-assistant',
      },
    }))).not.toContainEqual(expect.objectContaining({ kind: 'response-actions' }))
  })

  it('accepts official session metadata events without mutating transcript state', () => {
    const state = createLocalPiProjectorState({
      generation: 7,
      sessionId: 'session-a',
    })
    const entry = localPiRpcEventSchema.parse({
      type: 'entry_appended',
      entry: {
        type: 'custom',
        id: 'entry-1',
        parentId: null,
        timestamp: '2026-08-09T00:00:00.000Z',
        customType: 'fixture',
      },
    })
    expect(apply(state, entry)).toBe(state)
    expect(apply(state, {
      type: 'session_info_changed',
      name: 'Renamed session',
    })).toBe(state)
    expect(apply(state, {
      type: 'thinking_level_changed',
      level: 'high',
    })).toBe(state)
    expect(apply(state, {
      type: 'bash_execution_update',
      id: 'removed-renderer-shell',
      delta: 'ignored direct Bash output',
    })).toBe(state)
  })

  it('assembles text, thinking, and tool-call deltas before authoritative replacement', () => {
    let state = createLocalPiProjectorState({
      generation: 7,
      sessionId: 'session-a',
    })
    state = apply(state, { type: 'message_start', message: assistant() })
    state = apply(state, {
      type: 'message_update',
      usage,
      assistantMessageEvent: { type: 'text_start', contentIndex: 0 },
    })
    state = apply(state, {
      type: 'message_update',
      usage,
      assistantMessageEvent: {
        type: 'text_delta',
        contentIndex: 0,
        delta: 'Hello',
      },
    })
    state = apply(state, {
      type: 'message_update',
      usage,
      assistantMessageEvent: {
        type: 'text_end',
        contentIndex: 0,
        content: 'Hello world',
      },
    })
    state = apply(state, {
      type: 'message_update',
      usage,
      assistantMessageEvent: { type: 'thinking_start', contentIndex: 1 },
    })
    state = apply(state, {
      type: 'message_update',
      usage,
      assistantMessageEvent: {
        type: 'thinking_delta',
        contentIndex: 1,
        delta: 'Check',
      },
    })
    state = apply(state, {
      type: 'message_update',
      usage,
      assistantMessageEvent: {
        type: 'thinking_end',
        contentIndex: 1,
        content: 'Check complete',
      },
    })
    state = apply(state, {
      type: 'message_update',
      usage,
      assistantMessageEvent: { type: 'toolcall_start', contentIndex: 2 },
    })
    state = apply(state, {
      type: 'message_update',
      usage,
      assistantMessageEvent: {
        type: 'toolcall_delta',
        contentIndex: 2,
        delta: '{"command":',
      },
    })
    state = apply(state, {
      type: 'message_update',
      usage,
      assistantMessageEvent: {
        type: 'toolcall_delta',
        contentIndex: 2,
        delta: '"pwd"}',
      },
    })
    expect(state.streamingToolCallDeltas.get(2)).toBe('{"command":"pwd"}')

    state = apply(state, {
      type: 'message_update',
      usage,
      assistantMessageEvent: {
        type: 'toolcall_end',
        contentIndex: 2,
        toolCall: {
          type: 'toolCall',
          id: 'call-1',
          name: 'bash',
          arguments: { command: 'pwd' },
        },
      },
    })
    expect(state.streamingToolCallDeltas.has(2)).toBe(false)
    expect(state.streamingMessage?.content).toEqual([
      { type: 'text', text: 'Hello world' },
      { type: 'thinking', thinking: 'Check complete' },
      {
        type: 'toolCall',
        id: 'call-1',
        name: 'bash',
        arguments: { command: 'pwd' },
      },
    ])

    const finalMessage = assistant(
      [{ type: 'text', text: 'Authoritative final text' }],
      'stop',
    )
    state = apply(state, { type: 'message_end', message: finalMessage })
    expect(state.streamingMessage).toBeNull()
    expect(state.streamingContent.size).toBe(0)
    expect(state.messages).toEqual([finalMessage])
  })

  it('replaces cumulative tool progress and final result by tool-call id', () => {
    let state = createLocalPiProjectorState({
      generation: 7,
      sessionId: 'session-a',
    })
    state = apply(state, {
      type: 'tool_execution_start',
      toolCallId: 'call-1',
      toolName: 'bash',
      args: { command: 'pnpm test' },
    })
    state = apply(state, {
      type: 'tool_execution_update',
      toolCallId: 'call-1',
      toolName: 'bash',
      args: { command: 'pnpm test' },
      partialResult: {
        content: [{ type: 'text', text: 'first chunk' }],
        details: { lines: 1 },
      },
    })
    const beforeReplacement = state
    state = apply(state, {
      type: 'tool_execution_update',
      toolCallId: 'call-1',
      toolName: 'bash',
      args: { command: 'pnpm test' },
      partialResult: {
        content: [{ type: 'text', text: 'all output so far' }],
        details: { lines: 3 },
      },
    })
    expect(beforeReplacement.tools.get('call-1')?.result?.content).toEqual([
      { type: 'text', text: 'first chunk' },
    ])
    expect(state.tools.get('call-1')).toMatchObject({
      phase: 'running',
      resultIsPartial: true,
      result: { content: [{ type: 'text', text: 'all output so far' }] },
    })

    state = apply(state, {
      type: 'tool_execution_end',
      toolCallId: 'call-1',
      toolName: 'bash',
      result: {
        content: [{ type: 'text', text: 'final output' }],
        details: { exitCode: 0 },
      },
      isError: false,
    })
    expect(state.tools.get('call-1')).toMatchObject({
      phase: 'complete',
      resultIsPartial: false,
      isError: false,
      result: { content: [{ type: 'text', text: 'final output' }] },
    })
  })

  it('guards generations, preserves same-session queue details, and clears them on reset', () => {
    const initialMessage = {
      role: 'user' as const,
      content: 'Initial prompt',
      timestamp: 1,
    }
    let state = createLocalPiProjectorState({
      generation: 7,
      sessionId: 'session-a',
      messages: [initialMessage],
      pendingMessageCount: 4,
    })
    expect(state.queue).toEqual({
      pendingCount: 4,
      detailsKnown: false,
      steering: [],
      followUp: [],
    })

    const stale = applyLocalPiProjectorEvent(state, envelope({
      type: 'queue_update',
      steering: ['stale'],
      followUp: [],
    }, 6))
    expect(stale).toBe(state)

    state = apply(state, {
      type: 'queue_update',
      steering: ['guide now'],
      followUp: ['then summarize'],
    })
    expect(state.queue).toEqual({
      pendingCount: 2,
      detailsKnown: true,
      steering: ['guide now'],
      followUp: ['then summarize'],
    })

    state = replaceLocalPiProjectorSnapshot(state, {
      generation: 7,
      sessionId: 'session-a',
      messages: [initialMessage],
      entrySnapshot: null,
      pendingMessageCount: 2,
      isStreaming: true,
      isCompacting: false,
    })
    expect(state.queue).toEqual({
      pendingCount: 2,
      detailsKnown: true,
      steering: ['guide now'],
      followUp: ['then summarize'],
    })

    state = replaceLocalPiProjectorSnapshot(state, {
      generation: 7,
      sessionId: 'session-a',
      messages: [initialMessage],
      entrySnapshot: null,
      pendingMessageCount: 3,
      isStreaming: true,
      isCompacting: false,
    })
    expect(state.queue).toEqual({
      pendingCount: 3,
      detailsKnown: false,
      steering: [],
      followUp: [],
    })

    state = resetLocalPiProjectorState(state, {
      generation: 8,
      sessionId: 'session-b',
    })
    expect(state).toMatchObject({
      generation: 8,
      sessionId: 'session-b',
      messages: [],
      queue: {
        pendingCount: 0,
        detailsKnown: false,
        steering: [],
        followUp: [],
      },
    })

    const oldSnapshot = replaceLocalPiProjectorSnapshot(state, {
      generation: 7,
      sessionId: 'session-a',
      messages: [initialMessage],
      entrySnapshot: null,
      pendingMessageCount: 1,
      isStreaming: false,
      isCompacting: false,
    })
    expect(oldSnapshot).toBe(state)

    state = replaceLocalPiProjectorSnapshot(state, {
      generation: 8,
      sessionId: 'session-b',
      messages: [initialMessage],
      entrySnapshot: null,
      pendingMessageCount: 3,
      isStreaming: true,
      isCompacting: true,
    })
    expect(state).toMatchObject({
      isStreaming: true,
      messages: [initialMessage],
      queue: { pendingCount: 3, detailsKnown: false },
      compaction: { active: true },
    })
  })

  it('projects compaction, retry, extension errors, and settlement refresh', () => {
    let state = createLocalPiProjectorState({
      generation: 7,
      sessionId: 'session-a',
    })
    state = apply(state, { type: 'compaction_start', reason: 'threshold' })
    expect(state.compaction).toMatchObject({ active: true, reason: 'threshold' })

    state = apply(state, {
      type: 'compaction_end',
      reason: 'threshold',
      aborted: false,
      willRetry: false,
      errorMessage: 'Compaction failed',
    })
    expect(state.compaction).toEqual({
      active: false,
      reason: 'threshold',
      result: null,
      aborted: false,
      willRetry: false,
      errorMessage: 'Compaction failed',
    })

    state = apply(state, {
      type: 'auto_retry_start',
      attempt: 1,
      maxAttempts: 3,
      delayMs: 2_000,
      errorMessage: 'overloaded',
    })
    expect(state.retry).toMatchObject({
      kind: 'auto',
      phase: 'waiting',
      errorMessage: 'overloaded',
    })
    state = apply(state, {
      type: 'auto_retry_end',
      success: false,
      attempt: 3,
      finalError: 'still overloaded',
    })
    expect(state.retry).toEqual({
      kind: 'auto',
      phase: 'finished',
      attempt: 3,
      success: false,
      finalError: 'still overloaded',
    })

    state = apply(state, {
      type: 'summarization_retry_scheduled',
      attempt: 1,
      maxAttempts: 3,
      delayMs: 500,
      errorMessage: 'terminated',
    })
    state = apply(state, {
      type: 'summarization_retry_attempt_start',
      source: 'compaction',
      reason: 'threshold',
    })
    expect(state.retry).toEqual({
      kind: 'summarization',
      phase: 'attempting',
      source: 'compaction',
      reason: 'threshold',
    })
    state = apply(state, { type: 'summarization_retry_finished' })
    expect(state.retry).toEqual({
      kind: 'summarization',
      phase: 'finished',
    })

    state = apply(state, {
      type: 'extension_error',
      extensionPath: '/tmp/extension.ts',
      event: 'tool_call',
      error: 'Extension failed',
    })
    expect(state.extensionErrors).toEqual([{
      type: 'extension_error',
      extensionPath: '/tmp/extension.ts',
      event: 'tool_call',
      error: 'Extension failed',
    }])

    state = apply(state, { type: 'agent_settled' })
    expect(state).toMatchObject({
      isStreaming: false,
      isTurnActive: false,
      shouldRefreshSnapshot: true,
    })
  })
})
