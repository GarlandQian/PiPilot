import { z } from 'zod'
import { conversationScopeSchema } from './conversation-scope'

export const taskNotificationSchema = z.object({
  id: z.uuid(),
  kind: z.enum(['completed', 'failed', 'input-required']),
  scope: conversationScopeSchema,
  sessionId: z.string().min(1).max(256),
  catalogId: z.string().regex(/^cat_[a-f0-9]{64}$/u).optional(),
  sessionName: z.string().min(1).max(256).optional(),
  projectName: z.string().min(1).max(256).optional(),
  createdAt: z.number().int().nonnegative(),
  read: z.boolean(),
  resolved: z.boolean(),
}).strict()

export const taskNotificationSnapshotSchema = z.object({
  revision: z.number().int().nonnegative(),
  items: z.array(taskNotificationSchema).max(100),
  requestedId: z.uuid().nullable(),
  desktopSupported: z.boolean(),
}).strict()

export const taskNotificationPresentationSchema = z.object({
  scope: conversationScopeSchema.nullable(),
  sessionId: z.string().min(1).max(256).nullable(),
}).strict().refine((value) => (value.scope === null) === (value.sessionId === null))

export const notificationChangedEventSchema = z.object({
  eventId: z.uuid(),
  snapshot: taskNotificationSnapshotSchema,
}).strict()

export type TaskNotification = z.infer<typeof taskNotificationSchema>
export type TaskNotificationSnapshot = z.infer<typeof taskNotificationSnapshotSchema>
export type TaskNotificationPresentation = z.infer<typeof taskNotificationPresentationSchema>
