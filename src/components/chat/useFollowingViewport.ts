import * as React from 'react'

interface ViewportMetrics {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}

/** Layout/streaming scroll events do not grant permission to resume following. */
export class FollowingViewportIntent {
  following = true
  private interactionUntil = 0
  private dragging = false
  private canResume = false

  interact(now: number, upward = false) {
    this.interactionUntil = now + 200
    this.canResume = !upward
    if (upward) this.following = false
  }

  drag(active: boolean) {
    this.dragging = active
    if (active) this.canResume = true
  }

  scroll(metrics: ViewportMetrics, now: number) {
    if (!this.dragging && now >= this.interactionUntil) return this.following
    this.interactionUntil = now + 200
    this.following = this.canResume &&
      metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight < 48
    return this.following
  }

  follow() {
    this.interactionUntil = 0
    this.canResume = true
    this.following = true
  }

  pause() {
    this.interactionUntil = 0
    this.canResume = false
    this.following = false
  }
}

export function useFollowingViewport({
  ownerKey,
  ready = true,
  revision,
  smooth,
}: {
  ownerKey: string | null
  ready?: boolean
  revision: unknown
  smooth: boolean
}) {
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const contentRef = React.useRef<HTMLDivElement>(null)
  const intent = React.useMemo(() => new FollowingViewportIntent(), [ownerKey, ready])
  const [following, setFollowing] = React.useState(true)
  const [hasMoreBelow, setHasMoreBelow] = React.useState(false)
  const touchY = React.useRef<number | null>(null)

  const measureMoreBelow = React.useCallback(() => {
    const scroll = scrollRef.current
    setHasMoreBelow(Boolean(scroll && scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight > 2))
  }, [])

  const scrollToLatest = React.useCallback((animate = true) => {
    const scroll = scrollRef.current
    if (!scroll || scroll.clientHeight === 0) return
    intent.follow()
    setFollowing(true)
    setHasMoreBelow(false)
    scroll.scrollTo({
      top: scroll.scrollHeight,
      behavior: animate && smooth ? 'smooth' : 'auto',
    })
  }, [intent, smooth])

  const pauseFollowing = React.useCallback(() => {
    intent.pause()
    setFollowing(false)
    measureMoreBelow()
  }, [intent, measureMoreBelow])

  React.useLayoutEffect(() => {
    setFollowing(intent.following)
    if (ready && intent.following) scrollToLatest(false)
    else measureMoreBelow()
  }, [intent, measureMoreBelow, ready, revision, scrollToLatest])

  React.useEffect(() => {
    const content = contentRef.current
    const scroll = scrollRef.current
    if (!ready || !content || !scroll || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      if (intent.following) scrollToLatest(false)
      else measureMoreBelow()
    })
    observer.observe(content)
    observer.observe(scroll)
    const endDrag = () => intent.drag(false)
    window.addEventListener('pointerup', endDrag)
    window.addEventListener('pointercancel', endDrag)
    return () => {
      observer.disconnect()
      window.removeEventListener('pointerup', endDrag)
      window.removeEventListener('pointercancel', endDrag)
    }
  }, [intent, measureMoreBelow, ready, scrollToLatest])

  const interact = (upward = false) => {
    intent.interact(Date.now(), upward)
    setFollowing(intent.following)
  }

  const scrollProps: React.HTMLAttributes<HTMLDivElement> = {
    onScroll: () => {
      if (scrollRef.current) setFollowing(intent.scroll(scrollRef.current, Date.now()))
      measureMoreBelow()
    },
    onWheel: (event) => { if (event.deltaY !== 0) interact(event.deltaY < 0) },
    onTouchStart: (event) => { touchY.current = event.touches[0]?.clientY ?? null },
    onTouchMove: (event) => {
      const nextY = event.touches[0]?.clientY ?? null
      if (nextY !== null && touchY.current !== null && nextY !== touchY.current) {
        interact(nextY > touchY.current)
      }
      touchY.current = nextY
    },
    onPointerDown: (event) => {
      if (event.target === event.currentTarget) {
        intent.drag(true)
        interact()
      }
    },
    onKeyDown: (event) => {
      if (event.target !== event.currentTarget) return
      if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) interact(true)
      else if (event.key === ' ') interact(event.shiftKey)
      else if (['ArrowDown', 'PageDown', 'End'].includes(event.key)) interact()
    },
  }

  return { scrollRef, contentRef, scrollProps, following, canJumpToLatest: !following && hasMoreBelow, scrollToLatest, pauseFollowing }
}
