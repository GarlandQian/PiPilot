import { describe, expect, it, vi } from 'vitest'
import type { LocalPiDeliverySnapshot } from '../../src/shared/local-pi'
import {
  createPiSubmissionCommand,
  newerPiDeliverySnapshot,
  piSubmissionStatus,
  projectPiDeliveryQueue,
  requirePiSubmissionAccepted,
  resolvePiSubmission,
  samePiDeliveryOwner,
} from '../../src/renderer/pi-rpc/delivery-state'

const modes = { steeringMode: 'one-at-a-time', followUpMode: 'all' } as const
const image = { type: 'image', data: 'first-image', mimeType: 'image/png' } as const
const snapshot = (overrides: Partial<LocalPiDeliverySnapshot> = {}): LocalPiDeliverySnapshot => ({
  revision: 1, paused: false, items: [], receipts: [], ...overrides,
})

describe('authoritative pending message projection', () => {
  it('preserves duplicate-text identities and image-only payloads on fresh hydration', () => {
    const delivery = snapshot({ items: [
      { id: 'a', submissionId: 'sa', message: 'same', images: [image], mode: 'follow_up', status: 'queued' },
      { id: 'b', submissionId: 'sb', message: 'same', images: [{ ...image, data: 'second-image' }], mode: 'follow_up', status: 'queued' },
      { id: 'c', submissionId: 'sc', message: '', images: [image], mode: 'steer', status: 'queued' },
    ] })
    const queue = projectPiDeliveryQueue(delivery, 0, modes)
    expect(queue.pendingCount).toBe(3)
    expect(queue.detailsKnown).toBe(true)
    expect(queue.followUpItems.map((item) => [item.id, item.images[0]?.data]))
      .toEqual([['a', 'first-image'], ['b', 'second-image']])
    expect(queue.steeringItems[0]).toMatchObject({ id: 'c', text: '', images: [image], locallyOwned: true })
  })

  it('keeps frozen and unknown items when the SDK reports an empty queue', () => {
    const delivery = snapshot({ paused: true, items: [
      { id: 'frozen', submissionId: 'sf', message: 'later', mode: 'follow_up', status: 'frozen' },
      { id: 'unknown', submissionId: 'su', message: 'uncertain', mode: 'follow_up', status: 'unknown' },
    ] })
    const queue = projectPiDeliveryQueue(delivery, 0, modes)
    expect(queue).toMatchObject({ pendingCount: 2, paused: true, detailsKnown: true })
    expect(queue.followUpItems.map((item) => [item.status, item.locallyOwned]))
      .toEqual([['frozen', true], ['unknown', false]])
  })

  it('reports external SDK items as unknown without inventing payload ownership', () => {
    const delivery = snapshot({ items: [
      { id: 'owned', submissionId: 's', message: 'same', mode: 'steer', status: 'delivering' },
      { id: 'frozen', submissionId: 'f', message: 'same', mode: 'follow_up', status: 'frozen' },
    ] })
    const queue = projectPiDeliveryQueue(delivery, 3, modes)
    expect(queue).toMatchObject({ pendingCount: 4, detailsKnown: false })
    expect(queue.steeringItems.map((item) => item.id)).toEqual(['owned'])
    expect(queue.followUpItems.map((item) => item.id)).toEqual(['frozen'])
    expect(queue.steeringItems[0]?.locallyOwned).toBe(false)
  })

  it('does not resurrect a removed item from an older snapshot response', () => {
    const current = snapshot({ revision: 9 })
    const stale = snapshot({ revision: 8, items: [
      { id: 'removed', submissionId: 's', message: 'gone', mode: 'follow_up', status: 'queued' },
    ] })
    expect(newerPiDeliverySnapshot(current, stale)).toBe(current)
    expect(newerPiDeliverySnapshot(null, stale)).toBe(stale)
  })
})

