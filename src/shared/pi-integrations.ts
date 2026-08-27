import { z } from 'zod'
import {
  MODELS_CONFIG_CONTENT_LIMIT,
  modelsConfigTestResultSchema,
} from './models-config'

export const PI_INTEGRATION_SOURCE_LIMIT = 2_048
export const PI_INTEGRATION_PATH_LIMIT = 16_384
export const PI_INTEGRATION_MESSAGE_LIMIT = 2_048
export const PI_INTEGRATION_PACKAGE_LIMIT = 500
export const PI_INTEGRATION_RESOURCE_LIMIT = 5_000
export const PI_INTEGRATION_UPDATE_LIMIT = 500
export const PI_INTEGRATION_DIAGNOSTIC_LIMIT = 500
export const PI_MANAGEMENT_PROTOCOL_VERSION = 1 as const

const boundedIdSchema = z.string().min(1).max(1_024)
const boundedPathSchema = z.string().min(1).max(PI_INTEGRATION_PATH_LIMIT)
const boundedSourceSchema = z.string().trim().min(1).max(PI_INTEGRATION_SOURCE_LIMIT)
const boundedMessageSchema = z.string().min(1).max(PI_INTEGRATION_MESSAGE_LIMIT)

export const piIntegrationScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('global') }).strict(),
  z.object({ kind: z.literal('project'), workspaceId: z.uuid() }).strict(),
])

export type PiIntegrationScope = z.infer<typeof piIntegrationScopeSchema>

export function piIntegrationScopeKey(scope: PiIntegrationScope) {
  return scope.kind === 'global' ? 'global' : `project:${scope.workspaceId}`
}

export const piResourceKindSchema = z.enum([
  'extension',
  'skill',
  'prompt',
  'theme',
])

export type PiResourceKind = z.infer<typeof piResourceKindSchema>

export const piCompatibilityLabelSchema = z.enum([
  'generic-rpc',
  'rich-adapter',
  'partial',
  'pi-tui-only',
  'not-observed',
])

export type PiCompatibilityLabel = z.infer<
  typeof piCompatibilityLabelSchema
>

export const piPackageScopeSchema = z.enum(['global', 'project'])
export type PiPackageScope = z.infer<typeof piPackageScopeSchema>

export const piPackageSourceTypeSchema = z.enum(['npm', 'git', 'local'])
export type PiPackageSourceType = z.infer<typeof piPackageSourceTypeSchema>

export const piResourceCountsSchema = z
  .object({
    extension: z.number().int().nonnegative().max(PI_INTEGRATION_RESOURCE_LIMIT),
    skill: z.number().int().nonnegative().max(PI_INTEGRATION_RESOURCE_LIMIT),
    prompt: z.number().int().nonnegative().max(PI_INTEGRATION_RESOURCE_LIMIT),
    theme: z.number().int().nonnegative().max(PI_INTEGRATION_RESOURCE_LIMIT),
  })
  .strict()

export type PiResourceCounts = z.infer<typeof piResourceCountsSchema>

export const piPackageSummarySchema = z
  .object({
    id: boundedIdSchema,
    source: boundedSourceSchema,
    sourceType: piPackageSourceTypeSchema,
    displayName: z.string().min(1).max(256),
    scope: piPackageScopeSchema,
    installedVersion: z.string().min(1).max(128).optional(),
    installedPath: boundedPathSchema.optional(),
    pinned: z.boolean(),
    filtered: z.boolean(),
    resourceCounts: piResourceCountsSchema,
    compatibility: piCompatibilityLabelSchema,
    updateAvailable: z.boolean(),
  })
  .strict()

export type PiPackageSummary = z.infer<typeof piPackageSummarySchema>

export const piResourceEffectiveStateSchema = z.enum([
  'enabled',
  'disabled',
  'inherited',
])

export type PiResourceEffectiveState = z.infer<
  typeof piResourceEffectiveStateSchema
>

export const piResourceSummarySchema = z
  .object({
    id: boundedIdSchema,
    packageId: boundedIdSchema.optional(),
    kind: piResourceKindSchema,
    label: z.string().min(1).max(256),
    description: z.string().max(2_048).optional(),
    path: boundedPathSchema,
    source: boundedSourceSchema,
    scope: piPackageScopeSchema,
    effectiveState: piResourceEffectiveStateSchema,
    invocation: z.string().min(1).max(256).optional(),
    diagnostic: z.string().max(PI_INTEGRATION_MESSAGE_LIMIT).optional(),
    compatibility: piCompatibilityLabelSchema,
  })
  .strict()

