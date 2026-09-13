import {
  hasCompletePiQueuePayloads,
  type PiQueuedMessage,
} from '@/renderer/pi-rpc/queue-payloads'
import type { LocalPiThinkingLevel } from '@/shared/local-pi'
import type { RunningSubmitPreference } from '@/shared/settings'

export type ComposerSubmitAction = 'prompt' | 'follow_up' | 'steer'
export type ComposerSubmitKind = 'send' | 'queue' | 'steer' | 'run-now'
export type ComposerQueueMode = 'all' | 'one-at-a-time'

export interface ComposerSubmitMode {
  action: ComposerSubmitAction
  kind: ComposerSubmitKind
}

export interface ComposerQueueState {
  pendingCount: number
  detailsKnown: boolean
  steering: readonly string[]
  followUp: readonly string[]
  steeringItems: readonly PiQueuedMessage[]
  followUpItems: readonly PiQueuedMessage[]
  steeringMode: ComposerQueueMode
  followUpMode: ComposerQueueMode
}

export interface PendingRailItem extends PiQueuedMessage {
  kind: 'steering' | 'followUp'
  canPromote: boolean
  canRemove: boolean
}

export interface PendingRailPresentation {
  visible: boolean
  count: number
  detailsKnown: boolean
  losslessMutationAvailable: boolean
  nextText: string | null
  nextImageCount: number
  items: readonly PendingRailItem[]
}

export interface ModelThinkingTriggerPresentation {
  modelLabel: string | null
  thinkingLevel: LocalPiThinkingLevel | null
}

export function normalizeRunningSubmitPreference(
  value: unknown,
): RunningSubmitPreference {
  return value === 'steer' ? 'steer' : 'queue'
}

export function deriveComposerSubmitMode(
  isStreaming: boolean,
  hasExtensionCommand: boolean,
  runningSubmit: RunningSubmitPreference = 'queue',
): ComposerSubmitMode {
  if (!isStreaming) return { action: 'prompt', kind: 'send' }
  if (hasExtensionCommand) return { action: 'prompt', kind: 'run-now' }
  return runningSubmit === 'steer'
    ? { action: 'steer', kind: 'steer' }
    : { action: 'follow_up', kind: 'queue' }
}

export function deriveComposerActionState(input: {
  ready: boolean
  isStreaming: boolean
  hasExtensionCommand: boolean
  runningSubmitPreference: RunningSubmitPreference
  hasContent: boolean
  imageCount: number
  supportsImages: boolean
  hasConflict: boolean
  submitting: boolean
  stopping: boolean
}) {
  const submit = deriveComposerSubmitMode(
    input.isStreaming,
    input.hasExtensionCommand,
    input.runningSubmitPreference,
  )
  return {
    submit,
    canSubmit: input.ready && !input.submitting && !input.hasConflict &&
      (input.hasContent || input.imageCount > 0) &&
      (input.imageCount === 0 || input.supportsImages) &&
      (submit.action === 'prompt' || input.hasContent),
    canStop: input.ready && input.isStreaming && !input.stopping,
  }
}

export function projectModelThinkingTrigger(
  model: { id: string; name: string } | null,
  thinkingLevel: LocalPiThinkingLevel | null,
  availableThinkingLevels?: readonly LocalPiThinkingLevel[],
): ModelThinkingTriggerPresentation {
  const name = model?.name.trim()
  const id = model?.id.trim()
  const hasSelectableThinking = availableThinkingLevels === undefined ||
    availableThinkingLevels.length > 1
  return {
    modelLabel: name || id || null,
    thinkingLevel: hasSelectableThinking ? thinkingLevel : null,
  }
}

export function projectPendingRail(
  queue: ComposerQueueState,
): PendingRailPresentation {
  const losslessMutationAvailable = queue.detailsKnown &&
    hasCompletePiQueuePayloads(
      queue.pendingCount,
      queue.steeringItems,
      queue.followUpItems,
    )
  const items: PendingRailItem[] = [
    ...queue.steeringItems.map((item) => ({
      ...item,
      kind: 'steering' as const,
      canPromote: false,
      canRemove: losslessMutationAvailable,
    })),
    ...queue.followUpItems.map((item) => ({
      ...item,
      kind: 'followUp' as const,
      canPromote: losslessMutationAvailable,
      canRemove: losslessMutationAvailable,
    })),
  ]
  const next = items[0]

  return {
    visible: queue.pendingCount > 0,
    count: queue.pendingCount,
    detailsKnown: queue.detailsKnown,
    losslessMutationAvailable,
    nextText: next?.text ?? null,
    nextImageCount: next?.images.length ?? 0,
    items,
  }
}
