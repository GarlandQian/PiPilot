import { describe, expect, it } from 'vitest'
import type { LocalPiAgentMessage, LocalPiSlashCommand } from '../../src/shared/local-pi'
import type { PiPackageSummary } from '../../src/shared/pi-integrations'
import {
  PLAN_MAX_MARKDOWN_CHARS,
  detectPlanModeCapability,
  parsePlanCompletionDetails,
  parseProposedPlanMessage,
  planActionRoute,
  projectPlanMode,
} from '../../src/renderer/pi-rpc/adapters'
import { createLocalPiProjectorState } from '../../src/renderer/pi-rpc/projector'
import { projectLocalPiTurns } from '../../src/renderer/pi-rpc/presentation'

const source = 'npm:@narumitw/pi-plan-mode@0.50.1'

const planPackage: PiPackageSummary = {
  id: 'plan-package',
  source,
  sourceType: 'npm',
  displayName: '@narumitw/pi-plan-mode',
  scope: 'global',
  installedVersion: '0.50.1',
  pinned: true,
  filtered: false,
  resourceCounts: { extension: 1, skill: 0, prompt: 0, theme: 0 },
  compatibility: 'rich-adapter',
  updateAvailable: false,
}

const planCommand: LocalPiSlashCommand = {
  name: 'plan',
  source: 'extension',
  sourceInfo: {
    path: '/package/plan-mode.ts',
    source,
    scope: 'user',
    origin: 'package',
  },
}

const capability = detectPlanModeCapability({
  packages: [planPackage],
  commands: [planCommand],
})!

function completion(
  details: unknown,
  toolName = 'plan_mode_complete',
  toolCallId = 'plan-call',
): LocalPiAgentMessage {
  return {
    role: 'toolResult',
    toolCallId,
    toolName,
    content: [{ type: 'text', text: 'Plan completed' }],
    details,
    isError: false,
    timestamp: 2,
  }
}

function state(messages: readonly LocalPiAgentMessage[]) {
  return createLocalPiProjectorState({
    generation: 7,
    sessionId: 'session-a',
    messages,
  })
}

