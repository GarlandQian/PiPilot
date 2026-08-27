import type {
  PiIntegrationScope,
  PiPackageSourceType,
} from '../../shared/pi-integrations'

export interface ScopedConfiguredPackage {
  source: string
  scope: 'user' | 'project'
}

export interface ScopedPackageInstaller {
  listConfiguredPackages(): ScopedConfiguredPackage[]
  install(source: string, options?: { local?: boolean }): Promise<void>
}

// Pi does not expose parseSource publicly; mirror its semver.valid exact-version rule.
const NPM_SPEC_PATTERN = /^(@?[^@]+(?:\/[^@]+)?)(?:@(.+))?$/u
const SEMVER_CORE_NUMBER = '(0|[1-9]\\d*)'
const SEMVER_PRERELEASE_IDENTIFIER = '(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*)'
const EXACT_SEMVER_PATTERN = new RegExp(
  `^v?${SEMVER_CORE_NUMBER}\\.${SEMVER_CORE_NUMBER}\\.${SEMVER_CORE_NUMBER}` +
  `(?:-${SEMVER_PRERELEASE_IDENTIFIER}(?:\\.${SEMVER_PRERELEASE_IDENTIFIER})*)?` +
  '(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$',
  'u',
)
const SEMVER_MAX_LENGTH = 256

function scopedOperationError(code: string, message: string) {
  const error = new Error(message) as Error & { code: string }
  error.code = code
  return error
}

export function piPackageSourceType(source: string): PiPackageSourceType {
  if (source.startsWith('npm:')) return 'npm'
  const gitSource = source.trim()
  if (
    gitSource.startsWith('git:') ||
    /^(?:https?|ssh|git):\/\//iu.test(gitSource)
  ) return 'git'
  return 'local'
}

export function piPackageSourceIsPinned(
  source: string,
  type: PiPackageSourceType,
) {
  if (type === 'local') return true
  if (type === 'git') return false

  const spec = source.slice(4).trim()
  const version = NPM_SPEC_PATTERN.exec(spec)?.[2]?.trim()
  if (!version || version.length > SEMVER_MAX_LENGTH) return false
  const match = EXACT_SEMVER_PATTERN.exec(version)
  if (!match) return false
  return match.slice(1, 4).every((part) => (
    part !== undefined && Number(part) <= Number.MAX_SAFE_INTEGER
  ))
}

export async function updateConfiguredPackageForScope(
  packageManager: ScopedPackageInstaller,
  source: string,
  scope: PiIntegrationScope,
) {
  const expectedScope = scope.kind === 'project' ? 'project' : 'user'
  const configured = packageManager.listConfiguredPackages().find((entry) => (
    entry.scope === expectedScope && entry.source === source
  ))
  if (!configured) {
    throw scopedOperationError(
      'PI_MANAGEMENT_PACKAGE_NOT_CONFIGURED',
      'The selected Pi package is no longer configured in this scope.',
    )
  }
  if (piPackageSourceIsPinned(source, piPackageSourceType(source))) {
    throw scopedOperationError(
      'PI_MANAGEMENT_PACKAGE_PINNED',
      'Pinned Pi package sources cannot be updated.',
    )
  }

  await packageManager.install(configured.source, {
    local: expectedScope === 'project',
  })
}
