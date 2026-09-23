import type { LocalPiDeliverySnapshot, LocalPiRpcEvent, LocalPiSessionState } from '../../shared/local-pi'
import type { PiHostUiRequestEventEnvelope } from '../../shared/pi-host-protocol'

export interface RuntimeActivity {
  readonly revision: number
  /** Execution observations only; acquiring a lease or finishing a read is not a newer state. */
  readonly stateRevision: number
  /** Pi events supersede an acceptance acknowledgement; an intervening idle read does not. */
  readonly eventRevision: number
  readonly controlPins: number
  readonly pendingCommands: number
  readonly agentRunning: boolean
  readonly compactionRunning: boolean
  readonly retryRunning: boolean
  readonly summarizationRunning: boolean
  readonly queuedMessages: number
  /** Delivery state is independent of the SDK's native queue and get_state samples. */
  readonly deliveryRevision: number
  readonly managedMessages: number
  readonly managedReadyMessages: number
  readonly managedDeliveringMessages: number
  readonly managedSdkMessages: number
  readonly managedAcceptingMessages: number
  readonly activeToolCalls: ReadonlySet<string>
  readonly pendingUiRequests: ReadonlySet<string>
  readonly outcome?: 'completed' | 'failed' | 'cancelled'
}

export interface RuntimeActivitySummary {
  lifecycle: 'idle' | 'accepting' | 'running' | 'queued'
  queueCount: number
  outcome?: 'completed' | 'failed' | 'cancelled'
  activity?: 'prompt' | 'tool' | 'retry' | 'compaction' | 'summarization' | 'interaction'
}

export const BLOCKING_EXTENSION_UI_METHODS: ReadonlySet<string> = new Set([
  'select', 'confirm', 'input', 'editor',
])

export type RuntimeActivityAction =
  | { type: 'touch' }
  | { type: 'control_pin'; delta: 1 | -1 }
  | { type: 'control_pins_cleared' }
  | { type: 'command_started' }
  | { type: 'command_finished' }
  | { type: 'prompt_accepted'; mode: 'prompt' | 'queued'; expectedEventRevision: number }
  | { type: 'session_state'; state: LocalPiSessionState | null; expectedStateRevision: number }
  | { type: 'delivery_state'; delivery: LocalPiDeliverySnapshot }
  | { type: 'delivery_reset' }
  | { type: 'event'; event: LocalPiRpcEvent }
  | { type: 'ui_request'; request: PiHostUiRequestEventEnvelope['request'] }
  | { type: 'ui_responded'; id: string }

export function createRuntimeActivity(state?: LocalPiSessionState | null): RuntimeActivity {
  return {
    revision: 0,
    stateRevision: 0,
    eventRevision: 0,
    controlPins: 0,
    pendingCommands: 0,
    agentRunning: state?.isStreaming ?? false,
    compactionRunning: state?.isCompacting ?? false,
    retryRunning: false,
    summarizationRunning: false,
    queuedMessages: state?.pendingMessageCount ?? 0,
    deliveryRevision: -1,
    managedMessages: 0,
    managedReadyMessages: 0,
    managedDeliveringMessages: 0,
    managedSdkMessages: 0,
    managedAcceptingMessages: 0,
    activeToolCalls: new Set(),
    pendingUiRequests: new Set(),
    ...(state?.isStreaming === false ? { outcome: 'completed' as const } : {}),
  }
}

function advance(activity: RuntimeActivity, changes: Partial<RuntimeActivity> = {}): RuntimeActivity {
  return { ...activity, ...changes, revision: activity.revision + 1 }
}

function observe(activity: RuntimeActivity, next: RuntimeActivity): RuntimeActivity {
  return { ...next, stateRevision: activity.stateRevision + 1 }
}

function updateSet(
  activity: RuntimeActivity,
  field: 'activeToolCalls' | 'pendingUiRequests',
  id: string,
  present: boolean,
): RuntimeActivity {
  if (activity[field].has(id) === present) return activity
  const values = new Set(activity[field])
  if (present) values.add(id)
  else values.delete(id)
  return advance(activity, { [field]: values })
}

