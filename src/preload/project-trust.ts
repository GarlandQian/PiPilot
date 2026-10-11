import { ipcRenderer, type IpcRendererEvent } from 'electron'
import type { IpcContract, RequestContext } from '../shared/ipc/contracts'
import { projectTrustChannels, projectTrustDecideContract, projectTrustGetContract, projectTrustGetPolicyContract, projectTrustSetPolicyContract } from '../shared/ipc/project-trust-contracts'
import { projectTrustChangedEventSchema, type ProjectTrustApi } from '../shared/project-trust'

export function createProjectTrustApi(
  invoke: <TRequest extends { context: RequestContext }, TResponse>(contract: IpcContract<TRequest, TResponse>, request: TRequest) => Promise<TResponse>,
  context: () => RequestContext,
): ProjectTrustApi {
  return {
    get: (workspaceId) => invoke(projectTrustGetContract, { context: context(), workspaceId }),
    decide: (workspaceId, choice) => invoke(projectTrustDecideContract, { context: context(), workspaceId, choice }),
    getPolicy: () => invoke(projectTrustGetPolicyContract, { context: context() }),
    setPolicy: (policy) => invoke(projectTrustSetPolicyContract, { context: context(), policy }),
    subscribe(listener) {
      const handler = (_event: IpcRendererEvent, raw: unknown) => {
        const parsed = projectTrustChangedEventSchema.safeParse(raw)
        if (parsed.success) { try { listener(parsed.data.workspaceId) } catch { /* isolate renderer observers */ } }
      }
      ipcRenderer.on(projectTrustChannels.changed, handler)
      return () => { ipcRenderer.removeListener(projectTrustChannels.changed, handler) }
    },
  }
}
