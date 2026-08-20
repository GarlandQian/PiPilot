import { describe, expect, it } from 'vitest'
import {
  nextTypewriterText,
  shouldStartTypewriterFromEmpty,
} from '../../src/renderer/pi-rpc/live-typewriter'

describe('live response typewriter', () => {
  it('reveals small streamed chunks character by character', () => {
    expect(nextTypewriterText('', 'hello')).toBe('h')
    expect(nextTypewriterText('h', 'hello')).toBe('he')
  })

  it('catches up adaptively without jumping straight to a large target', () => {
    const target = 'x'.repeat(2_000)
    const next = nextTypewriterText('', target)
    expect(next).toHaveLength(6)
  })

  it('recovers from cumulative-stream corrections at the shared prefix', () => {
    expect(nextTypewriterText('hello worx', 'hello world')).toBe('hello worl')
  })

  it('uses a faster bounded catch-up after the stream settles', () => {
    const target = 'x'.repeat(600)
    expect(nextTypewriterText('', target, false)).toHaveLength(4)
    expect(nextTypewriterText('', target, true)).toHaveLength(8)
  })

  it('starts a full first streaming chunk from empty without replaying history', () => {
    expect(shouldStartTypewriterFromEmpty(true, false, true)).toBe(true)
    expect(shouldStartTypewriterFromEmpty(true, true, false)).toBe(true)
    expect(shouldStartTypewriterFromEmpty(true, false, false)).toBe(false)
    expect(shouldStartTypewriterFromEmpty(false, true, true)).toBe(false)
  })
})
