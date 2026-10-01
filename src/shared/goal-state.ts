import { z } from 'zod'
import type { ConversationTaskEntry } from './conversation-task'

export const GOAL_STATE_ENTRY_TYPE = 'goal-state' as const

/** Bounded presentation fields from @narumitw/pi-goal's official state entry. */
export const goalSnapshotSchema = z.object({
  id: z.string().trim().min(1).max(128),
  text: z.string().trim().min(1).max(4_000),
  status: z.enum(['active', 'paused', 'blocked', 'usage_limited', 'budget_limited', 'complete']),
  iteration: z.number().int().nonnegative(),
  tokenBudget: z.number().finite().positive().optional(),
  tokensUsed: z.number().finite().nonnegative(),
  timeUsedSeconds: z.number().finite().nonnegative(),
  automaticModelTurns: z.number().int().nonnegative(),
  waiting: z.object({
    reason: z.string().trim().min(1).max(1_000),
    resumeAt: z.number().int().nonnegative().optional(),
  }).passthrough().optional(),
}).passthrough()

const goalStateEntryDataSchema = z.object({ goal: goalSnapshotSchema.nullable() }).passthrough()
export type GoalSnapshot = z.infer<typeof goalSnapshotSchema>

/** undefined means absent; null means malformed; { goal: null } is an explicit clear. */
export function getGoalStateFromBranch(entries: readonly ConversationTaskEntry[]): z.infer<typeof goalStateEntryDataSchema> | null | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!
    if (entry.type !== 'custom' || entry.customType !== GOAL_STATE_ENTRY_TYPE) continue
    const parsed = goalStateEntryDataSchema.safeParse(entry.data)
    return parsed.success ? parsed.data : null
  }
  return undefined
}

/** Bounded display data. Never resurrect an older goal after a clear or invalid entry. */
export function getGoalSnapshotFromBranch(entries: readonly ConversationTaskEntry[]): GoalSnapshot | null | undefined {
  const state = getGoalStateFromBranch(entries)
  return state === undefined ? undefined : state?.goal ?? null
}
