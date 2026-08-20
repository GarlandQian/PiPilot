import type {
  PiCompatibilityLabel,
  PiPackageSummary,
  PiResourceCounts,
} from './pi-integrations'

export const PI_MCP_ADAPTER_PACKAGE = 'pi-mcp-adapter' as const
export const PI_MCP_ADAPTER_SOURCE = 'npm:pi-mcp-adapter' as const
export const PI_SUBAGENTS_PACKAGE = 'pi-subagents' as const
export const PI_PLAN_MODE_PACKAGE = '@narumitw/pi-plan-mode' as const
export const PI_PLAN_MODE_VERSION = '0.50.1' as const
export const PI_GOAL_PACKAGE = '@narumitw/pi-goal' as const
export const PI_GOAL_VERSION = '0.52.2' as const

export type PiPackageAdapterId = 'mcp' | 'subagents' | 'plan-mode' | 'goal'

export interface PiPackageAdapterDefinition {
  id: PiPackageAdapterId
  packageName: string
  installPolicy: 'automatic-global' | 'user-managed'
  compatibility: PiCompatibilityLabel
  exactVersion?: string
}

/**
 * Shared package-level compatibility registry.
 *
 * Main uses this registry to classify official Pi package snapshots and own
 * package lifecycle policy. Renderer uses the same identities to activate
 * optional rich presentation. Unknown packages remain on the generic bridge.
 */
export const PI_PACKAGE_ADAPTERS: readonly PiPackageAdapterDefinition[] = [
  {
    id: 'mcp',
    packageName: PI_MCP_ADAPTER_PACKAGE,
    installPolicy: 'automatic-global',
    compatibility: 'rich-adapter',
  },
  {
    id: 'subagents',
    packageName: PI_SUBAGENTS_PACKAGE,
    installPolicy: 'user-managed',
    compatibility: 'partial',
  },
  {
    id: 'plan-mode',
    packageName: PI_PLAN_MODE_PACKAGE,
    installPolicy: 'user-managed',
    compatibility: 'rich-adapter',
    exactVersion: PI_PLAN_MODE_VERSION,
  },
  {
    id: 'goal',
    packageName: PI_GOAL_PACKAGE,
    installPolicy: 'user-managed',
    compatibility: 'rich-adapter',
    exactVersion: PI_GOAL_VERSION,
  },
]

export function npmPackageNameForSource(source: string): string | null {
  const value = source.startsWith('npm:') ? source.slice(4) : source
  if (!value || value.startsWith('.') || value.startsWith('/') || value.includes('://')) {
    return null
  }
  if (value.startsWith('@')) {
    const slash = value.indexOf('/')
    if (slash <= 1) return null
    const versionAt = value.indexOf('@', slash)
    return versionAt === -1 ? value : value.slice(0, versionAt)
  }
  const versionAt = value.indexOf('@')
  return versionAt === -1 ? value : value.slice(0, versionAt)
}

export function packageAdapterForSummary(
  summary: Pick<
    PiPackageSummary,
    'sourceType' | 'source' | 'displayName' | 'installedVersion'
  >,
): PiPackageAdapterDefinition | null {
  if (summary.sourceType !== 'npm') return null
  const packageName = npmPackageNameForSource(summary.source)
  if (!packageName || summary.displayName !== packageName) return null
  const adapter = PI_PACKAGE_ADAPTERS.find((candidate) =>
    candidate.packageName === packageName)
  if (!adapter) return null
  if (
    adapter.exactVersion !== undefined &&
    summary.installedVersion !== adapter.exactVersion
  ) return null
  return adapter
}

export function isManagedMcpPackageSource(source: string): boolean {
  return npmPackageNameForSource(source) === PI_MCP_ADAPTER_PACKAGE
}

export function compatibilityForPackage(
  summary: Pick<
    PiPackageSummary,
    'sourceType' | 'source' | 'displayName' | 'installedVersion'
  >,
  counts: PiResourceCounts,
): PiCompatibilityLabel {
  const adapter = packageAdapterForSummary(summary)
  if (adapter) return adapter.compatibility
  const generic = counts.skill + counts.prompt
  if (counts.extension > 0) return 'partial'
  if (generic > 0) return 'generic-rpc'
  if (counts.theme > 0) return 'pi-tui-only'
  return 'not-observed'
}
