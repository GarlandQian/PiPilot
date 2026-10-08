import * as React from 'react'
import { TbLayoutBottombar, TbLayoutSidebarRight, TbPlus, TbX } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuShortcut, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import type { PanelDock } from './panel-tabs'

/** One tab as its strip shows it. */
export interface PanelStripTab {
  id: string
  label: string
  title?: string
  icon: React.ReactNode
  /**
   * A tab that draws its own tabs here (the terminal: one per session),
   * in place of the usual label and close button.
   */
  slot?: React.RefCallback<HTMLDivElement>
}

export interface PanelNewTabItem {
  id: string
  label: string
  icon: React.ReactNode
  shortcut?: string
  onSelect(): void
}

export function panelTabDomId(id: string) {
  return `panel-tab-${id.replace(/[^A-Za-z0-9_-]/gu, '_')}`
}

export function panelViewDomId(id: string) {
  return `panel-view-${id.replace(/[^A-Za-z0-9_-]/gu, '_')}`
}

const DRAG_TYPE = 'application/x-pipilot-panel-tab'
/** The tab being dragged, so the other dock's strip can accept it too. */
let draggingTab: string | null = null

/**
 * A dock's tab strip, as in Codex: every tab closes, right-click moves it to
 * the other dock, and tabs drag to reorder or to the other dock.
 */
