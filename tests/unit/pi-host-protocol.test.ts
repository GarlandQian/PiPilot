import { describe, expect, it } from 'vitest'
import {
  estimatePiHostDtoBytes,
  inspectPiHostDto,
  isCurrentPiHostEnvelope,
  normalizePiHostError,
  sanitizePiHostFailure,
  PI_HOST_ERROR_CODE_LIMIT,
  PI_HOST_ERROR_MESSAGE_LIMIT,
  PI_HOST_ERROR_STACK_LIMIT,
  PI_HOST_MAX_ENVELOPE_BYTES,
  PI_HOST_PROTOCOL_VERSION,
  piHostBootstrapEnvelopeSchema,
  piHostCommandSchema,
  piHostCreditEnvelopeSchema,
  piHostDtoSchema,
  piHostEnvelopeSchema,
  piHostErrorSchema,
  piHostEventEnvelopeSchema,
  piHostFailureEnvelopeSchema,
  piHostHandshakeEnvelopeSchema,
  piHostRequestEnvelopeSchema,
  piHostResponseEnvelopeSchema,
  piHostUiRequestEventEnvelopeSchema,
} from '../../src/shared/pi-host-protocol'

const requestMetadata = {
  protocolVersion: PI_HOST_PROTOCOL_VERSION,
  hostEpoch: 3,
  requestId: 'request-1',
}

const runtimeMetadata = {
  runtimeId: 'rt_primary',
  runtimeGeneration: 7,
}

const requestTimeoutMetadata = { timeoutMs: 500 }

