import { z } from 'zod'
import { externalControlConversationIdSchema, externalControlConversationSchema, externalControlPromptSchema, externalControlOperationIdSchema, listConversationsResultSchema } from './external-control'

export const MAX_SCHEDULED_TASKS = 100
export const MAX_SCHEDULED_RUNS = 500
const targetIdentitySchema = z.string().length(43).regex(/^[A-Za-z0-9_-]+$/u)
export const scheduledTargetSchema = externalControlConversationSchema.extend({ targetIdentity: targetIdentitySchema }).strict()
export const scheduledTargetsResultSchema = listConversationsResultSchema.omit({ conversations: true }).extend({ conversations: z.array(scheduledTargetSchema).max(50) }).strict()
const timestamp = z.number().int().min(0).max(8_640_000_000_000_000)
const timeZone = z.string().min(1).max(100).refine((value) => {
  try { new Intl.DateTimeFormat('en', { timeZone: value }).format(); return true } catch { return false }
}, 'Choose a valid IANA time zone.')
export const taskScheduleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('once'), at: timestamp }).strict(),
  z.object({ kind: z.literal('interval'), startsAt: timestamp, minutes: z.number().int().min(1).max(525_600) }).strict(),
  z.object({ kind: z.literal('daily'), hour: z.number().int().min(0).max(23), minute: z.number().int().min(0).max(59), timeZone }).strict(),
])
export const scheduledTaskInputSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1).max(120),
  conversationId: externalControlConversationIdSchema,
  targetIdentity: targetIdentitySchema,
  prompt: externalControlPromptSchema,
  schedule: taskScheduleSchema,
  missedPolicy: z.enum(['catch-up-once', 'skip']).default('catch-up-once'),
  enabled: z.boolean().default(true),
}).strict()
export const scheduledTaskSchema = scheduledTaskInputSchema.omit({ id: true }).extend({
  id: z.uuid(),
  targetLabel: z.string().max(512),
  targetSessionId: z.string().min(1).max(256),
  targetHeaderIdentity: z.string().min(1).max(512),
  createdAt: timestamp,
  updatedAt: timestamp,
  nextRunAt: timestamp.nullable(),
}).strict()
export const scheduledRunStatusSchema = z.enum(['dispatching', 'starting', 'accepting', 'accepted', 'completed', 'failed', 'aborted', 'runtime_replaced', 'interrupted', 'skipped'])
export const scheduledRunSchema = z.object({
  id: z.uuid(),
  taskId: z.uuid(),
  taskName: z.string().max(120),
  conversationId: externalControlConversationIdSchema,
  scheduledAt: timestamp,
  startedAt: timestamp,
  finishedAt: timestamp.optional(),
  trigger: z.enum(['scheduled', 'manual']),
  status: scheduledRunStatusSchema,
  operationId: externalControlOperationIdSchema.optional(),
  errorCode: z.string().max(128).optional(),
  error: z.string().max(512).optional(),
  finalResponse: z.string().max(70_000).optional(),
}).strict()
export const scheduledTasksSnapshotSchema = z.object({
  revision: z.number().int().nonnegative(),
  tasks: z.array(scheduledTaskSchema).max(MAX_SCHEDULED_TASKS),
  runs: z.array(scheduledRunSchema).max(MAX_SCHEDULED_RUNS),
  storageError: z.string().max(512).nullable(),
}).strict()
export const scheduledTasksChangedSchema = z.object({ eventId: z.uuid(), snapshot: scheduledTasksSnapshotSchema }).strict()
export type TaskSchedule = z.infer<typeof taskScheduleSchema>
export type ScheduledTarget = z.infer<typeof scheduledTargetSchema>
export type ScheduledTaskInput = z.infer<typeof scheduledTaskInputSchema>
export type ScheduledTask = z.infer<typeof scheduledTaskSchema>
export type ScheduledRun = z.infer<typeof scheduledRunSchema>
export type ScheduledTasksSnapshot = z.infer<typeof scheduledTasksSnapshotSchema>
export function isScheduledRunActive(run: Pick<ScheduledRun, 'status'>) {
  return ['dispatching', 'starting', 'accepting', 'accepted'].includes(run.status)
}
