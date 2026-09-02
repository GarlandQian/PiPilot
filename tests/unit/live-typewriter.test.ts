import { describe, expect, it } from 'vitest'
import {
  nextTypewriterText,
  shouldStartTypewriterFromEmpty,
  thinkingDisclosureAfterPhaseChange,
} from '../../src/renderer/pi-rpc/live-typewriter'

describe('live response typewriter', () => {
  it('advances small chunks without jumping straight to the target', () => {
    expect(nextTypewriterText('', 'hello world')).toBe('hel')
    expect(nextTypewriterText('hel', 'hello world')).toBe('hello ')
  })

  it('catches up adaptively while keeping a large target bounded', () => {
    const target = 'x'.repeat(2_000)
    const next = nextTypewriterText('', target)
    expect(next.length).toBeGreaterThan(3)
    expect(next.length).toBeLessThan(target.length)
  })

  it('recovers cumulative-stream corrections from their shared prefix', () => {
    const target = 'hello world again'
    const next = nextTypewriterText('hello worx', target)
    expect(next.startsWith('hello wor')).toBe(true)
    expect(target.startsWith(next)).toBe(true)
  })

  it('uses a faster bounded catch-up after the stream settles', () => {
    const target = 'x'.repeat(600)
    expect(nextTypewriterText('', target, true).length)
      .toBeGreaterThan(nextTypewriterText('', target, false).length)
  })

  it('starts from empty only for a newly observed live response', () => {
    expect(shouldStartTypewriterFromEmpty(true, true, true)).toBe(true)
    expect(shouldStartTypewriterFromEmpty(true, false, true)).toBe(false)
    expect(shouldStartTypewriterFromEmpty(true, true, false)).toBe(false)
    expect(shouldStartTypewriterFromEmpty(true, false, false)).toBe(false)
    expect(shouldStartTypewriterFromEmpty(false, true, true)).toBe(false)
  })

  it('auto-collapses settled reasoning while preserving a manual disclosure', () => {
    expect(thinkingDisclosureAfterPhaseChange(true, false, null)).toBe(false)
    expect(thinkingDisclosureAfterPhaseChange(true, false, true)).toBe(true)
    expect(thinkingDisclosureAfterPhaseChange(true, false, false)).toBe(false)
  })

  it('opens a new live reasoning phase and ignores unchanged phases', () => {
    expect(thinkingDisclosureAfterPhaseChange(false, true, false)).toBe(true)
    expect(thinkingDisclosureAfterPhaseChange(true, true, true)).toBeNull()
    expect(thinkingDisclosureAfterPhaseChange(false, false, true)).toBeNull()
  })
})