describe('Pi Host envelope protocol', () => {
  it('accepts the versioned bootstrap and successful or failed handshakes', () => {
    const bootstrap = piHostBootstrapEnvelopeSchema.parse({
      kind: 'bootstrap',
      ...requestMetadata,
      expectedSdkVersion: '0.84.2',
    })
    const ready = piHostHandshakeEnvelopeSchema.parse({
      kind: 'handshake',
      ...requestMetadata,
      ok: true,
      sdkVersion: '0.84.2',
      nodeVersion: '24.14.0',
      electronVersion: '43.4.1',
      capabilities: ['message-port', 'runtime'],
    })
    const failed = piHostHandshakeEnvelopeSchema.parse({
      kind: 'handshake',
      ...requestMetadata,
      ok: false,
      error: {
        name: 'Error',
        message: 'The SDK could not be imported.',
        code: 'SDK_IMPORT_FAILED',
      },
    })

    expect(structuredClone(bootstrap)).toEqual(bootstrap)
    expect(structuredClone(ready)).toEqual(ready)
    expect(structuredClone(failed)).toEqual(failed)
    expect(
      piHostBootstrapEnvelopeSchema.safeParse({
        ...bootstrap,
        protocolVersion: PI_HOST_PROTOCOL_VERSION + 1,
      }).success,
    ).toBe(false)
  })

  it('validates request, response, event, and credit correlation metadata', () => {
    const request = piHostRequestEnvelopeSchema.parse({
      kind: 'request',
      ...requestMetadata,
      ...requestTimeoutMetadata,
      ...runtimeMetadata,
      command: { type: 'runtime.command', rpc: { type: 'get_state' } },
    })
    const success = piHostResponseEnvelopeSchema.parse({
      kind: 'response',
      ...requestMetadata,
      ...runtimeMetadata,
      ok: true,
      result: { state: 'ready' },
    })
    const failure = piHostResponseEnvelopeSchema.parse({
      kind: 'response',
      ...requestMetadata,
      ...runtimeMetadata,
      ok: false,
      error: { name: 'Error', message: 'Failed.', code: 'FAILED' },
    })
    const event = piHostEventEnvelopeSchema.parse({
      kind: 'event',
      protocolVersion: PI_HOST_PROTOCOL_VERSION,
      hostEpoch: requestMetadata.hostEpoch,
      ...runtimeMetadata,
      sequence: 11,
      event: { type: 'agent_start' },
    })
    const credit = piHostCreditEnvelopeSchema.parse({
      kind: 'credit',
      protocolVersion: PI_HOST_PROTOCOL_VERSION,
      hostEpoch: requestMetadata.hostEpoch,
      ...runtimeMetadata,
      throughSequence: event.sequence,
    })

    for (const envelope of [request, success, failure, event, credit]) {
      expect(piHostEnvelopeSchema.safeParse(envelope).success).toBe(true)
      expect(structuredClone(envelope)).toEqual(envelope)
    }

    expect(
      piHostRequestEnvelopeSchema.safeParse({
        kind: 'request',
        ...requestMetadata,
        ...requestTimeoutMetadata,
        runtimeId: runtimeMetadata.runtimeId,
        command: { type: 'runtime.command', rpc: { type: 'get_state' } },
      }).success,
    ).toBe(false)
    expect(
      piHostCreditEnvelopeSchema.safeParse({
        kind: 'credit',
        protocolVersion: PI_HOST_PROTOCOL_VERSION,
        hostEpoch: requestMetadata.hostEpoch,
        runtimeGeneration: runtimeMetadata.runtimeGeneration,
        throughSequence: 1,
      }).success,
    ).toBe(false)
  })

  it('keeps external submission Runtime-scoped and UTF-8 bounded', () => {
    const request = piHostRequestEnvelopeSchema.parse({
      kind: 'request',
      ...requestMetadata,
      ...requestTimeoutMetadata,
      ...runtimeMetadata,
      command: {
        type: 'runtime.external_submit',
        message: 'Continue the exact conversation.',
        mode: 'auto',
      },
    })
    expect(request.command).toMatchObject({
      type: 'runtime.external_submit',
      mode: 'auto',
    })
    expect(piHostRequestEnvelopeSchema.safeParse({
      kind: 'request',
      ...requestMetadata,
      ...requestTimeoutMetadata,
      command: request.command,
    }).success).toBe(false)
    expect(piHostCommandSchema.safeParse({
      type: 'runtime.external_submit',
      message: 'Prompt',
      mode: 'guess',
    }).success).toBe(false)
    expect(piHostCommandSchema.safeParse({
      type: 'runtime.external_submit',
      message: 'x'.repeat(128 * 1024 + 1),
      mode: 'prompt',
    }).success).toBe(false)
  })

  it('rejects unknown kinds, extra fields, unsafe counters, and malformed IDs', () => {
    expect(
      piHostEnvelopeSchema.safeParse({
        kind: 'mystery',
        ...requestMetadata,
      }).success,
    ).toBe(false)
    expect(
      piHostRequestEnvelopeSchema.safeParse({
        kind: 'request',
        ...requestMetadata,
        ...requestTimeoutMetadata,
        command: { type: 'ping' },
        unexpected: true,
      }).success,
    ).toBe(false)
    expect(
      piHostRequestEnvelopeSchema.safeParse({
        kind: 'request',
        ...requestMetadata,
        ...requestTimeoutMetadata,
        hostEpoch: Number.MAX_SAFE_INTEGER + 1,
        command: { type: 'ping' },
      }).success,
    ).toBe(false)
    expect(
      piHostRequestEnvelopeSchema.safeParse({
        kind: 'request',
        ...requestMetadata,
        ...requestTimeoutMetadata,
        runtimeId: 'runtime with spaces',
        runtimeGeneration: 1,
        command: { type: 'runtime.dispose' },
      }).success,
    ).toBe(false)
  })

  it('validates extension UI request envelopes and their response commands', () => {
    const uiEnvelope = piHostUiRequestEventEnvelopeSchema.parse({
      kind: 'ui_request',
      protocolVersion: PI_HOST_PROTOCOL_VERSION,
      hostEpoch: 4,
      runtimeId: 'rt_ui',
      runtimeGeneration: 2,
      sequence: 5,
      request: {
        type: 'extension_ui_request',
        id: 'dialog-1',
        method: 'confirm',
        title: 'Allow bash?',
        message: 'Run it?',
      },
    })
    expect(uiEnvelope).toMatchObject({
      kind: 'ui_request',
      runtimeId: 'rt_ui',
      sequence: 5,
    })
    expect(piHostEnvelopeSchema.safeParse(uiEnvelope).success).toBe(true)
    expect(structuredClone(uiEnvelope)).toEqual(uiEnvelope)

    expect(
      piHostUiRequestEventEnvelopeSchema.safeParse({
        ...uiEnvelope,
        request: { ...uiEnvelope.request, id: '' },
      }).success,
    ).toBe(false)

    const responseCommand = piHostCommandSchema.parse({
      type: 'runtime.extension_ui_response',
      response: {
        type: 'extension_ui_response',
        id: 'dialog-1',
        confirmed: true,
      },
    })
    expect(responseCommand.type).toBe('runtime.extension_ui_response')

    expect(
      piHostRequestEnvelopeSchema.safeParse({
        kind: 'request',
        ...requestMetadata,
        ...requestTimeoutMetadata,
        ...runtimeMetadata,
        command: responseCommand,
      }).success,
    ).toBe(true)
    expect(
      piHostRequestEnvelopeSchema.safeParse({
        kind: 'request',
        ...requestMetadata,
        ...requestTimeoutMetadata,
        command: responseCommand,
      }).success,
    ).toBe(false)
  })

  it('keeps Host and Runtime command targeting explicit', () => {
    for (const command of [
      { type: 'ping' },
      { type: 'shutdown' },
      {
        type: 'runtime.create',
        runtimeId: 'rt_created',
        sessionDir: '/tmp/pi-sessions',
        sessionFile: '/tmp/pi-sessions/session.jsonl',
      },
      { type: 'runtime.bind' },
      { type: 'runtime.reload' },
      { type: 'runtime.command', rpc: { type: 'get_messages' } },
      { type: 'runtime.dispose' },
    ]) {
      expect(piHostCommandSchema.safeParse(command).success).toBe(true)
    }

    expect(
      piHostRequestEnvelopeSchema.safeParse({
        kind: 'request',
        ...requestMetadata,
        ...requestTimeoutMetadata,
        command: { type: 'ping' },
      }).success,
    ).toBe(true)
    expect(
      piHostRequestEnvelopeSchema.safeParse({
        kind: 'request',
        ...requestMetadata,
        ...requestTimeoutMetadata,
        command: {
          type: 'runtime.create',
          runtimeId: 'rt_created',
          sessionDir: '/tmp/pi-sessions',
        },
      }).success,
    ).toBe(true)

    expect(
      piHostRequestEnvelopeSchema.safeParse({
        kind: 'request',
        ...requestMetadata,
        ...requestTimeoutMetadata,
        ...runtimeMetadata,
        command: { type: 'ping' },
      }).success,
    ).toBe(false)
    expect(
      piHostRequestEnvelopeSchema.safeParse({
        kind: 'request',
        ...requestMetadata,
        ...requestTimeoutMetadata,
        command: { type: 'runtime.command', rpc: { type: 'get_state' } },
      }).success,
    ).toBe(false)
    expect(
      piHostRequestEnvelopeSchema.safeParse({
        kind: 'request',
        ...requestMetadata,
        ...requestTimeoutMetadata,
        command: { type: 'runtime.bind' },
      }).success,
    ).toBe(false)
    expect(
      piHostRequestEnvelopeSchema.safeParse({
        kind: 'request',
        ...requestMetadata,
        ...requestTimeoutMetadata,
        ...runtimeMetadata,
        command: { type: 'runtime.bind' },
      }).success,
    ).toBe(true)
    expect(
      piHostRequestEnvelopeSchema.safeParse({
        kind: 'request',
        ...requestMetadata,
        ...requestTimeoutMetadata,
        ...runtimeMetadata,
        command: {
          type: 'runtime.create',
          runtimeId: 'rt_created',
          sessionDir: '/tmp/pi-sessions',
        },
      }).success,
    ).toBe(false)
  })

  it('identifies stale host and Runtime metadata without rejecting host-only routing', () => {
    const current = {
      hostEpoch: 4,
      runtimeId: 'rt_primary',
      runtimeGeneration: 9,
    }

    expect(isCurrentPiHostEnvelope(current, current)).toBe(true)
    expect(isCurrentPiHostEnvelope(current, { hostEpoch: 4 })).toBe(true)
    expect(
      isCurrentPiHostEnvelope(current, { ...current, hostEpoch: 3 }),
    ).toBe(false)
    expect(
      isCurrentPiHostEnvelope(current, { ...current, runtimeId: 'rt_replaced' }),
    ).toBe(false)
    expect(
      isCurrentPiHostEnvelope(current, {
        ...current,
        runtimeGeneration: current.runtimeGeneration + 1,
      }),
    ).toBe(false)
  })
})

