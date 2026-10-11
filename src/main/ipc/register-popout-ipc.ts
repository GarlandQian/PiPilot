import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { popoutAbortContract, popoutGetContract, popoutOpenContract, popoutPinContract, popoutSendContract, popoutShowMainContract } from '../../shared/ipc/popout-contracts'
import { PopoutConversationError, type PopoutConversationService } from '../conversations/popout-conversation-service'
import type { PopoutWindows } from '../windows/popout-windows'
import type { ApplicationUrlPolicy } from '../security/url-policy'
import { createTrustedSenderValidator, MainProcessError, registerValidatedHandler } from './validated-handler'

export function registerPopoutIpc({ getMainWindow, policy, service, windows, showMainWindow }: {
  getMainWindow(): BrowserWindow | null
  policy: ApplicationUrlPolicy
  service: PopoutConversationService
  windows: PopoutWindows
  showMainWindow(): void
}) {
  const fromMain = createTrustedSenderValidator(policy, getMainWindow)
  // A pop-out may only act on its own conversation.
  const fromPopout = (event: IpcMainInvokeEvent) => {
    const frame = event.senderFrame
    return windows.idFor(event.sender) !== undefined && frame !== null && frame === event.sender.mainFrame && policy.isTrustedRendererUrl(frame.url)
  }
  const own = (event: IpcMainInvokeEvent, popoutId: string) => {
    if (windows.idFor(event.sender) !== popoutId) throw new MainProcessError('POPOUT_FORBIDDEN', 'This window cannot use another conversation window.', false)
  }
  const map = async <T>(action: () => T | Promise<T>) => {
    try { return await action() }
    catch (error) {
      if (error instanceof PopoutConversationError) throw new MainProcessError(error.code, error.message, true)
      if (error instanceof MainProcessError) throw error
      throw new MainProcessError('POPOUT_FAILED', (error instanceof Error ? error.message : 'The conversation window failed.').slice(0, 1_000), true)
    }
  }
  const detach = service.subscribe((snapshot) => windows.update(snapshot))
  const unregister = [
    registerValidatedHandler(popoutOpenContract, fromMain, ({ target }) => map(async () => {
      const { popoutId } = await service.open(target)
      await windows.show(popoutId)
      return { popoutId }
    })),
    registerValidatedHandler(popoutGetContract, fromPopout, ({ popoutId }, event) => map(() => { own(event, popoutId); return service.get(popoutId) })),
    registerValidatedHandler(popoutSendContract, fromPopout, ({ popoutId, text, requestId }, event) => map(() => { own(event, popoutId); return service.send(popoutId, text, requestId) })),
    registerValidatedHandler(popoutAbortContract, fromPopout, ({ popoutId }, event) => map(() => { own(event, popoutId); return service.abort(popoutId) })),
    registerValidatedHandler(popoutPinContract, fromPopout, ({ popoutId, pinned }, event) => map(() => { own(event, popoutId); return service.setPinned(popoutId, pinned) })),
    registerValidatedHandler(popoutShowMainContract, fromPopout, ({ popoutId }, event) => map(() => { own(event, popoutId); showMainWindow(); return { ok: true as const } })),
  ]
  return { dispose() { detach(); unregister.forEach((stop) => stop()) } }
}
