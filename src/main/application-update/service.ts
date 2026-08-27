import { randomUUID } from 'node:crypto'
import {
  applicationUpdateActionResultSchema,
  applicationUpdateChangedEventSchema,
  applicationUpdateSnapshotSchema,
  cloneApplicationUpdateSnapshot,
  compareStableVersions,
  type ApplicationUpdateActionResult,
  type ApplicationUpdateErrorCode,
  type ApplicationUpdateOperation,
  type ApplicationUpdateSnapshot,
} from '../../shared/application-update'
import {
  ApplicationUpdateProviderError,
  type ApplicationUpdateProvider,
  type ApplicationUpdateProviderEvent,
  type ApplicationUpdateProviderUpdate,
} from './providers'

const STARTUP_CHECK_DELAY_MS = 15_000
const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1_000

export interface ApplicationUpdateActiveWork {
  primaryPi: boolean
  runtimePool: boolean
  terminals: boolean
}

export interface ApplicationUpdateServiceOptions {
  provider: ApplicationUpdateProvider
  hasActiveWork?: () => ApplicationUpdateActiveWork
  requestInstallShutdown?: (install: () => void) => Promise<void> | void
  now?: () => number
  setTimeout?: typeof setTimeout
  clearTimeout?: typeof clearTimeout
  setInterval?: typeof setInterval
  clearInterval?: typeof clearInterval
  startupDelayMs?: number
  checkIntervalMs?: number
}

type SnapshotListener = (snapshot: ApplicationUpdateSnapshot) => void

function updateFields(update: ApplicationUpdateProviderUpdate) {
  return {
    availableVersion: update.version,
    releaseUrl: update.releaseUrl,
    releaseSummary: update.releaseSummary,
    releaseDate: update.releaseDate,
  }
}

function errorCodeForOperation(
  operation: ApplicationUpdateOperation,
  error: unknown,
): ApplicationUpdateErrorCode {
  if (error instanceof ApplicationUpdateProviderError) {
    // electron-updater exposes one undifferentiated `error` event. Preserve
    // policy/feed codes, but map its generic operation failure to whichever
    // operation the service currently owns so a failed download is never
    // presented as a failed check.
    if (
      error.code !== 'UPDATE_BUSY' &&
      error.code !== 'UPDATE_CHECK_FAILED' &&
      error.code !== 'UPDATE_DOWNLOAD_FAILED' &&
      error.code !== 'UPDATE_INSTALL_FAILED'
    ) {
      return error.code
    }
  }
  if (operation === 'download') return 'UPDATE_DOWNLOAD_FAILED'
  if (operation === 'install') return 'UPDATE_INSTALL_FAILED'
  return 'UPDATE_CHECK_FAILED'
}

function retryStateForSnapshot(snapshot: ApplicationUpdateSnapshot) {
  if (snapshot.state === 'downloaded') return 'downloaded' as const
  if (snapshot.state === 'available' || snapshot.state === 'downloading') return 'available' as const
  if (snapshot.state === 'error') return snapshot.retryState
  return 'idle' as const
}

export class ApplicationUpdateService {
  private readonly provider: ApplicationUpdateProvider
  private readonly hasActiveWork: () => ApplicationUpdateActiveWork
  private readonly requestInstallShutdown: (install: () => void) => Promise<void> | void
  private readonly now: () => number
  private readonly setTimeoutFn: typeof setTimeout
  private readonly clearTimeoutFn: typeof clearTimeout
  private readonly setIntervalFn: typeof setInterval
  private readonly clearIntervalFn: typeof clearInterval
  private readonly startupDelayMs: number
  private readonly checkIntervalMs: number
  private readonly listeners = new Set<SnapshotListener>()
  private readonly providerUnsubscribe: () => void
  private snapshot: ApplicationUpdateSnapshot
  private revision = 0
  private disposed = false
  private startupTimer: ReturnType<typeof setTimeout> | undefined
  private intervalTimer: ReturnType<typeof setInterval> | undefined
  private checkPromise: Promise<ApplicationUpdateActionResult> | undefined
  private downloadPromise: Promise<ApplicationUpdateActionResult> | undefined
  private operation: ApplicationUpdateOperation | undefined
  private operationToken = 0

