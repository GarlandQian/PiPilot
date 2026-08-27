import { describe, expect, it, vi } from 'vitest'
import type { ExternalControlSettingsSnapshot } from '../../src/shared/external-control'

const mocks = vi.hoisted(() => {
  const disposers: Array<ReturnType<typeof vi.fn>> = []
  return {
    disposers,
    registerValidatedHandler: vi.fn(() => {
    const dispose = vi.fn(() => true)
    disposers.push(dispose)
    return dispose
  }),
  }
})

vi.mock('../../src/main/ipc/validated-handler', () => ({
  createTrustedSenderValidator: vi.fn(() => () => true),
  MainProcessError: class MainProcessError extends Error {},
  registerValidatedHandler: mocks.registerValidatedHandler,
}))

import { registerExternalControlIpc } from '../../src/main/ipc/register-external-control-ipc'

const snapshot: ExternalControlSettingsSnapshot = {
  revision: 1,
  enabled: false,
  state: 'disabled',
  connectedClients: 0,
  recentOperations: [],
}

describe('External Control IPC controller', () => {
  it('unsubscribes events and removes all invoke handlers exactly once', () => {
    mocks.disposers.length = 0
    mocks.registerValidatedHandler.mockClear()
    const unsubscribe = vi.fn(() => true)
    const service = {
      getSnapshot: vi.fn(() => snapshot),
      setEnabled: vi.fn(async () => snapshot),
      subscribe: vi.fn(() => unsubscribe),
    }
    const controller = registerExternalControlIpc({
      getMainWindow: () => null,
      launcherService: {
        inspect: vi.fn(() => ({
          state: 'missing', managed: false, requiresClientRestart: false,
        })),
        install: vi.fn(() => ({
          state: 'installed', managed: true, requiresClientRestart: false,
        })),
        uninstall: vi.fn(() => ({
          state: 'missing', managed: false, requiresClientRestart: false,
        })),
      } as never,
      policy: {} as never,
      service: service as never,
    })

    expect(mocks.registerValidatedHandler).toHaveBeenCalledTimes(5)
    expect(controller.dispose()).toBe(true)
    expect(controller.dispose()).toBe(false)
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(mocks.disposers).toHaveLength(5)
    for (const dispose of mocks.disposers) expect(dispose).toHaveBeenCalledOnce()
  })
})
