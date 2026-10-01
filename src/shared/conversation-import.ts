import { z } from 'zod'
import { conversationActivationResultSchema, conversationScopeSchema } from './conversation-scope'

export const CONVERSATION_IMPORT_MAX_MARKDOWN_BYTES = 16 * 1024 * 1024
export const CONVERSATION_IMPORT_MAX_IMAGE_BYTES = 16 * 1024 * 1024
export const CONVERSATION_IMPORT_MAX_TOTAL_BYTES = 32 * 1024 * 1024
export const CONVERSATION_IMPORT_MAX_MESSAGES = 10_000
export const CONVERSATION_IMPORT_MAX_PREVIEW_CHARACTERS = 24_000

export const conversationImportTokenSchema = z.string().regex(/^imp_[A-Za-z0-9_-]{32}$/u)
export const conversationImportWarningSchema = z.enum(['unrecognizedFormat', 'missingImages', 'unsupportedImages', 'previewTruncated'])
export const conversationImportPreviewRequestSchema = z.object({ locale: z.enum(['en-US', 'zh-CN']) }).strict()
export const conversationImportPreviewResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('cancelled') }).strict(),
  z.object({
    status: z.literal('ready'), token: conversationImportTokenSchema,
    title: z.string().min(1).max(256), fileName: z.string().min(1).max(512),
    format: z.enum(['pipilot', 'document']), messageCount: z.number().int().min(1).max(CONVERSATION_IMPORT_MAX_MESSAGES),
    imageCount: z.number().int().min(0).max(100), warnings: z.array(conversationImportWarningSchema).max(4),
    previewMarkdown: z.string().max(CONVERSATION_IMPORT_MAX_PREVIEW_CHARACTERS),
  }).strict(),
])
export const conversationImportCommitRequestSchema = z.object({
  token: conversationImportTokenSchema, scope: conversationScopeSchema, title: z.string().trim().min(1).max(256),
}).strict()
export const conversationImportDiscardRequestSchema = z.object({ token: conversationImportTokenSchema }).strict()
export const conversationImportDiscardResultSchema = z.object({ discarded: z.literal(true) }).strict()
export { conversationActivationResultSchema as conversationImportCommitResultSchema }

// Host-only data, never accepted from a renderer IPC request. Only inert message
// content crosses this boundary: no old tools, custom entries, or approvals.
export const importedConversationContentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string().max(CONVERSATION_IMPORT_MAX_MARKDOWN_BYTES) }).strict(),
  z.object({ type: z.literal('image'), mimeType: z.enum(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif']), data: z.string().max(Math.ceil(CONVERSATION_IMPORT_MAX_IMAGE_BYTES / 3) * 4) }).strict(),
])
export const importedConversationHistorySchema = z.object({
  importId: z.uuid().optional(),
  title: z.string().trim().min(1).max(256),
  messages: z.array(z.object({ role: z.enum(['user', 'assistant', 'context']), content: z.array(importedConversationContentSchema).min(1).max(201) }).strict()).min(1).max(CONVERSATION_IMPORT_MAX_MESSAGES),
}).strict().refine((history) => history.messages.some((message) => message.role === 'user' || message.role === 'assistant' && message.content.some((part) => part.type === 'text' && part.text.trim())), { message: 'Imported history must contain a user or text assistant message.' })

export type ConversationImportPreviewRequest = z.infer<typeof conversationImportPreviewRequestSchema>
export type ConversationImportPreviewResult = z.infer<typeof conversationImportPreviewResultSchema>
export type ConversationImportCommitRequest = z.infer<typeof conversationImportCommitRequestSchema>
export type ConversationImportWarning = z.infer<typeof conversationImportWarningSchema>
export type ImportedConversationHistory = z.infer<typeof importedConversationHistorySchema>
