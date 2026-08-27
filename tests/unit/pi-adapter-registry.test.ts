import { describe, expect, it } from 'vitest'
import type { LocalPiSlashCommand } from '../../src/shared/local-pi'
import type { PiPackageSummary } from '../../src/shared/pi-integrations'
import {
  contextIdentity,
  dedupeRuntimeAdapterPackages,
  detectRichAdapterCapabilities,
  RICH_ADAPTER_IDS,
} from '../../src/renderer/pi-rpc/adapters'
import {
  PI_MCP_ADAPTER_SOURCE,
  PI_PACKAGE_ADAPTERS,
  compatibilityForPackage,
} from '../../src/shared/pi-package-adapters'

function packageSummary(
  displayName: string,
  version: string,
  source = `npm:${displayName}@${version}`,
  scope: PiPackageSummary['scope'] = 'global',
): PiPackageSummary {
  return {
    id: `package:${displayName}`,
    source,
    sourceType: 'npm',
    displayName,
    scope,
    installedVersion: version,
    pinned: true,
    filtered: false,
    resourceCounts: { extension: 1, skill: 0, prompt: 0, theme: 0 },
    compatibility: 'rich-adapter',
    updateAvailable: false,
  }
}

function planCommand(
  source: string,
  scope: LocalPiSlashCommand['sourceInfo']['scope'] = 'user',
): LocalPiSlashCommand {
  return {
    name: 'plan',
    source: 'extension',
    sourceInfo: {
      path: '/not-retained/by-adapter.ts',
      source,
      scope,
      origin: 'package',
    },
  }
}

function goalCommand(
  source: string,
  scope: LocalPiSlashCommand['sourceInfo']['scope'] = 'user',
): LocalPiSlashCommand {
  return {
    name: 'goal',
    source: 'extension',
    sourceInfo: {
      path: '/not-retained/by-adapter.ts',
      source,
      scope,
      origin: 'package',
    },
  }
}

describe('rich Pi adapter registry', () => {
  it('keeps the reviewed rich renderer adapters explicit', () => {
    expect(RICH_ADAPTER_IDS).toEqual(['plan-mode', 'goal'])
    expect(PI_PACKAGE_ADAPTERS.map((adapter) => adapter.id)).toEqual([
      'mcp',
      'subagents',
      'plan-mode',
      'goal',
    ])
  })

  it('requires the exact Plan package, version, command source, origin, and scope', () => {
    const plan = packageSummary('@narumitw/pi-plan-mode', '0.50.1')
    const capabilities = detectRichAdapterCapabilities({
      packages: [plan],
      commands: [planCommand(plan.source)],
    })
    expect(capabilities.planMode).toEqual(expect.objectContaining({
      id: 'plan-mode',
      version: '0.50.1',
      packageSource: plan.source,
      commandSource: plan.source,
    }))
    expect(capabilities.planMode).not.toHaveProperty('path')

    expect(detectRichAdapterCapabilities({
      packages: [packageSummary('@narumitw/pi-plan-mode', '0.49.4')],
      commands: [planCommand(plan.source)],
    }).planMode).toBeNull()
    expect(detectRichAdapterCapabilities({
      packages: [plan],
      commands: [planCommand('npm:other@0.50.1')],
    }).planMode).toBeNull()
    expect(detectRichAdapterCapabilities({
      packages: [plan],
      commands: [planCommand(plan.source, 'project')],
    }).planMode).toBeNull()
    expect(detectRichAdapterCapabilities({
      packages: [{ ...plan, sourceType: 'local', source: plan.source }],
      commands: [planCommand(plan.source)],
    }).planMode).toBeNull()
  })

  it('requires the exact Goal package, version, command source, origin, and scope', () => {
    const goal = packageSummary('@narumitw/pi-goal', '0.52.2')
    const capabilities = detectRichAdapterCapabilities({
      packages: [goal],
      commands: [goalCommand(goal.source)],
    })
    expect(capabilities.goal).toEqual(expect.objectContaining({
      id: 'goal',
      version: '0.52.2',
      packageSource: goal.source,
      commandSource: goal.source,
    }))
    expect(capabilities.goal).not.toHaveProperty('path')

    expect(detectRichAdapterCapabilities({
      packages: [packageSummary('@narumitw/pi-goal', '0.51.0')],
      commands: [goalCommand(goal.source)],
    }).goal).toBeNull()
    expect(detectRichAdapterCapabilities({
      packages: [goal],
      commands: [goalCommand('npm:other@0.52.1')],
    }).goal).toBeNull()
    expect(detectRichAdapterCapabilities({
      packages: [goal],
      commands: [goalCommand(goal.source, 'project')],
    }).goal).toBeNull()
  })

  it('classifies MCP and Subagents from the shared Main/Renderer registry', () => {
    expect(compatibilityForPackage({
      sourceType: 'npm',
      source: PI_MCP_ADAPTER_SOURCE,
      displayName: 'pi-mcp-adapter',
      installedVersion: '2.26.0',
    }, { extension: 1, skill: 0, prompt: 0, theme: 0 })).toBe('rich-adapter')
    expect(compatibilityForPackage({
      sourceType: 'npm',
      source: 'npm:pi-subagents',
      displayName: 'pi-subagents',
      installedVersion: '0.50.0',
    }, { extension: 1, skill: 0, prompt: 0, theme: 0 })).toBe('partial')
  })

  it('uses Pi package identity and project precedence for runtime adapter packages', () => {
    const globalPlan = packageSummary('@narumitw/pi-plan-mode', '0.50.1', undefined, 'global')
    const projectPlan = packageSummary('@narumitw/pi-plan-mode', '0.50.1', undefined, 'project')
    const projectOther = packageSummary('@example/other', '1.0.0', undefined, 'project')
    const globalOther = packageSummary('@example/other', '1.0.0', undefined, 'global')
    const merged = dedupeRuntimeAdapterPackages([
      projectPlan,
      globalPlan,
      globalOther,
      projectOther,
    ])
    expect(merged).toEqual([
      projectPlan,
      projectOther,
    ])
    expect(detectRichAdapterCapabilities({
      packages: merged,
      commands: [planCommand(projectPlan.source, 'project')],
    }).planMode).toMatchObject({ commandScope: 'project' })

    const unsupportedProject = packageSummary('@narumitw/pi-plan-mode', '0.49.4', undefined, 'project')
    const supportedGlobal = packageSummary('@narumitw/pi-plan-mode', '0.50.1', undefined, 'global')
    expect(detectRichAdapterCapabilities({
      packages: dedupeRuntimeAdapterPackages([supportedGlobal, unsupportedProject]),
      commands: [planCommand(supportedGlobal.source)],
    }).planMode).toBeNull()
  })

  it('includes conversation scope, official session, and generation in identity', () => {
    const base = { scopeKey: 'project:one', sessionId: 'session-a', generation: 7 }
    expect(contextIdentity(base)).not.toBe(contextIdentity({ ...base, scopeKey: 'project:two' }))
    expect(contextIdentity(base)).not.toBe(contextIdentity({ ...base, sessionId: 'session-b' }))
    expect(contextIdentity(base)).not.toBe(contextIdentity({ ...base, generation: 8 }))
  })
})
