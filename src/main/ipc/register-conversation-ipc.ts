import { randomUUID } from 'node:crypto'
import type { BrowserWindow } from 'electron'
import {
  conversationNavigationChangedEventSchema,
  conversationNavigationGetContract,
  conversationNewContract,
  ipcChannels,
} from '../../shared/ipc/contracts'
import type { ConversationContextService } from '../conversations/conversation-context-service'
import { PiRuntimeFrontendError } from '../pi-host/pi-runtime-frontend'
import type { ApplicationUrlPolicy } from '../security/url-policy'
import {
  createTrustedSenderValidator,
  MainProcessError,
  registerValidatedHandler,
} from './validated-handler'
interface RegisterConversationIpcOptions {
  contextService: ConversationContextService
  getMainWindow(): BrowserWindow | null
  policy: ApplicationUrlPolicy
}

function mapConversationError(error: unknown): never {
  if (
    error instanceof PiRuntimeFrontendError
  ) {
    throw new MainProcessError(error.code, error.message)
  }
  throw error
}

export function registerConversationIpc(options: RegisterConversationIpcOptions) {
  const {
    contextService,
    getMainWindow,
    policy,
  } = options
  const isTrustedSender = createTrustedSenderValidator(policy, getMainWindow)

  registerValidatedHandler(
    conversationNavigationGetContract,
    isTrustedSender,
    () => contextService.getSnapshot(),
  )
  registerValidatedHandler(
    conversationNewContract,
    isTrustedSender,
    async ({ scope }) => {
      return contextService
        .newConversation(scope)
        .catch(mapConversationError)
    },
  )

  return contextService.subscribe((snapshot) => {
    const window = getMainWindow()
    if (!window || window.isDestroyed()) return
    window.webContents.send(
      ipcChannels.conversationNavigationChanged,
      conversationNavigationChangedEventSchema.parse({
        eventId: randomUUID(),
        snapshot,
      }),
    )
  })
}
