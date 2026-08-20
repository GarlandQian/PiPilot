import { z } from 'zod'

export const MODELS_CONFIG_CONTENT_LIMIT = 1024 * 1024
export const MODELS_CONFIG_PROVIDER_LIMIT = 500
export const MODELS_CONFIG_MODEL_LIMIT = 500
export const MODELS_CONFIG_DIAGNOSTIC_LIMIT = 2_000

/*
 * Credential boundary: the renderer-facing provider schema intentionally has
 * no `apiKey` field — only the `hasApiKey` presence flag. The main process
 * redacts the secret before anything crosses IPC, and a future leak of the
 * value through this DTO fails typecheck (design §2, PRD R5).
 */

export const modelsConfigTargetSchema = z
  .object({ kind: z.literal('global') })
  .strict()

export type ModelsConfigTarget = z.infer<typeof modelsConfigTargetSchema>

export const modelsConfigDiagnosticSchema = z
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

export type ModelsConfigDiagnostic = z.infer<typeof modelsConfigDiagnosticSchema>

export const modelsConfigCostSchema = z
  .object({
    input: z.number(),
    output: z.number(),
    cacheRead: z.number(),
    cacheWrite: z.number(),
    // Advanced passthrough: structured cost tiers stay JSON-only (decision X)
    // but must survive every form write, so the DTO carries them verbatim.
    tiers: z.array(z.unknown()).optional(),
  })
  .strict()

export type ModelsConfigCost = z.infer<typeof modelsConfigCostSchema>

export const modelsConfigModelSchema = z
  .object({
    id: z.string().min(1).max(256),
    name: z.string().max(512).optional(),
    api: z.string().max(128).optional(),
    baseUrl: z.string().max(2_048).optional(),
    reasoning: z.boolean().optional(),
    // Advanced passthrough fields — never form-structured (decision X).
    thinkingLevelMap: z.unknown().optional(),
    input: z.array(z.enum(['text', 'image'])).max(8).optional(),
    cost: modelsConfigCostSchema.optional(),
    contextWindow: z.number().optional(),
    maxTokens: z.number().optional(),
    headers: z.record(z.string(), z.unknown()).optional(),
    compat: z.unknown().optional(),
  })
  .strict()

export type ModelsConfigModel = z.infer<typeof modelsConfigModelSchema>

export const modelsConfigProviderSchema = z
  .object({
    id: z.string().min(1).max(128),
    name: z.string().max(512).optional(),
    baseUrl: z.string().max(2_048).optional(),
    api: z.string().max(128).optional(),
    hasApiKey: z.boolean(),
    // `oauth` is a JSON-only field; its presence makes the provider
    // structured-unsupported. Carried verbatim so the gate can see it.
    oauth: z.unknown().optional(),
    // Header values are `unknown` so the structured gate can reject non-string
    // values instead of silently dropping them (design §2).
    headers: z.record(z.string(), z.unknown()),
    compat: z.unknown().optional(),
    models: z.array(modelsConfigModelSchema).max(MODELS_CONFIG_MODEL_LIMIT),
    source: z.literal('custom'),
  })
  .strict()

export type ModelsConfigProvider = z.infer<typeof modelsConfigProviderSchema>

export const modelsConfigDocumentSchema = z
  .object({
    providers: z.array(modelsConfigProviderSchema).max(MODELS_CONFIG_PROVIDER_LIMIT),
    diagnostics: z.array(modelsConfigDiagnosticSchema).max(MODELS_CONFIG_DIAGNOSTIC_LIMIT),
    valid: z.boolean(),
  })
  .strict()

export type ModelsConfigDocument = z.infer<typeof modelsConfigDocumentSchema>

export const modelsConfigSnapshotSchema = modelsConfigDocumentSchema
  .extend({
    target: modelsConfigTargetSchema,
    path: z.string().min(1).max(16_384),
    exists: z.boolean(),
    // Raw JSONC text backing the Form|JSON single draft (same contract as MCP).
    content: z.string().max(MODELS_CONFIG_CONTENT_LIMIT),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    defaultProvider: z.string().max(256).optional(),
    defaultModel: z.string().max(256).optional(),
  })
  .strict()

export type ModelsConfigSnapshot = z.infer<typeof modelsConfigSnapshotSchema>

export const modelsConfigSaveResultSchema = z
  .object({
    snapshot: modelsConfigSnapshotSchema,
    apply: z.enum(['saved', 'restarted', 'pending', 'unavailable', 'failed']),
    applyError: z.string().max(1_000).optional(),
  })
  .strict()

export type ModelsConfigSaveResult = z.infer<typeof modelsConfigSaveResultSchema>

export const modelsConfigRestartResultSchema = z
  .object({
    restarted: z.boolean(),
    error: z.string().max(1_000).optional(),
  })
  .strict()

export type ModelsConfigRestartResult = z.infer<
  typeof modelsConfigRestartResultSchema
>

export const modelsConfigDefaultsSchema = z
  .object({
    defaultProvider: z.string().max(256).optional(),
    defaultModel: z.string().max(256).optional(),
  })
  .strict()

export type ModelsConfigDefaults = z.infer<typeof modelsConfigDefaultsSchema>

export const modelsConfigSetDefaultResultSchema = modelsConfigDefaultsSchema
  .extend({
    settingsUpdated: z.boolean(),
  })
  .strict()

export type ModelsConfigSetDefaultResult = z.infer<
  typeof modelsConfigSetDefaultResultSchema
>

export const modelsConfigTestResultSchema = z
  .object({
    providerId: z.string().min(1).max(256),
    modelId: z.string().min(1).max(256),
    latencyMs: z.number().int().nonnegative().max(10 * 60_000),
    responsePreview: z.string().max(512),
  })
  .strict()

export type ModelsConfigTestResult = z.infer<
  typeof modelsConfigTestResultSchema
>

/*
 * Structured-edit gates (design §2). A model/provider that carries JSON-only
 * passthrough fields stays fully editable in the JSON view but is never
 * offered the structured form, so the form can never drop what it cannot
 * represent.
 */

export function structuredModelSupported(model: ModelsConfigModel): boolean {
  return model.api === undefined &&
    model.baseUrl === undefined &&
    model.headers === undefined &&
    model.thinkingLevelMap === undefined &&
    model.compat === undefined &&
    model.cost?.tiers === undefined
}

export function structuredProviderSupported(provider: ModelsConfigProvider): boolean {
  if (provider.oauth !== undefined) return false
  if (!Object.values(provider.headers).every((value) => typeof value === 'string')) return false
  return provider.models.every(structuredModelSupported)
}

export function structuredDocumentSupported(document: ModelsConfigDocument): boolean {
  return document.valid && document.providers.every(structuredProviderSupported)
}
