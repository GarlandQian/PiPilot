import { describe, expect, it } from 'vitest'
import {
  menuPlanActions,
  planActionIsDestructive,
  planActionLabelKey,
  planNeedsDecision,
  primaryPlanAction,
} from '../../src/components/chat/plan-presentation'

const all = ['show', 'finalize', 'implement', 'save', 'export', 'revise', 'exit'] as const

describe('plan card actions', () => {
  it('offers one primary action only while the plan waits on the user', () => {
    expect(primaryPlanAction('ready', all)).toBe('implement')
    expect(primaryPlanAction('saved', all)).toBe('implement')
    expect(primaryPlanAction('planning', all)).toBeNull()
    expect(primaryPlanAction('implementing', all)).toBeNull()
    expect(primaryPlanAction('ready', ['revise', 'exit'])).toBeNull()
    expect(planNeedsDecision('ready')).toBe(true)
    expect(planNeedsDecision('implementing')).toBe(false)
  })

  it('moves the rest into the menu in a fixed order and never offers "show"', () => {
    expect(menuPlanActions('ready', all)).toEqual(['finalize', 'revise', 'save', 'export', 'exit'])
    expect(menuPlanActions('ready', ['exit', 'export', 'show', 'implement', 'revise', 'save']))
      .toEqual(['revise', 'save', 'export', 'exit'])
    expect(menuPlanActions('saved', ['show', 'implement', 'export', 'exit'])).toEqual(['export', 'exit'])
    expect(menuPlanActions('planning', ['finalize', 'exit'])).toEqual(['finalize', 'exit'])
    expect(menuPlanActions('implementing', ['show', 'exit'])).toEqual(['exit'])
  })

  it('names leaving plan mode by what it costs', () => {
    expect(planActionLabelKey('exit', 'planning')).toBe('plan.action.exit')
    expect(planActionLabelKey('exit', 'ready')).toBe('plan.action.exit')
    expect(planActionLabelKey('exit', 'saved')).toBe('plan.action.discard')
    expect(planActionLabelKey('exit', 'implementing')).toBe('plan.action.discard')
    expect(planActionLabelKey('revise', 'ready')).toBe('plan.action.revise')
    expect(planActionIsDestructive('exit', 'saved')).toBe(true)
    expect(planActionIsDestructive('exit', 'ready')).toBe(false)
    expect(planActionIsDestructive('export', 'saved')).toBe(false)
  })
})
