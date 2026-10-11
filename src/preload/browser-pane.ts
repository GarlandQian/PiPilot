import { ipcRenderer, type IpcRendererEvent } from 'electron'
import type { IpcContract, RequestContext } from '../shared/ipc/contracts'
import { browserAnnotateContract, browserCancelAnnotationContract, browserCommandContract, browserGetContract, browserNavigateContract, browserOpenContract, browserPaneChannels, browserViewportContract } from '../shared/ipc/browser-pane-contracts'
import { browserChangedEventSchema, type BrowserPaneApi } from '../shared/browser-pane'

export function createBrowserPaneApi(
  invoke: <TRequest extends { context: RequestContext }, TResponse>(contract: IpcContract<TRequest, TResponse>, request: TRequest) => Promise<TResponse>,
  context: () => RequestContext,
): BrowserPaneApi {
  return {
    get: (scopeKey) => invoke(browserGetContract, { context: context(), scopeKey }),
    open: (scopeKey, url) => invoke(browserOpenContract, { context: context(), scopeKey, ...(url ? { url } : {}) }),
    navigate: (scopeKey, tabId, input) => invoke(browserNavigateContract, { context: context(), scopeKey, tabId, input }),
    command: (scopeKey, tabId, command) => invoke(browserCommandContract, { context: context(), scopeKey, tabId, command }),
    setViewport: (scopeKey, bounds) => invoke(browserViewportContract, { context: context(), scopeKey, bounds }),
    annotate: (scopeKey, tabId, mode) => invoke(browserAnnotateContract, { context: context(), scopeKey, tabId, mode }),
    cancelAnnotation: async (scopeKey, tabId) => { await invoke(browserCancelAnnotationContract, { context: context(), scopeKey, tabId }) },
    subscribe(listener) {
      const handler = (_event: IpcRendererEvent, raw: unknown) => {
        const parsed = browserChangedEventSchema.safeParse(raw)
        if (parsed.success) { try { listener(parsed.data.snapshot) } catch { /* isolate renderer observers */ } }
      }
      ipcRenderer.on(browserPaneChannels.changed, handler)
      return () => { ipcRenderer.removeListener(browserPaneChannels.changed, handler) }
    },
  }
}
