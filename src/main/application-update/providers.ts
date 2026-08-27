import { net } from 'electron'
import type { AppUpdater, ProgressInfo, UpdateInfo } from 'electron-updater'
import { z } from 'zod'
import {
  APPLICATION_UPDATE_LATEST_API_URL,
  APPLICATION_UPDATE_RELEASE_URL,
  applicationUpdatePlatformSchema,
  applicationUpdatePolicySchema,
  compareStableVersions,
  type ApplicationUpdateCapability,
  type ApplicationUpdateDisabledReason,
  type ApplicationUpdateErrorCode,
  type ApplicationUpdatePackage,
  type ApplicationUpdatePolicy,
} from '../../shared/application-update'

export type ApplicationUpdateProviderEvent =
  | { type: 'checking' }
  | { type: 'current' }
  | { type: 'available'; update: ApplicationUpdateProviderUpdate }
  | { type: 'progress'; progress: ApplicationUpdateProgress }
  | { type: 'downloaded' }
  | { type: 'error'; error: ApplicationUpdateProviderError }

export interface ApplicationUpdateProviderUpdate {
  version: string
  releaseUrl: string
  releaseSummary: string | null
  releaseDate: string | null
}

export interface ApplicationUpdateProgress {
  percent: number
  transferred: number
  total: number
  bytesPerSecond: number
}

const GITHUB_RESPONSE_LIMIT_BYTES = 256_000
const GITHUB_REQUEST_TIMEOUT_MS = 10_000

export class ApplicationUpdateProviderError extends Error {
  constructor(
    readonly code: ApplicationUpdateErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'ApplicationUpdateProviderError'
  }
}

export interface ApplicationUpdateProvider {
  readonly policy: ApplicationUpdatePolicy
  check(): Promise<'current' | ApplicationUpdateProviderUpdate>
  download(): Promise<void>
  install(): void
  subscribe(listener: (event: ApplicationUpdateProviderEvent) => void): () => void
  dispose(): void
}

const githubReleaseSchema = z
  .object({
    tag_name: z.string().min(1).max(128),
    html_url: z.string().url().max(2_048),
    body: z.string().max(256_000).nullable(),
    published_at: z.string().nullable(),
    draft: z.boolean(),
    prerelease: z.boolean(),
  })
  .passthrough()

const githubDateSchema = z.string().datetime({ offset: true }).nullable()

function stableVersionFromTag(tag: string) {
  if (!/^v\d+\.\d+\.\d+$/u.test(tag)) return null
  return tag.slice(1)
}

async function readBoundedResponse(response: Response) {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > GITHUB_RESPONSE_LIMIT_BYTES) {
    throw new Error('response-too-large')
  }
  if (!response.body) return ''

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let received = 0
  let text = ''
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      received += chunk.value.byteLength
      if (received > GITHUB_RESPONSE_LIMIT_BYTES) {
        await reader.cancel('response-too-large')
        throw new Error('response-too-large')
      }
      text += decoder.decode(chunk.value, { stream: true })
    }
    return text + decoder.decode()
  } finally {
    reader.releaseLock()
  }
}

function isPiPilotReleaseUrl(value: string) {
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      url.username === '' &&
      url.password === '' &&
      url.hostname === 'github.com' &&
      url.port === '' &&
      url.pathname.startsWith('/GarlandQian/PiPilot/releases/')
    )
  } catch {
    return false
  }
}

function safeProgress(value: number, fallback = 0) {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : fallback
}

function safeBytes(value: number) {
  return Number.isFinite(value) && value >= 0 ? Math.min(value, Number.MAX_SAFE_INTEGER) : 0
}

function normalizeReleaseNotes(notes: UpdateInfo['releaseNotes']) {
  if (typeof notes === 'string') return notes.slice(0, 8_192)
  if (!Array.isArray(notes)) return null
  return notes
    .map((item) => `${item.version}: ${item.note}`)
    .join('\n')
    .slice(0, 8_192)
}

