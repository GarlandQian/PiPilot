import type { IpcContract, RequestContext } from '../shared/ipc/contracts'
import type { SideConversationsApi } from '../shared/side-conversations'
import * as contracts from '../shared/ipc/side-conversations-contracts'
export function createSideConversationsApi(invoke: <TRequest extends { context: RequestContext }, TResponse>(contract: IpcContract<TRequest, TResponse>, request: TRequest) => Promise<TResponse>, context: () => RequestContext): SideConversationsApi {
  return {
    create: (input) => invoke(contracts.sideConversationCreateContract, { context: context(), input }),
    get: (sideId) => invoke(contracts.sideConversationGetContract, { context: context(), sideId }),
    list: (input) => invoke(contracts.sideConversationListContract, { context: context(), input }),
    configure: (input) => invoke(contracts.sideConversationConfigureContract, { context: context(), input }),
    respond: (input) => invoke(contracts.sideConversationRespondContract, { context: context(), input }),
    send: (input) => invoke(contracts.sideConversationSendContract, { context: context(), input }),
    abort: (sideId) => invoke(contracts.sideConversationAbortContract, { context: context(), sideId }),
    release: (sideId) => invoke(contracts.sideConversationReleaseContract, { context: context(), sideId }),
  }
}
