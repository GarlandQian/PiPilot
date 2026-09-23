import * as React from 'react'
import { useT } from '@/i18n'
import { createDefaultWorkspaceAdapter } from '@/renderer/adapters/workspace-adapter'
import type { ConversationScope } from '@/shared/conversation-scope'
import { cn } from '@/lib/utils'
import { TerminalWorkspace } from './TerminalWorkspace'

const DEFAULT_HEIGHT = 280
const MIN_HEIGHT = 180
const HEIGHT_KEY = 'pipilot.terminal.height.v1'

function savedHeight() {
  try {
    const value = Number(localStorage.getItem(HEIGHT_KEY))
    return Number.isFinite(value) && value >= MIN_HEIGHT && value <= 2_000 ? value : DEFAULT_HEIGHT
  } catch { return DEFAULT_HEIGHT }
}

function ownerKey(scope: ConversationScope) {
  return scope.kind === 'project' ? scope.workspaceId : 'projectless'
}

export interface TerminalDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  scope: ConversationScope
  scopeName: string
  projectIds: readonly string[]
}

/** Keep each visited terminal's emulator mounted: a live PTY is not a screen snapshot. */
export function TerminalDrawer({ open, onOpenChange, scope, scopeName, projectIds }: TerminalDrawerProps) {
  const t = useT()
  const [adapter] = React.useState(createDefaultWorkspaceAdapter)
  const [height, setHeight] = React.useState(savedHeight)
  const [maxHeight, setMaxHeight] = React.useState(480)
  const [maximized, setMaximized] = React.useState(false)
  const [owners, setOwners] = React.useState<Array<{ scope: ConversationScope; name: string }>>([])
  const containerRef = React.useRef<HTMLElement>(null)
  const dragRef = React.useRef<{ y: number; height: number } | null>(null)
  const owner = ownerKey(scope)
  const projectKey = JSON.stringify(projectIds)
  const displayedHeight = Math.min(maxHeight, Math.max(MIN_HEIGHT, height))

  React.useEffect(() => {
    if (!open) return
    setOwners((current) => {
      const existing = current.find((item) => ownerKey(item.scope) === owner)
      if (existing?.name === scopeName) return current
      return existing
        ? current.map((item) => item === existing ? { ...item, name: scopeName } : item)
        : [...current, { scope, name: scopeName }]
    })
  }, [open, owner, scope, scopeName])

  React.useEffect(() => {
    const ids = new Set<string>(JSON.parse(projectKey))
    setOwners((current) => {
      const retained = current.filter((item) => item.scope.kind === 'projectless' || ids.has(item.scope.workspaceId))
      return retained.length === current.length ? current : retained
    })
  }, [projectKey])

  React.useLayoutEffect(() => {
    const parent = containerRef.current?.parentElement
    if (!parent) return
    const measure = () => {
      if (parent.clientHeight > 0) setMaxHeight(Math.max(MIN_HEIGHT, parent.clientHeight - 240))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(parent)
    return () => observer.disconnect()
  }, [])

  React.useEffect(() => {
    try { localStorage.setItem(HEIGHT_KEY, String(height)) } catch { /* Resizing still works in memory. */ }
  }, [height])
  React.useEffect(() => { if (!open) setMaximized(false) }, [open])

  React.useLayoutEffect(() => {
    const section = containerRef.current
    if (!open || !maximized || !section?.parentElement) return
    const covered = Array.from(section.parentElement.children)
      .filter((element): element is HTMLElement => element instanceof HTMLElement && element !== section)
      .map((element) => ({ element, inert: element.inert }))
    for (const { element } of covered) element.inert = true
    return () => { for (const { element, inert } of covered) element.inert = inert }
  }, [open, maximized])

  const resize = (next: number) => setHeight(Math.round(Math.max(MIN_HEIGHT, Math.min(maxHeight, next))))
  const hide = () => {
    setMaximized(false)
    onOpenChange(false)
    requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-controls="workspace-terminal-drawer"]')?.focus())
  }

  return <section
    ref={containerRef}
    id="workspace-terminal-drawer"
    aria-label={t('terminal.drawer.title')}
    data-terminal-drawer
    data-terminal-maximized={maximized}
    hidden={!open}
    className={cn('min-h-0 min-w-0 border-t border-border bg-sidebar', maximized ? 'absolute inset-0 z-20' : 'relative shrink-0')}
    style={maximized ? undefined : { height: displayedHeight }}
  >
    {!maximized ? <div
      role="separator"
      aria-orientation="horizontal"
      aria-label={t('terminal.drawer.resize')}
      aria-valuemin={MIN_HEIGHT}
      aria-valuemax={maxHeight}
      aria-valuenow={displayedHeight}
      tabIndex={0}
      className="absolute -top-1 inset-x-0 z-10 h-2 cursor-row-resize touch-none outline-none after:absolute after:inset-x-0 after:top-1 after:h-px hover:after:bg-ring focus-visible:after:bg-ring"
      onDoubleClick={() => resize(DEFAULT_HEIGHT)}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.preventDefault()
        event.currentTarget.focus()
        event.currentTarget.setPointerCapture(event.pointerId)
        dragRef.current = { y: event.clientY, height: displayedHeight }
      }}
      onPointerMove={(event) => {
        if (dragRef.current) resize(dragRef.current.height + dragRef.current.y - event.clientY)
      }}
      onPointerUp={(event) => {
        dragRef.current = null
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
      }}
      onLostPointerCapture={() => { dragRef.current = null }}
      onKeyDown={(event) => {
        if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        const step = event.shiftKey ? 48 : 16
        resize(event.key === 'Home' ? MIN_HEIGHT : event.key === 'End' ? maxHeight : displayedHeight + (event.key === 'ArrowUp' ? step : -step))
      }}
    /> : null}
    {adapter ? owners.map((item) => <TerminalWorkspace
      key={ownerKey(item.scope)}
      terminalApi={adapter.terminal}
      scope={item.scope}
      name={item.name}
      visible={open && ownerKey(item.scope) === owner}
      maximized={maximized}
      onMaximize={() => setMaximized((current) => !current)}
      onHide={hide}
    />) : <p role="status" className="p-4 text-caption text-muted-foreground">{t('inspector.terminal.error')}</p>}
  </section>
}