export type PiResourceSummary = z.infer<typeof piResourceSummarySchema>

export const piPackageUpdateSchema = z
  .object({
    source: boundedSourceSchema,
    displayName: z.string().min(1).max(256),
    type: z.enum(['npm', 'git']),
    scope: piPackageScopeSchema,
  })
  .strict()

export type PiPackageUpdate = z.infer<typeof piPackageUpdateSchema>

export const piRetryEffectiveSettingsSchema = z
  .object({
    enabled: z.boolean(),
    maxRetries: z.number().int().nonnegative().max(100),
    baseDelayMs: z.number().int().nonnegative().max(86_400_000),
  })
  .strict()

export type PiRetryEffectiveSettings = z.infer<typeof piRetryEffectiveSettingsSchema>

/**
 * Retry has two intentionally different sources of truth. Pi's public setter
 * always writes the global file, while getRetrySettings() is merged for the
 * current cwd and may include a project override.
 */
export const piRetrySettingsSchema = z
  .object({
    globalEnabled: z.boolean(),
    effective: piRetryEffectiveSettingsSchema,
  })
  .strict()

export type PiRetrySettings = z.infer<typeof piRetrySettingsSchema>

export const piIntegrationDiagnosticSchema = z
  .object({
    code: z.string().min(1).max(128),
    message: boundedMessageSchema,
    severity: z.enum(['info', 'warning', 'error']),
    source: boundedSourceSchema.optional(),
  })
  .strict()

export type PiIntegrationDiagnostic = z.infer<
  typeof piIntegrationDiagnosticSchema
>

/*
 * Pi-owned default-model settings as reported by the management helper. The
 * helper resolves the real Pi Agent paths and reads defaults through the
 * official SettingsManager; it never reads or returns apiKey values.
 */
export const piManagementModelsPayloadSchema = z
  .object({
    modelsPath: boundedPathSchema,
    settingsPath: boundedPathSchema,
    defaultProvider: z.string().min(1).max(256).optional(),
    defaultModel: z.string().min(1).max(256).optional(),
    settingsUpdated: z.boolean().optional(),
    test: modelsConfigTestResultSchema.optional(),
  })
  .strict()

export type PiManagementModelsPayload = z.infer<
  typeof piManagementModelsPayloadSchema
>

export const piManagementSnapshotPayloadSchema = z
  .object({
    packages: z.array(piPackageSummarySchema).max(PI_INTEGRATION_PACKAGE_LIMIT),
    resources: z.array(piResourceSummarySchema).max(PI_INTEGRATION_RESOURCE_LIMIT),
    updates: z.array(piPackageUpdateSchema).max(PI_INTEGRATION_UPDATE_LIMIT),
    retry: piRetrySettingsSchema,
    diagnostics: z
      .array(piIntegrationDiagnosticSchema)
      .max(PI_INTEGRATION_DIAGNOSTIC_LIMIT),
    // Present only when the helper answered a models settings command; the
    // remaining members are empty placeholders in that case.
    models: piManagementModelsPayloadSchema.optional(),
  })
  .strict()

export type PiManagementSnapshotPayload = z.infer<
  typeof piManagementSnapshotPayloadSchema
>

export const piIntegrationExecutableSchema = z
  .object({
    path: boundedPathSchema,
    version: z.string().min(1).max(128),
  })
  .strict()

export const piIntegrationSnapshotSchema = z
  .object({
    state: z.enum(['ready', 'unavailable']),
    generation: z.number().int().nonnegative(),
    executable: piIntegrationExecutableSchema.nullable(),
    scope: piIntegrationScopeSchema,
    packages: z.array(piPackageSummarySchema).max(PI_INTEGRATION_PACKAGE_LIMIT),
    resources: z.array(piResourceSummarySchema).max(PI_INTEGRATION_RESOURCE_LIMIT),
    updates: z.array(piPackageUpdateSchema).max(PI_INTEGRATION_UPDATE_LIMIT),
    retry: piRetrySettingsSchema.nullable(),
    restartRequired: z.boolean(),
    diagnostics: z
      .array(piIntegrationDiagnosticSchema)
      .max(PI_INTEGRATION_DIAGNOSTIC_LIMIT),
    checkedAt: z.number().int().nonnegative(),
  })
  .strict()

export type PiIntegrationSnapshot = z.infer<
  typeof piIntegrationSnapshotSchema
>

