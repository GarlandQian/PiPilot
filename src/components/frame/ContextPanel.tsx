import type * as React from 'react'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import type { RailDestination } from './ActivityRail'

const LABEL_KEYS = {
  sessions: 'rail.sessions',
  integrations: 'rail.integrations',
  settings: 'rail.settings',
} as const

export interface ContextPanelProps {
  rail: RailDestination
  /**
   * Keeps the panel mounted while visually hidden so destination body state
   * (e.g. sessions expansion) survives panel collapse.
   */
  hidden?: boolean
  /** Panel-specific action rendered at the trailing edge of the header row. */
  headerAction?: React.ReactNode
  /** Destination body (sessions list / integrations sub-nav / settings nav). */
  children: React.ReactNode
  className?: string
  /** Optional pixel width override; defaults to the w-60 utility. */
  width?: number
}

export function ContextPanel({ rail, hidden = false, headerAction, children, className, width }: ContextPanelProps) {
  const t = useT()
  const label = t(LABEL_KEYS[rail])
  return (
    <section
      hidden={hidden}
      aria-label={label}
      style={width === undefined ? undefined : { width }}
      className={cn(
        'flex h-full shrink-0 flex-col border-r border-border bg-sidebar',
        width === undefined && 'w-60',
        className,
      )}
    >
      <header className="flex h-8 shrink-0 items-center gap-2 border-b border-border/60 px-3">
        <h2 className="min-w-0 flex-1 truncate text-caption font-medium text-foreground">{label}</h2>
        {headerAction}
      </header>
      <div className="scroll-slim min-h-0 flex-1 overflow-y-auto">
        {children}
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* ContextPanelNav — vertical nav list (icon + label rows) used by the */
/* settings and integrations panel bodies.                             */
/* ------------------------------------------------------------------ */

export interface ContextPanelNavItem {
  id: string
  label: string
  icon?: React.ReactNode
}

export interface ContextPanelNavProps {
  items: readonly ContextPanelNavItem[]
  activeId: string
  onSelect: (id: string) => void
  ariaLabel: string
  className?: string
}

export function ContextPanelNav({
  items,
  activeId,
  onSelect,
  ariaLabel,
  className,
}: ContextPanelNavProps) {
  return (
    <nav aria-label={ariaLabel} className={cn('p-2', className)}>
      <ul className="flex flex-col gap-px">
        {items.map((item) => {
          const active = item.id === activeId
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onSelect(item.id)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'density-row flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 text-left text-app outline-none transition-colors duration-(--duration-fast) focus-visible:focus-ring',
                  active
                    ? 'bg-accent font-medium text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                )}
              >
                {item.icon
                  ? <span aria-hidden className="flex shrink-0 items-center [&_svg]:size-4">{item.icon}</span>
                  : null}
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
