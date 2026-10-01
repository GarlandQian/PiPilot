import type { MessageKey } from '@/i18n'
import type { GoalModeProjection, PlanModeProjection } from '@/renderer/pi-rpc/adapters'
import type { LocalPiSlashCommand } from '@/shared/local-pi'

/** Modes the "+" menu offers. Each one is a plugin command, not a PiPilot engine. */
export type ComposerMode = 'plan' | 'goal'

export type ComposerModeBlock =
  | 'loading'
  | 'notInstalled'
  | 'running'
  | 'goalUnfinished'
  | 'planActive'

export type ComposerModeAvailability =
  | { enabled: true }
  | { enabled: false; reason: ComposerModeBlock }

export interface ComposerModeContext {
  commands: readonly LocalPiSlashCommand[]
  catalogReady: boolean
  isStreaming: boolean
  planMode: PlanModeProjection | null
  goalMode: GoalModeProjection | null
}

const MODE_COMMANDS: Record<ComposerMode, string> = { plan: 'plan', goal: 'goal' }

export const COMPOSER_MODE_BLOCK_KEYS = {
  loading: 'composer.mode.blocked.loading',
  notInstalled: 'composer.mode.blocked.notInstalled',
  running: 'composer.mode.blocked.running',
  goalUnfinished: 'composer.mode.blocked.goalUnfinished',
  planActive: 'composer.mode.blocked.planActive',
} as const satisfies Record<ComposerModeBlock, MessageKey>

/** Plan Mode stays on until its plan is implemented, saved or discarded. */
export function planModeActive(planMode: PlanModeProjection | null) {
  return planMode?.lifecycle === 'planning' || planMode?.lifecycle === 'ready'
}

/** A paused Goal still owns unfinished work. */
export function goalUnfinished(goalMode: GoalModeProjection | null) {
  return Boolean(goalMode && goalMode.lifecycle !== 'complete')
}

export function composerModeAvailability(
  mode: ComposerMode,
  context: ComposerModeContext,
): ComposerModeAvailability {
  if (!context.catalogReady) return { enabled: false, reason: 'loading' }
  const installed = context.commands.some((command) =>
    command.source === 'extension' && command.name === MODE_COMMANDS[mode])
  if (!installed) return { enabled: false, reason: 'notInstalled' }
  // Both plugins only switch modes while Pi is idle.
  if (context.isStreaming) return { enabled: false, reason: 'running' }
  if (mode === 'plan' && goalUnfinished(context.goalMode)) return { enabled: false, reason: 'goalUnfinished' }
  if (mode === 'goal' && planModeActive(context.planMode)) return { enabled: false, reason: 'planActive' }
  return { enabled: true }
}

/** The message a selected mode sends: the plugin's own start command. */
export function composerModeMessage(mode: ComposerMode, message: string) {
  return `/${MODE_COMMANDS[mode]} ${message.trim()}`
}

export function composerPlaceholderKey(input: {
  mode: ComposerMode | null
  planActive: boolean
  isStreaming: boolean
  conversationEmpty: boolean
}): MessageKey {
  if (input.mode === 'plan') return 'composer.placeholder.plan'
  if (input.mode === 'goal') return 'composer.placeholder.goal'
  if (input.isStreaming) return 'composer.placeholder.running'
  if (input.planActive) return 'composer.placeholder.plan'
  return input.conversationEmpty ? 'composer.placeholder.new' : 'composer.placeholder.reply'
}

/** ⌘⇧P / ⌘⇧G (Ctrl+Shift elsewhere) toggle a mode from anywhere in the conversation. */
export function composerModeShortcut(event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>): ComposerMode | null {
  if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.altKey) return null
  const key = event.key.toLowerCase()
  return key === 'p' ? 'plan' : key === 'g' ? 'goal' : null
}
