import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { MarkdownContent } from './markdown/MarkdownContent'
import { InlineMarkdown } from './markdown/InlineMarkdown'
import { useT } from '@/i18n'
import { SettingsSheet } from '@/components/settings/kit'
import type {
  LocalPiExtensionUiRequest,
  LocalPiExtensionUiResponse,
} from '@/shared/local-pi'

type ExtensionDialogRequest = Extract<
  LocalPiExtensionUiRequest,
  { method: 'select' | 'confirm' | 'input' | 'editor' }
>

interface ExtensionUiDialogProps {
  request: ExtensionDialogRequest | null
  busy?: boolean
  onRespond(response: LocalPiExtensionUiResponse): void | Promise<void>
}

export function ExtensionUiDialog({
  request,
  busy = false,
  onRespond,
}: ExtensionUiDialogProps) {
  const t = useT()
  const [value, setValue] = React.useState('')

  React.useEffect(() => {
    if (!request) return
    setValue(request.method === 'editor' ? request.prefill ?? '' : '')
  }, [request])

  const respond = React.useCallback((response: LocalPiExtensionUiResponse) => {
    if (busy) return
    void onRespond(response)
  }, [busy, onRespond])

  if (!request) return null

  const cancel = () => respond({
    type: 'extension_ui_response',
    id: request.id,
    cancelled: true,
  })

  const answer = (response: Omit<LocalPiExtensionUiResponse, 'type' | 'id'>) => respond({ type: 'extension_ui_response', id: request.id, ...response } as LocalPiExtensionUiResponse)
  const footer = request.method === 'select'
    ? <div className="flex justify-end"><Button variant="outline" className="min-w-[76px]" disabled={busy} onClick={cancel}>{t('common.cancel')}</Button></div>
    : <div className="flex flex-wrap items-center justify-end gap-2" data-settings-actions>
      <Button variant="outline" className="min-w-[76px]" disabled={busy} onClick={cancel}>{t('common.cancel')}</Button>
      {request.method === 'confirm' ? <>
        <Button variant="outline" className="min-w-[76px]" disabled={busy} onClick={() => answer({ confirmed: false })}>{t('common.no')}</Button>
        <Button className="min-w-[76px]" disabled={busy} onClick={() => answer({ confirmed: true })}>{t('common.yes')}</Button>
      </> : <Button className="min-w-[76px]" disabled={busy} onClick={() => answer({ value })}>{t('common.ok')}</Button>}
    </div>

  // An extension's question appears as a sheet, like the app's own: its title, what it asks, the answer, then the choices.
  return <SettingsSheet open onOpenChange={(open) => { if (!open) cancel() }} wide={request.method === 'editor'}
    title={<InlineMarkdown markdown={request.title} />} footer={footer} data-extension-ui-dialog={request.method}
    description={request.method === 'confirm' ? <div className="text-app leading-relaxed text-foreground [&_.md-body]:text-app"><MarkdownContent markdown={request.message} /></div> : undefined}>
    {request.method === 'select' ? <div className="settings-group min-w-0" role="listbox" aria-label={request.title}>
      {request.options.map((option) => <button key={option} type="button" role="option" aria-selected={false} data-settings-row disabled={busy}
        onClick={() => answer({ value: option })}
        className="block min-h-[40px] w-full min-w-0 rounded-[inherit] px-3 py-2.5 text-left text-app outline-none hover:bg-fill focus-visible:focus-ring disabled:opacity-60">
        <InlineMarkdown markdown={option} />
      </button>)}
    </div> : null}
    {request.method === 'input' ? <Input autoFocus value={value} placeholder={request.placeholder} disabled={busy} onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
          event.preventDefault()
          answer({ value })
        }
      }} /> : null}
    {request.method === 'editor' ? <Textarea autoFocus value={value} disabled={busy} rows={10} className="scroll-slim min-h-48 resize-y rounded-[12px] font-mono"
      onChange={(event) => setValue(event.target.value)} /> : null}
  </SettingsSheet>
}
