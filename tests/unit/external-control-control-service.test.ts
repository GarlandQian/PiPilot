import { describe, expect, it, vi } from 'vitest'
import {
  EXTERNAL_CONTROL_MAX_FINAL_RESPONSE_BYTES,
  EXTERNAL_CONTROL_MAX_PRE_ACCEPTANCE_BYTES,
  type ExternalControlOperation,
} from '../../src/shared/external-control'
import type { ConversationScope } from '../../src/shared/conversation-scope'
import type {
  LocalPiAssistantMessage,
  LocalPiRpcEvent,
  LocalPiSessionState,
} from '../../src/shared/local-pi'
import type { PiHostUiRequestEventEnvelope } from '../../src/shared/pi-host-protocol'
import { PI_HOST_PROTOCOL_VERSION } from '../../src/shared/pi-host-protocol'
import type { ConversationMcpAuditRepository } from '../../src/main/external-control/audit-repository'
import { ConversationMcpControlService } from '../../src/main/external-control/conversation-control-service'
import type {
  ConversationMcpInventoryService,
  ConversationMcpResolvedTarget,
} from '../../src/main/external-control/conversation-inventory'
import { ConversationMcpOperationRegistry } from '../../src/main/external-control/operation-registry'
import type {
  PiRuntimeControlHandle,
  PiRuntimeControlLease,
  PiRuntimeControlSummary,
  PiRuntimeFrontend,
  PiRuntimeFrontendTarget,
} from '../../src/main/pi-host/pi-runtime-frontend'

const conversationId = `conv_${'c'.repeat(43)}`
const projectScope = {
  kind: 'project',
  workspaceId: '00000000-0000-4000-8000-000000000601',
} as const satisfies ConversationScope

interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function assistantMessage(text: string): LocalPiAssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: 'messages',
    provider: 'test-provider',
    model: 'test-model',
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
      },
    },
    stopReason: 'stop',
    timestamp: 1,
  }
}

function userEntry(text: string, id: string): LocalPiRpcEvent {
  return {
    type: 'entry_appended',
    entry: {
      id,
      parentId: null,
      timestamp: '2026-08-22T00:00:00.000Z',
      type: 'message',
      message: {
        role: 'user',
        content: text,
        timestamp: 1,
      },
    },
  }
}

function finalMessage(text: string): LocalPiRpcEvent {
  return { type: 'message_end', message: assistantMessage(text) }
}

type SubmitResult = {
  handle: PiRuntimeControlHandle
  acceptedMode: 'prompt' | 'follow_up' | 'steer'
}

class FakeRuntimeControl {
  readonly handle: PiRuntimeControlHandle = {
    hostEpoch: 1,
    runtimeId: 'rt_external_control',
    generation: 1,
    scope: projectScope,
    sessionFile: '/sessions/external-control.jsonl',
    sessionId: 'session-external-control',
  }
  summary: PiRuntimeControlSummary = {
    ...this.handle,
    selected: false,
    lifecycle: 'idle',
    queueCount: 0,
  }
  acquireGate: Promise<void> | null = null
  controlStateOverride: LocalPiSessionState | null = null
  private readonly submitGates: Array<Deferred<SubmitResult>> = []
  private readonly abortGates: Array<Deferred<PiRuntimeControlHandle>> = []
  private readonly eventListeners = new Set<(
    event: LocalPiRpcEvent,
    handle: PiRuntimeControlHandle,
  ) => void | Promise<void>>()
  private readonly uiListeners = new Set<(
    event: PiHostUiRequestEventEnvelope,
    handle: PiRuntimeControlHandle,
  ) => void | Promise<void>>()
  private readonly runtimeListeners = new Set<(
    summaries: PiRuntimeControlSummary[],
  ) => void>()

  readonly acquireControlRuntime = vi.fn(async (
    _target: PiRuntimeFrontendTarget,
  ): Promise<PiRuntimeControlLease> => {
    if (this.acquireGate) await this.acquireGate
    return { ...this.handle, leaseId: Symbol('control-lease') }
  })

  readonly releaseControlRuntime = vi.fn((_lease: PiRuntimeControlLease) => true)

