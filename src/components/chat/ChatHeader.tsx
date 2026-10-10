import type * as React from 'react'
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
  TbListDetails,
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
import type { WorkspaceChangeTotals } from '@/components/inspector/WorkspacePanel'
import { APP_SHORTCUTS } from '@/lib/app-shortcuts'
import { formatShortcut } from '@/lib/keyboard-shortcuts'

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
  /** Uncommitted lines, shown as Codex's +N −M review button. */
  changeTotals?: WorkspaceChangeTotals | null
  summaryOpen?: boolean
  onToggleSummary?: () => void
  /** Open-in-editor and commit menus, in their own capsule. */
  gitControls?: React.ReactNode
  terminalOpen?: boolean
  onToggleTerminal?: () => void
}

/** A toolbar button with its name (and shortcut) in a tooltip. */
function ToolbarButton({ label, shortcut, pressed, onClick, children, ...props }: {
  label: string
  shortcut?: string
  pressed?: boolean
  onClick?: () => void
  children: React.ReactNode
} & Omit<React.ComponentProps<typeof Button>, 'onClick' | 'children'>) {
  return <Tooltip>
    <TooltipTrigger asChild>
      <Button variant="ghost" size="icon-sm" aria-label={label} aria-pressed={pressed} onClick={onClick} {...props}>{children}</Button>
    </TooltipTrigger>
    <TooltipContent side="bottom">{label}{shortcut ? <span className="ml-2 text-muted-foreground">{shortcut}</span> : null}</TooltipContent>
  </Tooltip>
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
  changeTotals,
  summaryOpen = false,
  onToggleSummary,
  gitControls,
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
  const reviewCounts = changeTotals?.gitAvailable && changeTotals.files > 0 ? changeTotals : null
  const reviewLabel = reviewCounts
    ? t('header.reviewChanges', { count: reviewCounts.files, added: reviewCounts.added, deleted: reviewCounts.deleted })
    : t('header.showChanges')

  return (
    <header className="titlebar-drag toolbar-material relative flex h-(--frame-header-h) min-w-0 shrink-0 items-center gap-2.5 pr-3 titlebar-leading-[20px]">
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
      <div className="glass toolbar-group">
        {onSearch ? <Button variant="ghost" size="icon-sm" onClick={onSearch} aria-label={t('conversationSearch.title')} title={t('conversationSearch.title')}><TbSearch aria-hidden /></Button> : null}
        {onNavigate ? <ConversationNavigation ownerKey={ownerKey} items={outline} onNavigate={onNavigate} /> : null}
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
      {gitControls}
      {/* Codex's trailing group: review (+N −M), summary, terminal, side panel. */}
      <div className="glass toolbar-group">
        {onShowChanges ? <Tooltip>
          <TooltipTrigger asChild>
            {/* One icon like its neighbours; how many files changed rides on it as a badge. */}
            <Button variant="ghost" size="icon-sm" onClick={onShowChanges} aria-label={reviewLabel} data-review-button className="relative">
              <TbFileDiff aria-hidden />
              {reviewCounts ? <span aria-hidden data-review-count className="absolute -top-0.5 -right-0.5 flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-primary px-1 text-[10px] leading-none font-semibold tabular-nums text-primary-foreground shadow-[0_0_0_1.5px_var(--color-surface)]">
                {reviewCounts.files > 99 ? '99+' : reviewCounts.files}
              </span> : null}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{reviewLabel}<span className="ml-2 text-muted-foreground">{formatShortcut(APP_SHORTCUTS.openReview)}</span></TooltipContent>
        </Tooltip> : null}
        {onToggleSummary ? <ToolbarButton label={t('summary.title')} pressed={summaryOpen} onClick={onToggleSummary} data-summary-trigger aria-expanded={summaryOpen}><TbListDetails aria-hidden /></ToolbarButton> : null}
        {onToggleTerminal ? <ToolbarButton label={t('terminal.drawer.title')} shortcut={formatShortcut(APP_SHORTCUTS.toggleTerminal)} pressed={terminalOpen} onClick={onToggleTerminal}
          aria-expanded={terminalOpen} aria-controls="workspace-terminal-drawer"><TbTerminal2 aria-hidden /></ToolbarButton> : null}
        <ToolbarButton label={inspectorOpen ? t('header.collapsePanel') : t('header.expandPanel')} shortcut={formatShortcut(APP_SHORTCUTS.switchChatAndTabs)} pressed={inspectorOpen} onClick={onToggleInspector}>
          <TbLayoutSidebarRight className="size-[18px]" aria-hidden />
        </ToolbarButton>
      </div>
    </header>
  )
}
