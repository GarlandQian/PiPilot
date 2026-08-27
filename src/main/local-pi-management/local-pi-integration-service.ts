import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import { realpath } from 'node:fs/promises'
import {
  PI_INTEGRATION_DIAGNOSTIC_LIMIT,
  piIntegrationOperationResultSchema,
  piIntegrationOperationSchema,
  piIntegrationScopeKey,
  piIntegrationScopeSchema,
  piIntegrationSnapshotSchema,
  type PiIntegrationOperation,
  type PiIntegrationOperationKind,
  type PiIntegrationOperationResult,
  type PiIntegrationScope,
  type PiIntegrationSnapshot,
  type PiManagementHelperCommand,
  type PiManagementModelsPayload,
  type PiManagementProgress,
  type PiManagementSnapshotPayload,
} from '../../shared/pi-integrations'
import type { ConversationScope } from '../../shared/conversation-scope'
import {
  PI_MCP_ADAPTER_SOURCE,
  isManagedMcpPackageSource,
} from '../../shared/pi-package-adapters'
import type { ConversationScopeResolver } from '../conversations/conversation-scope-resolver'
import type { PiRuntimeFrontend } from '../pi-host/pi-runtime-frontend'
import {
  LocalPiManagementHostError,
  type LocalPiManagementHost,
} from './local-pi-management-host'
import { VERSION as BUNDLED_PI_VERSION } from '@earendil-works/pi-coding-agent'

const RESTART_MARKER_VERSION = 1
const MAX_RESTART_MARKERS = 1_000
const RESTART_MARKER_FILE_LIMIT = 128 * 1_024
const MANAGED_PACKAGE_STATE_VERSION = 1
const MANAGED_PACKAGE_STATE_FILE_LIMIT = 4 * 1_024

export type LocalPiIntegrationErrorCode =
  | 'PI_INTEGRATIONS_DISPOSED'
  | 'PI_INTEGRATIONS_SCOPE_UNAVAILABLE'
  | 'PI_INTEGRATIONS_STALE'
  | 'PI_INTEGRATIONS_RUNTIME_RESTART_FAILED'
  | 'PI_INTEGRATIONS_RUNTIME_SYNC_FAILED'
  | 'PI_INTEGRATIONS_OPERATION_FAILED'

export class LocalPiIntegrationError extends Error {
  constructor(
    readonly code: LocalPiIntegrationErrorCode | string,
    message: string,
    readonly recoverable = true,
  ) {
    super(message)
    this.name = 'LocalPiIntegrationError'
  }
}

interface CapturedManagementTarget {
  sdkVersion: string
  scope: PiIntegrationScope
  cwd: string
  markerKey: string
}

interface LocalPiIntegrationServiceOptions {
  getActiveScope(): ConversationScope
  helperHost: LocalPiManagementHost
  managedPackageStatePath: string
  restartMarkerPath: string
  runtimeHost: Pick<PiRuntimeFrontend, 'getSnapshot' | 'request' | 'restart'>
  reloadHosts(scope: PiIntegrationScope, cwd: string): Promise<void>
  restartHosts(scope: PiIntegrationScope, cwd: string): Promise<void>
  scopeResolver: Pick<ConversationScopeResolver, 'prepare' | 'resolve'>
  createId?: () => string
  now?: () => number
}

type OperationListener = (operation: PiIntegrationOperation) => void

interface RestartMarkerDocument {
  version: number
  markers: string[]
}

interface ManagedPackageStateDocument {
  version: number
  mcpOptedOut: boolean
}

function sameScope(left: ConversationScope, right: PiIntegrationScope) {
  if (right.kind === 'global') return true
  return left.kind === 'project' && left.workspaceId === right.workspaceId
}

function integrationScopeForConversation(scope: ConversationScope): PiIntegrationScope {
  return scope.kind === 'project'
    ? { kind: 'project', workspaceId: scope.workspaceId }
    : { kind: 'global' }
}

function markerKey(scope: PiIntegrationScope) {
  return createHash('sha256')
    .update(`${BUNDLED_PI_VERSION}\0${piIntegrationScopeKey(scope)}`)
    .digest('hex')
}

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message.slice(0, 2_048)
    : 'The Pi integration operation failed.'
}