function updateFromElectron(info: UpdateInfo): ApplicationUpdateProviderUpdate {
  const version = info.version.trim()
  if (!/^\d+\.\d+\.\d+$/u.test(version)) {
    throw new ApplicationUpdateProviderError(
      'UPDATE_INVALID_RELEASE',
      'The update feed returned an unsupported version.',
    )
  }
  const releaseDate = info.releaseDate
    ? githubDateSchema.safeParse(info.releaseDate).success
      ? info.releaseDate
      : null
    : null
  return {
    version,
    releaseUrl: APPLICATION_UPDATE_RELEASE_URL,
    releaseSummary: normalizeReleaseNotes(info.releaseNotes),
    releaseDate,
  }
}

abstract class BaseApplicationUpdateProvider implements ApplicationUpdateProvider {
  private readonly listeners = new Set<(event: ApplicationUpdateProviderEvent) => void>()
  private disposed = false

  constructor(readonly policy: ApplicationUpdatePolicy) {}

  abstract check(): Promise<'current' | ApplicationUpdateProviderUpdate>
  abstract download(): Promise<void>
  abstract install(): void

  subscribe(listener: (event: ApplicationUpdateProviderEvent) => void) {
    if (this.disposed) return () => undefined
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  dispose() {
    this.disposed = true
    this.listeners.clear()
  }

  protected emit(event: ApplicationUpdateProviderEvent) {
    if (this.disposed) return
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // One subscriber cannot interrupt updater ownership.
      }
    }
  }
}

export class DisabledApplicationUpdateProvider extends BaseApplicationUpdateProvider {
  constructor(
    policy: ApplicationUpdatePolicy,
    readonly reason: ApplicationUpdateDisabledReason,
  ) {
    super(policy)
  }

  check() {
    return Promise.resolve<'current'>('current')
  }

  async download() {
    throw new ApplicationUpdateProviderError('UPDATE_UNSUPPORTED', 'Application updates are unavailable in this package.')
  }

  install() {
    throw new ApplicationUpdateProviderError('UPDATE_UNSUPPORTED', 'Application updates are unavailable in this package.')
  }
}

export interface GithubReleaseProviderOptions {
  currentVersion: string
  platform?: NodeJS.Platform
  policy?: ApplicationUpdatePolicy
  fetch?: typeof fetch
}

export class GithubReleaseProvider extends BaseApplicationUpdateProvider {
  private readonly request: typeof fetch
  private activeRequest: AbortController | undefined

  constructor(options: GithubReleaseProviderOptions) {
    const platform = options.platform ?? process.platform
    const platformPolicy = platform === 'darwin'
      ? { platform: 'macos' as const, package: 'macos' as const }
      : platform === 'win32'
        ? { platform: 'windows' as const, package: 'nsis' as const }
        : { platform: 'linux' as const, package: 'deb' as const }
    const policy = options.policy ?? applicationUpdatePolicySchema.parse({
      ...platformPolicy,
      capability: 'manual-release',
      currentVersion: options.currentVersion,
      releaseUrl: APPLICATION_UPDATE_RELEASE_URL,
    })
    super(policy)
    this.request = options.fetch ?? ((input, init) => net.fetch(input as string, init))
  }

