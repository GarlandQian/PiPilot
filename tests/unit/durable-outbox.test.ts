import { describe, expect, it, vi } from 'vitest'
import {
  DurableComposerOutbox,
  IndexedDbOutboxPersistence,
  type DurableOutboxInput,
  type DurableOutboxItem,
  type DurableOutboxPersistence,
} from '../../src/renderer/composer/durable-outbox'

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail })
  return { promise, resolve, reject }
}

class MemoryPersistence implements DurableOutboxPersistence {
  readonly records = new Map<string, readonly DurableOutboxItem[]>()
  beforeRead?: (key: string) => Promise<void>
  beforeWrite?: (key: string) => Promise<void>
  async read(key: string) {
    await this.beforeRead?.(key)
    return structuredClone(this.records.get(key) ?? [])
  }
  async write(key: string, items: readonly DurableOutboxItem[]) {
    await this.beforeWrite?.(key)
    this.records.set(key, structuredClone(items))
  }
}

function message(id = 'first', overrides: Partial<DurableOutboxInput> = {}): DurableOutboxInput {
  return { id, text: 'Review [App.tsx](file:src/App.tsx) using $review', action: 'prompt', ...overrides }
}

describe('durable composer outbox', () => {
  it('publishes only after the durable write has committed and keeps snapshots stable', async () => {
    const persistence = new MemoryPersistence()
    const outbox = new DurableComposerOutbox(persistence, () => 42)
    const listener = vi.fn()
    outbox.subscribe('A', listener)
    const empty = outbox.snapshot('A')
    await outbox.load('A')
    expect(outbox.snapshot('A')).toBe(empty)
    expect(listener).not.toHaveBeenCalled()
    const committed = deferred()
    const started = deferred()
    persistence.beforeWrite = async () => { started.resolve(); await committed.promise }
    const add = outbox.add('A', message())
    await started.promise
    expect(outbox.snapshot('A')).toBe(empty)
    expect(listener).not.toHaveBeenCalled()
    committed.resolve()
    const item = await add
    expect(item.createdAt).toBe(42)
    expect(outbox.snapshot('A')).toEqual([item])
    expect(listener).toHaveBeenCalledOnce()
    expect(await outbox.load('A')).toBe(outbox.snapshot('A'))
  })

  it('captures complete text and images before awaits and never mutates caller-owned data', async () => {
    const persistence = new MemoryPersistence()
    const outbox = new DurableComposerOutbox(persistence)
    const images = [{ type: 'image' as const, data: 'complete-base64-image', mimeType: 'image/png' }]
    const input = message('image', { images, action: 'follow_up' })
    const add = outbox.add('A', input)
    input.text = 'later draft'
    images[0]!.data = 'changed'
    images.push({ type: 'image', data: 'next draft image', mimeType: 'image/png' })
    const item = await add
    expect(item.text).toBe(message().text)
    expect(item.images).toEqual([{ type: 'image', data: 'complete-base64-image', mimeType: 'image/png' }])
    expect(Object.isFrozen(item)).toBe(true)
    expect(Object.isFrozen(item.images[0])).toBe(true)
    expect(persistence.records.get('A')).toEqual([item])
    await expect(outbox.add('A', message('only-image', {
      text: '', images: [{ type: 'image', data: 'image', mimeType: 'image/png' }], action: 'steer',
    }))).resolves.toMatchObject({ text: '', action: 'steer' })
  })

  it('serializes concurrent sends, loads and status updates without losing any record', async () => {
    const persistence = new MemoryPersistence()
    const outbox = new DurableComposerOutbox(persistence)
    await Promise.all([
      outbox.load('A'),
      outbox.add('A', message('one')),
      outbox.add('A', message('two')),
      outbox.update('A', 'one', { status: 'sending' }),
      outbox.add('A', message('three')),
    ])
    expect(outbox.snapshot('A').map((item) => [item.id, item.status])).toEqual([
      ['one', 'sending'], ['two', 'pending'], ['three', 'pending'],
    ])
    expect(persistence.records.get('A')).toEqual(outbox.snapshot('A'))
  })

  it('keeps late conversation loads and mutations isolated from the visible conversation', async () => {
    const persistence = new MemoryPersistence()
    const readA = deferred()
    persistence.beforeRead = (key) => key === 'A' ? readA.promise : Promise.resolve()
    const outbox = new DurableComposerOutbox(persistence)
    const changedB = vi.fn()
    outbox.subscribe('B', changedB)
    const addA = outbox.add('A', message('A-message'))
    await outbox.add('B', message('B-message'))
    const snapshotB = outbox.snapshot('B')
    readA.resolve()
    await addA
    await outbox.update('A', 'A-message', { status: 'failed', error: 'refused' })
    expect(outbox.snapshot('B')).toBe(snapshotB)
    expect(changedB).toHaveBeenCalledOnce()
    expect(outbox.snapshot('A')[0]?.status).toBe('failed')
  })

  it('rejects storage failures without publishing or losing older records, and allows recovery', async () => {
    const persistence = new MemoryPersistence()
    const outbox = new DurableComposerOutbox(persistence)
    await outbox.add('A', message())
    const saved = outbox.snapshot('A')
    persistence.beforeWrite = async () => { throw new Error('QuotaExceededError') }
    await expect(outbox.add('A', message('next'))).rejects.toThrow('QuotaExceededError')
    await expect(outbox.update('A', 'first', { status: 'sending' })).rejects.toThrow('QuotaExceededError')
    await expect(outbox.remove('A', 'first')).rejects.toThrow('QuotaExceededError')
    expect(outbox.snapshot('A')).toBe(saved)
    expect(persistence.records.get('A')).toEqual(saved)
    persistence.beforeWrite = undefined
    await outbox.add('A', message('next'))
    expect(outbox.snapshot('A').map((item) => item.id)).toEqual(['first', 'next'])
  })

  it('restores interrupted sends as unknown instead of automatically retrying them', async () => {
    const persistence = new MemoryPersistence()
    const original = new DurableComposerOutbox(persistence, () => 10)
    await original.add('A', message('pending'))
    await original.add('A', message('sending'))
    await original.update('A', 'sending', { status: 'sending' })
    await original.add('A', message('failed'))
    await original.update('A', 'failed', { status: 'failed', error: 'Known rejection' })
    original.dispose()
    const restored = new DurableComposerOutbox(persistence, () => 20)
    const items = await restored.load('A')
    expect(items.map((item) => [item.id, item.status, item.updatedAt])).toEqual([
      ['pending', 'unknown', 20], ['sending', 'unknown', 20], ['failed', 'failed', 10],
    ])
    expect(items[2]?.error).toBe('Known rejection')
    expect(persistence.records.get('A')).toEqual(items)
    expect(await restored.load('A')).toBe(items)
  })

  it('does not expose a recovered record until its unknown status has been saved', async () => {
    const persistence = new MemoryPersistence()
    await new DurableComposerOutbox(persistence).add('A', message())
    const restored = new DurableComposerOutbox(persistence)
    persistence.beforeWrite = async () => { throw new Error('disk unavailable') }
    await expect(restored.load('A')).rejects.toThrow('disk unavailable')
    expect(restored.snapshot('A')).toEqual([])
    persistence.beforeWrite = undefined
    expect((await restored.load('A'))[0]?.status).toBe('unknown')
  })

  it('atomically replaces a failed retry at its existing position with a new submission identity', async () => {
    const persistence = new MemoryPersistence()
    const outbox = new DurableComposerOutbox(persistence)
    await outbox.add('A', message('first'))
    await outbox.add('A', message('second'))
    await outbox.update('A', 'first', { status: 'failed', error: 'known rejection' })
    const saved = outbox.snapshot('A')
    persistence.beforeWrite = async () => { throw new Error('full') }
    await expect(outbox.replace('A', 'first', message('retry', { text: 'edited' }))).rejects.toThrow('full')
    expect(outbox.snapshot('A')).toBe(saved)
    expect(persistence.records.get('A')).toEqual(saved)
    persistence.beforeWrite = undefined
    const retry = await outbox.replace('A', 'first', message('retry', { text: 'edited' }))
    expect(retry).toMatchObject({ id: 'retry', text: 'edited', status: 'pending' })
    expect(retry.error).toBeUndefined()
    expect(outbox.snapshot('A').map((item) => item.id)).toEqual(['retry', 'second'])
  })

  it('rejects identity reuse and never rewrites an unconfirmed or in-flight submission', async () => {
    const outbox = new DurableComposerOutbox(new MemoryPersistence())
    await outbox.add('A', message())
    await expect(outbox.add('A', message('first', { text: 'different payload' }))).rejects.toThrow('already exists')
    await expect(outbox.replace('A', 'first', message('retry'))).rejects.toThrow('Only a failed')
    await outbox.update('A', 'first', { status: 'unknown' })
    await expect(outbox.replace('A', 'first', message('retry'))).rejects.toThrow('Only a failed')
    await outbox.update('A', 'first', { status: 'failed' })
    await expect(outbox.replace('A', 'first', message())).rejects.toThrow('new identity')
  })

  it('removes only the acknowledged record, preserving later input and complete attachments', async () => {
    const persistence = new MemoryPersistence()
    const outbox = new DurableComposerOutbox(persistence)
    await outbox.add('A', message('accepted'))
    const later = await outbox.add('A', message('later', { images: [{ type: 'image', data: 'full-image', mimeType: 'image/png' }] }))
    await outbox.remove('A', 'accepted')
    expect(outbox.snapshot('A')).toEqual([later])
    const listener = vi.fn()
    const unsubscribe = outbox.subscribe('A', listener)
    unsubscribe()
    await outbox.remove('A', 'missing')
    expect(listener).not.toHaveBeenCalled()
    await outbox.remove('A', 'later')
    expect(persistence.records.get('A')).toEqual([])
  })

  it('rejects unavailable IndexedDB instead of silently using volatile or quota-limited storage', async () => {
    const outbox = new DurableComposerOutbox(new IndexedDbOutboxPersistence(() => undefined))
    await expect(outbox.add('A', message())).rejects.toThrow('storage is unavailable')
    expect(outbox.snapshot('A')).toEqual([])
  })
})

