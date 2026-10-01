import { z } from 'zod'
import type { ConversationTaskEntry } from './conversation-task'

export const PLAN_MAX_MARKDOWN_CHARS = 50_000
export const PLAN_STATE_ENTRY_TYPE = 'plan-mode-state' as const

/** Bounded workflow fields from @narumitw/pi-plan-mode's official state entry. */
export const planStateSchema = z.object({
  enabled: z.boolean(),
  awaitingAction: z.boolean(),
  latestPlan: z.string().trim().min(1).max(PLAN_MAX_MARKDOWN_CHARS).optional(),
  savedPlan: z.object({ plan: z.string().trim().min(1).max(PLAN_MAX_MARKDOWN_CHARS) }).passthrough().optional(),
  activeImplementation: z.object({ plan: z.string().trim().min(1).max(PLAN_MAX_MARKDOWN_CHARS) }).passthrough().optional(),
}).passthrough()

export type PlanState = z.infer<typeof planStateSchema>

/** undefined means absent; null means malformed. A valid disabled state may be cleared. */
export function getPlanStateFromBranch(entries: readonly ConversationTaskEntry[]): PlanState | null | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!
    if (entry.type !== 'custom' || entry.customType !== PLAN_STATE_ENTRY_TYPE) continue
    const parsed = planStateSchema.safeParse(entry.data)
    return parsed.success ? parsed.data : null
  }
  return undefined
}