describe('Plan Mode adapter', () => {
  it('accepts only exact bounded plan_mode_complete v1 details', () => {
    expect(parsePlanCompletionDetails({
      version: 1,
      source: 'plan_mode_complete',
      plan: '  ## Ship it  ',
    })).toEqual({ version: 1, source: 'plan_mode_complete', plan: '## Ship it' })
    expect(parsePlanCompletionDetails({
      version: 2,
      source: 'plan_mode_complete',
      plan: 'No',
    })).toBeNull()
    expect(parsePlanCompletionDetails({
      version: 1,
      source: 'plan_mode_complete',
      plan: 'x'.repeat(PLAN_MAX_MARKDOWN_CHARS + 1),
    })).toBeNull()
  })

  it('projects a valid completion as bounded rich Markdown and replaces its generic tool', () => {
    const projectionState = state([completion({
      version: 1,
      source: 'plan_mode_complete',
      plan: '# Proposed\n\n1. Test\n2. Ship',
    })])
    const plan = projectPlanMode(projectionState, capability, {
      scopeKey: 'projectless',
      statuses: { 'plan-mode': 'plan ready' },
      widgets: [{
        key: 'plan-mode-plan',
        placement: 'aboveEditor',
        lines: [
          'Proposed plan ready',
          'Use /plan to implement, save, revise, or exit Plan mode.',
        ],
      }],
    })
    expect(plan).toMatchObject({
      lifecycle: 'ready',
      markdown: '# Proposed\n\n1. Test\n2. Ship',
      sourceEntryId: 'plan-call',
      statusValue: 'plan ready',
      scopeKey: 'projectless',
      sessionId: 'session-a',
      generation: 7,
    })
    expect(plan?.actions).toEqual(expect.arrayContaining([
      'show', 'revise', 'implement', 'save', 'export', 'exit',
    ]))
    expect(projectLocalPiTurns(projectionState, { planMode: plan })).toContainEqual(
      expect.objectContaining({ kind: 'plan', markdown: '# Proposed\n\n1. Test\n2. Ship' }),
    )
    expect(projectLocalPiTurns(projectionState, { planMode: plan })).not.toContainEqual(
      expect.objectContaining({ kind: 'tool' }),
    )
  })

  it('keeps malformed details and the wrong tool name generic', () => {
    for (const message of [
      completion({ version: 2, source: 'plan_mode_complete', plan: '# Future' }),
      completion({ version: 1, source: 'plan_mode_complete', plan: '# Wrong tool' }, 'other_tool'),
    ]) {
      const projectionState = state([message])
      expect(projectPlanMode(projectionState, capability, { scopeKey: 'projectless' })).toBeNull()
      expect(projectLocalPiTurns(projectionState)).toContainEqual(
        expect.objectContaining({ kind: 'tool' }),
      )
    }
  })

  it('accepts only exact proposed-plan headings', () => {
    const proposed = {
      role: 'custom' as const,
      customType: 'proposed-plan',
      content: '**Saved Plan**\n\n# Later',
      display: true,
      timestamp: 3,
    }
    expect(parseProposedPlanMessage(proposed)).toEqual({
      title: 'Saved Plan',
      lifecycle: 'saved',
      markdown: '# Later',
    })
    expect(parseProposedPlanMessage({
      ...proposed,
      content: '**A Plan**\n\n# Not official',
    })).toBeNull()
  })

  it('does not offer revision while planning without a complete plan', () => {
    const planning = projectPlanMode(state([]), capability, {
      scopeKey: 'projectless',
      statuses: { 'plan-mode': 'plan active' },
      widgets: [{
        key: 'plan-mode-plan',
        placement: 'aboveEditor',
        lines: [
          'Plan mode: planning',
          'Read only tools',
          'Finish with plan_mode_complete when decision-ready.',
        ],
      }],
    })
    expect(planning?.lifecycle).toBe('planning')
    expect(planning?.actions).toEqual(['finalize', 'exit'])
    expect(planning?.actions).not.toContain('revise')
  })

  it('maps only externally reachable direct routes', () => {
    expect(planActionRoute('show')).toBe('/plan show')
    expect(planActionRoute('finalize')).toBe('/plan finalize')
    expect(planActionRoute('implement')).toBe('/plan implement')
    expect(planActionRoute('save')).toBe('/plan save')
    expect(planActionRoute('export')).toBe('/plan export')
    expect(planActionRoute('exit')).toBe('/plan exit')
  })

  it('keeps rich actions on the latest producing plan turn only', () => {
    const projectionState = state([
      completion({
        version: 1,
        source: 'plan_mode_complete',
        plan: '# Earlier',
      }, 'plan_mode_complete', 'plan-call-earlier'),
      completion({
        version: 1,
        source: 'plan_mode_complete',
        plan: '# Current',
      }, 'plan_mode_complete', 'plan-call-current'),
    ])
    const plan = projectPlanMode(projectionState, capability, {
      scopeKey: 'projectless',
      statuses: { 'plan-mode': 'plan ready' },
    })!
    const turns = projectLocalPiTurns(projectionState, { planMode: plan })
    expect(turns).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'plan',
        markdown: '# Earlier',
        sourceEntryId: 'plan-call-earlier',
        actions: [],
      }),
      expect.objectContaining({
        kind: 'plan',
        markdown: '# Current',
        sourceEntryId: 'plan-call-current',
        actions: expect.arrayContaining(['implement', 'exit']),
      }),
    ]))
  })

  it('deduplicates tool and proposed-plan surfaces without dropping the current source', () => {
    const custom: LocalPiAgentMessage = {
      role: 'custom',
      customType: 'proposed-plan',
      content: '**Proposed Plan**\n\n# Same plan',
      display: true,
      timestamp: 3,
    }
    const projectionState = state([
      completion({
        version: 1,
        source: 'plan_mode_complete',
        plan: '# Same plan',
      }),
      custom,
    ])
    const plan = projectPlanMode(projectionState, capability, {
      scopeKey: 'projectless',
    })!
    const turns = projectLocalPiTurns(projectionState, { planMode: plan })
    expect(turns.filter((turn) => turn.kind === 'plan')).toHaveLength(1)
    expect(turns).toContainEqual(expect.objectContaining({
      kind: 'plan',
      sourceEntryId: 'custom:3:1',
      actions: expect.arrayContaining(['show', 'revise', 'exit']),
    }))
  })
})
