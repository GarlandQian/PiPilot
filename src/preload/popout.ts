import { ipcRenderer, type IpcRendererEvent } from 'electron'
import type { IpcContract, RequestContext } from '../shared/ipc/contracts'
import { popoutAbortContract, popoutChannels, popoutGetContract, popoutOpenContract, popoutPinContract, popoutSendContract, popoutShowMainContract } from '../shared/ipc/popout-contracts'
import { popoutChangedEventSchema, type PopoutApi } from '../shared/popout'

export function createPopoutApi(
  invoke: <TRequest extends { context: RequestContext }, TResponse>(contract: IpcContract<TRequest, TResponse>, request: TRequest) => Promise<TResponse>,
  context: () => RequestContext,
): PopoutApi {
  return {
    open: (target) => invoke(popoutOpenContract, { context: context(), target }),
    get: (popoutId) => invoke(popoutGetContract, { context: context(), popoutId }),
    send: (popoutId, text, requestId) => invoke(popoutSendContract, { context: context(), popoutId, text, requestId }),
    abort: (popoutId) => invoke(popoutAbortContract, { context: context(), popoutId }),
    setPinned: (popoutId, pinned) => invoke(popoutPinContract, { context: context(), popoutId, pinned }),
    showMainWindow: async (popoutId) => { await invoke(popoutShowMainContract, { context: context(), popoutId }) },
    subscribe(listener) {
      const handler = (_event: IpcRendererEvent, raw: unknown) => {
        const parsed = popoutChangedEventSchema.safeParse(raw)
        if (parsed.success) { try { listener(parsed.data.snapshot) } catch { /* isolate renderer observers */ } }
      }
      ipcRenderer.on(popoutChannels.changed, handler)
      return () => { ipcRenderer.removeListener(popoutChannels.changed, handler) }
    },
  }
}