describe('Pi Host plain DTO boundary', () => {
  it('validates deeply nested DTOs iteratively and permits repeated aliases', () => {
    let deep: Record<string, unknown> = { value: 'leaf' }
    for (let index = 0; index < 2_000; index += 1) deep = { next: deep }
    const shared = { value: 1 }
    const value = { deep, first: shared, second: shared }

    const inspection = inspectPiHostDto(value)

    expect(inspection.ok).toBe(true)
    expect(piHostDtoSchema.safeParse(value).success).toBe(true)
    if (inspection.ok) {
      expect(inspection.maximumDepth).toBeGreaterThan(1_900)
      expect(inspection.estimatedBytes).toBe(estimatePiHostDtoBytes(value))
    }
  })

  it('rejects cycles and values outside the plain DTO subset without throwing', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    const accessor = Object.defineProperty({}, 'value', {
      enumerable: true,
      get: () => 'not read',
    })
    const symbolKey = { safe: true } as Record<PropertyKey, unknown>
    symbolKey[Symbol('hidden')] = 'value'

    const invalidValues: Array<[unknown, string]> = [
      [circular, 'circular-reference'],
      [() => undefined, 'unsupported-type'],
      [1n, 'unsupported-type'],
      [Symbol('value'), 'unsupported-type'],
      [undefined, 'unsupported-type'],
      [Number.NaN, 'invalid-number'],
      [new Date(), 'unsupported-object'],
      [new Map(), 'unsupported-object'],
      [new Error('raw Error'), 'unsupported-object'],
      [accessor, 'accessor-property'],
      [symbolKey, 'symbol-key'],
      [new Array(1), 'sparse-array'],
    ]

    for (const [value, expectedCode] of invalidValues) {
      expect(() => inspectPiHostDto(value)).not.toThrow()
      expect(inspectPiHostDto(value)).toMatchObject({
        ok: false,
        code: expectedCode,
      })
    }

    expect(piHostDtoSchema.safeParse(circular).success).toBe(false)

    expect(
      piHostRequestEnvelopeSchema.safeParse({
        kind: 'request',
        ...requestMetadata,
        ...requestTimeoutMetadata,
        ...runtimeMetadata,
        command: circular,
      }).success,
    ).toBe(false)
    expect(
      piHostEventEnvelopeSchema.safeParse({
        kind: 'event',
        protocolVersion: PI_HOST_PROTOCOL_VERSION,
        hostEpoch: 1,
        ...runtimeMetadata,
        sequence: 1,
        event: { callback: () => undefined },
      }).success,
    ).toBe(false)
  })

  it('uses exact UTF-8 accounting and enforces the envelope safety ceiling', () => {
    expect(inspectPiHostDto('é', { maxBytes: 4 })).toMatchObject({
      ok: true,
      estimatedBytes: 4,
    })
    expect(inspectPiHostDto('é', { maxBytes: 3 })).toMatchObject({
      ok: false,
      code: 'payload-too-large',
    })
    expect(
      piHostRequestEnvelopeSchema.safeParse({
        kind: 'request',
        ...requestMetadata,
        ...requestTimeoutMetadata,
        ...runtimeMetadata,
        command: {
          type: 'runtime.command',
          rpc: {
            type: 'prompt',
            message: 'x'.repeat(PI_HOST_MAX_ENVELOPE_BYTES),
          },
        },
      }).success,
    ).toBe(false)
    expect(
      piHostResponseEnvelopeSchema.safeParse({
        kind: 'response',
        protocolVersion: PI_HOST_PROTOCOL_VERSION,
        hostEpoch: 1,
        requestId: 'req_large_history',
        ...runtimeMetadata,
        ok: true,
        result: { transcript: 'x'.repeat(20 * 1_024 * 1_024) },
      }).success,
    ).toBe(true)
  })
})

