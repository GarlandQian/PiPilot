import { describe, expect, it, vi } from 'vitest'
import { OfficialPiSessionCatalogObserver } from '../../src/main/conversations/official-pi-session-catalog-observer'
import type { PiRuntimeControlHandle, PiRuntimeFrontend } from '../../src/main/pi-host/pi-runtime-frontend'
import type { LocalPiSessionState } from '../../src/shared/local-pi'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

function handle(runtimeId: string): PiRuntimeControlHandle {
  return { hostEpoch: 1, runtimeId, generation: 1, scope: { kind: 'projectless' },
    sessionId: 'same-session-id', sessionFile: `/sessions/${runtimeId}.jsonl` }
}

function fixture(read: (target: PiRuntimeControlHandle) => Promise<LocalPiSessionState>) {
  let listener!: Parameters<PiRuntimeFrontend['subscribeAllEvents']>[0]
  const detach = vi.fn(() => true)
  const runtime = {
    subscribeAllEvents: (callback: typeof listener) => { listener = callback; return detach },
    getControlRuntimeState: vi.fn(read),
  }
  const catalog = { invalidate: vi.fn() }
  const observe = vi.fn(async () => ({ status: 'observed' as const }))
  const observer = new OfficialPiSessionCatalogObserver(runtime, catalog, { observe } as never)
  const changed = vi.fn()
  observer.subscribe(changed)
  return { observer, runtime, catalog, observe, changed, detach,
    emit: (target: PiRuntimeControlHandle) => listener({ type: 'agent_settled' }, target) }
}

describe('OfficialPiSessionCatalogObserver', () => {
  it('invalidates exact background scopes synchronously and bounds/coalesces asynchronous observations', async () => {
    const gate = deferred()
    let active = 0
    let maximum = 0
    const test = fixture(async (target) => {
      active += 1
      maximum = Math.max(active, maximum)
      await gate.promise
      active -= 1
      return { sessionFile: target.sessionFile } as LocalPiSessionState
    })
    try {
      for (let index = 0; index < 8; index += 1) test.emit(handle(`rt_${index}`))
      expect(test.catalog.invalidate).toHaveBeenCalledTimes(8)
      expect(test.runtime.getControlRuntimeState).not.toHaveBeenCalled()
      await vi.waitFor(() => expect(test.runtime.getControlRuntimeState).toHaveBeenCalledTimes(4))
      expect(test.changed).toHaveBeenCalledOnce()
      gate.resolve()
      await vi.waitFor(() => expect(test.observe).toHaveBeenCalledTimes(8))
      expect(maximum).toBe(4)
      expect(test.changed.mock.calls[0]![0]).toEqual({ scope: { kind: 'projectless' }, revision: 1 })
    } finally { test.observer.dispose(); gate.resolve() }
  })

  it('keeps prior observations when the exact Runtime read becomes stale', async () => {
    const test = fixture(async () => { throw new Error('Runtime generation was replaced.') })
    try {
      test.emit(handle('rt_stale'))
      await vi.waitFor(() => expect(test.runtime.getControlRuntimeState).toHaveBeenCalledOnce())
      expect(test.observe).not.toHaveBeenCalled()
      expect(test.catalog.invalidate).toHaveBeenCalledOnce()
    } finally { test.observer.dispose() }
  })

  it('drops delayed state completions and notifications after disposal', async () => {
    const gate = deferred()
    const test = fixture(async () => {
      await gate.promise
      return { sessionFile: '/sessions/late.jsonl' } as LocalPiSessionState
    })
    test.emit(handle('rt_late'))
    await vi.waitFor(() => expect(test.runtime.getControlRuntimeState).toHaveBeenCalledOnce())
    test.observer.dispose()
    const eventsBefore = test.changed.mock.calls.length
    gate.resolve()
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(test.observe).not.toHaveBeenCalled()
    expect(test.changed).toHaveBeenCalledTimes(eventsBefore)
    expect(test.detach).toHaveBeenCalledOnce()
  })
})
