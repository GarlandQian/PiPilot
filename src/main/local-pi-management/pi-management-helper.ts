import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join, resolve } from 'node:path'
import {
  PI_INTEGRATION_DIAGNOSTIC_LIMIT,
  PI_INTEGRATION_MESSAGE_LIMIT,
  PI_INTEGRATION_PATH_LIMIT,
  PI_INTEGRATION_RESOURCE_LIMIT,
  PI_INTEGRATION_SOURCE_LIMIT,
  PI_INTEGRATION_UPDATE_LIMIT,
  piManagementHelperCommandSchema,
  piManagementHelperEventSchema,
  piManagementSnapshotPayloadSchema,
  piRetrySettingsSchema,
  type PiIntegrationDiagnostic,
  type PiManagementHelperCommand,
  type PiManagementProgress,
  type PiPackageSummary,
  type PiResourceCounts,
  type PiResourceKind,
  type PiResourceSummary,
} from '../../shared/pi-integrations'
import { compatibilityForPackage } from '../../shared/pi-package-adapters'
import {
  VERSION as BUNDLED_PI_VERSION,
  DefaultPackageManager as BundledDefaultPackageManager,
  ModelRuntime as BundledModelRuntime,
  SettingsManager as BundledSettingsManager,
  getAgentDir as bundledGetAgentDir,
} from '@earendil-works/pi-coding-agent'
import {
  piPackageSourceIsPinned,
  piPackageSourceType,
  updateConfiguredPackageForScope,
} from './pi-package-scope'

const HELPER_INPUT_LIMIT = 4 * 1_024 * 1_024
const PACKAGE_MANIFEST_LIMIT = 256 * 1_024
const MODEL_TEST_TIMEOUT_MS = 30_000
const MODEL_TEST_PREVIEW_LIMIT = 512

interface ExternalConfiguredPackage {
  source: string
  scope: 'user' | 'project'
  filtered: boolean
  installedPath?: string
}

interface ExternalResolvedResource {
  path: string
  enabled: boolean
  metadata: {
    source: string
    scope: 'user' | 'project' | 'temporary'
    origin: 'package' | 'top-level'
    baseDir?: string
  }
}

interface ExternalResolvedPaths {
  extensions: ExternalResolvedResource[]
  skills: ExternalResolvedResource[]
  prompts: ExternalResolvedResource[]
  themes: ExternalResolvedResource[]
}

interface ExternalPackageUpdate {
  source: string
  displayName: string
  type: 'npm' | 'git'
  scope: 'user' | 'project'
}

interface ExternalPackageManager {
  setProgressCallback(callback: ((event: PiManagementProgress) => void) | undefined): void
  listConfiguredPackages(): ExternalConfiguredPackage[]
  resolve(onMissing?: (source: string) => Promise<'install' | 'skip' | 'error'>): Promise<ExternalResolvedPaths>
  install(source: string, options?: { local?: boolean }): Promise<void>
  installAndPersist(source: string, options?: { local?: boolean }): Promise<void>
  removeAndPersist(source: string, options?: { local?: boolean }): Promise<boolean>
  checkForAvailableUpdates(): Promise<ExternalPackageUpdate[]>
}

interface ExternalSettingsManager {
  flush(): Promise<void>
  drainErrors(): Array<{ scope: 'global' | 'project'; error: Error }>
  getDefaultProvider(): string | undefined
  getDefaultModel(): string | undefined
  getGlobalSettings(): {
    retry?: {
      enabled?: boolean
    }
  }
  getRetrySettings(): {
    enabled: boolean
    maxRetries: number
    baseDelayMs: number
  }
  setRetryEnabled(enabled: boolean): void
  setDefaultModelAndProvider(provider: string, modelId: string): void
}

class PiRetrySettingsPersistenceError extends Error {
  readonly code = 'PI_RETRY_SETTINGS_PERSIST_FAILED'

  constructor(message: string) {
    super(message)
    this.name = 'PiRetrySettingsPersistenceError'
  }
}

