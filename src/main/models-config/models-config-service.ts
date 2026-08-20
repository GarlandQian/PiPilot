import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { parse as parseJsonc, type ParseError } from 'jsonc-parser'
import {
  MODELS_CONFIG_CONTENT_LIMIT,
  modelsConfigDefaultsSchema,
  modelsConfigSaveResultSchema,
  modelsConfigSetDefaultResultSchema,
  modelsConfigSnapshotSchema,
  modelsConfigTestResultSchema,
  modelsConfigTargetSchema,
  type ModelsConfigDefaults,
  type ModelsConfigSaveResult,
  type ModelsConfigSetDefaultResult,
  type ModelsConfigSnapshot,
  type ModelsConfigTarget,
  type ModelsConfigTestResult,
} from '../../shared/models-config'
import { parseModelsConfigDocument } from '../../shared/models-config-schema'
import type { LocalPiIntegrationService } from '../local-pi-management/local-pi-integration-service'
import type { PiRuntimeFrontend } from '../pi-host/pi-runtime-frontend'

const DEFAULT_DOCUMENT = '{\n  "providers": {}\n}\n'
const MISSING_FINGERPRINT = createHash('sha256')
  .update('pipilot:models-config:missing:v1')
  .digest('hex')

export type ModelsConfigErrorCode =
  | 'MODELS_CONFIG_TOO_LARGE'
  | 'MODELS_CONFIG_INVALID'
  | 'MODELS_CONFIG_CONFLICT'
  | 'MODELS_CONFIG_READ_FAILED'
  | 'MODELS_CONFIG_WRITE_FAILED'
  | 'MODELS_CONFIG_DEFAULTS_UNAVAILABLE'
  | 'MODELS_CONFIG_TEST_UNAVAILABLE'

export class ModelsConfigError extends Error {
  constructor(
    readonly code: ModelsConfigErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'ModelsConfigError'
  }
}

interface ModelsConfigServiceOptions {
  homeDirectory: string
  management?: Pick<
    LocalPiIntegrationService,
    'modelsDefaults' | 'setDefaultModel' | 'testModel'
  >
}

function fingerprint(content: string | Buffer) {
  return createHash('sha256').update(content).digest('hex')
}

function isMissing(error: unknown) {
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
}

export class ModelsConfigService {
  private readonly homeDirectory: string
  private readonly management?: ModelsConfigServiceOptions['management']

  constructor(options: ModelsConfigServiceOptions) {
    if (!isAbsolute(options.homeDirectory)) {
      throw new Error('The models configuration home must be absolute.')
    }
    this.homeDirectory = resolve(options.homeDirectory)
    this.management = options.management
  }

  async load(rawTarget: ModelsConfigTarget): Promise<ModelsConfigSnapshot> {
    const target = modelsConfigTargetSchema.parse(rawTarget)
    const targetPath = this.resolveTargetPath(target)
    const disk = await this.readTarget(targetPath)
    const defaults = await this.readDefaults()
    return this.snapshot(target, targetPath, disk.exists, disk.content, defaults)
  }

  async save(
    rawTarget: ModelsConfigTarget,
    content: string,
    expectedFingerprint: string,
  ): Promise<ModelsConfigSnapshot> {
    const target = modelsConfigTargetSchema.parse(rawTarget)
    if (Buffer.byteLength(content, 'utf8') > MODELS_CONFIG_CONTENT_LIMIT) {
      throw new ModelsConfigError(
        'MODELS_CONFIG_TOO_LARGE',
        `The models configuration cannot exceed ${MODELS_CONFIG_CONTENT_LIMIT} bytes.`,
      )
    }
    const parsed = parseModelsConfigDocument(content)
    if (!parsed.valid) {
      throw new ModelsConfigError(
        'MODELS_CONFIG_INVALID',
        parsed.diagnostics[0]?.message ?? 'The models configuration is invalid.',
      )
    }

    const targetPath = this.resolveTargetPath(target)
    const current = await this.readTarget(targetPath)
    const currentFingerprint = current.exists
      ? fingerprint(current.content)
      : MISSING_FINGERPRINT
    if (currentFingerprint !== expectedFingerprint) {
      throw new ModelsConfigError(
        'MODELS_CONFIG_CONFLICT',
        'The models configuration changed outside PiPilot. Reload it before saving.',
      )
    }
    await this.writeAtomically(targetPath, content, current.exists)
    const defaults = await this.readDefaults()
    return this.snapshot(target, targetPath, true, content, defaults)
  }

  async defaults(): Promise<ModelsConfigDefaults> {
    return this.readDefaults()
  }

