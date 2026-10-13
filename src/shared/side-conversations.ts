import { z } from 'zod'
import { conversationScopeSchema } from './conversation-scope'
import { localPiExtensionUiRequestSchema, localPiExtensionUiResponseSchema, localPiModelSchema, localPiThinkingLevelSchema } from './local-pi'

export const sideConversationConfigurationSchema = z.object({
  provider: z.string().min(1).max(256), modelId: z.string().min(1).max(512),
  thinkingLevel: localPiThinkingLevelSchema.optional(),
}).strict()
export const listSideConversationsSchema = z.object({ scope: conversationScopeSchema, parentSessionId: z.string().min(1).max(2_048) }).strict()
export const configureSideConversationSchema = z.object({ sideId: z.uuid(), configuration: sideConversationConfigurationSchema }).strict()
export const respondSideConversationSchema = z.object({ sideId: z.uuid(), response: localPiExtensionUiResponseSchema }).strict()
export const sideConversationTimelineItemSchema = z.object({
  id: z.string(), kind: z.enum(['user', 'assistant', 'thinking', 'tool']), text: z.string().max(128_000),
  partial: z.boolean().optional(), toolName: z.string().optional(), toolCallId: z.string().optional(),
  arguments: z.string().max(20_000).optional(), status: z.enum(['running', 'completed', 'failed']).optional(),
}).strict()

/** Captured evidence only: the backend never re-reads a quoted file by path. */
export const sideReferenceSchema = z.object({
  id: z.string().min(1).max(2_048), ownerKey: z.string().min(1).max(2_048),
  kind: z.enum(['message', 'file', 'command', 'diff', 'browser']), sourceId: z.string().min(1).max(2_048),
  label: z.string().min(1).max(2_048), text: z.string().min(1).max(20_000),
  path: z.string().max(2_048).optional(), startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(), side: z.enum(['additions', 'deletions']).optional(),
  stage: z.enum(['staged', 'unstaged', 'branch', 'commit']).optional(), revision: z.string().max(256).optional(),
  comment: z.string().max(4_000).optional(), stale: z.boolean().optional(),
}).strict().refine((value) => (value.startLine === undefined && value.endLine === undefined) ||
  (value.startLine !== undefined && value.endLine !== undefined && value.endLine >= value.startLine), 'Invalid line range')
  .refine((value) => value.text.trim().length > 0, 'The source snapshot is empty')
  .refine((value) => value.kind !== 'diff' || Boolean(value.path && value.revision && value.side && value.stage && value.startLine !== undefined && value.endLine !== undefined), 'Incomplete diff snapshot')
export const createSideConversationSchema = z.object({
  scope: conversationScopeSchema, parentSessionId: z.string().min(1).max(2_048),
  reference: sideReferenceSchema, question: z.string().trim().min(1).max(20_000), requestId: z.uuid(),
  configuration: sideConversationConfigurationSchema.optional(),
}).strict()
export const sendSideConversationSchema = z.object({ sideId: z.uuid(), text: z.string().trim().min(1).max(20_000), requestId: z.uuid(), configuration: sideConversationConfigurationSchema.optional() }).strict()
export const sideConversationSnapshotSchema = z.object({
  sideId: z.uuid(), scope: conversationScopeSchema, parentSessionId: z.string(),
  sessionId: z.string().nullable(), sessionFile: z.string().nullable(), reference: sideReferenceSchema,
  status: z.enum(['starting', 'running', 'completed', 'cancelled', 'failed', 'interaction_required']),
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(128_000), partial: z.boolean().optional() }).strict()).max(200),
  timeline: z.array(sideConversationTimelineItemSchema).max(400),
  model: localPiModelSchema.nullable(), thinkingLevel: localPiThinkingLevelSchema,
  models: z.array(localPiModelSchema), thinkingLevels: z.array(localPiThinkingLevelSchema),
  configuration: sideConversationConfigurationSchema.nullable(),
  uiRequests: z.array(localPiExtensionUiRequestSchema).max(256),
  error: z.string().optional(), released: z.boolean(),
}).strict()
export type CreateSideConversationInput = z.infer<typeof createSideConversationSchema>
export type SendSideConversationInput = z.infer<typeof sendSideConversationSchema>
export type SideConversationSnapshot = z.infer<typeof sideConversationSnapshotSchema>
export type SideConversationConfiguration = z.infer<typeof sideConversationConfigurationSchema>
export type SideConversationTimelineItem = z.infer<typeof sideConversationTimelineItemSchema>
export type ListSideConversationsInput = z.infer<typeof listSideConversationsSchema>
export type ConfigureSideConversationInput = z.infer<typeof configureSideConversationSchema>
export type RespondSideConversationInput = z.infer<typeof respondSideConversationSchema>
export interface SideConversationsApi {
  create(input: CreateSideConversationInput): Promise<SideConversationSnapshot>
  get(sideId: string): Promise<SideConversationSnapshot>
  list(input: ListSideConversationsInput): Promise<SideConversationSnapshot[]>
  configure(input: ConfigureSideConversationInput): Promise<SideConversationSnapshot>
  respond(input: RespondSideConversationInput): Promise<SideConversationSnapshot>
  send(input: SendSideConversationInput): Promise<SideConversationSnapshot>
  abort(sideId: string): Promise<SideConversationSnapshot>
  release(sideId: string): Promise<void>
}
