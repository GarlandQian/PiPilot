import { z } from 'zod'
import {
  localPiExtensionUiRequestSchema,
  localPiExtensionUiResponseSchema,
  localPiRpcCommandSchema,
} from './local-pi'
import {
  externalControlPromptSchema,
  externalControlRequestedModeSchema,
} from './external-control-mode'

export const PI_HOST_PROTOCOL_VERSION = 2 as const
// get_messages carries the complete official Pi transcript. A long-running
// session can legitimately exceed the old 16 MiB transport ceiling even when
// every individual message is bounded, so retain a finite but practical cap.
export const PI_HOST_MAX_ENVELOPE_BYTES = 64 * 1024 * 1024
export const PI_HOST_MAX_REQUEST_TIMEOUT_MS = 10 * 60 * 1_000
// Host DTO inspection is iterative. Match the renderer's explicitly supported
// 20,000-level Pi session tree contract instead of rejecting it in Utility.
export const PI_HOST_MAX_DTO_DEPTH = 20_000
export const PI_HOST_MAX_DTO_NODES = 250_000
export const PI_HOST_INITIAL_EVENT_SEQUENCE = 1
export const PI_HOST_INITIAL_CREDIT_WINDOW = 64
export const PI_HOST_MAX_EVENT_TARGETS = 128
export const PI_HOST_MAX_QUEUED_EVENTS = 256
export const PI_HOST_MAX_QUEUED_EVENT_BYTES = 4 * 1024 * 1024
export const PI_HOST_ERROR_NAME_LIMIT = 256
export const PI_HOST_ERROR_MESSAGE_LIMIT = 2_048
export const PI_HOST_ERROR_CODE_LIMIT = 128
export const PI_HOST_ERROR_STACK_LIMIT = 8_192
export const PI_HOST_PATH_LIMIT = 16_384
export const PI_HOST_FAILURE_CODE_LIMIT = 64

const PI_HOST_FAILURE_NAME = 'PiHostFatalError'
const PI_HOST_FAILURE_MESSAGE =
  'The embedded Pi Host reported a fatal internal failure.'
const PI_HOST_FAILURE_FALLBACK_CODE = 'HOST_FATAL_ERROR'

const PI_HOST_ID_LIMIT = 128
const PI_HOST_VERSION_LIMIT = 128
const PI_HOST_CAPABILITY_LIMIT = 128
const PI_HOST_CAPABILITY_COUNT_LIMIT = 128

export type PiHostDto =
  | null
  | boolean
  | number
  | string
  | PiHostDto[]
  | { [key: string]: PiHostDto }

export type PiHostDtoRecord = { [key: string]: PiHostDto }

export const piHostDtoIssueCodeSchema = z.enum([
  'accessor-property',
  'circular-reference',
  'invalid-number',
  'maximum-depth',
  'maximum-nodes',
  'payload-too-large',
  'sparse-array',
  'symbol-key',
  'unsupported-object',
  'unsupported-type',
])

export type PiHostDtoIssueCode = z.infer<typeof piHostDtoIssueCodeSchema>

export type PiHostDtoInspection =
  | {
      ok: true
      estimatedBytes: number
      nodeCount: number
      maximumDepth: number
    }
  | {
      ok: false
      code: PiHostDtoIssueCode
      estimatedBytes: number
      nodeCount: number
      maximumDepth: number
    }

export interface PiHostDtoInspectionOptions {
  maxBytes?: number
  maxDepth?: number
  maxNodes?: number
}

type PiHostDtoWorkItem =
  | { kind: 'value'; value: unknown; depth: number }
  | { kind: 'leave'; value: object }

const utf8Encoder = new TextEncoder()