describe('Pi Host errors', () => {
  it('sanitizes fatal Host errors and validates the host-scoped terminal envelope', () => {
    const raw = Object.assign(
      new Error('token=secret /Users/private/session.jsonl prompt contents'),
      {
        code: 'RUNTIME_EXTENSION_SHUTDOWN_REQUESTED',
        stack: 'at /Users/private/extension.ts:10:2',
      },
    )
    const error = sanitizePiHostFailure(raw, 'HOST_RUNTIME_FATAL')
    const envelope = piHostFailureEnvelopeSchema.parse({
      kind: 'host_failure',
      protocolVersion: PI_HOST_PROTOCOL_VERSION,
      hostEpoch: 8,
      error,
    })

    expect(error).toEqual({
      name: 'PiHostFatalError',
      message: 'The embedded Pi Host reported a fatal internal failure.',
      code: 'RUNTIME_EXTENSION_SHUTDOWN_REQUESTED',
    })
    expect(JSON.stringify(envelope)).not.toContain('secret')
    expect(JSON.stringify(envelope)).not.toContain('/Users/private')
    expect(piHostEnvelopeSchema.safeParse(envelope).success).toBe(true)
    expect(piHostFailureEnvelopeSchema.safeParse({
      ...envelope,
      error: { ...error, stack: 'private stack' },
    }).success).toBe(false)
    expect(sanitizePiHostFailure(
      Object.assign(new Error('private'), { code: 'unsafe-code' }),
      'HOST_RUNTIME_FATAL',
    ).code).toBe('HOST_RUNTIME_FATAL')
  })

  it('normalizes arbitrary thrown values to a bounded clone-safe diagnostic', () => {
    const error = new Error('m'.repeat(PI_HOST_ERROR_MESSAGE_LIMIT + 100))
    Object.assign(error, {
      code: 'C'.repeat(PI_HOST_ERROR_CODE_LIMIT + 100),
      stack: 's'.repeat(PI_HOST_ERROR_STACK_LIMIT + 100),
    })
    const normalized = normalizePiHostError(error)

    expect(normalized.message).toHaveLength(PI_HOST_ERROR_MESSAGE_LIMIT)
    expect(normalized.code).toHaveLength(PI_HOST_ERROR_CODE_LIMIT)
    expect(normalized.stack).toHaveLength(PI_HOST_ERROR_STACK_LIMIT)
    expect(piHostErrorSchema.safeParse(normalized).success).toBe(true)
    expect(structuredClone(normalized)).toEqual(normalized)
  })

  it('does not retain circular graphs or invoke accessor properties', () => {
    const thrown = Object.defineProperty({}, 'message', {
      enumerable: true,
      get: () => {
        throw new Error('The accessor must not run.')
      },
    }) as Record<string, unknown>
    thrown.self = thrown

    expect(normalizePiHostError(thrown, 'HOST_UNKNOWN')).toEqual({
      name: 'Error',
      message: 'Unknown Pi Host error.',
      code: 'HOST_UNKNOWN',
    })
    expect(piHostErrorSchema.safeParse(thrown).success).toBe(false)
  })
})
