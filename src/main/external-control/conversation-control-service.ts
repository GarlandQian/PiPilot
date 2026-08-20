import { createHash } from 'node:crypto'
import {
  EXTERNAL_CONTROL_MAX_FINAL_RESPONSE_BYTES,
  EXTERNAL_CONTROL_MAX_OPERATIONS,
  EXTERNAL_CONTROL_MAX_PRE_ACCEPTANCE_BYTES,
  ExternalControlError,
  abortConversationInputSchema,
  getOperationInputSchema,
  getOperationResultSchema,
  isTerminalExternalControlStatus,
  sendPromptInputSchema,
  waitForTurnInputSchema,
  waitForTurnResultSchema,
  type ExternalControlBridgeMethod,
  type ExternalControlOperation,
} from '../../shared/external-control'
import type { ConversationScope } from '../../shared/conversation-scope'
import type {
  LocalPiAgentMessage,
  LocalPiRpcEvent,
} from '../../shared/local-pi'
import type { PiHostUiRequestEventEnvelope } from '../../shared/pi-host-protocol'
import {
  PiRuntimeFrontendError,
  type PiRuntimeControlHandle,
  type PiRuntimeControlLease,
  type PiRuntimeControlSummary,
  type PiRuntimeFrontend,
} from '../pi-host/pi-runtime-frontend'
import type { ConversationMcpAuditRepository } from './audit-repository'
import type {
  ConversationMcpInventoryService,
  ConversationMcpResolvedTarget,
} from './conversation-inventory'
import type { ConversationMcpOperationRegistry } from './operation-registry'

const MAX_BUFFERED_PRE_ACCEPTANCE_EVENTS = 512
const BLOCKING_UI_METHODS = new Set(['select', 'confirm', 'input', 'editor'])

type AttributionRuntimeEvent =
  | { type: 'queue'; addedHashes: string[] }
  | { type: 'user'; text: string }
  | { type: 'assistant'; text: string }
  | { type: 'settled' }

interface TrackedOperation {
  operationId: string
  conversationId: string
  kind: 'send_prompt' | 'abort_conversation'
  handle: PiRuntimeControlHandle
  phase: 'accepting' | 'accepted'
  requestedPrompt?: string
  promptHash?: string
  acceptedMode?: 'prompt' | 'follow_up' | 'steer'
  anchorMatched: boolean
  anchorSource?: 'entry' | 'queue'
  finalResponse?: string
  bufferedEvents: AttributionRuntimeEvent[]
  bufferedBytes: number
}

type RuntimeControl = Pick<
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
>

function sameScope(left: ConversationScope, right: ConversationScope) {
  return left.kind === right.kind && (
    left.kind === 'projectless' ||
    (right.kind === 'project' && left.workspaceId === right.workspaceId)
  )
}

function runtimeKey(handle: Pick<PiRuntimeControlHandle, 'runtimeId' | 'generation'>) {
  return `${handle.runtimeId}:${handle.generation}`
}

function promptHash(text: string) {
  return createHash('sha256').update(text).digest('base64url')
}

function visibleMessageText(message: LocalPiAgentMessage): string | undefined {
  if (message.role !== 'assistant') return undefined
  const text = message.content
    .filter((block): block is Extract<typeof block, { type: 'text' }> =>
      block.type === 'text')
    .map((block) => block.text)
    .join('')
  return text || undefined
}

function userEntryText(event: LocalPiRpcEvent): string | undefined {
  if (
    event.type !== 'entry_appended' ||
    event.entry.type !== 'message' ||
    event.entry.message.role !== 'user'
  ) return undefined
  const content = event.entry.message.content
  if (typeof content === 'string') return content
  return content
    .filter((block): block is Extract<typeof block, { type: 'text' }> =>
      block.type === 'text')
    .map((block) => block.text)
    .join('')
}

function assistantEventText(event: LocalPiRpcEvent): string | undefined {
  if (event.type === 'entry_appended' && event.entry.type === 'message') {
    return visibleMessageText(event.entry.message)
  }
  if (event.type === 'message_end' || event.type === 'turn_end') {
    return visibleMessageText(event.message)
  }
  return undefined
}