/** Only accepted, generation-checked inputs belong here; identity remains the facade's responsibility. */
export function reduceRuntimeActivity(
  activity: RuntimeActivity,
  action: RuntimeActivityAction,
): RuntimeActivity {
  switch (action.type) {
    case 'touch':
      return advance(activity)
    case 'control_pin':
      return advance(activity, { controlPins: Math.max(0, activity.controlPins + action.delta) })
    case 'control_pins_cleared':
      return activity.controlPins === 0 ? activity : advance(activity, { controlPins: 0 })
    case 'command_started':
      return advance(activity, { pendingCommands: activity.pendingCommands + 1 })
    case 'command_finished':
      return advance(activity, { pendingCommands: Math.max(0, activity.pendingCommands - 1) })
    case 'prompt_accepted':
      if (action.expectedEventRevision !== activity.eventRevision) return activity
      return observe(activity, advance(activity, action.mode === 'prompt'
        ? { agentRunning: true, outcome: undefined }
        : { queuedMessages: Math.max(1, activity.queuedMessages) }))
    case 'session_state':
      if (action.expectedStateRevision !== activity.stateRevision) return activity
      // get_state does not describe tool execution, retries, or unanswered extension UI.
      // An idle-looking snapshot must never erase those independently observed protections.
      return observe(activity, advance(activity, action.state ? {
        agentRunning: action.state.isStreaming,
        compactionRunning: action.state.isCompacting,
        queuedMessages: action.state.pendingMessageCount,
        ...(action.state.isStreaming ? { outcome: undefined } : {}),
      } : {}))
    case 'delivery_state': {
      const next = reduceDeliveryState(activity, action.delivery)
      return next ? observe(activity, next) : activity
    }
    case 'delivery_reset':
      return observe(activity, advance(activity, {
        deliveryRevision: -1, managedMessages: 0, managedReadyMessages: 0,
        managedDeliveringMessages: 0, managedSdkMessages: 0, managedAcceptingMessages: 0,
      }))
    case 'ui_responded':
      return updateSet(activity, 'pendingUiRequests', action.id, false)
    case 'ui_request':
      if (action.request.method === 'dismiss') {
        return updateSet(activity, 'pendingUiRequests', action.request.id, false)
      }
      return BLOCKING_EXTENSION_UI_METHODS.has(action.request.method)
        ? updateSet(activity, 'pendingUiRequests', action.request.id, true)
        : activity
    case 'event': {
      const next = reduceEvent(activity, action.event)
      // Even an equal-valued observation is newer than an outstanding get_state
      // (for example agent_start after prompt acceptance already marked it running).
      return next ? { ...observe(activity, next), eventRevision: activity.eventRevision + 1 } : activity
    }
  }
}

function reduceEvent(activity: RuntimeActivity, event: LocalPiRpcEvent): RuntimeActivity | undefined {
  switch (event.type) {
    case 'delivery_state':
      return reduceDeliveryState(activity, event.delivery)
    case 'agent_start':
    case 'turn_start':
      return activity.agentRunning && activity.outcome === undefined
        ? activity
        : advance(activity, { agentRunning: true, outcome: undefined })
    case 'agent_end': {
      if (event.willRetry) {
        return activity.retryRunning ? activity : advance(activity, { retryRunning: true })
      }
      let outcome: RuntimeActivity['outcome'] = 'completed'
      for (let index = event.messages.length - 1; index >= 0; index -= 1) {
        const message = event.messages[index]
        if (message?.role !== 'assistant') continue
        outcome = message.stopReason === 'error' ? 'failed'
          : message.stopReason === 'aborted' ? 'cancelled' : 'completed'
        break
      }
      // agent_end can precede follow-up work. Only agent_settled ends the execution.
      return activity.outcome === outcome ? activity : advance(activity, { outcome })
    }
    case 'agent_settled':
      return !activity.agentRunning && activity.activeToolCalls.size === 0 && activity.outcome !== undefined
        ? activity
        : advance(activity, {
          agentRunning: false,
          activeToolCalls: new Set(),
          outcome: activity.outcome ?? 'completed',
        })
    case 'tool_execution_start':
    case 'tool_execution_update':
      return updateSet(activity, 'activeToolCalls', event.toolCallId, true)
    case 'tool_execution_end':
      return updateSet(activity, 'activeToolCalls', event.toolCallId, false)
    case 'queue_update': {
      const queuedMessages = event.steering.length + event.followUp.length
      return activity.queuedMessages === queuedMessages ? activity : advance(activity, { queuedMessages })
    }
    case 'compaction_start':
      return activity.compactionRunning ? activity : advance(activity, { compactionRunning: true })
    case 'compaction_end':
      return !activity.compactionRunning && (!event.willRetry || activity.retryRunning)
        ? activity
        : advance(activity, { compactionRunning: false, retryRunning: activity.retryRunning || event.willRetry })
    case 'auto_retry_start':
      return activity.retryRunning ? activity : advance(activity, { retryRunning: true })
    case 'auto_retry_end':
      return activity.retryRunning ? advance(activity, { retryRunning: false }) : activity
    case 'summarization_retry_scheduled':
    case 'summarization_retry_attempt_start':
      return activity.summarizationRunning ? activity : advance(activity, { summarizationRunning: true })
    case 'summarization_retry_finished':
      return activity.summarizationRunning ? advance(activity, { summarizationRunning: false }) : activity
    default:
      return undefined
  }
}

