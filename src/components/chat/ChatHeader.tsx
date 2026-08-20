import {
  TbArrowsMinimize,
  TbDots,
  TbGitBranch,
  TbLayoutSidebarRightCollapse,
  TbLayoutSidebarRightExpand,
  TbMessageCircle,
} from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useLocale, useT } from '@/i18n'
import {
  formatSessionCost,
  formatTokenKilounits,
} from '@/renderer/pi-rpc/session-stats-format'
import type { PiSessionStats } from '@/store/pi-rpc'

export interface ChatHeaderProps {
  title: string
  sessionVisible: boolean
  inspectorOpen: boolean
  branch: string
  stats: PiSessionStats | null
  onToggleInspector: () => void
  onCompact: () => void
}

export function ChatHeader({
  title,
  sessionVisible,
  inspectorOpen,
  branch,
  stats,
  onToggleInspector,
  onCompact,
}: ChatHeaderProps) {
  const t = useT()
  const locale = useLocale()
  const context = stats?.contextUsage
  const contextLabel = context?.tokens === null || context?.tokens === undefined
    ? null
    : t('header.contextValue', {
        used: formatTokenKilounits(context.tokens, locale),
        total: formatTokenKilounits(context.contextWindow, locale),
      })
  const costLabel = stats ? formatSessionCost(stats.cost, locale, true) : null
  const hasDetails = Boolean(branch || contextLabel || costLabel)

  return (
    <header className="flex h-8 shrink-0 items-center gap-2 border-b border-border/60 bg-background px-3">
      <TbMessageCircle className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <h1 className="min-w-0 flex-1 truncate text-caption font-medium text-foreground">
        {title}
      </h1>

      <div className="flex shrink-0 items-center gap-0.5">
        {sessionVisible && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-xs" aria-label={t('header.agentActions')}>
                <TbDots aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              {hasDetails ? (
                <>
                  <DropdownMenuLabel className="px-2 py-1 text-micro font-medium uppercase text-muted-foreground">
                    {t('header.sessionDetails')}
                  </DropdownMenuLabel>
                  <div className="space-y-1 px-2 pb-1.5 text-caption">
                    {branch ? (
                      <div className="flex min-w-0 items-center gap-2">
                        <TbGitBranch className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="min-w-0 flex-1 truncate font-mono">{branch}</span>
                      </div>
                    ) : null}
                    {contextLabel ? (
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-muted-foreground">{t('header.context')}</span>
                        <span className="font-mono tabular-nums">{contextLabel}</span>
                      </div>
                    ) : null}
                    {costLabel ? (
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-muted-foreground">{t('header.cost')}</span>
                        <span className="font-mono tabular-nums">{costLabel}</span>
                      </div>
                    ) : null}
                  </div>
                  <DropdownMenuSeparator />
                </>
              ) : null}
              <DropdownMenuItem onSelect={onCompact}>
                <TbArrowsMinimize aria-hidden />
                {t('header.compact')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={inspectorOpen ? t('header.collapsePanel') : t('header.expandPanel')}
              onClick={onToggleInspector}
            >
              {inspectorOpen
                ? <TbLayoutSidebarRightCollapse aria-hidden />
                : <TbLayoutSidebarRightExpand aria-hidden />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">
            {inspectorOpen ? t('header.collapsePanel') : t('header.expandPanel')}
          </TooltipContent>
        </Tooltip>
      </div>
    </header>
  )
}