function boundUtf8(value: string) {
  const encoded = Buffer.from(value)
  if (encoded.byteLength <= EXTERNAL_CONTROL_MAX_FINAL_RESPONSE_BYTES) return value
  let bounded = new TextDecoder().decode(
    encoded.subarray(0, EXTERNAL_CONTROL_MAX_FINAL_RESPONSE_BYTES),
  )
  while (Buffer.byteLength(bounded) > EXTERNAL_CONTROL_MAX_FINAL_RESPONSE_BYTES) {
    bounded = bounded.slice(0, -1)
  }
  return bounded
}

function acquisitionTarget(target: ConversationMcpResolvedTarget) {
  if (target.catalogTarget) {
    if (target.catalogTarget.mode !== 'open') {
      throw new ExternalControlError(
        'conversation_unavailable',
        'Recovered Session targets cannot be controlled before Pi assigns their identity.',
      )
    }
    return {
      scope: target.catalogTarget.scope,
      sessionFile: target.catalogTarget.sessionFile,
    }
  }
  if (!target.runtime?.sessionFile) {
    throw new ExternalControlError(
      'conversation_unavailable',
      'The PiPilot conversation does not have an addressable Session.',
    )
  }
  return {
    scope: target.runtime.scope,
    sessionFile: target.runtime.sessionFile,
  }
}

function baseHandle(lease: PiRuntimeControlLease): PiRuntimeControlHandle {
  const { leaseId: _leaseId, ...handle } = lease
  return handle
}

function projectAttributionEvent(
  event: LocalPiRpcEvent,
  queueAddedHashes?: string[],
): AttributionRuntimeEvent | null {
  if (event.type === 'queue_update') {
    return queueAddedHashes?.length
      ? { type: 'queue', addedHashes: queueAddedHashes }
      : null
  }
  const userText = userEntryText(event)
  if (userText !== undefined) return { type: 'user', text: userText }
  const assistantText = assistantEventText(event)
  if (assistantText !== undefined) {
    return { type: 'assistant', text: boundUtf8(assistantText) }
  }
  if (event.type === 'agent_settled') return { type: 'settled' }
  return null
}

function attributionEventBytes(event: AttributionRuntimeEvent) {
  switch (event.type) {
    case 'queue':
      return 16 + event.addedHashes.reduce((total, hash) => total + hash.length, 0)
    case 'user':
    case 'assistant':
      return 16 + Buffer.byteLength(event.text)
    case 'settled':
      return 16
  }
}

export class ConversationMcpControlService {
  private readonly tracked = new Map<string, TrackedOperation>()
  private readonly runtimeQueues = new Map<string, string[]>()
  private readonly pendingAcquisitions = new Map<
    string,
    ConversationMcpResolvedTarget
  >()
  private readonly queueHashCounts = new Map<string, Map<string, number>>()
  private readonly conversationLabels = new Map<string, string>()
  private readonly detachEvents: () => boolean
  private readonly detachUiRequests: () => boolean
  private readonly detachRuntimeSnapshots: () => boolean
  private readonly detachAudit: () => boolean
  private disposed = false

  constructor(
    private readonly inventory: Pick<
      ConversationMcpInventoryService,
      | 'getConversationStatus'
      | 'listConversations'
      | 'resolveConversation'
      | 'revalidateTarget'
    >,
    private readonly runtime: RuntimeControl,
    private readonly operations: ConversationMcpOperationRegistry,
    private readonly audit: ConversationMcpAuditRepository,
  ) {
    this.detachEvents = runtime.subscribeAllEvents((event, handle) => {
      this.onRuntimeEvent(event, handle)
    })
    this.detachUiRequests = runtime.subscribeAllUiRequests((event, handle) =>
      this.onRuntimeUiRequest(event, handle))
    this.detachRuntimeSnapshots = runtime.subscribeControlRuntimes((summaries) => {
      this.onRuntimeSummaries(summaries)
    })
    this.detachAudit = operations.subscribe((operation) => {
      audit.append(operation)
    })
  }

  async handleBridgeRequest(
    method: ExternalControlBridgeMethod,
    params: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    this.assertActive()
    switch (method) {
      case 'list_conversations':
        return this.inventory.listConversations(params)
      case 'get_conversation_status':
        return this.inventory.getConversationStatus(params)
      case 'send_prompt':
        return this.sendPrompt(params)
      case 'abort_conversation':
        return this.abortConversation(params)
      case 'get_operation':
        return this.getOperation(params)
      case 'wait_for_turn':
        return this.waitForTurn(params, signal)
    }
  }

