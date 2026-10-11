import * as React from 'react'
import { TbCheck, TbDownload } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { FormActions, SettingsGroup, SettingsRow, SettingsSheet } from '@/components/settings/kit'
import { Switch } from '@/components/ui/switch'
import { useLocale, useT } from '@/i18n'
import type { ConversationExportFormat, ConversationExportTarget } from '@/shared/conversation-export'

export function ConversationExportDialog({ target, conversationName, onClose }: {
  target: ConversationExportTarget | null
  conversationName?: string
  onClose(): void
}) {
  const t = useT()
  const locale = useLocale()
  const [includeTools, setIncludeTools] = React.useState(false)
  const [format, setFormat] = React.useState<ConversationExportFormat>('markdown')
  const formatId = React.useId()
  const whole = target?.selection.kind === 'conversation'
  // Pi renders HTML from an open conversation; a listed one has its file only.
  const htmlAvailable = Boolean(target && whole && !('selectionToken' in target))
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<'stale' | 'failed' | null>(null)
  const [saved, setSaved] = React.useState<{ fileName: string; imageCount: number } | null>(null)
  const epoch = React.useRef(0)
  const toolOptionId = React.useId()
  React.useEffect(() => {
    epoch.current += 1
    setIncludeTools(false); setFormat('markdown'); setBusy(false); setError(null); setSaved(null)
    return () => { epoch.current += 1 }
  }, [target])
  const save = async () => {
    if (!target || busy || !window.pipilot) return
    const requestEpoch = epoch.current
    setBusy(true); setError(null)
    try {
      const result = await window.pipilot.conversationExport.save({ ...target, includeTools, locale, ...(format === 'markdown' ? {} : { format }) })
      if (requestEpoch !== epoch.current) return
      if (result.status === 'saved') setSaved(result)
    } catch (caught) {
      if (requestEpoch !== epoch.current) return
      setError(caught && typeof caught === 'object' && 'code' in caught && caught.code === 'EXPORT_STALE_SESSION' ? 'stale' : 'failed')
    } finally {
      if (requestEpoch === epoch.current) setBusy(false)
    }
  }
  const title = t(target?.selection.kind === 'response' ? 'export.response' : target?.selection.kind === 'message' ? 'export.message' : 'export.conversation')
  return <SettingsSheet open={target !== null} onOpenChange={(open) => { if (!open && !busy) onClose() }} title={title}
    description={t(target?.selection.kind === 'message' ? 'export.messageDescription' : target?.selection.kind === 'response' ? 'export.responseDescription' : 'export.description')}
    footer={saved ? <div className="flex justify-end"><Button className="min-w-[76px]" onClick={onClose}>{t('common.close')}</Button></div>
      : <FormActions onCancel={onClose} onSave={() => void save()} saving={busy} canSave={Boolean(window.pipilot)} saveLabel={t('export.save')}
        error={error ? t(error === 'stale' ? 'export.stale' : 'export.failed') : null} />}>
    {saved ? <div className="settings-group flex items-start gap-2.5 px-3.5 py-3 text-caption" role="status">
      <TbCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
      <span className="min-w-0 break-words">{t('export.saved', { name: saved.fileName })}{saved.imageCount > 0 ? <span className="mt-1 block text-muted-foreground">{t('export.assets', { count: saved.imageCount })}</span> : null}</span>
    </div> : <SettingsGroup footer={format === 'markdown' ? <><span className="block">{t('export.contents')}</span><span className="mt-0.5 block">{t('export.paths')}</span></>
      : <span className="block">{t(format === 'html' ? 'export.htmlContents' : 'export.jsonlContents')}</span>}>
      {conversationName ? <SettingsRow label={<span className="font-medium">{conversationName}</span>} icon={<TbDownload className="size-5 shrink-0 text-muted-foreground" aria-hidden />} /> : null}
      {whole ? <SettingsRow label={t('export.format')} htmlFor={formatId}>
        <select id={formatId} className="mac-select" value={format} disabled={busy} onChange={(event) => setFormat(event.target.value as ConversationExportFormat)}>
          <option value="markdown">Markdown</option>
          <option value="html" disabled={!htmlAvailable}>{t(htmlAvailable ? 'export.format.html' : 'export.format.htmlOpen')}</option>
          <option value="jsonl">{t('export.format.jsonl')}</option>
        </select>
      </SettingsRow> : null}
      {format === 'markdown' ? <SettingsRow label={t('export.includeTools')} htmlFor={toolOptionId}>
        <Switch id={toolOptionId} checked={includeTools} disabled={busy} onCheckedChange={setIncludeTools} />
      </SettingsRow> : null}
    </SettingsGroup>}
  </SettingsSheet>
}
