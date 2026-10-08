import { describe, expect, it } from 'vitest'
import {
  deriveComposerSubmitMode,
  deriveComposerActionState,
  normalizeRunningSubmitPreference,
  projectModelThinkingTrigger,
  projectPendingRail,
  projectReasoningSlider,
} from '../../src/renderer/composer/composer-controls'

describe('Composer submit controls', () => {
  const readyDraft = {
    ready: true,
    isStreaming: false,
    hasExtensionCommand: false,
    runningSubmitPreference: 'queue' as const,
    hasContent: true,
    imageCount: 0,
    supportsImages: true,
    hasConflict: false,
    submitting: false,
    stopping: false,
  }

  it('shares exact-ready eligibility between pointer and keyboard submission', () => {
    expect(deriveComposerActionState(readyDraft).canSubmit).toBe(true)
    for (const state of [
      { ready: false },
      { submitting: true },
      { hasConflict: true },
      { hasContent: false },
      { imageCount: 1, supportsImages: false },
    ]) {
      expect(deriveComposerActionState({ ...readyDraft, ...state }).canSubmit).toBe(false)
    }
  })

  it('keeps running submission and Stop independent, with Queue as the default', () => {
    expect(deriveComposerActionState({ ...readyDraft, isStreaming: true })).toEqual({
      submit: { action: 'follow_up', kind: 'queue' },
      canSubmit: true,
      canStop: true,
    })
    expect(deriveComposerActionState({ ...readyDraft, isStreaming: true, submitting: true }))
      .toMatchObject({ canSubmit: false, canStop: true })
    expect(deriveComposerActionState({ ...readyDraft, isStreaming: true, stopping: true }))
      .toMatchObject({ canSubmit: true, canStop: false })
    expect(deriveComposerActionState({ ...readyDraft, isStreaming: true, ready: false }))
      .toMatchObject({ canSubmit: false, canStop: false })
  })

  it('permits image-only messages both idle and while running', () => {
    const imageOnly = { ...readyDraft, hasContent: false, imageCount: 1 }
    expect(deriveComposerActionState(imageOnly).canSubmit).toBe(true)
    expect(deriveComposerActionState({ ...imageOnly, isStreaming: true }).canSubmit).toBe(true)
    expect(deriveComposerActionState({ ...imageOnly, isStreaming: true, hasExtensionCommand: true }))
      .toMatchObject({ submit: { action: 'prompt', kind: 'run-now' }, canSubmit: true })
  })

  it('keeps ordinary idle messages on the prompt path', () => {
    expect(deriveComposerSubmitMode(false, false)).toEqual({
      action: 'prompt',
      kind: 'send',
    })
  })

  it('queues normal messages by default while Pi is streaming', () => {
    expect(deriveComposerSubmitMode(true, false)).toEqual({
      action: 'follow_up',
      kind: 'queue',
    })
  })

  it('follows the running preference, with the alternate shortcut doing the other', () => {
    const queue = { action: 'follow_up', kind: 'queue' }
    const steer = { action: 'steer', kind: 'steer' }
    expect(deriveComposerSubmitMode(true, false, 'queue', true)).toEqual(steer)
    expect(deriveComposerSubmitMode(true, false, 'steer')).toEqual(steer)
    expect(deriveComposerSubmitMode(true, false, 'steer', true)).toEqual(queue)
    // Idle sends and plugin commands are unaffected by either.
    expect(deriveComposerSubmitMode(false, false, 'steer', true)).toEqual({ action: 'prompt', kind: 'send' })
    expect(deriveComposerSubmitMode(true, true, 'steer')).toEqual({ action: 'prompt', kind: 'run-now' })
  })

  it('projects one model and thinking trigger without inventing unavailable values', () => {
    expect(projectModelThinkingTrigger(
      { id: 'model-id', name: ' Model name ' },
      'high',
      ['off', 'high'],
    )).toEqual({
      modelLabel: 'Model name',
      thinkingLevel: 'high',
    })
    expect(projectModelThinkingTrigger(
      { id: 'plain-model', name: 'Plain model' },
      'off',
      ['off'],
    )).toEqual({
      modelLabel: 'Plain model',
      thinkingLevel: null,
    })
    expect(projectModelThinkingTrigger({ id: 'model-id', name: ' ' }, null)).toEqual({
      modelLabel: 'model-id',
      thinkingLevel: null,
    })
    expect(projectModelThinkingTrigger(null, null)).toEqual({
      modelLabel: null,
      thinkingLevel: null,
    })
  })

  it('runs extension commands immediately without offering Steer', () => {
    expect(deriveComposerSubmitMode(true, true)).toEqual({
      action: 'prompt',
      kind: 'run-now',
    })
  })

  it('defaults missing and invalid running-submit preferences to Queue', () => {
    expect(normalizeRunningSubmitPreference(undefined)).toBe('queue')
    expect(normalizeRunningSubmitPreference('invalid')).toBe('queue')
    expect(normalizeRunningSubmitPreference('steer')).toBe('steer')
    expect(deriveComposerSubmitMode(true, false, normalizeRunningSubmitPreference('invalid'))).toEqual({
      action: 'follow_up',
      kind: 'queue',
    })
  })

  it('projects one ordered pending rail and fails closed for unknown payloads', () => {
    const image = { type: 'image' as const, data: 'image', mimeType: 'image/png' }
    const owned = {
      id: 'steer-1', text: 'Adjust direction', images: [image], locallyOwned: true,
    }
    expect(projectPendingRail({
      pendingCount: 2,
      detailsKnown: true,
      steering: ['Adjust direction'],
      followUp: ['Then summarize'],
      steeringItems: [owned],
      followUpItems: [{
        id: 'follow-1', text: 'Then summarize', images: [], locallyOwned: true,
      }],
      steeringMode: 'one-at-a-time',
      followUpMode: 'all',
    })).toMatchObject({
      visible: true,
      count: 2,
      losslessMutationAvailable: true,
      nextText: 'Adjust direction',
      nextImageCount: 1,
      items: [
        { id: 'steer-1', kind: 'steering', canPromote: false, canRemove: true },
        { id: 'follow-1', kind: 'followUp', canPromote: true, canRemove: true },
      ],
    })

    expect(projectPendingRail({
      pendingCount: 1,
      detailsKnown: false,
      steering: [],
      followUp: [],
      steeringItems: [],
      followUpItems: [],
      steeringMode: 'one-at-a-time',
      followUpMode: 'one-at-a-time',
    })).toMatchObject({
      visible: true,
      detailsKnown: false,
      losslessMutationAvailable: false,
      items: [],
    })
  })
})

describe('reasoning slider', () => {
  it('steps over only the levels the model supports, labelling each when they fit', () => {
    expect(projectReasoningSlider(['off', 'low', 'medium', 'high'], 'medium')).toEqual({ index: 2, labelEachStop: true, costly: false })
    const all = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
    expect(projectReasoningSlider(all, 'xhigh')).toEqual({ index: 5, labelEachStop: false, costly: true })
    expect(projectReasoningSlider(all, 'max').costly).toBe(true)
    // A level the model no longer offers has no position on the scale.
    expect(projectReasoningSlider(['low', 'high'], 'medium').index).toBe(-1)
    expect(projectReasoningSlider(['low', 'high'], null).index).toBe(-1)
  })
})
