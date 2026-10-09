import { z } from 'zod'
import { configApplyStatusSchema } from './config-apply'

export const MCP_CONFIG_CONTENT_LIMIT = 1024 * 1024
export const MCP_CONFIG_SERVER_LIMIT = 500
export const MCP_CONFIG_DIAGNOSTIC_LIMIT = 2_000
export const MCP_EXPOSURES = ['codemode', 'codemode-deferred', 'deferred', 'direct', 'hidden'] as const
export type McpExposure = typeof MCP_EXPOSURES[number]

export const mcpConfigTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('global') }).strict(),
  z.object({ kind: z.literal('project'), workspaceId: z.uuid() }).strict(),
])

export type McpConfigTarget = z.infer<typeof mcpConfigTargetSchema>

export const mcpConfigDiagnosticSchema = z
  .object({
    code: z.string().min(1).max(128),
    message: z.string().min(1).max(1_000),
    offset: z.number().int().nonnegative(),
    length: z.number().int().nonnegative(),
    line: z.number().int().positive(),
    column: z.number().int().positive(),
    path: z.string().max(1_024).optional(),
  })
  .strict()

export type McpConfigDiagnostic = z.infer<typeof mcpConfigDiagnosticSchema>

export const mcpConfigServerSchema = z
  .object({
    name: z.string().min(1).max(128),
    transport: z.enum(['stdio', 'http', 'override', 'socket', 'invalid']),
    definition: z.record(z.string(), z.unknown()),
  })
  .strict()

export type McpConfigServer = z.infer<typeof mcpConfigServerSchema>

export const mcpConfigDocumentSchema = z
  .object({
    servers: z.array(mcpConfigServerSchema).max(MCP_CONFIG_SERVER_LIMIT),
    diagnostics: z.array(mcpConfigDiagnosticSchema).max(MCP_CONFIG_DIAGNOSTIC_LIMIT),
    valid: z.boolean(),
  })
  .strict()

export type McpConfigDocument = z.infer<typeof mcpConfigDocumentSchema>

export const mcpConfigSnapshotSchema = mcpConfigDocumentSchema
  .extend({
    target: mcpConfigTargetSchema,
    path: z.string().min(1).max(16_384),
    displayPath: z.string().min(1).max(16_384).optional(),
    exists: z.boolean(),
    content: z.string().max(MCP_CONFIG_CONTENT_LIMIT),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    applyStatus: configApplyStatusSchema.optional(),
    legacy: z.object({
      path: z.string().min(1).max(16_384),
      content: z.string().max(MCP_CONFIG_CONTENT_LIMIT),
    }).strict().optional(),
    legacyUnavailablePath: z.string().min(1).max(16_384).optional(),
  })
  .strict()

export type McpConfigSnapshot = z.infer<typeof mcpConfigSnapshotSchema>

export const mcpConfigSaveResultSchema = z
  .object({
    snapshot: mcpConfigSnapshotSchema,
    apply: z.enum(['saved', 'applied', 'restarted', 'pending', 'unavailable', 'failed']),
    applyError: z.string().max(1_000).optional(),
  })
  .strict()

export type McpConfigSaveResult = z.infer<typeof mcpConfigSaveResultSchema>

export const mcpConfigRestartResultSchema = z
  .object({
    restarted: z.boolean(),
    applied: z.boolean().optional(),
    error: z.string().max(1_000).optional(),
  })
  .strict()

export type McpConfigRestartResult = z.infer<
  typeof mcpConfigRestartResultSchema
>

/** Apps whose MCP servers can be copied in, in the order they are listed. */
export const MCP_IMPORT_APPS = ['claude-code', 'claude-desktop', 'codex', 'cursor', 'gemini', 'vscode', 'windsurf'] as const
export type McpImportApp = typeof MCP_IMPORT_APPS[number]

const mcpImportNoteSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('sse') }).strict(),
  z.object({ kind: z.literal('dropped'), fields: z.array(z.string().max(128)).max(64) }).strict(),
  z.object({ kind: z.literal('input-variables') }).strict(),
  z.object({ kind: z.literal('renamed'), from: z.string().max(256) }).strict(),
])

export const mcpImportedServerSchema = z.object({
  name: z.string().min(1).max(128),
  definition: z.record(z.string(), z.unknown()),
  notes: z.array(mcpImportNoteSchema).max(16),
}).strict()

export const mcpImportSourcesResultSchema = z.object({
  sources: z.array(z.object({
    app: z.enum(MCP_IMPORT_APPS),
    path: z.string().min(1).max(16_384),
    servers: z.array(mcpImportedServerSchema).max(MCP_CONFIG_SERVER_LIMIT),
    error: z.enum(['too-large', 'unreadable']).optional(),
  }).strict()).max(32),
}).strict()

export type McpImportSourcesResult = z.infer<typeof mcpImportSourcesResultSchema>
