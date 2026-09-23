import * as React from 'react'
import {
  TbChevronDown,
  TbDots,
  TbListDetails,
  TbLoader2,
  TbPhoto,
  TbPencil,
  TbPlayerPlay,
  TbRoute,
  TbTrash,
  TbX,
} from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import {
  projectPendingRail,
  type ComposerQueueState,
  type PendingRailItem,
} from '@/renderer/composer/composer-controls'
import { useConversationOperationFeedback } from '@/renderer/composer/use-operation-feedback'
import type { LocalPiImageContent } from '@/shared/local-pi'
import { PendingMessageEditor } from './PendingMessageEditor'
import { MarkdownContent } from './markdown/MarkdownContent'
import { PromptInlineMarkdown, PromptMarkdown } from './PromptMarkdown'
import { parsePromptSkillEnvelope, promptDisplaySummary } from '@/renderer/pi-rpc/prompt-presentation'

interface PendingMessageRailProps {
  operationOwnerKey: string
  queue: ComposerQueueState
  stopping?: boolean
  onPromoteFollowUp(itemId: string): Promise<void>
  onRemoveQueuedMessage(itemId: string): Promise<void>
  onEditQueuedMessage(itemId: string, text: string, images?: readonly LocalPiImageContent[], expectedRevision?: number): Promise<void>
  onResumeQueue(): Promise<void>
  onClearQueue(): Promise<void>
}

function PendingImages({ item, expanded }: { item: PendingRailItem; expanded: boolean }) {
  const t = useT()
  if (item.images.length === 0) return null
  return (
    <div className={cn('mt-2 flex min-w-0 flex-wrap gap-2', expanded && 'flex-col')} data-queue-image-list>
      {item.images.map((image, index) => (
        <img
          key={`${image.mimeType}:${index}`}
          src={`data:${image.mimeType};base64,${image.data}`}
          alt={t('composer.queueImageAlt', { index: index + 1 })}
          className={cn(
            'shrink-0 rounded-md border border-border bg-background object-contain',
            expanded ? 'max-h-60 max-w-full self-start' : 'size-12',
          )}
          data-queue-image
        />
      ))}
    </div>
  )
}

export function PendingItemContent({ item }: { item: PendingRailItem }) {
  const t = useT()
  const [expanded, setExpanded] = React.useState(false)
  const contentId = React.useId()
  const message = parsePromptSkillEnvelope(item.text)?.userMessage ?? item.text
  const canExpand = message.length > 240 || message.split('\n').length > 3 || item.images.length > 0
  return (
    <div className="min-w-0 flex-1">
      <span className="text-micro font-medium text-muted-foreground">
        {t(item.status === 'unknown' ? 'composer.deliveryUnknown' : item.status === 'delivering' ? 'composer.deliveryHandedOff' : item.status === 'frozen' ? 'composer.queuePaused' : item.kind === 'steering' ? 'composer.steering' : 'composer.followUp')}
      </span>
      <div id={contentId} className={cn('min-w-0', expanded && 'scroll-slim max-h-72 overflow-y-auto')}>
        <div
          className="mt-1 min-w-0 break-words text-caption leading-relaxed text-foreground [overflow-wrap:anywhere]"
          data-pending-message-text
          data-expanded={expanded}
        >
          <PromptMarkdown text={item.text || t('composer.pendingImagesOnly')} compact={!expanded && canExpand} />
        </div>
        <PendingImages item={item} expanded={expanded} />
      </div>
      {canExpand ? (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="mt-1 -ml-2 text-muted-foreground"
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={() => setExpanded((current) => !current)}
        >
          <TbChevronDown className={cn('size-3.5', expanded && 'rotate-180')} aria-hidden />
          {t(expanded ? 'composer.pendingMessageCollapse' : 'composer.pendingMessageExpand')}
        </Button>
      ) : null}
    </div>
  )
}

