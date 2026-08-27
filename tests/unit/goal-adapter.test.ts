import { describe, expect, it } from 'vitest'
import {
  GOAL_ACTION_ROUTES,
  projectGoalMode,
} from '../../src/renderer/pi-rpc/adapters/goal'
import type { GoalCapability } from '../../src/renderer/pi-rpc/adapters/registry'
import { createLocalPiProjectorState } from '../../src/renderer/pi-rpc/projector'

const capability: GoalCapability = {
  id: 'goal',
  packageName: '@narumitw/pi-goal',
  version: '0.52.2',
  packageSource: 'npm:@narumitw/pi-goal@0.52.2',
  commandSource: 'npm:@narumitw/pi-goal@0.52.2',
  commandScope: 'user',
  commandName: 'goal',
}

function goalEntry(goal: unknown, id = 'entry-goal') {
  return {
    id,
    parentId: null,
    timestamp: '2026-08-16T00:00:00.000Z',
    type: 'custom' as const,
    customType: 'goal-state',
    data: { goal },
  }
}

function state(entries: ReturnType<typeof goalEntry>[]) {
  return createLocalPiProjectorState({
    generation: 7,
    sessionId: 'session-a',
    entrySnapshot: {
      generation: 7,
      sessionId: 'session-a',
      entries,
      leafId: entries[entries.length - 1]?.id ?? null,
      cursor: entries[entries.length - 1]?.id ?? null,
    },
  })
}

const activeGoal = {
  id: 'goal-id',
  text: 'Ship the PiPilot goal adapter',
  status: 'active',
  iteration: 3,
  tokensUsed: 12_000,
  tokenBudget: 50_000,
  timeUsedSeconds: 95,
  automaticModelTurns: 2,
}

describe('Goal adapter', () => {
  it('projects the latest bounded goal-state entry with direct command actions', () => {
    const projection = projectGoalMode(
      state([
        goalEntry({ ...activeGoal, text: 'Old goal' }, 'entry-old'),
        goalEntry(activeGoal, 'entry-current'),
      ]),
      capability,
      { scopeKey: 'project:one', statuses: { goal: 'active 12k/50k · automatic 2/25' } },
    )

    expect(projection).toMatchObject({
      scopeKey: 'project:one',
      sessionId: 'session-a',
      generation: 7,
      lifecycle: 'active',
      goal: {
        text: 'Ship the PiPilot goal adapter',
        tokenBudget: 50_000,
        tokensUsed: 12_000,
      },
      actions: ['status', 'pause', 'clear'],
    })
    expect(GOAL_ACTION_ROUTES).toEqual({
      status: '/goal status',
      pause: '/goal pause',
      resume: '/goal resume',
      clear: '/goal clear',
    })
  })

  it('uses waiting state and exposes resume without parsing the reason from status text', () => {
    const projection = projectGoalMode(
      state([goalEntry({
        ...activeGoal,
        waiting: { reason: 'Waiting for CI', resumeAt: 1_800_000_000_000 },
      })]),
      capability,
      { scopeKey: 'project:one', statuses: { goal: 'waiting untrusted summary · automatic 2/25' } },
    )
    expect(projection).toMatchObject({
      lifecycle: 'waiting',
      goal: { waiting: { reason: 'Waiting for CI' } },
      actions: ['status', 'resume', 'clear'],
    })
  })

  it('honors the latest clear entry and retains only the bounded completion status', () => {
    const projection = projectGoalMode(
      state([goalEntry(activeGoal, 'entry-active'), goalEntry(null, 'entry-clear')]),
      capability,
      { scopeKey: 'project:one', statuses: { goal: 'complete' } },
    )
    expect(projection).toMatchObject({
      lifecycle: 'complete',
      goal: null,
      actions: [],
    })
    expect(projectGoalMode(
      state([goalEntry(activeGoal, 'entry-active'), goalEntry(null, 'entry-clear')]),
      capability,
      { scopeKey: 'project:one', statuses: {} },
    )).toBeNull()
  })

  it('rejects malformed goal data instead of leaking partial state', () => {
    expect(projectGoalMode(
      state([goalEntry({ ...activeGoal, text: '', tokensUsed: -1 })]),
      capability,
      { scopeKey: 'project:one', statuses: {} },
    )).toBeNull()
  })
})
