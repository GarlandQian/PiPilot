import { describe, expect, it, vi } from 'vitest'
import { createPiIntegrationBootstrapRefresh } from '../../src/store/pi-integrations'
import type { PiIntegrationOperation } from '../../src/shared/pi-integrations'

function operation(
  phase: PiIntegrationOperation['phase'],
  kind: PiIntegrationOperation['kind'] = 'bootstrap-defaults',
): PiIntegrationOperation {
  return { operationId: 'bootstrap-1', kind, phase, scope: { kind: 'global' }, startedAt: 1 }
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

describe('background Pi default installation snapshot refresh', () => {
  it.each(['succeeded', 'failed'] as const)('reloads once after %s without loops from duplicate/progress events', async (phase) => {
    const refresh = vi.fn(async () => undefined)
    const background = createPiIntegrationBootstrapRefresh(refresh)
    background.observe(operation('running'))
    background.observe(operation('progress'))
    expect(refresh).not.toHaveBeenCalled()
    background.observe(operation(phase))
    background.observe(operation(phase))
    background.observe(operation('succeeded', 'install'))
    await Promise.resolve()
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('waits for the initial read to finish before requesting the post-install snapshot', async () => {
    const refresh = vi.fn(async () => undefined)
    const background = createPiIntegrationBootstrapRefresh(refresh)
    const initialReadFinished = background.beginRequest()
    background.observe(operation('succeeded'))
    expect(refresh).not.toHaveBeenCalled()
    initialReadFinished()
    await Promise.resolve()
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('preserves foreground request epochs and reads the current scope after queued mutations settle', async () => {
    let epoch = 1
    let scope = 'global'
    const reads: string[] = []
    const background = createPiIntegrationBootstrapRefresh(async () => {
      epoch += 1
      reads.push(scope)
    })
    const installFinished = background.beginRequest()
    const removeFinished = background.beginRequest()
    background.observe(operation('succeeded'))
    scope = 'project:next'
    installFinished()
    expect(epoch).toBe(1)
    expect(reads).toEqual([])
    removeFinished()
    removeFinished()
    await Promise.resolve()
    expect(epoch).toBe(2)
    expect(reads).toEqual(['project:next'])
  })

  it('does not turn a failed background read into an automatic retry loop', async () => {
    const refresh = vi.fn(async () => { throw new Error('Helper unavailable') })
    const background = createPiIntegrationBootstrapRefresh(refresh)
    background.observe(operation('failed'))
    await Promise.resolve()
    background.observe(operation('failed'))
    await Promise.resolve()
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('drops deferred work when the subscription is removed', async () => {
    const refresh = vi.fn(async () => undefined)
    const background = createPiIntegrationBootstrapRefresh(refresh)
    const requestFinished = background.beginRequest()
    background.observe(operation('succeeded'))
    background.dispose()
    requestFinished()
    await Promise.resolve()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('does not refresh again after unmount even if another terminal event arrived during a read', async () => {
    const read = deferred()
    const refresh = vi.fn(() => read.promise)
    const background = createPiIntegrationBootstrapRefresh(refresh)
    background.observe(operation('succeeded'))
    background.observe({ ...operation('succeeded'), operationId: 'bootstrap-2' })
    background.dispose()
    read.resolve()
    await read.promise
    expect(refresh).toHaveBeenCalledOnce()
  })
})
