import type { LocalPiSlashCommand } from '@/shared/local-pi'
import type { PiPackageSummary } from '@/shared/pi-integrations'
import {
  PI_GOAL_PACKAGE,
  PI_GOAL_VERSION,
  PI_PLAN_MODE_PACKAGE,
  PI_PLAN_MODE_VERSION,
  npmPackageNameForSource,
} from '@/shared/pi-package-adapters'

/** Rich adapters are deliberately a closed set. Unknown extensions stay generic. */
export const RICH_ADAPTER_IDS = ['plan-mode', 'goal'] as const
export type RichAdapterId = (typeof RICH_ADAPTER_IDS)[number]

export const PLAN_MODE_PACKAGE = PI_PLAN_MODE_PACKAGE
export const PLAN_MODE_VERSION = PI_PLAN_MODE_VERSION
export const GOAL_PACKAGE = PI_GOAL_PACKAGE
export const GOAL_VERSION = PI_GOAL_VERSION

export interface RichAdapterContext {
  scopeKey: string
  sessionId: string
  generation: number
  packages: readonly PiPackageSummary[]
  commands: readonly LocalPiSlashCommand[]
}

export interface PlanModeCapability {
  id: 'plan-mode'
  packageName: typeof PLAN_MODE_PACKAGE
  version: typeof PLAN_MODE_VERSION
  packageSource: string
  commandSource: string
  commandScope: LocalPiSlashCommand['sourceInfo']['scope']
  commandName: 'plan'
}

export interface GoalCapability {
  id: 'goal'
  packageName: typeof GOAL_PACKAGE
  version: typeof GOAL_VERSION
  packageSource: string
  commandSource: string
  commandScope: LocalPiSlashCommand['sourceInfo']['scope']
  commandName: 'goal'
}

export interface RichAdapterCapabilities {
  planMode: PlanModeCapability | null
  goal: GoalCapability | null
}

function packageMatches(
  summary: PiPackageSummary,
  packageName: string,
  version: string,
) {
  // The helper's installedVersion is the authoritative manifest version. The
  // source/name checks prevent a package with a forged display label from
  // activating an adapter.
  return summary.sourceType === 'npm' &&
    summary.installedVersion === version &&
    npmPackageNameForSource(summary.source) === packageName &&
    summary.displayName === packageName
}

function commandMatchesPackage(
  command: LocalPiSlashCommand,
  summary: PiPackageSummary,
  commandName: string,
) {
  const expectedScope = summary.scope === 'global' ? 'user' : 'project'
  return command.name === commandName &&
    command.source === 'extension' &&
    command.sourceInfo.origin === 'package' &&
    command.sourceInfo.source === summary.source &&
    command.sourceInfo.scope === expectedScope
}

function matchingPackage(
  packages: readonly PiPackageSummary[],
  packageName: string,
  version: string,
) {
  // Pi resolves project package identities before global identities. Do the
  // same selection before validating the exact supported version so an
  // unsupported project override cannot accidentally reactivate a supported
  // global package. The final source/id tie-break keeps malformed snapshots
  // deterministic without depending on Promise.all or Map insertion order.
  const candidates = packages
    .filter((summary) => summary.sourceType === 'npm' &&
      npmPackageNameForSource(summary.source) === packageName &&
      summary.displayName === packageName)
    .sort((left, right) => {
      const scopeOrder = (scope: PiPackageSummary['scope']) => scope === 'project' ? 0 : 1
      return scopeOrder(left.scope) - scopeOrder(right.scope) ||
        left.source.localeCompare(right.source) ||
        left.id.localeCompare(right.id)
    })
  const summary = candidates[0]
  return summary && packageMatches(summary, packageName, version) ? summary : null
}

function runtimePackageIdentity(summary: PiPackageSummary) {
  const name = summary.sourceType === 'npm'
    ? npmPackageNameForSource(summary.source)
    : null
  if (name) return `npm:${name}`
  // Rich adapters only activate for npm packages. Preserve git/local package
  // summaries instead of applying an incomplete identity model to generic
  // extension data.
  return `${summary.scope}:${summary.id}`
}

/**
 * Join global and project runtime package snapshots using the package identity
 * Pi uses for npm packages. Project entries win same-name npm collisions;
 * git/local package rows retain their deterministic input identity.
 */
export function dedupeRuntimeAdapterPackages(
  packages: readonly PiPackageSummary[],
): PiPackageSummary[] {
  const result: PiPackageSummary[] = []
  const positions = new Map<string, number>()
  for (const summary of packages) {
    const identity = runtimePackageIdentity(summary)
    const existingPosition = positions.get(identity)
    if (existingPosition === undefined) {
      positions.set(identity, result.length)
      result.push(summary)
      continue
    }
    const existing = result[existingPosition]
    if (existing?.scope === 'global' && summary.scope === 'project') {
      result[existingPosition] = summary
    }
  }
  return result
}

export function detectPlanModeCapability(
  context: Pick<RichAdapterContext, 'packages' | 'commands'>,
): PlanModeCapability | null {
  const summary = matchingPackage(context.packages, PLAN_MODE_PACKAGE, PLAN_MODE_VERSION)
  if (!summary) return null
  const command = context.commands.find((candidate) =>
    commandMatchesPackage(candidate, summary, 'plan'))
  if (!command) return null
  return {
    id: 'plan-mode',
    packageName: PLAN_MODE_PACKAGE,
    version: PLAN_MODE_VERSION,
    packageSource: summary.source,
    commandSource: command.sourceInfo.source,
    commandScope: command.sourceInfo.scope,
    commandName: 'plan',
  }
}

export function detectGoalCapability(
  context: Pick<RichAdapterContext, 'packages' | 'commands'>,
): GoalCapability | null {
  const summary = matchingPackage(context.packages, GOAL_PACKAGE, GOAL_VERSION)
  if (!summary) return null
  const command = context.commands.find((candidate) =>
    commandMatchesPackage(candidate, summary, 'goal'))
  if (!command) return null
  return {
    id: 'goal',
    packageName: GOAL_PACKAGE,
    version: GOAL_VERSION,
    packageSource: summary.source,
    commandSource: command.sourceInfo.source,
    commandScope: command.sourceInfo.scope,
    commandName: 'goal',
  }
}

export function detectRichAdapterCapabilities(
  context: Pick<RichAdapterContext, 'packages' | 'commands'>,
): RichAdapterCapabilities {
  return {
    planMode: detectPlanModeCapability(context),
    goal: detectGoalCapability(context),
  }
}

export function contextIdentity(context: Pick<RichAdapterContext, 'scopeKey' | 'sessionId' | 'generation'>) {
  return `${context.scopeKey}\0${context.sessionId}\0${context.generation}`
}
