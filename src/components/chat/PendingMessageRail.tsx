import * as React from 'react'
import {
  TbAlertTriangle,
  TbClock,
  TbGripVertical,
  TbLoader2,
  TbPencil,
  TbPhoto,
  TbPlayerPause,
  TbRoute,
  TbX,
} from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import {
  projectPendingRail,
  type ComposerQueueState,
  type PendingRailItem,
} from '@/renderer/composer/composer-controls'
import { useConversationOperationFeedback } from '@/renderer/composer/use-operation-feedback'
import { MarkdownContent } from './markdown/MarkdownContent'
import { PromptInlineMarkdown, PromptMarkdown } from './PromptMarkdown'
import { promptDisplaySummary } from '@/renderer/pi-rpc/prompt-presentation'

/** Rows shown before "N more"; the queue should not push the conversation away. */
const VISIBLE_ROWS = 3
const QUEUE_ITEM_MIME = 'application/x-pipilot-queued-message'

interface PendingMessageRailProps {
  operationOwnerKey: string
  queue: ComposerQueueState
  stopping?: boolean
  onPromoteFollowUp(itemId: string): Promise<void>
  onRemoveQueuedMessage(itemId: string): Promise<void>
  onMoveQueuedMessage(itemId: string, beforeItemId: string | null): Promise<void>
  /** Takes the message out of the queue and back into the input for editing. */
  onRetract(item: PendingRailItem): Promise<void>
  /** Takes every waiting message back into the input. */
  onRetractAll(): Promise<void>
  onResumeQueue(): Promise<void>
  onClearQueue(): Promise<void>
}