describe('IndexedDB delivery durability', () => {
  function controlledDatabase() {
    const opened = {} as IDBOpenDBRequest
    const transactionStarted = deferred()
    const writeRequest = {} as IDBRequest
    const put = vi.fn(() => writeRequest)
    const remove = vi.fn(() => writeRequest)
    const transaction = {
      objectStore: () => ({ put, delete: remove }),
      oncomplete: null,
      onabort: null,
      onerror: null,
      error: null,
    } as unknown as IDBTransaction
    const database = {
      transaction: vi.fn(() => { transactionStarted.resolve(); return transaction }),
      close: vi.fn(),
    } as unknown as IDBDatabase
    Object.defineProperty(opened, 'result', { value: database })
    const factory = { open: () => {
      queueMicrotask(() => opened.onsuccess?.call(opened, new Event('success')))
      return opened
    } } as unknown as IDBFactory
    const persistence = new IndexedDbOutboxPersistence(() => factory)
    return { persistence, database, transaction, transactionStarted, writeRequest, put, remove }
  }

  it('does not acknowledge request success before a strict transaction commits', async () => {
    const controlled = controlledDatabase()
    const item = await new DurableComposerOutbox(new MemoryPersistence()).add('A', message())
    const saved = vi.fn()
    const write = controlled.persistence.write('A', [item]).then(saved)
    await controlled.transactionStarted.promise
    expect(controlled.database.transaction).toHaveBeenCalledWith('conversations', 'readwrite', { durability: 'strict' })
    expect(controlled.put).toHaveBeenCalledWith({ key: 'A', items: [item] })
    controlled.writeRequest.onsuccess?.call(controlled.writeRequest, new Event('success'))
    await Promise.resolve()
    expect(saved).not.toHaveBeenCalled()
    controlled.transaction.oncomplete?.call(controlled.transaction, new Event('complete'))
    await write
    expect(saved).toHaveBeenCalledOnce()
  })

  it('rejects an aborted write even after the request succeeded', async () => {
    const controlled = controlledDatabase()
    const write = controlled.persistence.write('A', [])
    const rejected = expect(write).rejects.toThrow('Could not save this message')
    await controlled.transactionStarted.promise
    expect(controlled.remove).toHaveBeenCalledWith('A')
    controlled.writeRequest.onsuccess?.call(controlled.writeRequest, new Event('success'))
    controlled.transaction.onabort?.call(controlled.transaction, new Event('abort'))
    await rejected
  })
})
