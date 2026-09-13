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
import { OfficialPiSessionCatalogObserver } from '../../src/main/conversations/official-pi-session-catalog-observer'

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
    const invalidate = vi.fn()
    const getControlRuntimeState = vi.fn(async () => {
      await settled.promise
      return { sessionFile: '/sessions/a.jsonl' }
    })
    let allListener!: Parameters<import('../../src/main/pi-host/pi-runtime-frontend').PiRuntimeFrontend['subscribeAllEvents']>[0]
    const runtimeHost = {
      getSnapshot: vi.fn(() => ({ state: 'stopped', generation: 0, cwd: null,
        sessionFile: null, sessionState: null, commands: [], stderr: '', diagnostics: [] })),
      subscribe: vi.fn(() => vi.fn(() => true)),
      subscribeAllEvents: vi.fn((listener: typeof allListener) => {
        allListener = listener
        return vi.fn(() => true)
      }),
      getControlRuntimeState,
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
    const catalogObserver = new OfficialPiSessionCatalogObserver(runtimeHost as never,
      { invalidate }, { observe: vi.fn() } as never)

    const controller = registerLocalPiIpc({
      activationService: {} as never,
      catalogObserver,
      contextService: { start: vi.fn() } as never,
      getMainWindow: () => ({
        isDestroyed: () => false,
        webContents: { send },
      }) as never,
      policy: {} as never,
      runtimeHost: runtimeHost as never,
    })

    const scope = { kind: 'projectless' } as const
    allListener({ type: 'agent_settled' }, {
      hostEpoch: 1, runtimeId: 'rt_a', generation: 1, scope,
      sessionId: 'session-a', sessionFile: '/sessions/a.jsonl',
    })
    eventListener!({ type: 'agent_settled' }, 1, 'rt_a')
    await flush()

    expect(invalidate).toHaveBeenCalledWith(scope)
    expect(getControlRuntimeState).toHaveBeenCalledOnce()
    expect(send.mock.calls.filter(([, message]) => message.event)).toHaveLength(1)

    eventListener!({ type: 'agent_start' }, 1, 'runtime-a')
    await flush()

    expect(send.mock.calls.filter(([, message]) => message.event).map(([, message]) => message.event.type)).toEqual([
      'agent_settled',
      'agent_start',
    ])
    expect(send.mock.calls.find(([, message]) => message.catalogInvalidation)?.[1]).toMatchObject({
      snapshot: runtimeHost.getSnapshot(), catalogInvalidation: { scope, revision: 1 },
    })

    settled.resolve()
    await settled.promise
    controller.dispose()
    expect(eventUnsubscribe).toHaveBeenCalledOnce()
  })
})
