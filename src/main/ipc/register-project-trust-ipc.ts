import { randomUUID } from 'node:crypto'
import type { BrowserWindow } from 'electron'
import { projectTrustChannels, projectTrustDecideContract, projectTrustGetContract, projectTrustGetPolicyContract, projectTrustSetPolicyContract } from '../../shared/ipc/project-trust-contracts'
import { projectTrustChangedEventSchema } from '../../shared/project-trust'
import { ProjectTrustError, type ProjectTrustService } from '../project-trust/project-trust-service'
import type { ApplicationUrlPolicy } from '../security/url-policy'
import { createTrustedSenderValidator, MainProcessError, registerValidatedHandler } from './validated-handler'

export function registerProjectTrustIpc({ getMainWindow, policy, service }: {
  getMainWindow(): BrowserWindow | null
  policy: ApplicationUrlPolicy
  service: ProjectTrustService
}) {
  const trusted = createTrustedSenderValidator(policy, getMainWindow)
  const map = async <T>(action: () => T | Promise<T>) => {
    try { return await action() }
    catch (error) {
      if (error instanceof ProjectTrustError) throw new MainProcessError(error.code, error.message.slice(0, 1_000), true)
      throw error
    }
  }
  const detach = service.subscribe((workspaceId) => {
    const window = getMainWindow()
    if (window && !window.isDestroyed()) {
      window.webContents.send(projectTrustChannels.changed, projectTrustChangedEventSchema.parse({ eventId: randomUUID(), ...(workspaceId ? { workspaceId } : {}) }))
    }
  })
  const unregister = [
    registerValidatedHandler(projectTrustGetContract, trusted, ({ workspaceId }) => map(() => service.status(workspaceId))),
    registerValidatedHandler(projectTrustDecideContract, trusted, ({ workspaceId, choice }) => map(() => service.decide(workspaceId, choice))),
    registerValidatedHandler(projectTrustGetPolicyContract, trusted, () => map(() => service.policy())),
    registerValidatedHandler(projectTrustSetPolicyContract, trusted, ({ policy: next }) => map(() => service.setPolicy(next))),
  ]
  return { dispose() { detach(); unregister.forEach((stop) => stop()) } }
}
