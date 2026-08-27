import type { LocalPiImageContent } from '@/shared/local-pi'

export type PiQueueKind = 'steering' | 'followUp'

export interface PiQueuedMessage {
  id: string
  text: string
  images: readonly LocalPiImageContent[]
  locallyOwned: boolean
}

export interface PendingPiQueuedMessage extends PiQueuedMessage {
  kind: PiQueueKind
  before: readonly string[]
}

function sameStrings(left: readonly string[], right: readonly string[]) {
  return left.length === right.length &&
    left.every((value, index) => value === right[index])
}

export function queueTexts(items: readonly PiQueuedMessage[]) {
  return items.map((item) => item.text)
}

export function reconcilePiQueuedMessages(
  officialTexts: readonly string[],
  previous: readonly PiQueuedMessage[],
  pending: PendingPiQueuedMessage | null,
  unknownId: () => string,
): readonly PiQueuedMessage[] {
  const previousTexts = queueTexts(previous)
  if (sameStrings(previousTexts, officialTexts)) return previous

  if (
    pending &&
    officialTexts.length === pending.before.length + 1 &&
    sameStrings(officialTexts.slice(0, -1), pending.before)
  ) {
    const prefix = sameStrings(previousTexts, pending.before)
      ? previous
      : reconcilePiQueuedMessages(pending.before, previous, null, unknownId)
    return [
      ...prefix,
      {
        id: pending.id,
        text: officialTexts[officialTexts.length - 1]!,
        images: pending.images,
        locallyOwned: true,
      },
    ]
  }

  const previousCounts = new Map<string, number>()
  const officialCounts = new Map<string, number>()
  for (const item of previous) {
    previousCounts.set(item.text, (previousCounts.get(item.text) ?? 0) + 1)
  }
  for (const text of officialTexts) {
    officialCounts.set(text, (officialCounts.get(text) ?? 0) + 1)
  }
  const previousByText = new Map(previous.map((item) => [item.text, item]))

  return officialTexts.map((text) => {
    const unambiguous = previousCounts.get(text) === 1 && officialCounts.get(text) === 1
    const matched = unambiguous ? previousByText.get(text) : undefined
    return matched ?? {
      id: unknownId(),
      text,
      images: [],
      locallyOwned: false,
    }
  })
}

export function canPromotePiFollowUp(
  steering: readonly PiQueuedMessage[],
  followUp: readonly PiQueuedMessage[],
) {
  return followUp.length > 0 &&
    [...steering, ...followUp].every((item) => item.locallyOwned)
}

export function promotePiFollowUpSnapshot(
  steering: readonly PiQueuedMessage[],
  followUp: readonly PiQueuedMessage[],
  itemId: string,
) {
  if (!canPromotePiFollowUp(steering, followUp)) return null
  const index = followUp.findIndex((item) => item.id === itemId)
  if (index === -1) return null
  const promoted = followUp[index]!
  return {
    steering: [...steering, promoted],
    followUp: followUp.filter((_, itemIndex) => itemIndex !== index),
    followUpIndex: index,
  }
}
