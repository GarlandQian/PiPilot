import { describe, expect, it } from 'vitest'
import {
  createRuntimeActivity,
  isDeliverySnapshotBusy,
  isRuntimeIdle,
  isSessionStateBusy,
  reduceRuntimeActivity,
  summarizeRuntimeActivity,
  type RuntimeActivity,
} from '../../src/main/pi-host/runtime-activity'
import type { LocalPiDeliverySnapshot, LocalPiRpcEvent, LocalPiSessionState } from '../../src/shared/local-pi'

const idleState: LocalPiSessionState = {
  thinkingLevel: 'medium',
  isStreaming: false,
  isCompacting: false,
  steeringMode: 'one-at-a-time',
  followUpMode: 'one-at-a-time',
  sessionId: 'session',
  autoCompactionEnabled: true,
  messageCount: 0,
  pendingMessageCount: 0,
}

function event(activity: RuntimeActivity, input: LocalPiRpcEvent) {
  return reduceRuntimeActivity(activity, { type: 'event', event: input })
}

function delivery(status: LocalPiDeliverySnapshot['items'][number]['status'], paused = false): LocalPiDeliverySnapshot {
  return {
    revision: 1, paused,
    items: [{ id: 'item', submissionId: 'submission', message: 'Later', mode: 'follow_up', status }],
    receipts: [],
  }
}

