import { z } from 'zod'

export const WORKSPACE_DIRECTORY_ENTRY_LIMIT = 500
export const WORKSPACE_PATH_SEARCH_RESULT_LIMIT = 100
export const WORKSPACE_PREVIEW_BYTE_LIMIT = 512 * 1024
export const WORKSPACE_DIFF_FILE_LIMIT = 200
export const WORKSPACE_DIFF_PATCH_BYTE_LIMIT = 2 * 1024 * 1024
/** Images and PDFs the file tab shows as themselves. */
export const WORKSPACE_MEDIA_BYTE_LIMIT = 32 * 1024 * 1024
/** Either side of a file, for expanding unchanged lines in a diff. */
export const WORKSPACE_DIFF_SIDE_BYTE_LIMIT = 1024 * 1024
export const WORKSPACE_COMMIT_LIST_LIMIT = 50
export const WORKSPACE_EXISTS_PATH_LIMIT = 64

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

/**
 * `branch` compares the working tree with where this branch left the default
 * branch; `commit` is one commit against its parent.
 */
export const workspaceChangeStageSchema = z.enum(['staged', 'unstaged', 'branch', 'commit'])
export type WorkspaceChangeStage = z.infer<typeof workspaceChangeStageSchema>
/** Stages Git can stage, unstage or discard. */
export const workspaceWorkingStageSchema = z.enum(['staged', 'unstaged'])
export type WorkspaceWorkingStage = z.infer<typeof workspaceWorkingStageSchema>

export function workspaceChangeId(path: string, stage: WorkspaceChangeStage) {
  return `${stage}:${path}`
}

