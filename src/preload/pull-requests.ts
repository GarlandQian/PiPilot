import type { IpcContract, RequestContext } from '../shared/ipc/contracts'
import { pullRequestDetailContract, pullRequestFixContract, pullRequestListContract, pullRequestReviewContract, pullRequestStatusContract } from '../shared/ipc/pull-request-contracts'
import type { PullRequestsApi } from '../shared/pull-requests'

export function createPullRequestsApi(
  invoke: <TRequest extends { context: RequestContext }, TResponse>(contract: IpcContract<TRequest, TResponse>, request: TRequest) => Promise<TResponse>,
  context: () => RequestContext,
): PullRequestsApi {
  return {
    status: (workspaceId) => invoke(pullRequestStatusContract, { context: context(), workspaceId }),
    list: (workspaceId, filter) => invoke(pullRequestListContract, { context: context(), workspaceId, filter }),
    detail: (workspaceId, number) => invoke(pullRequestDetailContract, { context: context(), workspaceId, number }),
    review: (workspaceId, number, action, body) => invoke(pullRequestReviewContract, { context: context(), workspaceId, number, action, body }),
    fix: (workspaceId, number) => invoke(pullRequestFixContract, { context: context(), workspaceId, number }),
  }
}