  async sendPrompt(rawInput: unknown) {
    this.assertActive()
    const input = sendPromptInputSchema.parse(rawInput)
    const target = await this.inventory.resolveConversation(input.conversationId)
    this.rememberConversationLabel(target)
    const reserved = this.operations.reserve({
      conversationId: input.conversationId,
      idempotencyKey: input.idempotencyKey,
      kind: 'send_prompt',
      requestedMode: input.mode,
      fingerprintSource: [input.prompt, input.mode],
    })
    if (reserved.created) {
      queueMicrotask(() => {
        void this.runSend(reserved.operation.operationId, target, input.prompt, input.mode)
      })
    }
    return reserved.receipt
  }

  async abortConversation(rawInput: unknown) {
    this.assertActive()
    const input = abortConversationInputSchema.parse(rawInput)
    const target = await this.inventory.resolveConversation(input.conversationId)
    this.rememberConversationLabel(target)
    if (target.conversation.lifecycle === 'inactive') {
      throw new ExternalControlError(
        'invalid_state',
        'An inactive conversation cannot be aborted.',
      )
    }
    const reserved = this.operations.reserve({
      conversationId: input.conversationId,
      idempotencyKey: input.idempotencyKey,
      kind: 'abort_conversation',
      fingerprintSource: [],
    })
    if (reserved.created) {
      queueMicrotask(() => {
        void this.runAbort(reserved.operation.operationId, target)
      })
    }
    return reserved.receipt
  }

  getOperation(rawInput: unknown) {
    this.assertActive()
    const input = getOperationInputSchema.parse(rawInput)
    return getOperationResultSchema.parse({
      operation: this.operations.get(input.operationId),
    })
  }

  async waitForTurn(rawInput: unknown, signal?: AbortSignal) {
    this.assertActive()
    const input = waitForTurnInputSchema.parse(rawInput)
    return waitForTurnResultSchema.parse(await this.operations.wait(
      input.operationId,
      input.until,
      input.timeoutMs,
      signal,
    ))
  }

  recentOperations(limit = 50) {
    return this.operations.recent(limit)
  }

  subscribeOperations(listener: (operation: ExternalControlOperation) => void) {
    return this.operations.subscribe(listener)
  }

  getConversationLabel(conversationId: string) {
    return this.conversationLabels.get(conversationId)
  }

  async dispose() {
    if (this.disposed) return
    this.disposed = true
    this.detachEvents()
    this.detachUiRequests()
    this.detachRuntimeSnapshots()
    const disabledError = new ExternalControlError(
      'external_control_disabled',
      'PiPilot External Control was disabled before the operation completed.',
    )
    for (const operation of this.operations.recent(EXTERNAL_CONTROL_MAX_OPERATIONS)) {
      if (!isTerminalExternalControlStatus(operation.status)) {
        this.failOperation(operation.operationId, disabledError)
      }
    }
    this.pendingAcquisitions.clear()
    this.tracked.clear()
    this.runtimeQueues.clear()
    this.queueHashCounts.clear()
    this.conversationLabels.clear()
    this.detachAudit()
    await this.audit.flush()
  }

