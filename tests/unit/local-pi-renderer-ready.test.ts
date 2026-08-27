import { describe, expect, it, vi } from 'vitest'
import { LocalPiRendererReadyGate } from '../../src/main/ipc/projection/pi-renderer-ready-gate'

describe('LocalPiRendererReadyGate', () => {
  it('waits for renderer readiness and initializes only once', async () => {
    let releaseInitialization: (() => void) | undefined
    const initialize = vi.fn(() => new Promise<void>((resolve) => {
      releaseInitialization = resolve
    }))
    const gate = new LocalPiRendererReadyGate(initialize)

    expect(initialize).not.toHaveBeenCalled()
    const first = gate.signal()
    const second = gate.signal()
    expect(second).toBe(first)
    await vi.waitFor(() => expect(initialize).toHaveBeenCalledTimes(1))

    releaseInitialization?.()
    await expect(first).resolves.toBeUndefined()
    await expect(gate.signal()).resolves.toBeUndefined()
    expect(initialize).toHaveBeenCalledTimes(1)
  })

  it('does not retry a failed initialization on renderer remount', async () => {
    const initialize = vi.fn(async () => {
      throw new Error('startup failed')
    })
    const gate = new LocalPiRendererReadyGate(initialize)

    await expect(gate.signal()).rejects.toThrow('startup failed')
    await expect(gate.signal()).rejects.toThrow('startup failed')
    expect(initialize).toHaveBeenCalledTimes(1)
  })
})
