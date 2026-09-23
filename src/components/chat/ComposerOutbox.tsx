import * as React from 'react'
import { TbAlertCircle, TbLoader2, TbPencil, TbRefresh, TbTrash } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n'
import type { DurableOutboxItem } from '@/renderer/composer/durable-outbox'
import type { LocalPiImageContent } from '@/shared/local-pi'
import { PendingMessageEditor } from './PendingMessageEditor'
import { PromptMarkdown } from './PromptMarkdown'

function OutboxMessage({ item, connected, onCheck, onRetry, onRemove }: {
  item: DurableOutboxItem
  connected: boolean
  onCheck(item: DurableOutboxItem): Promise<void>
  onRetry(item: DurableOutboxItem, text?: string, images?: readonly LocalPiImageContent[]): Promise<void>
  onRemove(item: DurableOutboxItem): Promise<void>
}) {
  const t = useT()
  const [editing, setEditing] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const lock = React.useRef(false)
  const [error, setError] = React.useState<string | null>(null)
  const sending = item.status === 'pending' || item.status === 'sending'
  const run = async (operation: () => Promise<void>) => {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError(null)
    try { await operation() } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('composer.queueActionFailed'))
    } finally { lock.current = false; setBusy(false) }
  }
  return <li className="min-w-0 py-3" data-outbox-message={item.id} data-outbox-status={item.status}>
    <div className="mb-1.5 flex items-center gap-2 text-caption text-muted-foreground" role="status">
      {sending ? <TbLoader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> : <TbAlertCircle className="size-3.5" aria-hidden />}
      {t(sending ? 'composer.outboxSending' : item.status === 'failed' ? 'composer.outboxFailed' : 'composer.deliveryUnknown')}
    </div>
    {editing ? <PendingMessageEditor
      text={item.text} images={item.images} busy={busy} onCancel={() => setEditing(false)}
      saveLabel={t('composer.outboxSaveRetry')}
      onSave={(text, images) => { void run(() => onRetry(item, text, images)) }}
    /> : <>
      <div className="scroll-slim max-h-40 min-w-0 overflow-y-auto text-caption"><PromptMarkdown text={item.text || t('composer.pendingImagesOnly')} /></div>
      {item.images.length ? <div className="mt-2 flex flex-wrap gap-2">{item.images.map((image, index) => <img key={index} src={`data:${image.mimeType};base64,${image.data}`} alt={t('composer.queueImageAlt', { index: index + 1 })} className="size-12 rounded-md border border-border object-contain" />)}</div> : null}
      {item.error || item.status === 'unknown' ? <p className="mt-2 break-words text-caption text-muted-foreground [overflow-wrap:anywhere]">{item.status === 'unknown' ? t('composer.outboxUnconfirmedHint') : item.error}</p> : null}
      {!sending ? <div className="mt-2 flex flex-wrap items-center gap-1">
        {item.status === 'unknown' ? <Button type="button" variant="outline" size="xs" disabled={busy || !connected} onClick={() => void run(() => onCheck(item))}><TbRefresh aria-hidden />{t('composer.outboxCheck')}</Button> : <>
          <Button type="button" variant="outline" size="xs" disabled={busy || !connected} onClick={() => void run(() => onRetry(item))}><TbRefresh aria-hidden />{t('composer.outboxRetry')}</Button>
          <Button type="button" variant="ghost" size="xs" disabled={busy || !connected} onClick={() => setEditing(true)}><TbPencil aria-hidden />{t('composer.editPending')}</Button>
          <Button type="button" variant="ghost" size="icon-xs" disabled={busy} aria-label={t('composer.outboxRemove')} onClick={() => void run(() => onRemove(item))}><TbTrash aria-hidden /></Button>
        </>}
      </div> : null}
    </>}
    {error ? <p className="mt-2 text-caption text-destructive" role="alert">{error}</p> : null}
  </li>
}

export function ComposerOutbox({ items, storageError, ...actions }: {
  items: readonly DurableOutboxItem[]
  storageError: string | null
  connected: boolean
  onCheck(item: DurableOutboxItem): Promise<void>
  onRetry(item: DurableOutboxItem, text?: string, images?: readonly LocalPiImageContent[]): Promise<void>
  onRemove(item: DurableOutboxItem): Promise<void>
}) {
  const t = useT()
  if (!items.length && !storageError) return null
  return <section className="mb-2 min-w-0 rounded-lg border border-border bg-muted/40 px-3" aria-label={t('composer.outboxLabel')} data-composer-outbox>
    <ol className="scroll-slim max-h-[min(280px,32vh)] divide-y divide-border overflow-y-auto">{items.map((item) => <OutboxMessage key={item.id} item={item} {...actions} />)}</ol>
    {storageError ? <p className="py-2 text-caption text-destructive" role="alert">{storageError}</p> : null}
  </section>
}