  private async runSend(
    operationId: string,
    target: ConversationMcpResolvedTarget,
    prompt: string,
    mode: 'auto' | 'prompt' | 'follow_up' | 'steer',
  ) {
    let lease: PiRuntimeControlLease | undefined
    this.pendingAcquisitions.set(operationId, target)
    try {
      if (target.conversation.lifecycle === 'inactive') {
        this.operations.transition(operationId, 'starting')
      }
      const revalidated = await this.inventory.revalidateTarget(target)
      if (this.operationIsTerminal(operationId)) return
      lease = await this.runtime.acquireControlRuntime(acquisitionTarget(revalidated))
      this.pendingAcquisitions.delete(operationId)
      if (this.operationIsTerminal(operationId)) return
      if (
        (mode === 'follow_up' || mode === 'steer') &&
        this.hasOppositeQueuedMode(baseHandle(lease), mode)
      ) {
        throw new ExternalControlError(
          'invalid_state',
          'PiPilot cannot safely order mixed external Steer and Follow-up queues.',
        )
      }

      const tracked: TrackedOperation = {
        operationId,
        conversationId: target.conversation.conversationId,
        kind: 'send_prompt',
        handle: baseHandle(lease),
        phase: 'accepting',
        requestedPrompt: prompt,
        promptHash: promptHash(prompt),
        anchorMatched: false,
        bufferedEvents: [],
        bufferedBytes: 0,
      }
      this.track(tracked)
      this.operations.transition(operationId, 'accepting')
      const accepted = await this.runtime.submitControlPrompt(lease, prompt, mode)
      if (!this.sameHandle(accepted.handle, tracked.handle)) {
        throw new PiRuntimeFrontendError(
          'PI_RUNTIME_STALE_GENERATION',
          'The controlled Runtime changed while accepting the operation.',
        )
      }
      tracked.handle = accepted.handle
      tracked.acceptedMode = accepted.acceptedMode
      tracked.phase = 'accepted'
      if (this.hasMixedQueuedModes(tracked.handle)) {
        this.failRuntimeAttribution(
          tracked.handle,
          'PiPilot could not safely attribute mixed external Steer and Follow-up queues.',
        )
      }
      if (this.operationIsTerminal(operationId)) {
        await this.runtime.abortControlRuntime(accepted.handle).catch(() => undefined)
        this.untrack(operationId)
        return
      }
      this.operations.transition(operationId, 'accepted', {
        acceptedMode: accepted.acceptedMode,
      })
      this.replayBufferedEvents(tracked)
      await this.completeHandledPromptIfIdle(tracked)
    } catch (error) {
      this.failOperation(operationId, error)
    } finally {
      this.pendingAcquisitions.delete(operationId)
      if (lease) this.runtime.releaseControlRuntime(lease)
    }
  }

  private rememberConversationLabel(target: ConversationMcpResolvedTarget) {
    const label = target.conversation.name ?? target.conversation.project
    if (!label) return
    this.conversationLabels.delete(target.conversation.conversationId)
    this.conversationLabels.set(target.conversation.conversationId, label)
    while (this.conversationLabels.size > EXTERNAL_CONTROL_MAX_OPERATIONS) {
      const oldest = this.conversationLabels.keys().next().value
      if (oldest === undefined) break
      this.conversationLabels.delete(oldest)
    }
  }

  private async runAbort(
    operationId: string,
    target: ConversationMcpResolvedTarget,
  ) {
    let lease: PiRuntimeControlLease | undefined
    this.pendingAcquisitions.set(operationId, target)
    try {
      const revalidated = await this.inventory.revalidateTarget(target)
      if (this.operationIsTerminal(operationId)) return
      lease = await this.runtime.acquireControlRuntime(acquisitionTarget(revalidated))
      this.pendingAcquisitions.delete(operationId)
      if (this.operationIsTerminal(operationId)) return
      const tracked: TrackedOperation = {
        operationId,
        conversationId: target.conversation.conversationId,
        kind: 'abort_conversation',
        handle: baseHandle(lease),
        phase: 'accepting',
        anchorMatched: true,
        bufferedEvents: [],
        bufferedBytes: 0,
      }
      this.track(tracked)
      this.operations.transition(operationId, 'accepting')
      const acceptedHandle = await this.runtime.abortControlRuntime(lease)
      if (!this.sameHandle(acceptedHandle, tracked.handle)) {
        throw new PiRuntimeFrontendError(
          'PI_RUNTIME_STALE_GENERATION',
          'The controlled Runtime changed while accepting the abort.',
        )
      }
      tracked.handle = acceptedHandle
      tracked.phase = 'accepted'
      if (this.operationIsTerminal(operationId)) {
        this.untrack(operationId)
        return
      }
      this.operations.transition(operationId, 'accepted')
      this.replayBufferedEvents(tracked)
      const current = this.runtime.listControlRuntimes().find((runtime) =>
        this.sameRuntime(runtime, tracked.handle))
      if (current?.lifecycle === 'idle') this.completeOperation(tracked)
    } catch (error) {
      this.failOperation(operationId, error)
    } finally {
      this.pendingAcquisitions.delete(operationId)
      if (lease) this.runtime.releaseControlRuntime(lease)
    }
  }

