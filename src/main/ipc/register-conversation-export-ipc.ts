import { dialog, type BrowserWindow } from 'electron'
import { conversationExportContract } from '../../shared/ipc/conversation-export-contracts'
import { ConversationExportService } from '../conversations/conversation-export-service'
import { ConversationExportError } from '../conversations/conversation-markdown'
import type { PiRuntimeFrontend } from '../pi-host/pi-runtime-frontend'
import type { OfficialPiSessionCatalog } from '../conversations/official-pi-session-catalog'
import type { ApplicationUrlPolicy } from '../security/url-policy'
import { createTrustedSenderValidator, MainProcessError, registerValidatedHandler } from './validated-handler'

export function registerConversationExportIpc({ runtimeHost, sessionCatalog, getMainWindow, policy }: {
  runtimeHost: PiRuntimeFrontend; sessionCatalog: OfficialPiSessionCatalog; getMainWindow(): BrowserWindow | null; policy: ApplicationUrlPolicy
}) {
  const service = new ConversationExportService({
    runtime: runtimeHost,
    catalog: sessionCatalog,
    chooseDestination: async (defaultName, locale, format = 'markdown') => {
      const window = getMainWindow()
      if (!window || window.isDestroyed()) throw new ConversationExportError('EXPORT_WINDOW_UNAVAILABLE', 'The application window is unavailable.')
      const selection = await dialog.showSaveDialog(window, {
        title: locale === 'zh-CN' ? '导出对话' : 'Export conversation',
        defaultPath: defaultName,
        filters: [format === 'html' ? { name: 'HTML', extensions: ['html'] }
          : format === 'jsonl' ? { name: locale === 'zh-CN' ? 'Pi 会话' : 'Pi session', extensions: ['jsonl'] }
            : { name: 'Markdown', extensions: ['md'] }],
        properties: ['createDirectory', 'showOverwriteConfirmation'],
      })
      return selection.canceled ? null : selection.filePath ?? null
    },
  })
  return registerValidatedHandler(conversationExportContract, createTrustedSenderValidator(policy, getMainWindow), async ({ input }) => {
    try { return await service.save(input) } catch (error) {
      if (error instanceof ConversationExportError) throw new MainProcessError(error.code, error.message)
      throw new MainProcessError('EXPORT_HISTORY_UNAVAILABLE', 'The conversation export could not be prepared.')
    }
  })
}
