/**
 * Motion follows macOS: panels settle in about a third of a second without
 * bouncing, small things in about a fifth, and leaving is quicker than
 * arriving. "Reduce motion" (PiPilot's or the system's) turns it all off.
 */
export const SPRING_PANEL = { type: 'spring', duration: 0.35, bounce: 0 } as const
export const SPRING_SMALL = { type: 'spring', duration: 0.22, bounce: 0 } as const
export const EXIT = { duration: 0.16, ease: [0.4, 0, 1, 1] } as const

/** The curve CSS uses for the same feel (see --ease-smooth). */
const EASE_SMOOTH = 'cubic-bezier(0.22, 1, 0.36, 1)'

export function prefersReducedMotion() {
  if (typeof window === 'undefined') return true
  return document.documentElement.dataset.reducedMotion === 'true' || window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * A page arriving: `push` slides in from the trailing edge (a drill-down),
 * `pop` from the leading edge (Back), `fade` rises slightly (another pane).
 */
export function playEntrance(element: Element | null, kind: 'push' | 'pop' | 'fade') {
  if (!element || prefersReducedMotion() || typeof element.animate !== 'function') return
  const rtl = getComputedStyle(element).direction === 'rtl'
  const offset = kind === 'fade' ? 0 : (kind === 'push' ? 1 : -1) * (rtl ? -1 : 1) * 28
  element.animate([
    { opacity: 0, transform: kind === 'fade' ? 'translateY(6px)' : `translateX(${offset}px)` },
    { opacity: 1, transform: 'none' },
  ], { duration: kind === 'fade' ? 220 : 320, easing: EASE_SMOOTH })
}