  async check() {
    if (this.activeRequest) {
      throw new ApplicationUpdateProviderError('UPDATE_BUSY', 'An update check is already running.')
    }
    this.emit({ type: 'checking' })
    const controller = new AbortController()
    this.activeRequest = controller
    const timeout = setTimeout(() => controller.abort(), GITHUB_REQUEST_TIMEOUT_MS)
    try {
      let response: Response
      try {
        response = await this.request(APPLICATION_UPDATE_LATEST_API_URL, {
          headers: {
            accept: 'application/vnd.github+json',
            'user-agent': 'PiPilot-update-checker',
          },
          signal: controller.signal,
        })
      } catch {
        throw new ApplicationUpdateProviderError('UPDATE_NETWORK_UNAVAILABLE', 'The latest release could not be reached.')
      }
      if (!response.ok) {
        throw new ApplicationUpdateProviderError('UPDATE_CHECK_FAILED', 'The latest release could not be read.')
      }
      let payload: unknown
      try {
        payload = JSON.parse(await readBoundedResponse(response))
      } catch {
        throw new ApplicationUpdateProviderError('UPDATE_INVALID_FEED', 'The latest release response was invalid.')
      }
      const parsed = githubReleaseSchema.safeParse(payload)
      if (!parsed.success || parsed.data.draft || parsed.data.prerelease) {
        throw new ApplicationUpdateProviderError('UPDATE_INVALID_RELEASE', 'The latest stable release was invalid.')
      }
      const version = stableVersionFromTag(parsed.data.tag_name)
      if (!version || !githubDateSchema.safeParse(parsed.data.published_at).success) {
        throw new ApplicationUpdateProviderError('UPDATE_INVALID_RELEASE', 'The latest stable release was invalid.')
      }
      const releaseUrl = parsed.data.html_url
      if (!isPiPilotReleaseUrl(releaseUrl)) {
        throw new ApplicationUpdateProviderError('UPDATE_INVALID_RELEASE', 'The latest stable release URL was invalid.')
      }
      const comparison = compareStableVersions(version, this.policy.currentVersion)
      if (comparison === null) {
        throw new ApplicationUpdateProviderError('UPDATE_INVALID_RELEASE', 'The application version was invalid.')
      }
      if (comparison <= 0) {
        this.emit({ type: 'current' })
        return 'current'
      }
      const update = {
        version,
        releaseUrl,
        releaseSummary: parsed.data.body?.slice(0, 8_192) ?? null,
        releaseDate: parsed.data.published_at,
      } satisfies ApplicationUpdateProviderUpdate
      this.emit({ type: 'available', update })
      return update
    } finally {
      clearTimeout(timeout)
      if (this.activeRequest === controller) this.activeRequest = undefined
    }
  }

  async download() {
    throw new ApplicationUpdateProviderError('UPDATE_UNSUPPORTED', 'This package uses manual GitHub Release downloads.')
  }

  install() {
    throw new ApplicationUpdateProviderError('UPDATE_UNSUPPORTED', 'This package uses manual GitHub Release downloads.')
  }

  override dispose() {
    this.activeRequest?.abort()
    this.activeRequest = undefined
    super.dispose()
  }
}

export interface ElectronUpdaterProviderOptions {
  updater: AppUpdater
  policy: ApplicationUpdatePolicy
}

export class ElectronUpdaterProvider extends BaseApplicationUpdateProvider {
  private readonly updater: AppUpdater
  private readonly handlers: Array<() => void> = []

  constructor(options: ElectronUpdaterProviderOptions) {
    super(options.policy)
    this.updater = options.updater
    this.updater.autoDownload = false
    this.updater.autoInstallOnAppQuit = false
    this.updater.allowDowngrade = false
    this.updater.allowPrerelease = false
    this.updater.channel = 'latest'

    const onChecking = () => this.emit({ type: 'checking' })
    const onCurrent = () => this.emit({ type: 'current' })
    const onAvailable = (info: UpdateInfo) => {
      try {
        this.emit({ type: 'available', update: updateFromElectron(info) })
      } catch (error) {
        this.emit({ type: 'error', error: error instanceof ApplicationUpdateProviderError ? error : new ApplicationUpdateProviderError('UPDATE_INVALID_RELEASE', 'The update feed was invalid.') })
      }
    }
    const onProgress = (progress: ProgressInfo) => this.emit({
      type: 'progress',
      progress: {
        percent: safeProgress(progress.percent),
        transferred: safeBytes(progress.transferred),
        total: safeBytes(progress.total),
        bytesPerSecond: safeBytes(progress.bytesPerSecond),
      },
    })
    const onDownloaded = () => this.emit({ type: 'downloaded' })
    const onError = () => this.emit({ type: 'error', error: new ApplicationUpdateProviderError('UPDATE_CHECK_FAILED', 'The update operation failed.') })
    const listeners = [
      ['checking-for-update', onChecking],
      ['update-not-available', onCurrent],
      ['update-available', onAvailable],
      ['download-progress', onProgress],
      ['update-downloaded', onDownloaded],
      ['error', onError],
    ] as const
    for (const [event, listener] of listeners) {
      this.updater.on(event, listener as never)
      this.handlers.push(() => this.updater.removeListener(event, listener as never))
    }
  }

