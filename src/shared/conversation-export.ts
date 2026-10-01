import { z } from 'zod'
import { conversationScopeSchema, sessionCatalogSelectionTokenSchema } from './conversation-scope'

const activeConversationExportTargetSchema = z.object({
  scope: conversationScopeSchema,
  generation: z.number().int().nonnegative(),
  sessionId: z.string().min(1).max(256),
  selection: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('conversation') }).strict(),
    z.object({ kind: z.literal('response'), anchorEntryId: z.string().min(1).max(256) }).strict(),
    z.object({ kind: z.literal('message'), entryId: z.string().min(1).max(256) }).strict(),
  ]),
}).strict()

const catalogConversationExportTargetSchema = z.object({
  scope: conversationScopeSchema,
  selectionToken: sessionCatalogSelectionTokenSchema,
  selection: z.object({ kind: z.literal('conversation') }).strict(),
}).strict()

export const conversationExportTargetSchema = z.union([
  activeConversationExportTargetSchema, catalogConversationExportTargetSchema,
])

/** No renderer-supplied paths, transcript bodies, image bytes, or file contents. */
const exportOptions = {
  includeTools: z.boolean(),
  locale: z.enum(['en-US', 'zh-CN']),
}
export const conversationExportRequestSchema = z.union([
  activeConversationExportTargetSchema.extend(exportOptions).strict(),
  catalogConversationExportTargetSchema.extend(exportOptions).strict(),
])

export const conversationExportResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('cancelled') }).strict(),
  z.object({ status: z.literal('saved'), fileName: z.string().min(1).max(512), imageCount: z.number().int().nonnegative() }).strict(),
])

export type ConversationExportTarget = z.infer<typeof conversationExportTargetSchema>
export type ConversationExportRequest = z.infer<typeof conversationExportRequestSchema>
export type ConversationExportResult = z.infer<typeof conversationExportResultSchema>
