import { z } from 'zod'
import {
  conversationScopeSchema,
  sessionCatalogSelectionTokenSchema,
} from './conversation-scope'

export const SUPPORTED_PI_VERSION = '0.84.2' as const
export const LOCAL_PI_RUNTIME_EVENT_PROJECTION_FAILED_CODE =
  'RUNTIME_EVENT_PROJECTION_FAILED' as const


export const localPiRuntimeStateSchema = z.enum([
  'stopped',
  'starting',
  'ready',
  'replacing',
  'crashed',
  'error',
])

/**
 * Renderer-safe lifecycle projection for every Runtime retained by the
 * Main-owned Pi runtime pool. This intentionally carries the conversation
 * scope and session identity only; filesystem paths stay in Main.
 */
export const localPiRuntimeSessionStatusSchema = z
  .object({
    scope: conversationScopeSchema,
    sessionId: z.string().min(1).max(256),
    selectionToken: sessionCatalogSelectionTokenSchema.optional(),
    status: z.enum(['running', 'completed', 'failed']),
  })
  .strict()

export type LocalPiRuntimeSessionStatus = z.infer<
  typeof localPiRuntimeSessionStatusSchema
>

export const LOCAL_PI_RUNTIME_SESSION_STATUS_MAX_ITEMS = 4_096

export const localPiDiagnosticSchema = z
  .object({
    code: z.string().min(1).max(128),
    message: z.string().min(1).max(2_048),
    timestamp: z.number().int().nonnegative(),
  })
  .strict()

export type LocalPiDiagnostic = z.infer<typeof localPiDiagnosticSchema>

export const localPiThinkingLevelSchema = z.enum([
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
])

export type LocalPiThinkingLevel = z.infer<typeof localPiThinkingLevelSchema>

export const localPiQueueModeSchema = z.enum(['all', 'one-at-a-time'])

export type LocalPiQueueMode = z.infer<typeof localPiQueueModeSchema>

export const localPiTextContentSchema = z
  .object({
    type: z.literal('text'),
    text: z.string(),
    textSignature: z.string().optional(),
  })
  .strict()

export type LocalPiTextContent = z.infer<typeof localPiTextContentSchema>

export const localPiThinkingContentSchema = z
  .object({
    type: z.literal('thinking'),
    thinking: z.string(),
    thinkingSignature: z.string().optional(),
    redacted: z.boolean().optional(),
  })
  .strict()

export type LocalPiThinkingContent = z.infer<
  typeof localPiThinkingContentSchema
>

export const localPiImageContentSchema = z
  .object({
    type: z.literal('image'),
    data: z.string(),
    mimeType: z.string().min(1),
  })
  .strict()

export type LocalPiImageContent = z.infer<typeof localPiImageContentSchema>

export const localPiQueuedMessagePayloadSchema = z
  .object({
    message: z.string().min(1),
    images: z.array(localPiImageContentSchema).optional(),
  })
  .strict()

export type LocalPiQueuedMessagePayload = z.infer<
  typeof localPiQueuedMessagePayloadSchema
>

export const localPiToolCallSchema = z
  .object({
    type: z.literal('toolCall'),
    id: z.string().min(1),
    name: z.string().min(1),
    arguments: z.record(z.string(), z.unknown()),
    thoughtSignature: z.string().optional(),
  })
  .strict()

export type LocalPiToolCall = z.infer<typeof localPiToolCallSchema>

export const localPiUsageSchema = z
  .object({
    input: z.number().int().nonnegative(),
    output: z.number().int().nonnegative(),
    cacheRead: z.number().int().nonnegative(),
    cacheWrite: z.number().int().nonnegative(),
    cacheWrite1h: z.number().int().nonnegative().optional(),
    reasoning: z.number().int().nonnegative().optional(),
    totalTokens: z.number().int().nonnegative(),
    cost: z
      .object({
        input: z.number().nonnegative(),
        output: z.number().nonnegative(),
        cacheRead: z.number().nonnegative(),
        cacheWrite: z.number().nonnegative(),
        total: z.number().nonnegative(),
      })
      .strict(),
  })
  .strict()

export type LocalPiUsage = z.infer<typeof localPiUsageSchema>

