import { describe, expect, it } from 'vitest'
import {
  composerModeAvailability,
  composerModeMessage,
  composerModeShortcut,
  composerPlaceholderKey,
  planModeActive,
  type ComposerModeContext,
} from '../../src/components/chat/composer-modes'
import type { GoalModeProjection, PlanModeProjection } from '../../src/renderer/pi-rpc/adapters'
import type { LocalPiSlashCommand } from '../../src/shared/local-pi'

function command(name: string, source: LocalPiSlashCommand['source'] = 'extension'): LocalPiSlashCommand {
  return { name, source, sourceInfo: { path: `/package/${name}.ts`, source: `npm:${name}`, scope: 'user', origin: 'package' } }
}

const plan = (lifecycle: PlanModeProjection['lifecycle'], markdown: string | null = null) =>
  ({ lifecycle, markdown }) as PlanModeProjection
const goal = (lifecycle: GoalModeProjection['lifecycle']) => ({ lifecycle }) as GoalModeProjection

function context(overrides: Partial<ComposerModeContext> = {}): ComposerModeContext {
  return {
    commands: [command('plan'), command('goal')],
    catalogReady: true,
    isStreaming: false,
    planMode: null,
    goalMode: null,
    ...overrides,
  }
}

describe('composer modes', () => {
  it('offers a mode only when its plugin command is installed and Pi is idle', () => {
    expect(composerModeAvailability('plan', context())).toEqual({ enabled: true })
    expect(composerModeAvailability('goal', context())).toEqual({ enabled: true })
    expect(composerModeAvailability('plan', context({ catalogReady: false }))).toEqual({ enabled: false, reason: 'loading' })
    expect(composerModeAvailability('plan', context({ commands: [command('goal')] }))).toEqual({ enabled: false, reason: 'notInstalled' })
    // A same-named skill or prompt is not the plugin.
    expect(composerModeAvailability('goal', context({ commands: [command('goal', 'skill')] }))).toEqual({ enabled: false, reason: 'notInstalled' })
    expect(composerModeAvailability('goal', context({ isStreaming: true }))).toEqual({ enabled: false, reason: 'running' })
  })

  it('keeps Plan and Goal from starting over each other', () => {
    expect(composerModeAvailability('plan', context({ goalMode: goal('paused') }))).toEqual({ enabled: false, reason: 'goalUnfinished' })
    expect(composerModeAvailability('plan', context({ goalMode: goal('complete') }))).toEqual({ enabled: true })
    expect(composerModeAvailability('goal', context({ planMode: plan('ready', '# Plan') }))).toEqual({ enabled: false, reason: 'planActive' })
    // Implementing or saving has left Plan mode.
    expect(composerModeAvailability('goal', context({ planMode: plan('implementing', '# Plan') }))).toEqual({ enabled: true })
    expect(planModeActive(plan('planning'))).toBe(true)
    expect(planModeActive(plan('saved', '# Plan'))).toBe(false)
    expect(planModeActive(null)).toBe(false)
  })

  it('starts a mode through the plugin command with the typed text', () => {
    expect(composerModeMessage('plan', '  Add export to settings  ')).toBe('/plan Add export to settings')
    expect(composerModeMessage('goal', 'Ship 0.4')).toBe('/goal Ship 0.4')
  })

  it('words the placeholder by what the next message does', () => {
    const base = { mode: null, planActive: false, isStreaming: false, conversationEmpty: false }
    expect(composerPlaceholderKey({ ...base, conversationEmpty: true })).toBe('composer.placeholder.new')
    expect(composerPlaceholderKey(base)).toBe('composer.placeholder.reply')
    expect(composerPlaceholderKey({ ...base, isStreaming: true })).toBe('composer.placeholder.running')
    expect(composerPlaceholderKey({ ...base, planActive: true })).toBe('composer.placeholder.plan')
    expect(composerPlaceholderKey({ ...base, mode: 'goal', planActive: true })).toBe('composer.placeholder.goal')
    expect(composerPlaceholderKey({ ...base, mode: 'plan', conversationEmpty: true })).toBe('composer.placeholder.plan')
  })

  it('maps only primary+Shift+P/G to mode shortcuts', () => {
    const key = (key: string, extra: Partial<KeyboardEvent> = {}) =>
      ({ key, metaKey: true, ctrlKey: false, shiftKey: true, altKey: false, ...extra })
    expect(composerModeShortcut(key('P'))).toBe('plan')
    expect(composerModeShortcut(key('g', { metaKey: false, ctrlKey: true }))).toBe('goal')
    expect(composerModeShortcut(key('p', { shiftKey: false }))).toBeNull()
    expect(composerModeShortcut(key('p', { altKey: true }))).toBeNull()
    expect(composerModeShortcut(key('k'))).toBeNull()
  })
})
