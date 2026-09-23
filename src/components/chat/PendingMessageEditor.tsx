import * as React from 'react'
import { TbX } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useT } from '@/i18n'
import type { LocalPiImageContent } from '@/shared/local-pi'

/** Edits a captured message, never the current Composer draft. */
export function PendingMessageEditor({ text, images, busy, saveLabel, onSave, onCancel }: {
  text: string
  images: readonly LocalPiImageContent[]
  busy: boolean
  saveLabel?: string
  onSave(text: string, images: readonly LocalPiImageContent[]): void
  onCancel(): void
}) {
  const t = useT()
  const [value, setValue] = React.useState(text)
  const [keptImages, setKeptImages] = React.useState(images)
  return <div className="min-w-0 flex-1 space-y-2" data-pending-message-editor>
    <Textarea
      autoFocus
      value={value}
      onChange={(event) => setValue(event.target.value)}
      disabled={busy}
      aria-label={t('composer.editPending')}
      className="max-h-52 min-h-20 resize-y text-caption"
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
        if (event.key === 'Escape' && !busy) {
          event.preventDefault()
          onCancel()
        }
      }}
    />
    {keptImages.length > 0 ? <div className="flex flex-wrap gap-2">
      {keptImages.map((image, index) => <div key={index} className="relative">
        <img className="size-14 rounded-md border border-border object-contain" src={`data:${image.mimeType};base64,${image.data}`} alt={t('composer.queueImageAlt', { index: index + 1 })} />
        <Button type="button" variant="secondary" size="icon-xs" className="absolute -right-1 -top-1" disabled={busy} aria-label={t('composer.removePendingImage', { index: index + 1 })} onClick={() => setKeptImages((current) => current.filter((_, i) => i !== index))}><TbX aria-hidden /></Button>
      </div>)}
    </div> : null}
    <div className="flex justify-end gap-2">
      <Button type="button" variant="ghost" size="xs" disabled={busy} onClick={onCancel}>{t('composer.cancelEdit')}</Button>
      <Button type="button" size="xs" disabled={busy || (!value.trim() && !keptImages.length)} onClick={() => onSave(value, keptImages)}>{saveLabel ?? t('composer.savePending')}</Button>
    </div>
  </div>
}
