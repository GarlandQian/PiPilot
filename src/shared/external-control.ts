import { z } from 'zod'
import { inspectPiHostDto } from './pi-host-protocol'
import {
  externalControlAcceptedModeSchema,
  externalControlPromptSchema,
  externalControlRequestedModeSchema,
} from './external-control-mode'

export {
  EXTERNAL_CONTROL_MAX_PROMPT_BYTES,
  externalControlAcceptedModeSchema,
  externalControlPromptSchema,
  externalControlRequestedModeSchema,
} from './external-control-mode'
export type {
  ExternalControlAcceptedMode,
  ExternalControlRequestedMode,
} from './external-control-mode'

export const EXTERNAL_CONTROL_PROTOCOL_VERSION = 1 as const
export const EXTERNAL_CONTROL_MAX_PAGE_ROWS = 50
export const EXTERNAL_CONTROL_MAX_FRAME_BYTES = 1024 * 1024
export const EXTERNAL_CONTROL_MAX_FINAL_RESPONSE_BYTES = 64 * 1024
export const EXTERNAL_CONTROL_MAX_PRE_ACCEPTANCE_BYTES = 256 * 1024
export const EXTERNAL_CONTROL_MAX_IDEMPOTENCY_KEY_LENGTH = 128
export const EXTERNAL_CONTROL_MAX_OPERATIONS = 256
export const EXTERNAL_CONTROL_OPERATION_RETENTION_MS = 24 * 60 * 60 * 1000
export const EXTERNAL_CONTROL_MAX_WAIT_MS = 30_000
export const EXTERNAL_CONTROL_MAX_RECENT_ROWS = 50
export const EXTERNAL_CONTROL_MAX_CLIENTS = 16
export const EXTERNAL_CONTROL_MAX_IN_FLIGHT_PER_CLIENT = 32
export const EXTERNAL_CONTROL_STDIO_STARTUP_TIMEOUT_MS = 5_000
export const EXTERNAL_CONTROL_STDIO_IDLE_TIMEOUT_MS = 30 * 60 * 1_000
export const EXTERNAL_CONTROL_BRIDGE_HANDSHAKE_TIMEOUT_MS = 5_000

const utf8 = new TextEncoder()

function utf8Bounded(limit: number, label: string) {
  return z.string().refine(
    (value) => utf8.encode(value).byteLength <= limit,
    `${label} exceeds the UTF-8 byte limit.`,
  )
}

export const externalControlConversationIdSchema = z
  .string()
  .min(20)
  .max(96)
  .regex(/^conv_[A-Za-z0-9_-]+$/u)

export const externalControlOperationIdSchema = z
  .string()
  .min(20)
  .max(96)
  .regex(/^op_[A-Za-z0-9_-]+$/u)

export const externalControlRequestIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/u)

export const externalControlIdempotencyKeySchema = z
  .string()
  .min(1)
  .max(EXTERNAL_CONTROL_MAX_IDEMPOTENCY_KEY_LENGTH)
  .regex(/^[\u0021-\u007e]+$/u)

export const externalControlLifecycleSchema = z.enum([
  'inactive',
  'idle',
  'accepting',
  'running',
  'queued',
  'stopped',
  'crashed',
  'unavailable',
])
export const externalControlOperationStatusSchema = z.enum([
  'received',
  'starting',
  'accepting',
  'accepted',
  'completed',
  'failed',
  'aborted',
  'runtime_replaced',
])
export const externalControlTerminalOperationStatusSchema = z.enum([
  'completed',
  'failed',
  'aborted',
  'runtime_replaced',
])

export const externalControlErrorCodeSchema = z.enum([
  'external_control_disabled',
  'pipilot_unavailable',
  'authentication_failed',
  'protocol_mismatch',
  'conversation_not_found',
  'conversation_unavailable',
  'invalid_state',
  'request_too_large',
  'idempotency_conflict',
  'interaction_required',
  'runtime_replaced',
  'operation_not_found',
  'deadline_exceeded',
  'internal_error',
])

export type ExternalControlErrorCode = z.infer<typeof externalControlErrorCodeSchema>

