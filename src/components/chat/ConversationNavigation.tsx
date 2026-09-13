import * as React from 'react'
import { TbAlertCircle, TbBan, TbCheck, TbClock, TbListSearch, TbLoader2 } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useLocale, useT, type MessageKey } from '@/i18n'
import { cn } from '@/lib/utils'
import type { ConversationOutlineItem, ConversationOutlineStatus } from '@/types/chat'
import { conversationNavigationFocusIndex, filterConversationNavigationItems } from './conversation-navigation'

const STATUS_KEYS: Record<ConversationOutlineStatus, MessageKey> = {
  pending: 'inspector.outline.status.pending',
  running: 'inspector.outline.status.running',
  complete: 'inspector.outline.status.complete',
  error: 'inspector.outline.status.error',
  aborted: 'inspector.outline.status.aborted',
}

const STATUS_ICONS = {
  pending: TbClock,
  running: TbLoader2,
  complete: TbCheck,
  error: TbAlertCircle,
  aborted: TbBan,
}

interface ConversationNavigationProps {
  items: readonly ConversationOutlineItem[]
  ownerKey?: string | null
  onNavigate(entryId: string): void
}

/** Each conversation owns its search, selection, and popover lifetime. */
export function ConversationNavigation({ ownerKey, ...props }: ConversationNavigationProps) {
  return <SessionConversationNavigation key={ownerKey ?? 'unavailable'} {...props} />
}

function SessionConversationNavigation({ items, onNavigate }: Omit<ConversationNavigationProps, 'ownerKey'>) {
  const t = useT()
  const locale = useLocale()
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [selectedEntryId, setSelectedEntryId] = React.useState('')
  const displayItems = React.useMemo(() => filterConversationNavigationItems(items, query), [items, query])
  const clock = React.useMemo(() => new Intl.DateTimeFormat(locale, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }), [locale])
  const selectedValue = displayItems.some((item) => item.entryId === selectedEntryId)
    ? selectedEntryId
    : displayItems[0]?.entryId ?? ''

  const changeOpen = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (!nextOpen) setQuery('')
  }
  const navigate = (entryId: string) => {
    if (!items.some((item) => item.entryId === entryId)) return
    setSelectedEntryId(entryId)
    changeOpen(false)
    onNavigate(entryId)
  }

  return <Popover open={open && items.length > 0} onOpenChange={changeOpen}>
    <PopoverTrigger asChild>
      <Button variant="ghost" size="icon-sm" disabled={items.length === 0} aria-label={t('header.conversationNavigation')} title={t('header.conversationNavigation')}>
        <TbListSearch aria-hidden />
      </Button>
    </PopoverTrigger>
    <PopoverContent
      align="end"
      aria-label={t('header.conversationNavigation')}
      data-conversation-navigation
      className="w-[min(440px,calc(100vw-32px))] overflow-hidden p-0"
      collisionPadding={16}
    >
      <Command
        label={t('header.searchConversation')}
        shouldFilter={false}
        value={selectedValue}
        onValueChange={setSelectedEntryId}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return
          const key = event.ctrlKey && (event.key === 'n' || event.key === 'j')
            ? 'ArrowDown'
            : event.ctrlKey && (event.key === 'p' || event.key === 'k')
              ? 'ArrowUp'
              : event.key
          const nextIndex = conversationNavigationFocusIndex(
            key,
            displayItems.findIndex((item) => item.entryId === selectedValue),
            displayItems.length,
          )
          if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(key)) return
          event.preventDefault()
          event.stopPropagation()
          if (nextIndex !== null) setSelectedEntryId(displayItems[nextIndex].entryId)
        }}
      >
        <CommandInput value={query} onValueChange={setQuery} placeholder={t('header.searchConversation')} aria-label={t('header.searchConversation')} />
        <CommandList label={t('header.conversationNavigation')} className="scroll-slim max-h-[min(520px,60vh)] p-1.5">
          <CommandEmpty>{t('header.noMatchingTurns')}</CommandEmpty>
          {displayItems.map((item) => {
            const StatusIcon = STATUS_ICONS[item.status]
            const timestamp = item.timestamp !== undefined && Number.isFinite(item.timestamp)
              ? item.timestamp
              : undefined
            const time = timestamp === undefined ? item.time : clock.format(timestamp)
            return <CommandItem
              key={item.entryId}
              value={item.entryId}
              data-conversation-navigation-entry={item.entryId}
              className="items-start gap-3 rounded-md px-3 py-3"
              onSelect={() => navigate(item.entryId)}
            >
              <span className="min-w-0 flex-1">
                <span className="block line-clamp-2 break-words text-caption font-medium">{item.title || t('inspector.outline.untitled')}</span>
                {item.summary ? <span className="mt-1 block line-clamp-2 break-words text-micro leading-relaxed text-muted-foreground">{item.summary}</span> : null}
                <span className="mt-2 flex min-w-0 items-center gap-2 text-micro text-muted-foreground">
                  <span className={cn('inline-flex items-center gap-1', item.status === 'error' && 'text-destructive', item.status === 'running' && 'text-foreground')}>
                    <StatusIcon className={cn('size-3', item.status === 'running' && 'animate-spin motion-reduce:animate-none')} aria-hidden />
                    {t(STATUS_KEYS[item.status])}
                  </span>
                  {time ? <time dateTime={timestamp === undefined ? undefined : new Date(timestamp).toISOString()} className="ml-auto shrink-0 tabular-nums">{time}</time> : null}
                </span>
              </span>
            </CommandItem>
          })}
        </CommandList>
      </Command>
    </PopoverContent>
  </Popover>
}
