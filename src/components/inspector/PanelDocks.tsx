import * as React from 'react'
import { TbArrowsMaximize, TbArrowsMinimize, TbChevronDown, TbX } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { useT, type MessageKey } from '@/i18n'
import { cn } from '@/lib/utils'
import type { PanelDock } from './panel-tabs'
import { PanelDockSlot, PanelTabStrip, type PanelNewTabItem, type PanelStripTab, type PanelTabContainers } from './PanelTabStrip'

interface DockStripProps {
  tabs: readonly PanelStripTab[]
  tools?: React.ReactNode
  activeId: string | null
  onSelect(id: string): void
  onClose(id: string): void
  onCloseOthers(id: string): void
  onMove(id: string, dock: PanelDock): void
  onDropTab(id: string, index: number): void
  newTabItems: readonly PanelNewTabItem[]
}

function DockButton({ label, onClick, children }: { label: string; onClick(): void; children: React.ReactNode }) {
  return <Button variant="ghost" size="icon-sm" onClick={onClick} aria-label={label} title={label}>{children}</Button>
}

/** What an empty right dock offers instead of a blank page. */
export function PanelLauncher({ items }: { items: readonly PanelNewTabItem[] }) {
  const t = useT()
  return <div className="flex min-h-0 flex-1 items-center justify-center p-6" data-panel-launcher>
    <div className="w-full max-w-64">
      <p className="mb-2 px-2 text-caption font-medium text-muted-foreground">{t('panel.launcher.title')}</p>
      <ul className="space-y-0.5">
        {items.map((item) => <li key={item.id}>
          <button type="button" onClick={item.onSelect}
            className="flex h-8 w-full items-center gap-2.5 rounded-[8px] px-2 text-left text-body text-foreground/85 outline-none hover:bg-fill hover:text-foreground focus-visible:focus-ring [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground">
            {item.icon}
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {item.shortcut ? <kbd className="shrink-0 font-sans text-caption text-muted-foreground">{item.shortcut}</kbd> : null}
          </button>
        </li>)}
      </ul>
    </div>
  </div>
}

/**
 * The right dock. Its tab strip is the panel's header, as in Codex; full
 * view and close sit at the trailing end in one glass capsule.
 */
export function RightDock({ width, full, containers, tabIds, onToggleFull, onHide, ...strip }: DockStripProps & {
  width: number | string
  full: boolean
  containers: PanelTabContainers
  tabIds: readonly string[]
  /** Absent where there is nowhere to expand into (the compact overlay). */
  onToggleFull?: () => void
  onHide(): void
}) {
  const t = useT()
  return <aside aria-label={t('inspector.title')} style={{ width, maxWidth: '100%' }} data-panel-dock="right" data-panel-layout={full ? 'full' : 'split'}
    className="relative flex h-full min-w-0 flex-col border-l border-border bg-surface">
    <header className="shrink-0 border-b border-border bg-toolbar">
      <div className={cn('app-drag flex h-(--frame-header-h) min-w-0 items-center pr-2', full ? 'titlebar-leading-[10px]' : 'pl-2')}>
        <PanelTabStrip dock="right" {...strip} className="min-w-0 flex-1"
          actions={<div className="glass toolbar-group shrink-0">
            {onToggleFull ? <DockButton label={t(full ? 'panel.layout.exitFull' : 'panel.layout.full')} onClick={onToggleFull}>
              {full ? <TbArrowsMinimize className="size-4" aria-hidden /> : <TbArrowsMaximize className="size-4" aria-hidden />}
            </DockButton> : null}
            <DockButton label={t('inspector.close')} onClick={onHide}><TbX className="size-4" aria-hidden /></DockButton>
          </div>} />
      </div>
    </header>
    <PanelDockSlot containers={containers} tabIds={tabIds} activeId={strip.activeId} empty={<PanelLauncher items={strip.newTabItems} />} />
  </aside>
}

const BOTTOM_DEFAULT_HEIGHT = 280
const BOTTOM_MIN_HEIGHT = 160
const BOTTOM_HEIGHT_KEY = 'pipilot.terminal.height.v1'

function savedHeight() {
  try {
    const value = Number(localStorage.getItem(BOTTOM_HEIGHT_KEY))
    return Number.isFinite(value) && value >= BOTTOM_MIN_HEIGHT && value <= 2_000 ? value : BOTTOM_DEFAULT_HEIGHT
  } catch { return BOTTOM_DEFAULT_HEIGHT }
}

/**
 * The bottom dock under the conversation (⌘J). It resizes, and can fill the
 * column. Showing a terminal, its controls say so: hiding keeps it running.
 * New terminals come from the terminal's own button, so there is no "+" here.
 */
