import * as React from 'react'
import {
  TbArrowsDiagonalMinimize2,
  TbChevronLeft,
  TbEdit,
  TbLayoutSidebar,
  TbSettings,
} from 'react-icons/tb'
import { PiLogo } from '@/components/PiLogo'
import { GlobalNotifications } from '@/components/frame/GlobalNotifications'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useT } from '@/i18n'
import { fullScreenShortcut, primaryShortcut } from '@/lib/keyboard-shortcuts'
import { cn } from '@/lib/utils'

export type RailDestination = 'sessions' | 'settings'

export interface ActivityRailProps {
  rail: RailDestination
  onRailChange: (destination: RailDestination) => void
  contextPanelOpen: boolean
  onToggleContextPanel: () => void
  /** Offered in the title bar while the sidebar is hidden, as in Codex. */
  onNewTask?: () => void
  newTaskDisabled?: boolean
  onOpenAbout: () => void
  onOpenNotification: (id: string) => Promise<void>
  width?: number
  /** In full screen macOS hides the window buttons; offer a visible way out. */
  onExitFullScreen?: () => void
  children?: React.ReactNode
}

function TitleBarButton({
  label,
  shortcut,
  expanded,
  disabled,
  onClick,
  children,
}: {
  label: string
  shortcut?: string
  expanded?: boolean
  disabled?: boolean
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
          aria-expanded={expanded}
          disabled={disabled}
          onClick={onClick}
          className="text-muted-foreground hover:text-foreground"
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="flex items-center gap-2">
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
 * Collapsed, the sidebar disappears entirely (Codex, Finder); its toggle and
 * New task stay in the title bar, and `--titlebar-leading` tells the page
 * toolbars how much room they take.
 */
export function ActivityRail({
  rail,
  onRailChange,
  contextPanelOpen,
  onToggleContextPanel,
  onNewTask,
  newTaskDisabled,
  onOpenAbout,
  onOpenNotification,
  width,
  onExitFullScreen,
  children,
}: ActivityRailProps) {
  const t = useT()
  const expanded = contextPanelOpen && children !== undefined
  const clusterRef = React.useRef<HTMLDivElement>(null)

  React.useLayoutEffect(() => {
    const root = document.documentElement
    const cluster = clusterRef.current
    if (expanded || !cluster) {
      root.style.removeProperty('--titlebar-leading')
      return
    }
    const measure = () => root.style.setProperty('--titlebar-leading', `${Math.ceil(cluster.getBoundingClientRect().right)}px`)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(cluster)
    return () => {
      observer.disconnect()
      root.style.removeProperty('--titlebar-leading')
    }
  }, [expanded])

  const toggle = (
    <TitleBarButton
      label={t('rail.togglePanel')}
      shortcut={primaryShortcut('B')}
      expanded={contextPanelOpen}
      onClick={onToggleContextPanel}
    >
      <TbLayoutSidebar className="size-[18px]" aria-hidden />
    </TitleBarButton>
  )
  const exitFullScreen = onExitFullScreen ? <div className="glass toolbar-group">
    <TitleBarButton label={t('window.exitFullScreen')} shortcut={fullScreenShortcut()} onClick={onExitFullScreen}>
      <TbArrowsDiagonalMinimize2 className="size-[18px]" aria-hidden />
    </TitleBarButton>
  </div> : null

  return (
    <>
      {!expanded && (
        <div ref={clusterRef} data-navigation-layout="rail"
          className="app-drag absolute top-0 left-0 z-40 flex h-(--frame-header-h) items-center gap-1.5 pl-3 mac:pl-(--traffic-light-gutter)">
          {exitFullScreen}
          <div className="glass toolbar-group">
            {toggle}
            {/* Settings keeps a way back to the app while its sidebar is hidden. */}
            {rail === 'settings' ? <TitleBarButton label={t('settings.backToApp')} onClick={() => onRailChange('sessions')}>
              <TbChevronLeft className="size-[18px]" aria-hidden />
            </TitleBarButton> : onNewTask ? <TitleBarButton label={t('nav.redesign.newTask')} shortcut={primaryShortcut('N')} disabled={newTaskDisabled} onClick={onNewTask}>
              <TbEdit className="size-[18px]" aria-hidden />
            </TitleBarButton> : null}
          </div>
        </div>
      )}
      <aside
        hidden={!expanded}
        data-navigation-layout={expanded ? 'sidebar' : undefined}
        style={width !== undefined ? { width } : undefined}
        className="flex h-full w-60 shrink-0 flex-col border-r border-border bg-source-list mac:border-black/10 dark:mac:border-black/50"
      >
        {/* Title bar: traffic lights, then the sidebar toggle (Codex, Notes). */}
        <header className="app-drag flex h-(--frame-header-h) w-full shrink-0 items-center gap-1.5 pr-2.5 pl-3.5 mac:pl-(--traffic-light-gutter)">
          <span className="flex min-w-0 flex-1 items-center gap-2 mac:hidden">
            <PiLogo className="size-5 shrink-0 text-foreground" />
            <span className="truncate text-title">{t('app.name')}</span>
          </span>
          {exitFullScreen}
          <div className="glass toolbar-group">{toggle}</div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col">
          {children}
        </div>

        <nav
          aria-label={t('rail.nav')}
          className="flex shrink-0 items-center gap-1 border-t border-border/70 px-2.5 py-2 mac:border-black/[0.07] dark:mac:border-white/[0.06]"
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={t('rail.settings')}
                aria-current={rail === 'settings' ? 'page' : undefined}
                onClick={() => onRailChange('settings')}
                className={cn(
                  'flex h-[30px] min-w-0 flex-1 items-center gap-2 rounded-[8px] px-2 text-left text-app text-foreground/90 outline-none hover:bg-fill focus-visible:focus-ring',
                  rail === 'settings' && 'bg-source-list-selected hover:bg-source-list-selected',
                )}
              >
                <TbSettings className={cn('size-[17px] shrink-0', rail === 'settings' ? 'text-primary' : 'text-muted-foreground')} aria-hidden />
                <span className="truncate">{t('rail.settings')}</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="flex items-center gap-2">{t('rail.settings')}<Kbd>{primaryShortcut(',')}</Kbd></TooltipContent>
          </Tooltip>
          <GlobalNotifications onOpenAbout={onOpenAbout} onOpenNotification={onOpenNotification} />
        </nav>
      </aside>
    </>
  )
}
