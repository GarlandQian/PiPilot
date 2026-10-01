import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConversationContextPanel } from '../../src/components/inspector/ConversationContextPanel'
import { TooltipProvider } from '../../src/components/ui/tooltip'
import { CONVERSATION_TASK_CUSTOM_TYPE, type ConversationTaskSnapshot } from '../../src/shared/conversation-task'
import type { LocalPiSessionEntry, LocalPiSlashCommand } from '../../src/shared/local-pi'
import type { PiConversationPresentation } from '../../src/store/pi-rpc'
import type { GoalModeProjection, PlanModeProjection } from '../../src/renderer/pi-rpc/adapters'
import { PI_GOAL_PACKAGE, PI_GOAL_VERSION, PI_PLAN_MODE_PACKAGE, PI_PLAN_MODE_VERSION } from '../../src/shared/pi-package-adapters'

const state = vi.hoisted(() => ({
  entries: [] as LocalPiSessionEntry[],
  leafId: null as string | null,
  sessionId: 'current',
  generation: 1,
  commands: [] as LocalPiSlashCommand[],
  streaming: false,
  plan: null as PlanModeProjection | null,
  goal: null as GoalModeProjection | null,
  revealPlan: vi.fn(),
  goalAction: vi.fn(),
}))
vi.mock('@/store/pi-rpc', () => ({
  usePiRuntime: () => ({ commands: state.commands, runtime: { generation: 1 }, session: { isStreaming: state.streaming, isCompacting: false }, retryActivity: { kind: 'idle' } }),
  usePiSessionEntries: () => ({ entries: state.entries, leafId: state.leafId, sessionId: state.sessionId, generation: state.generation }),
}))
vi.mock('@/i18n', () => ({
  useLocale: () => 'en-US',
  useT: () => (key: string, params?: Record<string, string | number>) => params ? `${key} ${Object.values(params).join('/')}` : key,
}))
vi.mock('@/store/settings', () => ({ useSettings: () => ({ appearance: { showLineNumbers: false, wordWrap: true } }) }))

const task: ConversationTaskSnapshot = {
  version: 2, updatedAt: 1, summary: 'A **short** summary.', blockers: [],
  nextActions: [{ id: 'review', label: '**Review** the report', prompt: 'Review the report' }],
}

const plan: PlanModeProjection = {
  capability: { id: 'plan-mode', packageName: PI_PLAN_MODE_PACKAGE, version: PI_PLAN_MODE_VERSION,
    packageSource: `npm:${PI_PLAN_MODE_PACKAGE}@${PI_PLAN_MODE_VERSION}`, commandSource: `npm:${PI_PLAN_MODE_PACKAGE}@${PI_PLAN_MODE_VERSION}`, commandScope: 'user', commandName: 'plan' },
  scopeKey: 'projectless', sessionId: 'current', generation: 1,
  lifecycle: 'ready', markdown: '# A checked report\n\nVerify the report.', sourceEntryId: 'plugin-plan',
  completionToolCallIds: new Set(), customMessageKeys: new Set(), statusValue: 'plan ready', widget: null,
  actions: ['show', 'implement', 'save', 'export', 'revise', 'exit'],
}
const goal: GoalModeProjection = {
  capability: { id: 'goal', packageName: PI_GOAL_PACKAGE, version: PI_GOAL_VERSION,
    packageSource: `npm:${PI_GOAL_PACKAGE}@${PI_GOAL_VERSION}`, commandSource: `npm:${PI_GOAL_PACKAGE}@${PI_GOAL_VERSION}`, commandScope: 'user', commandName: 'goal' },
  scopeKey: 'projectless', sessionId: 'current', generation: 1, lifecycle: 'active', statusValue: 'active 1',
  goal: { id: 'plugin-goal', text: 'Complete the report', status: 'active', iteration: 1, tokensUsed: 10, timeUsedSeconds: 1, automaticModelTurns: 0 },
  actions: ['status', 'pause', 'clear'],
}

function render(presentation: PiConversationPresentation = { status: 'ready', sessionId: 'current' }) {
  return renderToStaticMarkup(createElement(TooltipProvider, null, createElement(ConversationContextPanel, {
    presentation, planMode: state.plan, goalMode: state.goal, onRevealPlan: state.revealPlan, onGoalAction: state.goalAction,
    onNavigate: vi.fn(), onSuggest: vi.fn(),
  })))
}

beforeEach(() => {
  state.entries = [
    { id: 'user', parentId: null, type: 'message', timestamp: '2026-10-01T00:00:00Z', message: { role: 'user', content: 'Prepare a report', timestamp: 0 } },
    { id: 'task', parentId: 'user', type: 'custom', timestamp: '2026-10-01T00:00:00Z', customType: CONVERSATION_TASK_CUSTOM_TYPE, data: structuredClone(task) },
  ]
  state.leafId = 'task'
  state.sessionId = 'current'
  state.generation = 1
  state.streaming = false
  state.commands = []
  state.plan = structuredClone(plan)
  state.goal = null
  state.revealPlan.mockClear()
  state.goalAction.mockClear()
})

