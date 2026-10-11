import { basename, extname } from 'node:path'
import {
  CONVERSATION_IMPORT_MAX_MESSAGES, CONVERSATION_IMPORT_MAX_PREVIEW_CHARACTERS, CONVERSATION_IMPORT_MAX_TOTAL_BYTES,
  importedConversationHistorySchema, type ConversationImportPreviewRequest, type ConversationImportWarning, type ImportedConversationHistory,
} from '../../shared/conversation-import'

type Content = ImportedConversationHistory['messages'][number]['content'][number]
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'])

export class PiSessionImportError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'PiSessionImportError' }
}

interface RawEntry { type?: unknown; id?: unknown; parentId?: unknown; message?: unknown; name?: unknown; cwd?: unknown }

function contentParts(value: unknown, warnings: Set<ConversationImportWarning>): Content[] {
  if (typeof value === 'string') return value.trim() ? [{ type: 'text', text: value }] : []
  if (!Array.isArray(value)) return []
  const parts: Content[] = []
  for (const part of value as Array<Record<string, unknown>>) {
    if (part?.type === 'text' && typeof part.text === 'string' && part.text.trim()) parts.push({ type: 'text', text: part.text })
    else if (part?.type === 'image' && typeof part.data === 'string' && typeof part.mimeType === 'string' && IMAGE_TYPES.has(part.mimeType)) {
      parts.push({ type: 'image', mimeType: part.mimeType as Extract<Content, { type: 'image' }>['mimeType'], data: part.data })
    } else if (part?.type === 'toolCall' || part?.type === 'image') warnings.add(part.type === 'image' ? 'unsupportedImages' : 'toolsOmitted')
  }
  return parts
}

/**
 * A Pi session file (`.jsonl`) as inert history, like a PiPilot Markdown
 * export: the messages on its current branch, without tool calls, results or
 * approvals, which belong to the original session and its project.
 */
export function parsePiSessionImport(file: string, bytes: Buffer, locale: ConversationImportPreviewRequest['locale']) {
  if (extname(file).toLowerCase() !== '.jsonl') throw new PiSessionImportError('IMPORT_INVALID_FILE', 'Select a Pi session file.')
  if (bytes.length > CONVERSATION_IMPORT_MAX_TOTAL_BYTES) throw new PiSessionImportError('IMPORT_TOO_LARGE', 'The selected session is too large to import.')
  let text: string
  try { text = new TextDecoder('utf8', { fatal: true }).decode(bytes).replace(/^﻿/u, '') } catch {
    throw new PiSessionImportError('IMPORT_INVALID_FILE', 'The selected session must be UTF-8 JSON lines.')
  }
  const lines = text.split(/\r?\n/u).filter((line) => line.trim())
  let header: RawEntry
  try { header = JSON.parse(lines[0] ?? '') as RawEntry } catch { header = {} }
  if (header?.type !== 'session' || typeof header.cwd !== 'string') throw new PiSessionImportError('IMPORT_INVALID_FILE', 'This file is not a Pi session.')
  const entries = new Map<string, RawEntry>()
  let leaf: string | null = null
  let name: string | null = null
  for (const line of lines.slice(1)) {
    let entry: RawEntry
    try { entry = JSON.parse(line) as RawEntry } catch { continue }
    if (!entry || typeof entry.id !== 'string') continue
    entries.set(entry.id, entry)
    leaf = entry.id
    if (entry.type === 'session_info' && typeof entry.name === 'string' && entry.name.trim()) name = entry.name.trim()
  }
  // The current branch: from the last entry back to the root.
  const path: RawEntry[] = []
  const seen = new Set<string>()
  for (let id = leaf; id && !seen.has(id); id = typeof entries.get(id)?.parentId === 'string' ? entries.get(id)!.parentId as string : null) {
    seen.add(id)
    const entry = entries.get(id)
    if (entry) path.unshift(entry)
  }
  const warnings = new Set<ConversationImportWarning>()
  const messages: ImportedConversationHistory['messages'] = []
  for (const entry of path) {
    if (entry.type !== 'message' || !entry.message || typeof entry.message !== 'object') continue
    const message = entry.message as { role?: unknown; content?: unknown }
    if (message.role === 'user' || message.role === 'assistant') {
      const content = contentParts(message.content, warnings)
      if (content.length) messages.push({ role: message.role, content })
    } else if (message.role === 'toolResult' || message.role === 'bashExecution') warnings.add('toolsOmitted')
  }
  if (!messages.some((message) => message.role === 'user' || message.content.some((part) => part.type === 'text' && part.text.trim()))) {
    throw new PiSessionImportError('IMPORT_INVALID_FILE', 'This session has no messages to import.')
  }
  if (messages.length > CONVERSATION_IMPORT_MAX_MESSAGES) throw new PiSessionImportError('IMPORT_TOO_LARGE', 'The session contains too many messages.')
  const firstUser = messages.find((message) => message.role === 'user')?.content.find((part) => part.type === 'text')
  const title = (name ?? (firstUser?.type === 'text' ? firstUser.text : basename(file, '.jsonl'))).replace(/\s+/gu, ' ').trim().slice(0, 120) || 'Imported conversation'
  const labels = locale === 'zh-CN' ? { user: '用户', assistant: '助手' } : { user: 'User', assistant: 'Assistant' }
  const preview = messages.map((message) => `### ${message.role === 'user' ? labels.user : labels.assistant}\n\n${message.content
    .map((part) => part.type === 'text' ? part.text : '').filter(Boolean).join('\n\n')}`).join('\n\n')
  if (preview.length > CONVERSATION_IMPORT_MAX_PREVIEW_CHARACTERS) warnings.add('previewTruncated')
  const imageCount = messages.reduce((total, message) => total + message.content.filter((part) => part.type === 'image').length, 0)
  if (imageCount > 100) throw new PiSessionImportError('IMPORT_TOO_LARGE', 'The session contains too many images.')
  return {
    history: importedConversationHistorySchema.parse({ title, messages }),
    title, fileName: basename(file), format: 'pi-session' as const, sourceCwd: header.cwd,
    messageCount: messages.length, imageCount, warnings: [...warnings],
    previewMarkdown: preview.slice(0, CONVERSATION_IMPORT_MAX_PREVIEW_CHARACTERS),
  }
}
