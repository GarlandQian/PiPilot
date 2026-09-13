import {
  TbArrowsMinimize,
  TbDots,
  TbGitBranch,
  TbLayoutSidebarRightCollapse,
  TbLayoutSidebarRightExpand,
  TbMessagePlus,
  TbFileDiff,
  TbLoader2,
} from 'react-icons/tb'
import { ConversationNavigation } from './ConversationNavigation'
import type { AgentStatus, ConversationOutlineItem } from '@/types/chat'
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
  ownerKey?: string | null
  title: string
  sessionVisible: boolean
  inspectorOpen: boolean
  branch: string
  stats: PiSessionStats | null
  onToggleInspector: () => void
  onCompact: () => void
  compacting?: boolean
  projectName?: string
  status?: AgentStatus
  outline?: readonly ConversationOutlineItem[]
  onNavigate?: (entryId: string) => void
  onNewConversation?: () => void
  onShowChanges?: () => void
}

export function ChatHeader({
  ownerKey,
  title,
  sessionVisible,
  inspectorOpen,
  branch,
  stats,
  onToggleInspector,
  onCompact,
  compacting = false,
  projectName,
  status,
  outline = [],
  onNavigate,
  onNewConversation,
  onShowChanges,
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
    <header className="flex min-h-18 min-w-0 shrink-0 items-center gap-3 border-b border-border/45 bg-background px-6 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2 text-micro text-muted-foreground">
          <span className="truncate">{projectName || t('conversation.projectless')}</span>
          {branch ? <span className="flex min-w-0 items-center gap-1 truncate"><TbGitBranch className="size-3 shrink-0" aria-hidden />{branch}</span> : null}
        </div>
        <h1 className="mt-1 truncate text-title font-medium text-foreground">{title}</h1>
      </div>
      {sessionVisible && status && status !== 'idle' ? <span className="flex shrink-0 items-center gap-1.5 text-caption text-muted-foreground" role="status" data-conversation-status={status}>
        {(status === 'running' || status === 'planning') ? <TbLoader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> : null}
        {t(`agent.status.${status}`)}
      </span> : null}

      <div className="flex shrink-0 items-center gap-0.5">
        {onNavigate ? <ConversationNavigation ownerKey={ownerKey} items={outline} onNavigate={onNavigate} /> : null}
        {onShowChanges ? <Button variant="ghost" size="icon-sm" onClick={onShowChanges} aria-label={t('header.showChanges')} title={t('header.showChanges')}><TbFileDiff aria-hidden /></Button> : null}
        {sessionVisible && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={t('header.agentActions')}>
                <TbDots aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              {onNewConversation ? <DropdownMenuItem onSelect={onNewConversation}><TbMessagePlus aria-hidden />{t('header.newConversation')}</DropdownMenuItem> : null}
              {hasDetails ? (
                <>
                  <DropdownMenuLabel className="px-2 py-1.5 text-caption font-medium text-muted-foreground">
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
              <DropdownMenuItem onSelect={onCompact} disabled={compacting}>
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
              size="icon-sm"
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
