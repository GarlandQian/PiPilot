import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentSessionEvent, AgentSessionRuntime } from '@earendil-works/pi-coding-agent'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RuntimeDelivery } from '../../src/main/pi-host/runtime-delivery'
import type { LocalPiDeliverySnapshot, LocalPiImageContent } from '../../src/shared/local-pi'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture(streaming = true) {
  const directory = await mkdtemp(join(tmpdir(), 'pipilot-delivery-'))
  roots.push(directory)
  let steering: string[] = []
  let followUp: string[] = []
  type NativeMessage = { role: 'user'; content: Array<{ type: 'text'; text: string } | LocalPiImageContent>; timestamp: number }
  const nativeMessages: NativeMessage[] = []
  const snapshots: LocalPiDeliverySnapshot[] = []
  const session = {
    sessionId: 'session-1', isStreaming: streaming,
    agent: { steer(message: NativeMessage) { nativeMessages.push(message) } },
    getSteeringMessages: () => steering,
    getFollowUpMessages: () => followUp,
    steer: vi.fn(async (message: string, images?: readonly LocalPiImageContent[]) => {
      steering.push(message)
      session.agent.steer({ role: 'user', content: [{ type: 'text', text: message }, ...images ?? []], timestamp: 1 })
    }),
    followUp: vi.fn(async (message: string, _images?: readonly LocalPiImageContent[]) => { followUp.push(message) }),
    prompt: vi.fn(async (_message: string, options: { preflightResult?(accepted: boolean): void }) => {
      options.preflightResult?.(true)
      session.isStreaming = true
    }),
    clearQueue: vi.fn(() => {
      const result = { steering, followUp }
      steering = []
      followUp = []
      return result
    }),
    abort: vi.fn(async () => { session.isStreaming = false }),
  }
  const runtime = { session } as unknown as AgentSessionRuntime
  const delivery = new RuntimeDelivery(runtime, directory, '/project', (snapshot) => snapshots.push(snapshot))
  const submit = (submissionId: string, message = submissionId) => delivery.submit({ type: 'submit_message', submissionId, message, mode: 'auto' })
  const consume = (message: string) => {
    if (steering[0] === message) steering.shift()
    else if (followUp[0] === message) followUp.shift()
    const native = nativeMessages.shift()
    if (!native) throw new Error('No native message to consume')
    delivery.observe({ type: 'message_start', message: native } as AgentSessionEvent)
  }
  return { delivery, runtime, session, directory, snapshots, submit, consume }
}

