import type { BrowserWindow } from 'electron'
import { conversationSearchContract } from '../../shared/ipc/conversation-search-contracts'
import { ConversationSearchService } from '../conversations/conversation-search-service'
import type { OfficialPiSessionCatalog } from '../conversations/official-pi-session-catalog'
import type { ApplicationUrlPolicy } from '../security/url-policy'
import { createTrustedSenderValidator, registerValidatedHandler } from './validated-handler'

export function registerConversationSearchIpc({ catalog, getMainWindow, policy }: {
  catalog: OfficialPiSessionCatalog; getMainWindow(): BrowserWindow | null; policy: ApplicationUrlPolicy
}) {
  const service = new ConversationSearchService(catalog)
  return registerValidatedHandler(conversationSearchContract,
    createTrustedSenderValidator(policy, getMainWindow), ({ input }) => service.search(input))
}
