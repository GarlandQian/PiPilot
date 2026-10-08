import { z } from 'zod'
import { conversationScopeSchema } from './conversation-scope'

/** Captured evidence only: the backend never re-reads a quoted file by path. */
export const sideReferenceSchema = z.object({
  id: z.string().min(1).max(2_048), ownerKey: z.string().min(1).max(2_048),
  kind: z.enum(['message', 'file', 'command', 'diff']), sourceId: z.string().min(1).max(2_048),
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
}).strict()
export const sendSideConversationSchema = z.object({ sideId: z.uuid(), text: z.string().trim().min(1).max(20_000), requestId: z.uuid() }).strict()
export const sideConversationSnapshotSchema = z.object({
  sideId: z.uuid(), scope: conversationScopeSchema, parentSessionId: z.string(),
  sessionId: z.string().nullable(), sessionFile: z.string().nullable(), reference: sideReferenceSchema,
  status: z.enum(['starting', 'running', 'completed', 'cancelled', 'failed', 'interaction_required']),
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(128_000), partial: z.boolean().optional() }).strict()).max(200),
  error: z.string().optional(), released: z.boolean(),
}).strict()
export type CreateSideConversationInput = z.infer<typeof createSideConversationSchema>
export type SendSideConversationInput = z.infer<typeof sendSideConversationSchema>
export type SideConversationSnapshot = z.infer<typeof sideConversationSnapshotSchema>
export interface SideConversationsApi {
  create(input: CreateSideConversationInput): Promise<SideConversationSnapshot>
  get(sideId: string): Promise<SideConversationSnapshot>
  send(input: SendSideConversationInput): Promise<SideConversationSnapshot>
  abort(sideId: string): Promise<SideConversationSnapshot>
  release(sideId: string): Promise<void>
}