  async setDefault(
    providerId: string,
    modelId: string,
  ): Promise<ModelsConfigSetDefaultResult> {
    if (!this.management) {
      throw new ModelsConfigError(
        'MODELS_CONFIG_DEFAULTS_UNAVAILABLE',
        'The Pi management integration is unavailable, so the default model cannot be changed.',
      )
    }
    try {
      const payload = await this.management.setDefaultModel(providerId, modelId)
      return modelsConfigSetDefaultResultSchema.parse({
        settingsUpdated: true,
        ...(payload.defaultProvider !== undefined
          ? { defaultProvider: payload.defaultProvider }
          : {}),
        ...(payload.defaultModel !== undefined
          ? { defaultModel: payload.defaultModel }
          : {}),
      })
    } catch (error) {
      if (error instanceof ModelsConfigError) throw error
      throw new ModelsConfigError(
        'MODELS_CONFIG_DEFAULTS_UNAVAILABLE',
        error instanceof Error
          ? error.message
          : 'The default model could not be changed through the selected Pi installation.',
      )
    }
  }

  async test(
    content: string,
    providerId: string,
    modelId: string,
  ): Promise<ModelsConfigTestResult> {
    if (Buffer.byteLength(content, 'utf8') > MODELS_CONFIG_CONTENT_LIMIT) {
      throw new ModelsConfigError(
        'MODELS_CONFIG_TOO_LARGE',
        `The models configuration cannot exceed ${MODELS_CONFIG_CONTENT_LIMIT} bytes.`,
      )
    }
    const parsed = parseModelsConfigDocument(content)
    if (!parsed.valid) {
      throw new ModelsConfigError(
        'MODELS_CONFIG_INVALID',
        parsed.diagnostics[0]?.message ?? 'The models configuration is invalid.',
      )
    }
    const provider = parsed.providers.find((entry) => entry.id === providerId)
    if (!provider?.models.some((entry) => entry.id === modelId)) {
      throw new ModelsConfigError(
        'MODELS_CONFIG_INVALID',
        'The selected model is not present in the current configuration draft.',
      )
    }
    if (!this.management) {
      throw new ModelsConfigError(
        'MODELS_CONFIG_TEST_UNAVAILABLE',
        'The Pi management integration is unavailable, so this model cannot be tested.',
      )
    }
    try {
      return modelsConfigTestResultSchema.parse(
        await this.management.testModel(content, providerId, modelId),
      )
    } catch (error) {
      if (error instanceof ModelsConfigError) throw error
      throw new ModelsConfigError(
        'MODELS_CONFIG_TEST_UNAVAILABLE',
        error instanceof Error
          ? error.message
          : 'The selected model could not complete a test request.',
      )
    }
  }

  private snapshot(
    target: ModelsConfigTarget,
    path: string,
    exists: boolean,
    content: string,
    defaults: ModelsConfigDefaults,
  ) {
    return modelsConfigSnapshotSchema.parse({
      // The structured parse redacts every apiKey into a presence flag. The
      // raw content is passed verbatim only for the Form|JSON single draft —
      // the documented contract for the user's own file (design §2).
      ...parseModelsConfigDocument(content),
      target,
      path,
      exists,
      content,
      fingerprint: exists ? fingerprint(content) : MISSING_FINGERPRINT,
      ...(defaults.defaultProvider !== undefined
        ? { defaultProvider: defaults.defaultProvider }
        : {}),
      ...(defaults.defaultModel !== undefined
        ? { defaultModel: defaults.defaultModel }
        : {}),
    })
  }

  /*
   * Defaults come from the official Pi management helper when it is available
   * (it reads them through the official SettingsManager). A direct read-only
   * JSONC parse of Pi's real settings.json keeps the surface usable when the
   * helper cannot run — reading must never take the models surface down.
   */
  private async readDefaults(): Promise<ModelsConfigDefaults> {
    if (this.management) {
      try {
        const payload = await this.management.modelsDefaults()
        return modelsConfigDefaultsSchema.parse({
          defaultProvider: payload.defaultProvider,
          defaultModel: payload.defaultModel,
        })
      } catch {
        // Fall through to the direct read-only parse below.
      }
    }
    return this.readDefaultsFromFile()
  }

  private async readDefaultsFromFile(): Promise<ModelsConfigDefaults> {
    const settingsPath = join(this.homeDirectory, '.pi', 'agent', 'settings.json')
    let content: string
    try {
      content = await readFile(settingsPath, 'utf8')
    } catch {
      return {}
    }
    const errors: ParseError[] = []
    const parsed: unknown = parseJsonc(content, errors, { allowTrailingComma: true })
    if (errors.length > 0 || typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {}
    }
    const record = parsed as Record<string, unknown>
    const defaultProvider = typeof record.defaultProvider === 'string' && record.defaultProvider.length > 0
      ? record.defaultProvider
      : undefined
    const defaultModel = typeof record.defaultModel === 'string' && record.defaultModel.length > 0
      ? record.defaultModel
      : undefined
    return modelsConfigDefaultsSchema.parse({ defaultProvider, defaultModel })
  }