export function PanelTabStrip({ dock, tabs, activeId, onSelect, onClose, onCloseOthers, onMove, onDropTab, newTabItems = [], tools, actions, className }: {
  dock: PanelDock
  tabs: readonly PanelStripTab[]
  activeId: string | null
  onSelect(id: string): void
  onClose(id: string): void
  onCloseOthers?(id: string): void
  onMove?(id: string, dock: PanelDock): void
  /** A tab dropped onto this strip, from this dock or the other. */
  onDropTab?(id: string, index: number): void
  newTabItems?: readonly PanelNewTabItem[]
  /** The active tab's own tools (the terminal's search, copy and clear). */
  tools?: React.ReactNode
  actions?: React.ReactNode
  className?: string
}) {
  const t = useT()
  const listRef = React.useRef<HTMLDivElement>(null)
  const [dropIndex, setDropIndex] = React.useState<number | null>(null)
  // Keep the tab in front in view: after layout (an overlay may still be sizing) and as the strip resizes.
  React.useEffect(() => {
    const list = listRef.current
    if (!list) return
    const reveal = () => {
      const tab = list.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.closest<HTMLElement>('[data-panel-tab]')
      if (!tab) return
      const box = tab.getBoundingClientRect(), strip = list.getBoundingClientRect()
      const left = box.left - strip.left + list.scrollLeft, right = left + box.width
      if (left < list.scrollLeft) list.scrollLeft = left
      else if (right > list.scrollLeft + list.clientWidth) list.scrollLeft = right - list.clientWidth
    }
    const frame = requestAnimationFrame(reveal)
    const observer = new ResizeObserver(reveal)
    observer.observe(list)
    return () => { cancelAnimationFrame(frame); observer.disconnect() }
  }, [activeId, tabs.length])

  const focusSelected = () => requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus())
  const close = (id: string) => {
    onClose(id)
    // The close button leaves with its tab; keyboard focus moves to the selected tab.
    focusSelected()
  }
  // Arrow keys move across every tab, including ones portaled in (terminals),
  // whose React events bubble elsewhere: so this listens to the DOM itself.
  React.useEffect(() => {
    const list = listRef.current
    if (!list) return
    const moveFocus = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      const items = [...list.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
      const index = items.findIndex((item) => item === document.activeElement)
      if (index < 0) return
      event.preventDefault()
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length
      items[next]?.focus()
      items[next]?.click()
    }
    list.addEventListener('keydown', moveFocus)
    return () => list.removeEventListener('keydown', moveFocus)
  }, [])
  const indexAt = (clientX: number) => {
    const items = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-panel-tab]') ?? [])]
    const index = items.findIndex((item) => {
      const box = item.getBoundingClientRect()
      return clientX < box.left + box.width / 2
    })
    return index < 0 ? items.length : index
  }
  const other: PanelDock = dock === 'right' ? 'bottom' : 'right'

  return <div className={cn('flex min-w-0 items-center gap-1.5', className)} data-panel-strip={dock}>
    <div ref={listRef} role="tablist" aria-label={t(dock === 'right' ? 'panel.dock.right' : 'panel.dock.bottom')}
      onDragOver={(event) => {
        if (!onDropTab || !draggingTab || !event.dataTransfer.types.includes(DRAG_TYPE)) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        setDropIndex(indexAt(event.clientX))
      }}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropIndex(null) }}
      onDrop={(event) => {
        const id = event.dataTransfer.getData(DRAG_TYPE) || draggingTab
        setDropIndex(null)
        if (!id || !onDropTab) return
        event.preventDefault()
        onDropTab(id, indexAt(event.clientX))
      }}
      className="@container/strip scrollbar-none flex min-h-7 min-w-0 flex-1 items-center gap-0.5 overflow-x-auto py-1">
      {tabs.map((tab, index) => {
        const active = tab.id === activeId
        return <ContextMenu key={tab.id}>
          <ContextMenuTrigger asChild>
            <div data-panel-tab={tab.id} data-app-no-drag draggable={Boolean(onDropTab)}
              onDragStart={(event) => {
                draggingTab = tab.id
                event.dataTransfer.setData(DRAG_TYPE, tab.id)
                event.dataTransfer.effectAllowed = 'move'
              }}
              onDragEnd={() => { draggingTab = null; setDropIndex(null) }}
              onAuxClick={(event) => { if (event.button === 1) { event.preventDefault(); close(tab.id) } }}
              // Like browser tabs, background tabs narrow before the strip has to scroll.
              className={cn('group/tab relative flex h-7 items-center rounded-[8px] text-caption',
                tab.slot ? 'shrink-0 gap-0.5' : active ? 'max-w-[200px] shrink-0' : 'max-w-[200px] min-w-24 shrink',
                dropIndex === index && 'before:absolute before:-left-0.5 before:inset-y-1 before:w-0.5 before:rounded-full before:bg-primary',
                dropIndex === tabs.length && index === tabs.length - 1 && 'after:absolute after:-right-0.5 after:inset-y-1 after:w-0.5 after:rounded-full after:bg-primary',
                tab.slot ? '' : active ? 'bg-control text-foreground shadow-[inset_0_1px_0.5px_rgb(255_255_255/0.9),0_0_0_0.5px_rgb(0_0_0/0.08),0_1px_2px_rgb(0_0_0/0.08)] dark:bg-white/14 dark:shadow-none'
                  : 'text-foreground/70 hover:bg-fill hover:text-foreground')}>
              {tab.slot ? <div ref={tab.slot} className="contents" data-panel-tab-slot={tab.id} /> : <>
                <button type="button" role="tab" id={panelTabDomId(tab.id)} aria-selected={active} aria-controls={panelViewDomId(tab.id)}
                  tabIndex={active ? 0 : -1} title={tab.title ?? tab.label} onClick={() => onSelect(tab.id)}
                  className={cn('flex h-full min-w-0 items-center gap-1.5 rounded-[8px] pl-2 outline-none focus-visible:focus-ring',
                    // A background tab's close button floats over the end of its name, which fades under it.
                    active ? 'pr-1' : 'flex-1 pr-2 group-hover/tab:[mask-image:linear-gradient(to_left,transparent_22px,#000_34px)] group-has-[:focus-visible]/tab:[mask-image:linear-gradient(to_left,transparent_22px,#000_34px)]')}>
                  <span className="flex size-4 shrink-0 items-center justify-center [&_svg]:size-3.5" aria-hidden>{tab.icon}</span>
                  <span className="min-w-0 truncate font-medium">{tab.label}</span>
                </button>
                <button type="button" aria-label={t('inspector.tab.close', { name: tab.label })} title={t('inspector.tab.close', { name: tab.label })} onClick={() => close(tab.id)}
                  className={cn('flex size-[18px] shrink-0 items-center justify-center rounded-[5px] text-muted-foreground outline-none hover:bg-fill-strong hover:text-foreground focus-visible:focus-ring',
                    active ? 'mr-1' : 'absolute top-1/2 right-1 -translate-y-1/2 opacity-0 group-hover/tab:opacity-100 focus-visible:opacity-100')}>
                  <TbX className="size-3" aria-hidden />
                </button>
              </>}
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent>
            {onMove ? <ContextMenuItem onSelect={() => onMove(tab.id, other)}>
              {other === 'bottom' ? <TbLayoutBottombar aria-hidden /> : <TbLayoutSidebarRight aria-hidden />}
              {t(other === 'bottom' ? 'panel.tab.moveBottom' : 'panel.tab.moveRight')}
            </ContextMenuItem> : null}
            {onMove ? <ContextMenuSeparator /> : null}
            <ContextMenuItem onSelect={() => close(tab.id)}><TbX aria-hidden />{t('panel.tab.close')}</ContextMenuItem>
            {onCloseOthers && tabs.length > 1 ? <ContextMenuItem onSelect={() => { onCloseOthers(tab.id); focusSelected() }}>{t('panel.tab.closeOthers')}</ContextMenuItem> : null}
          </ContextMenuContent>
        </ContextMenu>
      })}
    </div>
    {tools}
    {newTabItems.length ? <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-xs" className="size-7 shrink-0 rounded-[8px] text-muted-foreground hover:text-foreground" aria-label={t('inspector.tab.new')}>
              <TbPlus className="size-4" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t('inspector.tab.new')}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="min-w-52">
        {newTabItems.map((item) => <DropdownMenuItem key={item.id} onSelect={item.onSelect}>
          {item.icon}{item.label}{item.shortcut ? <DropdownMenuShortcut>{item.shortcut}</DropdownMenuShortcut> : null}
        </DropdownMenuItem>)}
      </DropdownMenuContent>
    </DropdownMenu> : null}
    {actions}
  </div>
}

