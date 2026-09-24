import type * as React from 'react'
import {
  TbLayoutSidebarLeftCollapse,
  TbLayoutSidebarLeftExpand,
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
  side?: 'right' | 'top'
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
            active && 'bg-accent text-accent-foreground',
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

export function ActivityRail({
  rail,
  onRailChange,
  contextPanelOpen,
  onToggleContextPanel,
  onOpenPalette,
  onOpenAbout,
  onOpenNotification,
  width,
  children,
}: ActivityRailProps) {
  const t = useT()
  const expanded = contextPanelOpen && children !== undefined
  return (
    <aside
      data-navigation-layout={expanded ? 'sidebar' : 'rail'}
      style={expanded && width !== undefined ? { width } : undefined}
      className={cn(
        'flex h-full shrink-0 flex-col border-r border-border bg-sidebar',
        expanded ? 'w-60' : 'w-12 items-center',
      )}
    >
      <header className={cn(
        'flex w-full shrink-0 items-center',
        expanded ? 'h-(--frame-header-h) gap-2 px-3' : 'flex-col gap-3 py-3',
      )}>
        {expanded ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                aria-label={t('rail.sessions')}
                aria-current={rail === 'sessions' ? 'page' : undefined}
                onClick={() => onRailChange('sessions')}
                className="h-8 min-w-0 flex-1 justify-start gap-2 px-1 text-foreground"
              >
                <PiLogo className="size-5 shrink-0 text-foreground" />
                <span className="truncate text-title font-semibold">{t('app.name')}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="flex items-center gap-2">
              {t('rail.sessions')}
              <Kbd>{primaryShortcut('1')}</Kbd>
            </TooltipContent>
          </Tooltip>
        ) : <PiLogo className="size-5 text-foreground" />}
        <RailButton
          label={t('rail.togglePanel')}
          shortcut={primaryShortcut('B')}
          expanded={contextPanelOpen}
          onClick={onToggleContextPanel}
        >
          {contextPanelOpen
            ? <TbLayoutSidebarLeftCollapse className="size-4.5" aria-hidden />
            : <TbLayoutSidebarLeftExpand className="size-4.5" aria-hidden />}
        </RailButton>
      </header>

      <div hidden={!expanded} className="flex min-h-0 flex-1 flex-col">
        {children}
      </div>

      <nav
        aria-label={t('rail.nav')}
        className={cn(
          'mt-auto flex items-center gap-1',
          expanded
            ? 'mx-3 shrink-0 border-t border-border/60 py-2'
            : 'w-full flex-1 flex-col px-2 pb-2',
        )}
      >
        {!expanded && (
          <RailButton
            label={t('rail.sessions')}
            shortcut={primaryShortcut('1')}
            active={rail === 'sessions'}
            onClick={() => onRailChange('sessions')}
          >
            <TbMessages className="size-4.5" aria-hidden />
          </RailButton>
        )}
        <div className={expanded ? undefined : 'mt-auto pt-2'}>
          <RailButton
            label={t('rail.settings')}
            shortcut={primaryShortcut('2')}
            active={rail === 'settings'}
            side={expanded ? 'top' : 'right'}
            onClick={() => onRailChange('settings')}
          >
            <TbSettings className="size-4.5" aria-hidden />
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
            <TbSearch className="size-4.5" aria-hidden />
          </RailButton>
        </div>
      </nav>
    </aside>
  )
}