export const workspaceChangeSummarySchema = z
  .object({
    id: z.string().min(1).max(4_105),
    stage: workspaceChangeStageSchema,
    revision: fileFingerprintSchema,
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

/** The branch's changes since it left the default branch; `base` names that branch. */
export const workspaceBranchDiffSnapshotSchema = workspaceDiffSnapshotSchema.extend({ base: z.string().max(512) }).strict()
export type WorkspaceBranchDiffSnapshot = z.infer<typeof workspaceBranchDiffSnapshotSchema>

export const workspaceDiffFileSchema = workspaceChangeSummarySchema
  .extend({
    workspaceId: z.uuid(),
    patch: z.string().max(WORKSPACE_DIFF_PATCH_BYTE_LIMIT),
    truncated: z.boolean(),
  })
  .strict()

export type WorkspaceDiffFile = z.infer<typeof workspaceDiffFileSchema>

export const WORKSPACE_MEDIA_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
} as const
export type WorkspaceMediaType = (typeof WORKSPACE_MEDIA_TYPES)[keyof typeof WORKSPACE_MEDIA_TYPES]

/** The media type a file tab can show for this path, if any. */
export function workspaceMediaType(path: string): WorkspaceMediaType | undefined {
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase()
  const dot = name.lastIndexOf('.')
  return dot > 0 ? WORKSPACE_MEDIA_TYPES[name.slice(dot) as keyof typeof WORKSPACE_MEDIA_TYPES] : undefined
}

export const workspaceFileMediaSchema = z
  .object({
    workspaceId: z.uuid(),
    path: workspaceRelativePathSchema,
    mime: z.enum(Object.values(WORKSPACE_MEDIA_TYPES) as [WorkspaceMediaType, ...WorkspaceMediaType[]]),
    size: z.number().int().nonnegative().max(WORKSPACE_MEDIA_BYTE_LIMIT),
    fingerprint: fileFingerprintSchema,
    data: z.instanceof(Uint8Array),
  })
  .strict()
export type WorkspaceFileMedia = z.infer<typeof workspaceFileMediaSchema>

/** Which of the asked-for paths are still files (for restoring file tabs). */
export const workspaceExistingFilesSchema = z
  .object({ workspaceId: z.uuid(), paths: z.array(workspaceRelativePathSchema).max(WORKSPACE_EXISTS_PATH_LIMIT) })
  .strict()
export type WorkspaceExistingFiles = z.infer<typeof workspaceExistingFilesSchema>

export const workspaceCommitShaSchema = z.string().regex(/^[0-9a-f]{40,64}$/u)
export const workspaceCommitSummarySchema = z
  .object({
    sha: workspaceCommitShaSchema,
    subject: z.string().max(1_024),
    author: z.string().max(256),
    date: z.string().max(64),
  })
  .strict()
export type WorkspaceCommitSummary = z.infer<typeof workspaceCommitSummarySchema>
export const workspaceCommitListSchema = z
  .object({ workspaceId: z.uuid(), gitAvailable: z.boolean(), commits: z.array(workspaceCommitSummarySchema).max(WORKSPACE_COMMIT_LIST_LIMIT) })
  .strict()
export type WorkspaceCommitList = z.infer<typeof workspaceCommitListSchema>
/** One commit's files against its parent. */
export const workspaceCommitDiffSnapshotSchema = workspaceDiffSnapshotSchema.extend({ commit: workspaceCommitShaSchema }).strict()
export type WorkspaceCommitDiffSnapshot = z.infer<typeof workspaceCommitDiffSnapshotSchema>

const diffSideSchema = z.object({ name: z.string().max(4_096), contents: z.string().max(WORKSPACE_DIFF_SIDE_BYTE_LIMIT) }).strict()
/** Both sides of a reviewed file, so a diff can show the lines around a hunk. */
export const workspaceDiffSidesSchema = z
  .object({ workspaceId: z.uuid(), path: workspaceRelativePathSchema, oldFile: diffSideSchema.nullable(), newFile: diffSideSchema.nullable() })
  .strict()
export type WorkspaceDiffSides = z.infer<typeof workspaceDiffSidesSchema>

/** Where the branch stands, for the summary and the commit menu. */
export const workspaceGitStatusSchema = z
  .object({
    workspaceId: z.uuid(),
    gitAvailable: z.boolean(),
    branch: z.string().max(512),
    detached: z.boolean(),
    /** The default branch this one would merge into (main, master, origin's HEAD). */
    base: z.string().max(512),
    onDefaultBranch: z.boolean(),
    upstream: z.string().max(512),
    ahead: z.number().int().nonnegative(),
    behind: z.number().int().nonnegative(),
    hasRemote: z.boolean(),
    hasCommits: z.boolean(),
    staged: z.number().int().nonnegative(),
    unstaged: z.number().int().nonnegative(),
    /** GitHub CLI is installed, so a pull request can be created. */
    ghAvailable: z.boolean(),
  })
  .strict()
export type WorkspaceGitStatus = z.infer<typeof workspaceGitStatusSchema>

export const workspaceCommitRequestSchema = z
  .object({
    message: z.string().trim().min(1).max(20_000),
    includeUnstaged: z.boolean(),
    next: z.enum(['commit', 'push', 'pull-request']),
    /** A new branch to commit on (Codex creates one before a pull request from the default branch). */
    branch: z.string().min(1).max(200).regex(/^(?!-)(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9._/-]+(?<![./])$/u).optional(),
  })
  .strict()
export type WorkspaceCommitRequest = z.infer<typeof workspaceCommitRequestSchema>
export const workspaceCommitResultSchema = z
  .object({
    workspaceId: z.uuid(),
    sha: workspaceCommitShaSchema,
    branch: z.string().max(512),
    pushed: z.boolean(),
    pullRequestUrl: z.string().url().max(2_048).optional(),
    /** The commit landed; what Git or GitHub said when the next step failed. */
    pushError: z.string().max(2_000).optional(),
    pullRequestError: z.string().max(2_000).optional(),
  })
  .strict()
export type WorkspaceCommitResult = z.infer<typeof workspaceCommitResultSchema>
