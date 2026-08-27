import { z } from 'zod'
import { workspaceIdSchema } from './schemas/workspace'

export const SESSION_CATALOG_MAX_CANDIDATES = 200
// Official Pi sessions routinely grow beyond the former 8 MiB metadata cap.
// Keep catalog reads bounded, but large enough that a normal long-running
// conversation remains discoverable and selectable.
export const SESSION_CATALOG_MAX_FILE_BYTES = 64 * 1_024 * 1_024
export const SESSION_CATALOG_MAX_REFRESH_BYTES = 256 * 1_024 * 1_024
export const SESSION_CATALOG_MAX_CONCURRENT_READERS = 8
export const SESSION_CATALOG_MAX_PAGE_ROWS = 50
export const SESSION_CATALOG_NAME_LIMIT = 256
export const SESSION_CATALOG_PREVIEW_LIMIT = 512

export const conversationScopeSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('project'),
      workspaceId: workspaceIdSchema,
    })
    .strict(),
  z.object({ kind: z.literal('projectless') }).strict(),
])

export type ConversationScope = z.infer<typeof conversationScopeSchema>

export const conversationNavigationSnapshotSchema = z
  .object({
    revision: z.number().int().positive(),
    activeScope: conversationScopeSchema,
  })
  .strict()

export type ConversationNavigationSnapshot = z.infer<
  typeof conversationNavigationSnapshotSchema
>

export const conversationNavigationChangedEventSchema = z
  .object({
    eventId: z.uuid(),
    snapshot: conversationNavigationSnapshotSchema,
  })
  .strict()

export type ConversationNavigationChangedEvent = z.infer<
  typeof conversationNavigationChangedEventSchema
>

export const sessionCatalogSelectionTokenSchema = z
  .string()
  .min(20)
  .max(128)
  .regex(/^sel_[A-Za-z0-9_-]+$/u)

export type SessionCatalogSelectionToken = z.infer<
  typeof sessionCatalogSelectionTokenSchema
>

export const sessionCatalogCursorSchema = z
  .string()
  .min(20)
  .max(128)
  .regex(/^cur_[A-Za-z0-9_-]+$/u)

export type SessionCatalogCursor = z.infer<typeof sessionCatalogCursorSchema>

export const sessionCatalogDiagnosticCodeSchema = z.enum([
  'candidateLimit',
  'changedDuringRead',
  'directoryUnavailable',
  'fileTooLarge',
  'malformed',
  'readFailed',
  'refreshByteLimit',
  'scopeMismatch',
  'unsafeCandidate',
  'unsupported',
])

export type SessionCatalogDiagnosticCode = z.infer<
  typeof sessionCatalogDiagnosticCodeSchema
>

export const sessionCatalogDiagnosticSchema = z
  .object({
    code: sessionCatalogDiagnosticCodeSchema,
    count: z.number().int().positive().max(SESSION_CATALOG_MAX_CANDIDATES + 1),
  })
  .strict()

export type SessionCatalogDiagnostic = z.infer<
  typeof sessionCatalogDiagnosticSchema
>

export const officialPiSessionSummarySchema = z
  .object({
    scope: conversationScopeSchema,
    sessionId: z.string().min(1).max(256),
    name: z.string().min(1).max(SESSION_CATALOG_NAME_LIMIT).optional(),
    preview: z.string().max(SESSION_CATALOG_PREVIEW_LIMIT),
    createdAt: z.iso.datetime(),
    modifiedAt: z.iso.datetime(),
    selectionToken: sessionCatalogSelectionTokenSchema,
  })
  .strict()

export type OfficialPiSessionSummary = z.infer<
  typeof officialPiSessionSummarySchema
>

const sessionCatalogResultFields = {
  scope: conversationScopeSchema,
  rows: z.array(officialPiSessionSummarySchema).max(SESSION_CATALOG_MAX_PAGE_ROWS),
  nextCursor: sessionCatalogCursorSchema.nullable(),
  diagnostics: z.array(sessionCatalogDiagnosticSchema).max(16),
}

export const sessionCatalogListResultSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('ready'),
      ...sessionCatalogResultFields,
    })
    .strict(),
  z
    .object({
      status: z.literal('notLoaded'),
      ...sessionCatalogResultFields,
    })
    .strict()
    .refine(
      (result) => result.rows.length === 0 && result.nextCursor === null,
      { message: 'An unloaded catalog cannot contain rows or a cursor.' },
    ),
  z
    .object({
      status: z.literal('activationUnavailable'),
      ...sessionCatalogResultFields,
    })
    .strict()
    .refine(
      (result) => result.rows.length === 0 && result.nextCursor === null,
      { message: 'An unavailable activation cannot contain rows or a cursor.' },
    ),
  z
    .object({
      status: z.literal('unavailable'),
      ...sessionCatalogResultFields,
    })
    .strict()
    .refine(
      (result) => result.rows.length === 0 && result.nextCursor === null,
      { message: 'An unavailable catalog cannot contain rows or a cursor.' },
    ),
])

export type SessionCatalogListResult = z.infer<
  typeof sessionCatalogListResultSchema
>

export const sessionCatalogDeleteResultSchema = z
  .object({
    scope: conversationScopeSchema,
    sessionId: z.string().min(1).max(256),
    activeDeleted: z.boolean(),
    disposition: z.enum(['trash', 'unlink']),
  })
  .strict()

export type SessionCatalogDeleteResult = z.infer<
  typeof sessionCatalogDeleteResultSchema
>

export const sessionCatalogRenameResultSchema = z
  .object({
    scope: conversationScopeSchema,
    sessionId: z.string().min(1).max(256),
    name: z.string().min(1).max(SESSION_CATALOG_NAME_LIMIT),
  })
  .strict()

export type SessionCatalogRenameResult = z.infer<
  typeof sessionCatalogRenameResultSchema
>

export const conversationActivationResultSchema = z
  .object({
    scope: conversationScopeSchema,
    sessionId: z.string().min(1).max(256),
    generation: z.number().int().positive(),
  })
  .strict()

export type ConversationActivationResult = z.infer<
  typeof conversationActivationResultSchema
>
