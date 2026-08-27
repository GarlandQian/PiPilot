import { describe, expect, it } from 'vitest'
import {
  canPromotePiFollowUp,
  promotePiFollowUpSnapshot,
  reconcilePiQueuedMessages,
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
})