  constructor(options: ApplicationUpdateServiceOptions) {
    this.provider = options.provider
    this.hasActiveWork = options.hasActiveWork ?? (() => ({
      primaryPi: false,
      runtimePool: false,
      terminals: false,
    }))
    this.requestInstallShutdown = options.requestInstallShutdown ?? (() => undefined)
    this.now = options.now ?? Date.now
    this.setTimeoutFn = options.setTimeout ?? setTimeout
    this.clearTimeoutFn = options.clearTimeout ?? clearTimeout
    this.setIntervalFn = options.setInterval ?? setInterval
    this.clearIntervalFn = options.clearInterval ?? clearInterval
    this.startupDelayMs = Math.max(0, options.startupDelayMs ?? STARTUP_CHECK_DELAY_MS)
    this.checkIntervalMs = Math.max(1_000, options.checkIntervalMs ?? CHECK_INTERVAL_MS)
    this.snapshot = this.createInitialSnapshot()
    this.providerUnsubscribe = this.provider.subscribe((event) => this.onProviderEvent(event))

    if (this.snapshot.state !== 'disabled') {
      this.startupTimer = this.setTimeoutFn(() => {
        this.startupTimer = undefined
        void this.check('automatic')
      }, this.startupDelayMs)
      this.intervalTimer = this.setIntervalFn(() => {
        void this.check('automatic')
      }, this.checkIntervalMs)
    }
  }

  getSnapshot() {
    return cloneApplicationUpdateSnapshot(this.snapshot)
  }