  async check() {
    const result = await this.updater.checkForUpdates()
    if (!result || !result.isUpdateAvailable) return 'current' as const
    const update = updateFromElectron(result.updateInfo)
    return update
  }

  async download() {
    await this.updater.downloadUpdate()
  }

  install() {
    this.updater.quitAndInstall(false, false)
  }

  override dispose() {
    for (const remove of this.handlers.splice(0)) remove()
    super.dispose()
  }
}

export function createApplicationUpdatePolicy(options: {
  packaged: boolean
  currentVersion: string
  platform?: NodeJS.Platform
  resourcesPath?: string
  appImagePath?: string
  enableWindowsNative?: boolean
}) {
  const platform = options.platform ?? process.platform
  const normalizedPlatform = applicationUpdatePlatformSchema.parse(
    platform === 'darwin' ? 'macos' : platform === 'win32' ? 'windows' : platform === 'linux' ? 'linux' : 'unsupported',
  )
  if (!options.packaged) {
    return { policy: applicationUpdatePolicySchema.parse({ platform: normalizedPlatform, package: 'development', capability: null, currentVersion: options.currentVersion, releaseUrl: APPLICATION_UPDATE_RELEASE_URL }), reason: 'development' as const }
  }
  if (platform === 'darwin') {
    return { policy: applicationUpdatePolicySchema.parse({ platform: normalizedPlatform, package: 'macos', capability: 'manual-release', currentVersion: options.currentVersion, releaseUrl: APPLICATION_UPDATE_RELEASE_URL }) }
  }
  if (platform === 'win32') {
    return {
      policy: applicationUpdatePolicySchema.parse({
        platform: normalizedPlatform,
        package: 'nsis',
        capability: options.enableWindowsNative ? 'native-install' : 'manual-release',
        currentVersion: options.currentVersion,
        releaseUrl: APPLICATION_UPDATE_RELEASE_URL,
      }),
    }
  }
  if (platform === 'linux') {
    // Electron exposes APPIMAGE only for an AppImage launch. Require the
    // canonical filename as well so an unrelated environment value cannot
    // accidentally grant native-install capability to a DEB install.
    const isAppImage = Boolean(options.appImagePath && /\.AppImage$/iu.test(options.appImagePath))
    const packageName: ApplicationUpdatePackage = isAppImage ? 'appimage' : 'deb'
    const capability: ApplicationUpdateCapability = isAppImage ? 'native-install' : 'manual-release'
    return { policy: applicationUpdatePolicySchema.parse({ platform: normalizedPlatform, package: packageName, capability, currentVersion: options.currentVersion, releaseUrl: APPLICATION_UPDATE_RELEASE_URL }) }
  }
  return { policy: applicationUpdatePolicySchema.parse({ platform: normalizedPlatform, package: 'unsupported', capability: null, currentVersion: options.currentVersion, releaseUrl: APPLICATION_UPDATE_RELEASE_URL }), reason: 'unsupported-platform' as const }
}

export async function createProductionApplicationUpdateProvider(options: {
  packaged: boolean
  currentVersion: string
  platform?: NodeJS.Platform
  resourcesPath?: string
  appImagePath?: string
  enableWindowsNative?: boolean
  fetch?: typeof fetch
}) {
  const selected = createApplicationUpdatePolicy(options)
  if (selected.reason) return new DisabledApplicationUpdateProvider(selected.policy, selected.reason)
  if (selected.policy.capability === 'manual-release') {
    return new GithubReleaseProvider({
      currentVersion: options.currentVersion,
      platform: options.platform,
      policy: selected.policy,
      fetch: options.fetch,
    })
  }
  if (selected.policy.package === 'appimage' && !options.appImagePath) {
    return new DisabledApplicationUpdateProvider(selected.policy, 'missing-feed')
  }
  const module = await import('electron-updater')
  const updater = (module.autoUpdater ?? (module.default as { autoUpdater?: AppUpdater } | undefined)?.autoUpdater)
  if (!updater) return new DisabledApplicationUpdateProvider(selected.policy, 'missing-feed')
  return new ElectronUpdaterProvider({ updater, policy: selected.policy })
}