interface ExternalPiModule {
  VERSION: string
  DefaultPackageManager: new (options: {
    cwd: string
    agentDir: string
    settingsManager: ExternalSettingsManager
  }) => ExternalPackageManager
  SettingsManager: {
    create(
      cwd: string,
      agentDir?: string,
      options?: { projectTrusted?: boolean },
    ): ExternalSettingsManager
  }
  getAgentDir(): string
  loadSkills?: (options: {
    cwd: string
    agentDir: string
    skillPaths: string[]
    includeDefaults: boolean
  }) => {
    skills: Array<{
      name: string
      description: string
      filePath: string
    }>
    diagnostics: unknown[]
  }
}

interface InstalledManifest {
  name?: string
  version?: string
}

function bounded(value: string, limit: number) {
  return value.length <= limit ? value : value.slice(0, limit)
}

function boundedPath(value: string) {
  return bounded(value, PI_INTEGRATION_PATH_LIMIT)
}

function boundedSource(value: string) {
  return bounded(value, PI_INTEGRATION_SOURCE_LIMIT)
}

function retrySettingsSnapshot(settingsManager: ExternalSettingsManager) {
  const global = settingsManager.getGlobalSettings()
  return piRetrySettingsSchema.parse({
    globalEnabled: global.retry?.enabled ?? true,
    effective: settingsManager.getRetrySettings(),
  })
}

function throwSettingsErrors(settingsManager: ExternalSettingsManager) {
  const errors = settingsManager.drainErrors()
  if (errors.length === 0) return
  const detail = errors
    .map(({ scope, error }) => `${scope}: ${error.message}`)
    .join('; ')
  throw new PiRetrySettingsPersistenceError(
    bounded(detail || 'Pi retry settings could not be persisted.', PI_INTEGRATION_MESSAGE_LIMIT),
  )
}

function modelsPayload(
  settingsManager: ExternalSettingsManager,
  agentDir: string,
  settingsUpdated = false,
  test?: {
    providerId: string
    modelId: string
    latencyMs: number
    responsePreview: string
  },
) {
  return piManagementSnapshotPayloadSchema.parse({
    // Model-management commands intentionally do not resolve package
    // resources. The common envelope keeps the existing helper transport
    // correlated while the typed models member carries only paths/defaults.
    packages: [],
    resources: [],
    updates: [],
    retry: retrySettingsSnapshot(settingsManager),
    diagnostics: [],
    models: {
      modelsPath: boundedPath(join(agentDir, 'models.json')),
      settingsPath: boundedPath(join(agentDir, 'settings.json')),
      ...(settingsManager.getDefaultProvider()
        ? { defaultProvider: settingsManager.getDefaultProvider() }
        : {}),
      ...(settingsManager.getDefaultModel()
        ? { defaultModel: settingsManager.getDefaultModel() }
        : {}),
      ...(settingsUpdated ? { settingsUpdated: true } : {}),
      ...(test ? { test } : {}),
    },
  })
}

class PiModelTestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'PiModelTestError'
  }
}

