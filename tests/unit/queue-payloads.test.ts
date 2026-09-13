import { describe, expect, it } from 'vitest'
import {
  canPromotePiFollowUp,
  canMutatePiQueue,
  hasCompletePiQueuePayloads,
  PI_QUEUE_MUTATION_SETTLE_MS,
  piQueueItemsMatchSnapshot,
  promotePiFollowUpSnapshot,
  reconcilePiQueuedMessages,
  removePiQueuedMessageSnapshot,
  type PendingPiQueuedMessage,
  type PiQueuedMessage,
} from '../../src/renderer/pi-rpc/queue-payloads'

const image = {
  type: 'image' as const,
  data: 'iVBORw0KGgo=',
  mimeType: 'image/png',
}

function localItem(id: string, text: string): PiQueuedMessage {
  return { id, text, images: [image], locallyOwned: true }
}

describe('Pi queue payload projection', () => {
  it('uses a bounded mutation-settlement guard and matches both queue kinds exactly', () => {
    const steering = [localItem('steer-1', 'guide')]
    const followUp = [localItem('follow-1', 'later')]
    expect(PI_QUEUE_MUTATION_SETTLE_MS).toBeGreaterThan(0)
    expect(PI_QUEUE_MUTATION_SETTLE_MS).toBeLessThanOrEqual(5_000)
    expect(piQueueItemsMatchSnapshot(
      { steering: ['guide'], followUp: ['later'] },
      steering,
      followUp,
    )).toBe(true)
    expect(piQueueItemsMatchSnapshot(
      { steering: ['guide'], followUp: [] },
      steering,
      followUp,
    )).toBe(false)
  })

  it('binds an official appended queue row to the renderer-owned text and images', () => {
    const pending: PendingPiQueuedMessage = {
      ...localItem('local-1', '/skill:inspect files'),
      kind: 'followUp',
      before: ['existing'],
    }
    const next = reconcilePiQueuedMessages(
      ['existing', '<skill>expanded</skill>\n\nfiles'],
      [{ id: 'unknown-1', text: 'existing', images: [], locallyOwned: false }],
      pending,
      () => 'unknown-new',
    )

    expect(next[1]).toEqual({
      id: 'local-1',
      text: '<skill>expanded</skill>\n\nfiles',
      images: [image],
      locallyOwned: true,
    })
  })

  it('does not guess payload ownership after an ambiguous duplicate queue change', () => {
    const next = reconcilePiQueuedMessages(
      ['same'],
      [localItem('first', 'same'), localItem('second', 'same')],
      null,
      () => 'unknown',
    )

    expect(next).toEqual([{
      id: 'unknown',
      text: 'same',
      images: [],
      locallyOwned: false,
    }])
    expect(canPromotePiFollowUp([], next)).toBe(false)
  })

  it('moves an owned Follow-up to the end of Steer without changing its images', () => {
    const steering = [localItem('steer-1', 'guide first')]
    const followUp = [
      localItem('follow-1', 'queued with image'),
      localItem('follow-2', 'then summarize'),
    ]

    expect(promotePiFollowUpSnapshot(steering, followUp, 'follow-1')).toEqual({
      steering: [steering[0], followUp[0]],
      followUp: [followUp[1]],
      followUpIndex: 0,
    })
  })

  it('removes an exact owned item without changing the remaining payloads', () => {
    const steering = [localItem('steer-1', 'guide first')]
    const followUp = [
      localItem('follow-1', 'then summarize'),
      localItem('follow-2', 'then test'),
    ]

    expect(removePiQueuedMessageSnapshot(steering, followUp, 'follow-1')).toEqual({
      kind: 'followUp',
      itemIndex: 0,
      steering,
      followUp: [followUp[1]],
    })
  })

  it('does not expose queue mutation when any payload is not locally owned', () => {
    const unknown = {
      id: 'unknown', text: 'external', images: [], locallyOwned: false,
    }
    expect(canMutatePiQueue([], [unknown])).toBe(false)
    expect(removePiQueuedMessageSnapshot([], [unknown], 'unknown')).toBeNull()
  })

  it('requires retained payloads for every authoritative queued message', () => {
    const owned = localItem('owned', 'Known')

    expect(hasCompletePiQueuePayloads(1, [], [owned])).toBe(true)
    expect(hasCompletePiQueuePayloads(2, [], [owned])).toBe(false)
    expect(hasCompletePiQueuePayloads(0, [], [])).toBe(false)
  })
})
