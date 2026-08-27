import { z } from 'zod'

export const WORKSPACE_DIRECTORY_ENTRY_LIMIT = 500
export const WORKSPACE_PATH_SEARCH_RESULT_LIMIT = 100
export const WORKSPACE_PREVIEW_BYTE_LIMIT = 512 * 1024
export const WORKSPACE_DIFF_FILE_LIMIT = 200
export const WORKSPACE_DIFF_PATCH_BYTE_LIMIT = 2 * 1024 * 1024

function isCanonicalWorkspacePath(value: string) {
  if (value === '.') return true
  if (
    value.startsWith('/') ||
    value.startsWith('\\') ||
    /^[a-zA-Z]:/.test(value) ||
    value.includes('\\') ||
    /[\u0000-\u001F\u007F`]/u.test(value)
  ) {
    return false
  }
  const parts = value.split('/')
  return parts.length > 0 && parts.every((part) => part.length > 0 && part !== '.' && part !== '..')
}

export const workspaceRelativePathSchema = z
  .string()
  .min(1)
  .max(4_096)
  .refine(isCanonicalWorkspacePath)

export type WorkspaceRelativePath = z.infer<typeof workspaceRelativePathSchema>

export const workspaceFileStatusSchema = z.enum(['modified', 'added', 'deleted'])
export type WorkspaceFileStatus = z.infer<typeof workspaceFileStatusSchema>

export const workspaceTreeEntrySchema = z
  .object({
    name: z.string().min(1).max(512),
    path: workspaceRelativePathSchema,
    type: z.enum(['file', 'dir']),
    status: workspaceFileStatusSchema.optional(),
    hasChildren: z.boolean().optional(),
  })
  .strict()

export type WorkspaceTreeEntry = z.infer<typeof workspaceTreeEntrySchema>

export const workspaceDirectorySnapshotSchema = z
  .object({
    workspaceId: z.uuid(),
    path: workspaceRelativePathSchema,
    entries: z.array(workspaceTreeEntrySchema).max(WORKSPACE_DIRECTORY_ENTRY_LIMIT),
    truncated: z.boolean(),
    modifiedCount: z.number().int().nonnegative().max(1_000_000),
    gitAvailable: z.boolean(),
  })
  .strict()

export type WorkspaceDirectorySnapshot = z.infer<
  typeof workspaceDirectorySnapshotSchema
>

export const workspacePathSearchEntrySchema = z
  .object({
    name: z.string().min(1).max(512),
    path: workspaceRelativePathSchema,
    type: z.enum(['file', 'dir']),
  })
  .strict()

export type WorkspacePathSearchEntry = z.infer<
  typeof workspacePathSearchEntrySchema
>

export const workspacePathSearchResultSchema = z
  .object({
    workspaceId: z.uuid(),
    query: z.string().max(512),
    entries: z
      .array(workspacePathSearchEntrySchema)
      .max(WORKSPACE_PATH_SEARCH_RESULT_LIMIT),
    truncated: z.boolean(),
  })
  .strict()

export type WorkspacePathSearchResult = z.infer<
  typeof workspacePathSearchResultSchema
>

const fileFingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/)

const workspacePreviewFields = {
  workspaceId: z.uuid(),
  path: workspaceRelativePathSchema,
  size: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  fingerprint: fileFingerprintSchema,
}

export const workspaceFilePreviewSchema = z.discriminatedUnion('kind', [
  z
    .object({
      ...workspacePreviewFields,
      kind: z.literal('text'),
      content: z.string().max(WORKSPACE_PREVIEW_BYTE_LIMIT),
    })
    .strict(),
  z
    .object({
      ...workspacePreviewFields,
      kind: z.literal('binary'),
    })
    .strict(),
  z
    .object({
      ...workspacePreviewFields,
      kind: z.literal('too-large'),
      limit: z.literal(WORKSPACE_PREVIEW_BYTE_LIMIT),
    })
    .strict(),
])

export type WorkspaceFilePreview = z.infer<typeof workspaceFilePreviewSchema>

export const workspaceChangeSummarySchema = z
  .object({
    path: workspaceRelativePathSchema,
    previousPath: workspaceRelativePathSchema.optional(),
    status: workspaceFileStatusSchema,
    added: z.number().int().nonnegative().max(10_000_000),
    deleted: z.number().int().nonnegative().max(10_000_000),
    binary: z.boolean(),
  })
  .strict()

export type WorkspaceChangeSummary = z.infer<
  typeof workspaceChangeSummarySchema
>

export const workspaceDiffSnapshotSchema = z
  .object({
    workspaceId: z.uuid(),
    gitAvailable: z.boolean(),
    branch: z.string().max(512),
    files: z.array(workspaceChangeSummarySchema).max(WORKSPACE_DIFF_FILE_LIMIT),
    truncated: z.boolean(),
  })
  .strict()

export type WorkspaceDiffSnapshot = z.infer<typeof workspaceDiffSnapshotSchema>

export const workspaceDiffFileSchema = workspaceChangeSummarySchema
  .extend({
    workspaceId: z.uuid(),
    patch: z.string().max(WORKSPACE_DIFF_PATCH_BYTE_LIMIT),
    truncated: z.boolean(),
  })
  .strict()

export type WorkspaceDiffFile = z.infer<typeof workspaceDiffFileSchema>