  private onRuntimeEvent(event: LocalPiRpcEvent, handle: PiRuntimeControlHandle) {
    const key = runtimeKey(handle)
    const queueAddedHashes = event.type === 'queue_update'
      ? this.updateQueueHashes(key, [...event.steering, ...event.followUp])
      : undefined
    const queue = this.runtimeQueues.get(key)
    if (!queue?.length) return
    const first = queue
      .map((operationId) => this.tracked.get(operationId))
      .find((tracked) => tracked !== undefined)
    if (!first) return
    const projected = projectAttributionEvent(event, queueAddedHashes)
    if (!projected) return
    if (first.phase === 'accepting') {
      const eventBytes = attributionEventBytes(projected)
      if (
        first.bufferedEvents.length >= MAX_BUFFERED_PRE_ACCEPTANCE_EVENTS ||
        first.bufferedBytes + eventBytes > EXTERNAL_CONTROL_MAX_PRE_ACCEPTANCE_BYTES
      ) {
        this.failOperation(
          first.operationId,
          new ExternalControlError(
            'invalid_state',
            'Pi emitted too much attribution evidence before accepting the operation.',
          ),
        )
        return
      }
      first.bufferedEvents.push(projected)
      first.bufferedBytes += eventBytes
      return
    }
    this.applyAcceptedEvent(first, projected)
  }

  private replayBufferedEvents(tracked: TrackedOperation) {
    const buffered = tracked.bufferedEvents.splice(0)
    tracked.bufferedBytes = 0
    for (const event of buffered) {
      if (!this.tracked.has(tracked.operationId)) break
      this.applyAcceptedEvent(tracked, event)
    }
  }

  private applyAcceptedEvent(
    tracked: TrackedOperation,
    event: AttributionRuntimeEvent,
  ) {
    if (!this.tracked.has(tracked.operationId) || tracked.phase !== 'accepted') return
    switch (event.type) {
      case 'queue':
        this.matchQueueAnchors(tracked.handle, event.addedHashes)
        break
      case 'user':
        this.matchUserAnchor(tracked.handle, event.text)
        break
      case 'assistant': {
        const current = this.firstTrackedForRuntime(tracked.handle)
        if (current?.phase === 'accepted' && current.anchorMatched) {
          current.finalResponse = event.text
        }
        break
      }
      case 'settled':
        this.settleRuntime(tracked.handle)
        break
    }
  }

  private matchQueueAnchors(handle: PiRuntimeControlHandle, addedHashes: string[]) {
    const candidates = this.trackedForRuntime(handle).filter((tracked) =>
      tracked.kind === 'send_prompt' && !tracked.anchorMatched)
    for (const hash of addedHashes) {
      const candidate = candidates.shift()
      if (!candidate || candidate.promptHash !== hash) {
        this.failRuntimeAttribution(
          handle,
          'Pi queued work that could not be attributed in external acceptance order.',
        )
        return
      }
      candidate.anchorMatched = true
      candidate.anchorSource = 'queue'
    }
  }

  private matchUserAnchor(handle: PiRuntimeControlHandle, text: string) {
    const hash = promptHash(text)
    let queue = this.trackedForRuntime(handle)
    let current = queue[0]
    if (current?.anchorSource === 'queue') {
      if (current.promptHash !== hash || current.requestedPrompt !== text) {
        this.failRuntimeAttribution(
          handle,
          'Pi emitted a queued user entry that did not match the externally accepted prompt.',
        )
        return
      }
      current.anchorSource = 'entry'
      current.requestedPrompt = undefined
      current.promptHash = undefined
      return
    }

    if (current?.anchorSource === 'entry') {
      this.completeOperation(current)
      queue = this.trackedForRuntime(handle)
      current = queue[0]
      if (current?.anchorSource === 'queue') {
        if (current.promptHash !== hash || current.requestedPrompt !== text) {
          this.failRuntimeAttribution(
            handle,
            'Pi emitted a queued user entry that did not match the externally accepted prompt.',
          )
          return
        }
        current.anchorSource = 'entry'
        current.requestedPrompt = undefined
        current.promptHash = undefined
        return
      }
    }
    const candidate = queue.find((tracked) =>
      tracked.kind === 'send_prompt' &&
      !tracked.anchorMatched &&
      tracked.promptHash === hash &&
      tracked.requestedPrompt === text)
    if (!candidate) return
    candidate.anchorMatched = true
    candidate.anchorSource = 'entry'
    candidate.requestedPrompt = undefined
    candidate.promptHash = undefined
  }

  private settleRuntime(handle: PiRuntimeControlHandle) {
    const tracked = this.firstTrackedForRuntime(handle)
    if (!tracked || tracked.phase !== 'accepted') return
    if (
      tracked.kind === 'abort_conversation' ||
      tracked.anchorSource === 'entry'
    ) {
      this.completeOperation(tracked)
      return
    }
    if (!tracked.anchorMatched) {
      this.failOperation(
        tracked.operationId,
        new ExternalControlError(
          'invalid_state',
          'PiPilot could not attribute the settled turn to this operation.',
        ),
      )
    }
  }