export const externalControlPublicErrorSchema = z
  .object({
    code: externalControlErrorCodeSchema,
    message: z.string().min(1).max(512),
  })
  .strict()

export class ExternalControlError extends Error {
  constructor(
    readonly code: ExternalControlErrorCode,
    message: string,
  ) {
    super(message.slice(0, 512))
    this.name = 'ExternalControlError'
  }

  toPublicError() {
    return externalControlPublicErrorSchema.parse({
      code: this.code,
      message: this.message,
    })
  }
}

export function sanitizeExternalControlError(value: unknown) {
  if (value instanceof ExternalControlError) return value.toPublicError()
  return externalControlPublicErrorSchema.parse({
    code: 'internal_error',
    message: 'PiPilot could not complete the external-control request.',
  })
}

export const externalControlDescriptorSchema = z
  .object({
    protocolVersion: z.literal(EXTERNAL_CONTROL_PROTOCOL_VERSION),
    instanceId: z.uuid(),
    endpoint: z.string().min(1).max(4_096).refine((value) => !value.includes('\0')),
    token: z.string().min(43).max(128).regex(/^[A-Za-z0-9_-]+$/u),
    createdAt: z.iso.datetime(),
  })
  .strict()

export type ExternalControlDescriptor = z.infer<typeof externalControlDescriptorSchema>

export const externalControlConversationSchema = z
  .object({
    conversationId: externalControlConversationIdSchema,
    name: z.string().min(1).max(256).optional(),
    project: z.string().min(1).max(256).optional(),
    createdAt: z.iso.datetime(),
    modifiedAt: z.iso.datetime(),
    lifecycle: externalControlLifecycleSchema,
    queueCount: z.number().int().nonnegative().max(10_000).optional(),
    activity: z.enum([
      'prompt',
      'tool',
      'retry',
      'compaction',
      'summarization',
      'interaction',
    ]).optional(),
    model: z
      .object({ provider: z.string().min(1).max(128), id: z.string().min(1).max(256) })
      .strict()
      .optional(),
  })
  .strict()

export type ExternalControlConversation = z.infer<typeof externalControlConversationSchema>

export const listConversationsInputSchema = z
  .object({
    cursor: z.string().min(20).max(256).optional(),
    limit: z.number().int().min(1).max(EXTERNAL_CONTROL_MAX_PAGE_ROWS).default(
      EXTERNAL_CONTROL_MAX_PAGE_ROWS,
    ),
  })
  .strict()

export const listConversationsResultSchema = z
  .object({
    conversations: z.array(externalControlConversationSchema).max(EXTERNAL_CONTROL_MAX_PAGE_ROWS),
    nextCursor: z.string().min(20).max(256).nullable(),
    diagnostics: z
      .array(z.object({ scope: z.string().min(1).max(256), status: z.enum([
        'not_loaded',
        'unavailable',
      ]) }).strict())
      .max(101),
  })
  .strict()

export const getConversationStatusInputSchema = z
  .object({ conversationId: externalControlConversationIdSchema })
  .strict()

export const getConversationStatusResultSchema = z
  .object({ conversation: externalControlConversationSchema })
  .strict()

export const sendPromptInputSchema = z
  .object({
    conversationId: externalControlConversationIdSchema,
    prompt: externalControlPromptSchema,
    mode: externalControlRequestedModeSchema.default('auto'),
    idempotencyKey: externalControlIdempotencyKeySchema,
  })
  .strict()

export const abortConversationInputSchema = z
  .object({
    conversationId: externalControlConversationIdSchema,
    idempotencyKey: externalControlIdempotencyKeySchema,
  })
  .strict()

export const externalControlOperationSchema = z
  .object({
    operationId: externalControlOperationIdSchema,
    conversationId: externalControlConversationIdSchema,
    kind: z.enum(['send_prompt', 'abort_conversation']),
    requestedMode: externalControlRequestedModeSchema.optional(),
    acceptedMode: externalControlAcceptedModeSchema.optional(),
    status: externalControlOperationStatusSchema,
    receivedAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    acceptedAt: z.iso.datetime().optional(),
    completedAt: z.iso.datetime().optional(),
    error: externalControlPublicErrorSchema.optional(),
    finalResponse: utf8Bounded(
      EXTERNAL_CONTROL_MAX_FINAL_RESPONSE_BYTES,
      'Final assistant response',
    ).optional(),
  })
  .strict()