const localPiAssistantDiagnosticSchema = z
  .object({
    type: z.string(),
    timestamp: z.number().int().nonnegative(),
    error: z
      .object({
        name: z.string().optional(),
        message: z.string(),
        stack: z.string().optional(),
        code: z.union([z.string(), z.number()]).optional(),
      })
      .strict()
      .optional(),
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()

const localPiDeferredHandleSchema = z
  .object({
    provider: z.string().min(1),
    modelId: z.string().min(1),
    api: z.string().min(1),
    id: z.string().min(1),
    expiresAt: z.number().optional(),
    pollAfterMs: z.number().nonnegative().optional(),
    data: z.unknown().optional(),
  })
  .strict()

export const localPiUserMessageSchema = z
  .object({
    role: z.literal('user'),
    content: z.union([
      z.string(),
      z.array(z.union([localPiTextContentSchema, localPiImageContentSchema])),
    ]),
    timestamp: z.number().int().nonnegative(),
  })
  .strict()

export const localPiAssistantMessageSchema = z
  .object({
    role: z.literal('assistant'),
    content: z.array(z.union([
      localPiTextContentSchema,
      localPiThinkingContentSchema,
      localPiToolCallSchema,
    ])),
    api: z.string().min(1),
    provider: z.string().min(1),
    model: z.string().min(1),
    responseModel: z.string().optional(),
    responseId: z.string().optional(),
    diagnostics: z.array(localPiAssistantDiagnosticSchema).optional(),
    usage: localPiUsageSchema,
    stopReason: z.enum([
      'pending',
      'stop',
      'length',
      'toolUse',
      'error',
      'aborted',
      'deferred',
    ]),
    deferred: localPiDeferredHandleSchema.optional(),
    errorMessage: z.string().optional(),
    rawStopReason: z.string().optional(),
    timestamp: z.number().int().nonnegative(),
  })
  .strict()

export const localPiToolResultMessageSchema = z
  .object({
    role: z.literal('toolResult'),
    toolCallId: z.string().min(1),
    toolName: z.string().min(1),
    content: z.array(z.union([localPiTextContentSchema, localPiImageContentSchema])),
    details: z.unknown().optional(),
    usage: localPiUsageSchema.optional(),
    addedToolNames: z.array(z.string()).optional(),
    isError: z.boolean(),
    timestamp: z.number().int().nonnegative(),
  })
  .strict()

export const localPiBashExecutionMessageSchema = z
  .object({
    role: z.literal('bashExecution'),
    command: z.string(),
    output: z.string(),
    exitCode: z.number().int().optional(),
    cancelled: z.boolean(),
    truncated: z.boolean(),
    fullOutputPath: z.string().optional(),
    timestamp: z.number().int().nonnegative(),
    excludeFromContext: z.boolean().optional(),
  })
  .strict()

export const localPiCustomMessageSchema = z
  .object({
    role: z.literal('custom'),
    customType: z.string().min(1),
    content: z.union([
      z.string(),
      z.array(z.union([localPiTextContentSchema, localPiImageContentSchema])),
    ]),
    display: z.boolean(),
    details: z.unknown().optional(),
    timestamp: z.number().int().nonnegative(),
  })
  .strict()

export const localPiBranchSummaryMessageSchema = z
  .object({
    role: z.literal('branchSummary'),
    summary: z.string(),
    fromId: z.string().min(1),
    timestamp: z.number().int().nonnegative(),
  })
  .strict()

export const localPiCompactionSummaryMessageSchema = z
  .object({
    role: z.literal('compactionSummary'),
    summary: z.string(),
    tokensBefore: z.number().int().nonnegative(),
    timestamp: z.number().int().nonnegative(),
  })
  .strict()

export const localPiAgentMessageSchema = z.discriminatedUnion('role', [
  localPiUserMessageSchema,
  localPiAssistantMessageSchema,
  localPiToolResultMessageSchema,
  localPiBashExecutionMessageSchema,
  localPiCustomMessageSchema,
  localPiBranchSummaryMessageSchema,
  localPiCompactionSummaryMessageSchema,
])

export type LocalPiAgentMessage = z.infer<typeof localPiAgentMessageSchema>
export type LocalPiUserMessage = Extract<LocalPiAgentMessage, { role: 'user' }>
export type LocalPiAssistantMessage = Extract<
  LocalPiAgentMessage,
  { role: 'assistant' }
>
export type LocalPiToolResultMessage = Extract<
  LocalPiAgentMessage,
  { role: 'toolResult' }
>

export const localPiModelSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    api: z.string().min(1),
    provider: z.string().min(1),
    baseUrl: z.string(),
    reasoning: z.boolean(),
    thinkingLevelMap: z
      .object({
        off: z.string().nullable().optional(),
        minimal: z.string().nullable().optional(),
        low: z.string().nullable().optional(),
        medium: z.string().nullable().optional(),
        high: z.string().nullable().optional(),
        xhigh: z.string().nullable().optional(),
        max: z.string().nullable().optional(),
      })
      .strict()
      .optional(),
    input: z.array(z.enum(['text', 'image'])),
    cost: z
      .object({
        input: z.number().nonnegative(),
        output: z.number().nonnegative(),
        cacheRead: z.number().nonnegative(),
        cacheWrite: z.number().nonnegative(),
        tiers: z
          .array(z
            .object({
              input: z.number().nonnegative(),
              output: z.number().nonnegative(),
              cacheRead: z.number().nonnegative(),
              cacheWrite: z.number().nonnegative(),
              inputTokensAbove: z.number().int().nonnegative(),
            })
            .strict())
          .optional(),
      })
      .strict(),
    contextWindow: z.number(),
    maxTokens: z.number(),
    samplingParams: z.record(z.string(), z.unknown()).optional(),
    headers: z.record(z.string(), z.string()).optional(),
    compat: z.unknown().optional(),
  })
  .strict()

export type LocalPiModel = z.infer<typeof localPiModelSchema>

export const localPiSessionStatsSchema = z
  .object({
    sessionFile: z.string().optional(),
    sessionId: z.string().min(1),
    userMessages: z.number().int().nonnegative(),
    assistantMessages: z.number().int().nonnegative(),
    toolCalls: z.number().int().nonnegative(),
    toolResults: z.number().int().nonnegative(),
    totalMessages: z.number().int().nonnegative(),
    tokens: z
      .object({
        input: z.number().int().nonnegative(),
        output: z.number().int().nonnegative(),
        cacheRead: z.number().int().nonnegative(),
        cacheWrite: z.number().int().nonnegative(),
        total: z.number().int().nonnegative(),
      })
      .strict(),
    cost: z.number().nonnegative(),
    contextUsage: z
      .object({
        tokens: z.number().int().nonnegative().nullable(),
        contextWindow: z.number().int().positive(),
        percent: z.number().nonnegative().nullable(),
      })
      .strict()
      .optional(),
  })
  .strict()

export type LocalPiSessionStats = z.infer<typeof localPiSessionStatsSchema>

export const localPiSessionStateSchema = z
  .object({
    model: localPiModelSchema.optional(),
    thinkingLevel: localPiThinkingLevelSchema,
    isStreaming: z.boolean(),
    isCompacting: z.boolean(),
    steeringMode: localPiQueueModeSchema,
    followUpMode: localPiQueueModeSchema,
    sessionFile: z.string().optional(),
    sessionId: z.string().min(1),
    sessionName: z.string().optional(),
    autoCompactionEnabled: z.boolean(),
    messageCount: z.number().int().nonnegative(),
    pendingMessageCount: z.number().int().nonnegative(),
  })
  .strict()

