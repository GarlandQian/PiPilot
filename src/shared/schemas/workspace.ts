import { z } from 'zod'

export const workspaceIdSchema = z.uuid()

export const workspaceSummarySchema = z
  .object({
    id: workspaceIdSchema,
    name: z.string().min(1).max(256),
    lastOpenedAt: z.iso.datetime(),
    pinned: z.boolean(),
    available: z.boolean(),
  })
  .strict()

export type WorkspaceSummary = z.infer<typeof workspaceSummarySchema>

export const workspaceSnapshotSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    currentId: workspaceIdSchema.optional(),
    current: workspaceSummarySchema.optional(),
    recent: z.array(workspaceSummarySchema).max(100),
  })
  .strict()

export type WorkspaceSnapshot = z.infer<typeof workspaceSnapshotSchema>

export const workspaceChangedEventSchema = z
  .object({
    eventId: z.uuid(),
    snapshot: workspaceSnapshotSchema,
  })
  .strict()

export const workspaceSwitchResultSchema = z
  .object({
    snapshot: workspaceSnapshotSchema,
  })
  .strict()

export type WorkspaceSwitchResult = z.infer<typeof workspaceSwitchResultSchema>

export const workspaceChooseResultSchema = z.discriminatedUnion('cancelled', [
  z
    .object({
      cancelled: z.literal(true),
      snapshot: workspaceSnapshotSchema,
    })
    .strict(),
  z
    .object({
      cancelled: z.literal(false),
      snapshot: workspaceSnapshotSchema,
    })
    .strict(),
])

export type WorkspaceChooseResult = z.infer<typeof workspaceChooseResultSchema>

export const workspacePinnedResultSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    pinned: z.boolean(),
    snapshot: workspaceSnapshotSchema,
  })
  .strict()

export type WorkspacePinnedResult = z.infer<typeof workspacePinnedResultSchema>
