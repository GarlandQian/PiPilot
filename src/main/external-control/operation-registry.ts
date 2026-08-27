import { createHash, randomUUID } from 'node:crypto'
import {
  EXTERNAL_CONTROL_MAX_OPERATIONS,
  EXTERNAL_CONTROL_OPERATION_RETENTION_MS,
  ExternalControlError,
  externalControlOperationSchema,
  externalControlReceiptSchema,
  isTerminalExternalControlStatus,
  type ExternalControlOperation,
} from '../../shared/external-control'

type OperationListener = (operation: ExternalControlOperation) => void

interface PrivateOperationRecord {
  operation: ExternalControlOperation
  idempotencyKey: string
  fingerprint: string
}

export interface OperationRegistryOptions {
  createId?: () => string
  now?: () => number
  maxOperations?: number
  retentionMs?: number
}

export interface ReserveOperationInput {
  conversationId: string
  idempotencyKey: string
  kind: 'send_prompt' | 'abort_conversation'
  requestedMode?: 'auto' | 'prompt' | 'follow_up' | 'steer'
  fingerprintSource: unknown
}

function fingerprint(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('base64url')
}

function operationReceipt(operation: ExternalControlOperation) {
  return externalControlReceiptSchema.parse({
    operationId: operation.operationId,
    conversationId: operation.conversationId,
    kind: operation.kind,
    ...(operation.requestedMode ? { requestedMode: operation.requestedMode } : {}),
    status: operation.status,
    receivedAt: operation.receivedAt,
  })
}

export class ConversationMcpOperationRegistry {
  private readonly createId: () => string
  private readonly now: () => number
  private readonly maxOperations: number
  private readonly retentionMs: number
  private readonly operations = new Map<string, PrivateOperationRecord>()
  private readonly idempotency = new Map<string, string>()
  private readonly listeners = new Set<OperationListener>()

  constructor(options: OperationRegistryOptions = {}) {
    this.createId = options.createId ?? (() => randomUUID().replace(/-/gu, ''))
    this.now = options.now ?? Date.now
    this.maxOperations = options.maxOperations ?? EXTERNAL_CONTROL_MAX_OPERATIONS
    this.retentionMs = options.retentionMs ?? EXTERNAL_CONTROL_OPERATION_RETENTION_MS
  }

  reserve(input: ReserveOperationInput) {
    this.prune()
    const nextFingerprint = fingerprint([
      input.kind,
      input.conversationId,
      input.fingerprintSource,
    ])
    const idempotencyIdentity = `${input.kind}:${input.idempotencyKey}`
    const existingId = this.idempotency.get(idempotencyIdentity)
    if (existingId) {
      const existing = this.operations.get(existingId)
      if (!existing) {
        this.idempotency.delete(idempotencyIdentity)
      } else if (existing.fingerprint !== nextFingerprint) {
        throw new ExternalControlError(
          'idempotency_conflict',
          'The idempotency key is already reserved for a different request.',
        )
      } else {
        return {
          created: false as const,
          receipt: operationReceipt(existing.operation),
          operation: structuredClone(existing.operation),
        }
      }
    }

    if (this.operations.size >= this.maxOperations) {
      this.removeOldestTerminal()
    }
    if (this.operations.size >= this.maxOperations) {
      throw new ExternalControlError(
        'invalid_state',
        'PiPilot has reached the active external-operation limit.',
      )
    }

    const timestamp = new Date(this.now()).toISOString()
    const operation = externalControlOperationSchema.parse({
      operationId: `op_${this.createId()}`,
      conversationId: input.conversationId,
      kind: input.kind,
      ...(input.requestedMode ? { requestedMode: input.requestedMode } : {}),
      status: 'received',
      receivedAt: timestamp,
      updatedAt: timestamp,
    })
    const record = {
      operation,
      idempotencyKey: idempotencyIdentity,
      fingerprint: nextFingerprint,
    }
    this.operations.set(operation.operationId, record)
    this.idempotency.set(idempotencyIdentity, operation.operationId)
    this.publish(operation)
    return {
      created: true as const,
      receipt: operationReceipt(operation),
      operation: structuredClone(operation),
    }
  }