export type LocalPiSessionState = z.infer<typeof localPiSessionStateSchema>

export const localPiSourceInfoSchema = z
  .object({
    path: z.string(),
    source: z.string(),
    scope: z.enum(['user', 'project', 'temporary']),
    origin: z.enum(['package', 'top-level']),
    baseDir: z.string().optional(),
  })
  .strict()

export type LocalPiSourceInfo = z.infer<typeof localPiSourceInfoSchema>

export const localPiSlashCommandSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    source: z.enum(['extension', 'prompt', 'skill']),
    sourceInfo: localPiSourceInfoSchema,
    hasArgumentCompletions: z.boolean().optional(),
  })
  .strict()

export type LocalPiSlashCommand = z.infer<typeof localPiSlashCommandSchema>

export const LOCAL_PI_COMMAND_NAME_MAX_LENGTH = 256
export const LOCAL_PI_COMMAND_ARGUMENT_PREFIX_MAX_LENGTH = 4_096
export const LOCAL_PI_COMMAND_ARGUMENT_COMPLETION_MAX_ITEMS = 100
export const LOCAL_PI_COMMAND_ARGUMENT_COMPLETION_VALUE_MAX_LENGTH = 4_096
export const LOCAL_PI_COMMAND_ARGUMENT_COMPLETION_LABEL_MAX_LENGTH = 512
export const LOCAL_PI_COMMAND_ARGUMENT_COMPLETION_DESCRIPTION_MAX_LENGTH = 2_048

export const localPiCommandArgumentCompletionSchema = z
  .object({
    value: z.string().min(1).max(LOCAL_PI_COMMAND_ARGUMENT_COMPLETION_VALUE_MAX_LENGTH),
    label: z.string().min(1).max(LOCAL_PI_COMMAND_ARGUMENT_COMPLETION_LABEL_MAX_LENGTH),
    description: z.string()
      .max(LOCAL_PI_COMMAND_ARGUMENT_COMPLETION_DESCRIPTION_MAX_LENGTH)
      .optional(),
  })
  .strict()

export type LocalPiCommandArgumentCompletion = z.infer<
  typeof localPiCommandArgumentCompletionSchema
>

export const localPiCommandArgumentCompletionsResponseDataSchema = z
  .object({
    items: z.array(localPiCommandArgumentCompletionSchema)
      .max(LOCAL_PI_COMMAND_ARGUMENT_COMPLETION_MAX_ITEMS),
  })
  .strict()

export const localPiRpcCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('prompt'), message: z.string(), images: z.array(localPiImageContentSchema).optional(), streamingBehavior: z.enum(['steer', 'followUp']).optional() }).strict(),
  z.object({ type: z.literal('steer'), message: z.string(), images: z.array(localPiImageContentSchema).optional() }).strict(),
  z.object({ type: z.literal('follow_up'), message: z.string(), images: z.array(localPiImageContentSchema).optional() }).strict(),
  z.object({ type: z.literal('abort') }).strict(),
  z.object({ type: z.literal('new_session'), parentSession: z.string().optional() }).strict(),
  z.object({ type: z.literal('get_state') }).strict(),
  z.object({ type: z.literal('set_model'), provider: z.string(), modelId: z.string() }).strict(),
  z.object({ type: z.literal('cycle_model') }).strict(),
  z.object({ type: z.literal('get_available_models') }).strict(),
  z.object({ type: z.literal('set_thinking_level'), level: localPiThinkingLevelSchema }).strict(),
  z.object({ type: z.literal('cycle_thinking_level') }).strict(),
  z.object({ type: z.literal('get_available_thinking_levels') }).strict(),
  z.object({ type: z.literal('set_steering_mode'), mode: z.enum(['all', 'one-at-a-time']) }).strict(),
  z.object({ type: z.literal('set_follow_up_mode'), mode: z.enum(['all', 'one-at-a-time']) }).strict(),
  z.object({
    type: z.literal('promote_follow_up'),
    followUpIndex: z.number().int().nonnegative(),
    steering: z.array(localPiQueuedMessagePayloadSchema),
    followUp: z.array(localPiQueuedMessagePayloadSchema),
  }).strict(),
  z.object({ type: z.literal('compact'), customInstructions: z.string().optional() }).strict(),
  z.object({ type: z.literal('set_auto_compaction'), enabled: z.boolean() }).strict(),
  z.object({ type: z.literal('set_auto_retry'), enabled: z.boolean() }).strict(),
  z.object({ type: z.literal('abort_retry') }).strict(),
  z.object({ type: z.literal('bash'), command: z.string(), excludeFromContext: z.boolean().optional() }).strict(),
  z.object({ type: z.literal('abort_bash') }).strict(),
  z.object({ type: z.literal('get_session_stats') }).strict(),
  z.object({ type: z.literal('export_html'), outputPath: z.string().optional() }).strict(),
  z.object({ type: z.literal('switch_session'), sessionPath: z.string() }).strict(),
  z.object({ type: z.literal('fork'), entryId: z.string() }).strict(),
  z.object({ type: z.literal('clone') }).strict(),
  z.object({ type: z.literal('get_fork_messages') }).strict(),
  z.object({ type: z.literal('get_entries'), since: z.string().optional() }).strict(),
  z.object({ type: z.literal('get_tree') }).strict(),
  z.object({ type: z.literal('get_last_assistant_text') }).strict(),
  z.object({ type: z.literal('set_session_name'), name: z.string() }).strict(),
  z.object({ type: z.literal('get_messages') }).strict(),
  z.object({ type: z.literal('get_commands') }).strict(),
  z.object({
    type: z.literal('get_command_argument_completions'),
    commandName: z.string()
      .min(1)
      .max(LOCAL_PI_COMMAND_NAME_MAX_LENGTH)
      .refine((value) => !/^\//u.test(value) && !/\s/u.test(value), {
        message: 'Command name must not include a leading slash or whitespace.',
      }),
    argumentPrefix: z.string().max(LOCAL_PI_COMMAND_ARGUMENT_PREFIX_MAX_LENGTH),
  }).strict(),
])

