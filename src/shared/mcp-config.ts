import { z } from 'zod'

export const MCP_CONFIG_CONTENT_LIMIT = 1024 * 1024
export const MCP_CONFIG_SERVER_LIMIT = 500
export const MCP_CONFIG_DIAGNOSTIC_LIMIT = 2_000

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
    transport: z.enum(['stdio', 'http', 'socket', 'invalid']),
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
    exists: z.boolean(),
    content: z.string().max(MCP_CONFIG_CONTENT_LIMIT),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()

export type McpConfigSnapshot = z.infer<typeof mcpConfigSnapshotSchema>

export const mcpConfigSaveResultSchema = z
  .object({
    snapshot: mcpConfigSnapshotSchema,
    apply: z.enum(['saved', 'restarted', 'pending', 'unavailable', 'failed']),
    applyError: z.string().max(1_000).optional(),
  })
  .strict()

export type McpConfigSaveResult = z.infer<typeof mcpConfigSaveResultSchema>

export const mcpConfigRestartResultSchema = z
  .object({
    restarted: z.boolean(),
    error: z.string().max(1_000).optional(),
  })
  .strict()

export type McpConfigRestartResult = z.infer<
  typeof mcpConfigRestartResultSchema
>