describe('conversation overview', () => {
  it('links to the plan in the transcript instead of repeating it, and puts safe draft suggestions beside the summary', () => {
    const markup = render()
    expect(markup).toContain('A <strong>short</strong> summary.')
    expect(markup).toContain('plan.lifecycle.ready')
    expect(markup).toMatch(/<button[^>]*data-plan-summary[^>]*aria-label="plan.overview.open plan.lifecycle.ready"/u)
    // The plan body and its decisions live only on the transcript card.
    expect(markup).not.toContain('A checked report')
    expect(markup).not.toMatch(/plan\.action\./u)
    expect(markup).not.toContain('taskContext.planProgress')
    expect(markup).not.toContain('taskContext.resume')
    expect(markup).not.toContain('Read source.md')
    expect(markup.indexOf('<strong>Review</strong>')).toBeLessThan(markup.indexOf('data-plan-summary'))
    expect(markup).toContain('taskContext.draftHint')
    expect(markup).not.toContain('taskContext.export')
    expect(state.revealPlan).not.toHaveBeenCalled()
    expect(state.goalAction).not.toHaveBeenCalled()
  })

  it('reads legacy metadata without resurrecting its plan controls or claiming completion', () => {
    state.plan = null
    const entry = state.entries[1]!
    if (entry.type !== 'custom') throw new Error('Expected task state')
    entry.data = { ...task, version: 1, plan: { id: 'retired', title: 'Retired plan', status: 'completed', approvedAt: 1,
      steps: [{ id: 'write', title: 'Write report', status: 'completed', evidence: 'Old acceptance evidence' }] } }
    const markup = render()
    expect(markup).toContain('A <strong>short</strong> summary.')
    expect(markup).toContain('taskContext.draftHint')
    expect(markup).not.toMatch(/data-plan-summary|Retired plan|taskContext\.status\.completed|taskContext\.approve|taskContext\.resume/)
  })

  it('shows independent plugin lifecycle labels without treating a plan handoff as completion', () => {
    state.plan = { ...plan, lifecycle: 'implementing', actions: ['show', 'revise', 'exit'] }
    state.goal = structuredClone(goal)
    const markup = render()
    expect(markup).toContain('plan.lifecycle.implementing')
    expect(markup).toContain('goal.lifecycle.active')
    expect(markup).toMatch(/aria-expanded="false"[^>]*data-goal-summary/u)
    expect(markup).not.toContain('taskContext.next')
    expect(markup).not.toContain('taskContext.status.completed')
    state.goal = { ...goal, lifecycle: 'complete', actions: [], goal: { ...goal.goal!, status: 'complete' } }
    expect(render()).toContain('goal.lifecycle.complete')
    expect(render()).toContain('plan.lifecycle.implementing')
  })

  it('withholds plugin state from a previous session or runtime generation', () => {
    state.plan = { ...plan, sessionId: 'old' }
    state.goal = { ...goal, generation: 0 }
    const markup = render()
    expect(markup).toContain('A <strong>short</strong> summary.')
    expect(markup).not.toMatch(/data-plan-summary|data-goal-summary/)
  })

  it('hides empty sections and does not present the available skill inventory as work performed', () => {
    state.commands = [{ name: 'skill:unused-inventory', source: 'skill', sourceInfo: { source: 'fixture', scope: 'project', path: '/fixture/skill.md', origin: 'top-level' } }]
    const markup = render()
    for (const section of ['outputs', 'sources', 'capabilities', 'web']) expect(markup).not.toContain(`taskContext.${section}`)
    expect(markup).not.toContain('unused-inventory')
  })

  it('keeps a long summary expandable without clipping focusable Markdown controls', () => {
    const snapshot = state.entries[1]!
    if (snapshot.type !== 'custom') throw new Error('Expected task state')
    snapshot.data = { ...structuredClone(task), summary: `${'A longer summary. '.repeat(20)} [Read the report](https://example.com/report)` }
    const markup = render()
    expect(markup).toContain('taskContext.summaryMore')
    expect(markup).toContain('Read the report')
    expect(markup).not.toContain('href="https://example.com/report"')
  })

  it('still exposes a compact section for a skill actually invoked in the current conversation', () => {
    state.entries[0] = { id: 'user', parentId: null, type: 'message', timestamp: '2026-10-01T00:00:00Z', message: {
      role: 'user', timestamp: 0, content: '<skill name="review" location="/fixture/review.md">\nInstructions\n</skill>\n\nReview the work',
    } }
    expect(render()).toContain('taskContext.capabilities')
  })

  it('does not show stale content while another session or generation is loading', () => {
    state.sessionId = 'old'
    let markup = render()
    expect(markup).toContain('taskContext.loading')
    expect(markup).not.toContain('short')
    state.sessionId = 'current'
    state.generation = 0
    markup = render()
    expect(markup).toContain('taskContext.loading')
    expect(markup).not.toContain('short')
    expect(render({ status: 'empty' })).toContain('taskContext.unselected')
    expect(render({ status: 'error', error: 'Unavailable' })).toContain('role="alert"')
  })

  it('withholds suggestions during execution and after a newer user message', () => {
    state.streaming = true
    expect(render()).toContain('taskContext.status.responding')
    expect(render()).not.toContain('taskContext.next')
    state.streaming = false
    state.entries.push({ id: 'new-user', parentId: 'task', type: 'message', timestamp: '2026-10-01T00:01:00Z', message: { role: 'user', content: 'Change the plan', timestamp: 2 } })
    state.leafId = 'new-user'
    expect(render()).not.toContain('taskContext.next')
  })
})
