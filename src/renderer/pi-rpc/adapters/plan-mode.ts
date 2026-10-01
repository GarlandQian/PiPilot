import { z } from 'zod'
import { getConversationBranchEntries } from '@/shared/conversation-task'
import { getGoalStateFromBranch } from '@/shared/goal-state'
import { getPlanStateFromBranch, PLAN_MAX_MARKDOWN_CHARS, PLAN_STATE_ENTRY_TYPE } from '@/shared/plan-state'
import type {
  LocalPiAgentMessage,
} from '@/shared/local-pi'
import type { PiExtensionWidget } from '@/store/pi-rpc'
import type { LocalPiProjectorState, LocalPiProjectedTool } from '../projector'
import type { PlanModeCapability } from './registry'

export { PLAN_MAX_MARKDOWN_CHARS, PLAN_STATE_ENTRY_TYPE } from '@/shared/plan-state'
export const PLAN_STATUS_KEY = 'plan-mode' as const
export const PLAN_WIDGET_KEY = 'plan-mode-plan' as const
export const PLAN_CUSTOM_TYPE = 'proposed-plan' as const

function currentPlanState(state: LocalPiProjectorState): { lifecycle: PlanLifecycle; markdown: string | null; entryId: string } | null | undefined {
  const snapshot = state.entrySnapshot
  if (!snapshot) return undefined
  if (snapshot.sessionId !== state.sessionId || snapshot.generation !== state.generation) return null
  const branch = getConversationBranchEntries(snapshot.entries, snapshot.leafId)
  if (!branch) return null
  const plan = getPlanStateFromBranch(branch)
  if (plan === undefined || plan === null) return plan
  const entryId = [...branch].reverse().find((entry) => entry.type === 'custom' && entry.customType === PLAN_STATE_ENTRY_TYPE)!.id
  if (plan.enabled) return { lifecycle: plan.latestPlan ? 'ready' : 'planning', markdown: plan.latestPlan ?? null, entryId }
  if (plan.activeImplementation) return { lifecycle: 'implementing', markdown: plan.activeImplementation.plan, entryId }
  if (plan.savedPlan) return { lifecycle: 'saved', markdown: plan.savedPlan.plan, entryId }
  return null
}

const planCompletionDetailsSchema = z.object({
  version: z.literal(1),
  source: z.literal('plan_mode_complete'),
  plan: z.string().trim().min(1).max(PLAN_MAX_MARKDOWN_CHARS),
}).strict()

export type PlanCompletionDetails = z.infer<typeof planCompletionDetailsSchema>

export const PLAN_STATUS_VALUES = [
  'plan active',
  'plan ready',
  'plan saved',
  'plan implementing',
] as const
export type PlanStatusValue = (typeof PLAN_STATUS_VALUES)[number]

export type PlanLifecycle = 'planning' | 'ready' | 'saved' | 'implementing'

export interface ProposedPlanMessage {
  title: 'Proposed Plan' | 'Saved Plan' | 'Active Implementation Plan'
  lifecycle: 'ready' | 'saved' | 'implementing'
  markdown: string
}

export interface PlanModeProjection {
  capability: PlanModeCapability
  scopeKey: string
  sessionId: string
  generation: number
  lifecycle: PlanLifecycle
  markdown: string | null
  sourceEntryId: string | null
  completionToolCallIds: ReadonlySet<string>
  customMessageKeys: ReadonlySet<string>
  statusValue: PlanStatusValue | null
  widget: PlanWidgetProjection | null
  actions: readonly PlanActionId[]
}

export interface PlanWidgetProjection {
  key: typeof PLAN_WIDGET_KEY
  placement: 'aboveEditor'
  lines: readonly string[]
}

export const PLAN_ACTION_IDS = [
  'show',
  'finalize',
  'implement',
  'save',
  'export',
  'revise',
  'exit',
] as const
export type PlanActionId = (typeof PLAN_ACTION_IDS)[number]

export const PLAN_ACTION_ROUTES: Readonly<Record<Exclude<PlanActionId, 'revise'>, string>> = {
  show: '/plan show',
  finalize: '/plan finalize',
  implement: '/plan implement',
  save: '/plan save',
  export: '/plan export',
  exit: '/plan exit',
}

