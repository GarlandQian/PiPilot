import type {
  LocalPiDeliveryReceipt,
  LocalPiDeliverySnapshot,
  LocalPiImageContent,
} from '@/shared/local-pi'
import type { PiQueuedMessage } from './queue-payloads'

export type PiSubmissionStatus = 'accepted' | 'rejected' | 'unknown' | 'missing' | 'accepting'

export function createPiSubmissionCommand(input: {
  submissionId: string
  sessionId: string
  text: string
  images: readonly LocalPiImageContent[]
  action: 'prompt' | 'follow_up' | 'steer'
  isExtensionCommand: boolean
}) {
  return {
    type: 'submit_message' as const,
    submissionId: input.submissionId,
    expectedSessionId: input.sessionId,
    message: input.text,
    ...(input.images.length > 0 ? { images: input.images.map((image) => ({ ...image })) } : {}),
    mode: input.isExtensionCommand ? 'command' as const : input.action === 'steer' ? 'steer' as const : 'auto' as const,
  }
}

export class PiSubmissionError extends Error {
  readonly name = 'PiSubmissionError'

  constructor(
    readonly submissionId: string,
    readonly status: 'rejected' | 'unknown' | 'accepting',
    message: string,
  ) {
    super(message)
  }
}

export function piSubmissionStatus(receipt: LocalPiDeliveryReceipt | undefined): PiSubmissionStatus {
  if (!receipt) return 'missing'
  if (receipt.status === 'accepted' || receipt.status === 'consumed' || receipt.status === 'removed') {
    return 'accepted'
  }
  return receipt.status
}

export function requirePiSubmissionAccepted(receipt: LocalPiDeliveryReceipt): void {
  const status = piSubmissionStatus(receipt)
  if (status === 'accepted') return
  throw new PiSubmissionError(
    receipt.submissionId,
    status === 'rejected' || status === 'accepting' ? status : 'unknown',
    receipt.error ?? (status === 'rejected'
      ? 'Pi rejected this message.'
      : 'Message acceptance has not been confirmed. Check its status before retrying.'),
  )
}

export async function resolvePiSubmission({ submissionId, submit, query, isOwnerCurrent }: {
  submissionId: string
  submit(): Promise<{ receipt: LocalPiDeliveryReceipt; delivery: LocalPiDeliverySnapshot }>
  query(): Promise<LocalPiDeliverySnapshot>
  isOwnerCurrent(): boolean
}) {
  try {
    return await submit()
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Message acceptance could not be confirmed.'
    if (!isOwnerCurrent()) throw new PiSubmissionError(submissionId, 'unknown', message)
    let delivery: LocalPiDeliverySnapshot
    try {
      delivery = await query()
    } catch {
      throw new PiSubmissionError(submissionId, 'unknown', message)
    }
    if (!isOwnerCurrent()) throw new PiSubmissionError(submissionId, 'unknown', message)
    const receipt = delivery.receipts.find((item) => item.submissionId === submissionId)
    if (!receipt) throw new PiSubmissionError(submissionId, 'unknown', message)
    return { receipt, delivery }
  }
}

export function newerPiDeliverySnapshot(
  current: LocalPiDeliverySnapshot | null,
  incoming: LocalPiDeliverySnapshot,
) {
  return current && current.revision > incoming.revision ? current : incoming
}

/** Only steering handed to the SDK contributes to its native queue count. */
export function projectPiDeliveryQueue(
  delivery: LocalPiDeliverySnapshot,
  officialPendingCount: number,
  modes: { steeringMode: 'all' | 'one-at-a-time'; followUpMode: 'all' | 'one-at-a-time' },
) {
  const items = delivery.items.map((item): PiQueuedMessage => ({
    id: item.id,
    submissionId: item.submissionId,
    text: item.message,
    images: item.images ?? [],
    status: item.status,
    locallyOwned: item.status !== 'unknown' && item.status !== 'delivering',
  }))
  const steeringItems = items.filter((_, index) => delivery.items[index]?.mode === 'steer')
  const followUpItems = items.filter((_, index) => delivery.items[index]?.mode === 'follow_up')
  const managedSdkCount = delivery.items.filter((item) => item.mode === 'steer' && item.status === 'delivering').length
  const unmanagedCount = Math.max(0, officialPendingCount - managedSdkCount)
  return {
    ...modes,
    revision: delivery.revision,
    paused: delivery.paused,
    pendingCount: items.length + unmanagedCount,
    detailsKnown: unmanagedCount === 0,
    steering: steeringItems.map((item) => item.text),
    followUp: followUpItems.map((item) => item.text),
    steeringItems,
    followUpItems,
  }
}

export interface PiDeliveryOwner {
  scopeKey: string
  generation: number | null
  sessionId: string | null
  revision: number
}

export function samePiDeliveryOwner(left: PiDeliveryOwner, right: PiDeliveryOwner) {
  return left.scopeKey === right.scopeKey && left.generation === right.generation &&
    left.sessionId === right.sessionId && left.revision === right.revision
}