  get(operationId: string) {
    this.prune()
    const record = this.operations.get(operationId)
    if (!record) {
      throw new ExternalControlError(
        'operation_not_found',
        'The external operation was not found.',
      )
    }
    return structuredClone(record.operation)
  }

  recent(limit = 50) {
    this.prune()
    return [...this.operations.values()]
      .map((record) => record.operation)
      .sort((left, right) => right.receivedAt.localeCompare(left.receivedAt))
      .slice(0, limit)
      .map((operation) => structuredClone(operation))
  }

  transition(
    operationId: string,
    status: ExternalControlOperation['status'],
    patch: Partial<Pick<
      ExternalControlOperation,
      'acceptedMode' | 'acceptedAt' | 'completedAt' | 'error' | 'finalResponse'
    >> = {},
  ) {
    const record = this.operations.get(operationId)
    if (!record) return null
    if (isTerminalExternalControlStatus(record.operation.status)) {
      return structuredClone(record.operation)
    }
    const timestamp = new Date(this.now()).toISOString()
    record.operation = externalControlOperationSchema.parse({
      ...record.operation,
      ...patch,
      status,
      updatedAt: timestamp,
      ...(status === 'accepted' && !patch.acceptedAt ? { acceptedAt: timestamp } : {}),
      ...(isTerminalExternalControlStatus(status) && !patch.completedAt
        ? { completedAt: timestamp }
        : {}),
    })
    this.publish(record.operation)
    return structuredClone(record.operation)
  }

  subscribe(listener: OperationListener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  wait(
    operationId: string,
    until: 'accepted' | 'terminal',
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<{ reached: boolean; timedOut: boolean; operation: ExternalControlOperation }> {
    const initial = this.get(operationId)
    if (this.reached(initial, until)) {
      return Promise.resolve({ reached: true, timedOut: false, operation: initial })
    }
    return new Promise((resolve) => {
      let settled = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const finish = (reached: boolean, timedOut: boolean, operation: ExternalControlOperation) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        unsubscribe()
        signal?.removeEventListener('abort', onAbort)
        resolve({ reached, timedOut, operation })
      }
      const unsubscribe = this.subscribe((operation) => {
        if (operation.operationId !== operationId || !this.reached(operation, until)) return
        finish(true, false, operation)
      })
      const onAbort = () => finish(false, false, this.get(operationId))
      signal?.addEventListener('abort', onAbort, { once: true })
      timer = setTimeout(() => {
        finish(false, true, this.get(operationId))
      }, timeoutMs)
      timer.unref()
      if (signal?.aborted) onAbort()
    })
  }

  clear() {
    this.operations.clear()
    this.idempotency.clear()
    this.listeners.clear()
  }

  private reached(operation: ExternalControlOperation, until: 'accepted' | 'terminal') {
    if (until === 'terminal') return isTerminalExternalControlStatus(operation.status)
    return operation.status === 'accepted' || isTerminalExternalControlStatus(operation.status)
  }

  private publish(operation: ExternalControlOperation) {
    const snapshot = structuredClone(operation)
    for (const listener of this.listeners) {
      try { listener(snapshot) } catch { /* isolate observers */ }
    }
  }

  private prune() {
    const oldest = this.now() - this.retentionMs
    for (const [operationId, record] of this.operations) {
      if (
        Date.parse(record.operation.updatedAt) >= oldest ||
        !isTerminalExternalControlStatus(record.operation.status)
      ) continue
      this.deleteRecord(operationId, record)
    }
  }

  private removeOldestTerminal() {
    const oldest = [...this.operations]
      .filter(([, record]) => isTerminalExternalControlStatus(record.operation.status))
      .sort(([, left], [, right]) => left.operation.updatedAt.localeCompare(right.operation.updatedAt))[0]
    if (oldest) this.deleteRecord(oldest[0], oldest[1])
  }

  private deleteRecord(operationId: string, record: PrivateOperationRecord) {
    this.operations.delete(operationId)
    if (this.idempotency.get(record.idempotencyKey) === operationId) {
      this.idempotency.delete(record.idempotencyKey)
    }
  }
}