function reduceDeliveryState(activity: RuntimeActivity, delivery: LocalPiDeliverySnapshot): RuntimeActivity | undefined {
  if (delivery.revision <= activity.deliveryRevision) return undefined
  return advance(activity, {
    deliveryRevision: delivery.revision,
    managedMessages: delivery.items.length,
    managedReadyMessages: delivery.paused ? 0 : delivery.items.filter((item) => item.status === 'queued').length,
    managedDeliveringMessages: delivery.items.filter((item) => item.status === 'delivering').length,
    managedSdkMessages: delivery.items.filter((item) => item.mode === 'steer' && item.status === 'delivering').length,
    managedAcceptingMessages: delivery.receipts.filter((receipt) => receipt.status === 'accepting').length,
  })
}

function hasExecutionActivity(activity: RuntimeActivity): boolean {
  return activity.agentRunning || activity.compactionRunning || activity.retryRunning ||
    activity.summarizationRunning || activity.managedDeliveringMessages > 0 ||
    activity.activeToolCalls.size > 0 || activity.pendingUiRequests.size > 0
}

/** Pins and accepting commands protect runtime ownership even when the SDK reports idle. */
export function isRuntimeIdle(activity: RuntimeActivity): boolean {
  return activity.controlPins === 0 && activity.pendingCommands === 0 &&
    activity.queuedMessages === 0 && activity.managedReadyMessages === 0 &&
    activity.managedAcceptingMessages === 0 && !hasExecutionActivity(activity)
}

/** A second, authoritative veto used after asynchronous LRU/configuration probes. */
export function isSessionStateBusy(state: LocalPiSessionState): boolean {
  return state.isStreaming || state.isCompacting || state.pendingMessageCount > 0
}

export function isDeliverySnapshotBusy(delivery: LocalPiDeliverySnapshot): boolean {
  return delivery.receipts.some((receipt) => receipt.status === 'accepting') ||
    delivery.items.some((item) => item.status === 'delivering' ||
      (!delivery.paused && item.status === 'queued'))
}

export function summarizeRuntimeActivity(activity: RuntimeActivity): RuntimeActivitySummary {
  const externalQueuedMessages = Math.max(0, activity.queuedMessages - activity.managedSdkMessages)
  const lifecycle = activity.pendingCommands > 0 || activity.managedAcceptingMessages > 0 ? 'accepting'
    : externalQueuedMessages > 0 || activity.managedReadyMessages > 0 ? 'queued'
    : hasExecutionActivity(activity) ? 'running' : 'idle'
  const detail = activity.pendingUiRequests.size > 0 ? 'interaction'
    : activity.summarizationRunning ? 'summarization'
    : activity.compactionRunning ? 'compaction'
    : activity.retryRunning ? 'retry'
    : activity.activeToolCalls.size > 0 ? 'tool'
    : activity.agentRunning || activity.managedDeliveringMessages > 0 ? 'prompt' : undefined
  return {
    lifecycle,
    queueCount: externalQueuedMessages + activity.managedMessages,
    ...(activity.outcome ? { outcome: activity.outcome } : {}),
    ...(detail ? { activity: detail } : {}),
  }
}
