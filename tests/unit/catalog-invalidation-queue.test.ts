import { describe, expect, it, vi } from 'vitest'
import { CatalogInvalidationQueue } from '../../src/renderer/catalog-invalidation-queue'

const scopeA = { kind: 'projectless' } as const
const scopeB = { kind: 'project', workspaceId: '00000000-0000-4000-8000-000000000701' } as const

function deferred() {
  let resolve!: () => void
  let reject!: (error: unknown) => void
  const promise = new Promise<void>((accept, fail) => { resolve = accept; reject = fail })
  return { promise, resolve, reject }
}

describe('CatalogInvalidationQueue', () => {
  it('supersedes a stale paginated request immediately and coalesces a trailing reload', async () => {
    const oldLoad = deferred()
    const nextLoad = deferred()
    const inFlight = vi.fn(() => oldLoad.promise)
    const reload = vi.fn(() => nextLoad.promise)
    const invalidate = vi.fn()
    const onError = vi.fn()
    const queue = new CatalogInvalidationQueue({ eligible: () => true, invalidate, inFlight, reload, onError })
    queue.notify({ scope: scopeA, revision: 1 })
    expect(invalidate).toHaveBeenCalledWith(scopeA)
    await vi.waitFor(() => expect(inFlight).toHaveBeenCalledOnce())
    queue.notify({ scope: scopeA, revision: 2 })
    queue.notify({ scope: scopeA, revision: 2 })
    queue.notify({ scope: scopeA, revision: 1 })
    oldLoad.reject(new Error('The second-page cursor became stale.'))
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce())
    expect(invalidate).toHaveBeenCalledTimes(2)
    expect(onError).not.toHaveBeenCalled()
    queue.notify({ scope: scopeA, revision: 3 })
    queue.notify({ scope: scopeA, revision: 4 })
    nextLoad.resolve()
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(2))
    queue.dispose()
  })

  it('refreshes independent loaded scopes without waiting for another scope', async () => {
    const waiting = deferred()
    const reload = vi.fn(async (scope) => { if (scope.kind === 'projectless') await waiting.promise })
    const queue = new CatalogInvalidationQueue({ eligible: () => true, invalidate: vi.fn(),
      inFlight: () => undefined, reload, onError: vi.fn() })
    queue.notify({ scope: scopeA, revision: 1 })
    queue.notify({ scope: scopeB, revision: 2 })
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(2))
    waiting.resolve()
    queue.dispose()
  })

  it('does not load unseen or removed scopes and drops disposed work', async () => {
    let loaded = false
    const waiting = deferred()
    const reload = vi.fn(async () => undefined)
    const invalidate = vi.fn()
    const inFlight = vi.fn(() => waiting.promise)
    const queue = new CatalogInvalidationQueue({ eligible: () => loaded, invalidate, inFlight, reload, onError: vi.fn() })
    queue.notify({ scope: scopeA, revision: 1 })
    expect(invalidate).not.toHaveBeenCalled()
    loaded = true
    queue.notify({ scope: scopeA, revision: 2 })
    await vi.waitFor(() => expect(inFlight).toHaveBeenCalledOnce())
    loaded = false
    waiting.resolve()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(reload).not.toHaveBeenCalled()
    loaded = true
    queue.notify({ scope: scopeA, revision: 3 })
    queue.dispose()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(reload).not.toHaveBeenCalled()
  })
})