/** The full message, shown when a row is opened. */
export function PendingItemContent({ item }: { item: PendingRailItem }) {
  const t = useT()
  return (
    <div className="min-w-0">
      <div
        className="scroll-slim max-h-72 min-w-0 overflow-y-auto break-words text-caption leading-relaxed text-foreground [overflow-wrap:anywhere]"
        data-pending-message-text
      >
        <PromptMarkdown text={item.text || t('composer.pendingImagesOnly')} />
      </div>
      {item.images.length > 0 ? (
        <div className="mt-2 flex min-w-0 flex-wrap gap-2" data-queue-image-list>
          {item.images.map((image, index) => (
            <img
              key={`${image.mimeType}:${index}`}
              src={`data:${image.mimeType};base64,${image.data}`}
              alt={t('composer.queueImageAlt', { index: index + 1 })}
              className="max-h-40 max-w-full rounded-[8px] bg-surface-raised object-contain shadow-[0_0_0_0.5px_var(--color-border)]"
              data-queue-image
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function reorderable(item: PendingRailItem) {
  return item.kind === 'followUp' && item.canEdit && (item.status === 'queued' || item.status === 'frozen' || item.status === undefined)
}

function statusOf(item: PendingRailItem, paused: boolean) {
  if (item.status === 'unknown') return { Icon: TbAlertTriangle, key: 'composer.deliveryUnknown' as const, tone: 'text-warning' }
  // A steer handed to Pi is exactly "waiting for the next step".
  if (item.kind === 'steering' && item.status !== 'frozen' && !paused) return { Icon: TbRoute, key: 'composer.queueStatus.steering' as const, tone: 'text-primary' }
  if (item.status === 'delivering') return { Icon: TbLoader2, key: 'composer.deliveryHandedOff' as const, tone: 'animate-spin text-muted-foreground motion-reduce:animate-none' }
  if (item.status === 'frozen' || paused) return { Icon: TbPlayerPause, key: 'composer.queueStatus.frozen' as const, tone: 'text-muted-foreground' }
  return { Icon: TbClock, key: 'composer.queueStatus.queued' as const, tone: 'text-muted-foreground' }
}

/**
 * Messages sent while Pi replies, as Codex shows them: one quiet row each,
 * "Steer" to push one into the running reply, edit (back into the input) and
 * delete on hover, and drag to change the order they are sent in.
 */
export function PendingMessageRail({
  operationOwnerKey,
  queue,
  stopping = false,
  onPromoteFollowUp,
  onRemoveQueuedMessage,
  onMoveQueuedMessage,
  onRetract,
  onRetractAll,
  onResumeQueue,
  onClearQueue,
}: PendingMessageRailProps) {
  const t = useT()
  const [showAll, setShowAll] = React.useState(false)
  const [openId, setOpenId] = React.useState<string | null>(null)
  const [drag, setDrag] = React.useState<{ id: string; overId: string | null; after: boolean } | null>(null)
  const feedback = useConversationOperationFeedback(operationOwnerKey)
  const busy = Boolean(feedback.pending)
  const presentation = React.useMemo(() => projectPendingRail(queue), [queue])
  const paused = Boolean(queue.paused)

  React.useEffect(() => {
    if (presentation.items.length <= VISIBLE_ROWS) setShowAll(false)
  }, [presentation.items.length])

  if (!presentation.visible) return null

  const run = (key: string, operation: () => Promise<void>) => {
    void feedback.run(key, operation, t('composer.queueActionFailed'))
  }
  const movable = presentation.items.filter(reorderable)
  const move = (item: PendingRailItem, offset: -1 | 1) => {
    const index = movable.indexOf(item)
    const target = index + offset
    if (index < 0 || target < 0 || target >= movable.length) return
    // Moving down places it before the item after its new neighbour.
    const before = offset === -1 ? movable[target]!.id : movable[target + 1]?.id ?? null
    run(`move:${item.id}`, () => onMoveQueuedMessage(item.id, before))
  }
  const drop = (target: PendingRailItem, after: boolean, draggedId: string) => {
    const dragged = movable.find((item) => item.id === draggedId)
    if (!dragged || dragged.id === target.id) return
    const rest = movable.filter((item) => item !== dragged)
    const index = rest.indexOf(target)
    const before = after ? rest[index + 1]?.id ?? null : target.id
    run(`move:${dragged.id}`, () => onMoveQueuedMessage(dragged.id, before))
  }

  const visible = showAll ? presentation.items : presentation.items.slice(0, VISIBLE_ROWS)
  const hidden = presentation.items.length - visible.length
  const unknown = presentation.items.some((item) => item.status === 'unknown')
  const clearable = presentation.items.filter((item) => item.status === 'queued' || item.status === 'frozen').length
  const restorable = presentation.items.some((item) => item.canEdit && item.status !== 'delivering')

  return (
    <div data-pending-message-rail aria-busy={busy} className="min-w-0">
      {/* Only a queue that paused without your Stop (e.g. after a restart) waits
          here; Stop itself puts unsent messages back into the input. */}
      {paused ? (
        <div className="flex min-h-11 min-w-0 items-center gap-2 py-1.5 pr-3 pl-4" role="status">
          <TbPlayerPause className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-caption font-medium">
            {t('composer.queuePausedTitle', { count: presentation.count })}
          </span>
          {restorable ? (
            <Button type="button" variant="ghost" size="xs" disabled={busy || stopping} onClick={() => run('retract-all', onRetractAll)}>
              {t('composer.queueRestore')}
            </Button>
          ) : null}
          <Button
            type="button"
            size="xs"
            disabled={busy || stopping || unknown}
            title={unknown ? t('composer.queueResolveUnknown') : undefined}
            onClick={() => run('resume', onResumeQueue)}
          >
            {t(stopping ? 'composer.stopping' : 'composer.queueResume')}
          </Button>
        </div>
      ) : null}
      {presentation.items.length > 0 ? (
        <ol className={cn('min-w-0 divide-y divide-border', paused && 'border-t border-border', showAll && 'scroll-slim max-h-[min(280px,36vh)] overflow-y-auto')}>
          {visible.map((item) => {
            const status = statusOf(item, paused)
            const open = openId === item.id
            const canMove = reorderable(item) && movable.length > 1 && !busy
            const position = movable.indexOf(item)
            const summary = item.text.trim() || t('composer.pendingImagesOnly')
            const dropHere = drag && drag.overId === item.id && drag.id !== item.id
            return (
              <ContextMenu key={item.id}>
                <ContextMenuTrigger asChild>
                  <li
                    data-pending-message-id={item.id}
                    data-pending-message-status={item.status ?? 'queued'}
                    draggable={canMove}
                    onDragStart={(event) => {
                      event.dataTransfer.setData(QUEUE_ITEM_MIME, item.id)
                      event.dataTransfer.effectAllowed = 'move'
                      setDrag({ id: item.id, overId: null, after: false })
                    }}
                    onDragOver={(event) => {
                      if (!drag || !reorderable(item)) return
                      event.preventDefault()
                      const rect = event.currentTarget.getBoundingClientRect()
                      const after = event.clientY > rect.top + rect.height / 2
                      if (drag.overId !== item.id || drag.after !== after) setDrag({ ...drag, overId: item.id, after })
                    }}
                    onDrop={(event) => {
                      const draggedId = event.dataTransfer.getData(QUEUE_ITEM_MIME)
                      if (!draggedId) return
                      event.preventDefault()
                      drop(item, drag?.after ?? false, draggedId)
                      setDrag(null)
                    }}
                    onDragEnd={() => setDrag(null)}
                    className={cn(
                      'group/row relative min-w-0 focus-within:z-[1]',
                      drag?.id === item.id && 'opacity-50',
                      dropHere && (drag.after
                        ? 'after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 after:rounded-full after:bg-primary'
                        : 'before:absolute before:inset-x-3 before:-top-px before:h-0.5 before:rounded-full before:bg-primary'),
                    )}
                  >
                    <div className="flex min-h-10 min-w-0 items-center gap-1.5 py-1 pr-2 pl-1.5">
                      <span
                        aria-hidden
                        title={canMove ? t('composer.queueDragHandle') : undefined}
                        className={cn(
                          'grid size-5 shrink-0 place-items-center text-muted-foreground/70',
                          canMove ? 'cursor-grab opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 active:cursor-grabbing' : 'invisible',
                        )}
                      >
                        <TbGripVertical className="size-3.5" />
                      </span>
                      <status.Icon className={cn('size-3.5 shrink-0', status.tone)} aria-label={t(status.key)} />
                      <button
                        type="button"
                        aria-expanded={open}
                        data-pending-toggle
                        title={promptDisplaySummary(summary, (title) => t('taskContext.planKickoff', { title }))}
                        onClick={() => setOpenId(open ? null : item.id)}
                        className="flex min-h-7 min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 text-left outline-none focus-visible:focus-ring"
                      >
                        {item.kind === 'steering' || item.status === 'unknown' || item.status === 'delivering' ? (
                          <span className={cn('shrink-0 text-micro font-medium', item.kind === 'steering' && item.status !== 'unknown' ? 'text-primary' : 'text-muted-foreground')}>
                            {t(status.key)}
                          </span>
                        ) : null}
                        <span className="min-w-0 flex-1 truncate text-caption text-muted-foreground">
                          <PromptInlineMarkdown text={summary} />
                        </span>
                        {item.images.length > 0 ? (
                          <span className="flex shrink-0 items-center gap-0.5 text-micro tabular-nums text-muted-foreground">
                            <TbPhoto className="size-3.5" aria-hidden />
                            {item.images.length}
                          </span>
                        ) : null}
                      </button>
                      {item.kind === 'followUp' && item.canPromote && !paused ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          className="h-[26px] shrink-0 rounded-full px-2.5 text-caption text-primary hover:text-primary"
                          disabled={busy}
                          onClick={() => run(`promote:${item.id}`, () => onPromoteFollowUp(item.id))}
                        >
                          {t('composer.promoteToSteer')}
                        </Button>
                      ) : null}
                      <div className="flex shrink-0 items-center opacity-0 transition-opacity duration-(--duration-fast) group-hover/row:opacity-100 group-focus-within/row:opacity-100 motion-reduce:transition-none">
                        {item.canEdit ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button type="button" variant="ghost" size="icon-xs" className="rounded-full" disabled={busy} aria-label={t('composer.editPending')} onClick={() => run(`retract:${item.id}`, () => onRetract(item))}>
                                <TbPencil aria-hidden />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>{t('composer.editPending')}</TooltipContent>
                          </Tooltip>
                        ) : null}
                        {item.canRemove ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-xs"
                                className="rounded-full"
                                disabled={busy}
                                aria-label={t(item.status === 'unknown' ? 'composer.removeUnconfirmed' : 'composer.removePending')}
                                onClick={() => run(`remove:${item.id}`, () => onRemoveQueuedMessage(item.id))}
                              >
                                <TbX aria-hidden />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>{t(item.status === 'unknown' ? 'composer.removeUnconfirmed' : 'composer.removePending')}</TooltipContent>
                          </Tooltip>
                        ) : null}
                      </div>
                    </div>
                    {open ? (
                      <div className="pb-2.5 pr-4 pl-[52px]">
                        {item.status === 'unknown' ? <p className="mb-1.5 text-caption text-muted-foreground">{t('composer.queueUnconfirmedHint')}</p> : null}
                        <PendingItemContent item={item} />
                      </div>
                    ) : null}
                  </li>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem disabled={!canMove || position <= 0} onSelect={() => move(item, -1)}>{t('composer.queueMoveUp')}</ContextMenuItem>
                  <ContextMenuItem disabled={!canMove || position < 0 || position >= movable.length - 1} onSelect={() => move(item, 1)}>{t('composer.queueMoveDown')}</ContextMenuItem>
                  {item.kind === 'followUp' && item.canPromote && !paused ? <ContextMenuItem disabled={busy} onSelect={() => run(`promote:${item.id}`, () => onPromoteFollowUp(item.id))}>{t('composer.promoteToSteer')}</ContextMenuItem> : null}
                  {item.canEdit ? <ContextMenuItem disabled={busy} onSelect={() => run(`retract:${item.id}`, () => onRetract(item))}>{t('composer.editPending')}</ContextMenuItem> : null}
                  {item.canRemove ? <ContextMenuItem disabled={busy} onSelect={() => run(`remove:${item.id}`, () => onRemoveQueuedMessage(item.id))}>{t('composer.removePending')}</ContextMenuItem> : null}
                </ContextMenuContent>
              </ContextMenu>
            )
          })}
        </ol>
      ) : null}
      {presentation.count > presentation.items.length ? (
        <p className="border-t border-border py-2 pr-4 pl-4 text-caption text-muted-foreground">
          {t('composer.queueCountOnly', { count: presentation.count - presentation.items.length })}
        </p>
      ) : null}
      {hidden > 0 || showAll || clearable > 1 ? (
        <div className="flex min-h-9 min-w-0 items-center gap-2 border-t border-border py-1 pr-2 pl-3">
          {hidden > 0 || showAll ? (
            <Button type="button" variant="ghost" size="xs" className="text-muted-foreground" aria-expanded={showAll} onClick={() => setShowAll((value) => !value)}>
              {showAll ? t('composer.queueShowFewer') : t('composer.queueMore', { count: hidden })}
            </Button>
          ) : null}
          <span className="flex-1" />
          {clearable > 1 ? (
            <Button type="button" variant="ghost" size="xs" className="text-muted-foreground" disabled={busy} onClick={() => run('clear', onClearQueue)}>
              {t('composer.clearQueue')}
            </Button>
          ) : null}
        </div>
      ) : null}
      {feedback.error ? (
        <div role="alert" className="border-t border-border py-1.5 pr-3 pl-4 text-caption text-destructive">
          <MarkdownContent markdown={feedback.error} />
        </div>
      ) : null}
    </div>
  )
}