function modelResponsePreview(message: {
  content?: Array<{ type?: string; text?: string }>
}) {
  return bounded(
    message.content
      ?.filter((part) => part.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('')
      .trim() ?? '',
    MODEL_TEST_PREVIEW_LIMIT,
  )
}

async function testModel(
  command: Extract<PiManagementHelperCommand, { action: 'test-model' }>,
  settingsManager: ExternalSettingsManager,
  agentDir: string,
) {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'pipilot-model-test-'))
  const modelsPath = join(temporaryDirectory, 'models.json')
  try {
    await writeFile(modelsPath, command.content, { encoding: 'utf8', mode: 0o600 })
    const runtime = await BundledModelRuntime.create({
      authPath: join(agentDir, 'auth.json'),
      modelsPath,
      allowModelNetwork: false,
      refreshOnCreate: false,
    })
    const model = runtime.getModel(command.providerId, command.modelId)
    if (!model) {
      throw new PiModelTestError(
        'PI_MODEL_TEST_NOT_FOUND',
        `Model ${command.providerId}/${command.modelId} is not available in this configuration.`,
      )
    }
    const startedAt = Date.now()
    const response = await runtime.completeSimple(
      model,
      {
        messages: [{
          role: 'user',
          content: 'Reply with the single word OK.',
          timestamp: Date.now(),
        }],
      },
      {
        maxTokens: 8,
        maxRetries: 0,
        timeoutMs: MODEL_TEST_TIMEOUT_MS,
      },
    )
    const latencyMs = Date.now() - startedAt
    if (response.stopReason === 'error' || response.stopReason === 'aborted') {
      throw new PiModelTestError(
        response.stopReason === 'aborted'
          ? 'PI_MODEL_TEST_ABORTED'
          : 'PI_MODEL_TEST_REQUEST_FAILED',
        response.errorMessage || `The model test ${response.stopReason}.`,
      )
    }
    emit({
      type: 'result',
      operationId: command.operationId,
      result: modelsPayload(settingsManager, agentDir, false, {
        providerId: command.providerId,
        modelId: command.modelId,
        latencyMs,
        responsePreview: modelResponsePreview(response),
      }),
    })
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
}

function emit(rawEvent: unknown) {
  const event = piManagementHelperEventSchema.parse(rawEvent)
  process.stdout.write(`${JSON.stringify(event)}\n`)
}

