import type * as React from 'react'
import {
  TbLayoutSidebar,
  TbMessages,
  TbSearch,
  TbSettings,
} from 'react-icons/tb'
import { PiLogo } from '@/components/PiLogo'
import { GlobalNotifications } from '@/components/frame/GlobalNotifications'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useT } from '@/i18n'
import { primaryShortcut } from '@/lib/keyboard-shortcuts'
import { cn } from '@/lib/utils'

export type RailDestination = 'sessions' | 'settings'

export interface ActivityRailProps {
  rail: RailDestination
  onRailChange: (destination: RailDestination) => void
  contextPanelOpen: boolean
  onToggleContextPanel: () => void
  onOpenPalette: () => void
  onOpenAbout: () => void
  onOpenNotification: (id: string) => Promise<void>
  width?: number
  /** Receives the title-bar slot where the active sidebar page renders its actions (e.g. compose). */
  actionSlotRef?: React.Ref<HTMLDivElement>
  children?: React.ReactNode
}

function RailButton({
  label,
  shortcut,
  active,
  expanded,
  side = 'right',
  onClick,
  children,
}: {
  label: string
  shortcut?: string
  active?: boolean
  expanded?: boolean
  side?: 'right' | 'top' | 'bottom'
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          aria-current={active ? 'page' : undefined}
          aria-expanded={expanded}
          onClick={onClick}
          className={cn(
            'text-muted-foreground hover:text-foreground',
            active && 'bg-source-list-selected text-primary hover:bg-source-list-selected hover:text-primary',
          )}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side={side} className="flex items-center gap-2">
        {label}
        {shortcut ? <Kbd>{shortcut}</Kbd> : null}
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * macOS source-list sidebar. On macOS the window's native sidebar vibrancy
 * shows through (`bg-source-list` is transparent there) and the header leaves
 * room for the inset traffic lights; it doubles as the title-bar drag region.
 */
export function ActivityRail({
  rail,
  onRailChange,
  contextPanelOpen,
  onToggleContextPanel,
  onOpenPalette,
  onOpenAbout,
  onOpenNotification,
  width,
  actionSlotRef,
  children,
}: ActivityRailProps) {
  const t = useT()
  const expanded = contextPanelOpen && children !== undefined
  const toggle = (
    <RailButton
      label={t('rail.togglePanel')}
      shortcut={primaryShortcut('B')}
      expanded={contextPanelOpen}
      side="bottom"
      onClick={onToggleContextPanel}
    >
      <TbLayoutSidebar className="size-[18px]" aria-hidden />
    </RailButton>
  )
  return (
    <aside
      data-navigation-layout={expanded ? 'sidebar' : 'rail'}
      style={expanded && width !== undefined ? { width } : undefined}
      className={cn(
        'flex h-full shrink-0 flex-col border-r border-border bg-source-list mac:border-black/10 dark:mac:border-black/50',
        expanded ? 'w-60' : 'w-12 items-center mac:w-[76px]',
      )}
    >
      {/* Title bar: traffic lights, sidebar toggle, then the page's own actions (Notes/Mail layout). */}
      <header className={cn(
        'app-drag flex w-full shrink-0',
        expanded
          ? 'h-(--frame-header-h) items-center gap-1 pr-2.5 pl-3.5 mac:pl-(--traffic-light-gutter)'
          : 'flex-col items-center gap-2 pt-3 pb-2 mac:pt-[46px]',
      )}>
        <span className={cn('flex min-w-0 items-center gap-2 mac:hidden', expanded && 'flex-1')}>
          <PiLogo className="size-5 shrink-0 text-foreground" />
          {expanded ? <span className="truncate text-title">{t('app.name')}</span> : null}
        </span>
        {toggle}
        {expanded ? <>
          <span className="hidden flex-1 mac:block" />
          <div ref={actionSlotRef} className="flex items-center gap-0.5" data-sidebar-actions />
        </> : null}
      </header>

      <div hidden={!expanded} className="flex min-h-0 flex-1 flex-col">
        {children}
      </div>

      <nav
        aria-label={t('rail.nav')}
        className={cn(
          'mt-auto flex items-center gap-0.5',
          expanded
            ? 'shrink-0 border-t border-border/70 px-2.5 py-2 mac:border-black/[0.07] dark:mac:border-white/[0.06]'
            : 'w-full flex-1 flex-col px-2 pb-2.5',
        )}
      >
        <RailButton
          label={t('rail.sessions')}
          shortcut={primaryShortcut('1')}
          active={rail === 'sessions'}
          side={expanded ? 'top' : 'right'}
          onClick={() => onRailChange('sessions')}
        >
          <TbMessages className="size-[18px]" aria-hidden />
        </RailButton>
        <div className={expanded ? undefined : 'mt-auto pt-2'}>
          <RailButton
            label={t('rail.settings')}
            shortcut={primaryShortcut('2')}
            active={rail === 'settings'}
            side={expanded ? 'top' : 'right'}
            onClick={() => onRailChange('settings')}
          >
            <TbSettings className="size-[18px]" aria-hidden />
          </RailButton>
        </div>
        <GlobalNotifications onOpenAbout={onOpenAbout} onOpenNotification={onOpenNotification} />
        <div className={expanded ? 'ml-auto' : undefined}>
          <RailButton
            label={t('rail.palette')}
            shortcut={primaryShortcut('K')}
            side={expanded ? 'top' : 'right'}
            onClick={onOpenPalette}
          >
            <TbSearch className="size-[18px]" aria-hidden />
          </RailButton>
        </div>
      </nav>
    </aside>
  )
}
