import { describe, expect, it, vi } from 'vitest'
import type { LocalPiRpcEvent } from '../../src/shared/local-pi'

const mocks = vi.hoisted(() => ({
  registerValidatedHandler: vi.fn(() => vi.fn(() => true)),
}))

vi.mock('../../src/main/ipc/validated-handler', () => ({
  createTrustedSenderValidator: vi.fn(() => () => true),
  MainProcessError: class MainProcessError extends Error {},
  registerValidatedHandler: mocks.registerValidatedHandler,
}))

import { registerLocalPiIpc } from '../../src/main/ipc/register-local-pi-ipc'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

async function flush() {
  await new Promise<void>((resolve) => setImmediate(resolve))
}

describe('Local Pi IPC controller', () => {
  it('does not hold event forwarding on settled-session catalog refresh', async () => {
    let eventListener: (
      event: LocalPiRpcEvent,
      generation: number,
      runtimeId?: string,
    ) => void | Promise<void>

    const send = vi.fn()
    const eventUnsubscribe = vi.fn(() => true)
    const settled = deferred()
    const activationService = {
      onAgentSettled: vi.fn(() => settled.promise),
      onSessionCatalogChanged: vi.fn(),
    }
    const runtimeHost = {
      getSnapshot: vi.fn(() => ({ state: 'stopped' })),
      subscribe: vi.fn(() => vi.fn(() => true)),
      subscribeEvents: vi.fn((listener: typeof eventListener) => {
        eventListener = listener
        return eventUnsubscribe
      }),
      subscribeUiRequests: vi.fn(() => vi.fn(() => true)),
      getActiveRuntimeIdentity: vi.fn(() => null),
      request: vi.fn(),
      respondToExtensionUi: vi.fn(),
      restart: vi.fn(),
    }

    const controller = registerLocalPiIpc({
      activationService: activationService as never,
      contextService: { start: vi.fn() } as never,
      getMainWindow: () => ({
        isDestroyed: () => false,
        webContents: { send },
      }) as never,
      policy: {} as never,
      runtimeHost: runtimeHost as never,
    })

    eventListener!({ type: 'agent_settled' }, 1, 'runtime-a')
    await flush()

    expect(activationService.onAgentSettled).toHaveBeenCalledWith('runtime-a', 1)
    expect(send).toHaveBeenCalledTimes(1)

    eventListener!({ type: 'agent_start' }, 1, 'runtime-a')
    await flush()

    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls.map(([, message]) => message.event.type)).toEqual([
      'agent_settled',
      'agent_start',
    ])

    settled.resolve()
    await settled.promise
    controller.dispose()
    expect(eventUnsubscribe).toHaveBeenCalledOnce()
  })
})
