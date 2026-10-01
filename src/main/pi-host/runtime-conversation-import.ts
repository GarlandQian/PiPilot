import type { SessionManager } from '@earendil-works/pi-coding-agent'
import { createHash } from 'node:crypto'
import { importedConversationHistorySchema, type ImportedConversationHistory } from '../../shared/conversation-import'

/** Persist inert history through the official SDK. No prompt(), event replay,
 * tools, inherited task approval, model configuration, or pending delivery. */
export function appendImportedConversationHistory(manager: SessionManager, raw: ImportedConversationHistory) {
  const history = importedConversationHistorySchema.parse(raw)
  const digest = importedConversationDigest(history)
  manager.appendCustomEntry('pipilot.import-origin', { version: 1, format: 'markdown', importId: history.importId, digest, importedAt: Date.now() })
  for (const message of history.messages) {
    if (message.role === 'context') {
      manager.appendCustomMessageEntry('pipilot.imported-context', message.content, true, { imported: true })
    } else if (message.role === 'user') {
      manager.appendMessage({ role: 'user', content: message.content, timestamp: Date.now() })
    } else {
      // SDK assistant history requires provider and usage fields. These are
      // explicitly identified as an import, never attributed to a real model.
      const text = message.content.filter((part) => part.type === 'text')
      if (text.length) manager.appendMessage({
        role: 'assistant', content: text, timestamp: Date.now(),
        provider: 'pipilot-import', model: 'markdown-import', api: 'openai-completions', stopReason: 'stop',
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      })
      const images = message.content.filter((part) => part.type === 'image')
      if (images.length) manager.appendCustomMessageEntry('pipilot.imported-context', images, true, { imported: true })
    }
  }
  manager.appendSessionInfo(history.title)
  manager.appendCustomEntry('pipilot.import-complete', { version: 1, importId: history.importId, digest })
}

export function importedConversationDigest(history: ImportedConversationHistory) {
  return createHash('sha256').update(JSON.stringify(history.messages)).digest('hex')
}

export function importedConversationState(manager: SessionManager, history: ImportedConversationHistory): 'complete' | 'incomplete' | 'unrelated' {
  const branch = manager.getBranch()
  const origin = branch.find((entry) => entry.type === 'custom' && entry.customType === 'pipilot.import-origin')
  const digest = importedConversationDigest(history)
  const matches = (data: unknown) => Boolean(data && typeof data === 'object' && 'importId' in data && data.importId === history.importId && 'digest' in data && data.digest === digest)
  if (origin?.type !== 'custom' || !matches(origin.data)) return 'unrelated'
  return branch.some((entry) => entry.type === 'custom' && entry.customType === 'pipilot.import-complete' && matches(entry.data)) ? 'complete' : 'incomplete'
}
