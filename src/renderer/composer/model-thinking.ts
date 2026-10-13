import type { LocalPiModel, LocalPiThinkingLevel } from '@/shared/local-pi'

const LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
/** Preview an unapplied model selection using Pi's documented model capability map. */
export function modelThinkingSelection(model: Pick<LocalPiModel, 'reasoning' | 'thinkingLevelMap'> | null, requested: LocalPiThinkingLevel | null) {
  const levels: LocalPiThinkingLevel[] = !model?.reasoning ? ['off'] : LEVELS.filter((level) => {
    const mapped = model.thinkingLevelMap?.[level]
    return mapped !== null && ((level !== 'xhigh' && level !== 'max') || mapped !== undefined)
  })
  const selected = requested && levels.includes(requested) ? requested
    : levels.find((level) => LEVELS.indexOf(level) >= LEVELS.indexOf(requested ?? 'off')) ?? levels[levels.length - 1] ?? 'off'
  return { levels, selected }
}