export type ExternalControlOperation = z.infer<typeof externalControlOperationSchema>

export const externalControlReceiptSchema = externalControlOperationSchema.pick({
  operationId: true,
  conversationId: true,
  kind: true,
  requestedMode: true,
  status: true,
  receivedAt: true,
})

export const getOperationInputSchema = z
  .object({ operationId: externalControlOperationIdSchema })
  .strict()

export const getOperationResultSchema = z
  .object({ operation: externalControlOperationSchema })
  .strict()

export const waitForTurnInputSchema = z
  .object({
    operationId: externalControlOperationIdSchema,
    until: z.enum(['accepted', 'terminal']).default('terminal'),
    timeoutMs: z.number().int().min(1).max(EXTERNAL_CONTROL_MAX_WAIT_MS).default(
      EXTERNAL_CONTROL_MAX_WAIT_MS,
    ),
  })
  .strict()

export const waitForTurnResultSchema = z
  .object({
    reached: z.boolean(),
    timedOut: z.boolean(),
    operation: externalControlOperationSchema,
  })
  .strict()

export const externalControlBridgeMethodSchema = z.enum([
  'list_conversations',
  'get_conversation_status',
  'send_prompt',
  'abort_conversation',
  'get_operation',
  'wait_for_turn',
])

export type ExternalControlBridgeMethod = z.infer<typeof externalControlBridgeMethodSchema>

const bridgeParamsByMethod = {
  list_conversations: listConversationsInputSchema,
  get_conversation_status: getConversationStatusInputSchema,
  send_prompt: sendPromptInputSchema,
  abort_conversation: abortConversationInputSchema,
  get_operation: getOperationInputSchema,
  wait_for_turn: waitForTurnInputSchema,
} as const

const bridgeResultsByMethod = {
  list_conversations: listConversationsResultSchema,
  get_conversation_status: getConversationStatusResultSchema,
  send_prompt: externalControlReceiptSchema,
  abort_conversation: externalControlReceiptSchema,
  get_operation: getOperationResultSchema,
  wait_for_turn: waitForTurnResultSchema,
} as const

export const externalControlBridgeHelloSchema = z
  .object({
    type: z.literal('hello'),
    protocolVersion: z.literal(EXTERNAL_CONTROL_PROTOCOL_VERSION),
    instanceId: z.uuid(),
    token: z.string().min(43).max(128).regex(/^[A-Za-z0-9_-]+$/u),
  })
  .strict()

export const externalControlBridgeHelloAckSchema = z
  .object({
    type: z.literal('hello_ack'),
    protocolVersion: z.literal(EXTERNAL_CONTROL_PROTOCOL_VERSION),
    instanceId: z.uuid(),
  })
  .strict()

export const externalControlBridgeRequestSchema = z
  .object({
    type: z.literal('request'),
    requestId: externalControlRequestIdSchema,
    method: externalControlBridgeMethodSchema,
    params: z.unknown(),
  })
  .strict()
  .superRefine((request, context) => {
    const parsed = bridgeParamsByMethod[request.method].safeParse(request.params)
    if (parsed.success) return
    context.addIssue({ code: 'custom', path: ['params'], message: 'Invalid method parameters.' })
  })

export type ExternalControlBridgeRequest = z.infer<typeof externalControlBridgeRequestSchema>

export const externalControlBridgeResponseSchema = z.discriminatedUnion('ok', [
  z.object({
    type: z.literal('response'),
    requestId: externalControlRequestIdSchema,
    ok: z.literal(true),
    result: z.unknown(),
  }).strict(),
  z.object({
    type: z.literal('response'),
    requestId: externalControlRequestIdSchema,
    ok: z.literal(false),
    error: externalControlPublicErrorSchema,
  }).strict(),
])