export const piManagementProgressSchema = z
  .object({
    type: z.enum(['start', 'progress', 'complete', 'error']),
    action: z.enum(['install', 'remove', 'update', 'clone', 'pull']),
    source: boundedSourceSchema,
    message: z.string().max(PI_INTEGRATION_MESSAGE_LIMIT).optional(),
  })
  .strict()

export type PiManagementProgress = z.infer<typeof piManagementProgressSchema>

export const piIntegrationOperationKindSchema = z.enum([
  'snapshot',
  'install',
  'update',
  'remove',
  'check-updates',
  'set-retry',
  'restart',
])

export type PiIntegrationOperationKind = z.infer<
  typeof piIntegrationOperationKindSchema
>

export const piIntegrationOperationSchema = z
  .object({
    operationId: z.uuid(),
    kind: piIntegrationOperationKindSchema,
    phase: z.enum(['queued', 'running', 'progress', 'succeeded', 'failed']),
    scope: piIntegrationScopeSchema,
    source: boundedSourceSchema.optional(),
    progress: piManagementProgressSchema.optional(),
    message: z.string().max(PI_INTEGRATION_MESSAGE_LIMIT).optional(),
    startedAt: z.number().int().nonnegative(),
    finishedAt: z.number().int().nonnegative().optional(),
  })
  .strict()

export type PiIntegrationOperation = z.infer<
  typeof piIntegrationOperationSchema
>

export const piIntegrationOperationEventSchema = z
  .object({
    eventId: z.uuid(),
    operation: piIntegrationOperationSchema,
  })
  .strict()

export type PiIntegrationOperationEvent = z.infer<
  typeof piIntegrationOperationEventSchema
>

export const piIntegrationOperationResultSchema = z
  .object({
    operationId: z.uuid(),
    snapshot: piIntegrationSnapshotSchema,
    runtimeSync: z
      .enum(['not-requested', 'synchronized', 'persisted-only'])
      .default('not-requested'),
    runtimeError: z.string().max(PI_INTEGRATION_MESSAGE_LIMIT).optional(),
  })
  .strict()

export type PiIntegrationOperationResult = z.infer<
  typeof piIntegrationOperationResultSchema
>

const piManagementHelperCommandBase = {
  protocolVersion: z.literal(PI_MANAGEMENT_PROTOCOL_VERSION),
  operationId: z.uuid(),
  cwd: boundedPathSchema,
  scope: piIntegrationScopeSchema,
}

export const piManagementHelperCommandSchema = z.discriminatedUnion('action', [
  z.object({
    ...piManagementHelperCommandBase,
    action: z.literal('snapshot'),
  }).strict(),
  z.object({
    ...piManagementHelperCommandBase,
    action: z.literal('check-updates'),
  }).strict(),
  z.object({
    ...piManagementHelperCommandBase,
    action: z.enum(['install', 'update', 'remove']),
    source: boundedSourceSchema,
  }).strict(),
  z.object({
    ...piManagementHelperCommandBase,
    action: z.literal('set-retry'),
    enabled: z.boolean(),
  }).strict(),
  z.object({
    ...piManagementHelperCommandBase,
    action: z.literal('models-defaults'),
  }).strict(),
  z.object({
    ...piManagementHelperCommandBase,
    action: z.literal('set-default-model'),
    providerId: z.string().min(1).max(256),
    modelId: z.string().min(1).max(256),
  }).strict(),
  z.object({
    ...piManagementHelperCommandBase,
    action: z.literal('test-model'),
    providerId: z.string().min(1).max(256),
    modelId: z.string().min(1).max(256),
    content: z.string().max(MODELS_CONFIG_CONTENT_LIMIT),
  }).strict(),
])

export type PiManagementHelperCommand = z.infer<
  typeof piManagementHelperCommandSchema
>

export const piManagementHelperErrorSchema = z
  .object({
    code: z.string().min(1).max(128),
    message: boundedMessageSchema,
    recoverable: z.boolean(),
  })
  .strict()

export type PiManagementHelperError = z.infer<
  typeof piManagementHelperErrorSchema
>

export const piManagementHelperEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('progress'),
    operationId: z.uuid(),
    progress: piManagementProgressSchema,
  }).strict(),
  z.object({
    type: z.literal('result'),
    operationId: z.uuid(),
    result: piManagementSnapshotPayloadSchema,
  }).strict(),
  z.object({
    type: z.literal('error'),
    operationId: z.uuid(),
    error: piManagementHelperErrorSchema,
  }).strict(),
])

export type PiManagementHelperEvent = z.infer<
  typeof piManagementHelperEventSchema
>