  private async completeHandledPromptIfIdle(tracked: TrackedOperation) {
    if (
      !this.tracked.has(tracked.operationId) ||
      tracked.phase !== 'accepted' ||
      tracked.acceptedMode !== 'prompt' ||
      tracked.anchorMatched
    ) return
    const state = await this.runtime.getControlRuntimeState(tracked.handle)
    if (
      this.tracked.has(tracked.operationId) &&
      !state.isStreaming &&
      !state.isCompacting &&
      state.pendingMessageCount === 0
    ) {
      tracked.requestedPrompt = undefined
      tracked.promptHash = undefined
      this.completeOperation(tracked)
    }
  }

  private async onRuntimeUiRequest(
    event: PiHostUiRequestEventEnvelope,
    handle: PiRuntimeControlHandle,
  ) {
    if (!BLOCKING_UI_METHODS.has(event.request.method)) return
    const tracked = this.trackedForRuntime(handle)
    const pending = [...this.pendingAcquisitions].filter(([, target]) =>
      this.pendingTargetMatches(target, handle))
    if (tracked.length === 0 && pending.length === 0) return

    await this.runtime.respondToControlExtensionUi(handle, {
      type: 'extension_ui_response',
      id: event.request.id,
      cancelled: true,
    }).catch(() => undefined)
    const error = new ExternalControlError(
      'interaction_required',
      'The external operation required interactive extension input.',
    )
    for (const operation of tracked) this.failOperation(operation.operationId, error)
    for (const [operationId] of pending) this.failOperation(operationId, error)
  }

  private onRuntimeSummaries(summaries: PiRuntimeControlSummary[]) {
    for (const tracked of [...this.tracked.values()]) {
      const exact = summaries.find((runtime) =>
        this.sameRuntime(runtime, tracked.handle))
      if (!exact) {
        this.failOperation(
          tracked.operationId,
          new PiRuntimeFrontendError(
            'PI_RUNTIME_STALE_GENERATION',
            'The controlled Runtime was replaced.',
          ),
        )
      }
    }
    const liveKeys = new Set(summaries.map((summary) => runtimeKey(summary)))
    for (const key of this.queueHashCounts.keys()) {
      if (!liveKeys.has(key) && !this.runtimeQueues.has(key)) {
        this.queueHashCounts.delete(key)
      }
    }
  }

  private updateQueueHashes(key: string, messages: string[]) {
    const next = new Map<string, number>()
    for (const message of messages) {
      const hash = promptHash(message)
      next.set(hash, (next.get(hash) ?? 0) + 1)
    }
    const previous = this.queueHashCounts.get(key) ?? new Map<string, number>()
    const added: string[] = []
    for (const [hash, count] of next) {
      const delta = count - (previous.get(hash) ?? 0)
      for (let index = 0; index < delta; index += 1) added.push(hash)
    }
    this.queueHashCounts.delete(key)
    this.queueHashCounts.set(key, next)
    while (this.queueHashCounts.size > 256) {
      const oldest = this.queueHashCounts.keys().next().value
      if (oldest === undefined) break
      this.queueHashCounts.delete(oldest)
    }
    return added
  }

  private track(tracked: TrackedOperation) {
    this.tracked.set(tracked.operationId, tracked)
    const key = runtimeKey(tracked.handle)
    const queue = this.runtimeQueues.get(key) ?? []
    queue.push(tracked.operationId)
    this.runtimeQueues.set(key, queue)
  }

  private untrack(operationId: string) {
    const tracked = this.tracked.get(operationId)
    if (!tracked) return
    tracked.requestedPrompt = undefined
    tracked.promptHash = undefined
    tracked.bufferedEvents.length = 0
    tracked.bufferedBytes = 0
    this.tracked.delete(operationId)
    const key = runtimeKey(tracked.handle)
    const queue = this.runtimeQueues.get(key)?.filter((id) => id !== operationId)
    if (queue?.length) this.runtimeQueues.set(key, queue)
    else this.runtimeQueues.delete(key)
  }