  subscribe(listener: SnapshotListener) {
    if (this.disposed) return () => undefined
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  check(mode: 'manual' | 'automatic' = 'manual') {
    if (this.disposed) return Promise.resolve(this.acceptedResult())
    if (this.snapshot.state === 'disabled') return Promise.resolve(this.acceptedResult())
    // A downloaded update is an explicit user decision waiting to be installed.
    // Do not let a timer/manual refresh replace it with a newer snapshot.
    if (this.snapshot.state === 'downloaded') return Promise.resolve(this.acceptedResult())
    if (this.checkPromise) return this.checkPromise
    if (this.downloadPromise) return Promise.resolve(this.busyResult('download'))
    const token = ++this.operationToken
    this.operation = 'check'
    this.publish({ state: 'checking' })
    const operation = this.provider.check()
      .then((result) => {
        if (this.disposed || token !== this.operationToken) return this.acceptedResult()
        this.operation = undefined
        if (result === 'current') {
          this.publish({ state: 'current', checkedAt: this.now() })
        } else {
          const comparison = compareStableVersions(
            result.version,
            this.provider.policy.currentVersion,
          )
          if (comparison === null) {
            throw new ApplicationUpdateProviderError(
              'UPDATE_INVALID_RELEASE',
              'The update feed returned an unsupported version.',
            )
          }
          if (comparison <= 0) {
            this.publish({ state: 'current', checkedAt: this.now() })
            return this.acceptedResult()
          }
          this.publish({
            state: 'available',
            ...updateFields(result),
            capability: this.provider.policy.capability,
            checkedAt: this.now(),
          })
        }
        return this.acceptedResult()
      })
      .catch((error: unknown) => {
        if (this.disposed || token !== this.operationToken) return this.acceptedResult()
        this.operation = undefined
        this.publishError('check', error)
        return this.acceptedResult()
      })
      .finally(() => {
        if (this.checkPromise === operation) this.checkPromise = undefined
        if (mode === 'automatic' && this.operation === 'check') this.operation = undefined
      })
    this.checkPromise = operation
    return operation
  }

  download() {
    if (this.disposed) return Promise.resolve(this.acceptedResult())
    if (this.downloadPromise) return this.downloadPromise
    if (this.checkPromise) return Promise.resolve(this.busyResult('check'))
    if (this.snapshot.state !== 'available' || this.snapshot.policy.capability !== 'native-install') {
      this.publishError('download', new ApplicationUpdateProviderError('UPDATE_UNSUPPORTED', 'This update cannot be downloaded by the installed package.'))
      return Promise.resolve(this.acceptedResult())
    }
    const token = ++this.operationToken
    this.operation = 'download'
    const available = this.snapshot
    this.publish({
      state: 'downloading',
      ...updateFieldsFromSnapshot(available),
      capability: 'native-install',
      progress: { percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 },
      checkedAt: this.now(),
    })
    const operation = this.provider.download()
      .then(() => {
        if (this.disposed || token !== this.operationToken) return this.acceptedResult()
        this.operation = undefined
        this.publish({ state: 'downloaded', ...updateFieldsFromSnapshot(this.snapshot), checkedAt: this.now() })
        return this.acceptedResult()
      })
      .catch((error: unknown) => {
        if (this.disposed || token !== this.operationToken) return this.acceptedResult()
        this.operation = undefined
        this.publishError('download', error)
        return this.acceptedResult()
      })
      .finally(() => {
        if (this.downloadPromise === operation) this.downloadPromise = undefined
      })
    this.downloadPromise = operation
    return operation
  }

  async install(confirmActiveWork = false) {
    if (this.disposed) return this.acceptedResult()
    if (this.operation) return this.busyResult(this.operation)
    if (this.snapshot.state !== 'downloaded' || this.snapshot.policy.capability !== 'native-install') {
      this.publishError('install', new ApplicationUpdateProviderError('UPDATE_NOT_DOWNLOADED', 'A downloaded update is required before installation.'))
      return this.acceptedResult()
    }
    const activeWork = this.hasActiveWork()
    const hasActive = activeWork.primaryPi || activeWork.runtimePool || activeWork.terminals
    if (hasActive && !confirmActiveWork) {
      return applicationUpdateActionResultSchema.parse({
        outcome: 'confirmation-required',
        activeWork,
        snapshot: this.getSnapshot(),
      })
    }
    this.operation = 'install'
    try {
      await this.requestInstallShutdown(() => this.provider.install())
      this.operation = undefined
      return this.acceptedResult()
    } catch (error) {
      this.operation = undefined
      this.publishError('install', error)
      return this.acceptedResult()
    }
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    if (this.startupTimer) this.clearTimeoutFn(this.startupTimer)
    if (this.intervalTimer) this.clearIntervalFn(this.intervalTimer)
    this.startupTimer = undefined
    this.intervalTimer = undefined
    this.operationToken += 1
    this.operation = undefined
    this.providerUnsubscribe()
    this.provider.dispose()
    this.listeners.clear()
  }

  private createInitialSnapshot(): ApplicationUpdateSnapshot {
    const provider = this.provider
    if ('reason' in provider && provider.reason) {
      return applicationUpdateSnapshotSchema.parse({
        state: 'disabled',
        revision: 0,
        policy: provider.policy,
        checkedAt: null,
        reason: provider.reason,
      })
    }
    return applicationUpdateSnapshotSchema.parse({
      state: 'idle',
      revision: 0,
      policy: provider.policy,
      checkedAt: null,
    })
  }

  private publish(patch: Record<string, unknown> & { state: ApplicationUpdateSnapshot['state'] }) {
    const base = this.snapshot
    const next: Record<string, unknown> = {
      ...base,
      ...patch,
      revision: ++this.revision,
      policy: this.provider.policy,
      checkedAt: patch.checkedAt === undefined ? base.checkedAt : patch.checkedAt,
    }
    const state = patch.state
    const hasReleaseDetails = state === 'available' || state === 'downloading' || state === 'downloaded'
    const hasCapability = hasReleaseDetails || state === 'error'
    if (!hasReleaseDetails && state !== 'error') {
      delete next.availableVersion
      delete next.releaseUrl
    }
    if (!hasReleaseDetails) {
      delete next.releaseSummary
      delete next.releaseDate
    }
    if (!hasCapability) delete next.capability
    if (state !== 'downloading') delete next.progress
    if (state !== 'error') {
      delete next.operation
      delete next.code
      delete next.recoverable
      delete next.retryState
    }
    if (state !== 'disabled') delete next.reason
    const parsed = applicationUpdateSnapshotSchema.parse(next)
    this.snapshot = parsed
    for (const listener of this.listeners) {
      try {
        listener(cloneApplicationUpdateSnapshot(parsed))
      } catch {
        // One renderer subscriber cannot interrupt update state ownership.
      }
    }
  }

  private publishError(operation: ApplicationUpdateOperation, error: unknown) {
    const code = errorCodeForOperation(operation, error)
    const previous = this.snapshot
    const availableVersion = 'availableVersion' in previous ? previous.availableVersion : null
    const releaseUrl = 'releaseUrl' in previous ? previous.releaseUrl : this.provider.policy.releaseUrl
    this.publish({
      state: 'error',
      operation,
      code,
      capability: this.provider.policy.capability,
      recoverable: code !== 'UPDATE_UNSUPPORTED' && code !== 'UPDATE_INVALID_FEED' && code !== 'UPDATE_INVALID_RELEASE',
      retryState: retryStateForSnapshot(previous),
      availableVersion,
      releaseUrl,
      checkedAt: this.now(),
    })
  }

  private onProviderEvent(event: ApplicationUpdateProviderEvent) {
    if (this.disposed) return
    // Provider EventEmitter callbacks can arrive after the promise for an
    // operation has settled. Without an owning operation, such a late event is
    // stale and must not overwrite the current revision.
    if (!this.operation) return
    if (event.type === 'checking') {
      if (this.operation === 'check') this.publish({ state: 'checking' })
      return
    }
    if (event.type === 'current') {
      if (this.operation === 'check') this.publish({ state: 'current', checkedAt: this.now() })
      return
    }
    if (event.type === 'available') {
      if (this.operation === 'check') {
        this.publish({
          state: 'available',
          ...updateFields(event.update),
          capability: this.provider.policy.capability,
          checkedAt: this.now(),
        })
      }
      return
    }
    if (event.type === 'progress') {
      if (this.operation !== 'download' || this.snapshot.state !== 'downloading') return
      this.publish({ state: 'downloading', progress: event.progress })
      return
    }
    if (event.type === 'downloaded') {
      if (this.operation === 'download') {
        this.publish({ state: 'downloaded', ...updateFieldsFromSnapshot(this.snapshot), checkedAt: this.now() })
      }
      return
    }
    if (event.type === 'error') {
      const operation = this.operation ?? 'check'
      this.publishError(operation, event.error)
    }
  }

  private acceptedResult(): ApplicationUpdateActionResult {
    return applicationUpdateActionResultSchema.parse({ outcome: 'accepted', snapshot: this.getSnapshot() })
  }

  private busyResult(operation: ApplicationUpdateOperation): ApplicationUpdateActionResult {
    return applicationUpdateActionResultSchema.parse({ outcome: 'busy', operation, snapshot: this.getSnapshot() })
  }
}

function updateFieldsFromSnapshot(snapshot: ApplicationUpdateSnapshot) {
  if (
    snapshot.state === 'available' ||
    snapshot.state === 'downloading' ||
    snapshot.state === 'downloaded'
  ) {
    return {
      availableVersion: snapshot.availableVersion,
      releaseUrl: snapshot.releaseUrl,
      releaseSummary: snapshot.releaseSummary,
      releaseDate: snapshot.releaseDate,
    }
  }
  return {
    availableVersion: snapshot.state === 'error' ? snapshot.availableVersion : snapshot.policy.currentVersion,
    releaseUrl: snapshot.state === 'error' ? snapshot.releaseUrl : snapshot.policy.releaseUrl,
    releaseSummary: null,
    releaseDate: null,
  }
}

export function applicationUpdateEvent(snapshot: ApplicationUpdateSnapshot) {
  return applicationUpdateChangedEventSchema.parse({ eventId: randomUUID(), snapshot })
}
