import { describe, expect, it } from 'vitest'
import { modelThinkingSelection } from '../../src/renderer/composer/model-thinking'

describe('side model thinking preview', () => {
  it('removes reasoning controls when switching to a non-reasoning model', () => {
    expect(modelThinkingSelection({ reasoning: false }, 'high')).toEqual({ levels: ['off'], selected: 'off' })
  })
  it('honors disabled and extended model capabilities before the next send', () => {
    const model = { reasoning: true, thinkingLevelMap: { minimal: null, xhigh: 'extra' } }
    expect(modelThinkingSelection(model, 'minimal')).toEqual({ levels: ['off', 'low', 'medium', 'high', 'xhigh'], selected: 'low' })
    expect(modelThinkingSelection(model, 'max').selected).toBe('xhigh')
  })
})
