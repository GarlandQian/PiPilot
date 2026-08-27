import { beforeEach, describe, expect, it, vi } from 'vitest'

const ipcMain = vi.hoisted(() => ({
  handle: vi.fn(),
  removeHandler: vi.fn(),
}))

vi.mock('electron', () => ({ ipcMain }))

import { appGetInfoContract } from '../../src/shared/ipc/contracts'
import { registerValidatedHandler } from '../../src/main/ipc/validated-handler'

const response = {
  name: 'PiPilot' as const,
  version: '0.0.1',
  platform: 'darwin',
  arch: 'arm64',
  electronVersion: '43.4.1',
  mode: 'development' as const,
}

describe('registerValidatedHandler', () => {
  beforeEach(() => {
    ipcMain.handle.mockClear()
    ipcMain.removeHandler.mockClear()
  })

  it('removes the active handler once and ignores a stale disposer', () => {
    const firstDispose = registerValidatedHandler(
      appGetInfoContract,
      () => true,
      () => response,
    )
    const secondDispose = registerValidatedHandler(
      appGetInfoContract,
      () => true,
      () => response,
    )

    expect(ipcMain.handle).toHaveBeenCalledTimes(2)
    expect(firstDispose()).toBe(false)
    expect(ipcMain.removeHandler).toHaveBeenCalledTimes(2)
    expect(secondDispose()).toBe(true)
    expect(secondDispose()).toBe(false)
    expect(ipcMain.removeHandler).toHaveBeenCalledTimes(3)
    expect(ipcMain.removeHandler).toHaveBeenLastCalledWith(
      appGetInfoContract.channel,
    )
  })
})