export type LocalPiRpcCommand = z.infer<typeof localPiRpcCommandSchema>
export type LocalPiRpcCommandType = LocalPiRpcCommand['type']
export type LocalPiRendererRpcCommand = Exclude<
  LocalPiRpcCommand,
  { type: 'switch_session' }
>

export const localPiRendererRpcCommandSchema = localPiRpcCommandSchema.refine(
  (command) => command.type !== 'switch_session',
  { message: 'Session paths are resolved by the main-process catalog.' },
)

export const localPiCompactionResultSchema = z
  .object({
    summary: z.string(),
    firstKeptEntryId: z.string().min(1),
    tokensBefore: z.number().int().nonnegative(),
    estimatedTokensAfter: z.number().int().nonnegative().optional(),
    usage: localPiUsageSchema.optional(),
    details: z.unknown().optional(),
  })
  .strict()

export type LocalPiCompactionResult = z.infer<
  typeof localPiCompactionResultSchema
>

export const localPiToolResultSchema = z
  .object({
    content: z.array(z.union([localPiTextContentSchema, localPiImageContentSchema])),
    details: z.unknown().optional(),
    usage: localPiUsageSchema.optional(),
    addedToolNames: z.array(z.string()).optional(),
    terminate: z.boolean().optional(),
  })
  .strict()

export type LocalPiToolResult = z.infer<typeof localPiToolResultSchema>

export const localPiBashResultSchema = z
  .object({
    output: z.string(),
    exitCode: z.number().int().optional(),
    cancelled: z.boolean(),
    truncated: z.boolean(),
    fullOutputPath: z.string().optional(),
  })
  .strict()

export type LocalPiBashResult = z.infer<typeof localPiBashResultSchema>

const localPiSessionEntryBase = {
  id: z.string().min(1),
  parentId: z.string().nullable(),
  timestamp: z.string(),
}

export const localPiSessionEntrySchema = z.discriminatedUnion('type', [
  z.object({ ...localPiSessionEntryBase, type: z.literal('message'), message: localPiAgentMessageSchema }).strict(),
  z.object({ ...localPiSessionEntryBase, type: z.literal('thinking_level_change'), thinkingLevel: z.string() }).strict(),
  z.object({ ...localPiSessionEntryBase, type: z.literal('model_change'), provider: z.string(), modelId: z.string() }).strict(),
  z.object({ ...localPiSessionEntryBase, type: z.literal('compaction'), summary: z.string(), firstKeptEntryId: z.string(), tokensBefore: z.number().int().nonnegative(), details: z.unknown().optional(), usage: localPiUsageSchema.optional(), fromHook: z.boolean().optional() }).strict(),
  z.object({ ...localPiSessionEntryBase, type: z.literal('branch_summary'), fromId: z.string(), summary: z.string(), details: z.unknown().optional(), usage: localPiUsageSchema.optional(), fromHook: z.boolean().optional() }).strict(),
  z.object({ ...localPiSessionEntryBase, type: z.literal('custom'), customType: z.string(), data: z.unknown().optional() }).strict(),
  z.object({ ...localPiSessionEntryBase, type: z.literal('custom_message'), customType: z.string(), content: z.union([z.string(), z.array(z.union([localPiTextContentSchema, localPiImageContentSchema]))]), details: z.unknown().optional(), display: z.boolean() }).strict(),
  z.object({ ...localPiSessionEntryBase, type: z.literal('label'), targetId: z.string(), label: z.string().optional() }).strict(),
  z.object({ ...localPiSessionEntryBase, type: z.literal('session_info'), name: z.string().optional() }).strict(),
])

export type LocalPiSessionEntry = z.infer<typeof localPiSessionEntrySchema>

export interface LocalPiSessionTreeNode {
  entry: LocalPiSessionEntry
  children: LocalPiSessionTreeNode[]
  label?: string
  labelTimestamp?: string
}

export const LOCAL_PI_SESSION_TREE_MAX_NODES = 100_000
export const LOCAL_PI_SESSION_TREE_MAX_DEPTH = 20_000

const localPiSessionTreeNodeShallowSchema = z
  .object({
    entry: localPiSessionEntrySchema,
    children: z.array(z.unknown()).max(LOCAL_PI_SESSION_TREE_MAX_NODES),
    label: z.string().optional(),
    labelTimestamp: z.string().optional(),
  })
  .strict()

type LocalPiSessionTreeParseResult =
  | { success: true; tree: LocalPiSessionTreeNode[] }
  | { success: false; message: string }

