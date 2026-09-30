import type { IpcContract, RequestContext } from '../shared/ipc/contracts'
import type { ProjectWorkflowsApi } from '../shared/project-workflows'
import * as contracts from '../shared/ipc/project-workflows-contracts'

export function createProjectWorkflowsApi(
  invoke: <TRequest extends { context: RequestContext }, TResponse>(contract: IpcContract<TRequest, TResponse>, request: TRequest) => Promise<TResponse>,
  context: () => RequestContext,
): ProjectWorkflowsApi {
  return {
    get: (workspaceId) => invoke(contracts.projectWorkflowsGetContract, { context: context(), workspaceId }),
    saveActions: (workspaceId, actions, expectedRevision) => invoke(contracts.projectActionsSaveContract, { context: context(), workspaceId, actions, expectedRevision }),
    run: (workspaceId, actionId, expectedRevision) => invoke(contracts.projectActionsRunContract, { context: context(), workspaceId, actionId, expectedRevision }),
    stop: (runId) => invoke(contracts.projectActionsStopContract, { context: context(), runId }),
    createWorktree: (input) => invoke(contracts.worktreeCreateContract, { context: context(), input }),
    archiveWorktree: (id) => invoke(contracts.worktreeArchiveContract, { context: context(), id }),
    restoreWorktree: (id) => invoke(contracts.worktreeRestoreContract, { context: context(), id }),
  }
}
