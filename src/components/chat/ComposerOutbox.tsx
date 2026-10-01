import * as React from 'react'
import { TbAlertCircle, TbAlertTriangle, TbLoader2, TbPencil, TbPhoto, TbX } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import type { DurableOutboxItem } from '@/renderer/composer/durable-outbox'
import { PromptInlineMarkdown, PromptMarkdown } from './PromptMarkdown'

/** A message on its way to Pi, in the same row style as the queue it joins. */
function OutboxMessage({ item, connected, onCheck, onRetry, onRemove, onRetract }: {
  item: DurableOutboxItem
  connected: boolean
  onCheck(item: DurableOutboxItem): Promise<void>
  onRetry(item: DurableOutboxItem): Promise<void>
  onRemove(item: DurableOutboxItem): Promise<void>
  onRetract(item: DurableOutboxItem): Promise<void>
}) {
  const t = useT()
  const [busy, setBusy] = React.useState(false)
  const [open, setOpen] = React.useState(false)
  const lock = React.useRef(false)
  const [error, setError] = React.useState<string | null>(null)
  const sending = item.status === 'pending' || item.status === 'sending'
  const unknown = item.status === 'unknown'
  const run = async (operation: () => Promise<void>) => {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError(null)
    try { await operation() } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('composer.queueActionFailed'))
    } finally { lock.current = false; setBusy(false) }
  }
  const label = t(sending ? 'composer.outboxSending' : item.status === 'failed' ? 'composer.outboxFailed' : 'composer.deliveryUnknown')
  const Icon = sending ? TbLoader2 : unknown ? TbAlertTriangle : TbAlertCircle
  const summary = item.text.trim() || t('composer.pendingImagesOnly')
  const detail = unknown ? t('composer.outboxUnconfirmedHint') : item.error
  return <li className="group/row min-w-0" data-outbox-message={item.id} data-outbox-status={item.status}>
    <div className="flex min-h-10 min-w-0 items-center gap-1.5 py-1 pr-2 pl-[26px]">
      <Icon className={cn('size-3.5 shrink-0', sending ? 'animate-spin text-muted-foreground motion-reduce:animate-none' : unknown ? 'text-warning' : 'text-destructive')} aria-hidden />
      <button
        type="button"
        aria-expanded={open}
        data-pending-toggle
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-7 min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 text-left outline-none focus-visible:focus-ring"
      >
        <span className={cn('shrink-0 text-micro font-medium', item.status === 'failed' ? 'text-destructive' : 'text-muted-foreground')}>{label}</span>
        <span className="min-w-0 flex-1 truncate text-caption text-muted-foreground"><PromptInlineMarkdown text={summary} /></span>
        {item.images.length ? <span className="flex shrink-0 items-center gap-0.5 text-micro tabular-nums text-muted-foreground"><TbPhoto className="size-3.5" aria-hidden />{item.images.length}</span> : null}
      </button>
      {unknown ? (
        <Button type="button" variant="ghost" size="xs" className="h-[26px] shrink-0 rounded-full px-2.5 text-caption text-primary hover:text-primary" disabled={busy || !connected} onClick={() => void run(() => onCheck(item))}>
          {t('composer.outboxCheck')}
        </Button>
      ) : item.status === 'failed' ? (
        <Button type="button" variant="ghost" size="xs" className="h-[26px] shrink-0 rounded-full px-2.5 text-caption text-primary hover:text-primary" disabled={busy || !connected} onClick={() => void run(() => onRetry(item))}>
          {t('composer.outboxRetry')}
        </Button>
      ) : null}
      {!sending ? (
        <div className="flex shrink-0 items-center opacity-0 transition-opacity duration-(--duration-fast) group-hover/row:opacity-100 group-focus-within/row:opacity-100 motion-reduce:transition-none">
          {item.status === 'failed' ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button type="button" variant="ghost" size="icon-xs" className="rounded-full" disabled={busy} aria-label={t('composer.editPending')} onClick={() => void run(() => onRetract(item))}><TbPencil aria-hidden /></Button>
              </TooltipTrigger>
              <TooltipContent>{t('composer.editPending')}</TooltipContent>
            </Tooltip>
          ) : null}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button type="button" variant="ghost" size="icon-xs" className="rounded-full" disabled={busy} aria-label={t(unknown ? 'composer.removeUnconfirmed' : 'composer.outboxRemove')} onClick={() => void run(() => onRemove(item))}><TbX aria-hidden /></Button>
            </TooltipTrigger>
            <TooltipContent>{t(unknown ? 'composer.removeUnconfirmed' : 'composer.outboxRemove')}</TooltipContent>
          </Tooltip>
        </div>
      ) : null}
    </div>
    {open ? <div className="pb-2.5 pr-4 pl-[52px]">
      {detail ? <p className="mb-1.5 break-words text-caption text-muted-foreground [overflow-wrap:anywhere]">{detail}</p> : null}
      <div className="scroll-slim max-h-40 min-w-0 overflow-y-auto text-caption"><PromptMarkdown text={summary} /></div>
      {item.images.length ? <div className="mt-2 flex flex-wrap gap-2">{item.images.map((image, index) => <img key={index} src={`data:${image.mimeType};base64,${image.data}`} alt={t('composer.queueImageAlt', { index: index + 1 })} className="size-12 rounded-[10px] object-contain shadow-[0_0_0_0.5px_var(--color-border)]" />)}</div> : null}
    </div> : null}
    {error ? <p className="pb-2 pr-4 pl-[52px] text-caption text-destructive" role="alert">{error}</p> : null}
  </li>
}

export function ComposerOutbox({ items, storageError, ...actions }: {
  items: readonly DurableOutboxItem[]
  storageError: string | null
  connected: boolean
  onCheck(item: DurableOutboxItem): Promise<void>
  onRetry(item: DurableOutboxItem): Promise<void>
  onRemove(item: DurableOutboxItem): Promise<void>
  /** Takes a failed message back into the input for editing. */
  onRetract(item: DurableOutboxItem): Promise<void>
}) {
  const t = useT()
  if (!items.length && !storageError) return null
  return <section className="min-w-0" aria-label={t('composer.outboxLabel')} data-composer-outbox>
    <ol className="scroll-slim max-h-[min(240px,30vh)] min-w-0 divide-y divide-border overflow-y-auto">{items.map((item) => <OutboxMessage key={item.id} item={item} {...actions} />)}</ol>
    {storageError ? <p className="border-t border-border py-2 pr-4 pl-4 text-caption text-destructive" role="alert">{storageError}</p> : null}
  </section>
}