describe('submission acceptance and transport recovery', () => {
  it('delegates idle/running decisions to Pi while preserving extension command execution', () => {
    const input = { submissionId: 'stable', sessionId: 'source', text: 'next', images: [], isExtensionCommand: false }
    for (const action of ['prompt', 'follow_up'] as const) {
      expect(createPiSubmissionCommand({ ...input, action })).toEqual({
        type: 'submit_message', submissionId: 'stable', expectedSessionId: 'source', message: 'next', mode: 'auto',
      })
      expect(createPiSubmissionCommand({ ...input, action, isExtensionCommand: true }).mode).toBe('command')
    }
  })

  it('accepts image-only queued drafts with a captured payload and stable session owner', () => {
    const images = [{ ...image, data: String(image.data) }]
    const command = createPiSubmissionCommand({
      submissionId: 'image', sessionId: 'source', text: '', images, action: 'follow_up', isExtensionCommand: false,
    })
    images[0]!.data = 'mutated'
    expect(command).toMatchObject({ expectedSessionId: 'source', submissionId: 'image', message: '', images: [image], mode: 'auto' })
  })

  it('treats consumed and removed receipts as previously accepted, never retryable rejection', () => {
    for (const status of ['accepted', 'consumed', 'removed'] as const) {
      expect(piSubmissionStatus({ submissionId: 's', status })).toBe('accepted')
      expect(() => requirePiSubmissionAccepted({ submissionId: 's', status })).not.toThrow()
    }
    expect(piSubmissionStatus(undefined)).toBe('missing')
  })

  it('preserves definitive rejection versus accepting and unknown states', () => {
    for (const status of ['rejected', 'accepting', 'unknown'] as const) {
      expect(() => requirePiSubmissionAccepted({ submissionId: 's', status, error: 'detail' }))
        .toThrow(expect.objectContaining({ submissionId: 's', status, message: 'detail' }))
    }
  })

  it('queries a lost response once and recovers the exact durable receipt', async () => {
    const receipt = { submissionId: 'stable', status: 'accepted', acceptedMode: 'follow_up' } as const
    const delivery = snapshot({ receipts: [receipt] })
    const submit = vi.fn().mockRejectedValue(new Error('IPC response lost'))
    const query = vi.fn().mockResolvedValue(delivery)
    await expect(resolvePiSubmission({ submissionId: 'stable', submit, query, isOwnerCurrent: () => true }))
      .resolves.toEqual({ receipt, delivery })
    expect(submit).toHaveBeenCalledTimes(1)
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('retains explicit rejected receipts after a lost response', async () => {
    const receipt = { submissionId: 's', status: 'rejected', error: 'Model cannot accept images.' } as const
    const result = await resolvePiSubmission({
      submissionId: 's', submit: async () => { throw new Error('lost') },
      query: async () => snapshot({ receipts: [receipt] }), isOwnerCurrent: () => true,
    })
    expect(() => requirePiSubmissionAccepted(result.receipt)).toThrow(expect.objectContaining({ status: 'rejected' }))
  })

  it('does not query the newly selected conversation after send failure', async () => {
    const query = vi.fn()
    await expect(resolvePiSubmission({
      submissionId: 's', submit: async () => { throw new Error('lost') },
      query, isOwnerCurrent: () => false,
    })).rejects.toMatchObject({ submissionId: 's', status: 'unknown' })
    expect(query).not.toHaveBeenCalled()
  })

  it('does not treat a missing or failed receipt query as proof of rejection', async () => {
    for (const query of [async () => snapshot(), async (): Promise<LocalPiDeliverySnapshot> => { throw new Error('offline') }]) {
      await expect(resolvePiSubmission({
        submissionId: 's', submit: async () => { throw new Error('lost') },
        query, isOwnerCurrent: () => true,
      })).rejects.toMatchObject({ submissionId: 's', status: 'unknown' })
    }
  })

  it('keeps confirmed acceptance successful after navigating away', async () => {
    const result = { receipt: { submissionId: 's', status: 'accepted' as const }, delivery: snapshot() }
    const query = vi.fn()
    await expect(resolvePiSubmission({
      submissionId: 's', submit: async () => result, query, isOwnerCurrent: () => false,
    })).resolves.toEqual(result)
    expect(query).not.toHaveBeenCalled()
  })

  it('rejects delayed callbacks after A to B to A even when session and runtime match', () => {
    const owner = { scopeKey: 'project-a', generation: 3, sessionId: 'session-a', revision: 1 }
    expect(samePiDeliveryOwner(owner, { ...owner })).toBe(true)
    expect(samePiDeliveryOwner(owner, { ...owner, revision: 3 })).toBe(false)
    expect(samePiDeliveryOwner(owner, { ...owner, sessionId: 'session-b' })).toBe(false)
  })
})