function boundedMarkdown(value: string) {
  const markdown = value.trim()
  return markdown && markdown.length <= PLAN_MAX_MARKDOWN_CHARS ? markdown : null
}

export function parsePlanCompletionDetails(value: unknown): PlanCompletionDetails | null {
  const parsed = planCompletionDetailsSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

type LocalPiCustomContent = Extract<LocalPiAgentMessage, { role: 'custom' }>['content']

function textContent(value: LocalPiCustomContent) {
  if (typeof value === 'string') return value
  return value
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
}

const PROPOSED_TITLES = {
  '**Proposed Plan**': {
    title: 'Proposed Plan' as const,
    lifecycle: 'ready' as const,
  },
  '**Saved Plan**': {
    title: 'Saved Plan' as const,
    lifecycle: 'saved' as const,
  },
  '**Active Implementation Plan**': {
    title: 'Active Implementation Plan' as const,
    lifecycle: 'implementing' as const,
  },
}

export function parseProposedPlanMessage(
  message: Pick<Extract<LocalPiAgentMessage, { role: 'custom' }>, 'customType' | 'content' | 'display'>,
): ProposedPlanMessage | null {
  if (message.customType !== PLAN_CUSTOM_TYPE || !message.display) return null
  const content = textContent(message.content)
  const [firstLine, ...rest] = content.split(/\r?\n/u)
  const title = PROPOSED_TITLES[firstLine as keyof typeof PROPOSED_TITLES]
  if (!title) return null
  const markdown = boundedMarkdown(rest.join('\n'))
  if (!markdown) return null
  return { ...title, markdown }
}

function planStatus(value: string | undefined): PlanStatusValue | null {
  return PLAN_STATUS_VALUES.includes(value as PlanStatusValue)
    ? value as PlanStatusValue
    : null
}

function lifecycleForStatus(value: PlanStatusValue): PlanLifecycle {
  switch (value) {
    case 'plan active': return 'planning'
    case 'plan ready': return 'ready'
    case 'plan saved': return 'saved'
    case 'plan implementing': return 'implementing'
  }
}

function widgetFor(
  widget: PiExtensionWidget | undefined,
  status: PlanStatusValue | null,
): PlanWidgetProjection | null {
  if (!widget || widget.key !== PLAN_WIDGET_KEY || widget.placement !== 'aboveEditor') return null
  const lines = widget.lines
  if (status === 'plan active') {
    if (lines.length !== 3 || lines[0] !== 'Plan mode: planning' ||
      !lines[1]?.trim() || lines[1].length > 1_000 ||
      lines[2] !== 'Finish with plan_mode_complete when decision-ready.') return null
  } else if (status === 'plan ready') {
    if (lines.length !== 2 || lines[0] !== 'Proposed plan ready' ||
      lines[1] !== 'Use /plan to implement, save, revise, or exit Plan mode.') return null
  } else if (status === 'plan saved') {
    if (lines.length !== 2 || lines[0] !== 'Plan saved for later' ||
      lines[1] !== 'Use /plan to show, implement, or clear it.') return null
  } else if (status === 'plan implementing') {
    if (lines.length !== 2 || lines[0] !== 'Implementation plan active' ||
      lines[1] !== 'Use /plan to show, replace, or clear it.') return null
  } else {
    return null
  }
  return { key: PLAN_WIDGET_KEY, placement: 'aboveEditor', lines: [...lines] }
}

function actionIdsFor(lifecycle: PlanLifecycle, hasMarkdown: boolean): PlanActionId[] {
  const actions: PlanActionId[] = ['exit']
  if (lifecycle === 'planning') {
    actions.unshift('finalize')
  }
  if (hasMarkdown) actions.unshift('show')
  if (hasMarkdown && (lifecycle === 'planning' || lifecycle === 'ready')) actions.push('revise')
  if (lifecycle === 'ready') actions.push('implement', 'save', 'export')
  if (lifecycle === 'saved') actions.push('implement', 'export')
  if (lifecycle === 'implementing') actions.push('show')
  return [...new Set(actions)]
}

function hasUnfinishedGoal(state: LocalPiProjectorState) {
  const snapshot = state.entrySnapshot
  if (!snapshot) return false
  const branch = getConversationBranchEntries(snapshot.entries, snapshot.leafId)
  if (!branch) return true
  const goalState = getGoalStateFromBranch(branch)
  if (goalState === null) return true
  return Boolean(goalState?.goal && goalState.goal.status !== 'complete')
}

function completionFromTool(tool: LocalPiProjectedTool): PlanCompletionDetails | null {
  if (tool.toolName !== 'plan_mode_complete' || tool.phase !== 'complete' ||
    !tool.result || tool.resultIsPartial || tool.isError) return null
  return parsePlanCompletionDetails(tool.result.details)
}

export function projectPlanMode(
  state: LocalPiProjectorState,
  capability: PlanModeCapability | null,
  context: { scopeKey: string; statuses?: Readonly<Record<string, string>>; widgets?: readonly PiExtensionWidget[] },
): PlanModeProjection | null {
  if (!capability || !state.sessionId || state.sessionId === 'none') return null
  const persisted = currentPlanState(state)
  // Explicit clearing, invalid state, or an unresolved branch supersedes old messages.
  if (persisted === null) return null
  const statusValue = planStatus(context.statuses?.[PLAN_STATUS_KEY])
  const widget = widgetFor(
    context.widgets?.find((candidate) => candidate.key === PLAN_WIDGET_KEY),
    statusValue,
  )
  let markdown: string | null = null
  let sourceEntryId: string | null = null
  const completionToolCallIds = new Set<string>()
  const customMessageKeys = new Set<string>()
  let customLifecycle: PlanLifecycle | null = null

  for (const [index, message] of state.messages.entries()) {
    if (message.role === 'toolResult') {
      const completion = message.toolName === 'plan_mode_complete'
        ? parsePlanCompletionDetails(message.details)
        : null
      if (completion && !message.isError) {
        markdown = completion.plan
        sourceEntryId = message.toolCallId
        completionToolCallIds.add(message.toolCallId)
      }
    } else if (message.role === 'custom') {
      const proposed = parseProposedPlanMessage(message)
      if (proposed) {
        markdown = proposed.markdown
        sourceEntryId = `custom:${message.timestamp}:${index}`
        customLifecycle = proposed.lifecycle
        customMessageKeys.add(`message:${index}:${message.timestamp}`)
      }
    }
  }
  for (const tool of state.tools.values()) {
    const completion = completionFromTool(tool)
    if (completion && !completionToolCallIds.has(tool.toolCallId)) {
      markdown = completion.plan
      sourceEntryId = tool.toolCallId
      completionToolCallIds.add(tool.toolCallId)
    }
  }

  if (persisted) {
    if (markdown !== persisted.markdown) sourceEntryId = persisted.entryId
    markdown = persisted.markdown
  }
  const lifecycle = persisted?.lifecycle ?? (statusValue
    ? lifecycleForStatus(statusValue)
    : customLifecycle ?? (markdown ? 'ready' : 'planning'))
  if (!persisted && !statusValue && !customLifecycle && !markdown && !widget) return null
  const goalUnfinished = hasUnfinishedGoal(state)
  const planningEnabled = persisted
    ? persisted.lifecycle === 'planning' || persisted.lifecycle === 'ready'
    : statusValue === 'plan active' || statusValue === 'plan ready'
  return {
    capability,
    scopeKey: context.scopeKey,
    sessionId: state.sessionId,
    generation: state.generation,
    lifecycle,
    markdown,
    sourceEntryId,
    completionToolCallIds,
    customMessageKeys,
    statusValue,
    widget,
    // The published saved-plan handoff does not acquire the Plan/Goal mutex.
    // Keep GUI actions from starting different work over an unfinished Goal.
    // Actual lifecycle and raw command behavior remain owned by the plugins.
    actions: actionIdsFor(lifecycle, Boolean(markdown)).filter((action) =>
      (action !== 'revise' || planningEnabled) &&
      (!goalUnfinished || !['implement', 'revise', 'finalize'].includes(action))),
  }
}

export function planActionRoute(action: Exclude<PlanActionId, 'revise'>) {
  return PLAN_ACTION_ROUTES[action]
}
