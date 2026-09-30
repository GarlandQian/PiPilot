import type { BrowserWindow } from 'electron'
import * as contracts from '../../shared/ipc/side-conversations-contracts'
import type { SideConversationsApi } from '../../shared/side-conversations'
import type { ApplicationUrlPolicy } from '../security/url-policy'
import { createTrustedSenderValidator, MainProcessError, registerValidatedHandler } from './validated-handler'
export function registerSideConversationsIpc(options: { getMainWindow(): BrowserWindow | null; policy: ApplicationUrlPolicy; service: SideConversationsApi }) {
  const trusted = createTrustedSenderValidator(options.policy, options.getMainWindow)
  const safe = async <T>(operation: () => Promise<T>) => {
    try { return await operation() } catch (error) { throw new MainProcessError('SIDE_CONVERSATION_FAILED', (error instanceof Error ? error.message : 'The side conversation failed.').slice(0, 1_000)) }
  }
  const unregister = [
    registerValidatedHandler(contracts.sideConversationCreateContract, trusted, ({ input }) => safe(() => options.service.create(input))),
    registerValidatedHandler(contracts.sideConversationGetContract, trusted, ({ sideId }) => safe(() => options.service.get(sideId))),
    registerValidatedHandler(contracts.sideConversationSendContract, trusted, ({ input }) => safe(() => options.service.send(input))),
    registerValidatedHandler(contracts.sideConversationAbortContract, trusted, ({ sideId }) => safe(() => options.service.abort(sideId))),
    registerValidatedHandler(contracts.sideConversationReleaseContract, trusted, ({ sideId }) => safe(() => options.service.release(sideId))),
  ]
  return { dispose() { for (const stop of unregister) stop() } }
}