/**
 * Bundled-SDK package/config management service.
 *
 * Package and config mutations run through the isolated pi-management-helper
 * held inside its own process. Identity is the exact bundled Pi SDK version
 * combined with the management scope: there is no discovered executable path.
 */
export class LocalPiIntegrationService {
  private readonly listeners = new Set<OperationListener>()
  private readonly createId: () => string
  private readonly now: () => number
  private readonly managedPackageStatePath: string
  private readonly restartMarkerPath: string
  private restartMarkers = new Set<string>()
  private restartMarkersLoaded: Promise<void> | null = null
  private restartMarkerPersistenceFailed = false
  private managedPackageStateLoaded: Promise<void> | null = null
  private managedPackageStatePersistenceFailed = false
  private mcpOptedOut = false
  private recommendedInstallFlight: Promise<void> | null = null
  private recommendedInstallDiagnostic: PiIntegrationSnapshot['diagnostics'][number] | null = null
  private sdkModuleRootPromise: Promise<string> | null = null
  private snapshotGeneration = 0
  private mutationChain: Promise<unknown> = Promise.resolve()
  private snapshotFlights = new Map<string, Promise<PiIntegrationSnapshot>>()
  private disposed = false

  constructor(private readonly options: LocalPiIntegrationServiceOptions) {
    if (!isAbsolute(options.managedPackageStatePath)) {
      throw new Error('The Pi managed package state path must be absolute.')
    }
    if (!isAbsolute(options.restartMarkerPath)) {
      throw new Error('The Pi integration restart marker path must be absolute.')
    }
    this.managedPackageStatePath = resolve(options.managedPackageStatePath)
    this.restartMarkerPath = resolve(options.restartMarkerPath)
    this.createId = options.createId ?? randomUUID
    this.now = options.now ?? Date.now
  }

