import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { MarkdownContent } from '@/components/chat/markdown/MarkdownContent'
import { InlineMarkdown } from '@/components/chat/markdown/InlineMarkdown'
import type { LocalPiExtensionUiRequest, LocalPiExtensionUiResponse } from '@/shared/local-pi'
import { useT } from '@/i18n'

type Question = Extract<LocalPiExtensionUiRequest, { method: 'select' | 'confirm' | 'input' | 'editor' }>
export function isSideQuestionInteraction(request: LocalPiExtensionUiRequest): request is Question {
  return ['select', 'confirm', 'input', 'editor'].includes(request.method)
}

/** Answer in the owning conversation without stealing the main conversation's focus. */
export function SideQuestionInteraction({ request, busy, onRespond }: {
  request: Question; busy: boolean; onRespond(response: LocalPiExtensionUiResponse): void
}) {
  const t = useT(), id = React.useId()
  const [value, setValue] = React.useState(request.method === 'editor' ? request.prefill ?? '' : '')
  const respond = (answer: { value: string } | { confirmed: boolean } | { cancelled: true }) => onRespond({ type: 'extension_ui_response', id: request.id, ...answer })
  return <section className="space-y-3 rounded-lg border border-border bg-muted/30 p-3" aria-labelledby={id} data-side-question-interaction>
    <div id={id} className="text-caption font-medium"><InlineMarkdown markdown={request.title} /></div>
    {request.method === 'confirm' ? <MarkdownContent markdown={request.message} /> : null}
    {request.method === 'select' ? <div className="flex flex-col gap-1">{request.options.map((option) => <Button key={option} variant="outline" disabled={busy} className="h-auto justify-start whitespace-normal text-left" onClick={() => respond({ value: option })}><InlineMarkdown markdown={option} /></Button>)}</div> : null}
    {request.method === 'input' ? <Input aria-labelledby={id} disabled={busy} value={value} placeholder={request.placeholder} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => {
      if (!busy && event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); respond({ value }) }
    }} /> : null}
    {request.method === 'editor' ? <Textarea aria-labelledby={id} disabled={busy} value={value} rows={5} onChange={(event) => setValue(event.target.value)} /> : null}
    <div className="flex flex-wrap justify-end gap-2">
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => respond({ cancelled: true })}>{t('common.cancel')}</Button>
      {request.method === 'confirm' ? <><Button size="sm" variant="outline" disabled={busy} onClick={() => respond({ confirmed: false })}>{t('common.no')}</Button><Button size="sm" disabled={busy} onClick={() => respond({ confirmed: true })}>{t('common.yes')}</Button></> : null}
      {request.method === 'input' || request.method === 'editor' ? <Button size="sm" disabled={busy} onClick={() => respond({ value })}>{t('common.ok')}</Button> : null}
    </div>
  </section>
}
