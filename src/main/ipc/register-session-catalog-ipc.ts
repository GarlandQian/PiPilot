import type { BrowserWindow } from 'electron'
import {
  sessionCatalogDeleteContract,
  sessionCatalogListContract,
  sessionCatalogOpenContract,
  sessionCatalogRenameContract,
  sessionCatalogRefreshContract,
} from '../../shared/ipc/contracts'
import type { ConversationContextService } from '../conversations/conversation-context-service'
import { ConversationScopeError } from '../conversations/conversation-scope-resolver'
import {
  OfficialPiSessionCatalogError,
  type OfficialPiSessionCatalog,
} from '../conversations/official-pi-session-catalog'
import { OfficialPiSessionActivationError } from '../conversations/official-pi-session-activation-service'
import { OfficialPiSessionDeletionError } from '../conversations/official-pi-session-deletion-service'
import type { ApplicationUrlPolicy } from '../security/url-policy'
import {
  createTrustedSenderValidator,
  MainProcessError,
  registerValidatedHandler,
} from './validated-handler'

interface RegisterSessionCatalogIpcOptions {
  catalog: OfficialPiSessionCatalog
  contextService: ConversationContextService
  getMainWindow(): BrowserWindow | null
  policy: ApplicationUrlPolicy
}

function mapCatalogError(error: unknown) {
  if (
    error instanceof OfficialPiSessionCatalogError ||
    error instanceof OfficialPiSessionActivationError ||
    error instanceof OfficialPiSessionDeletionError ||
    error instanceof ConversationScopeError
  ) {
    return new MainProcessError(error.code, error.message)
  }
  return error
}

export function registerSessionCatalogIpc(options: RegisterSessionCatalogIpcOptions) {
  const {
    catalog,
    contextService,
    getMainWindow,
    policy,
  } = options
  const isTrustedSender = createTrustedSenderValidator(policy, getMainWindow)

  registerValidatedHandler(
    sessionCatalogDeleteContract,
    isTrustedSender,
    async ({ scope, selectionToken }) => {
      try {
        return await contextService.deleteConversation(scope, selectionToken)
      } catch (error) {
        throw mapCatalogError(error)
      }
    },
  )
  registerValidatedHandler(
    sessionCatalogListContract,
    isTrustedSender,
    ({ scope, cursor }) => catalog.list(scope, cursor).catch((error) => {
      throw mapCatalogError(error)
    }),
  )
  registerValidatedHandler(
    sessionCatalogRefreshContract,
    isTrustedSender,
    async ({ scope }) => {
      try {
        return await catalog.refresh(scope)
      } catch (error) {
        throw mapCatalogError(error)
      }
    },
  )
  registerValidatedHandler(
    sessionCatalogOpenContract,
    isTrustedSender,
    async ({ scope, selectionToken }) => {
      try {
        return await contextService.openConversation(
          scope,
          selectionToken,
        )
      } catch (error) {
        throw mapCatalogError(error)
      }
    },
  )
  registerValidatedHandler(
    sessionCatalogRenameContract,
    isTrustedSender,
    async ({ scope, selectionToken, name }) => {
      try {
        return await contextService.renameConversation(
          scope,
          selectionToken,
          name,
        )
      } catch (error) {
        throw mapCatalogError(error)
      }
    },
  )
}
