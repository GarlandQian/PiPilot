import { describe, expect, it, vi } from 'vitest'
import type { PiPilotApi } from '../../src/shared/pipilot-api'
import type { TaskNotification, TaskNotificationSnapshot } from '../../src/shared/task-notifications'
import { createTaskNotificationsStore } from '../../src/store/task-notifications'

const notification: TaskNotification = {
  id: '70a0aa7d-9ecb-4c61-979e-2764c2d6f0a1',
  kind: 'completed', scope: { kind: 'projectless' }, sessionId: 'task-1',
  createdAt: 1_000, read: false, resolved: false,
}
const snapshot = (revision: number, items: TaskNotification[] = [notification]): TaskNotificationSnapshot => ({
  revision, items, requestedId: null, desktopSupported: true,
})
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function bridge(get: () => Promise<TaskNotificationSnapshot> = async () => snapshot(1)) {
  let listener: ((value: TaskNotificationSnapshot) => void) | null = null
  const unsubscribe = vi.fn(() => { listener = null })
  const api: PiPilotApi['notifications'] = {
    get: vi.fn(get),
    setPresentation: vi.fn(async () => snapshot(1)),
    markRead: vi.fn(async () => snapshot(2, [{ ...notification, read: true }])),
    clear: vi.fn(async () => snapshot(3, [])),
    resolveTarget: vi.fn(async () => { throw new Error('Target removed') }),
    subscribe: vi.fn((next) => { listener = next; return unsubscribe }),
  }
  return { api, emit: (value: TaskNotificationSnapshot) => listener?.(value), unsubscribe }
}

describe('task notification renderer store', () => {
  it('keeps a newer event when the initial read and duplicate revisions arrive later', async () => {
    const initial = deferred<TaskNotificationSnapshot>()
    const backend = bridge(() => initial.promise)
    const store = createTaskNotificationsStore(backend.api)
    const stop = store.start()
    backend.emit(snapshot(3, [{ ...notification, read: true }]))
    initial.resolve(snapshot(1))
    await initial.promise
    backend.emit(snapshot(3))
    expect(store.get().snapshot).toEqual(snapshot(3, [{ ...notification, read: true }]))
    expect(store.get().loading).toBe(false)
    stop()
  })

  it('does not resurrect cleared notifications from out-of-order action responses', async () => {
    const backend = bridge()
    const read = deferred<TaskNotificationSnapshot>()
    const clear = deferred<TaskNotificationSnapshot>()
    backend.api.markRead = vi.fn(() => read.promise)
    backend.api.clear = vi.fn(() => clear.promise)
    const store = createTaskNotificationsStore(backend.api)
    const stop = store.start()
    await store.reload()
    const marking = store.markRead()
    const clearing = store.clear()
    backend.emit(snapshot(5, []))
    clear.resolve(snapshot(4, []))
    read.resolve(snapshot(2, [{ ...notification, read: true }]))
    expect(await clearing).toBe(true)
    expect(await marking).toBe(true)
    expect(store.get().snapshot).toEqual(snapshot(5, []))
    stop()
  })

  it('preserves confirmed history on failure and exposes a recoverable localized error', async () => {
    const backend = bridge()
    backend.api.clear = vi.fn().mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValueOnce(snapshot(2, []))
    const store = createTaskNotificationsStore(backend.api)
    const stop = store.start()
    await store.reload()
    expect(await store.clear()).toBe(false)
    expect(store.get().snapshot.items).toEqual([notification])
    expect(store.get().errorKey).toBe('notifications.clearFailed')
    expect(await store.clear()).toBe(true)
    expect(store.get().snapshot.items).toEqual([])
    expect(store.get().errorKey).toBeNull()
    stop()
  })

  it('settles loading when an initial read fails after a concurrent presentation action', async () => {
    const initial = deferred<TaskNotificationSnapshot>()
    const backend = bridge(() => initial.promise)
    backend.api.setPresentation = vi.fn().mockRejectedValue(new Error('Unavailable'))
    const store = createTaskNotificationsStore(backend.api)
    const stop = store.start()
    await store.setPresentation({ scope: null, sessionId: null })
    initial.reject(new Error('Unavailable'))
    await initial.promise.catch(() => undefined)
    expect(store.get().loading).toBe(false)
    expect(store.get().errorKey).toBe('notifications.updateFailed')
    stop()
  })

  it('ignores pending work after unmount and unsubscribes from events', async () => {
    const initial = deferred<TaskNotificationSnapshot>()
    const backend = bridge(() => initial.promise)
    const store = createTaskNotificationsStore(backend.api)
    const changed = vi.fn()
    store.subscribe(changed)
    const stop = store.start()
    stop()
    changed.mockClear()
    initial.resolve(snapshot(9))
    await initial.promise
    backend.emit(snapshot(10))
    expect(changed).not.toHaveBeenCalled()
    expect(backend.unsubscribe).toHaveBeenCalledOnce()
  })

  it('leaves unread history intact when a task target cannot be resolved', async () => {
    const backend = bridge()
    const store = createTaskNotificationsStore(backend.api)
    const stop = store.start()
    await store.reload()
    await expect(store.resolveTarget(notification.id)).rejects.toThrow('Target removed')
    expect(store.get().snapshot.items[0].read).toBe(false)
    expect(backend.api.markRead).not.toHaveBeenCalled()
    expect(backend.api.clear).not.toHaveBeenCalled()
    stop()
  })

  it('stays safely empty without a desktop bridge', async () => {
    const store = createTaskNotificationsStore(undefined)
    const stop = store.start()
    expect(store.get()).toEqual({
      snapshot: { revision: 0, items: [], requestedId: null, desktopSupported: false },
      loading: false, errorKey: null,
    })
    expect(await store.reload()).toBe(false)
    expect(await store.markRead()).toBe(false)
    expect(await store.clear()).toBe(false)
    expect(await store.setPresentation({ scope: null, sessionId: null })).toBe(false)
    await expect(store.resolveTarget(notification.id)).rejects.toThrow('unavailable')
    stop()
  })
})