  readonly submitControlPrompt = vi.fn(async (
    _lease: PiRuntimeControlHandle,
    _prompt: string,
    mode: 'auto' | 'prompt' | 'follow_up' | 'steer',
  ): Promise<SubmitResult> => {
    const gate = this.submitGates.shift()
    const acceptedMode = mode === 'auto'
      ? (this.summary.lifecycle === 'idle' ? 'prompt' : 'follow_up')
      : mode
    const result = gate
      ? await gate.promise
      : { handle: { ...this.handle }, acceptedMode }
    this.summary = {
      ...this.summary,
      lifecycle: result.acceptedMode === 'prompt' ? 'running' : 'queued',
      queueCount: result.acceptedMode === 'prompt' ? 0 : 1,
    }
    return result
  })

  readonly getControlRuntimeState = vi.fn(async (): Promise<LocalPiSessionState> =>
    structuredClone(this.controlStateOverride ?? {
      thinkingLevel: 'medium',
      isStreaming: this.summary.lifecycle !== 'idle',
      isCompacting: false,
      steeringMode: 'one-at-a-time',
      followUpMode: 'one-at-a-time',
      sessionFile: this.handle.sessionFile ?? undefined,
      sessionId: this.handle.sessionId,
      autoCompactionEnabled: true,
      messageCount: 0,
      pendingMessageCount: this.summary.queueCount,
    }))

  readonly abortControlRuntime = vi.fn(async (
    _lease: PiRuntimeControlHandle,
  ): Promise<PiRuntimeControlHandle> => {
    const gate = this.abortGates.shift()
    return gate ? gate.promise : { ...this.handle }
  })

  readonly listControlRuntimes = vi.fn(() => [structuredClone(this.summary)])

  readonly respondToControlExtensionUi = vi.fn(async (
    _handle: PiRuntimeControlHandle,
    _response: unknown,
  ) => undefined)

  readonly subscribeAllEvents = vi.fn((listener: (
    event: LocalPiRpcEvent,
    handle: PiRuntimeControlHandle,
  ) => void | Promise<void>) => {
    this.eventListeners.add(listener)
    return () => this.eventListeners.delete(listener)
  })

  readonly subscribeAllUiRequests = vi.fn((listener: (
    event: PiHostUiRequestEventEnvelope,
    handle: PiRuntimeControlHandle,
  ) => void | Promise<void>) => {
    this.uiListeners.add(listener)
    return () => this.uiListeners.delete(listener)
  })

  readonly subscribeControlRuntimes = vi.fn((listener: (
    summaries: PiRuntimeControlSummary[],
  ) => void) => {
    this.runtimeListeners.add(listener)
    return () => this.runtimeListeners.delete(listener)
  })

  delayNextSubmit() {
    const gate = deferred<SubmitResult>()
    this.submitGates.push(gate)
    return gate
  }

  delayNextAbort() {
    const gate = deferred<PiRuntimeControlHandle>()
    this.abortGates.push(gate)
    return gate
  }

  async emitEvent(
    event: LocalPiRpcEvent,
    handle: PiRuntimeControlHandle = this.handle,
  ) {
    await Promise.all([...this.eventListeners].map((listener) =>
      listener(structuredClone(event), structuredClone(handle))))
  }

  async emitBlockingUi(id = 'external-confirm') {
    const event: PiHostUiRequestEventEnvelope = {
      kind: 'ui_request',
      protocolVersion: PI_HOST_PROTOCOL_VERSION,
      hostEpoch: this.handle.hostEpoch,
      runtimeId: this.handle.runtimeId,
      runtimeGeneration: this.handle.generation,
      sequence: 1,
      request: {
        type: 'extension_ui_request',
        id,
        method: 'confirm',
        title: 'Confirm external work',
        message: 'Continue?',
      },
    }
    await Promise.all([...this.uiListeners].map((listener) =>
      listener(structuredClone(event), structuredClone(this.handle))))
  }

  emitSummaries(summaries: PiRuntimeControlSummary[]) {
    for (const listener of this.runtimeListeners) {
      listener(structuredClone(summaries))
    }
  }
}

class FakeInventory {
  revalidateGate: Promise<void> | null = null

  constructor(readonly target: ConversationMcpResolvedTarget) {}

  readonly listConversations = vi.fn(async () => ({
    conversations: [structuredClone(this.target.conversation)],
    nextCursor: null,
    diagnostics: [],
  }))

  readonly getConversationStatus = vi.fn(async () => ({
    conversation: structuredClone(this.target.conversation),
  }))

  readonly resolveConversation = vi.fn(async (requestedId: string) => {
    if (requestedId !== this.target.conversation.conversationId) {
      throw new Error('Unknown conversation fixture.')
    }
    return structuredClone(this.target)
  })

  readonly revalidateTarget = vi.fn(async (target: ConversationMcpResolvedTarget) => {
    if (this.revalidateGate) await this.revalidateGate
    return structuredClone(target)
  })
}