function parseLocalPiSessionTree(
  rawRoots: readonly unknown[],
): LocalPiSessionTreeParseResult {
  const tree: LocalPiSessionTreeNode[] = []
  const pending = rawRoots
    .map((value) => ({
      value,
      depth: 0,
      destination: tree,
    }))
    .reverse()
  let nodeCount = 0

  while (pending.length > 0) {
    const current = pending.pop()
    if (!current) break
    nodeCount += 1
    if (nodeCount > LOCAL_PI_SESSION_TREE_MAX_NODES) {
      return {
        success: false,
        message: `Pi session tree exceeded ${LOCAL_PI_SESSION_TREE_MAX_NODES} nodes.`,
      }
    }
    if (current.depth > LOCAL_PI_SESSION_TREE_MAX_DEPTH) {
      return {
        success: false,
        message: `Pi session tree exceeded depth ${LOCAL_PI_SESSION_TREE_MAX_DEPTH}.`,
      }
    }

    const parsed = localPiSessionTreeNodeShallowSchema.safeParse(current.value)
    if (!parsed.success) {
      return {
        success: false,
        message: `Pi session tree contains an invalid node at depth ${current.depth}.`,
      }
    }

    const node: LocalPiSessionTreeNode = {
      entry: parsed.data.entry,
      children: [],
      ...(parsed.data.label === undefined ? {} : { label: parsed.data.label }),
      ...(parsed.data.labelTimestamp === undefined
        ? {}
        : { labelTimestamp: parsed.data.labelTimestamp }),
    }
    current.destination.push(node)
    for (let index = parsed.data.children.length - 1; index >= 0; index -= 1) {
      pending.push({
        value: parsed.data.children[index],
        depth: current.depth + 1,
        destination: node.children,
      })
    }
  }

  return { success: true, tree }
}

function addLocalPiSessionTreeIssue(
  context: { addIssue(issue: { code: 'custom'; message: string }): void },
  message: string,
) {
  context.addIssue({ code: 'custom', message })
  return z.NEVER
}

export const localPiSessionTreeNodeSchema: z.ZodType<LocalPiSessionTreeNode> = z
  .unknown()
  .transform((value, context) => {
    const parsed = parseLocalPiSessionTree([value])
    if (!parsed.success) return addLocalPiSessionTreeIssue(context, parsed.message)
    return parsed.tree[0]!
  })

const localPiSessionTreeSchema = z
  .array(z.unknown())
  .max(LOCAL_PI_SESSION_TREE_MAX_NODES)
  .transform((roots, context) => {
    const parsed = parseLocalPiSessionTree(roots)
    if (!parsed.success) return addLocalPiSessionTreeIssue(context, parsed.message)
    return parsed.tree
  })

export const localPiTreeRowSchema = z
  .object({
    entry: localPiSessionEntrySchema,
    parentId: z.string().min(1).nullable(),
    depth: z.number().int().nonnegative().max(LOCAL_PI_SESSION_TREE_MAX_DEPTH),
    order: z
      .number()
      .int()
      .nonnegative()
      .max(LOCAL_PI_SESSION_TREE_MAX_NODES - 1),
    label: z.string().optional(),
    labelTimestamp: z.string().optional(),
  })
  .strict()

export type LocalPiTreeRow = z.infer<typeof localPiTreeRowSchema>

export const localPiTreeResultSchema = z
  .object({
    rows: z.array(localPiTreeRowSchema).max(LOCAL_PI_SESSION_TREE_MAX_NODES),
    leafId: z.string().nullable(),
  })
  .strict()

export type LocalPiTreeResult = z.infer<typeof localPiTreeResultSchema>

export const localPiMessagesResponseDataSchema = z
  .object({ messages: z.array(localPiAgentMessageSchema) })
  .strict()

export const localPiModelsResponseDataSchema = z
  .object({ models: z.array(localPiModelSchema) })
  .strict()

export const localPiThinkingLevelsResponseDataSchema = z
  .object({ levels: z.array(localPiThinkingLevelSchema) })
  .strict()

export const localPiCommandsResponseDataSchema = z
  .object({ commands: z.array(localPiSlashCommandSchema) })
  .strict()

const localPiSuccessResponseBase = {
  id: z.string().optional(),
  type: z.literal('response'),
  success: z.literal(true),
  error: z.undefined().optional(),
}

function localPiNoDataSuccessSchema<TCommand extends LocalPiRpcCommandType>(
  command: TCommand,
) {
  return z
    .object({
      ...localPiSuccessResponseBase,
      command: z.literal(command),
      data: z.undefined().optional(),
    })
    .strict()
}