function requirePositiveSafeInteger(value: number, optionName: string) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${optionName} must be a positive safe integer.`)
  }
  return value
}

function serializedStringBytes(value: string) {
  return utf8Encoder.encode(JSON.stringify(value)).byteLength
}

function isPlainRecord(value: unknown): value is PiHostDtoRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  try {
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
  } catch {
    return false
  }
}

/**
 * Iteratively validates the intentionally small DTO subset used over the Host
 * MessagePort and estimates its JSON-equivalent UTF-8 size. The protocol does
 * not accept every value supported by structured clone: aliases are allowed,
 * while cycles, accessors, sparse arrays, class instances, and native objects
 * are rejected so both sides observe one deterministic plain-data contract.
 */
export function inspectPiHostDto(
  value: unknown,
  options: PiHostDtoInspectionOptions = {},
): PiHostDtoInspection {
  const maxBytes = requirePositiveSafeInteger(
    options.maxBytes ?? PI_HOST_MAX_ENVELOPE_BYTES,
    'maxBytes',
  )
  const maxDepth = requirePositiveSafeInteger(
    options.maxDepth ?? PI_HOST_MAX_DTO_DEPTH,
    'maxDepth',
  )
  const maxNodes = requirePositiveSafeInteger(
    options.maxNodes ?? PI_HOST_MAX_DTO_NODES,
    'maxNodes',
  )
  const stack: PiHostDtoWorkItem[] = [
    { kind: 'value', value, depth: 0 },
  ]
  const activeContainers = new WeakSet<object>()
  let estimatedBytes = 0
  let nodeCount = 0
  let maximumDepth = 0

  const failure = (code: PiHostDtoIssueCode): PiHostDtoInspection => ({
    ok: false,
    code,
    estimatedBytes,
    nodeCount,
    maximumDepth,
  })
  const addBytes = (count: number) => {
    estimatedBytes += count
    return estimatedBytes <= maxBytes
  }

  while (stack.length > 0) {
    const item = stack.pop()!
    if (item.kind === 'leave') {
      activeContainers.delete(item.value)
      continue
    }

    nodeCount += 1
    if (nodeCount > maxNodes) return failure('maximum-nodes')
    maximumDepth = Math.max(maximumDepth, item.depth)
    if (item.depth > maxDepth) return failure('maximum-depth')

    const current = item.value
    if (current === null) {
      if (!addBytes(4)) return failure('payload-too-large')
      continue
    }

    if (typeof current === 'string') {
      if (!addBytes(serializedStringBytes(current))) {
        return failure('payload-too-large')
      }
      continue
    }

    if (typeof current === 'boolean') {
      if (!addBytes(current ? 4 : 5)) return failure('payload-too-large')
      continue
    }

    if (typeof current === 'number') {
      if (!Number.isFinite(current)) return failure('invalid-number')
      if (!addBytes(JSON.stringify(current).length)) {
        return failure('payload-too-large')
      }
      continue
    }

    if (typeof current !== 'object') return failure('unsupported-type')

    if (activeContainers.has(current)) return failure('circular-reference')

    let ownKeys: (string | symbol)[]
    let prototype: object | null
    try {
      ownKeys = Reflect.ownKeys(current)
      prototype = Object.getPrototypeOf(current)
    } catch {
      return failure('unsupported-object')
    }

    activeContainers.add(current)
    stack.push({ kind: 'leave', value: current })

    if (Array.isArray(current)) {
      if (prototype !== Array.prototype) return failure('unsupported-object')
      if (current.length > maxNodes) return failure('maximum-nodes')
      if (!addBytes(2 + Math.max(0, current.length - 1))) {
        return failure('payload-too-large')
      }
      if (ownKeys.some((key) => typeof key === 'symbol')) {
        return failure('symbol-key')
      }
      if (ownKeys.length !== current.length + 1) {
        return failure('sparse-array')
      }
      for (let index = current.length - 1; index >= 0; index -= 1) {
        let descriptor: PropertyDescriptor | undefined
        try {
          descriptor = Object.getOwnPropertyDescriptor(current, String(index))
        } catch {
          return failure('unsupported-object')
        }
        if (!descriptor) return failure('sparse-array')
        if (!('value' in descriptor) || !descriptor.enumerable) {
          return failure('accessor-property')
        }
        stack.push({
          kind: 'value',
          value: descriptor.value,
          depth: item.depth + 1,
        })
      }
      continue
    }

    if (prototype !== Object.prototype && prototype !== null) {
      return failure('unsupported-object')
    }
    if (!addBytes(2 + Math.max(0, ownKeys.length - 1))) {
      return failure('payload-too-large')
    }

    for (let index = ownKeys.length - 1; index >= 0; index -= 1) {
      const key = ownKeys[index]
      if (typeof key === 'symbol') return failure('symbol-key')

      let descriptor: PropertyDescriptor | undefined
      try {
        descriptor = Object.getOwnPropertyDescriptor(current, key)
      } catch {
        return failure('unsupported-object')
      }
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) {
        return failure('accessor-property')
      }
      if (!addBytes(serializedStringBytes(key) + 1)) {
        return failure('payload-too-large')
      }
      stack.push({
        kind: 'value',
        value: descriptor.value,
        depth: item.depth + 1,
      })
    }
  }

  return { ok: true, estimatedBytes, nodeCount, maximumDepth }
}

export function isPiHostDto(value: unknown): value is PiHostDto {
  return inspectPiHostDto(value).ok
}

export function estimatePiHostDtoBytes(value: unknown): number | null {
  const inspection = inspectPiHostDto(value)
  return inspection.ok ? inspection.estimatedBytes : null
}

export const piHostDtoSchema = z.custom<PiHostDto>(
  (value) => isPiHostDto(value),
  'Expected a bounded, acyclic Pi Host DTO.',
)

export const piHostDtoRecordSchema = z.custom<PiHostDtoRecord>(
  (value) => isPlainRecord(value) && isPiHostDto(value),
  'Expected a bounded plain Pi Host DTO record.',
)

export const piHostEpochSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER)

export const piHostRuntimeGenerationSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER)

export const piHostSequenceSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER)

export const piHostRequestTimeoutSchema = z
  .number()
  .int()
  .min(1)
  .max(PI_HOST_MAX_REQUEST_TIMEOUT_MS)

export const piHostRuntimeIdSchema = z
  .string()
  .min(1)
  .max(PI_HOST_ID_LIMIT)
  .regex(/^rt_[A-Za-z0-9_-]+$/u)

export const piHostRequestIdSchema = z
  .string()
  .min(1)
  .max(PI_HOST_ID_LIMIT)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/u)

export const piHostProtocolVersionSchema = z.literal(PI_HOST_PROTOCOL_VERSION)

const piHostErrorObjectSchema = z
  .object({
    name: z.string().min(1).max(PI_HOST_ERROR_NAME_LIMIT),
    message: z.string().min(1).max(PI_HOST_ERROR_MESSAGE_LIMIT),
    code: z
      .union([
        z.string().min(1).max(PI_HOST_ERROR_CODE_LIMIT),
        z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
      ])
      .optional(),
    stack: z.string().min(1).max(PI_HOST_ERROR_STACK_LIMIT).optional(),
  })
  .strict()

export type PiHostError = z.infer<typeof piHostErrorObjectSchema>

export const piHostErrorSchema = z
  .custom<PiHostError>(
    (value) => isPlainRecord(value) && isPiHostDto(value),
    'Expected a bounded plain Pi Host error DTO.',
  )
  .pipe(piHostErrorObjectSchema)

const piHostFailureErrorObjectSchema = z
  .object({
    name: z.literal(PI_HOST_FAILURE_NAME),
    message: z.literal(PI_HOST_FAILURE_MESSAGE),
    code: z
      .string()
      .min(1)
      .max(PI_HOST_FAILURE_CODE_LIMIT)
      .regex(/^[A-Z][A-Z0-9_]*$/u),
  })
  .strict()

export type PiHostFailureError = z.infer<
  typeof piHostFailureErrorObjectSchema
>

export const piHostFailureErrorSchema = z
  .custom<PiHostFailureError>(
    (value) => isPlainRecord(value) && isPiHostDto(value),
    'Expected a sanitized Pi Host failure DTO.',
  )
  .pipe(piHostFailureErrorObjectSchema)

function boundedString(value: unknown, limit: number) {
  if (typeof value !== 'string') return undefined
  const bounded = value.slice(0, limit)
  return bounded.length > 0 ? bounded : undefined
}

function readDataProperty(value: object, property: string): unknown {
  let current: object | null = value
  for (let depth = 0; current !== null && depth < 8; depth += 1) {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(current, property)
      if (descriptor) return 'value' in descriptor ? descriptor.value : undefined
      current = Object.getPrototypeOf(current)
    } catch {
      return undefined
    }
  }
  return undefined
}

function readErrorProperty(value: Error, property: 'name' | 'message' | 'stack') {
  try {
    return value[property]
  } catch {
    return undefined
  }
}

/** Converts arbitrary thrown values without retaining their object graph. */
export function normalizePiHostError(
  value: unknown,
  fallbackCode?: string,
): PiHostError {
  const objectValue = typeof value === 'object' && value !== null ? value : null
  const errorValue = value instanceof Error ? value : null
  const name = boundedString(
    errorValue
      ? readErrorProperty(errorValue, 'name')
      : objectValue
        ? readDataProperty(objectValue, 'name')
        : undefined,
    PI_HOST_ERROR_NAME_LIMIT,
  ) ?? 'Error'
  const message = boundedString(
    typeof value === 'string'
      ? value
      : errorValue
        ? readErrorProperty(errorValue, 'message')
        : objectValue
          ? readDataProperty(objectValue, 'message')
          : undefined,
    PI_HOST_ERROR_MESSAGE_LIMIT,
  ) ?? 'Unknown Pi Host error.'
  const stack = boundedString(
    errorValue
      ? readErrorProperty(errorValue, 'stack')
      : objectValue
        ? readDataProperty(objectValue, 'stack')
        : undefined,
    PI_HOST_ERROR_STACK_LIMIT,
  )
  const rawCode = objectValue ? readDataProperty(objectValue, 'code') : undefined
  const normalizedCode = typeof rawCode === 'string'
    ? boundedString(rawCode, PI_HOST_ERROR_CODE_LIMIT)
    : typeof rawCode === 'number' && Number.isSafeInteger(rawCode)
      ? rawCode
      : undefined
  const code = normalizedCode ?? boundedString(
    fallbackCode,
    PI_HOST_ERROR_CODE_LIMIT,
  )

  return piHostErrorSchema.parse({
    name,
    message,
    ...(code === undefined ? {} : { code }),
    ...(stack === undefined ? {} : { stack }),
  })
}

/**
 * Reduces an arbitrary fatal error to a stable code and fixed public text.
 * Fatal Utility errors can contain prompts, credentials, and local paths, so
 * their original message and stack must never cross the Host boundary.
 */
export function sanitizePiHostFailure(
  value: unknown,
  fallbackCode = PI_HOST_FAILURE_FALLBACK_CODE,
): PiHostFailureError {
  const normalized = normalizePiHostError(value, fallbackCode)
  const candidate = typeof normalized.code === 'string'
    ? normalized.code
    : fallbackCode
  const isSafeCode = (code: string) =>
    /^[A-Z][A-Z0-9_]*$/u.test(code) &&
    code.length <= PI_HOST_FAILURE_CODE_LIMIT
  const code = isSafeCode(candidate)
    ? candidate
    : isSafeCode(fallbackCode)
      ? fallbackCode
      : PI_HOST_FAILURE_FALLBACK_CODE

  return piHostFailureErrorSchema.parse({
    name: PI_HOST_FAILURE_NAME,
    message: PI_HOST_FAILURE_MESSAGE,
    code,
  })
}

const protocolMetadataShape = {
  protocolVersion: piHostProtocolVersionSchema,
  hostEpoch: piHostEpochSchema,
}

const requestMetadataShape = {
  ...protocolMetadataShape,
  requestId: piHostRequestIdSchema,
}

const optionalRuntimeMetadataShape = {
  runtimeId: piHostRuntimeIdSchema.optional(),
  runtimeGeneration: piHostRuntimeGenerationSchema.optional(),
}

function hasCompleteRuntimeMetadata(value: {
  runtimeId?: string
  runtimeGeneration?: number
}) {
  return (value.runtimeId === undefined) ===
    (value.runtimeGeneration === undefined)
}

function addRuntimeMetadataIssue(
  value: { runtimeId?: string; runtimeGeneration?: number },
  context: z.RefinementCtx,
) {
  if (hasCompleteRuntimeMetadata(value)) return
  context.addIssue({
    code: 'custom',
    message: 'runtimeId and runtimeGeneration must be present together.',
    path: value.runtimeId === undefined ? ['runtimeId'] : ['runtimeGeneration'],
  })
}

function addEnvelopeSizeIssue(value: unknown, context: z.RefinementCtx) {
  const inspection = inspectPiHostDto(value)
  if (inspection.ok) return
  context.addIssue({
    code: 'custom',
    message: `Invalid Pi Host envelope DTO: ${inspection.code}.`,
  })
}

const versionStringSchema = z.string().min(1).max(PI_HOST_VERSION_LIMIT)
const capabilitySchema = z
  .string()
  .min(1)
  .max(PI_HOST_CAPABILITY_LIMIT)
  .regex(/^[a-z][a-z0-9._-]*$/u)

const hostPathSchema = z.string().min(1).max(PI_HOST_PATH_LIMIT)

export const piHostCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ping') }).strict(),
  z.object({ type: z.literal('shutdown') }).strict(),
  z
    .object({
      type: z.literal('session.rename'),
      sessionFile: hostPathSchema,
      name: z.string().trim().min(1).max(256),
    })
    .strict(),
  z
    .object({
      type: z.literal('runtime.create'),
      runtimeId: piHostRuntimeIdSchema,
      sessionDir: hostPathSchema.optional(),
      sessionFile: hostPathSchema.optional(),
      forkSessionFile: hostPathSchema.optional(),
    })
    .strict()
    .superRefine((command, context) => {
      if (command.sessionFile !== undefined && command.forkSessionFile !== undefined) {
        context.addIssue({
          code: 'custom',
          message: 'Runtime session and fork sources are mutually exclusive.',
          path: [],
        })
      }
    }),
  z.object({ type: z.literal('runtime.bind') }).strict(),
  z.object({ type: z.literal('runtime.reload') }).strict(),
  z
    .object({
      type: z.literal('runtime.command'),
      rpc: localPiRpcCommandSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('runtime.external_submit'),
      message: externalControlPromptSchema,
      mode: externalControlRequestedModeSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('runtime.extension_ui_response'),
      response: localPiExtensionUiResponseSchema,
    })
    .strict(),
  z.object({ type: z.literal('runtime.dispose') }).strict(),
])

export type PiHostCommand = z.infer<typeof piHostCommandSchema>

export const piHostBootstrapEnvelopeSchema = z
  .object({
    kind: z.literal('bootstrap'),
    ...requestMetadataShape,
    expectedSdkVersion: versionStringSchema,
  })
  .strict()
  .superRefine(addEnvelopeSizeIssue)

export type PiHostBootstrapEnvelope = z.infer<
  typeof piHostBootstrapEnvelopeSchema
>

const piHostReadyHandshakeEnvelopeSchema = z
  .object({
    kind: z.literal('handshake'),
    ...requestMetadataShape,
    ok: z.literal(true),
    sdkVersion: versionStringSchema,
    nodeVersion: versionStringSchema,
    electronVersion: versionStringSchema,
    capabilities: z
      .array(capabilitySchema)
      .max(PI_HOST_CAPABILITY_COUNT_LIMIT),
  })
  .strict()
  .superRefine(addEnvelopeSizeIssue)

const piHostFailedHandshakeEnvelopeSchema = z
  .object({
    kind: z.literal('handshake'),
    ...requestMetadataShape,
    ok: z.literal(false),
    error: piHostErrorSchema,
  })
  .strict()
  .superRefine(addEnvelopeSizeIssue)

export const piHostHandshakeEnvelopeSchema = z.union([
  piHostReadyHandshakeEnvelopeSchema,
  piHostFailedHandshakeEnvelopeSchema,
])

export type PiHostHandshakeEnvelope = z.infer<
  typeof piHostHandshakeEnvelopeSchema
>

export const piHostRequestEnvelopeSchema = z
  .object({
    kind: z.literal('request'),
    ...requestMetadataShape,
    ...optionalRuntimeMetadataShape,
    timeoutMs: piHostRequestTimeoutSchema,
    command: piHostCommandSchema,
  })
  .strict()
  .superRefine(addRuntimeMetadataIssue)
  .superRefine((request, context) => {
    const runtimeScoped = request.command.type === 'runtime.bind' ||
      request.command.type === 'runtime.reload' ||
      request.command.type === 'runtime.command' ||
      request.command.type === 'runtime.external_submit' ||
      request.command.type === 'runtime.dispose' ||
      request.command.type === 'runtime.extension_ui_response'
    const hasRuntimeTarget = request.runtimeId !== undefined
    if (runtimeScoped === hasRuntimeTarget) return
    context.addIssue({
      code: 'custom',
      message: runtimeScoped
        ? 'Runtime-scoped commands require Runtime metadata.'
        : 'Host-scoped commands cannot carry Runtime metadata.',
      path: ['command', 'type'],
    })
  })
  .superRefine(addEnvelopeSizeIssue)

export type PiHostRequestEnvelope = z.infer<
  typeof piHostRequestEnvelopeSchema
>

const piHostSuccessResponseEnvelopeSchema = z
  .object({
    kind: z.literal('response'),
    ...requestMetadataShape,
    ...optionalRuntimeMetadataShape,
    ok: z.literal(true),
    result: piHostDtoSchema,
  })
  .strict()
  .superRefine(addRuntimeMetadataIssue)
  .superRefine(addEnvelopeSizeIssue)

const piHostFailureResponseEnvelopeSchema = z
  .object({
    kind: z.literal('response'),
    ...requestMetadataShape,
    ...optionalRuntimeMetadataShape,
    ok: z.literal(false),
    error: piHostErrorSchema,
  })
  .strict()
  .superRefine(addRuntimeMetadataIssue)
  .superRefine(addEnvelopeSizeIssue)

export const piHostResponseEnvelopeSchema = z.union([
  piHostSuccessResponseEnvelopeSchema,
  piHostFailureResponseEnvelopeSchema,
])

export type PiHostResponseEnvelope = z.infer<
  typeof piHostResponseEnvelopeSchema
>

export const piHostFailureEnvelopeSchema = z
  .object({
    kind: z.literal('host_failure'),
    ...protocolMetadataShape,
    error: piHostFailureErrorSchema,
  })
  .strict()
  .superRefine(addEnvelopeSizeIssue)

export type PiHostFailureEnvelope = z.infer<
  typeof piHostFailureEnvelopeSchema
>

export const piHostUiRequestEventEnvelopeSchema = z
  .object({
    kind: z.literal('ui_request'),
    ...protocolMetadataShape,
    runtimeId: piHostRuntimeIdSchema,
    runtimeGeneration: piHostRuntimeGenerationSchema,
    sequence: piHostSequenceSchema,
    request: localPiExtensionUiRequestSchema,
  })
  .strict()
  .superRefine(addEnvelopeSizeIssue)

export type PiHostUiRequestEventEnvelope = z.infer<
  typeof piHostUiRequestEventEnvelopeSchema
>
export const piHostEventEnvelopeSchema = z
  .object({
    kind: z.literal('event'),
    ...protocolMetadataShape,
    runtimeId: piHostRuntimeIdSchema,
    runtimeGeneration: piHostRuntimeGenerationSchema,
    sequence: piHostSequenceSchema,
    event: piHostDtoRecordSchema,
  })
  .strict()
  .superRefine(addEnvelopeSizeIssue)

export type PiHostEventEnvelope = z.infer<typeof piHostEventEnvelopeSchema>

export const piHostCreditEnvelopeSchema = z
  .object({
    kind: z.literal('credit'),
    ...protocolMetadataShape,
    ...optionalRuntimeMetadataShape,
    throughSequence: piHostSequenceSchema,
  })
  .strict()
  .superRefine(addRuntimeMetadataIssue)
  .superRefine(addEnvelopeSizeIssue)

export type PiHostCreditEnvelope = z.infer<typeof piHostCreditEnvelopeSchema>

export const piHostEnvelopeSchema = z.union([
  piHostBootstrapEnvelopeSchema,
  piHostHandshakeEnvelopeSchema,
  piHostRequestEnvelopeSchema,
  piHostResponseEnvelopeSchema,
  piHostFailureEnvelopeSchema,
  piHostEventEnvelopeSchema,
  piHostUiRequestEventEnvelopeSchema,
  piHostCreditEnvelopeSchema,
])

export type PiHostEnvelope = z.infer<typeof piHostEnvelopeSchema>

export const piHostEnvelopeMetadataSchema = z
  .object({
    hostEpoch: piHostEpochSchema,
    ...optionalRuntimeMetadataShape,
  })
  .strict()
  .superRefine(addRuntimeMetadataIssue)

export type PiHostEnvelopeMetadata = z.infer<
  typeof piHostEnvelopeMetadataSchema
>

/**
 * Host-only expectations ignore a candidate's Runtime target. Supplying a
 * Runtime target makes both its ID and generation part of the freshness check.
 */
export function isCurrentPiHostEnvelope(
  candidate: PiHostEnvelopeMetadata,
  expected: PiHostEnvelopeMetadata,
) {
  if (candidate.hostEpoch !== expected.hostEpoch) return false
  if (expected.runtimeId === undefined) return true
  return candidate.runtimeId === expected.runtimeId &&
    candidate.runtimeGeneration === expected.runtimeGeneration
}
