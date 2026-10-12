import * as React from 'react'
import { AnimatePresence, LazyMotion, MotionConfig, domMax, m, useIsPresent, type HTMLMotionProps } from 'motion/react'
import { EXIT, SPRING_PANEL, SPRING_SMALL } from '@/lib/motion'
import { useSettings } from '@/store/settings'

/** One motion runtime for the app; PiPilot's "Reduce motion" switches it off like the system setting. */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  const { appearance } = useSettings()
  return <LazyMotion features={domMax} strict>
    <MotionConfig reducedMotion={appearance.reducedMotion ? 'always' : 'user'} transition={SPRING_SMALL}>{children}</MotionConfig>
  </LazyMotion>
}

/** Whether motion is off: PiPilot's setting or the system's. */
export function useReducedMotion() {
  const { appearance } = useSettings()
  const system = React.useSyncExternalStore((listener) => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    query.addEventListener('change', listener)
    return () => query.removeEventListener('change', listener)
  }, () => window.matchMedia('(prefers-reduced-motion: reduce)').matches, () => false)
  return appearance.reducedMotion || system
}

/**
 * Content that exists only while open, growing from and folding to nothing.
 * It clips only while moving, so focus rings and menus inside stay whole.
 */
export function Collapse({ open, children, ...props }: { open: boolean; children: React.ReactNode } & Omit<HTMLMotionProps<'div'>, 'children'>) {
  const reduced = useReducedMotion()
  if (reduced) return open ? <div className={props.className} style={props.style as React.CSSProperties}>{children}</div> : null
  return <AnimatePresence initial={false}>
    {open ? <CollapsePanel key="open" {...props}>{children}</CollapsePanel> : null}
  </AnimatePresence>
}

function CollapsePanel({ children, ...props }: { children: React.ReactNode } & Omit<HTMLMotionProps<'div'>, 'children'>) {
  const present = useIsPresent()
  return <m.div {...props} {...(present ? {} : { inert: true, 'aria-hidden': true })}
      initial={{ height: 0, opacity: 0, overflow: 'hidden' }}
      animate={{ height: 'auto', opacity: 1, transition: SPRING_PANEL, transitionEnd: { overflow: 'visible' } }}
      exit={{ height: 0, opacity: 0, overflow: 'hidden', transition: EXIT }}>
      {children}
    </m.div>
}

/**
 * A list row that grows in when added and folds away when removed (inside
 * AnimatePresence). While leaving it is inert and hidden from assistive
 * technology, so nothing can act on a row that is already gone.
 */
export const PresenceRow = React.forwardRef<HTMLLIElement, Omit<HTMLMotionProps<'li'>, 'ref'>>(function PresenceRow(props, ref) {
  const reduced = useReducedMotion()
  const present = useIsPresent()
  return <m.li ref={ref} {...props} {...(present ? {} : { inert: true, 'aria-hidden': true })}
    initial={reduced ? false : { height: 0, opacity: 0, overflow: 'hidden' }}
    animate={{ height: 'auto', opacity: 1, transition: SPRING_PANEL, transitionEnd: { overflow: 'visible' } }}
    exit={reduced ? undefined : { height: 0, opacity: 0, overflow: 'hidden', transition: EXIT }} />
})

/** An animated box (inside AnimatePresence) that is inert and hidden from assistive technology while it leaves. */
export const PresenceBox = React.forwardRef<HTMLDivElement, Omit<HTMLMotionProps<'div'>, 'ref'>>(function PresenceBox(props, ref) {
  const present = useIsPresent()
  return <m.div ref={ref} {...props} {...(present ? {} : { inert: true, 'aria-hidden': true })} />
})

/** Whether the surrounding presence child is still shown, for markup a leaving element should drop. */
export function Present({ children }: { children(present: boolean): React.ReactNode }) {
  return <>{children(useIsPresent())}</>
}

export { AnimatePresence, m }