function helperError(command: PiManagementHelperCommand, error: unknown) {
  const code = typeof error === 'object' && error !== null &&
    'code' in error && typeof error.code === 'string'
    ? bounded(error.code, 128)
    : 'PI_MANAGEMENT_OPERATION_FAILED'
  const message = bounded(
    error instanceof Error ? error.message : 'The Pi management operation failed.',
    PI_INTEGRATION_MESSAGE_LIMIT,
  ) || 'The Pi management operation failed.'
  emit({
    type: 'error',
    operationId: command.operationId,
    error: { code, message, recoverable: true },
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}


function hashId(...parts: string[]) {
  return createHash('sha256').update(parts.join('\0')).digest('hex')
}

function npmDisplayName(source: string) {
  const spec = source.slice(4)
  if (spec.startsWith('@')) {
    const versionIndex = spec.indexOf('@', 1)
    return versionIndex === -1 ? spec : spec.slice(0, versionIndex)
  }
  const versionIndex = spec.lastIndexOf('@')
  return versionIndex > 0 ? spec.slice(0, versionIndex) : spec
}

function displayNameForSource(source: string) {
  if (source.startsWith('npm:')) return npmDisplayName(source)
  const withoutRef = source.replace(/@[^/@]+$/u, '')
  const name = basename(withoutRef).replace(/\.git$/u, '')
  return name || boundedSource(source)
}

async function installedManifest(installedPath?: string): Promise<InstalledManifest> {
  if (!installedPath) return {}
  try {
    const details = await stat(installedPath)
    const manifestPath = details.isDirectory()
      ? join(installedPath, 'package.json')
      : join(dirname(installedPath), 'package.json')
    const manifestDetails = await stat(manifestPath)
    if (!manifestDetails.isFile() || manifestDetails.size > PACKAGE_MANIFEST_LIMIT) return {}
    const parsed: unknown = JSON.parse(await readFile(manifestPath, 'utf8'))
    if (!isRecord(parsed)) return {}
    return {
      ...(typeof parsed.name === 'string' ? { name: bounded(parsed.name, 256) } : {}),
      ...(typeof parsed.version === 'string' ? { version: bounded(parsed.version, 128) } : {}),
    }
  } catch {
    return {}
  }
}

function emptyCounts(): PiResourceCounts {
  return { extension: 0, skill: 0, prompt: 0, theme: 0 }
}

function resourceCompatibility(kind: PiResourceKind) {
  if (kind === 'theme') return 'pi-tui-only'
  if (kind === 'extension') return 'partial'
  return 'generic-rpc'
}

function resourceLabel(kind: PiResourceKind, path: string) {
  if (kind === 'skill' && basename(path).toLowerCase() === 'skill.md') {
    return basename(dirname(path))
  }
  return basename(path, extname(path)) || kind
}

function resourceInvocation(kind: PiResourceKind, label: string) {
  if (kind === 'skill') return `/skill:${label}`
  if (kind === 'prompt') return `/${label}`
  return undefined
}

function normalizeExternalScope(scope: 'user' | 'project' | 'temporary') {
  return scope === 'project' ? 'project' as const : 'global' as const
}

function diagnosticFromUnknown(value: unknown): PiIntegrationDiagnostic | null {
  if (!isRecord(value)) return null
  const message = typeof value.message === 'string'
    ? value.message
    : typeof value.error === 'string'
      ? value.error
      : undefined
  if (!message) return null
  return {
    code: typeof value.code === 'string'
      ? bounded(value.code, 128)
      : 'PI_RESOURCE_DIAGNOSTIC',
    message: bounded(message, PI_INTEGRATION_MESSAGE_LIMIT),
    severity: 'warning',
    ...(typeof value.path === 'string'
      ? { source: boundedSource(value.path) }
      : {}),
  }
}

async function buildSnapshot(
  pi: ExternalPiModule,
  command: PiManagementHelperCommand,
  packageManager: ExternalPackageManager,
  settingsManager: ExternalSettingsManager,
  agentDir: string,
) {
  const resolved = await packageManager.resolve(async () => 'skip')
  const allConfigured = packageManager.listConfiguredPackages()
  const configured = command.scope.kind === 'global'
    ? allConfigured.filter((entry) => entry.scope === 'user')
    : allConfigured.filter((entry) => entry.scope === 'project')
  const updates = command.action === 'check-updates'
    ? await packageManager.checkForAvailableUpdates()
    : []
  const updateKeys = new Set(updates.map((entry) => `${entry.scope}\0${entry.source}`))
  const packageIds = new Map(
    allConfigured.map((entry) => [
      `${entry.scope}\0${entry.source}`,
      hashId('package', entry.scope, entry.source),
    ]),
  )

  const descriptions = new Map<string, { name: string; description: string }>()
  const diagnostics: PiIntegrationDiagnostic[] = []
  const enabledSkillPaths = resolved.skills
    .filter((entry) => entry.enabled)
    .map((entry) => entry.path)
  if (pi.loadSkills && enabledSkillPaths.length > 0) {
    try {
      const loaded = pi.loadSkills({
        cwd: command.cwd,
        agentDir,
        skillPaths: enabledSkillPaths,
        includeDefaults: false,
      })
      for (const skill of loaded.skills) {
        descriptions.set(resolve(skill.filePath), {
          name: bounded(skill.name, 256),
          description: bounded(skill.description, 2_048),
        })
      }
      for (const rawDiagnostic of loaded.diagnostics) {
        const parsed = diagnosticFromUnknown(rawDiagnostic)
        if (parsed && diagnostics.length < PI_INTEGRATION_DIAGNOSTIC_LIMIT) {
          diagnostics.push(parsed)
        }
      }
    } catch (error) {
      diagnostics.push({
        code: 'PI_SKILL_METADATA_UNAVAILABLE',
        message: bounded(
          error instanceof Error ? error.message : 'Skill metadata could not be loaded.',
          PI_INTEGRATION_MESSAGE_LIMIT,
        ),
        severity: 'warning',
      })
    }
  }

  const grouped = [
    ['extension', resolved.extensions],
    ['skill', resolved.skills],
    ['prompt', resolved.prompts],
    ['theme', resolved.themes],
  ] as const
  const resources: PiResourceSummary[] = []
  for (const [kind, entries] of grouped) {
    for (const entry of entries) {
      if (resources.length >= PI_INTEGRATION_RESOURCE_LIMIT) break
      const scope = normalizeExternalScope(entry.metadata.scope)
      if (command.scope.kind === 'global' && scope !== 'global') continue
      const externalScope = entry.metadata.scope === 'project' ? 'project' : 'user'
      const packageId = entry.metadata.origin === 'package'
        ? packageIds.get(`${externalScope}\0${entry.metadata.source}`)
        : undefined
      const skill = kind === 'skill'
        ? descriptions.get(resolve(entry.path))
        : undefined
      const fallbackLabel = resourceLabel(kind, entry.path)
      const label = skill?.name || fallbackLabel
      const effectiveState = !entry.enabled
        ? 'disabled' as const
        : command.scope.kind === 'project' && scope === 'global'
          ? 'inherited' as const
          : 'enabled' as const
      resources.push({
        id: hashId('resource', kind, entry.path, entry.metadata.source, scope),
        ...(packageId ? { packageId } : {}),
        kind,
        label: bounded(label, 256),
        ...(skill?.description ? { description: skill.description } : {}),
        path: boundedPath(entry.path),
        source: boundedSource(entry.metadata.source),
        scope,
        effectiveState,
        ...(resourceInvocation(kind, label)
          ? { invocation: resourceInvocation(kind, label) }
          : {}),
        compatibility: resourceCompatibility(kind),
      })
    }
  }

  const countsByPackage = new Map<string, PiResourceCounts>()
  for (const resource of resources) {
    if (!resource.packageId) continue
    const counts = countsByPackage.get(resource.packageId) ?? emptyCounts()
    counts[resource.kind] += 1
    countsByPackage.set(resource.packageId, counts)
  }

  const packages: PiPackageSummary[] = await Promise.all(configured.map(async (entry) => {
    const id = hashId('package', entry.scope, entry.source)
    const manifest = await installedManifest(entry.installedPath)
    const type = piPackageSourceType(entry.source)
    const counts = countsByPackage.get(id) ?? emptyCounts()
    const source = boundedSource(entry.source)
    const displayName = manifest.name || bounded(displayNameForSource(entry.source), 256)
    return {
      id,
      source,
      sourceType: type,
      displayName,
      scope: normalizeExternalScope(entry.scope),
      ...(manifest.version ? { installedVersion: manifest.version } : {}),
      ...(entry.installedPath
        ? { installedPath: boundedPath(entry.installedPath) }
        : {}),
      pinned: piPackageSourceIsPinned(entry.source, type),
      filtered: entry.filtered,
      resourceCounts: counts,
      compatibility: compatibilityForPackage({
        sourceType: type,
        source,
        displayName,
        ...(manifest.version ? { installedVersion: manifest.version } : {}),
      }, counts),
      updateAvailable: updateKeys.has(`${entry.scope}\0${entry.source}`),
    }
  }))

  const packageCompatibility = new Map(
    packages.map((entry) => [entry.id, entry.compatibility] as const),
  )
  const projectedResources = resources.map((resource) => ({
    ...resource,
    compatibility: resource.packageId
      ? packageCompatibility.get(resource.packageId) ?? resource.compatibility
      : resource.compatibility,
  }))

  return piManagementSnapshotPayloadSchema.parse({
    packages,
    resources: projectedResources,
    updates: updates
      .filter((entry) => entry.scope === (
        command.scope.kind === 'project' ? 'project' : 'user'
      ))
      .slice(0, PI_INTEGRATION_UPDATE_LIMIT)
      .map((entry) => ({
        source: boundedSource(entry.source),
        displayName: bounded(entry.displayName, 256),
        type: entry.type,
        scope: normalizeExternalScope(entry.scope),
      })),
    retry: retrySettingsSnapshot(settingsManager),
    diagnostics,
  })
}

async function runCommand(command: PiManagementHelperCommand) {
  const pi: ExternalPiModule = {
    VERSION: BUNDLED_PI_VERSION,
    DefaultPackageManager: BundledDefaultPackageManager as unknown as ExternalPiModule['DefaultPackageManager'],
    SettingsManager: {
      create: BundledSettingsManager.create.bind(BundledSettingsManager),
    } as unknown as ExternalPiModule['SettingsManager'],
    getAgentDir: () => bundledGetAgentDir(),
  }
  const agentDir = pi.getAgentDir()
  if (typeof agentDir !== 'string' || agentDir.length === 0 || agentDir.length > PI_INTEGRATION_PATH_LIMIT) {
    throw new Error('The selected Pi package returned an invalid Agent directory.')
  }
  const settingsManager = pi.SettingsManager.create(
    command.cwd,
    agentDir,
    { projectTrusted: true },
  )

  if (
    command.action === 'models-defaults' ||
    command.action === 'set-default-model' ||
    command.action === 'test-model'
  ) {
    if (command.action === 'test-model') {
      await testModel(command, settingsManager, agentDir)
      return
    }
    if (command.action === 'set-default-model') {
      // SettingsManager queues writes and reports failures through its error
      // queue rather than rejecting flush(). Check both before and after the
      // mutation so a stale load error cannot be mistaken for success.
      throwSettingsErrors(settingsManager)
      settingsManager.setDefaultModelAndProvider(command.providerId, command.modelId)
      await settingsManager.flush()
      throwSettingsErrors(settingsManager)
    }
    emit({
      type: 'result',
      operationId: command.operationId,
      result: modelsPayload(settingsManager, agentDir, command.action === 'set-default-model'),
    })
    return
  }

  const packageManager = new pi.DefaultPackageManager({
    cwd: command.cwd,
    agentDir,
    settingsManager,
  })
  packageManager.setProgressCallback((progress) => {
    emit({
      type: 'progress',
      operationId: command.operationId,
      progress: {
        ...progress,
        source: boundedSource(progress.source),
        ...(progress.message
          ? { message: bounded(progress.message, PI_INTEGRATION_MESSAGE_LIMIT) }
          : {}),
      },
    })
  })

  const local = command.scope.kind === 'project'
  if (command.action === 'install') {
    await packageManager.installAndPersist(command.source, { local })
    await settingsManager.flush()
  } else if (command.action === 'remove') {
    const removed = await packageManager.removeAndPersist(command.source, { local })
    if (!removed) throw new Error('The selected Pi package is no longer configured.')
    await settingsManager.flush()
  } else if (command.action === 'update') {
    await updateConfiguredPackageForScope(
      packageManager,
      command.source,
      command.scope,
    )
    await settingsManager.flush()
  } else if (command.action === 'set-retry') {
    // A load error means Pi may expose defaults in memory but cannot safely
    // persist a new global value. Surface it before touching runtime state.
    throwSettingsErrors(settingsManager)
    settingsManager.setRetryEnabled(command.enabled)
    await settingsManager.flush()
    // SettingsManager writes are queued and records failures instead of
    // rejecting flush(). Do not let a failed global write reach RPC sync.
    throwSettingsErrors(settingsManager)
  }

  const result = await buildSnapshot(
    pi,
    command,
    packageManager,
    settingsManager,
    agentDir,
  )
  emit({ type: 'result', operationId: command.operationId, result })
}

async function readCommand() {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const rawChunk of process.stdin) {
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk)
    bytes += chunk.length
    if (bytes > HELPER_INPUT_LIMIT) throw new Error('The helper command is too large.')
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8').trim()
  const parsed: unknown = JSON.parse(text)
  return piManagementHelperCommandSchema.parse(parsed)
}

async function main() {
  let command: PiManagementHelperCommand | undefined
  try {
    command = await readCommand()
    await runCommand(command)
  } catch (error) {
    if (command) helperError(command, error)
    else process.stderr.write('Pi management helper received an invalid command.\n')
    process.exitCode = 1
  }
}

void main()