export const externalControlUiStateSchema = z.enum([
  'disabled',
  'enabling',
  'ready',
  'disabling',
  'error',
  'unavailable',
])

export const externalControlMcpConfigurationSchema = z
  .object({
    command: z.literal('pipilot-mcp'),
    args: z.tuple([]),
  })
  .strict()

export type ExternalControlMcpConfiguration = z.infer<
  typeof externalControlMcpConfigurationSchema
>

export const EXTERNAL_CONTROL_MCP_CONFIGURATION = Object.freeze(
  externalControlMcpConfigurationSchema.parse({
    command: 'pipilot-mcp',
    args: [],
  }),
)

export const externalControlLauncherStateSchema = z.enum([
  'missing',
  'installed',
  'repair',
  'unsupported',
])

export const externalControlLauncherErrorSchema = z
  .object({
    code: z.enum([
      'launcher_unavailable',
      'launcher_conflict',
      'launcher_unsafe_target',
      'launcher_install_failed',
      'launcher_uninstall_failed',
    ]),
    message: z.string().min(1).max(512),
  })
  .strict()

export type ExternalControlLauncherError = z.infer<
  typeof externalControlLauncherErrorSchema
>

export const externalControlLauncherSnapshotSchema = z
  .object({
    state: externalControlLauncherStateSchema,
    managed: z.boolean(),
    requiresClientRestart: z.boolean(),
    error: externalControlLauncherErrorSchema.optional(),
  })
  .strict()

export type ExternalControlLauncherSnapshot = z.infer<
  typeof externalControlLauncherSnapshotSchema
>

export const externalControlRecentOperationRowSchema = z
  .object({
    presentationId: z
      .string()
      .min(20)
      .max(96)
      .regex(/^row_[A-Za-z0-9_-]+$/u),
    conversationLabel: z.string().min(1).max(256).optional(),
    action: z.enum(['send_prompt', 'abort_conversation']),
    status: externalControlOperationStatusSchema,
    timestamp: z.iso.datetime(),
  })
  .strict()

export type ExternalControlRecentOperationRow = z.infer<
  typeof externalControlRecentOperationRowSchema
>

export const externalControlSettingsSnapshotSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    enabled: z.boolean(),
    state: externalControlUiStateSchema,
    connectedClients: z.number().int().nonnegative().max(EXTERNAL_CONTROL_MAX_CLIENTS),
    configuration: externalControlMcpConfigurationSchema.optional(),
    recentOperations: z
      .array(externalControlRecentOperationRowSchema)
      .max(EXTERNAL_CONTROL_MAX_RECENT_ROWS),
    error: externalControlPublicErrorSchema.optional(),
  })
  .strict()

export type ExternalControlSettingsSnapshot = z.infer<
  typeof externalControlSettingsSnapshotSchema
>

export const externalControlSettingsChangedEventSchema = z
  .object({
    eventId: z.uuid(),
    snapshot: externalControlSettingsSnapshotSchema,
  })
  .strict()

export function parseExternalControlMethodParams(
  method: ExternalControlBridgeMethod,
  params: unknown,
) {
  return bridgeParamsByMethod[method].parse(params)
}

export function parseExternalControlMethodResult(
  method: ExternalControlBridgeMethod,
  result: unknown,
) {
  return bridgeResultsByMethod[method].parse(result)
}

export function assertExternalControlDto(value: unknown) {
  const inspected = inspectPiHostDto(value, {
    maxBytes: EXTERNAL_CONTROL_MAX_FRAME_BYTES,
    maxDepth: 64,
    maxNodes: 20_000,
  })
  if (!inspected.ok) {
    throw new ExternalControlError(
      inspected.code === 'payload-too-large' ? 'request_too_large' : 'internal_error',
      'The external-control message is invalid or too large.',
    )
  }
  return inspected.estimatedBytes
}

export function isTerminalExternalControlStatus(
  status: z.infer<typeof externalControlOperationStatusSchema>,
) {
  return externalControlTerminalOperationStatusSchema.safeParse(status).success
}
