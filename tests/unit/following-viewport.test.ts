import { describe, expect, it } from 'vitest'
import { FollowingViewportIntent } from '../../src/components/chat/useFollowingViewport'

const top = { scrollTop: 0, scrollHeight: 1_500, clientHeight: 500 }
const bottom = { ...top, scrollTop: 1_000 }
const nearBottom = { ...bottom, scrollTop: 980 }

describe('following viewport intent', () => {
  it('keeps following during content growth and layout-generated scroll events', () => {
    const intent = new FollowingViewportIntent()
    expect(intent.scroll(top, 1_000)).toBe(true)
    expect(intent.scroll({ ...bottom, scrollHeight: 2_000 }, 2_000)).toBe(true)
  })

  it('pauses before an upward wheel scroll and keeps the reader through completion', () => {
    const intent = new FollowingViewportIntent()
    intent.interact(1_000, true)
    expect(intent.following).toBe(false)
    expect(intent.scroll(top, 1_050)).toBe(false)
    // A disclosure/layout change may put the reader near the bottom without intent.
    expect(intent.scroll(bottom, 2_000)).toBe(false)
  })

  it('resumes only after deliberate scrolling to the latest output', () => {
    const intent = new FollowingViewportIntent()
    intent.pause()
    intent.interact(1_000)
    expect(intent.scroll(top, 1_050)).toBe(false)
    expect(intent.scroll(bottom, 1_150)).toBe(true)
  })

  it('keeps an upward gesture paused at a 20px gap until a downward gesture resumes it', () => {
    const intent = new FollowingViewportIntent()
    intent.interact(1_000, true)
    expect(intent.scroll(nearBottom, 1_050)).toBe(false)
    expect(intent.scroll(bottom, 1_100)).toBe(false)
    intent.interact(1_150)
    expect(intent.scroll(top, 1_175)).toBe(false)
    expect(intent.scroll(nearBottom, 1_200)).toBe(true)
  })

  it('allows Jump to latest and a new scrollbar drag to resume after upward intent', () => {
    const intent = new FollowingViewportIntent()
    intent.interact(1_000, true)
    expect(intent.scroll(nearBottom, 1_050)).toBe(false)
    intent.follow()
    expect(intent.scroll(nearBottom, 1_100)).toBe(true)

    intent.interact(2_000, true)
    expect(intent.scroll(nearBottom, 2_050)).toBe(false)
    intent.drag(true)
    expect(intent.scroll(top, 3_000)).toBe(false)
    expect(intent.scroll(bottom, 4_000)).toBe(true)
    intent.drag(false)
  })

  it('does not treat an outline jump or its smooth scroll as follow permission', () => {
    const intent = new FollowingViewportIntent()
    intent.interact(1_000)
    intent.pause()
    expect(intent.scroll(bottom, 1_050)).toBe(false)
    intent.follow()
    expect(intent.scroll(top, 1_100)).toBe(true)
  })

  it('honors scrollbar dragging past the interaction interval', () => {
    const intent = new FollowingViewportIntent()
    intent.drag(true)
    expect(intent.scroll(top, 3_000)).toBe(false)
    expect(intent.scroll(bottom, 8_000)).toBe(true)
    intent.drag(false)
    expect(intent.scroll(top, 10_000)).toBe(true)
  })

  it('starts the next owner independently from the previous reading position', () => {
    const previous = new FollowingViewportIntent()
    previous.pause()
    const replacement = new FollowingViewportIntent()
    expect(replacement.following).toBe(true)
    expect(previous.following).toBe(false)
  })
})