describe('durable runtime delivery', () => {
  it('persists a managed follow-up without native enqueue and deduplicates its submission ID', async () => {
    const { delivery, session, directory, submit } = await fixture()
    const first = await submit('once')
    const path = join(directory, (await readdir(directory)).find((name) => name.endsWith('.json'))!)
    const saved = JSON.parse(await readFile(path, 'utf8'))
    expect(saved.items[0]).toMatchObject({ message: 'once', status: 'queued' })
    expect(first.receipt.status).toBe('accepted')
    expect((await submit('once')).receipt).toEqual(first.receipt)
    expect(session.followUp).not.toHaveBeenCalled()
    await expect(submit('once', 'different body')).rejects.toThrow('different message')
    expect(delivery.snapshot().items).toHaveLength(1)
  })

  it('routes from authoritative execution state and acknowledges preflight without waiting for generation', async () => {
    const { submit, session } = await fixture(false)
    session.prompt.mockImplementation((_message, options) => {
      options.preflightResult?.(true)
      return new Promise(() => undefined)
    })
    expect((await submit('idle')).receipt.acceptedMode).toBe('prompt')
    expect(session.followUp).not.toHaveBeenCalled()
    session.isStreaming = true
    expect((await submit('busy')).receipt.acceptedMode).toBe('follow_up')
  })

  it('keeps rejected receipts stable instead of silently retrying them', async () => {
    const { submit, session } = await fixture(false)
    session.prompt.mockRejectedValue(new Error('Missing credentials'))
    const result = await submit('bad-auth')
    expect(result.receipt).toMatchObject({ status: 'rejected', error: 'Missing credentials' })
    expect((await submit('bad-auth')).receipt.status).toBe('rejected')
    expect(session.prompt).toHaveBeenCalledTimes(1)
  })

  it('keeps consumption authoritative when enqueue later rejects', async () => {
    const { consume, session, delivery } = await fixture()
    const enqueue = session.steer.getMockImplementation()!
    session.steer.mockImplementation(async (message, images) => {
      const pending = enqueue(message, images)
      queueMicrotask(() => consume(message))
      await pending
      throw new Error('late completion failure')
    })
    const command = { type: 'submit_message' as const, submissionId: 'already-consumed', message: 'already-consumed', mode: 'steer' as const }
    expect((await delivery.submit(command)).receipt.status).toBe('consumed')
    expect(delivery.snapshot().items).toEqual([])
    expect((await delivery.submit(command)).receipt.status).toBe('consumed')
    expect(session.steer).toHaveBeenCalledTimes(1)
  })

  it('exposes reserved acceptance before execution and recovers it as unknown', async () => {
    const { delivery, runtime, directory, session } = await fixture(false)
    const command = { type: 'submit_message' as const, submissionId: 'reserved', message: 'queued for admission', mode: 'auto' as const }
    delivery.reserve(command)
    expect(delivery.snapshot('reserved').receipts[0]?.status).toBe('accepting')
    expect(session.prompt).not.toHaveBeenCalled()
    const recovered = new RuntimeDelivery(runtime, directory, '/project', () => undefined)
    expect((await recovered.submit(command)).receipt.status).toBe('unknown')
    expect(session.prompt).not.toHaveBeenCalled()
  })

  it('prevents a delayed prompt preflight from starting a run after Stop', async () => {
    const { delivery, submit, session } = await fixture(false)
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    session.prompt.mockImplementation(async (_message, options) => {
      await gate
      options.preflightResult?.(true)
      session.isStreaming = true
    })
    const pending = submit('slow-auth')
    await delivery.pauseAndAbort()
    release()
    expect((await pending).receipt.status).toBe('unknown')
    expect(session.isStreaming).toBe(false)
    expect((await submit('slow-auth')).receipt.status).toBe('unknown')
    expect(session.prompt).toHaveBeenCalledTimes(1)
  })

  it('preserves complete image-only payloads and stable IDs until consumption', async () => {
    const { delivery, session } = await fixture()
    const images = [{ type: 'image' as const, data: 'image-data', mimeType: 'image/png' }]
    const result = await delivery.submit({ type: 'submit_message', submissionId: 'image-only', message: '', images, mode: 'auto' })
    expect(session.followUp).not.toHaveBeenCalled()
    expect(result.delivery.items[0]).toMatchObject({ id: result.receipt.itemId, message: '', images })
    session.isStreaming = false
    await delivery.pump()
    expect(session.prompt).toHaveBeenCalledWith('', expect.objectContaining({ images }))
    expect(delivery.snapshot().items).toEqual([])
    expect(delivery.snapshot().receipts[0]?.status).toBe('consumed')
  })

  it('clears native work before abort and freezes new sends until explicit resume', async () => {
    const { delivery, session, submit } = await fixture()
    await submit('first')
    session.abort.mockImplementation(async () => {
      expect(session.getFollowUpMessages()).toEqual([])
      expect(delivery.snapshot()).toMatchObject({ paused: true, items: [{ status: 'frozen' }] })
      session.isStreaming = false
    })
    await delivery.pauseAndAbort()
    await submit('second')
    expect(session.followUp).not.toHaveBeenCalled()
    expect(delivery.snapshot().items.map((item) => item.status)).toEqual(['frozen', 'frozen'])
    const resumed = await delivery.resume(delivery.snapshot().revision)
    expect(resumed.paused).toBe(false)
    expect(session.prompt).toHaveBeenCalledTimes(1)
    expect(resumed.items).toMatchObject([{ message: 'second', status: 'queued' }])
    session.isStreaming = false
    await delivery.pump()
    expect(session.prompt).toHaveBeenLastCalledWith('second', expect.any(Object))
  })

  it('deduplicates an in-flight Stop and rejects Resume until abort has finished', async () => {
    const { delivery, session, submit } = await fixture()
    const queued = await submit('waiting-before-stop')
    let finishAbort!: () => void
    const abortGate = new Promise<void>((resolve) => { finishAbort = resolve })
    session.abort.mockImplementation(async () => {
      await abortGate
      session.isStreaming = false
    })

    const stopping = delivery.pauseAndAbort()
    const duplicateStop = delivery.pauseAndAbort()
    expect(duplicateStop).toBe(stopping)
    expect(session.abort).toHaveBeenCalledTimes(1)
    expect(session.clearQueue).toHaveBeenCalledTimes(1)
    await delivery.mutate({ type: 'mutate_delivery', itemId: queued.receipt.itemId!, revision: delivery.snapshot().revision, action: 'promote' })
    await expect(delivery.resume(delivery.snapshot().revision)).rejects.toThrow('Pi is still stopping')
    await submit('sent-during-stop')
    expect(delivery.snapshot()).toMatchObject({ paused: true, items: [{ mode: 'steer', status: 'frozen' }, { status: 'frozen' }] })
    expect(session.steer).not.toHaveBeenCalled()
    // The SDK can become idle before its async abort hooks finish.
    session.isStreaming = false
    await delivery.pump()
    expect(session.prompt).not.toHaveBeenCalled()

    finishAbort()
    await Promise.all([stopping, duplicateStop])
    expect(session.clearQueue).toHaveBeenCalledTimes(2)
    expect(delivery.snapshot().items.every((item) => item.status === 'frozen')).toBe(true)
    const resumed = await delivery.resume(delivery.snapshot().revision)
    expect(session.prompt).toHaveBeenCalledOnce()
    expect(session.prompt).toHaveBeenCalledWith('waiting-before-stop', expect.any(Object))
    expect(resumed).toMatchObject({ paused: false, items: [{ message: 'sent-during-stop', status: 'queued' }] })
  })

  it('reopens armed work as unknown and never replays it, while frozen work remains resumable', async () => {
    const { delivery, runtime, directory, session, submit } = await fixture()
    await submit('safe-managed')
    const command = { type: 'submit_message' as const, submissionId: 'armed', message: 'armed', mode: 'steer' as const }
    await delivery.submit(command)
    const recovered = new RuntimeDelivery(runtime, directory, '/project', () => undefined)
    expect(recovered.snapshot()).toMatchObject({ paused: true, items: [{ status: 'frozen' }, { status: 'unknown' }] })
    expect((await recovered.submit(command)).receipt.status).toBe('unknown')
    expect(session.steer).toHaveBeenCalledTimes(1)
    await expect(recovered.resume()).rejects.toThrow('unconfirmed')
  })

  it('returns an exact old receipt outside the bounded presentation window', async () => {
    const { delivery, submit, session } = await fixture(false)
    session.prompt.mockImplementation(async (_message, options) => { options.preflightResult?.(true) })
    for (let index = 0; index < 202; index += 1) await submit(`receipt-${index}`)
    expect(delivery.snapshot().receipts).toHaveLength(200)
    expect(delivery.snapshot().receipts.some((receipt) => receipt.submissionId === 'receipt-0')).toBe(false)
    expect(delivery.snapshot('receipt-0').receipts.find((receipt) => receipt.submissionId === 'receipt-0')?.status).toBe('accepted')
    expect((await submit('receipt-0')).receipt.status).toBe('accepted')
    expect(session.prompt).toHaveBeenCalledTimes(202)
  })

  it('edits and promotes exact IDs, rejects stale revisions, and cannot modify consumed items', async () => {
    const { delivery, submit, consume } = await fixture()
    const first = await submit('first')
    await submit('second')
    await expect(delivery.mutate({ type: 'mutate_delivery', itemId: first.receipt.itemId!, revision: first.delivery.revision, action: 'remove' })).rejects.toThrow('changed')
    const edited = await delivery.mutate({ type: 'mutate_delivery', itemId: first.receipt.itemId!, revision: delivery.snapshot().revision, action: 'edit', message: 'edited' })
    expect(edited.items[0]).toMatchObject({ id: first.receipt.itemId, message: 'edited' })
    const promoted = await delivery.mutate({ type: 'mutate_delivery', itemId: first.receipt.itemId!, revision: edited.revision, action: 'promote' })
    expect(promoted.items.find((item) => item.id === first.receipt.itemId)?.mode).toBe('steer')
    consume('edited')
    await expect(delivery.mutate({ type: 'mutate_delivery', itemId: first.receipt.itemId!, revision: delivery.snapshot().revision, action: 'remove' })).rejects.toThrow('consumed')
  })

  it('does not edit handed-off steering even while the SDK text mirror still shows it queued', async () => {
    const { delivery, session } = await fixture()
    const result = await delivery.submit({ type: 'submit_message', submissionId: 'draining', message: 'draining', mode: 'steer' })
    expect(session.getSteeringMessages()).toEqual(['draining'])
    await expect(delivery.mutate({ type: 'mutate_delivery', itemId: result.receipt.itemId!, revision: result.delivery.revision, action: 'remove' })).rejects.toThrow('already taken')
    expect(session.clearQueue).not.toHaveBeenCalled()
  })

  it('acknowledges exact SDK message objects rather than matching duplicate text', async () => {
    const { delivery, consume } = await fixture()
    const first = await delivery.submit({ type: 'submit_message', submissionId: 'first', message: 'same', mode: 'steer' })
    const second = await delivery.submit({ type: 'submit_message', submissionId: 'second', message: 'same', mode: 'steer' })
    delivery.observe({ type: 'message_start', message: { role: 'user', content: [{ type: 'text', text: 'same' }], timestamp: 1 } } as AgentSessionEvent)
    expect(delivery.snapshot().items).toHaveLength(2)
    consume('same')
    expect(delivery.snapshot().receipts.find((receipt) => receipt.submissionId === 'first')?.status).toBe('consumed')
    expect(delivery.snapshot().items).toHaveLength(1)
    expect(delivery.snapshot().items[0]?.id).toBe(second.receipt.itemId)
    expect(delivery.snapshot().items[0]?.id).not.toBe(first.receipt.itemId)
  })

  it('keeps handed-off steering payloads unknown after Stop without replaying them', async () => {
    const { delivery, session } = await fixture()
    const images = [{ type: 'image' as const, data: 'retained-image', mimeType: 'image/png' }]
    const command = { type: 'submit_message' as const, submissionId: 'interrupted-steer', message: '', images, mode: 'steer' as const }
    const accepted = await delivery.submit(command)
    expect(accepted.delivery.items[0]?.status).toBe('delivering')
    await delivery.pauseAndAbort()
    expect(delivery.snapshot().items[0]).toMatchObject({ status: 'unknown', images })
    expect((await delivery.submit(command)).receipt.status).toBe('unknown')
    expect(session.steer).toHaveBeenCalledTimes(1)
    await expect(delivery.resume()).rejects.toThrow('unconfirmed')
    const itemId = accepted.receipt.itemId!
    await delivery.mutate({ type: 'mutate_delivery', itemId, revision: delivery.snapshot().revision, action: 'remove' })
    expect((await delivery.submit(command)).receipt.status).toBe('removed')
    await delivery.resume(delivery.snapshot().revision)
    expect(delivery.snapshot().paused).toBe(false)
    expect(session.steer).toHaveBeenCalledTimes(1)
  })

  it('atomically clears only mutable waiting items and keeps receipt tombstones', async () => {
    const { delivery, submit } = await fixture()
    const waiting = await submit('waiting')
    const handed = await delivery.submit({ type: 'submit_message', submissionId: 'handed', message: 'handed', mode: 'steer' })
    expect(() => delivery.clear(waiting.delivery.revision)).toThrow('changed')
    const active = delivery.clear(delivery.snapshot().revision)
    expect(active.paused).toBe(false)
    expect(active.items).toMatchObject([{ id: handed.receipt.itemId, status: 'delivering' }])
    expect((await submit('waiting')).receipt.status).toBe('removed')
    await delivery.pauseAndAbort()
    await submit('frozen')
    const stopped = delivery.clear(delivery.snapshot().revision)
    expect(stopped.paused).toBe(true)
    expect(stopped.items).toMatchObject([{ id: handed.receipt.itemId, status: 'unknown' }])
    expect((await submit('frozen')).receipt.status).toBe('removed')
  })

  it('blocks execution after a failed edit instead of pumping unsaved memory', async () => {
    const { delivery, directory, submit, session, runtime } = await fixture()
    const accepted = await submit('original')
    const savedPath = Reflect.get(delivery, 'path') as string
    Reflect.set(delivery, 'path', join(directory, 'missing-parent', 'journal.json'))
    await expect(delivery.mutate({ type: 'mutate_delivery', itemId: accepted.receipt.itemId!, revision: accepted.delivery.revision, action: 'edit', message: 'must not run' })).rejects.toThrow('Message storage failed')
    expect(() => delivery.snapshot()).toThrow('Message storage failed')
    session.isStreaming = false
    await expect(delivery.pump()).rejects.toThrow('Message storage failed')
    await expect(delivery.resume()).rejects.toThrow('Message storage failed')
    expect(session.prompt).not.toHaveBeenCalled()
    expect(JSON.parse(await readFile(savedPath, 'utf8')).items[0].message).toBe('original')
    const recovered = new RuntimeDelivery(runtime, directory, '/project', () => undefined)
    expect(recovered.snapshot().items[0]).toMatchObject({ message: 'original', status: 'frozen' })
  })

  it('does not turn an accepted prompt into a retry after its acknowledgement write fails', async () => {
    const { delivery, directory, submit, session, runtime } = await fixture(false)
    session.prompt.mockImplementation(async (_message, options) => {
      options.preflightResult?.(true)
      Reflect.set(delivery, 'path', join(directory, 'missing-parent', 'journal.json'))
    })
    await expect(submit('accepted-but-unsaved')).rejects.toThrow('Message storage failed')
    await expect(submit('accepted-but-unsaved')).rejects.toThrow('Message storage failed')
    const recovered = new RuntimeDelivery(runtime, directory, '/project', () => undefined)
    expect((await recovered.submit({ type: 'submit_message', submissionId: 'accepted-but-unsaved', message: 'accepted-but-unsaved', mode: 'auto' })).receipt.status).toBe('unknown')
    expect(session.prompt).toHaveBeenCalledTimes(1)
  })

  it('still cancels Pi when the journal cannot be written or read', async () => {
    const { delivery, directory, submit, session, runtime } = await fixture()
    await submit('pending')
    const savedPath = Reflect.get(delivery, 'path') as string
    Reflect.set(delivery, 'path', join(directory, 'missing-parent', 'journal.json'))
    await expect(delivery.pauseAndAbort()).rejects.toThrow('Message storage failed')
    expect(session.abort).toHaveBeenCalledTimes(1)
    await writeFile(savedPath, 'invalid journal', 'utf8')
    const corrupted = new RuntimeDelivery(runtime, directory, '/project', () => undefined)
    await expect(corrupted.pauseAndAbort()).rejects.toThrow()
    expect(session.abort).toHaveBeenCalledTimes(2)
    expect(() => corrupted.snapshot()).toThrow()
  })
})
