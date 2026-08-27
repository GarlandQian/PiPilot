import { z } from 'zod'
import type { LocalPiProjectorState } from '../projector'
import type { GoalCapability } from './registry'

export const GOAL_STATUS_KEY = 'goal' as const
export const GOAL_STATE_ENTRY_TYPE = 'goal-state' as const

const goalStatusSchema = z.enum([
  'active',
  'queued',
  'paused',
  'blocked',
  'usage_limited',
  'budget_limited',
  'complete',
])

const goalWaitSchema = z.object({
  reason: z.string().trim().min(1).max(1_000),
  resumeAt: z.number().int().nonnegative().optional(),
}).passthrough()

const goalSnapshotSchema = z.object({
  id: z.string().trim().min(1).max(128),
  text: z.string().trim().min(1).max(4_000),
  status: goalStatusSchema,
  iteration: z.number().int().nonnegative(),
  tokenBudget: z.number().finite().positive().optional(),
  tokensUsed: z.number().finite().nonnegative(),
  timeUsedSeconds: z.number().finite().nonnegative(),
  automaticModelTurns: z.number().int().nonnegative(),
  waiting: goalWaitSchema.optional(),
}).passthrough()

const goalStateEntryDataSchema = z.object({
  goal: goalSnapshotSchema.nullable(),
}).passthrough()

export type GoalSnapshot = z.infer<typeof goalSnapshotSchema>

export type GoalLifecycle =
  | 'active'
  | 'queued'
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

function latestGoalSnapshot(state: LocalPiProjectorState): GoalSnapshot | null | undefined {
  const entries = state.entrySnapshot?.entries
  if (!entries) return undefined
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (entry?.type !== 'custom' || entry.customType !== GOAL_STATE_ENTRY_TYPE) continue
    const parsed = goalStateEntryDataSchema.safeParse(entry.data)
    return parsed.success ? parsed.data.goal : undefined
  }
  return undefined
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
  if (value.startsWith('queued ')) return 'queued'
  if (value.startsWith('waiting ')) return 'waiting'
  if (value.startsWith('paused ')) return 'paused'
  if (value.startsWith('blocked ')) return 'blocked'
  if (value.startsWith('usage ')) return 'usage-limited'
  if (value.startsWith('budget ')) return 'budget-limited'
  return null
}

function actionsFor(lifecycle: GoalLifecycle): GoalActionId[] {
  if (lifecycle === 'complete') return []
  if (lifecycle === 'active' || lifecycle === 'queued') {
    return ['status', 'pause', 'clear']
  }
  return ['status', 'resume', 'clear']
}

export function projectGoalMode(
  state: LocalPiProjectorState,
  capability: GoalCapability | null,
  context: { scopeKey: string; statuses?: Readonly<Record<string, string>> },
): GoalModeProjection | null {
  if (!capability) return null
  const statusValue = context.statuses?.[GOAL_STATUS_KEY]
  const goal = latestGoalSnapshot(state)
  const lifecycle = goal
    ? lifecycleFromSnapshot(goal)
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
