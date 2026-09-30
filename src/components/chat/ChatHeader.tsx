import {
  TbArrowsMinimize,
  TbDots,
  TbGitBranch,
  TbLayoutSidebarRight,
  TbMessagePlus,
  TbFileDiff,
  TbLoader2,
  TbTerminal2,
  TbSearch,
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
import { cn } from '@/lib/utils'

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
  onSearch?: () => void
  onNewConversation?: () => void
  onShowChanges?: () => void
  terminalOpen?: boolean
  onToggleTerminal?: () => void
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
  onSearch,
  onNewConversation,
  onShowChanges,
  terminalOpen,
  onToggleTerminal,
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
    <header className="app-drag toolbar-material flex h-(--frame-header-h) min-w-0 shrink-0 items-center gap-2.5 pr-3 pl-5">
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[calc(var(--app-font-size)+2px)] leading-tight font-bold text-foreground">{title}</h1>
        <div className="flex min-w-0 items-center gap-1.5 text-micro leading-tight text-muted-foreground">
          <span className="truncate">{projectName || t('conversation.projectless')}</span>
          {branch ? <span className="flex min-w-0 items-center gap-0.5 truncate"><TbGitBranch className="size-3 shrink-0" aria-hidden />{branch}</span> : null}
        </div>
      </div>
      {sessionVisible && status && status !== 'idle' ? <span className="glass flex h-7 shrink-0 items-center gap-1.5 rounded-full px-3 text-caption text-muted-foreground" role="status" data-conversation-status={status}>
        {(status === 'running' || status === 'planning') ? <TbLoader2 className="size-3.5 animate-spin text-primary motion-reduce:animate-none" aria-hidden /> : null}
        {t(`agent.status.${status}`)}
      </span> : null}

      {/* macOS 27 toolbar: related items share one Liquid Glass capsule. */}
      <div className="glass flex shrink-0 items-center gap-0.5 rounded-full p-[3px] [&_[data-slot=button]]:rounded-full [&_[data-slot=button]]:text-foreground/80 [&_[data-slot=button]:hover]:bg-(--glass-hover) [&_[data-slot=button]:hover]:text-foreground">
        {onSearch ? <Button variant="ghost" size="icon-sm" onClick={onSearch} aria-label={t('conversationSearch.title')} title={t('conversationSearch.title')}><TbSearch aria-hidden /></Button> : null}
        {onNavigate ? <ConversationNavigation ownerKey={ownerKey} items={outline} onNavigate={onNavigate} /> : null}
        {onShowChanges ? <Button variant="ghost" size="icon-sm" onClick={onShowChanges} aria-label={t('header.showChanges')} title={t('header.showChanges')}><TbFileDiff aria-hidden /></Button> : null}
        {onToggleTerminal ? <Button variant="ghost" size="icon-sm" className={terminalOpen ? 'bg-fill-strong text-primary!' : undefined} onClick={onToggleTerminal} aria-label={t('terminal.drawer.title')} title={t('terminal.drawer.title')} aria-expanded={terminalOpen} aria-controls="workspace-terminal-drawer"><TbTerminal2 aria-hidden /></Button> : null}
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
                  {onNewConversation ? <DropdownMenuSeparator /> : null}
                  <DropdownMenuLabel>
                    {t('header.sessionDetails')}
                  </DropdownMenuLabel>
                  <div className="space-y-1 px-2 pt-0.5 pb-1.5 text-caption">
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
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={inspectorOpen ? t('header.collapsePanel') : t('header.expandPanel')}
            onClick={onToggleInspector}
            className={cn('glass size-[34px] hover:bg-(--glass-fill) hover:brightness-[0.97] dark:hover:brightness-125', inspectorOpen ? 'text-primary hover:text-primary' : 'text-foreground/80')}
          >
            <TbLayoutSidebarRight className="size-[18px]" aria-hidden />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {inspectorOpen ? t('header.collapsePanel') : t('header.expandPanel')}
        </TooltipContent>
      </Tooltip>
    </header>
  )
}