export const localPiRpcSuccessResponseSchema = z.discriminatedUnion('command', [
  localPiNoDataSuccessSchema('prompt'),
  localPiNoDataSuccessSchema('steer'),
  localPiNoDataSuccessSchema('follow_up'),
  localPiNoDataSuccessSchema('abort'),
  z.object({ ...localPiSuccessResponseBase, command: z.literal('new_session'), data: z.object({ cancelled: z.boolean() }).strict() }).strict(),
  z.object({ ...localPiSuccessResponseBase, command: z.literal('get_state'), data: localPiSessionStateSchema }).strict(),
  z.object({ ...localPiSuccessResponseBase, command: z.literal('set_model'), data: localPiModelSchema }).strict(),
  z.object({ ...localPiSuccessResponseBase, command: z.literal('cycle_model'), data: z.object({ model: localPiModelSchema, thinkingLevel: localPiThinkingLevelSchema, isScoped: z.boolean() }).strict().nullable() }).strict(),
  z.object({ ...localPiSuccessResponseBase, command: z.literal('get_available_models'), data: localPiModelsResponseDataSchema }).strict(),
  localPiNoDataSuccessSchema('set_thinking_level'),
  z.object({ ...localPiSuccessResponseBase, command: z.literal('cycle_thinking_level'), data: z.object({ level: localPiThinkingLevelSchema }).strict().nullable() }).strict(),
  z.object({ ...localPiSuccessResponseBase, command: z.literal('get_available_thinking_levels'), data: localPiThinkingLevelsResponseDataSchema }).strict(),
  localPiNoDataSuccessSchema('set_steering_mode'),
  localPiNoDataSuccessSchema('set_follow_up_mode'),
  localPiNoDataSuccessSchema('promote_follow_up'),
  z.object({ ...localPiSuccessResponseBase, command: z.literal('compact'), data: localPiCompactionResultSchema }).strict(),
  localPiNoDataSuccessSchema('set_auto_compaction'),
  localPiNoDataSuccessSchema('set_auto_retry'),
  localPiNoDataSuccessSchema('abort_retry'),
  z.object({ ...localPiSuccessResponseBase, command: z.literal('bash'), data: localPiBashResultSchema }).strict(),
  localPiNoDataSuccessSchema('abort_bash'),
  z.object({ ...localPiSuccessResponseBase, command: z.literal('get_session_stats'), data: localPiSessionStatsSchema }).strict(),
  z.object({ ...localPiSuccessResponseBase, command: z.literal('export_html'), data: z.object({ path: z.string() }).strict() }).strict(),
  z.object({ ...localPiSuccessResponseBase, command: z.literal('switch_session'), data: z.object({ cancelled: z.boolean() }).strict() }).strict(),
  z.object({ ...localPiSuccessResponseBase, command: z.literal('fork'), data: z.object({ text: z.string(), cancelled: z.boolean() }).strict() }).strict(),
  z.object({ ...localPiSuccessResponseBase, command: z.literal('clone'), data: z.object({ cancelled: z.boolean() }).strict() }).strict(),
  z.object({ ...localPiSuccessResponseBase, command: z.literal('get_fork_messages'), data: z.object({ messages: z.array(z.object({ entryId: z.string(), text: z.string() }).strict()) }).strict() }).strict(),
  z.object({ ...localPiSuccessResponseBase, command: z.literal('get_entries'), data: z.object({ entries: z.array(localPiSessionEntrySchema), leafId: z.string().nullable() }).strict() }).strict(),
  z.object({ ...localPiSuccessResponseBase, command: z.literal('get_tree'), data: z.object({ tree: localPiSessionTreeSchema, leafId: z.string().nullable() }).strict() }).strict(),
  z.object({ ...localPiSuccessResponseBase, command: z.literal('get_last_assistant_text'), data: z.object({ text: z.string().nullable() }).strict() }).strict(),
  localPiNoDataSuccessSchema('set_session_name'),
  z.object({ ...localPiSuccessResponseBase, command: z.literal('get_messages'), data: localPiMessagesResponseDataSchema }).strict(),
  z.object({ ...localPiSuccessResponseBase, command: z.literal('get_commands'), data: localPiCommandsResponseDataSchema }).strict(),
  z.object({
    ...localPiSuccessResponseBase,
    command: z.literal('get_command_argument_completions'),
    data: localPiCommandArgumentCompletionsResponseDataSchema,
  }).strict(),
])

export const localPiRpcFailureResponseSchema = z
  .object({
    id: z.string().optional(),
    type: z.literal('response'),
    command: z.string().min(1),
    success: z.literal(false),
    data: z.undefined().optional(),
    error: z.string(),
  })
  .strict()

export const localPiRpcResponseSchema = z.union([
  localPiRpcSuccessResponseSchema,
  localPiRpcFailureResponseSchema,
])

export type LocalPiRpcSuccessResponse = z.infer<
  typeof localPiRpcSuccessResponseSchema
>
export type LocalPiRpcFailureResponse = z.infer<
  typeof localPiRpcFailureResponseSchema
>
export type LocalPiRpcResponse = z.infer<typeof localPiRpcResponseSchema>

type LocalPiResponseData<TResponse> = TResponse extends { data?: infer TData }
  ? TData
  : never

export type LocalPiRpcResponseData = LocalPiResponseData<
  LocalPiRpcSuccessResponse
>
export type LocalPiRpcSuccessResponseFor<
  TCommand extends LocalPiRpcCommandType,
> = Extract<LocalPiRpcSuccessResponse, { command: TCommand }>
export type LocalPiRpcResponseDataFor<
  TCommand extends LocalPiRpcCommandType,
> = LocalPiResponseData<LocalPiRpcSuccessResponseFor<TCommand>>

const localPiRendererTreeSuccessResponseSchema = z
  .object({
    ...localPiSuccessResponseBase,
    command: z.literal('get_tree'),
    data: localPiTreeResultSchema,
  })
  .strict()

type LocalPiRendererTreeSuccessResponse = z.infer<
  typeof localPiRendererTreeSuccessResponseSchema
>

type LocalPiNonTreeRpcSuccessResponse = Exclude<
  LocalPiRpcSuccessResponse,
  { command: 'get_tree' }
>

const localPiNonTreeRpcSuccessResponseSchema = localPiRpcSuccessResponseSchema
  .refine(
    (response) => response.command !== 'get_tree',
    { message: 'Recursive Pi session trees cannot cross renderer IPC.' },
  ) as z.ZodType<LocalPiNonTreeRpcSuccessResponse>

export type LocalPiRendererRpcSuccessResponse =
  | LocalPiNonTreeRpcSuccessResponse
  | LocalPiRendererTreeSuccessResponse

export const localPiRendererRpcSuccessResponseSchema = z.union([
  localPiRendererTreeSuccessResponseSchema,
  localPiNonTreeRpcSuccessResponseSchema,
]) as z.ZodType<LocalPiRendererRpcSuccessResponse>

export type LocalPiRendererRpcResponse =
  | LocalPiRendererRpcSuccessResponse
  | LocalPiRpcFailureResponse

export const localPiRendererRpcResponseSchema = z.union([
  localPiRendererRpcSuccessResponseSchema,
  localPiRpcFailureResponseSchema,
]) as z.ZodType<LocalPiRendererRpcResponse>

export type LocalPiRendererRpcSuccessResponseFor<
  TCommand extends LocalPiRpcCommandType,
> = Extract<LocalPiRendererRpcSuccessResponse, { command: TCommand }>

export type LocalPiRendererRpcResponseDataFor<
  TCommand extends LocalPiRpcCommandType,
> = LocalPiResponseData<LocalPiRendererRpcSuccessResponseFor<TCommand>>

