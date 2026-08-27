import { randomUUID } from 'node:crypto'
import {
  EXTERNAL_CONTROL_MAX_RECENT_ROWS,
  ExternalControlError,
  externalControlSettingsSnapshotSchema,
  sanitizeExternalControlError,
  type ExternalControlOperation,
  type ExternalControlRecentOperationRow,
  type ExternalControlSettingsSnapshot,
} from '../../shared/external-control'
import type { ExternalControlPreferenceRepository } from './preference-repository'

type SettingsListener = (snapshot: ExternalControlSettingsSnapshot) => void
type OperationListener = (operation: ExternalControlOperation) => void

export type ExternalControlMcpConfiguration = NonNullable<
  ExternalControlSettingsSnapshot['configuration']
>

export interface ExternalControlLifecycleSession {
  start(): Promise<void>
  closeBridge(): Promise<void>
  disposeControl(): Promise<void>
  getConversationLabel(conversationId: string): string | undefined
  subscribeOperations(listener: OperationListener): () => boolean | void
}

export interface ExternalControlLifecycleSessionCallbacks {
  onClientCountChanged(count: number): void
}

export interface ExternalControlLifecycleServiceOptions {
  preferenceRepository: Pick<ExternalControlPreferenceRepository, 'get' | 'set'>
  configuration: ExternalControlMcpConfiguration | null
  createSession(
    callbacks: ExternalControlLifecycleSessionCallbacks,
  ): ExternalControlLifecycleSession
  createPresentationId?: () => string
}

interface ActiveSession {
  generation: number
  session: ExternalControlLifecycleSession
  unsubscribeOperations: () => boolean | void
}

const unavailableError = {
  code: 'pipilot_unavailable' as const,
  message: 'A packaged PiPilot MCP command is unavailable in this build.',
}

export class ExternalControlLifecycleService {
  private readonly listeners = new Set<SettingsListener>()
  private readonly configuration: ExternalControlMcpConfiguration | null
  private snapshot: ExternalControlSettingsSnapshot
  private readonly recentRows = new Map<string, ExternalControlRecentOperationRow>()
  private recentOperations: ExternalControlSettingsSnapshot['recentOperations'] = []
  private activeSession: ActiveSession | null = null
  private transitionTail = Promise.resolve()
  private initializePromise: Promise<ExternalControlSettingsSnapshot> | null = null
  private disposePromise: Promise<void> | null = null
  private nextGeneration = 0
  private requestedEnabled = false
  private persistedEnabled = false
  private disposed = false

  constructor(private readonly options: ExternalControlLifecycleServiceOptions) {
    this.configuration = options.configuration
      ? structuredClone(options.configuration)
      : null
    this.snapshot = externalControlSettingsSnapshotSchema.parse({
      revision: 0,
      enabled: false,
      state: this.configuration ? 'disabled' : 'unavailable',
      connectedClients: 0,
      ...(this.configuration ? { configuration: this.configuration } : {}),
      recentOperations: [],
      ...(this.configuration ? {} : { error: unavailableError }),
    })
  }

  initialize() {
    if (this.initializePromise) return this.initializePromise
    this.initializePromise = this.enqueue(async () => {
      if (this.disposed) return this.getSnapshot()
      try {
        this.persistedEnabled = this.options.preferenceRepository.get()
      } catch (error) {
        this.publish('error', false, 0, sanitizeExternalControlError(error))
        return this.getSnapshot()
      }
      this.requestedEnabled = this.persistedEnabled
      if (!this.configuration) {
        this.publish(
          'unavailable',
          this.persistedEnabled,
          0,
          unavailableError,
        )
      } else if (this.requestedEnabled) {
        await this.enableDesiredSession()
      } else {
        this.publish('disabled', false, 0)
      }
      return this.getSnapshot()
    })
    return this.initializePromise
  }

  getSnapshot() {
    return externalControlSettingsSnapshotSchema.parse(
      structuredClone(this.snapshot),
    )
  }

