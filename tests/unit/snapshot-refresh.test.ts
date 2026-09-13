import { describe, expect, it, vi } from 'vitest'
import type { LocalPiAssistantMessage, LocalPiRpcEvent, LocalPiSessionState, LocalPiToolResultMessage } from '../../src/shared/local-pi'
import { applyLocalPiProjectorEvent, createLocalPiProjectorState, type LocalPiProjectorSnapshot } from '../../src/renderer/pi-rpc/projector'
import { projectLocalPiTurns } from '../../src/renderer/pi-rpc/presentation'
import {
  advancePiSnapshotWatermark,
  createPiSnapshotWatermark,
  reconcilePiProjectorSnapshot,
  reconcilePiSessionSnapshot,
  refreshPiSnapshot,
} from '../../src/renderer/pi-rpc/snapshot-refresh'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

const oldMessage = { role: 'user' as const, content: 'Earlier history', timestamp: 1 }
const assistant: LocalPiAssistantMessage = {
  role: 'assistant', content: [], provider: 'fixture', model: 'fixture',
  api: 'openai-completions', stopReason: 'pending', timestamp: 2,
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
}
const snapshot: LocalPiProjectorSnapshot = {
  generation: 7, sessionId: 'session-a', messages: [oldMessage],
  entrySnapshot: null, pendingMessageCount: 0, isStreaming: false, isCompacting: false,
}
const session: LocalPiSessionState = {
  sessionId: 'session-a', sessionFile: '/fixture/session-a.jsonl',
  thinkingLevel: 'off', isStreaming: false, isCompacting: false,
  steeringMode: 'one-at-a-time', followUpMode: 'one-at-a-time',
  autoCompactionEnabled: true, messageCount: 1, pendingMessageCount: 0,
}

function harness(hydrated = false) {
  let watermark = createPiSnapshotWatermark()
  let state = createLocalPiProjectorState({ ...snapshot, messages: hydrated ? snapshot.messages : [] })
  let owner = 1
  let sequence = 0
  return {
    get state() { return state },
    get watermark() { return watermark },
    invalidate() { owner += 1 },
    emit(event: LocalPiRpcEvent) {
      watermark = advancePiSnapshotWatermark(watermark, event)
      state = applyLocalPiProjectorEvent(state, { generation: 7, eventId: `event-${++sequence}`, event })
    },
    refresh(read: () => Promise<LocalPiProjectorSnapshot>) {
      const expectedOwner = owner
      return refreshPiSnapshot({
        isCurrent: () => owner === expectedOwner,
        watermark: () => watermark,
        read,
        apply: (next, startedAt) => { state = reconcilePiProjectorSnapshot(state, next, startedAt, watermark) },
      })
    },
  }
}