/**
 * Tab contents render once into their own element and are moved, not
 * remounted, between docks and the compact overlay: a terminal or a long
 * review keeps its state wherever its tab goes.
 */
export class PanelTabContainers {
  private readonly containers = new Map<string, HTMLDivElement>()

  get(id: string) {
    let container = this.containers.get(id)
    if (!container) {
      container = document.createElement('div')
      container.className = 'flex min-h-0 min-w-0 flex-1 flex-col'
      container.id = panelViewDomId(id)
      container.setAttribute('role', 'tabpanel')
      container.setAttribute('aria-labelledby', panelTabDomId(id))
      container.dataset.panelView = id
      this.containers.set(id, container)
    }
    return container
  }

  release(id: string) {
    this.containers.get(id)?.remove()
    this.containers.delete(id)
  }
}

/** Where a dock shows its tabs: each tab's element is attached here, the active one shown. */
export function PanelDockSlot({ containers, tabIds, activeId, empty }: {
  containers: PanelTabContainers
  tabIds: readonly string[]
  activeId: string | null
  empty?: React.ReactNode
}) {
  const slot = React.useRef<HTMLDivElement>(null)
  const key = tabIds.join('\u0000')
  React.useLayoutEffect(() => {
    const host = slot.current
    if (!host) return
    for (const id of tabIds) {
      const container = containers.get(id)
      if (container.parentNode !== host) host.appendChild(container)
      container.hidden = id !== activeId
    }
    for (const child of [...host.children]) {
      if (child instanceof HTMLElement && child.dataset.panelView && !tabIds.includes(child.dataset.panelView)) child.remove()
    }
  // `key` covers the tab list's contents.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, containers, key])
  return <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
    <div ref={slot} className="contents" />
    {tabIds.length === 0 ? empty : null}
  </div>
}