export const LOCAL_PI_EVENT_TYPES = [
  'agent_start',
  'agent_end',
  'agent_settled',
  'entry_appended',
  'session_info_changed',
  'thinking_level_changed',
  'turn_start',
  'turn_end',
  'message_start',
  'message_update',
  'message_end',
  'bash_execution_update',
  'tool_execution_start',
  'tool_execution_update',
  'tool_execution_end',
  'queue_update',
  'compaction_start',
  'compaction_end',
  'auto_retry_start',
  'auto_retry_end',
  'summarization_retry_scheduled',
  'summarization_retry_attempt_start',
  'summarization_retry_finished',
  'extension_error',
  'runtime_diagnostic',
] as const

export const localPiAssistantMessageEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text_start'), contentIndex: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal('text_delta'), contentIndex: z.number().int().nonnegative(), delta: z.string() }).strict(),
  z.object({ type: z.literal('text_end'), contentIndex: z.number().int().nonnegative(), content: z.string() }).strict(),
  z.object({ type: z.literal('thinking_start'), contentIndex: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal('thinking_delta'), contentIndex: z.number().int().nonnegative(), delta: z.string() }).strict(),
  z.object({ type: z.literal('thinking_end'), contentIndex: z.number().int().nonnegative(), content: z.string() }).strict(),
  z.object({ type: z.literal('toolcall_start'), contentIndex: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal('toolcall_delta'), contentIndex: z.number().int().nonnegative(), delta: z.string() }).strict(),
  z.object({ type: z.literal('toolcall_end'), contentIndex: z.number().int().nonnegative(), toolCall: localPiToolCallSchema }).strict(),
])

export type LocalPiAssistantMessageEvent = z.infer<
  typeof localPiAssistantMessageEventSchema
>

export const localPiRpcEventSchema = z.union([
  z.object({ type: z.literal('agent_start') }).strict(),
  z.object({ type: z.literal('agent_end'), messages: z.array(localPiAgentMessageSchema), willRetry: z.boolean() }).strict(),
  z.object({ type: z.literal('agent_settled') }).strict(),
  z.object({ type: z.literal('entry_appended'), entry: localPiSessionEntrySchema }).strict(),
  z.object({ type: z.literal('session_info_changed'), name: z.string().optional() }).strict(),
  z.object({ type: z.literal('thinking_level_changed'), level: localPiThinkingLevelSchema }).strict(),
  z.object({ type: z.literal('turn_start') }).strict(),
  z.object({ type: z.literal('turn_end'), message: localPiAgentMessageSchema, toolResults: z.array(localPiToolResultMessageSchema) }).strict(),
  z.object({ type: z.literal('message_start'), message: localPiAgentMessageSchema }).strict(),
  z.object({
    type: z.literal('message_update'),
    usage: localPiUsageSchema,
    assistantMessageEvent: localPiAssistantMessageEventSchema,
  }).strict(),
  z.object({ type: z.literal('message_end'), message: localPiAgentMessageSchema }).strict(),
  z.object({ type: z.literal('bash_execution_update'), id: z.string().optional(), delta: z.string() }).strict(),
  z.object({ type: z.literal('tool_execution_start'), toolCallId: z.string().min(1), toolName: z.string().min(1), args: z.unknown().nonoptional() }).strict(),
  z.object({ type: z.literal('tool_execution_update'), toolCallId: z.string().min(1), toolName: z.string().min(1), args: z.unknown().nonoptional(), partialResult: localPiToolResultSchema }).strict(),
  z.object({ type: z.literal('tool_execution_end'), toolCallId: z.string().min(1), toolName: z.string().min(1), result: localPiToolResultSchema, isError: z.boolean() }).strict(),
  z.object({ type: z.literal('queue_update'), steering: z.array(z.string()), followUp: z.array(z.string()) }).strict(),
  z.object({ type: z.literal('compaction_start'), reason: z.enum(['manual', 'threshold', 'overflow']) }).strict(),
  z.object({ type: z.literal('compaction_end'), reason: z.enum(['manual', 'threshold', 'overflow']), result: localPiCompactionResultSchema.optional(), aborted: z.boolean(), willRetry: z.boolean(), errorMessage: z.string().optional() }).strict(),
  z.object({ type: z.literal('auto_retry_start'), attempt: z.number().int().positive(), maxAttempts: z.number().int().positive(), delayMs: z.number().int().nonnegative(), errorMessage: z.string() }).strict(),
  z.object({ type: z.literal('auto_retry_end'), success: z.boolean(), attempt: z.number().int().positive(), finalError: z.string().optional() }).strict(),
  z.object({ type: z.literal('summarization_retry_scheduled'), attempt: z.number().int().positive(), maxAttempts: z.number().int().positive(), delayMs: z.number().int().nonnegative(), errorMessage: z.string() }).strict(),
  z.object({ type: z.literal('summarization_retry_attempt_start'), source: z.literal('branchSummary') }).strict(),
  z.object({ type: z.literal('summarization_retry_attempt_start'), source: z.literal('compaction'), reason: z.enum(['manual', 'threshold', 'overflow']) }).strict(),
  z.object({ type: z.literal('summarization_retry_finished') }).strict(),
  z.object({ type: z.literal('extension_error'), extensionPath: z.string(), event: z.string(), error: z.string() }).strict(),
  z.object({
    type: z.literal('runtime_diagnostic'),
    code: z.literal(LOCAL_PI_RUNTIME_EVENT_PROJECTION_FAILED_CODE),
  }).strict(),
])

export type LocalPiRpcEvent = z.infer<typeof localPiRpcEventSchema>
export type LocalPiMessageStartEvent = Extract<
  LocalPiRpcEvent,
  { type: 'message_start' }