  private async readTarget(path: string) {
    let details
    try {
      details = await stat(path)
    } catch (error) {
      if (isMissing(error)) return { exists: false, content: DEFAULT_DOCUMENT }
      throw new ModelsConfigError('MODELS_CONFIG_READ_FAILED', 'The models configuration could not be read.')
    }
    if (!details.isFile()) {
      throw new ModelsConfigError('MODELS_CONFIG_READ_FAILED', 'The models configuration path is not a file.')
    }
    if (details.size > MODELS_CONFIG_CONTENT_LIMIT) {
      throw new ModelsConfigError(
        'MODELS_CONFIG_TOO_LARGE',
        `The models configuration cannot exceed ${MODELS_CONFIG_CONTENT_LIMIT} bytes.`,
      )
    }
    try {
      return { exists: true, content: await readFile(path, 'utf8') }
    } catch {
      throw new ModelsConfigError('MODELS_CONFIG_READ_FAILED', 'The models configuration could not be read.')
    }
  }

  private resolveTargetPath(_target: ModelsConfigTarget) {
    // Pi supports exactly one models.json — the global Pi Agent file.
    return join(this.homeDirectory, '.pi', 'agent', 'models.json')
  }

  private async writeAtomically(path: string, content: string, existed: boolean) {
    const parent = dirname(path)
    const temporary = join(parent, `.${randomUUID()}.pipilot-models.tmp`)
    let mode = 0o600
    if (existed) {
      try {
        mode = (await stat(path)).mode & 0o777
      } catch (error) {
        if (!isMissing(error)) {
          throw new ModelsConfigError('MODELS_CONFIG_WRITE_FAILED', 'The models configuration could not be saved.')
        }
      }
    }
    try {
      await mkdir(parent, { recursive: true })
      const handle = await open(temporary, 'wx', mode)
      try {
        await handle.writeFile(content, 'utf8')
        await handle.sync()
      } finally {
        await handle.close()
      }
      await rename(temporary, path)
    } catch (error) {
      await unlink(temporary).catch(() => undefined)
      if (error instanceof ModelsConfigError) throw error
      throw new ModelsConfigError('MODELS_CONFIG_WRITE_FAILED', 'The models configuration could not be saved.')
    }
  }
}

export class ModelsConfigController {
  private pendingRestartGeneration: number | null = null
  private readonly unsubscribes: readonly (() => void)[]

  constructor(
    private readonly service: ModelsConfigService,
    private readonly runtimeHost: Pick<
      PiRuntimeFrontend,
      'getSnapshot' | 'restart' | 'subscribe' | 'subscribeEvents'
    >,
    private readonly restartGlobalHosts: () => Promise<unknown> = () =>
      runtimeHost.restart(),
  ) {
    const unsubscribeEvents = runtimeHost.subscribeEvents((event, generation) => {
      if (
        event.type !== 'agent_settled' ||
        this.pendingRestartGeneration !== generation ||
        generation !== runtimeHost.getSnapshot().generation
      ) return
      this.pendingRestartGeneration = null
      void this.restartGlobalHosts().catch(() => {
        if (runtimeHost.getSnapshot().generation === generation) {
          this.pendingRestartGeneration = generation
        }
      })
    })
    const unsubscribeRuntime = runtimeHost.subscribe((snapshot) => {
      if (
        this.pendingRestartGeneration !== null &&
        this.pendingRestartGeneration !== snapshot.generation
      ) {
        this.pendingRestartGeneration = null
      }
    })
    this.unsubscribes = [unsubscribeEvents, unsubscribeRuntime]
  }

  load(target: ModelsConfigTarget) {
    return this.service.load(target)
  }

  defaults() {
    return this.service.defaults()
  }

  setDefault(providerId: string, modelId: string) {
    return this.service.setDefault(providerId, modelId)
  }

  test(content: string, providerId: string, modelId: string) {
    return this.service.test(content, providerId, modelId)
  }

  async save(
    target: ModelsConfigTarget,
    content: string,
    expectedFingerprint: string,
    restart = true,
  ): Promise<ModelsConfigSaveResult> {
    const snapshot = await this.service.save(target, content, expectedFingerprint)
    if (!restart) {
      return modelsConfigSaveResultSchema.parse({ snapshot, apply: 'saved' })
    }
    // models.json is global-only, so the global runtime is always the target.
    const runtime = this.runtimeHost.getSnapshot()
    if (runtime.state !== 'ready') {
      return modelsConfigSaveResultSchema.parse({ snapshot, apply: 'unavailable' })
    }
    if (runtime.sessionState?.isStreaming || runtime.sessionState?.isCompacting) {
      this.pendingRestartGeneration = runtime.generation
      return modelsConfigSaveResultSchema.parse({ snapshot, apply: 'pending' })
    }
    this.pendingRestartGeneration = null
    try {
      await this.restartGlobalHosts()
      return modelsConfigSaveResultSchema.parse({ snapshot, apply: 'restarted' })
    } catch (error) {
      return modelsConfigSaveResultSchema.parse({
        snapshot,
        apply: 'failed',
        applyError: error instanceof Error ? error.message : 'Pi could not restart.',
      })
    }
  }

  dispose() {
    for (const unsubscribe of this.unsubscribes) unsubscribe()
  }
}
