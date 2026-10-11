import { ipcRenderer, type IpcRendererEvent } from 'electron'
import type { IpcContract, RequestContext } from '../shared/ipc/contracts'
import { providerLoginCancelContract, providerLoginChannels, providerLoginRespondContract, providerLoginStartContract } from '../shared/ipc/provider-login-contracts'
import { providerLoginEventSchema, type ProviderLoginApi } from '../shared/provider-login'

export function createProviderLoginApi(
  invoke: <TRequest extends { context: RequestContext }, TResponse>(contract: IpcContract<TRequest, TResponse>, request: TRequest) => Promise<TResponse>,
  context: () => RequestContext,
): ProviderLoginApi {
  return {
    start: (providerId) => invoke(providerLoginStartContract, { context: context(), providerId }),
    respond: async (loginId, promptId, value) => { await invoke(providerLoginRespondContract, { context: context(), loginId, promptId, value }) },
    cancel: async (loginId) => { await invoke(providerLoginCancelContract, { context: context(), loginId }) },
    subscribe(listener) {
      const handler = (_event: IpcRendererEvent, raw: unknown) => {
        const parsed = providerLoginEventSchema.safeParse(raw)
        if (parsed.success) { try { listener(parsed.data) } catch { /* isolate renderer observers */ } }
      }
      ipcRenderer.on(providerLoginChannels.event, handler)
      return () => { ipcRenderer.removeListener(providerLoginChannels.event, handler) }
    },
  }
}