  subscribe(listener: SettingsListener) {
    if (this.disposed) return () => false
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async setEnabled(enabled: boolean) {
    await this.initialize()
    this.assertActive()
    if (!this.configuration) {
      if (enabled) {
        throw new ExternalControlError(
          'pipilot_unavailable',
          unavailableError.message,
        )
      }
      this.requestedEnabled = false
      try {
        this.persistedEnabled = this.options.preferenceRepository.set(false)
        this.publish('unavailable', false, 0, unavailableError)
      } catch (error) {
        this.publish(
          'error',
          this.persistedEnabled,
          0,
          sanitizeExternalControlError(error),
        )
      }
      return this.getSnapshot()
    }

    this.requestedEnabled = enabled
    return this.enqueue(async () => {
      this.assertActive()
      if (this.requestedEnabled) await this.enableDesiredSession()
      else await this.disableDesiredSession()
      return this.getSnapshot()
    })
  }

  dispose() {
    if (this.disposePromise) return this.disposePromise
    this.disposed = true
    this.requestedEnabled = false
    this.disposePromise = this.enqueue(async () => {
      const active = this.activeSession
      if (active) await this.stopSession(active)
      this.listeners.clear()
    })
    return this.disposePromise
  }

  private enqueue<T>(operation: () => Promise<T>) {
    const pending = this.transitionTail.then(operation, operation)
    this.transitionTail = pending.then(() => undefined, () => undefined)
    return pending
  }

  private async enableDesiredSession() {
    if (this.activeSession && this.snapshot.state === 'ready') return
    try {
      this.persistedEnabled = this.options.preferenceRepository.set(true)
    } catch (error) {
      this.publish(
        'error',
        this.persistedEnabled,
        0,
        sanitizeExternalControlError(error),
      )
      return
    }
    this.recentRows.clear()
    this.recentOperations = []
    this.publish('enabling', true, 0)

    const generation = ++this.nextGeneration
    let active: ActiveSession | null = null
    try {
      const session = this.options.createSession({
        onClientCountChanged: (count) => {
          this.onClientCountChanged(generation, count)
        },
      })
      active = {
        generation,
        session,
        unsubscribeOperations: () => false,
      }
      this.activeSession = active
      active.unsubscribeOperations = session.subscribeOperations((operation) => {
        this.onOperation(generation, operation)
      })
      await session.start()
      if (this.disposed || !this.requestedEnabled) {
        await this.stopSession(active)
        if (!this.disposed) await this.finishDisabledTransition()
        return
      }
      this.publish(
        'ready',
        true,
        this.snapshot.connectedClients,
      )
    } catch (error) {
      if (active) {
        try {
          await this.stopSession(active)
        } catch {
          // The public state below remains a bounded generic failure.
        }
      }
      if (this.disposed) return
      if (!this.requestedEnabled) {
        await this.finishDisabledTransition()
        return
      }
      this.publish(
        'error',
        this.persistedEnabled,
        0,
        sanitizeExternalControlError(error),
      )
    }
  }

  private async disableDesiredSession() {
    if (
      !this.activeSession &&
      !this.persistedEnabled &&
      this.snapshot.state === 'disabled'
    ) return
    this.publish('disabling', false, this.snapshot.connectedClients)
    let stopError: unknown
    const active = this.activeSession
    if (active) {
      try {
        await this.stopSession(active)
      } catch (error) {
        stopError = error
      }
    }
    try {
      this.persistedEnabled = this.options.preferenceRepository.set(false)
    } catch (error) {
      this.publish(
        'error',
        this.persistedEnabled,
        0,
        sanitizeExternalControlError(error),
      )
      return
    }
    if (stopError) {
      this.publish('error', false, 0, sanitizeExternalControlError(stopError))
      return
    }
    this.publish('disabled', false, 0)
  }

  private async finishDisabledTransition() {
    try {
      this.persistedEnabled = this.options.preferenceRepository.set(false)
      this.publish('disabled', false, 0)
    } catch (error) {
      this.publish(
        'error',
        this.persistedEnabled,
        0,
        sanitizeExternalControlError(error),
      )
    }
  }

  private async stopSession(active: ActiveSession) {
    let failure: unknown
    try {
      await active.session.closeBridge()
    } catch (error) {
      failure = error
    }
    try {
      await active.session.disposeControl()
    } catch (error) {
      failure ??= error
    }
    active.unsubscribeOperations()
    if (this.activeSession === active) this.activeSession = null
    if (failure) throw failure
  }

  private onClientCountChanged(generation: number, count: number) {
    if (
      this.disposed ||
      this.activeSession?.generation !== generation ||
      count === this.snapshot.connectedClients
    ) return
    this.publish(
      this.snapshot.state,
      this.snapshot.enabled,
      count,
      this.snapshot.error,
    )
  }

  private onOperation(generation: number, operation: ExternalControlOperation) {
    const active = this.activeSession
    if (this.disposed || active?.generation !== generation) return
    const current = this.recentRows.get(operation.operationId)
    const presentationId = current?.presentationId ?? `row_${
      (this.options.createPresentationId ?? (() => randomUUID().replace(/-/gu, '')))()
    }`
    const conversationLabel = active.session.getConversationLabel(
      operation.conversationId,
    )
    this.recentRows.delete(operation.operationId)
    this.recentRows.set(operation.operationId, {
      presentationId,
      ...(conversationLabel ? { conversationLabel } : {}),
      action: operation.kind,
      status: operation.status,
      timestamp: operation.updatedAt,
    })
    const ordered = [...this.recentRows.entries()]
      .sort(([, left], [, right]) =>
        right.timestamp.localeCompare(left.timestamp))
    for (const [operationId] of ordered.slice(EXTERNAL_CONTROL_MAX_RECENT_ROWS)) {
      this.recentRows.delete(operationId)
    }
    this.recentOperations = ordered
      .slice(0, EXTERNAL_CONTROL_MAX_RECENT_ROWS)
      .map(([, row]) => row)
    this.publish(
      this.snapshot.state,
      this.snapshot.enabled,
      this.snapshot.connectedClients,
      this.snapshot.error,
    )
  }

  private publish(
    state: ExternalControlSettingsSnapshot['state'],
    enabled: boolean,
    connectedClients: number,
    error?: ExternalControlSettingsSnapshot['error'],
  ) {
    this.snapshot = externalControlSettingsSnapshotSchema.parse({
      revision: this.snapshot.revision + 1,
      enabled,
      state,
      connectedClients,
      ...(this.configuration ? { configuration: this.configuration } : {}),
      recentOperations: this.recentOperations,
      ...(error ? { error } : {}),
    })
    const snapshot = this.getSnapshot()
    for (const listener of this.listeners) {
      try {
        listener(snapshot)
      } catch {
        // Isolate settings observers from lifecycle ownership.
      }
    }
  }

  private assertActive() {
    if (this.disposed) {
      throw new ExternalControlError(
        'external_control_disabled',
        'PiPilot External Control is shutting down.',
      )
    }
  }
}
