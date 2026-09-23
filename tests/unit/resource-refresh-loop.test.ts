import { afterEach, describe, expect, it, vi } from 'vitest'
import { ResourceRefreshLoop } from '../../src/components/inspector/resource-refresh-loop'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

afterEach(() => vi.useRealTimers())

describe('visible project resource refresh', () => {
  it('does not poll hidden resources and starts with a fresh read whenever they become visible', async () => {
    vi.useFakeTimers()
    const refresh = vi.fn(async () => undefined)
    const loop = new ResourceRefreshLoop(refresh, 1_000)
    loop.invalidate()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(refresh).not.toHaveBeenCalled()
    loop.setActive(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(refresh).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(refresh).toHaveBeenCalledTimes(2)
    loop.setActive(false)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(refresh).toHaveBeenCalledTimes(2)
    loop.setActive(true)
    expect(refresh).toHaveBeenCalledTimes(3)
    loop.dispose()
  })

  it('coalesces focus and run-completion invalidations behind one slow refresh without overlap', async () => {
    vi.useFakeTimers()
    const pending = deferred()
    const refresh = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(undefined)
    const loop = new ResourceRefreshLoop(refresh, 1_000)
    loop.setActive(true)
    loop.invalidate()
    loop.invalidate()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(refresh).toHaveBeenCalledTimes(1)
    pending.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(refresh).toHaveBeenCalledTimes(2)
    loop.dispose()
  })

  it('does not schedule another read when hidden or disposed during an in-flight operation', async () => {
    vi.useFakeTimers()
    const pending = deferred()
    const refresh = vi.fn(() => pending.promise)
    const loop = new ResourceRefreshLoop(refresh, 1_000)
    loop.setActive(true)
    loop.invalidate()
    loop.setActive(false)
    pending.resolve()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(refresh).toHaveBeenCalledTimes(1)
    loop.dispose()
    loop.setActive(true)
    loop.invalidate()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(refresh).toHaveBeenCalledTimes(1)
  })
})
