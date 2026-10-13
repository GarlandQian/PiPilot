import * as React from 'react'
import { TbAlertCircle, TbArrowUpRight, TbBan, TbBookmark, TbBookmarkFilled, TbCheck, TbClock, TbLoader2 } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { useT, type MessageKey } from '@/i18n'
import { cn } from '@/lib/utils'
import { conversationNavigationFocusIndex } from './conversation-navigation'
import {
  conversationRailBookmarkTitle,
  conversationRailPreview,
  conversationRailReadingEntry,
  type ConversationRailItem,
} from './conversation-rail'
import { MarkdownContent } from './markdown/MarkdownContent'

const STATUS_KEYS: Record<ConversationRailItem['status'], MessageKey> = {
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

export interface ConversationRailProps {
  items: readonly ConversationRailItem[]
  ownerKey: string
  scrollRef: React.RefObject<HTMLDivElement | null>
  anchorNodes: ReadonlyMap<string, HTMLDivElement>
  onNavigate(entryId: string): void
  onBookmark?: (entryId: string, label: string | null) => Promise<void>
}

/** A conversation owns its preview, keyboard focus and pending bookmark feedback. */
export function ConversationRail({ ownerKey, ...props }: ConversationRailProps) {
  return <SessionConversationRail key={ownerKey} {...props} />
}

function SessionConversationRail({ items, scrollRef, anchorNodes, onNavigate, onBookmark }: Omit<ConversationRailProps, 'ownerKey'>) {
  const t = useT()
  const previewId = React.useId()
  const previewTitleId = React.useId()
  const navRef = React.useRef<HTMLElement>(null)
  const tickScrollerRef = React.useRef<HTMLDivElement>(null)
  const previewRef = React.useRef<HTMLDivElement>(null)
  const tickNodes = React.useRef(new Map<string, HTMLButtonElement>())
  const mounted = React.useRef(true)
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const bookmarkInFlight = React.useRef(false)
  const [readingEntryId, setReadingEntryId] = React.useState<string | null>(null)
  const [focusEntryId, setFocusEntryId] = React.useState<string | null>(null)
  const [previewEntryId, setPreviewEntryId] = React.useState<string | null>(null)
  const previewEntryRef = React.useRef(previewEntryId)
  previewEntryRef.current = previewEntryId
  const [busyEntryId, setBusyEntryId] = React.useState<string | null>(null)
  const [bookmarkError, setBookmarkError] = React.useState<string | null>(null)

  const currentId = items.some((item) => item.entryId === readingEntryId) ? readingEntryId : items[0]?.entryId
  const tabEntryId = items.some((item) => item.entryId === focusEntryId) ? focusEntryId : currentId
  const preview = items.find((item) => item.entryId === previewEntryId)
  const excerpt = React.useMemo(() => conversationRailPreview(preview?.markdown ?? ''), [preview?.markdown])
  const virtualAnchor = React.useMemo(() => ({ current: preview ? tickNodes.current.get(preview.entryId) ?? null : null }), [preview])
  // Body/status deltas do not change which anchors the viewport observes.
  const entryIdsKey = JSON.stringify(items.map((item) => item.entryId))

  const cancelClose = React.useCallback(() => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current)
    closeTimer.current = null
  }, [])

  const scheduleClose = React.useCallback(() => {
    cancelClose()
    closeTimer.current = setTimeout(() => {
      const focused = document.activeElement
      const previewTick = previewEntryRef.current ? tickNodes.current.get(previewEntryRef.current) : null
      if (focused === previewTick || previewRef.current?.contains(focused)) return
      setPreviewEntryId(null)
    }, 180)
  }, [cancelClose])

  React.useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      cancelClose()
    }
  }, [cancelClose])

  // Observe the existing viewport. This effect never writes its scroll position.
  React.useEffect(() => {
    const viewport = scrollRef.current
    if (!viewport) return
    const entryIds = JSON.parse(entryIdsKey) as string[]
    let frame = 0
    const measure = () => {
      frame = 0
      const bounds = viewport.getBoundingClientRect()
      const toolbarInset = Number.parseFloat(getComputedStyle(viewport).scrollPaddingTop) || 12
      const positions = entryIds.flatMap((entryId) => {
        const node = anchorNodes.get(entryId)
        return node?.isConnected ? [{ entryId, top: node.getBoundingClientRect().top }] : []
      })
      const atBottom = viewport.scrollHeight > viewport.clientHeight + 2
        && viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 3
      setReadingEntryId(conversationRailReadingEntry(positions, bounds.top + toolbarInset + 12, atBottom))
    }
    const queueMeasure = () => {
      if (!frame) frame = requestAnimationFrame(measure)
    }
    queueMeasure()
    viewport.addEventListener('scroll', queueMeasure, { passive: true })
    const observer = new ResizeObserver(queueMeasure)
    observer.observe(viewport)
    if (viewport.firstElementChild) observer.observe(viewport.firstElementChild)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      viewport.removeEventListener('scroll', queueMeasure)
      observer.disconnect()
    }
  }, [entryIdsKey, scrollRef, anchorNodes])

  const revealTick = React.useCallback((entryId: string) => {
    const scroller = tickScrollerRef.current
    const tick = tickNodes.current.get(entryId)
    if (!scroller || !tick) return
    const bounds = scroller.getBoundingClientRect()
    const tickBounds = tick.getBoundingClientRect()
    if (tickBounds.top < bounds.top) scroller.scrollTop -= bounds.top - tickBounds.top
    else if (tickBounds.bottom > bounds.bottom) scroller.scrollTop += tickBounds.bottom - bounds.bottom
  }, [])

  React.useEffect(() => {
    // Keep the reading marker visible without fighting someone browsing the rail.
    if (currentId && !previewEntryId && !navRef.current?.contains(document.activeElement)) revealTick(currentId)
  }, [currentId, previewEntryId, revealTick])

  const showPreview = (entryId: string) => {
    cancelClose()
    setPreviewEntryId(entryId)
  }
  const navigate = (entryId: string) => {
    if (!items.some((item) => item.entryId === entryId)) return
    cancelClose()
    tickNodes.current.get(entryId)?.focus({ preventScroll: true })
    setPreviewEntryId(null)
    onNavigate(entryId)
  }
  const toggleBookmark = async (item: ConversationRailItem) => {
    if (!onBookmark || bookmarkInFlight.current) return
    bookmarkInFlight.current = true
    setBusyEntryId(item.entryId)
    setBookmarkError(null)
    try {
      await onBookmark(item.entryId, item.label?.trim() ? null : conversationRailBookmarkTitle(item.title, t('inspector.outline.untitled')))
    } catch {
      if (mounted.current) setBookmarkError(item.entryId)
    } finally {
      if (mounted.current) {
        bookmarkInFlight.current = false
        setBusyEntryId(null)
      }
    }
  }

  if (!items.length) return null
  const StatusIcon = preview ? STATUS_ICONS[preview.status] : TbClock
  const bookmarked = Boolean(preview?.label?.trim())

  return <Popover open={Boolean(preview)} onOpenChange={(open) => { if (!open) setPreviewEntryId(null) }}>
    <PopoverAnchor virtualRef={virtualAnchor} />
    <nav
      ref={navRef}
      aria-label={t('conversationRail.label')}
      data-conversation-rail
      className="app-no-drag pointer-events-none absolute bottom-4 left-1 top-[calc(var(--toolbar-inset,0px)+20px)] z-20 flex w-7 flex-col"
      onPointerLeave={scheduleClose}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget) && !previewRef.current?.contains(event.relatedTarget)) scheduleClose()
      }}
    >
      <div ref={tickScrollerRef} className="pointer-events-auto min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((item, index) => <button
          key={item.entryId}
          ref={(node) => {
            if (node) tickNodes.current.set(item.entryId, node)
            else tickNodes.current.delete(item.entryId)
          }}
          type="button"
          data-conversation-rail-entry={item.entryId}
          data-bookmarked={Boolean(item.label?.trim()) || undefined}
          aria-label={t('conversationRail.turn', { number: index + 1, title: item.title || t('inspector.outline.untitled') })}
          aria-current={item.entryId === currentId ? 'location' : undefined}
          aria-haspopup="dialog"
          aria-expanded={item.entryId === previewEntryId}
          aria-controls={item.entryId === previewEntryId ? previewId : undefined}
          tabIndex={item.entryId === tabEntryId ? 0 : -1}
          className="group/tick relative flex h-5 w-7 shrink-0 items-center justify-center rounded-sm outline-none focus-visible:focus-ring"
          onPointerEnter={() => showPreview(item.entryId)}
          onFocus={() => { setFocusEntryId(item.entryId); showPreview(item.entryId) }}
          onClick={() => navigate(item.entryId)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return
            const next = conversationNavigationFocusIndex(event.key, index, items.length)
            if (next !== null) {
              event.preventDefault()
              event.stopPropagation()
              revealTick(items[next].entryId)
              showPreview(items[next].entryId)
              tickNodes.current.get(items[next].entryId)?.focus({ preventScroll: true })
            } else if (event.key === 'Tab' && !event.shiftKey && previewEntryId === item.entryId) {
              const action = previewRef.current?.querySelector<HTMLButtonElement>('[data-conversation-rail-jump]')
              if (action) { event.preventDefault(); action.focus({ preventScroll: true }) }
            } else if (event.key === 'Escape') {
              event.preventDefault()
              setPreviewEntryId(null)
            }
          }}
        >
          <span aria-hidden className={cn(
            'h-[2px] w-2.5 rounded-full bg-muted-foreground/35 transition-[width,background-color] duration-150 group-hover/tick:w-[18px] group-hover/tick:bg-foreground/70 group-focus-visible/tick:w-[18px] motion-reduce:transition-none',
            item.label?.trim() && 'w-3.5 bg-primary/70',
            item.entryId === currentId && 'w-5 bg-foreground',
          )} />
        </button>)}
      </div>
    </nav>
    {preview ? <PopoverContent
      ref={previewRef}
      id={previewId}
      aria-labelledby={previewTitleId}
      data-conversation-rail-preview={preview.entryId}
      side="right"
      align="start"
      sideOffset={8}
      collisionPadding={16}
      className="flex max-h-[min(440px,var(--radix-popover-content-available-height))] w-[min(360px,calc(100vw-40px))] flex-col overflow-hidden p-0"
      onOpenAutoFocus={(event) => event.preventDefault()}
      onCloseAutoFocus={(event) => event.preventDefault()}
      onInteractOutside={(event) => {
        const target = event.detail.originalEvent.target
        if (target instanceof Node && navRef.current?.contains(target)) event.preventDefault()
      }}
      onPointerEnter={cancelClose}
      onPointerLeave={scheduleClose}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget) && !navRef.current?.contains(event.relatedTarget)) scheduleClose()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          const tick = tickNodes.current.get(preview.entryId)
          tick?.focus({ preventScroll: true })
          setPreviewEntryId(null)
        }
      }}
    >
      <div className="shrink-0 space-y-1.5 px-4 pt-3.5 pb-2.5">
        <span className="sr-only">{t('conversationRail.preview')}</span>
        <p id={previewTitleId} className="line-clamp-3 break-words text-caption font-medium leading-relaxed">{preview.title || t('inspector.outline.untitled')}</p>
        {bookmarked ? <p className="flex min-w-0 items-center gap-1.5 text-micro text-primary"><TbBookmarkFilled className="size-3 shrink-0" aria-hidden /><span className="truncate">{preview.label}</span><span className="sr-only">{t('conversationRail.bookmarked')}</span></p> : null}
      </div>
      <div className="scroll-slim min-h-0 overflow-y-auto overscroll-contain px-4 pb-3 text-caption">
        {excerpt.markdown ? <div data-conversation-rail-markdown className="[&_.md-body]:text-caption [&_.md-body]:leading-relaxed [&_.md-body>:first-child]:mt-0 [&_.md-body>:last-child]:mb-0">
          <MarkdownContent markdown={excerpt.markdown} streaming={preview.status === 'running'} />
          {excerpt.truncated ? <p aria-hidden className="mt-1 text-muted-foreground">…</p> : null}
        </div> : <p data-conversation-rail-status className={cn('flex items-center gap-1.5 py-2 text-muted-foreground', preview.status === 'error' && 'text-destructive')}>
          <StatusIcon className={cn('size-3.5', preview.status === 'running' && 'animate-spin motion-reduce:animate-none')} aria-hidden />
          {t(STATUS_KEYS[preview.status])}
        </p>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-t border-border px-2 py-2">
        <Button variant="ghost" size="xs" data-conversation-rail-jump onClick={() => navigate(preview.entryId)}>
          <TbArrowUpRight aria-hidden />{t('conversationRail.jump')}
        </Button>
        {onBookmark ? <Button variant="ghost" size="xs" className="ml-auto" disabled={busyEntryId !== null} aria-pressed={bookmarked} onClick={() => void toggleBookmark(preview)}>
          {busyEntryId === preview.entryId ? <TbLoader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : bookmarked ? <TbBookmarkFilled aria-hidden /> : <TbBookmark aria-hidden />}
          {t(bookmarked ? 'conversationRail.removeBookmark' : 'conversationRail.bookmark')}
        </Button> : null}
      </div>
      {bookmarkError === preview.entryId ? <p role="alert" className="px-4 pb-3 text-caption text-destructive">{t('conversationRail.bookmarkFailed')}</p> : null}
    </PopoverContent> : null}
  </Popover>
}
