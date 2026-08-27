import { describe, expect, it } from 'vitest'
import {
  nextTypewriterText,
  shouldStartTypewriterFromEmpty,
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

  it('animates only live motion-enabled responses', () => {
    expect(shouldStartTypewriterFromEmpty(true, false, true)).toBe(true)
    expect(shouldStartTypewriterFromEmpty(true, true, false)).toBe(true)
    expect(shouldStartTypewriterFromEmpty(true, false, false)).toBe(false)
    expect(shouldStartTypewriterFromEmpty(false, true, true)).toBe(false)
  })
})