>
export type LocalPiMessageUpdateEvent = Extract<
  LocalPiRpcEvent,
  { type: 'message_update' }
>
export type LocalPiMessageEndEvent = Extract<
  LocalPiRpcEvent,
  { type: 'message_end' }
>
export type LocalPiToolExecutionEvent = Extract<
  LocalPiRpcEvent,
  { type: 'tool_execution_start' | 'tool_execution_update' | 'tool_execution_end' }
>
export type LocalPiQueueUpdateEvent = Extract<
  LocalPiRpcEvent,
  { type: 'queue_update' }
>
export type LocalPiCompactionEvent = Extract<
  LocalPiRpcEvent,
  { type: 'compaction_start' | 'compaction_end' }
>
export type LocalPiRetryEvent = Extract<
  LocalPiRpcEvent,
  {
    type:
      | 'auto_retry_start'
      | 'auto_retry_end'
      | 'summarization_retry_scheduled'
      | 'summarization_retry_attempt_start'
      | 'summarization_retry_finished'
  }
>
export type LocalPiExtensionErrorEvent = Extract<
  LocalPiRpcEvent,
  { type: 'extension_error' }
>

const extensionUiRequestBase = {
  type: z.literal('extension_ui_request'),
  id: z.string().min(1),
}

export const localPiExtensionUiRequestSchema = z.union([
  z.object({ ...extensionUiRequestBase, method: z.literal('select'), title: z.string(), options: z.array(z.string()), timeout: z.number().nonnegative().optional() }).strict(),
  z.object({ ...extensionUiRequestBase, method: z.literal('confirm'), title: z.string(), message: z.string(), timeout: z.number().nonnegative().optional() }).strict(),
  z.object({ ...extensionUiRequestBase, method: z.literal('input'), title: z.string(), placeholder: z.string().optional(), timeout: z.number().nonnegative().optional() }).strict(),
  z.object({ ...extensionUiRequestBase, method: z.literal('editor'), title: z.string(), prefill: z.string().optional() }).strict(),
  z.object({ ...extensionUiRequestBase, method: z.literal('notify'), message: z.string(), notifyType: z.enum(['info', 'warning', 'error']).optional() }).strict(),
  z.object({ ...extensionUiRequestBase, method: z.literal('setStatus'), statusKey: z.string(), statusText: z.string().optional() }).strict(),
  z.object({ ...extensionUiRequestBase, method: z.literal('setWorkingMessage'), message: z.string().max(2_048).optional() }).strict(),
  z.object({ ...extensionUiRequestBase, method: z.literal('setWorkingVisible'), visible: z.boolean() }).strict(),
  z.object({ ...extensionUiRequestBase, method: z.literal('setWidget'), widgetKey: z.string(), widgetLines: z.array(z.string()).optional(), widgetPlacement: z.enum(['aboveEditor', 'belowEditor']).optional() }).strict(),
  z.object({ ...extensionUiRequestBase, method: z.literal('setTitle'), title: z.string() }).strict(),
  z.object({ ...extensionUiRequestBase, method: z.literal('set_editor_text'), text: z.string() }).strict(),
  z.object({ ...extensionUiRequestBase, method: z.literal('unsupported'), unsupportedMethod: z.string().min(1).max(128) }).strict(),
  z.object({
    ...extensionUiRequestBase,
    method: z.literal('dismiss'),
    reason: z.enum(['expired', 'aborted', 'replaced']),
  }).strict(),
])

export type LocalPiExtensionUiRequest = z.infer<
  typeof localPiExtensionUiRequestSchema
>

export const localPiExtensionUiResponseSchema = z.union([
  z.object({ type: z.literal('extension_ui_response'), id: z.string().min(1), value: z.string() }).strict(),
  z.object({ type: z.literal('extension_ui_response'), id: z.string().min(1), confirmed: z.boolean() }).strict(),
  z.object({ type: z.literal('extension_ui_response'), id: z.string().min(1), cancelled: z.literal(true) }).strict(),
])

export type LocalPiExtensionUiResponse = z.infer<
  typeof localPiExtensionUiResponseSchema
>

export const localPiRuntimeSnapshotSchema = z
  .object({
    state: localPiRuntimeStateSchema,
    generation: z.number().int().nonnegative(),
    cwd: z.string().nullable(),
    sessionFile: z.string().nullable(),
    sessionState: localPiSessionStateSchema.nullable(),
    commands: z.array(localPiSlashCommandSchema),
    stderr: z.string().max(8_192),
    diagnostics: z.array(localPiDiagnosticSchema).max(20),
    sessionStatuses: z
      .array(localPiRuntimeSessionStatusSchema)
      .max(LOCAL_PI_RUNTIME_SESSION_STATUS_MAX_ITEMS)
      .optional(),
  })
  .strict()

export type LocalPiRuntimeSnapshot = z.infer<typeof localPiRuntimeSnapshotSchema>

export const localPiRuntimeChangedEventSchema = z
  .object({
    eventId: z.uuid(),
    snapshot: localPiRuntimeSnapshotSchema,
  })
  .strict()

export const localPiRpcEventMessageSchema = z
  .object({
    eventId: z.uuid(),
    generation: z.number().int().nonnegative(),
    event: localPiRpcEventSchema,
  })
  .strict()

export const localPiExtensionUiEventSchema = z
  .object({
    eventId: z.uuid(),
    generation: z.number().int().nonnegative(),
    request: localPiExtensionUiRequestSchema,
  })
  .strict()

export type LocalPiRuntimeChangedEvent = z.infer<
  typeof localPiRuntimeChangedEventSchema
>
export type LocalPiRpcEventMessage = z.infer<typeof localPiRpcEventMessageSchema>
export type LocalPiExtensionUiEvent = z.infer<
  typeof localPiExtensionUiEventSchema
>