  subscribe(listener: OperationListener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * Best-effort installation of PiPilot's one managed recommended package.
   * The operation is single-flight and never blocks chat/Host startup.
   */
  ensureRecommendedPackages(): Promise<void> {
    this.assertActive()
    if (this.recommendedInstallFlight) return this.recommendedInstallFlight
    const flight = this.ensureRecommendedPackagesUncached()
      .catch((error) => {
        this.recommendedInstallDiagnostic = {
          code: 'PI_MCP_ADAPTER_AUTO_INSTALL_FAILED',
          message: errorMessage(error),
          severity: 'warning',
          source: PI_MCP_ADAPTER_SOURCE,
        }
      })
      .finally(() => {
        if (this.recommendedInstallFlight === flight) {
          this.recommendedInstallFlight = null
        }
      })
    this.recommendedInstallFlight = flight
    return flight
  }

  async load(rawScope: PiIntegrationScope, checkUpdates = false) {
    this.assertActive()
    const scope = piIntegrationScopeSchema.parse(rawScope)
    const flightKey = `${piIntegrationScopeKey(scope)}:${checkUpdates}`
    const existing = this.snapshotFlights.get(flightKey)
    if (existing) return existing
    const promise = this.loadUncached(scope, checkUpdates)
    this.snapshotFlights.set(flightKey, promise)
    void promise.finally(() => {
      if (this.snapshotFlights.get(flightKey) === promise) {
        this.snapshotFlights.delete(flightKey)
      }
    }).catch(() => undefined)
    return promise
  }

  install(scope: PiIntegrationScope, source: string) {
    return this.packageMutation('install', scope, source)
  }

  update(scope: PiIntegrationScope, source: string) {
    return this.packageMutation('update', scope, source)
  }

  remove(scope: PiIntegrationScope, source: string) {
    return this.packageMutation('remove', scope, source)
  }

  checkUpdates(scope: PiIntegrationScope) {
    return this.enqueueOperation('check-updates', scope, undefined, async (operation) => {
      const target = await this.captureTarget(operation.scope)
      const payload = await this.runHelper(target, {
        action: 'check-updates',
        operationId: operation.operationId,
      }, (progress) => this.progress(operation, progress))
      return this.operationResult(
        operation.operationId,
        await this.composeSnapshot(target, payload),
      )
    })
  }

  /*
   * Lightweight helper runs for the models settings surface. They bypass the
   * serialized operation queue (no operation events) but reuse the exact same
   * bundled-SDK identity capture and staleness checks as package mutations.
   */
  async modelsDefaults(): Promise<PiManagementModelsPayload> {
    this.assertActive()
    const scope: PiIntegrationScope = { kind: 'global' }
    const target = await this.captureTarget(scope)
    const payload = await this.runHelper(target, {
      action: 'models-defaults',
      operationId: this.createId(),
    })
    this.assertCurrent(target)
    return this.requireModelsPayload(payload)
  }

  async setDefaultModel(providerId: string, modelId: string): Promise<PiManagementModelsPayload> {
    this.assertActive()
    const scope: PiIntegrationScope = { kind: 'global' }
    const target = await this.captureTarget(scope)
    const payload = await this.runHelper(target, {
      action: 'set-default-model',
      operationId: this.createId(),
      providerId,
      modelId,
    })
    this.assertCurrent(target)
    const models = this.requireModelsPayload(payload)
    if (models.settingsUpdated !== true) {
      throw new LocalPiIntegrationError(
        'PI_INTEGRATIONS_OPERATION_FAILED',
        'The Pi management helper did not confirm the default model update.',
      )
    }
    return models
  }

  async testModel(
    content: string,
    providerId: string,
    modelId: string,
  ) {
    this.assertActive()
    const scope: PiIntegrationScope = { kind: 'global' }
    const target = await this.captureTarget(scope)
    const payload = await this.runHelper(target, {
      action: 'test-model',
      operationId: this.createId(),
      content,
      providerId,
      modelId,
    })
    this.assertCurrent(target)
    const test = this.requireModelsPayload(payload).test
    if (!test) {
      throw new LocalPiIntegrationError(
        'PI_MANAGEMENT_HELPER_PROTOCOL_ERROR',
        'The Pi management helper did not return a model test result.',
      )
    }
    return test
  }

  setRetryEnabled(scope: PiIntegrationScope, enabled: boolean) {
    return this.enqueueOperation('set-retry', scope, undefined, async (operation) => {
      const target = await this.requireTarget(operation.scope)
      const payload = await this.runHelper(target, {
        action: 'set-retry',
        operationId: operation.operationId,
        enabled,
      }, (progress) => this.progress(operation, progress))
      this.assertCurrent(target)

      // Persistence is authoritative. Runtime synchronization is a separate,
      // best-effort step and must never make a successful global write appear
      // project-scoped or roll it back.
      let runtimeSync: PiIntegrationOperationResult['runtimeSync'] = 'persisted-only'
      let runtimeError: string | undefined =
        'The selected Pi runtime is not ready for retry synchronization.'
      const runtime = this.options.runtimeHost.getSnapshot()
      if (runtime.state === 'ready') {
        const runtimeGeneration = runtime.generation
        try {
          // A global retry write is intentionally allowed while a project
          // conversation is active. The persisted operation is still global,
          // but the running project runtime must receive its own merged
          // effective value (including any project override) before sync.
          const activeScope = integrationScopeForConversation(this.options.getActiveScope())
          let runtimeTarget = target
          let runtimeEnabled = payload.retry.effective.enabled
          if (piIntegrationScopeKey(activeScope) !== piIntegrationScopeKey(target.scope)) {
            runtimeTarget = await this.requireTarget(activeScope)
            if (runtimeTarget.cwd !== runtime.cwd) {
              throw new LocalPiIntegrationError(
                'PI_INTEGRATIONS_RUNTIME_SYNC_FAILED',
                'The selected Pi runtime scope changed before retry synchronization.',
              )
            }
            const runtimePayload = await this.runHelper(runtimeTarget, {
              action: 'snapshot',
              operationId: this.createId(),
            })
            this.assertCurrent(runtimeTarget)
            runtimeEnabled = runtimePayload.retry.effective.enabled
          } else if (target.cwd !== runtime.cwd) {
            throw new LocalPiIntegrationError(
              'PI_INTEGRATIONS_RUNTIME_SYNC_FAILED',
              'The selected Pi runtime scope is not ready for retry synchronization.',
            )
          }

          const settledBeforeRequest = this.options.runtimeHost.getSnapshot()
          if (
            settledBeforeRequest.state !== 'ready' ||
            settledBeforeRequest.generation !== runtimeGeneration ||
            settledBeforeRequest.cwd !== runtime.cwd
          ) {
            throw new LocalPiIntegrationError(
              'PI_INTEGRATIONS_RUNTIME_SYNC_FAILED',
              'The Pi runtime changed before retry synchronization settled.',
            )
          }
          const response = await this.options.runtimeHost.request({
            type: 'set_auto_retry',
            enabled: runtimeEnabled,
          })
          if (!response.success) {
            throw new LocalPiIntegrationError(
              'PI_INTEGRATIONS_RUNTIME_SYNC_FAILED',
              response.error || 'Pi rejected the retry setting.',
            )
          }
          const settledRuntime = this.options.runtimeHost.getSnapshot()
          if (
            settledRuntime.state !== 'ready' ||
            settledRuntime.generation !== runtimeGeneration ||
            settledRuntime.cwd !== runtime.cwd
          ) {
            throw new LocalPiIntegrationError(
              'PI_INTEGRATIONS_RUNTIME_SYNC_FAILED',
              'The Pi runtime changed before retry synchronization settled.',
            )
          }
          runtimeSync = 'synchronized'
          runtimeError = undefined
        } catch (error) {
          runtimeSync = 'persisted-only'
          runtimeError = errorMessage(error)
        }
      }
      return this.operationResult(
        operation.operationId,
        await this.composeSnapshot(target, payload),
        runtimeSync,
        runtimeError,
      )
    })
  }

  restart(scope: PiIntegrationScope) {
    return this.enqueueOperation('restart', scope, undefined, async (operation) => {
      const target = await this.requireTarget(operation.scope)
      try {
        await this.options.restartHosts(target.scope, target.cwd)
      } catch (error) {
        throw new LocalPiIntegrationError(
          'PI_INTEGRATIONS_RUNTIME_RESTART_FAILED',
          errorMessage(error),
        )
      }
      this.assertCurrent(target)
      const payload = await this.runHelper(target, {
        action: 'snapshot',
        operationId: operation.operationId,
      }, (progress) => this.progress(operation, progress))
      this.assertCurrent(target)
      await this.setRestartMarker(target.markerKey, false)
      return this.operationResult(
        operation.operationId,
        await this.composeSnapshot(target, payload),
        'synchronized',
      )
    })
  }

  async dispose() {
    if (this.disposed) return
    this.disposed = true
    this.listeners.clear()
    await this.options.helperHost.dispose()
  }

  private packageMutation(
    kind: 'install' | 'update' | 'remove',
    scope: PiIntegrationScope,
    source: string,
  ) {
    return this.enqueueOperation(kind, scope, source, async (operation) => {
      const target = await this.requireTarget(operation.scope)
      const payload = await this.runHelper(target, {
        action: kind,
        operationId: operation.operationId,
        source,
      }, (progress) => this.progress(operation, progress))
      await this.setRestartMarker(target.markerKey, true)
      this.assertCurrent(target)
      if (target.scope.kind === 'global' && isManagedMcpPackageSource(source)) {
        await this.setMcpOptOut(kind === 'remove')
        if (kind !== 'remove') this.recommendedInstallDiagnostic = null
      }

      let runtimeSync: PiIntegrationOperationResult['runtimeSync'] = 'persisted-only'
      let runtimeError: string | undefined
      try {
        await this.options.reloadHosts(target.scope, target.cwd)
        runtimeSync = 'synchronized'
      } catch (reloadError) {
        try {
          await this.options.restartHosts(target.scope, target.cwd)
          runtimeSync = 'synchronized'
        } catch (restartError) {
          runtimeError = [
            `Runtime reload failed: ${errorMessage(reloadError)}`,
            `Host restart failed: ${errorMessage(restartError)}`,
          ].join('\n')
        }
      }
      this.assertCurrent(target)
      if (runtimeSync === 'synchronized') {
        await this.setRestartMarker(target.markerKey, false)
      }
      return this.operationResult(
        operation.operationId,
        await this.composeSnapshot(target, payload),
        runtimeSync,
        runtimeError,
      )
    })
  }

  private enqueueOperation(
    kind: PiIntegrationOperationKind,
    rawScope: PiIntegrationScope,
    source: string | undefined,
    task: (operation: PiIntegrationOperation) => Promise<PiIntegrationOperationResult>,
  ) {
    this.assertActive()
    const scope = piIntegrationScopeSchema.parse(rawScope)
    const operation = piIntegrationOperationSchema.parse({
      operationId: this.createId(),
      kind,
      phase: 'queued',
      scope,
      ...(source ? { source } : {}),
      startedAt: this.now(),
    })
    this.publish(operation)

    const run = this.mutationChain.catch(() => undefined).then(async () => {
      this.assertActive()
      this.publish({ ...operation, phase: 'running' })
      try {
        const result = await task(operation)
        this.publish({
          ...operation,
          phase: 'succeeded',
          finishedAt: this.now(),
        })
        return result
      } catch (error) {
        this.publish({
          ...operation,
          phase: 'failed',
          message: errorMessage(error),
          finishedAt: this.now(),
        })
        if (error instanceof LocalPiIntegrationError) throw error
        if (error instanceof LocalPiManagementHostError) {
          throw new LocalPiIntegrationError(
            error.code,
            error.message,
            error.recoverable,
          )
        }
        throw new LocalPiIntegrationError(
          'PI_INTEGRATIONS_OPERATION_FAILED',
          errorMessage(error),
        )
      }
    })
    this.mutationChain = run.catch(() => undefined)
    return run
  }

  private progress(operation: PiIntegrationOperation, progress: PiManagementProgress) {
    this.publish({ ...operation, phase: 'progress', progress })
  }

  private publish(rawOperation: PiIntegrationOperation) {
    const operation = piIntegrationOperationSchema.parse(rawOperation)
    for (const listener of this.listeners) {
      try {
        listener(structuredClone(operation))
      } catch {
        // A renderer bridge listener cannot interrupt the owning operation.
      }
    }
  }

  private async ensureRecommendedPackagesUncached(): Promise<void> {
    await this.ensureManagedPackageStateLoaded()
    if (this.mcpOptedOut) return

    const scope: PiIntegrationScope = { kind: 'global' }
    const target = await this.captureTarget(scope)
    const payload = await this.runHelper(target, {
      action: 'snapshot',
      operationId: this.createId(),
    })
    this.assertCurrent(target)
    if (payload.packages.some((pkg) => isManagedMcpPackageSource(pkg.source))) {
      this.recommendedInstallDiagnostic = null
      return
    }

    await this.install(scope, PI_MCP_ADAPTER_SOURCE)
  }

  private async loadUncached(
    scope: PiIntegrationScope,
    checkUpdates: boolean,
  ) {
    const target = await this.captureTarget(scope)
    const operationId = this.createId()
    const payload = await this.runHelper(target, {
      action: checkUpdates ? 'check-updates' : 'snapshot',
      operationId,
    })
    this.assertCurrent(target)
    return this.composeSnapshot(target, payload)
  }

  private async captureTarget(
    scope: PiIntegrationScope,
  ): Promise<CapturedManagementTarget> {
    let cwd: string
    if (scope.kind === 'global') {
      cwd = (await this.options.scopeResolver.prepare({ kind: 'projectless' })).cwd
    } else {
      if (!sameScope(this.options.getActiveScope(), scope)) {
        throw new LocalPiIntegrationError(
          'PI_INTEGRATIONS_SCOPE_UNAVAILABLE',
          'Project integrations are available only for the active selected project.',
        )
      }
      cwd = (await this.options.scopeResolver.resolve({
        kind: 'project',
        workspaceId: scope.workspaceId,
      })).cwd
    }

    const target = {
      sdkVersion: BUNDLED_PI_VERSION,
      scope,
      cwd,
      markerKey: markerKey(scope),
    }
    this.assertCurrent(target)
    return target
  }

  private requireModelsPayload(payload: PiManagementSnapshotPayload) {
    if (!payload.models) {
      throw new LocalPiIntegrationError(
        'PI_MANAGEMENT_HELPER_PROTOCOL_ERROR',
        'The Pi management helper returned an unexpected result.',
      )
    }
    return payload.models
  }

  private async requireTarget(scope: PiIntegrationScope) {
    return this.captureTarget(scope)
  }

  private assertCurrent(target: CapturedManagementTarget) {
    if (!sameScope(this.options.getActiveScope(), target.scope)) {
      throw new LocalPiIntegrationError(
        'PI_INTEGRATIONS_STALE',
        'The selected Pi scope changed during the operation.',
      )
    }
  }

  private runHelper(
    target: CapturedManagementTarget,
    operation:
      | { action: 'snapshot' | 'check-updates'; operationId: string }
      | { action: 'install' | 'update' | 'remove'; operationId: string; source: string }
      | { action: 'set-retry'; operationId: string; enabled: boolean }
      | { action: 'models-defaults'; operationId: string }
      | { action: 'set-default-model'; operationId: string; providerId: string; modelId: string }
      | { action: 'test-model'; operationId: string; content: string; providerId: string; modelId: string },
    onProgress?: (progress: PiManagementProgress) => void,
  ) {
    const command: PiManagementHelperCommand = {
      protocolVersion: 1,
      cwd: target.cwd,
      scope: target.scope,
      ...operation,
    }
    return this.options.helperHost.run(command, onProgress)
  }

  private async composeSnapshot(
    target: CapturedManagementTarget,
    payload: PiManagementSnapshotPayload,
  ) {
    await this.ensureRestartMarkersLoaded()
    const diagnostics = this.restartMarkerPersistenceFailed ||
      this.managedPackageStatePersistenceFailed ||
      this.recommendedInstallDiagnostic
      ? payload.diagnostics.slice(0, PI_INTEGRATION_DIAGNOSTIC_LIMIT - 1)
      : [...payload.diagnostics]
    if (this.restartMarkerPersistenceFailed) {
      diagnostics.push({
        code: 'PI_RESTART_MARKER_PERSIST_FAILED',
        message: 'PiPilot could not persist the pending restart marker.',
        severity: 'warning' as const,
      })
    }
    if (
      this.managedPackageStatePersistenceFailed &&
      diagnostics.length < PI_INTEGRATION_DIAGNOSTIC_LIMIT
    ) {
      diagnostics.push({
        code: 'PI_MANAGED_PACKAGE_STATE_PERSIST_FAILED',
        message: 'PiPilot could not persist the managed MCP package preference.',
        severity: 'warning' as const,
        source: PI_MCP_ADAPTER_SOURCE,
      })
    }
    if (
      this.recommendedInstallDiagnostic &&
      diagnostics.length < PI_INTEGRATION_DIAGNOSTIC_LIMIT
    ) {
      diagnostics.push(this.recommendedInstallDiagnostic)
    }
    const sdkModuleRoot = await this.bundledSdkModuleRoot()
    return piIntegrationSnapshotSchema.parse({
      state: 'ready',
      generation: ++this.snapshotGeneration,
      executable: {
        path: sdkModuleRoot,
        version: BUNDLED_PI_VERSION,
      },
      scope: target.scope,
      ...payload,
      restartRequired: this.restartMarkers.has(target.markerKey),
      diagnostics,
      checkedAt: this.now(),
    })
  }

  private bundledSdkModuleRoot() {
    if (!this.sdkModuleRootPromise) {
      this.sdkModuleRootPromise = (async () => {
        try {
          const root = import.meta.resolve('@earendil-works/pi-coding-agent/package.json')
          const fileUrl = root.replace(/^file:\/\//u, '')
          const prefix = fileUrl.endsWith('/package.json')
            ? fileUrl.slice(0, -'/package.json'.length)
            : dirname(fileUrl)
          return await realpath(prefix)
        } catch {
          return 'bundled'
        }
      })()
    }
    return this.sdkModuleRootPromise
  }

  private operationResult(
    operationId: string,
    snapshot: PiIntegrationSnapshot,
    runtimeSync: PiIntegrationOperationResult['runtimeSync'] = 'not-requested',
    runtimeError?: string,
  ) {
    return piIntegrationOperationResultSchema.parse({
      operationId,
      snapshot,
      runtimeSync,
      ...(runtimeError ? { runtimeError } : {}),
    })
  }

  private ensureRestartMarkersLoaded() {
    if (this.restartMarkersLoaded) return this.restartMarkersLoaded
    this.restartMarkersLoaded = this.loadRestartMarkers()
    return this.restartMarkersLoaded
  }

  private async loadRestartMarkers() {
    try {
      const details = await stat(this.restartMarkerPath)
      if (!details.isFile() || details.size > RESTART_MARKER_FILE_LIMIT) {
        this.restartMarkerPersistenceFailed = true
        return
      }
      const raw: unknown = JSON.parse(await readFile(this.restartMarkerPath, 'utf8'))
      if (
        typeof raw !== 'object' ||
        raw === null ||
        !('version' in raw) ||
        raw.version !== RESTART_MARKER_VERSION ||
        !('markers' in raw) ||
        !Array.isArray(raw.markers)
      ) return
      this.restartMarkers = new Set(raw.markers
        .filter((entry): entry is string =>
          typeof entry === 'string' && /^[a-f0-9]{64}$/u.test(entry))
        .slice(0, MAX_RESTART_MARKERS))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.restartMarkerPersistenceFailed = true
      }
    }
  }

  private async setRestartMarker(key: string, required: boolean) {
    await this.ensureRestartMarkersLoaded()
    const wasRequired = this.restartMarkers.has(key)
    if (required) {
      if (!this.restartMarkers.has(key) && this.restartMarkers.size >= MAX_RESTART_MARKERS) {
        const oldest = this.restartMarkers.values().next().value
        if (oldest) this.restartMarkers.delete(oldest)
      }
      this.restartMarkers.add(key)
    } else {
      this.restartMarkers.delete(key)
    }
    try {
      await this.persistRestartMarkers()
      this.restartMarkerPersistenceFailed = false
    } catch {
      // A failed clear must remain visible and retryable in this process.
      if (!required && wasRequired) this.restartMarkers.add(key)
      this.restartMarkerPersistenceFailed = true
    }
  }

  private async persistRestartMarkers() {
    const document: RestartMarkerDocument = {
      version: RESTART_MARKER_VERSION,
      markers: [...this.restartMarkers].slice(0, MAX_RESTART_MARKERS),
    }
    const temporaryPath = `${this.restartMarkerPath}.${this.createId()}.tmp`
    await mkdir(dirname(this.restartMarkerPath), { recursive: true, mode: 0o700 })
    await writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    })
    try {
      await rename(temporaryPath, this.restartMarkerPath)
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined)
      throw error
    }
  }

  private ensureManagedPackageStateLoaded() {
    if (this.managedPackageStateLoaded) return this.managedPackageStateLoaded
    this.managedPackageStateLoaded = this.loadManagedPackageState()
    return this.managedPackageStateLoaded
  }

  private async loadManagedPackageState() {
    try {
      const details = await stat(this.managedPackageStatePath)
      if (!details.isFile() || details.size > MANAGED_PACKAGE_STATE_FILE_LIMIT) {
        this.managedPackageStatePersistenceFailed = true
        return
      }
      const raw: unknown = JSON.parse(
        await readFile(this.managedPackageStatePath, 'utf8'),
      )
      if (
        typeof raw === 'object' &&
        raw !== null &&
        'version' in raw &&
        raw.version === MANAGED_PACKAGE_STATE_VERSION &&
        'mcpOptedOut' in raw &&
        typeof raw.mcpOptedOut === 'boolean'
      ) {
        this.mcpOptedOut = raw.mcpOptedOut
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.managedPackageStatePersistenceFailed = true
      }
    }
  }

  private async setMcpOptOut(optedOut: boolean) {
    await this.ensureManagedPackageStateLoaded()
    this.mcpOptedOut = optedOut
    const document: ManagedPackageStateDocument = {
      version: MANAGED_PACKAGE_STATE_VERSION,
      mcpOptedOut: optedOut,
    }
    const temporaryPath = `${this.managedPackageStatePath}.${this.createId()}.tmp`
    try {
      await mkdir(dirname(this.managedPackageStatePath), {
        recursive: true,
        mode: 0o700,
      })
      await writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx',
      })
      await rename(temporaryPath, this.managedPackageStatePath)
      this.managedPackageStatePersistenceFailed = false
    } catch {
      await unlink(temporaryPath).catch(() => undefined)
      this.managedPackageStatePersistenceFailed = true
    }
  }

  private assertActive() {
    if (this.disposed) {
      throw new LocalPiIntegrationError(
        'PI_INTEGRATIONS_DISPOSED',
        'Pi integrations are no longer available.',
        false,
      )
    }
  }
}
