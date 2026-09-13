import { describe, expect, it, vi } from 'vitest'
import {
  createProvenanceRefreshQueue,
  type ProvenanceRefreshOutcome,
} from '../../src/renderer/pi-rpc/provenance-refresh-queue'

type ApplyPage = () => ProvenanceRefreshOutcome

function deferredPage() {
  let resolve!: (apply: ApplyPage) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<ApplyPage>((accept, fail) => { resolve = accept; reject = fail })
  return { promise, resolve, reject }
}

describe('supplemental response provenance refresh', () => {
  it('serializes concurrent user events and reads the trailing page from the newly applied cursor', async () => {
    const first = deferredPage()
    const trailing = deferredPage()
    let cursor = 'before-users'
    const readCursors: string[] = []
    const prepare = vi.fn(() => {
      readCursors.push(cursor)
      return readCursors.length === 1 ? first.promise : trailing.promise
    })
    const queue = createProvenanceRefreshQueue({ ownerRevision: () => 1, prepare })
    const drained = queue.request()
    void queue.request()
    void queue.request()
    expect(prepare).toHaveBeenCalledOnce()

    first.resolve(() => { cursor = 'first-user'; return 'applied' })
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(2))
    expect(readCursors).toEqual(['before-users', 'first-user'])
    trailing.resolve(() => { cursor = 'latest-user'; return 'applied' })
    await drained

    expect(cursor).toBe('latest-user')
    expect(prepare).toHaveBeenCalledTimes(2)
  })

  it('re-reads once after a concurrent snapshot wins, without applying the rejected page', async () => {
    const older = deferredPage()
    const accepted = vi.fn<ApplyPage>(() => 'applied')
    const prepare = vi.fn()
      .mockReturnValueOnce(older.promise)
      .mockResolvedValueOnce(accepted)
    const queue = createProvenanceRefreshQueue({ ownerRevision: () => 1, prepare })
    const drained = queue.request()
    const rejected = vi.fn<ApplyPage>(() => 'conflict')
    older.resolve(rejected)
    await drained

    expect(rejected).toHaveBeenCalledOnce()
    expect(prepare).toHaveBeenCalledTimes(2)
    expect(accepted).toHaveBeenCalledOnce()
  })

  it('bounds conflict compensation to one additional read per burst', async () => {
    const prepare = vi.fn(async (): Promise<ApplyPage> => () => 'conflict')
    const queue = createProvenanceRefreshQueue({ ownerRevision: () => 1, prepare })
    await queue.request()
    expect(prepare).toHaveBeenCalledTimes(2)

    // A later real user message may initiate a new bounded attempt.
    await queue.request()
    expect(prepare).toHaveBeenCalledTimes(4)
  })

  it('rejects an A→B→A result even when generation, session, and null snapshot return to the same values', async () => {
    const beforeSwitch = deferredPage()
    let owner = 10
    const obsoleteApply = vi.fn<ApplyPage>(() => 'applied')
    const latestApply = vi.fn<ApplyPage>(() => 'applied')
    const prepare = vi.fn()
      .mockReturnValueOnce(beforeSwitch.promise)
      .mockResolvedValueOnce(latestApply)
    const queue = createProvenanceRefreshQueue({ ownerRevision: () => owner, prepare })
    const drained = queue.request()
    owner += 1 // A → B
    owner += 1 // B → A, with the same externally visible session identity
    void queue.request()
    beforeSwitch.resolve(obsoleteApply)
    await drained

    expect(obsoleteApply).not.toHaveBeenCalled()
    expect(latestApply).toHaveBeenCalledOnce()
    expect(prepare).toHaveBeenCalledTimes(2)
  })

  it('does not retry failed reads, leaving later normal refresh or a new event to recover', async () => {
    const failed = deferredPage()
    const laterApply = vi.fn<ApplyPage>(() => 'applied')
    const prepare = vi.fn()
      .mockReturnValueOnce(failed.promise)
      .mockResolvedValueOnce(laterApply)
    const queue = createProvenanceRefreshQueue({ ownerRevision: () => 1, prepare })
    const drained = queue.request()
    void queue.request()
    failed.reject(new Error('Supplemental lookup failed.'))
    await drained
    expect(prepare).toHaveBeenCalledOnce()
    expect(laterApply).not.toHaveBeenCalled()

    await queue.request()
    expect(prepare).toHaveBeenCalledTimes(2)
    expect(laterApply).toHaveBeenCalledOnce()
  })

  it('drops a disposed lookup without applying it or running queued work', async () => {
    const pending = deferredPage()
    const apply = vi.fn<ApplyPage>(() => 'applied')
    const prepare = vi.fn(() => pending.promise)
    const queue = createProvenanceRefreshQueue({ ownerRevision: () => 1, prepare })
    const drained = queue.request()
    void queue.request()
    queue.dispose()
    pending.resolve(apply)
    await drained
    await queue.request()

    expect(apply).not.toHaveBeenCalled()
    expect(prepare).toHaveBeenCalledOnce()
  })
})
