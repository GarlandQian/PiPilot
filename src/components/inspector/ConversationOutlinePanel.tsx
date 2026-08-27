import * as React from 'react'
import {
  TbAlertCircle,
  TbBan,
  TbCheck,
  TbClock,
  TbLoader2,
  TbMessageCircle,
} from 'react-icons/tb'
import { useLocale, useT, type MessageKey } from '@/i18n'
import { cn } from '@/lib/utils'
import type {
  ConversationOutlineItem,
  ConversationOutlineStatus,
} from '@/types/chat'

const STATUS_KEYS: Record<ConversationOutlineStatus, MessageKey> = {
  pending: 'inspector.outline.status.pending',
  running: 'inspector.outline.status.running',
  complete: 'inspector.outline.status.complete',
  error: 'inspector.outline.status.error',
  aborted: 'inspector.outline.status.aborted',
}

function StatusIcon({ status }: { status: ConversationOutlineStatus }) {
  if (status === 'running') {
    return <TbLoader2 className="size-3 animate-spin motion-reduce:animate-none" aria-hidden />
  }
  if (status === 'complete') return <TbCheck className="size-3" aria-hidden />
  if (status === 'error') return <TbAlertCircle className="size-3" aria-hidden />
  if (status === 'aborted') return <TbBan className="size-3" aria-hidden />
  return <TbClock className="size-3" aria-hidden />
}

export function orderConversationOutlineItemsForDisplay(
  items: readonly ConversationOutlineItem[],
) {
  return [...items].reverse()
}

export function conversationOutlineFocusIndex(
  key: string,
  currentIndex: number,
  itemCount: number,
) {
  if (itemCount <= 0) return null
  if (key === 'ArrowUp') return Math.max(0, currentIndex - 1)
  if (key === 'ArrowDown') return Math.min(itemCount - 1, currentIndex + 1)
  if (key === 'Home') return 0
  if (key === 'End') return itemCount - 1
  return null
}

export function ConversationOutlinePanel({
  items,
  onNavigate,
}: {
  items: readonly ConversationOutlineItem[]
  onNavigate: (entryId: string) => void
}) {
  const t = useT()
  const locale = useLocale()
  const [selectedEntryId, setSelectedEntryId] = React.useState<string | null>(null)
  const buttonRefs = React.useRef<Array<HTMLButtonElement | null>>([])
  const displayItems = React.useMemo(
    () => orderConversationOutlineItemsForDisplay(items),
    [items],
  )
  const formatTime = React.useCallback((item: ConversationOutlineItem) => {
    if (item.timestamp === undefined) return item.time
    return new Intl.DateTimeFormat(locale, {
      hour: '2-digit',
      minute: '2-digit',
    }).format(item.timestamp)
  }, [locale])

  if (items.length === 0) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center px-5 text-center text-caption text-muted-foreground">
        <div className="max-w-56 space-y-2">
          <TbMessageCircle className="mx-auto size-5" aria-hidden />
          <p>{t('inspector.outline.empty')}</p>
        </div>
      </div>
    )
  }

  return (
    <nav
      className="scroll-slim h-full min-h-0 overflow-y-auto"
      aria-label={t('inspector.outline.label')}
    >
      <ol className="divide-y divide-border/60">
        {displayItems.map((item, index) => {
          const selected = item.entryId === selectedEntryId
          const status = t(STATUS_KEYS[item.status])
          const time = formatTime(item)
          return (
            <li key={item.entryId}>
              <button
                ref={(button) => {
                  buttonRefs.current[index] = button
                }}
                type="button"
                className={cn(
                  'w-full min-w-0 px-3 py-2.5 text-left outline-none transition-colors duration-(--duration-fast) hover:bg-accent/60 focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                  selected && 'bg-accent/70',
                )}
                aria-current={selected ? 'location' : undefined}
                onClick={() => {
                  setSelectedEntryId(item.entryId)
                  onNavigate(item.entryId)
                }}
                onKeyDown={(event) => {
                  const nextIndex = conversationOutlineFocusIndex(
                    event.key,
                    index,
                    displayItems.length,
                  )
                  if (nextIndex === null) return
                  event.preventDefault()
                  buttonRefs.current[nextIndex]?.focus()
                }}
              >
                <span className="line-clamp-2 break-words text-caption font-medium text-foreground">
                  {item.title || t('inspector.outline.untitled')}
                </span>
                {item.summary ? (
                  <span className="mt-1 line-clamp-2 break-words text-micro leading-relaxed text-muted-foreground">
                    {item.summary}
                  </span>
                ) : null}
                <span className="mt-1.5 flex min-w-0 items-center gap-1.5 text-micro text-muted-foreground">
                  <span className={cn(
                    'inline-flex items-center gap-1',
                    item.status === 'error' && 'text-destructive',
                    item.status === 'running' && 'text-foreground',
                  )}>
                    <StatusIcon status={item.status} />
                    {status}
                  </span>
                  {time ? <time className="ml-auto shrink-0 tabular-nums">{time}</time> : null}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
