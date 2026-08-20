import type * as React from 'react'
import {
  TbCommand,
  TbLayoutSidebarLeftCollapse,
  TbLayoutSidebarLeftExpand,
  TbMessages,
  TbPackages,
  TbSettings,
} from 'react-icons/tb'
import { PiLogo } from '@/components/PiLogo'
import { GlobalNotifications } from '@/components/frame/GlobalNotifications'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'

export type RailDestination = 'sessions' | 'integrations' | 'settings'

export interface ActivityRailProps {
  rail: RailDestination
  onRailChange: (destination: RailDestination) => void
  contextPanelOpen: boolean
  onToggleContextPanel: () => void
  onOpenPalette: () => void
  onOpenAbout: () => void
}

interface RailDestinationDefinition {
  id: RailDestination
  icon: React.ComponentType<{ className?: string }>
  labelKey: 'rail.sessions' | 'rail.integrations' | 'rail.settings'
  shortcut: string
}

const DESTINATIONS: readonly RailDestinationDefinition[] = [
  { id: 'sessions', icon: TbMessages, labelKey: 'rail.sessions', shortcut: '⌘1' },
  { id: 'integrations', icon: TbPackages, labelKey: 'rail.integrations', shortcut: '⌘2' },
  { id: 'settings', icon: TbSettings, labelKey: 'rail.settings', shortcut: '⌘3' },
]

function RailButton({
  label,
  shortcut,
  active,
  onClick,
  children,
}: {
  label: string
  shortcut?: string
  active?: boolean
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
          onClick={onClick}
          className={cn(
            'text-muted-foreground hover:text-foreground',
            active && 'bg-accent text-accent-foreground',
          )}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right" className="flex items-center gap-2">
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
}: ActivityRailProps) {
  const t = useT()
  return (
    <nav
      aria-label={t('rail.nav')}
      className="flex h-full w-12 shrink-0 flex-col items-center border-r border-border bg-sidebar"
    >
      <div className="flex h-8 shrink-0 items-center justify-center border-b border-border/60">
        <PiLogo className="size-4 text-sage" />
      </div>

      <div className="flex flex-col items-center pt-1 pb-0.5">
        <RailButton
          label={t('rail.togglePanel')}
          shortcut="⌘B"
          onClick={onToggleContextPanel}
        >
          {contextPanelOpen
            ? <TbLayoutSidebarLeftCollapse className="size-4.5" aria-hidden />
            : <TbLayoutSidebarLeftExpand className="size-4.5" aria-hidden />}
        </RailButton>
      </div>

      <ul className="flex flex-col items-center gap-1">
        {DESTINATIONS.map(({ id, icon: Icon, labelKey, shortcut }) => {
          const active = rail === id
          return (
            <li key={id} className="relative flex items-center">
              <span
                aria-hidden
                className={cn(
                  'absolute -left-2 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-r-full bg-sage transition-opacity duration-(--duration-fast) motion-reduce:transition-none',
                  active ? 'opacity-100' : 'opacity-0',
                )}
              />
              <RailButton
                label={t(labelKey)}
                shortcut={shortcut}
                active={active}
                onClick={() => onRailChange(id)}
              >
                <Icon className="size-4.5" aria-hidden />
              </RailButton>
            </li>
          )
        })}
      </ul>

      <div className="mt-auto flex flex-col items-center gap-1 border-t border-border py-2">
        <GlobalNotifications onOpenAbout={onOpenAbout} />
        <RailButton label={t('rail.palette')} shortcut="⌘K" onClick={onOpenPalette}>
          <TbCommand className="size-4.5" aria-hidden />
        </RailButton>
      </div>
    </nav>
  )
}
