import type { BrowserWindow } from 'electron'
import * as contracts from '../../shared/ipc/project-workflows-contracts'
import type { ProjectWorkflowsApi } from '../../shared/project-workflows'
import type { ApplicationUrlPolicy } from '../security/url-policy'
import { createTrustedSenderValidator, MainProcessError, registerValidatedHandler } from './validated-handler'

export function registerProjectWorkflowsIpc(options: { getMainWindow(): BrowserWindow | null; policy: ApplicationUrlPolicy; service: ProjectWorkflowsApi }) {
  const trusted = createTrustedSenderValidator(options.policy, options.getMainWindow)
  const service = options.service
  const safe = async <T>(operation: () => Promise<T>) => {
    try { return await operation() } catch (error) {
      throw new MainProcessError('PROJECT_WORKFLOW_FAILED', (error instanceof Error ? error.message : 'The project operation failed.').slice(0, 1_000))
    }
  }
  const unregister = [
    registerValidatedHandler(contracts.projectWorkflowsGetContract, trusted, ({ workspaceId }) => safe(() => service.get(workspaceId))),
    registerValidatedHandler(contracts.projectActionsSaveContract, trusted, ({ workspaceId, actions, expectedRevision }) => safe(() => service.saveActions(workspaceId, actions, expectedRevision))),
    registerValidatedHandler(contracts.projectActionsRunContract, trusted, ({ workspaceId, actionId, expectedRevision }) => safe(() => service.run(workspaceId, actionId, expectedRevision))),
    registerValidatedHandler(contracts.projectActionsStopContract, trusted, ({ runId }) => safe(() => service.stop(runId))),
    registerValidatedHandler(contracts.worktreeCreateContract, trusted, ({ input }) => safe(() => service.createWorktree(input))),
    registerValidatedHandler(contracts.worktreeArchiveContract, trusted, ({ id }) => safe(() => service.archiveWorktree(id))),
    registerValidatedHandler(contracts.worktreeRestoreContract, trusted, ({ id }) => safe(() => service.restoreWorktree(id))),
  ]
  return { dispose() { for (const stop of unregister) stop() } }
}