class FakeAudit {
  readonly rows: ExternalControlOperation[] = []
  readonly append = vi.fn((operation: ExternalControlOperation) => {
    this.rows.push(structuredClone(operation))
  })
  readonly flush = vi.fn(async () => undefined)
}

function createHarness(
  runtimeLifecycle: PiRuntimeControlSummary['lifecycle'] = 'idle',
  conversationLifecycle: ConversationMcpResolvedTarget['conversation']['lifecycle'] =
    runtimeLifecycle,
) {
  const runtime = new FakeRuntimeControl()
  runtime.summary = { ...runtime.summary, lifecycle: runtimeLifecycle }
  const target: ConversationMcpResolvedTarget = {
    conversation: {
      conversationId,
      name: 'External control test',
      createdAt: '2026-08-20T00:00:00.000Z',
      modifiedAt: '2026-08-22T00:00:00.000Z',
      lifecycle: conversationLifecycle,
      queueCount: 0,
    },
    runtime: structuredClone(runtime.summary),
  }
  const inventory = new FakeInventory(target)
  let operationSequence = 0
  let clock = Date.parse('2026-08-22T00:00:00.000Z')
  const operations = new ConversationMcpOperationRegistry({
    createId: () => String(++operationSequence).padStart(32, '0'),
    now: () => clock++,
  })
  const audit = new FakeAudit()
  const service = new ConversationMcpControlService(
    inventory as unknown as Pick<
      ConversationMcpInventoryService,
      'getConversationStatus' | 'listConversations' | 'resolveConversation' | 'revalidateTarget'
    >,
    runtime as unknown as Pick<
      PiRuntimeFrontend,
      | 'abortControlRuntime'
      | 'acquireControlRuntime'
      | 'getControlRuntimeState'
      | 'listControlRuntimes'
      | 'releaseControlRuntime'
      | 'respondToControlExtensionUi'
      | 'submitControlPrompt'
      | 'subscribeAllEvents'
      | 'subscribeAllUiRequests'
      | 'subscribeControlRuntimes'
    >,
    operations,
    audit as unknown as ConversationMcpAuditRepository,
  )
  return { audit, inventory, operations, runtime, service }
}

async function waitForStatus(
  operations: ConversationMcpOperationRegistry,
  operationId: string,
  status: ExternalControlOperation['status'],
) {
  await vi.waitFor(() => {
    expect(operations.get(operationId).status).toBe(status)
  })
  return operations.get(operationId)
}

