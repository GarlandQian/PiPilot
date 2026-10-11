import { z } from 'zod'
import { conversationScopeSchema, sessionCatalogSelectionTokenSchema } from './conversation-scope'

/** What to pop out: the open conversation, or a listed one by its catalog token. */
export const popoutTargetSchema = z.union([
  z.object({ kind: z.literal('active'), scope: conversationScopeSchema, sessionId: z.string().min(1).max(256) }).strict(),
  z.object({ kind: z.literal('catalog'), scope: conversationScopeSchema, selectionToken: sessionCatalogSelectionTokenSchema }).strict(),
])
export type PopoutTarget = z.infer<typeof popoutTargetSchema>

export const popoutMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  text: z.string().max(128_000),
  /** Tool calls the reply made, shown as a count in the compact window. */
  tools: z.number().int().nonnegative().optional(),
  partial: z.boolean().optional(),
}).strict()

export const popoutSnapshotSchema = z.object({
  popoutId: z.uuid(),
  title: z.string().max(512),
  scopeLabel: z.string().max(512),
  status: z.enum(['starting', 'idle', 'running', 'failed', 'closed']),
  pinned: z.boolean(),
  messages: z.array(popoutMessageSchema).max(200),
  queued: z.number().int().nonnegative(),
  /** Pi asked for input (a dialog) that only the main window can answer. */
  needsMainWindow: z.boolean(),
  error: z.string().max(1_000).optional(),
}).strict()
export type PopoutSnapshot = z.infer<typeof popoutSnapshotSchema>

export const popoutChangedEventSchema = z.object({ eventId: z.uuid(), snapshot: popoutSnapshotSchema }).strict()

/** The open-a-window half lives on the main window's API; the rest is the pop-out's own. */
export interface PopoutApi {
  open(target: PopoutTarget): Promise<{ popoutId: string }>
  get(popoutId: string): Promise<PopoutSnapshot>
  send(popoutId: string, text: string, requestId: string): Promise<PopoutSnapshot>
  abort(popoutId: string): Promise<PopoutSnapshot>
  setPinned(popoutId: string, pinned: boolean): Promise<PopoutSnapshot>
  showMainWindow(popoutId: string): Promise<void>
  subscribe(listener: (snapshot: PopoutSnapshot) => void): () => void
}