describe('conversation snapshot refresh', () => {
  it('hydrates complete older history while retaining a newer live thinking delta without retrying per token', async () => {
    const subject = harness()
    const pending = deferred<LocalPiProjectorSnapshot>()
    const read = vi.fn(() => pending.promise)
    const refresh = subject.refresh(read)
    subject.emit({ type: 'agent_start' })
    subject.emit({ type: 'message_start', message: assistant })
    subject.emit({ type: 'message_update', usage: assistant.usage, assistantMessageEvent: { type: 'thinking_start', contentIndex: 0 } })
    for (let index = 0; index < 100; index += 1) {
      subject.emit({ type: 'message_update', usage: assistant.usage, assistantMessageEvent: { type: 'thinking_delta', contentIndex: 0, delta: 'think ' } })
    }
    pending.resolve(snapshot)
    expect(await refresh).toBe(true)
    expect(read).toHaveBeenCalledTimes(1)
    expect(subject.state.messages).toEqual([oldMessage])
    expect(subject.state.streamingMessage?.content).toEqual([{ type: 'thinking', thinking: 'think '.repeat(100) }])
    expect(subject.state.isStreaming).toBe(true)
  })

  it('keeps a stream that already existed when the refresh started', async () => {
    const subject = harness(true)
    subject.emit({ type: 'agent_start' })
    subject.emit({ type: 'message_start', message: { ...assistant, content: [{ type: 'text', text: 'Already visible' }] } })
    await subject.refresh(async () => ({ ...snapshot, isStreaming: true }))
    expect(subject.state.streamingMessage?.content).toEqual([{ type: 'text', text: 'Already visible' }])
  })

  it.each([false, true])('re-reads after the stream settles during a delayed query (initially hydrated: %s)', async (hydrated) => {
    const subject = harness(hydrated)
    const pending = deferred<LocalPiProjectorSnapshot>()
    const completed: LocalPiAssistantMessage = { ...assistant, stopReason: 'stop', content: [{ type: 'thinking', thinking: 'Keep reasoning' }, { type: 'text', text: 'Done' }] }
    const read = vi.fn().mockImplementationOnce(() => pending.promise).mockResolvedValue({ ...snapshot, messages: [oldMessage, completed] })
    const refresh = subject.refresh(read)
    subject.emit({ type: 'message_start', message: assistant })
    subject.emit({ type: 'message_end', message: completed })
    subject.emit({ type: 'agent_settled' })
    pending.resolve(snapshot)
    expect(await refresh).toBe(true)
    expect(read).toHaveBeenCalledTimes(2)
    expect(subject.state.messages).toEqual([oldMessage, completed])
    expect(subject.state.streamingMessage).toBeNull()
    expect(subject.state.isStreaming).toBe(false)
  })

  it('preserves tool progress, retry, diagnostics and the newer queue across a delayed read', async () => {
    const subject = harness(true)
    const pending = deferred<LocalPiProjectorSnapshot>()
    const refresh = subject.refresh(() => pending.promise)
    subject.emit({ type: 'tool_execution_start', toolCallId: 'tool-1', toolName: 'bash', args: { command: 'pwd' } })
    subject.emit({ type: 'tool_execution_update', toolCallId: 'tool-1', toolName: 'bash', args: { command: 'pwd' }, partialResult: { content: [{ type: 'text', text: 'progress' }] } })
    subject.emit({ type: 'queue_update', steering: ['Keep images'], followUp: ['Then summarize'] })
    subject.emit({ type: 'auto_retry_start', attempt: 1, maxAttempts: 3, delayMs: 100, errorMessage: 'Retrying fixture' })
    const before = subject.state
    pending.resolve(snapshot)
    await refresh
    expect(subject.state.tools).toEqual(before.tools)
    expect(subject.state.queue).toEqual(before.queue)
    expect(subject.state.retry).toEqual(before.retry)
  })

  it('uses the persisted final output when the live tool completion event was lost', async () => {
    const subject = harness(true)
    subject.emit({ type: 'agent_start' })
    subject.emit({ type: 'tool_execution_update', toolCallId: 'tool-1', toolName: 'bash', args: { command: 'pwd' }, partialResult: { content: [{ type: 'text', text: 'partial output' }] } })
    const call: LocalPiAssistantMessage = { ...assistant, stopReason: 'toolUse', content: [{ type: 'toolCall', id: 'tool-1', name: 'bash', arguments: { command: 'pwd' } }] }
    const result: LocalPiToolResultMessage = {
      role: 'toolResult', toolCallId: 'tool-1', toolName: 'bash',
      content: [{ type: 'text', text: 'final output' }], isError: false, timestamp: 3,
    }
    await subject.refresh(async () => ({ ...snapshot, isStreaming: true, messages: [oldMessage, call, result] }))
    const tools = projectLocalPiTurns(subject.state).filter((turn) => turn.kind === 'tool')
    expect(subject.state.tools.has('tool-1')).toBe(false)
    expect(tools).toHaveLength(1)
    expect(tools[0]?.call.status).toBe('success')
    expect(tools[0]?.call.output).toBe('final output')
  })

  it('removes completed and stale running tools no longer present after compaction', async () => {
    const subject = harness(true)
    subject.emit({ type: 'tool_execution_start', toolCallId: 'removed-running', toolName: 'bash', args: { command: 'pwd' } })
    subject.emit({ type: 'tool_execution_end', toolCallId: 'removed-complete', toolName: 'bash', result: { content: [{ type: 'text', text: 'obsolete result' }] }, isError: false })
    subject.emit({ type: 'compaction_end', reason: 'threshold', aborted: false, willRetry: false })
    // A subsequent response may already be running; that does not make tools
    // from the compacted history belong to the new response.
    await subject.refresh(async () => ({ ...snapshot, isStreaming: true }))
    expect(subject.state.tools.size).toBe(0)
    expect(projectLocalPiTurns(subject.state).filter((turn) => turn.kind === 'tool')).toEqual([])
  })

  it('retains an existing running tool anchored in authoritative history', async () => {
    const subject = harness(true)
    const call: LocalPiAssistantMessage = { ...assistant, stopReason: 'toolUse', content: [{ type: 'toolCall', id: 'live-tool', name: 'bash', arguments: { command: 'pwd' } }] }
    subject.emit({ type: 'tool_execution_update', toolCallId: 'live-tool', toolName: 'bash', args: { command: 'pwd' }, partialResult: { content: [{ type: 'text', text: 'still working' }] } })
    await subject.refresh(async () => ({ ...snapshot, isStreaming: true, messages: [oldMessage, call] }))
    const tool = projectLocalPiTurns(subject.state).find((turn) => turn.kind === 'tool')
    expect(tool?.call.status).toBe('running')
    expect(tool?.call.progress).toBe('still working')
  })

  it('lets newer session events win over an older state response', () => {
    const start = createPiSnapshotWatermark()
    let latest = start
    for (const event of [
      { type: 'agent_start' }, { type: 'queue_update', steering: ['next'], followUp: [] },
      { type: 'compaction_start', reason: 'threshold' }, { type: 'session_info_changed', name: 'New name' },
      { type: 'thinking_level_changed', level: 'high' },
    ] satisfies LocalPiRpcEvent[]) latest = advancePiSnapshotWatermark(latest, event)
    const current = { ...session, isStreaming: true, isCompacting: true, pendingMessageCount: 1, sessionName: 'New name', thinkingLevel: 'high' as const }
    expect(reconcilePiSessionSnapshot(session, current, start, latest)).toEqual(current)
  })

  it('rejects delayed responses after A→B→A instead of trusting repeated generation/session values', async () => {
    const subject = harness(true)
    const pending = deferred<LocalPiProjectorSnapshot>()
    const refresh = subject.refresh(() => pending.promise)
    const before = subject.state
    subject.invalidate()
    subject.invalidate()
    pending.resolve({ ...snapshot, messages: [] })
    expect(await refresh).toBe(false)
    expect(subject.state).toBe(before)
  })

  it('does not apply an older request after a newer refresh takes ownership', async () => {
    const subject = harness(true)
    const pending = deferred<LocalPiProjectorSnapshot>()
    const first = subject.refresh(() => pending.promise)
    subject.invalidate()
    const current = { ...snapshot, messages: [oldMessage, { ...oldMessage, content: 'New snapshot' }] }
    expect(await subject.refresh(async () => current)).toBe(true)
    pending.resolve(snapshot)
    expect(await first).toBe(false)
    expect(subject.state.messages).toEqual(current.messages)
  })

  it('retries compaction or persisted entry changes, but bounds repeated history conflicts', async () => {
    const subject = harness(true)
    const read = vi.fn(async () => {
      subject.emit({ type: 'agent_settled' })
      return { ...snapshot, messages: [] }
    })
    await expect(subject.refresh(read)).rejects.toThrow('Please retry loading')
    expect(read).toHaveBeenCalledTimes(4)
    expect(subject.state.messages).toEqual([oldMessage])
  })

  it('does not hide current failures or report failures belonging to a stale owner', async () => {
    const subject = harness()
    await expect(subject.refresh(async () => { throw new Error('offline') })).rejects.toThrow('offline')
    expect(await subject.refresh(async () => {
      subject.invalidate()
      throw new Error('old owner offline')
    })).toBe(false)
  })
})