export function BottomDock({ open, containers, tabIds, onHide, terminalActive = false, ...strip }: DockStripProps & {
  open: boolean
  containers: PanelTabContainers
  tabIds: readonly string[]
  onHide(): void
  terminalActive?: boolean
}) {
  const t = useT()
  const [height, setHeight] = React.useState(savedHeight)
  const [maxHeight, setMaxHeight] = React.useState(480)
  const [maximized, setMaximized] = React.useState(false)
  const containerRef = React.useRef<HTMLElement>(null)
  const dragRef = React.useRef<{ y: number; height: number } | null>(null)
  const displayedHeight = Math.min(maxHeight, Math.max(BOTTOM_MIN_HEIGHT, height))

  React.useLayoutEffect(() => {
    const parent = containerRef.current?.parentElement
    if (!parent) return
    const measure = () => {
      if (parent.clientHeight > 0) setMaxHeight(Math.max(BOTTOM_MIN_HEIGHT, parent.clientHeight - 200))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(parent)
    return () => observer.disconnect()
  }, [])
  React.useEffect(() => {
    try { localStorage.setItem(BOTTOM_HEIGHT_KEY, String(height)) } catch { /* Resizing still works in memory. */ }
  }, [height])
  React.useEffect(() => { if (!open) setMaximized(false) }, [open])
  // Maximized, the dock covers the conversation; keep keyboard focus out of what it hides.
  React.useLayoutEffect(() => {
    const section = containerRef.current
    if (!open || !maximized || !section?.parentElement) return
    const covered = Array.from(section.parentElement.children)
      .filter((element): element is HTMLElement => element instanceof HTMLElement && element !== section)
      .map((element) => ({ element, inert: element.inert }))
    for (const { element } of covered) element.inert = true
    return () => { for (const { element, inert } of covered) element.inert = inert }
  }, [open, maximized])

  const resize = (next: number) => setHeight(Math.round(Math.max(BOTTOM_MIN_HEIGHT, Math.min(maxHeight, next))))
  const hide = () => {
    setMaximized(false)
    onHide()
    // Focus returns to the toolbar's terminal button, which brings the dock back.
    if (terminalActive) requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-controls="workspace-terminal-drawer"]')?.focus())
  }

  const label = (terminal: MessageKey, dock: MessageKey) => t(terminalActive ? terminal : dock)
  return <section ref={containerRef} id="workspace-terminal-drawer" aria-label={t('panel.dock.bottom')} data-panel-dock="bottom" data-terminal-drawer data-panel-maximized={maximized} hidden={!open}
    className={cn('flex min-h-0 min-w-0 flex-col border-t border-border bg-surface', maximized ? 'absolute inset-0 z-40' : 'relative shrink-0')}
    style={maximized ? undefined : { height: displayedHeight }}>
    {!maximized ? <div
      role="separator"
      aria-orientation="horizontal"
      aria-label={label('terminal.drawer.resizeTerminal', 'panel.dock.resize')}
      aria-valuemin={BOTTOM_MIN_HEIGHT}
      aria-valuemax={maxHeight}
      aria-valuenow={displayedHeight}
      tabIndex={0}
      className="absolute -top-1 inset-x-0 z-10 h-2 cursor-row-resize touch-none outline-none after:absolute after:inset-x-0 after:top-1 after:h-px hover:after:bg-ring focus-visible:after:bg-ring"
      onDoubleClick={() => resize(BOTTOM_DEFAULT_HEIGHT)}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.preventDefault()
        event.currentTarget.focus()
        event.currentTarget.setPointerCapture(event.pointerId)
        dragRef.current = { y: event.clientY, height: displayedHeight }
      }}
      onPointerMove={(event) => { if (dragRef.current) resize(dragRef.current.height + dragRef.current.y - event.clientY) }}
      onPointerUp={(event) => {
        dragRef.current = null
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
      }}
      onLostPointerCapture={() => { dragRef.current = null }}
      onKeyDown={(event) => {
        if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        const step = event.shiftKey ? 48 : 16
        resize(event.key === 'Home' ? BOTTOM_MIN_HEIGHT : event.key === 'End' ? maxHeight : displayedHeight + (event.key === 'ArrowUp' ? step : -step))
      }}
    /> : null}
    <header className="flex h-10 shrink-0 items-center border-b border-border px-2">
      <PanelTabStrip dock="bottom" {...strip} newTabItems={[]} className="min-w-0 flex-1"
        actions={<div className="flex shrink-0 items-center">
          <Button variant="ghost" size="icon-xs" onClick={() => setMaximized((value) => !value)}
            aria-label={maximized ? label('terminal.drawer.restore', 'panel.dock.restoreBottom') : label('terminal.drawer.maximize', 'panel.dock.maximizeBottom')}
            title={maximized ? label('terminal.drawer.restore', 'panel.dock.restoreBottom') : label('terminal.drawer.maximize', 'panel.dock.maximizeBottom')}>
            {maximized ? <TbArrowsMinimize aria-hidden /> : <TbArrowsMaximize aria-hidden />}
          </Button>
          <Button variant="ghost" size="icon-xs" onClick={hide} aria-label={label('terminal.drawer.hide', 'panel.dock.hideBottom')} title={label('terminal.drawer.hide', 'panel.dock.hideBottom')}><TbChevronDown aria-hidden /></Button>
        </div>} />
    </header>
    <PanelDockSlot containers={containers} tabIds={tabIds} activeId={strip.activeId} />
  </section>
}
