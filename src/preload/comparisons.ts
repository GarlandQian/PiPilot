import { ipcRenderer, type IpcRendererEvent } from 'electron'
import type { IpcContract, RequestContext } from '../shared/ipc/contracts'
import { comparisonApplyContract, comparisonChannels, comparisonDiffContract, comparisonListContract, comparisonRemoveContract, comparisonStartContract } from '../shared/ipc/comparison-contracts'
import { comparisonsChangedEventSchema, type ComparisonsApi } from '../shared/comparisons'

export function createComparisonsApi(
  invoke: <TRequest extends { context: RequestContext }, TResponse>(contract: IpcContract<TRequest, TResponse>, request: TRequest) => Promise<TResponse>,
  context: () => RequestContext,
): ComparisonsApi {
  return {
    list: () => invoke(comparisonListContract, { context: context() }),
    start: (input) => invoke(comparisonStartContract, { context: context(), input }),
    diff: (id, index) => invoke(comparisonDiffContract, { context: context(), id, index }),
    apply: (id, index) => invoke(comparisonApplyContract, { context: context(), id, index }),
    remove: async (id) => { await invoke(comparisonRemoveContract, { context: context(), id }) },
    subscribe(listener) {
      const handler = (_event: IpcRendererEvent, raw: unknown) => {
        const parsed = comparisonsChangedEventSchema.safeParse(raw)
        if (parsed.success) { try { listener(parsed.data.comparisons) } catch { /* isolate renderer observers */ } }
      }
      ipcRenderer.on(comparisonChannels.changed, handler)
      return () => { ipcRenderer.removeListener(comparisonChannels.changed, handler) }
    },
  }
}
