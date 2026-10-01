import { readFile, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { PI_RECOMMENDED_PACKAGES, npmPackageNameForSource } from '../../shared/pi-package-adapters'
import { type PiDefaultPackage, type PiManagementProgress } from '../../shared/pi-integrations'
import { DefaultPackageRepository } from './default-package-repository'
import { safePiManagementMessage } from './pi-management-diagnostics'

interface PackageManager {
  listConfiguredPackages(): Array<{ source: string; scope: 'user' | 'project'; installedPath?: string }>
  getInstalledPath(source: string, scope: 'user' | 'project'): string | undefined
  install(source: string, options: { local: boolean }): Promise<void>
  addSourceToSettings(source: string, options: { local: boolean }): boolean
}

interface RecommendedPackagesOptions {
  agentDir: string
  packageManager: PackageManager
  reloadSettings(): Promise<void>
  flushSettings(): Promise<void>
  onProgress?(progress: PiManagementProgress): void
  errorMessage?(error: unknown): string
}

function message(error: unknown) {
  return safePiManagementMessage(error instanceof Error ? error.message : 'Recommended package installation failed.')
}

async function manifestName(path: string | undefined) {
  if (!path) return undefined
  try {
    const installed = await stat(path)
    const manifest = join(installed.isDirectory() ? path : dirname(path), 'package.json')
    const info = await stat(manifest)
    if (!info.isFile() || info.size > 256 * 1_024) return undefined
    const parsed: unknown = JSON.parse(await readFile(manifest, 'utf8'))
    return typeof parsed === 'object' && parsed !== null && 'name' in parsed && typeof parsed.name === 'string'
      ? parsed.name : undefined
  } catch { return undefined }
}

async function configuredPackage(packageManager: PackageManager, packageName: string) {
  for (const item of packageManager.listConfiguredPackages()) {
    if (item.scope !== 'user') continue
    const installed = await manifestName(item.installedPath) === packageName
    // Configured entries count even when absent on disk or disabled by filters.
    if (npmPackageNameForSource(item.source) === packageName || installed) return { source: item.source, installed }
  }
  return undefined
}

async function existingSource(packageManager: PackageManager, packageName: string) {
  const configured = await configuredPackage(packageManager, packageName)
  if (configured) return configured.source
  // The official resolver also understands legacy npm-global installations.
  // An unconfigured existing installation is left unchanged, never enabled.
  const installedPath = packageManager.getInstalledPath(`npm:${packageName}`, 'user')
  return await manifestName(installedPath) === packageName ? `npm:${packageName}` : undefined
}

export async function recommendedPackageSnapshot(agentDir: string, packageManager: PackageManager, reconcileExisting = true) {
  const repository = new DefaultPackageRepository(agentDir)
  return Promise.all(PI_RECOMMENDED_PACKAGES.map(async (recommendation): Promise<PiDefaultPackage> => {
    try {
      const saved = await repository.read(recommendation.packageName)
      const configured = await configuredPackage(packageManager, recommendation.packageName)
      const existing = await existingSource(packageManager, recommendation.packageName)
      if (saved && ['removed', 'failed', 'installing'].includes(saved.status)) {
        if (reconcileExisting && saved.status !== 'installing' && configured?.installed) {
          return { ...recommendation, source: configured.source, status: 'existing' }
        }
        return configured ? { ...saved, source: configured.source } : saved
      }
      if (existing) return {
        ...recommendation,
        source: existing,
        status: saved?.status === 'installed' ? 'installed' : 'existing',
      }
      if (saved?.status === 'installed' || saved?.status === 'existing') return { ...saved, status: 'removed' }
      return saved ?? { ...recommendation, status: 'pending' }
    } catch (error) {
      return { ...recommendation, status: 'failed', message: message(error) }
    }
  }))
}

export async function bootstrapRecommendedPackages(options: RecommendedPackagesOptions) {
  const repository = new DefaultPackageRepository(options.agentDir)
  let changed = false
  const describeError = options.errorMessage ?? message
  for (const recommendation of PI_RECOMMENDED_PACKAGES) {
    try {
      await options.reloadSettings()
      const previous = await repository.read(recommendation.packageName)
      if (previous) {
        const configured = await configuredPackage(options.packageManager, recommendation.packageName)
        if (configured?.installed) {
          await repository.save({
            ...previous,
            source: configured.source,
            status: previous.status === 'installed' ? 'installed' : 'existing',
            message: undefined,
          })
        } else if (previous.status === 'installing') {
          await repository.save({
            ...previous,
            ...(configured ? { source: configured.source } : {}),
            status: 'failed',
            message: 'The previous installation was interrupted. Retry explicitly to finish setup.',
          })
        }
        continue
      }
      const existing = await existingSource(options.packageManager, recommendation.packageName)
      const decision: PiDefaultPackage = {
        ...recommendation,
        ...(existing ? { source: existing } : {}),
        status: existing ? 'existing' : 'installing',
      }
      if (!await repository.claim(decision) || existing) continue
      options.onProgress?.({ type: 'start', action: 'install', source: recommendation.source })
      try {
        await options.packageManager.install(recommendation.source, { local: false })
        changed = true
        // npm may run for minutes. Re-read Pi's settings before registering the
        // source so an external CLI's packages and resource filters survive.
        await options.reloadSettings()
        const configured = await configuredPackage(options.packageManager, recommendation.packageName)
        if (!configured) options.packageManager.addSourceToSettings(recommendation.source, { local: false })
        await options.flushSettings()
        await repository.save(configured
          ? { ...decision, source: configured.source, status: 'existing' }
          : { ...decision, status: 'installed' })
        options.onProgress?.({ type: 'complete', action: 'install', source: recommendation.source })
      } catch (error) {
        await repository.save({ ...decision, status: 'failed', message: describeError(error) })
        options.onProgress?.({ type: 'error', action: 'install', source: recommendation.source, message: describeError(error) })
      }
    } catch (error) {
      options.onProgress?.({ type: 'error', action: 'install', source: recommendation.source, message: describeError(error) })
    }
  }
  return { changed, packages: await recommendedPackageSnapshot(options.agentDir, options.packageManager, false) }
}

/** Explicit user installation/removal is allowed to supersede the initial decision. */
export async function recordRecommendedPackageMutation(agentDir: string, source: string, kind: 'install' | 'remove') {
  const recommendation = PI_RECOMMENDED_PACKAGES.find((item) => item.packageName === npmPackageNameForSource(source))
  if (!recommendation) return
  await new DefaultPackageRepository(agentDir).save({
    ...recommendation,
    source,
    status: kind === 'install' ? 'installed' : 'removed',
  })
}
