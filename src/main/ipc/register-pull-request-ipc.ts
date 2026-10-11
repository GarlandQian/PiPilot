import type { BrowserWindow } from 'electron'
import { pullRequestDetailContract, pullRequestFixContract, pullRequestListContract, pullRequestReviewContract, pullRequestStatusContract } from '../../shared/ipc/pull-request-contracts'
import { PullRequestError, type PullRequestService } from '../pull-requests/pull-request-service'
import type { ApplicationUrlPolicy } from '../security/url-policy'
import { createTrustedSenderValidator, MainProcessError, registerValidatedHandler } from './validated-handler'

export function registerPullRequestIpc({ getMainWindow, policy, service }: {
  getMainWindow(): BrowserWindow | null
  policy: ApplicationUrlPolicy
  service: PullRequestService
}) {
  const trusted = createTrustedSenderValidator(policy, getMainWindow)
  const map = async <T>(action: () => Promise<T>) => {
    try { return await action() }
    catch (error) {
      if (error instanceof PullRequestError) throw new MainProcessError(error.code, error.message, true)
      throw new MainProcessError('PULL_REQUEST_FAILED', (error instanceof Error ? error.message : 'The pull request action failed.').slice(0, 1_000), true)
    }
  }
  const unregister = [
    registerValidatedHandler(pullRequestStatusContract, trusted, ({ workspaceId }) => map(() => service.status(workspaceId))),
    registerValidatedHandler(pullRequestListContract, trusted, ({ workspaceId, filter }) => map(() => service.list(workspaceId, filter))),
    registerValidatedHandler(pullRequestDetailContract, trusted, ({ workspaceId, number }) => map(() => service.detail(workspaceId, number))),
    registerValidatedHandler(pullRequestReviewContract, trusted, ({ workspaceId, number, action, body }) => map(() => service.review(workspaceId, number, action, body))),
    registerValidatedHandler(pullRequestFixContract, trusted, ({ workspaceId, number }) => map(() => service.fix(workspaceId, number))),
  ]
  return { dispose() { unregister.forEach((stop) => stop()) } }
}
