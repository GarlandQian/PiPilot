import { z } from 'zod'

export const CONVERSATION_TASK_CUSTOM_TYPE = 'pipilot.task-state'
export const CONVERSATION_TASK_TOOL_NAME = 'pipilot_update_task'
/** Historical transcript envelope only. No runtime generates or executes this continuation. */
export function createConversationPlanKickoff(plan: { title: string; id: string }, nonce: string): string {
  return `Continue the approved plan "${plan.title}" (${plan.id}) within its existing scope. Complete the next unfinished step, record concrete evidence with ${CONVERSATION_TASK_TOOL_NAME}, and keep working until the plan is complete or genuinely blocked. Do not ask for approval again unless the plan changes. [PiPilot continuation ${nonce}]`
}

/** Recognize only the complete generated envelope, never a substring or quoted example. */
export function parseConversationPlanKickoff(text: string): { title: string; planId: string } | null {
  if (text.length > 1_500) return null
  const header = /^Continue the approved plan "([\s\S]{1,500})" \(([a-zA-Z0-9][a-zA-Z0-9_-]{0,95})\) within its existing scope\./u.exec(text)
  const marker = /\[PiPilot continuation ([a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12})\]$/u.exec(text)
  if (!header || !marker || createConversationPlanKickoff({ title: header[1], id: header[2] }, marker[1]) !== text) return null
  return { title: header[1], planId: header[2] }
}

const identifier = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/)
const metadataFields = {
  updatedAt: z.number().int().nonnegative(),
  summary: z.string().trim().max(4_000),
  blockers: z.array(z.string().trim().min(1).max(1_000)).max(8),
  nextActions: z.array(z.object({
    id: identifier,
    label: z.string().trim().min(1).max(120),
    prompt: z.string().trim().min(1).max(4_000),
  }).strict()).max(3).refine((actions) => new Set(actions.map((action) => action.id)).size === actions.length, 'Next-action ids must be unique.'),
}

export const conversationTaskSnapshotSchema = z.object({
  version: z.literal(2),
  ...metadataFields,
}).strict()

// Read old summaries without exposing their retired approval or execution state.
// The original custom entry remains unchanged in the official session history.
const historicalTaskMetadataSchema = z.object({ version: z.literal(1), ...metadataFields })
const retiredWorkflowBlockers = new Set([
  'Paused by the user. Resume explicitly to continue.',
  'Execution is paused after restoring this session or branch. Resume explicitly to continue.',
  'No additional step was completed with evidence. Review the plan before resuming.',
  'Execution was stopped. Resume explicitly to continue.',
  'Execution encountered an error. Review the result before resuming.',
  'Execution is waiting for input or a dependency. Resume explicitly when it is resolved.',
])

export type ConversationTaskSnapshot = z.infer<typeof conversationTaskSnapshotSchema>

/** The subset shared by official Pi entries and renderer projections. */
export interface ConversationTaskEntry {
  id: string
  parentId: string | null
  type: string
  customType?: string
  data?: unknown
}

/** Entries must already be on the active branch, in root-to-leaf order. */
export function getConversationTaskSnapshotFromBranch(
  entries: readonly ConversationTaskEntry[],
): ConversationTaskSnapshot | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!
    if (entry.type !== 'custom' || entry.customType !== CONVERSATION_TASK_CUSTOM_TYPE) continue
    const parsed = conversationTaskSnapshotSchema.safeParse(entry.data)
    if (parsed.success) return parsed.data
    const historical = historicalTaskMetadataSchema.safeParse(entry.data)
    // An invalid latest snapshot must not resurrect metadata from an older turn.
    return historical.success ? {
      ...historical.data,
      version: 2,
      blockers: historical.data.blockers.filter((blocker) => !retiredWorkflowBlockers.has(blocker)),
    } : null
  }
  return null
}

/** Resolve ancestry first: the last file entry may belong to an abandoned branch. */
export function getConversationTaskSnapshot(
  entries: readonly ConversationTaskEntry[],
  leafId: string | null,
): ConversationTaskSnapshot | null {
  const branch = getConversationBranchEntries(entries, leafId)
  return branch ? getConversationTaskSnapshotFromBranch(branch) : null
}

/** Fail closed on incomplete/ambiguous trees instead of attributing another branch's data. */
export function getConversationBranchEntries<T extends ConversationTaskEntry>(
  entries: readonly T[],
  leafId: string | null,
): T[] | null {
  const byId = new Map(entries.map((entry) => [entry.id, entry]))
  if (byId.size !== entries.length) return null
  const branch: T[] = []
  const visited = new Set<string>()
  let id = leafId
  while (id !== null) {
    if (visited.has(id)) return null
    visited.add(id)
    const entry = byId.get(id)
    if (!entry) return null
    branch.push(entry)
    id = entry.parentId
  }
  return branch.reverse()
}
