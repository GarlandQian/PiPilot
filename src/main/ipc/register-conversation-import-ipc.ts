import { dialog, type BrowserWindow } from 'electron'
import { conversationImportCommitContract, conversationImportDiscardContract, conversationImportPreviewContract } from '../../shared/ipc/conversation-import-contracts'
import { ConversationImportError, ConversationImportService } from '../conversations/conversation-import-service'
import type { ConversationContextService } from '../conversations/conversation-context-service'
import type { ApplicationUrlPolicy } from '../security/url-policy'
import type { ConversationScope } from '../../shared/conversation-scope'
import { createTrustedSenderValidator, MainProcessError, registerValidatedHandler } from './validated-handler'

export function registerConversationImportIpc({ contextService, getMainWindow, policy, matchScope }: {
  contextService: ConversationContextService; getMainWindow(): BrowserWindow | null; policy: ApplicationUrlPolicy
  matchScope?(cwd: string): Promise<ConversationScope | undefined>
}) {
  const service = new ConversationImportService({
    chooseDocument: async (locale) => {
      const window = getMainWindow()
      if (!window || window.isDestroyed()) throw new ConversationImportError('IMPORT_WINDOW_UNAVAILABLE', 'The application window is unavailable.')
      const result = await dialog.showOpenDialog(window, {
        title: locale === 'zh-CN' ? '导入会话' : 'Import conversation',
        properties: ['openFile'], filters: [
          { name: locale === 'zh-CN' ? 'Markdown 或 Pi 会话' : 'Markdown or Pi session', extensions: ['md', 'markdown', 'jsonl'] },
          { name: 'Markdown', extensions: ['md', 'markdown'] },
          { name: locale === 'zh-CN' ? 'Pi 会话' : 'Pi session', extensions: ['jsonl'] },
        ],
      })
      return result.canceled ? null : result.filePaths[0] ?? null
    },
    activate: (scope, history) => contextService.importConversation(scope, history),
    ...(matchScope ? { matchScope } : {}),
  })
  const trusted = createTrustedSenderValidator(policy, getMainWindow)
  const handle = async <T>(operation: () => Promise<T>): Promise<T> => {
    try { return await operation() } catch (error) {
      if (error instanceof ConversationImportError) throw new MainProcessError(error.code, error.message)
      throw new MainProcessError('IMPORT_FAILED', 'The conversation could not be imported.')
    }
  }
  const dispose = [
    registerValidatedHandler(conversationImportPreviewContract, trusted, ({ input }) => handle(() => service.preview(input))),
    registerValidatedHandler(conversationImportCommitContract, trusted, ({ input }) => handle(() => service.commit(input))),
    registerValidatedHandler(conversationImportDiscardContract, trusted, ({ input }) => service.discard(input.token)),
  ]
  return () => { for (const unregister of dispose) unregister() }
}