describe('ConversationMcpControlService', () => {
  it('returns received before revalidation and authoritative acceptance', async () => {
    const { inventory, operations, runtime, service } = createHarness('idle', 'inactive')
    const revalidateGate = deferred<void>()
    const submitGate = runtime.delayNextSubmit()
    inventory.revalidateGate = revalidateGate.promise

    const receipt = await service.sendPrompt({
      conversationId,
      prompt: 'Start the inactive conversation.',
      mode: 'auto',
      idempotencyKey: 'start-inactive',
    })

    expect(receipt.status).toBe('received')
    expect(operations.get(receipt.operationId).status).toBe('starting')
    expect(runtime.acquireControlRuntime).not.toHaveBeenCalled()
    revalidateGate.resolve()
    await vi.waitFor(() => expect(runtime.submitControlPrompt).toHaveBeenCalledOnce())
    expect(operations.get(receipt.operationId).status).toBe('accepting')

    submitGate.resolve({ handle: { ...runtime.handle }, acceptedMode: 'prompt' })
    await waitForStatus(operations, receipt.operationId, 'accepted')
    expect(runtime.releaseControlRuntime).toHaveBeenCalledOnce()
    await service.dispose()
  })

  it('buffers exact events until the Host response proves acceptance', async () => {
    const { operations, runtime, service } = createHarness()
    const submitGate = runtime.delayNextSubmit()
    const receipt = await service.sendPrompt({
      conversationId,
      prompt: 'Run the buffered turn.',
      mode: 'prompt',
      idempotencyKey: 'buffered-turn',
    })
    await vi.waitFor(() => expect(runtime.submitControlPrompt).toHaveBeenCalledOnce())

    await runtime.emitEvent(userEntry('Run the buffered turn.', 'entry-user-1'))
    await runtime.emitEvent(finalMessage('Buffered final response'))
    await runtime.emitEvent({ type: 'agent_settled' })
    const accepting = operations.get(receipt.operationId)
    expect(accepting.status).toBe('accepting')
    expect(accepting).not.toHaveProperty('acceptedMode')
    expect(accepting).not.toHaveProperty('finalResponse')

    submitGate.resolve({ handle: { ...runtime.handle }, acceptedMode: 'prompt' })
    const completed = await waitForStatus(operations, receipt.operationId, 'completed')
    expect(completed).toMatchObject({
      acceptedMode: 'prompt',
      finalResponse: 'Buffered final response',
    })
    expect(runtime.releaseControlRuntime).toHaveBeenCalledOnce()
    await service.dispose()
  })

  it('does not retain unrelated tool payloads in the pre-acceptance buffer', async () => {
    const { operations, runtime, service } = createHarness()
    const submitGate = runtime.delayNextSubmit()
    const receipt = await service.sendPrompt({
      conversationId,
      prompt: 'Ignore unrelated tool evidence.',
      mode: 'prompt',
      idempotencyKey: 'ignore-tool-payload',
    })
    await vi.waitFor(() => expect(runtime.submitControlPrompt).toHaveBeenCalledOnce())
    await runtime.emitEvent({
      type: 'tool_execution_start',
      toolCallId: 'large-tool-call',
      toolName: 'large-tool',
      args: { privateValue: 'x'.repeat(2 * 1024 * 1024) },
    })
    expect(operations.get(receipt.operationId).status).toBe('accepting')
    await runtime.emitEvent(userEntry(
      'Ignore unrelated tool evidence.',
      'entry-after-tool',
    ))
    await runtime.emitEvent(finalMessage('Relevant response'))
    await runtime.emitEvent({ type: 'agent_settled' })

    submitGate.resolve({ handle: { ...runtime.handle }, acceptedMode: 'prompt' })
    expect(await waitForStatus(
      operations,
      receipt.operationId,
      'completed',
    )).toMatchObject({ finalResponse: 'Relevant response' })
    await service.dispose()
  })

  it('fails closed when pre-acceptance attribution evidence exceeds its byte cap', async () => {
    const { operations, runtime, service } = createHarness()
    const submitGate = runtime.delayNextSubmit()
    const receipt = await service.sendPrompt({
      conversationId,
      prompt: 'Bound transformed evidence.',
      mode: 'prompt',
      idempotencyKey: 'bounded-pre-acceptance',
    })
    await vi.waitFor(() => expect(runtime.submitControlPrompt).toHaveBeenCalledOnce())

    await runtime.emitEvent(userEntry(
      'x'.repeat(EXTERNAL_CONTROL_MAX_PRE_ACCEPTANCE_BYTES),
      'entry-oversized',
    ))
    expect(operations.get(receipt.operationId)).toMatchObject({
      status: 'failed',
      error: { code: 'invalid_state' },
    })
    submitGate.resolve({ handle: { ...runtime.handle }, acceptedMode: 'prompt' })
    await vi.waitFor(() => expect(runtime.releaseControlRuntime).toHaveBeenCalledOnce())
    await service.dispose()
  })

  it('replays identical idempotent input once and rejects conflicting input', async () => {
    const { runtime, service } = createHarness()
    const input = {
      conversationId,
      prompt: 'Only submit once.',
      mode: 'prompt' as const,
      idempotencyKey: 'idempotent-send',
    }
    const first = await service.sendPrompt(input)
    const replay = await service.sendPrompt(input)

    expect(replay).toEqual(first)
    await vi.waitFor(() => expect(runtime.submitControlPrompt).toHaveBeenCalledOnce())
    await expect(service.sendPrompt({
      ...input,
      prompt: 'A conflicting prompt.',
    })).rejects.toMatchObject({ code: 'idempotency_conflict' })
    expect(runtime.submitControlPrompt).toHaveBeenCalledOnce()
    await service.dispose()
  })

  it('attributes same-text queued turns in acceptance order', async () => {
    const { operations, runtime, service } = createHarness('running')
    const input = {
      conversationId,
      prompt: 'Repeat this exact text.',
      mode: 'follow_up' as const,
    }
    const first = await service.sendPrompt({ ...input, idempotencyKey: 'repeat-1' })
    const second = await service.sendPrompt({ ...input, idempotencyKey: 'repeat-2' })
    await waitForStatus(operations, first.operationId, 'accepted')
    await waitForStatus(operations, second.operationId, 'accepted')

    await runtime.emitEvent({
      type: 'queue_update',
      steering: [],
      followUp: [input.prompt, input.prompt],
    })
    await runtime.emitEvent(userEntry(input.prompt, 'entry-repeat-1'))
    await runtime.emitEvent(finalMessage('First response'))
    await runtime.emitEvent({ type: 'agent_settled' })

    expect(operations.get(first.operationId)).toMatchObject({
      status: 'completed',
      finalResponse: 'First response',
    })
    expect(operations.get(second.operationId).status).toBe('accepted')

    await runtime.emitEvent({
      type: 'queue_update',
      steering: [],
      followUp: [input.prompt],
    })
    await runtime.emitEvent(userEntry(input.prompt, 'entry-repeat-2'))
    await runtime.emitEvent(finalMessage('Second response'))
    await runtime.emitEvent({ type: 'agent_settled' })
    expect(operations.get(second.operationId)).toMatchObject({
      status: 'completed',
      finalResponse: 'Second response',
    })
    await service.dispose()
  })

  it('uses the next user entry as the boundary while Pi drains queued turns', async () => {
    const { operations, runtime, service } = createHarness('running')
    const first = await service.sendPrompt({
      conversationId,
      prompt: 'First queued follow-up.',
      mode: 'follow_up',
      idempotencyKey: 'drained-follow-up-1',
    })
    const second = await service.sendPrompt({
      conversationId,
      prompt: 'Second queued follow-up.',
      mode: 'follow_up',
      idempotencyKey: 'drained-follow-up-2',
    })
    await waitForStatus(operations, first.operationId, 'accepted')
    await waitForStatus(operations, second.operationId, 'accepted')
    await runtime.emitEvent({
      type: 'queue_update',
      steering: [],
      followUp: ['First queued follow-up.', 'Second queued follow-up.'],
    })

    await runtime.emitEvent(userEntry(
      'First queued follow-up.',
      'entry-drained-1',
    ))
    await runtime.emitEvent(finalMessage('First drained response'))
    await runtime.emitEvent(userEntry(
      'Second queued follow-up.',
      'entry-drained-2',
    ))

    expect(operations.get(first.operationId)).toMatchObject({
      status: 'completed',
      finalResponse: 'First drained response',
    })
    expect(operations.get(second.operationId).status).toBe('accepted')

    await runtime.emitEvent(finalMessage('Second drained response'))
    await runtime.emitEvent({ type: 'agent_settled' })
    expect(operations.get(second.operationId)).toMatchObject({
      status: 'completed',
      finalResponse: 'Second drained response',
    })
    expect(operations.get(first.operationId).error).toBeUndefined()
    expect(operations.get(second.operationId).error).toBeUndefined()
    await service.dispose()
  })

  it('anchors Steer through its real queue and user-entry sequence', async () => {
    const { operations, runtime, service } = createHarness('running')
    const prompt = 'Redirect the active turn.'
    const receipt = await service.sendPrompt({
      conversationId,
      prompt,
      mode: 'steer',
      idempotencyKey: 'steer-real-sequence',
    })
    await waitForStatus(operations, receipt.operationId, 'accepted')

    await runtime.emitEvent({
      type: 'queue_update',
      steering: [prompt],
      followUp: [],
    })
    await runtime.emitEvent(userEntry(prompt, 'entry-steer-real'))
    expect(operations.get(receipt.operationId).status).toBe('accepted')

    await runtime.emitEvent(finalMessage('Steered final response'))
    expect(operations.get(receipt.operationId).status).toBe('accepted')
    await runtime.emitEvent({ type: 'agent_settled' })

    expect(operations.get(receipt.operationId)).toMatchObject({
      status: 'completed',
      acceptedMode: 'steer',
      finalResponse: 'Steered final response',
    })
    await service.dispose()
  })

  it('uses a later Steer user entry as the prior Prompt boundary', async () => {
    const { operations, runtime, service } = createHarness()
    const initialPrompt = 'Begin the original turn.'
    const promptReceipt = await service.sendPrompt({
      conversationId,
      prompt: initialPrompt,
      mode: 'prompt',
      idempotencyKey: 'prompt-before-steer',
    })
    await waitForStatus(operations, promptReceipt.operationId, 'accepted')
    await runtime.emitEvent(userEntry(initialPrompt, 'entry-prompt-before-steer'))

    const steerPrompt = 'Change direction now.'
    const steerReceipt = await service.sendPrompt({
      conversationId,
      prompt: steerPrompt,
      mode: 'steer',
      idempotencyKey: 'steer-after-prompt',
    })
    await waitForStatus(operations, steerReceipt.operationId, 'accepted')
    await runtime.emitEvent({
      type: 'queue_update',
      steering: [steerPrompt],
      followUp: [],
    })
    await runtime.emitEvent(finalMessage('Original partial response'))
    await runtime.emitEvent(userEntry(steerPrompt, 'entry-steer-after-prompt'))

    expect(operations.get(promptReceipt.operationId)).toMatchObject({
      status: 'completed',
      finalResponse: 'Original partial response',
    })
    expect(operations.get(steerReceipt.operationId).status).toBe('accepted')

    await runtime.emitEvent(finalMessage('Response after steering'))
    await runtime.emitEvent({ type: 'agent_settled' })
    expect(operations.get(steerReceipt.operationId)).toMatchObject({
      status: 'completed',
      finalResponse: 'Response after steering',
    })
    await service.dispose()
  })

  it('fails a mixed Follow-up then Steer queue before the second SDK mutation', async () => {
    const { operations, runtime, service } = createHarness('running')
    const prompt = 'Identical mixed-queue text.'
    const followUp = await service.sendPrompt({
      conversationId,
      prompt,
      mode: 'follow_up',
      idempotencyKey: 'mixed-follow-up-first',
    })
    await waitForStatus(operations, followUp.operationId, 'accepted')
    await runtime.emitEvent({
      type: 'queue_update',
      steering: [],
      followUp: [prompt],
    })

    const steer = await service.sendPrompt({
      conversationId,
      prompt,
      mode: 'steer',
      idempotencyKey: 'mixed-steer-second',
    })
    expect(await waitForStatus(
      operations,
      steer.operationId,
      'failed',
    )).toMatchObject({ error: { code: 'invalid_state' } })
    expect(runtime.submitControlPrompt).toHaveBeenCalledOnce()

    await runtime.emitEvent(userEntry(prompt, 'entry-mixed-follow-up'))
    await runtime.emitEvent(finalMessage('Only the Follow-up response'))
    await runtime.emitEvent({ type: 'agent_settled' })
    expect(operations.get(followUp.operationId)).toMatchObject({
      status: 'completed',
      finalResponse: 'Only the Follow-up response',
    })
    expect(operations.get(steer.operationId)).not.toHaveProperty('finalResponse')
    await service.dispose()
  })

  it('fails closed when desktop work makes a queued anchor ambiguous', async () => {
    const { operations, runtime, service } = createHarness('running')
    const receipt = await service.sendPrompt({
      conversationId,
      prompt: 'External follow-up.',
      mode: 'follow_up',
      idempotencyKey: 'ambiguous-follow-up',
    })
    await waitForStatus(operations, receipt.operationId, 'accepted')
    await runtime.emitEvent({
      type: 'queue_update',
      steering: [],
      followUp: ['Desktop prompt.', 'External follow-up.'],
    })

    expect(operations.get(receipt.operationId)).toMatchObject({
      status: 'failed',
      error: { code: 'invalid_state' },
    })
    await service.dispose()
  })

  it('fails closed when an input handler transforms the Prompt text', async () => {
    const { operations, runtime, service } = createHarness()
    const receipt = await service.sendPrompt({
      conversationId,
      prompt: '/expand original input',
      mode: 'prompt',
      idempotencyKey: 'transformed-prompt',
    })
    await waitForStatus(operations, receipt.operationId, 'accepted')
    await runtime.emitEvent(userEntry(
      'Expanded text produced by an input handler.',
      'entry-transformed',
    ))
    await runtime.emitEvent(finalMessage('Must not be attributed'))
    await runtime.emitEvent({ type: 'agent_settled' })

    const failed = operations.get(receipt.operationId)
    expect(failed).toMatchObject({
      status: 'failed',
      error: { code: 'invalid_state' },
    })
    expect(failed).not.toHaveProperty('finalResponse')
    await service.dispose()
  })

  it('fails closed when an input handler transforms a queued user entry', async () => {
    const { operations, runtime, service } = createHarness('running')
    const prompt = '/expand queued input'
    const receipt = await service.sendPrompt({
      conversationId,
      prompt,
      mode: 'follow_up',
      idempotencyKey: 'transformed-follow-up',
    })
    await waitForStatus(operations, receipt.operationId, 'accepted')
    await runtime.emitEvent({
      type: 'queue_update',
      steering: [],
      followUp: [prompt],
    })
    await runtime.emitEvent(userEntry(
      'Expanded queued text produced by an input handler.',
      'entry-transformed-follow-up',
    ))
    await runtime.emitEvent(finalMessage('Must not be attributed'))
    await runtime.emitEvent({ type: 'agent_settled' })

    const failed = operations.get(receipt.operationId)
    expect(failed).toMatchObject({
      status: 'failed',
      error: { code: 'invalid_state' },
    })
    expect(failed).not.toHaveProperty('finalResponse')
    await service.dispose()
  })

  it('does not wildcard-cancel UI while a recover target is pending', async () => {
    const { inventory, operations, runtime, service } = createHarness('idle', 'inactive')
    inventory.target.runtime = undefined
    inventory.target.catalogTarget = {
      scope: projectScope,
      cwd: '/projects/external-control',
      sessionId: 'recover-source',
      sessionFile: '/sessions/recover-source.jsonl',
      mode: 'recover',
      createdAt: '2026-08-20T00:00:00.000Z',
      modifiedAt: '2026-08-22T00:00:00.000Z',
      root: '/sessions',
      headerIdentity: 'recover-header',
      contentDigest: 'recover-content',
      identity: {
        dev: 1,
        ino: 2,
        size: 100,
        mtimeMs: 1,
        ctimeMs: 1,
      },
    }
    const revalidateGate = deferred<void>()
    inventory.revalidateGate = revalidateGate.promise
    const receipt = await service.sendPrompt({
      conversationId,
      prompt: 'Do not bind an unknown recovered target.',
      mode: 'prompt',
      idempotencyKey: 'recover-isolation',
    })
    await vi.waitFor(() => {
      expect(operations.get(receipt.operationId).status).toBe('starting')
    })

    await runtime.emitBlockingUi('other-runtime-confirm')
    expect(runtime.respondToControlExtensionUi).not.toHaveBeenCalled()
    expect(operations.get(receipt.operationId).status).toBe('starting')
    revalidateGate.resolve()

    expect(await waitForStatus(
      operations,
      receipt.operationId,
      'failed',
    )).toMatchObject({ error: { code: 'conversation_unavailable' } })
    expect(runtime.acquireControlRuntime).not.toHaveBeenCalled()
    await service.dispose()
  })

  it('cancels exact blocking UI during acquisition and releases the late lease', async () => {
    const { operations, runtime, service } = createHarness('idle', 'inactive')
    const acquireGate = deferred<void>()
    runtime.acquireGate = acquireGate.promise
    const receipt = await service.sendPrompt({
      conversationId,
      prompt: 'Needs startup.',
      mode: 'prompt',
      idempotencyKey: 'startup-ui',
    })
    await vi.waitFor(() => expect(runtime.acquireControlRuntime).toHaveBeenCalledOnce())

    await runtime.emitBlockingUi()
    expect(operations.get(receipt.operationId)).toMatchObject({
      status: 'failed',
      error: { code: 'interaction_required' },
    })
    expect(runtime.respondToControlExtensionUi).toHaveBeenCalledWith(
      runtime.handle,
      {
        type: 'extension_ui_response',
        id: 'external-confirm',
        cancelled: true,
      },
    )
    acquireGate.resolve()
    await vi.waitFor(() => expect(runtime.releaseControlRuntime).toHaveBeenCalledOnce())
    expect(runtime.submitControlPrompt).not.toHaveBeenCalled()
    await service.dispose()
  })

  it('releases the lease when Pi rejects submission', async () => {
    const { operations, runtime, service } = createHarness()
    const submitGate = runtime.delayNextSubmit()
    const receipt = await service.sendPrompt({
      conversationId,
      prompt: 'Reject this operation.',
      mode: 'prompt',
      idempotencyKey: 'reject-submit',
    })
    await vi.waitFor(() => expect(runtime.submitControlPrompt).toHaveBeenCalledOnce())
    submitGate.reject(new Error('private Pi failure'))

    expect(await waitForStatus(operations, receipt.operationId, 'failed')).toMatchObject({
      error: {
        code: 'internal_error',
        message: 'PiPilot could not complete the external-control operation.',
      },
    })
    expect(runtime.releaseControlRuntime).toHaveBeenCalledOnce()
    expect(JSON.stringify(operations.get(receipt.operationId))).not.toContain(
      'private Pi failure',
    )
    await service.dispose()
  })

  it('terminates exact pending work when the Runtime disappears or changes', async () => {
    const { operations, runtime, service } = createHarness()
    const receipt = await service.sendPrompt({
      conversationId,
      prompt: 'Keep exact generation.',
      mode: 'steer',
      idempotencyKey: 'exact-generation',
    })
    await waitForStatus(operations, receipt.operationId, 'accepted')

    runtime.emitSummaries([])
    expect(operations.get(receipt.operationId)).toMatchObject({
      status: 'runtime_replaced',
      error: { code: 'runtime_replaced' },
    })
    await service.dispose()
  })

  it('uses an immediate exact abort operation and completes at idle', async () => {
    const { operations, runtime, service } = createHarness('running')
    runtime.summary = { ...runtime.summary, lifecycle: 'idle' }
    const receipt = await service.abortConversation({
      conversationId,
      idempotencyKey: 'abort-exact-runtime',
    })

    expect(receipt.status).toBe('received')
    const completed = await waitForStatus(operations, receipt.operationId, 'completed')
    expect(completed.kind).toBe('abort_conversation')
    expect(runtime.abortControlRuntime).toHaveBeenCalledWith(
      expect.objectContaining(runtime.handle),
    )
    expect(runtime.releaseControlRuntime).toHaveBeenCalledOnce()
    await service.dispose()
  })

  it('keeps wait timeouts and disconnects non-terminal', async () => {
    const { operations, service } = createHarness()
    const receipt = await service.sendPrompt({
      conversationId,
      prompt: 'Wait without settling.',
      mode: 'steer',
      idempotencyKey: 'wait-non-terminal',
    })
    await waitForStatus(operations, receipt.operationId, 'accepted')

    await expect(service.waitForTurn({
      operationId: receipt.operationId,
      until: 'terminal',
      timeoutMs: 1,
    })).resolves.toMatchObject({
      reached: false,
      timedOut: true,
      operation: { status: 'accepted' },
    })

    const controller = new AbortController()
    const disconnected = service.waitForTurn({
      operationId: receipt.operationId,
      until: 'terminal',
      timeoutMs: 30_000,
    }, controller.signal)
    controller.abort()
    await expect(disconnected).resolves.toMatchObject({
      reached: false,
      timedOut: false,
      operation: { status: 'accepted' },
    })

    const alreadyDisconnected = new AbortController()
    alreadyDisconnected.abort()
    await expect(service.waitForTurn({
      operationId: receipt.operationId,
      until: 'terminal',
      timeoutMs: 30_000,
    }, alreadyDisconnected.signal)).resolves.toMatchObject({
      reached: false,
      timedOut: false,
      operation: { status: 'accepted' },
    })
    expect(operations.get(receipt.operationId).status).toBe('accepted')
    await service.dispose()
  })

  it('completes an accepted handled command when exact SDK state is idle', async () => {
    const { operations, runtime, service } = createHarness()
    runtime.controlStateOverride = {
      thinkingLevel: 'medium',
      isStreaming: false,
      isCompacting: false,
      steeringMode: 'one-at-a-time',
      followUpMode: 'one-at-a-time',
      sessionFile: runtime.handle.sessionFile ?? undefined,
      sessionId: runtime.handle.sessionId,
      autoCompactionEnabled: true,
      messageCount: 0,
      pendingMessageCount: 0,
    }
    const receipt = await service.sendPrompt({
      conversationId,
      prompt: '/handled-without-turn',
      mode: 'prompt',
      idempotencyKey: 'handled-command',
    })

    const completed = await waitForStatus(operations, receipt.operationId, 'completed')
    expect(completed.acceptedMode).toBe('prompt')
    expect(completed).not.toHaveProperty('finalResponse')
    expect(runtime.getControlRuntimeState).toHaveBeenCalledWith(runtime.handle)
    await service.dispose()
  })

  it('bounds the final visible assistant response by UTF-8 bytes', async () => {
    const { operations, runtime, service } = createHarness()
    const receipt = await service.sendPrompt({
      conversationId,
      prompt: 'Return a bounded answer.',
      mode: 'prompt',
      idempotencyKey: 'bounded-response',
    })
    await waitForStatus(operations, receipt.operationId, 'accepted')
    await runtime.emitEvent(userEntry('Return a bounded answer.', 'entry-bounded'))
    await runtime.emitEvent(finalMessage('界'.repeat(30_000)))
    await runtime.emitEvent({ type: 'agent_settled' })

    const finalResponse = operations.get(receipt.operationId).finalResponse
    expect(finalResponse).toBeDefined()
    expect(Buffer.byteLength(finalResponse ?? '')).toBeLessThanOrEqual(
      EXTERNAL_CONTROL_MAX_FINAL_RESPONSE_BYTES,
    )
    await service.dispose()
  })
})