describe('runtime activity ownership', () => {
  it('keeps accepting commands and control leases protected independently from visible execution', () => {
    let state = createRuntimeActivity(idleState)
    state = reduceRuntimeActivity(state, { type: 'control_pin', delta: 1 })
    state = reduceRuntimeActivity(state, { type: 'control_pin', delta: 1 })
    expect(summarizeRuntimeActivity(state).lifecycle).toBe('idle')
    expect(isRuntimeIdle(state)).toBe(false)
    state = reduceRuntimeActivity(state, { type: 'command_started' })
    state = reduceRuntimeActivity(state, { type: 'command_started' })
    expect(summarizeRuntimeActivity(state).lifecycle).toBe('accepting')
    state = reduceRuntimeActivity(state, { type: 'control_pins_cleared' })
    state = reduceRuntimeActivity(state, { type: 'command_finished' })
    expect(isRuntimeIdle(state)).toBe(false)
    state = reduceRuntimeActivity(state, { type: 'command_finished' })
    expect(isRuntimeIdle(state)).toBe(true)
    expect(state.pendingCommands).toBe(0)
  })

  it('waits for authoritative settlement, not agent_end, before making execution reclaimable', () => {
    const running = event(createRuntimeActivity(), { type: 'agent_start' })
    const ended = event(running, { type: 'agent_end', willRetry: false, messages: [] })
    expect(isRuntimeIdle(ended)).toBe(false)
    expect(summarizeRuntimeActivity(ended)).toMatchObject({ lifecycle: 'running', outcome: 'completed' })
    expect(isRuntimeIdle(event(ended, { type: 'agent_settled' }))).toBe(true)
  })

  it.each([
    ['stop', 'completed'], ['error', 'failed'], ['aborted', 'cancelled'],
  ] as const)('retains %s as %s through settlement and idle reads until the next run', (stopReason, outcome) => {
    let state = event(createRuntimeActivity(), { type: 'agent_start' })
    state = event(state, {
      type: 'agent_end', willRetry: false,
      messages: [{
        role: 'assistant', content: [], api: 'test', provider: 'fixture', model: 'fixture',
        usage: {
          input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason, timestamp: 1,
      }],
    })
    expect(summarizeRuntimeActivity(state)).toMatchObject({ lifecycle: 'running', outcome })
    state = event(state, { type: 'agent_settled' })
    state = reduceRuntimeActivity(state, {
      type: 'session_state', state: idleState, expectedStateRevision: state.stateRevision,
    })
    expect(summarizeRuntimeActivity(state)).toEqual({ lifecycle: 'idle', queueCount: 0, outcome })
    expect(isRuntimeIdle(state)).toBe(true)
    expect(summarizeRuntimeActivity(event(state, { type: 'agent_start' })))
      .toEqual({ lifecycle: 'running', queueCount: 0, activity: 'prompt' })
  })

  it('preserves independently observed retry, tools, and extension UI when get_state looks idle', () => {
    let state = event(createRuntimeActivity(), { type: 'agent_start' })
    state = event(state, { type: 'tool_execution_start', toolCallId: 'tool', toolName: 'bash', args: {} })
    state = event(state, { type: 'auto_retry_start', attempt: 1, maxAttempts: 3, delayMs: 100, errorMessage: 'retry' })
    state = reduceRuntimeActivity(state, { type: 'ui_request', request: {
      type: 'extension_ui_request', id: 'question', method: 'input', title: 'Answer',
    } })
    const readBack = reduceRuntimeActivity(state, {
      type: 'session_state', state: idleState, expectedStateRevision: state.stateRevision,
    })
    expect(readBack.agentRunning).toBe(false)
    expect(readBack.activeToolCalls.has('tool')).toBe(true)
    expect(readBack.retryRunning).toBe(true)
    expect(readBack.pendingUiRequests.has('question')).toBe(true)
    expect(isRuntimeIdle(readBack)).toBe(false)
    expect(summarizeRuntimeActivity(readBack).activity).toBe('interaction')
  })

  it('keeps retry protected across settlement until its own end event', () => {
    let state = event(createRuntimeActivity(), { type: 'agent_start' })
    state = event(state, { type: 'agent_end', willRetry: true, messages: [] })
    state = event(state, { type: 'agent_settled' })
    expect(isRuntimeIdle(state)).toBe(false)
    expect(summarizeRuntimeActivity(state).activity).toBe('retry')
    state = event(state, { type: 'auto_retry_end', attempt: 1, success: true })
    expect(isRuntimeIdle(state)).toBe(true)
  })

  it('retains immutable tool/UI sets and only dismisses the matching interaction', () => {
    const initial = createRuntimeActivity()
    const tool = event(initial, { type: 'tool_execution_start', toolCallId: 'one', toolName: 'bash', args: {} })
    expect(initial.activeToolCalls.size).toBe(0)
    expect(tool.activeToolCalls.size).toBe(1)
    let state = tool
    for (const id of ['one', 'two']) state = reduceRuntimeActivity(state, {
      type: 'ui_request', request: { type: 'extension_ui_request', id, method: 'input', title: 'Input' },
    })
    const responded = reduceRuntimeActivity(state, { type: 'ui_responded', id: 'one' })
    expect([...state.pendingUiRequests]).toEqual(['one', 'two'])
    expect([...responded.pendingUiRequests]).toEqual(['two'])
    expect(reduceRuntimeActivity(responded, { type: 'ui_responded', id: 'one' })).toBe(responded)
    expect(isRuntimeIdle(event(responded, { type: 'agent_settled' }))).toBe(false)
  })

  it('advances revision for command ownership and real transitions while ignoring repeated events', () => {
    const initial = createRuntimeActivity(idleState)
    const started = event(initial, { type: 'agent_start' })
    const duplicate = event(started, { type: 'agent_start' })
    expect(duplicate.revision).toBe(started.revision)
    expect(duplicate.stateRevision).toBe(started.stateRevision + 1)
    expect(started.revision).toBe(initial.revision + 1)
    const command = reduceRuntimeActivity(duplicate, { type: 'command_started' })
    const ended = reduceRuntimeActivity(command, { type: 'command_finished' })
    expect(ended.revision).toBe(started.revision + 2)
    expect(ended.pendingCommands).toBe(0)
    expect(ended.agentRunning).toBe(true)
    expect(ended.stateRevision).toBe(duplicate.stateRevision)
  })

  it('rejects state samples older than execution events without losing command ownership', () => {
    const running = event(createRuntimeActivity(), { type: 'agent_start' })
    const accepting = reduceRuntimeActivity(running, { type: 'command_started' })
    const settled = event(accepting, { type: 'agent_settled' })
    const rejected = reduceRuntimeActivity(settled, {
      type: 'session_state', state: { ...idleState, isStreaming: true },
      expectedStateRevision: running.stateRevision,
    })
    expect(rejected).toBe(settled)
    expect(rejected.pendingCommands).toBe(1)
    expect(rejected.agentRunning).toBe(false)
    const fresh = reduceRuntimeActivity(rejected, {
      type: 'session_state', state: { ...idleState, pendingMessageCount: 2 },
      expectedStateRevision: rejected.stateRevision,
    })
    expect(fresh.queuedMessages).toBe(2)
  })

  it('uses queue counts for lifecycle without confusing queue acceptance with immediate execution', () => {
    let state = createRuntimeActivity(idleState)
    state = reduceRuntimeActivity(state, {
      type: 'prompt_accepted', mode: 'queued', expectedEventRevision: state.eventRevision,
    })
    expect(summarizeRuntimeActivity(state)).toMatchObject({ lifecycle: 'queued', queueCount: 1 })
    expect(state.agentRunning).toBe(false)
    state = event(state, { type: 'queue_update', steering: ['steer'], followUp: ['later', 'last'] })
    expect(summarizeRuntimeActivity(state).queueCount).toBe(3)
    state = event(state, { type: 'queue_update', steering: [], followUp: [] })
    state = reduceRuntimeActivity(state, {
      type: 'prompt_accepted', mode: 'prompt', expectedEventRevision: state.eventRevision,
    })
    expect(summarizeRuntimeActivity(state)).toEqual({ lifecycle: 'running', queueCount: 0, activity: 'prompt' })
  })

  it.each([
    ['queued', false, 'queued', false],
    ['delivering', false, 'running', false],
    ['delivering', true, 'running', false],
    ['frozen', true, 'idle', true],
    ['unknown', false, 'idle', true],
    ['queued', true, 'idle', true],
  ] as const)('keeps %s (paused=%s) visible with lifecycle %s and reclaimable=%s', (status, paused, lifecycle, idle) => {
    const snapshot = delivery(status, paused)
    let state = event(createRuntimeActivity(idleState), { type: 'delivery_state', delivery: snapshot })
    state = event(state, { type: 'agent_settled' })
    state = reduceRuntimeActivity(state, { type: 'session_state', state: idleState, expectedStateRevision: state.stateRevision })
    expect(summarizeRuntimeActivity(state)).toMatchObject({ lifecycle, queueCount: 1 })
    expect(isRuntimeIdle(state)).toBe(idle)
    expect(isDeliverySnapshotBusy(snapshot)).toBe(!idle)
    expect(state.queuedMessages).toBe(0)
  })

  it('counts managed native steering once while retaining separate host and extension queues', () => {
    let state = event(createRuntimeActivity(idleState), { type: 'queue_update', steering: ['managed steer', 'extension'], followUp: [] })
    state = event(state, { type: 'delivery_state', delivery: {
      revision: 1, paused: false, receipts: [], items: [
        { id: 'steer', submissionId: 'one', message: 'managed steer', mode: 'steer', status: 'delivering' },
        { id: 'later', submissionId: 'two', message: 'Later', mode: 'follow_up', status: 'queued' },
      ],
    } })
    expect(summarizeRuntimeActivity(state)).toMatchObject({ lifecycle: 'queued', queueCount: 3, activity: 'prompt' })
    expect(isRuntimeIdle(state)).toBe(false)
  })

  it('protects a reserved acceptance before it has an item and releases terminal receipts', () => {
    const snapshot: LocalPiDeliverySnapshot = { revision: 1, paused: false, items: [], receipts: [{ submissionId: 'one', status: 'accepting' }] }
    let state = event(createRuntimeActivity(idleState), { type: 'delivery_state', delivery: snapshot })
    expect(isRuntimeIdle(state)).toBe(false)
    expect(isDeliverySnapshotBusy(snapshot)).toBe(true)
    expect(summarizeRuntimeActivity(state)).toMatchObject({ lifecycle: 'accepting', queueCount: 0 })
    state = event(state, { type: 'delivery_state', delivery: { ...snapshot, revision: 2, receipts: [{ submissionId: 'one', status: 'unknown' }] } })
    expect(isRuntimeIdle(state)).toBe(true)
  })

  it('rejects stale ledger reads but accepts revision zero after a runtime session reset', () => {
    const queued = event(createRuntimeActivity(idleState), { type: 'delivery_state', delivery: delivery('queued') })
    const stale = reduceRuntimeActivity(queued, { type: 'delivery_state', delivery: { ...delivery('frozen', true), revision: 0 } })
    expect(stale).toBe(queued)
    let reset = reduceRuntimeActivity(stale, { type: 'delivery_reset' })
    reset = reduceRuntimeActivity(reset, { type: 'delivery_state', delivery: { ...delivery('frozen', true), revision: 0 } })
    expect(summarizeRuntimeActivity(reset)).toMatchObject({ lifecycle: 'idle', queueCount: 1 })
  })

  it.each([
    { isStreaming: true }, { isCompacting: true }, { pendingMessageCount: 1 },
  ])('keeps the independent SDK busy veto for $isStreaming $isCompacting $pendingMessageCount', (busy) => {
    expect(isRuntimeIdle(createRuntimeActivity(idleState))).toBe(true)
    expect(isSessionStateBusy({ ...idleState, ...busy })).toBe(true)
    expect(isSessionStateBusy(idleState)).toBe(false)
  })
})
