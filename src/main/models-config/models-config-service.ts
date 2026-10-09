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
import { configApplySaveFields, type ConfigApplyCoordinator } from '../config-apply/config-apply-coordinator'
import { lookupCatalogModels, providerCatalogResultSchema, type ModelCatalogEntry, type ModelCatalogLookupResult, type ModelsDevIndex } from '../../shared/model-catalog'
import { builtinProviderKeyResultSchema, builtinProvidersResultSchema, type BuiltinProviderKeyResult } from '../../shared/models-config'

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
  agentDirectory?: string
  management?: Pick<
    LocalPiIntegrationService,
    'modelsDefaults' | 'setDefaultModel' | 'testModel'
  > & Partial<Pick<LocalPiIntegrationService, 'modelCatalog' | 'builtinProviders'>>
  /** models.dev, which knows many models Pi's catalog does not. */
  modelsDev?: { index(): Promise<ModelsDevIndex | null> }
}

function fingerprint(content: string | Buffer) {
  return createHash('sha256').update(content).digest('hex')
}

function isMissing(error: unknown) {
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
}

export class ModelsConfigService {
  private readonly agentDirectory: string
  private readonly management?: ModelsConfigServiceOptions['management']
  private readonly modelsDev?: ModelsConfigServiceOptions['modelsDev']

  constructor(options: ModelsConfigServiceOptions) {
    if (!isAbsolute(options.homeDirectory)) {
      throw new Error('The models configuration home must be absolute.')
    }
    const agentDirectory = options.agentDirectory ?? join(options.homeDirectory, '.pi', 'agent')
    if (!isAbsolute(agentDirectory)) {
      throw new Error('The models configuration Agent directory must be absolute.')
    }
    this.agentDirectory = resolve(agentDirectory)
    this.management = options.management
    this.modelsDev = options.modelsDev
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

  /** Pi's own providers and which have a key. */
  async builtinProviders(change?: { providerId: string; key: string | null }) {
    if (!this.management?.builtinProviders) {
      throw new ModelsConfigError('MODELS_CONFIG_TEST_UNAVAILABLE', 'The Pi management integration is unavailable.')
    }
    try {
      return await this.management.builtinProviders(change)
    } catch (error) {
      if (error instanceof ModelsConfigError) throw error
      throw new ModelsConfigError('MODELS_CONFIG_WRITE_FAILED', error instanceof Error ? error.message : 'The provider key could not be changed.')
    }
  }

  /** Where Pi keeps provider keys, and its current fingerprint (for applying a change). */
  async authRevision() {
    const path = join(this.agentDirectory, 'auth.json')
    const content = await readFile(path).catch(() => Buffer.alloc(0))
    return { path, fingerprint: fingerprint(content) }
  }

  /** One of Pi's own providers' models, as its catalog describes them. */
  async providerCatalog(providerId: string): Promise<ModelCatalogEntry[]> {
    const catalog = await this.management?.modelCatalog?.().catch(() => []) ?? []
    return catalog.filter((entry) => entry.provider === providerId)
  }

  /** Catalog details for model IDs on an endpoint; an unreadable catalog knows nothing. */
  async lookupCatalog(baseUrl: string, ids: readonly string[]): Promise<ModelCatalogLookupResult> {
    const [catalog, modelsDev] = await Promise.all([
      this.management?.modelCatalog?.().catch(() => []) ?? [],
      this.modelsDev?.index().catch(() => null) ?? null,
    ])
    return lookupCatalogModels(catalog, baseUrl, ids, modelsDev)
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
    // A provider absent from models.json is one of Pi's own; Pi says whether it has the model.
    const provider = parsed.providers.find((entry) => entry.id === providerId)
    if (provider && !provider.models.some((entry) => entry.id === modelId)) {
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
    const settingsPath = join(this.agentDirectory, 'settings.json')
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
    return join(this.agentDirectory, 'models.json')
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
  constructor(
    private readonly service: ModelsConfigService,
    private readonly applyCoordinator: ConfigApplyCoordinator,
  ) {}

  async load(target: ModelsConfigTarget) {
    const snapshot = await this.service.load(target)
    const applyStatus = this.applyCoordinator.getStatus(snapshot.path, snapshot.fingerprint)
    return { ...snapshot, ...(applyStatus ? { applyStatus } : {}) }
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

  lookupCatalog(baseUrl: string, ids: readonly string[]) {
    return this.service.lookupCatalog(baseUrl, ids)
  }

  async providerCatalog(providerId: string) {
    return providerCatalogResultSchema.parse({ models: await this.service.providerCatalog(providerId) })
  }

  async builtinProviders() {
    return builtinProvidersResultSchema.parse({ providers: await this.service.builtinProviders() })
  }

  /** Store or remove a key in Pi's auth.json, then let running sessions pick it up. */
  async setProviderKey(providerId: string, key: string | null): Promise<BuiltinProviderKeyResult> {
    const providers = await this.service.builtinProviders({ providerId, key })
    const status = await this.applyCoordinator.apply(await this.service.authRevision())
    return builtinProviderKeyResultSchema.parse({ providers, apply: configApplySaveFields(status).apply })
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
    const applyStatus = await this.applyCoordinator.apply({
      path: snapshot.path,
      fingerprint: snapshot.fingerprint,
    })
    return modelsConfigSaveResultSchema.parse({
      snapshot: { ...snapshot, applyStatus },
      ...configApplySaveFields(applyStatus),
    })
  }

}
