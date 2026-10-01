import { getConversationBranchEntries } from '@/shared/conversation-task'
import { getGoalStateFromBranch, type GoalSnapshot } from '@/shared/goal-state'
import type { LocalPiProjectorState } from '../projector'
import type { GoalCapability } from './registry'

export const GOAL_STATUS_KEY = 'goal' as const
export { GOAL_STATE_ENTRY_TYPE, type GoalSnapshot } from '@/shared/goal-state'

export type GoalLifecycle =
  | 'active'
  | 'waiting'
  | 'paused'
  | 'blocked'
  | 'usage-limited'
  | 'budget-limited'
  | 'complete'

export const GOAL_ACTION_IDS = ['status', 'pause', 'resume', 'clear'] as const
export type GoalActionId = (typeof GOAL_ACTION_IDS)[number]

export const GOAL_ACTION_ROUTES: Readonly<Record<GoalActionId, string>> = {
  status: '/goal status',
  pause: '/goal pause',
  resume: '/goal resume',
  clear: '/goal clear',
}

export interface GoalModeProjection {
  capability: GoalCapability
  scopeKey: string
  sessionId: string
  generation: number
  goal: GoalSnapshot | null
  lifecycle: GoalLifecycle
  statusValue: string | null
  actions: readonly GoalActionId[]
}

function latestGoalState(state: LocalPiProjectorState): ReturnType<typeof getGoalStateFromBranch> {
  const snapshot = state.entrySnapshot
  if (!snapshot) return undefined
  if (snapshot.sessionId !== state.sessionId || snapshot.generation !== state.generation) return null
  const branch = getConversationBranchEntries(snapshot.entries, snapshot.leafId)
  return branch ? getGoalStateFromBranch(branch) : null
}

function lifecycleFromSnapshot(goal: GoalSnapshot): GoalLifecycle {
  if (goal.waiting) return 'waiting'
  if (goal.status === 'usage_limited') return 'usage-limited'
  if (goal.status === 'budget_limited') return 'budget-limited'
  return goal.status
}

function lifecycleFromStatus(value: string | undefined): GoalLifecycle | null {
  if (!value) return null
  if (value === 'complete') return 'complete'
  if (value.startsWith('active ')) return 'active'
  if (value.startsWith('waiting ')) return 'waiting'
  if (value.startsWith('paused ')) return 'paused'
  if (value.startsWith('blocked ')) return 'blocked'
  if (value.startsWith('usage ')) return 'usage-limited'
  if (value.startsWith('budget ')) return 'budget-limited'
  return null
}

function actionsFor(lifecycle: GoalLifecycle): GoalActionId[] {
  if (lifecycle === 'complete') return []
  if (lifecycle === 'waiting') return ['status', 'pause', 'resume', 'clear']
  if (lifecycle === 'active') {
    return ['status', 'pause', 'clear']
  }
  return ['status', 'resume', 'clear']
}

export function projectGoalMode(
  state: LocalPiProjectorState,
  capability: GoalCapability | null,
  context: { scopeKey: string; statuses?: Readonly<Record<string, string>> },
): GoalModeProjection | null {
  if (!capability || !state.sessionId || state.sessionId === 'none') return null
  const statusValue = context.statuses?.[GOAL_STATUS_KEY]
  const latest = latestGoalState(state)
  if (latest === null) return null
  const goal = latest?.goal
  const lifecycle = goal ? lifecycleFromSnapshot(goal)
    : goal === null ? (statusValue === 'complete' ? 'complete' : null)
      : lifecycleFromStatus(statusValue)
  if (!lifecycle) return null
  return {
    capability,
    scopeKey: context.scopeKey,
    sessionId: state.sessionId,
    generation: state.generation,
    goal: goal ?? null,
    lifecycle,
    statusValue: statusValue ?? null,
    actions: actionsFor(lifecycle),
  }
}

export function goalActionRoute(action: GoalActionId) {
  return GOAL_ACTION_ROUTES[action]
}
