import { describe, expect, it } from 'vitest'
import { deriveComposerSubmitMode } from '../../src/components/chat/Composer'

describe('Composer submit controls', () => {
  it('keeps ordinary idle messages on the prompt path', () => {
    expect(deriveComposerSubmitMode(false, false)).toEqual({
      action: 'prompt',
      allowsSteer: false,
      kind: 'send',
    })
  })

  it('queues normal messages and exposes Steer while Pi is streaming', () => {
    expect(deriveComposerSubmitMode(true, false)).toEqual({
      action: 'follow_up',
      allowsSteer: true,
      kind: 'queue',
    })
  })

  it('runs extension commands immediately without offering Steer', () => {
    expect(deriveComposerSubmitMode(true, true)).toEqual({
      action: 'prompt',
      allowsSteer: false,
      kind: 'run-now',
    })
  })
})