function PendingItemActions({
  item,
  busy,
  onPromote,
  onRemove,
  onEdit,
}: {
  item: PendingRailItem
  busy: boolean
  onPromote(itemId: string): void
  onRemove(itemId: string): void
  onEdit(itemId: string): void
}) {
  const t = useT()
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      {item.canEdit ? <Button type="button" variant="ghost" size="icon-xs" disabled={busy} aria-label={t('composer.editPending')} onClick={() => onEdit(item.id)}><TbPencil aria-hidden /></Button> : null}
      {item.kind === 'followUp' && item.canPromote ? (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="h-7 px-2 text-caption"
          disabled={busy}
          onClick={() => onPromote(item.id)}
        >
          <TbRoute aria-hidden />
          {t('composer.promoteToSteer')}
        </Button>
      ) : null}
      {item.canRemove ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              disabled={busy}
              aria-label={t(item.status === 'unknown' ? 'composer.removeUnconfirmed' : 'composer.removePending')}
              onClick={() => onRemove(item.id)}
            >
              <TbTrash aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t(item.status === 'unknown' ? 'composer.removeUnconfirmed' : 'composer.removePending')}</TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  )
}

export function PendingMessageRail({
  operationOwnerKey,
  queue,
  stopping = false,
  onPromoteFollowUp,
  onRemoveQueuedMessage,
  onEditQueuedMessage,
  onResumeQueue,
  onClearQueue,
}: PendingMessageRailProps) {
  const t = useT()
  const [expanded, setExpanded] = React.useState(false)
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [editNotice, setEditNotice] = React.useState(false)
  const editingRevision = React.useRef<number | undefined>(undefined)
  const feedback = useConversationOperationFeedback(operationOwnerKey)
  const busyAction = feedback.pending?.action ?? null
  const presentation = React.useMemo(() => projectPendingRail(queue), [queue])

  React.useEffect(() => {
    if (editingId && !presentation.items.some((item) => item.id === editingId && item.canEdit)) {
      setEditingId(null)
      setEditNotice(true)
    }
  }, [editingId, presentation.items])

  React.useEffect(() => {
    if (queue.paused) setExpanded(true)
  }, [queue.paused])

  React.useEffect(() => {
    if (!presentation.visible) {
      setExpanded(false)
    }
  }, [presentation.visible])

  const editNoticeContent = editNotice ? <div className="flex items-center gap-2 px-3 py-2 text-caption text-muted-foreground" role="status">
    <span className="min-w-0 flex-1">{t('composer.pendingEditEnded')}</span>
    <Button type="button" variant="ghost" size="icon-xs" aria-label={t('composer.dismissNotice')} onClick={() => setEditNotice(false)}><TbX aria-hidden /></Button>
  </div> : null
  if (!presentation.visible) return editNoticeContent

  const run = (key: string, operation: () => Promise<void>) => {
    void feedback.run(key, operation, t('composer.queueActionFailed'))
  }

  const promote = (itemId: string) => {
    run(`promote:${itemId}`, () => onPromoteFollowUp(itemId))
  }
  const remove = (itemId: string) => {
    run(`remove:${itemId}`, () => onRemoveQueuedMessage(itemId))
  }
  const edit = (itemId: string) => {
    setEditNotice(false)
    editingRevision.current = queue.revision
    setExpanded(true)
    setEditingId(itemId)
  }

  const next = presentation.items[0]
  const nextSummary = presentation.detailsKnown
    ? (presentation.nextText?.trim() || t('composer.pendingImagesOnly'))
    : t('composer.queueCountOnly', { count: presentation.count })

  return (
    <Collapsible
      open={expanded}
      onOpenChange={setExpanded}
      data-pending-message-rail
      aria-busy={Boolean(busyAction)}
      className="min-w-0 overflow-hidden rounded-t-(--radius-composer) border border-b-0 border-border/70 bg-muted/60"
    >
      <div className="flex min-h-11 min-w-0 items-center gap-1 px-3">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 text-left outline-none transition-colors duration-(--duration-fast) hover:bg-accent/40 focus-visible:focus-ring motion-reduce:transition-none"
            aria-label={expanded ? t('composer.pendingCollapse') : t('composer.pendingExpand')}
          >
            {busyAction
              ? <TbLoader2 className="size-4 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden />
              : <TbListDetails className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
            <span className="shrink-0 text-caption font-medium tabular-nums text-foreground">
              {t(queue.paused ? 'composer.pendingPausedCount' : 'composer.pendingCount', { count: presentation.count })}
            </span>
            <span className="min-w-0 flex-1 truncate text-caption text-muted-foreground" title={promptDisplaySummary(nextSummary)}>
              <PromptInlineMarkdown text={nextSummary} />
            </span>
            {presentation.nextImageCount > 0 ? (
              <span className="flex shrink-0 items-center gap-1 text-micro tabular-nums text-muted-foreground">
                <TbPhoto aria-hidden />
                {presentation.nextImageCount}
              </span>
            ) : null}
            <TbChevronDown
              className={cn(
                'size-3.5 shrink-0 text-muted-foreground transition-transform duration-(--duration-fast) motion-reduce:transition-none',
                expanded && 'rotate-180',
              )}
              aria-hidden
            />
          </button>
        </CollapsibleTrigger>

        {!expanded && next ? (
          <PendingItemActions
            item={next}
            busy={Boolean(busyAction)}
            onPromote={promote}
            onRemove={remove}
            onEdit={edit}
          />
        ) : null}

        {queue.paused ? <Button type="button" variant="ghost" size="xs" disabled={Boolean(busyAction) || stopping} onClick={() => run('resume', onResumeQueue)}><TbPlayerPlay aria-hidden />{t(stopping ? 'composer.stopping' : 'composer.resumeQueue')}</Button> : null}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={t('composer.pendingMore')}
            >
              <TbDots aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" collisionPadding={12}>
            <DropdownMenuItem onSelect={() => setExpanded((current) => !current)}>
              <TbChevronDown className={cn(expanded && 'rotate-180')} aria-hidden />
              {expanded ? t('composer.pendingCollapse') : t('composer.pendingExpand')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={Boolean(busyAction) || !presentation.items.some((item) => item.status === 'queued' || item.status === 'frozen')} onSelect={() => run('clear', onClearQueue)}>
              <TbTrash aria-hidden />{t('composer.clearQueue')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <CollapsibleContent>
        <div className="border-t border-border px-2 pb-2 pt-1.5">
          {presentation.items.some((item) => item.status === 'unknown') ? <p className="px-1 py-2 text-caption text-muted-foreground">{t('composer.queueUnconfirmedHint')}</p> : null}
          {presentation.items.length > 0 ? (
            <ol className="scroll-slim max-h-[min(320px,40vh)] divide-y divide-border overflow-y-auto">
              {presentation.items.map((item) => (
                <li key={item.id} data-pending-message-id={item.id} className="flex min-w-0 items-start gap-3 px-1 py-2.5">
                  {editingId === item.id ? <PendingMessageEditor
                    text={item.text}
                    images={item.images}
                    busy={Boolean(busyAction)}
                    onCancel={() => setEditingId(null)}
                    onSave={(text, images) => {
                      void feedback.run(`edit:${item.id}`, async (isCurrent) => {
                        await onEditQueuedMessage(item.id, text, images, editingRevision.current)
                        if (isCurrent()) setEditingId(null)
                      }, t('composer.queueActionFailed'))
                    }}
                  /> : <>
                  <PendingItemContent item={item} />
                  <PendingItemActions
                    item={item}
                    busy={Boolean(busyAction)}
                    onPromote={promote}
                    onRemove={remove}
                    onEdit={edit}
                  />
                  </>}
                </li>
              ))}
            </ol>
          ) : (
            <p className="py-1 text-caption text-muted-foreground">
              {t(queue.paused && presentation.count === 0 ? 'composer.queuePausedHint' : 'composer.queueCountOnly', { count: presentation.count })}
            </p>
          )}
          {presentation.items.length > 0 && presentation.count > presentation.items.length ? <p className="py-1 text-caption text-muted-foreground">{t('composer.queueCountOnly', { count: presentation.count - presentation.items.length })}</p> : null}
        </div>
      </CollapsibleContent>

      {feedback.error ? (
        <div role="alert" className="border-t border-border px-3 py-1.5 text-caption text-destructive">
          <MarkdownContent markdown={feedback.error} />
        </div>
      ) : null}
      {editNoticeContent}
    </Collapsible>
  )
}