  private trackedForRuntime(handle: PiRuntimeControlHandle) {
    return (this.runtimeQueues.get(runtimeKey(handle)) ?? [])
      .map((operationId) => this.tracked.get(operationId))
      .filter((tracked): tracked is TrackedOperation => tracked !== undefined)
  }

  private firstTrackedForRuntime(handle: PiRuntimeControlHandle) {
    return this.trackedForRuntime(handle)[0]
  }

  private completeOperation(tracked: TrackedOperation) {
    this.operations.transition(tracked.operationId, 'completed', {
      ...(tracked.finalResponse ? { finalResponse: tracked.finalResponse } : {}),
    })
    this.untrack(tracked.operationId)
  }

  private failOperation(operationId: string, error: unknown) {
    const mapped = this.mapFailure(error)
    this.operations.transition(operationId, mapped.status, {
      error: mapped.error,
    })
    this.untrack(operationId)
  }

  private mapFailure(error: unknown): {
    status: 'failed' | 'runtime_replaced'
    error: { code: ExternalControlError['code']; message: string }
  } {
    if (
      error instanceof PiRuntimeFrontendError &&
      error.code === 'PI_RUNTIME_STALE_GENERATION'
    ) {
      return {
        status: 'runtime_replaced',
        error: {
          code: 'runtime_replaced',
          message: 'The PiPilot Runtime was replaced before the operation completed.',
        },
      }
    }
    if (error instanceof ExternalControlError) {
      return { status: 'failed', error: error.toPublicError() }
    }
    if (error instanceof PiRuntimeFrontendError) {
      return {
        status: 'failed',
        error: {
          code: error.code === 'PI_RUNTIME_INACTIVE'
            ? 'conversation_unavailable'
            : 'invalid_state',
          message: 'Pi rejected the external conversation operation.',
        },
      }
    }
    return {
      status: 'failed',
      error: {
        code: 'internal_error',
        message: 'PiPilot could not complete the external-control operation.',
      },
    }
  }

  private operationIsTerminal(operationId: string) {
    return isTerminalExternalControlStatus(this.operations.get(operationId).status)
  }

  private sameRuntime(
    runtime: PiRuntimeControlSummary,
    handle: PiRuntimeControlHandle,
  ) {
    return this.sameHandle(runtime, handle)
  }

  private sameHandle(
    runtime: PiRuntimeControlHandle,
    handle: PiRuntimeControlHandle,
  ) {
    return runtime.runtimeId === handle.runtimeId &&
      runtime.generation === handle.generation &&
      runtime.hostEpoch === handle.hostEpoch &&
      runtime.sessionId === handle.sessionId &&
      runtime.sessionFile === handle.sessionFile &&
      sameScope(runtime.scope, handle.scope)
  }

  private hasOppositeQueuedMode(
    handle: PiRuntimeControlHandle,
    requestedMode: 'follow_up' | 'steer',
  ) {
    const opposite = requestedMode === 'steer' ? 'follow_up' : 'steer'
    return this.trackedForRuntime(handle).some((tracked) =>
      tracked.kind === 'send_prompt' && tracked.acceptedMode === opposite)
  }

  private hasMixedQueuedModes(handle: PiRuntimeControlHandle) {
    let followUp = false
    let steer = false
    for (const tracked of this.trackedForRuntime(handle)) {
      if (tracked.kind !== 'send_prompt') continue
      if (tracked.acceptedMode === 'follow_up') followUp = true
      if (tracked.acceptedMode === 'steer') steer = true
    }
    return followUp && steer
  }

  private failRuntimeAttribution(
    handle: PiRuntimeControlHandle,
    message: string,
  ) {
    for (const tracked of [...this.trackedForRuntime(handle)]) {
      this.failOperation(
        tracked.operationId,
        new ExternalControlError('invalid_state', message),
      )
    }
  }

  private pendingTargetMatches(
    target: ConversationMcpResolvedTarget,
    handle: PiRuntimeControlHandle,
  ) {
    const scope = target.catalogTarget?.scope ?? target.runtime?.scope
    if (!scope || !sameScope(scope, handle.scope)) return false
    const expectedFile = target.catalogTarget?.mode === 'open'
      ? target.catalogTarget.sessionFile
      : target.runtime?.sessionFile
    return expectedFile !== undefined && expectedFile === handle.sessionFile
  }

  private assertActive() {
    if (this.disposed) {
      throw new ExternalControlError(
        'external_control_disabled',
        'PiPilot External Control is disabled.',
      )
    }
  }
}
