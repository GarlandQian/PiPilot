import type { MessageKey } from '@/i18n'
import type { Turn } from '@/types/chat'

type PlanTurn = Extract<Turn, { kind: 'plan' }>
export type PlanLifecycle = PlanTurn['lifecycle']
export type PlanAction = PlanTurn['actions'][number]

/** States are worded by whose move it is next, not by internal plugin phase. */
export const PLAN_LIFECYCLE_KEYS = {
  planning: 'plan.lifecycle.planning',
  ready: 'plan.lifecycle.ready',
  saved: 'plan.lifecycle.saved',
  implementing: 'plan.lifecycle.implementing',
} as const satisfies Record<PlanLifecycle, MessageKey>

/** The plan only needs the user while it waits for a decision. */
export function planNeedsDecision(lifecycle: PlanLifecycle) {
  return lifecycle === 'ready' || lifecycle === 'saved'
}

/** One prominent action per state; everything else lives in the "⋯" menu. */
export function primaryPlanAction(lifecycle: PlanLifecycle, actions: readonly PlanAction[]): PlanAction | null {
  return planNeedsDecision(lifecycle) && actions.includes('implement') ? 'implement' : null
}

// "show" re-posts the plan, which is already on screen as this card.
const MENU_ORDER: readonly PlanAction[] = ['finalize', 'revise', 'save', 'export', 'exit']

export function menuPlanActions(lifecycle: PlanLifecycle, actions: readonly PlanAction[]) {
  const primary = primaryPlanAction(lifecycle, actions)
  return MENU_ORDER.filter((action) => action !== primary && actions.includes(action))
}

export function planActionLabelKey(action: PlanAction, lifecycle: PlanLifecycle): MessageKey {
  // Leaving plan mode while a plan is kept or running throws that plan away.
  if (action === 'exit') return lifecycle === 'saved' || lifecycle === 'implementing' ? 'plan.action.discard' : 'plan.action.exit'
  return `plan.action.${action}`
}

/** Destructive when it discards a kept or running plan. */
export function planActionIsDestructive(action: PlanAction, lifecycle: PlanLifecycle) {
  return action === 'exit' && (lifecycle === 'saved' || lifecycle === 'implementing')
}

export const REVEAL_PLAN_EVENT = 'pipilot:reveal-current-plan'

/** Scrolls the transcript to the current plan card (handled by the mounted transcript). */
export function revealCurrentPlan() {
  window.dispatchEvent(new Event(REVEAL_PLAN_EVENT))
}
