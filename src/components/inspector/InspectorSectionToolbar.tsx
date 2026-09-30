import type { ReactNode } from 'react'

/** Shared chrome only; resource readers and their scroll roots stay mounted. */
export function InspectorSectionToolbar({ title, description, leading, children }: {
  title: ReactNode
  description?: ReactNode
  leading?: ReactNode
  children?: ReactNode
}) {
  return <header className="flex min-h-11 shrink-0 items-center gap-1.5 border-b border-border px-3.5 py-1.5" data-inspector-section-toolbar>
    {leading}
    <div className="min-w-0 flex-1">
      <div className="truncate text-caption font-semibold text-foreground">{title}</div>
      {description ? <div className="truncate text-micro text-muted-foreground">{description}</div> : null}
    </div>
    {children ? <div className="flex shrink-0 items-center gap-0.5 [&_[data-slot=button]]:rounded-full">{children}</div> : null}
  </header>
}
