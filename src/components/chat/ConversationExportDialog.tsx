import * as React from 'react'
import { TbCheck, TbDownload, TbLoader2 } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { useLocale, useT } from '@/i18n'
import type { ConversationExportTarget } from '@/shared/conversation-export'

export function ConversationExportDialog({ target, conversationName, onClose }: {
  target: ConversationExportTarget | null
  conversationName?: string
  onClose(): void
}) {
  const t = useT()
  const locale = useLocale()
  const [includeTools, setIncludeTools] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<'stale' | 'failed' | null>(null)
  const [saved, setSaved] = React.useState<{ fileName: string; imageCount: number } | null>(null)
  const epoch = React.useRef(0)
  const toolOptionId = React.useId()
  React.useEffect(() => {
    epoch.current += 1
    setIncludeTools(false); setBusy(false); setError(null); setSaved(null)
    return () => { epoch.current += 1 }
  }, [target])
  const save = async () => {
    if (!target || busy || !window.pipilot) return
    const requestEpoch = epoch.current
    setBusy(true); setError(null)
    try {
      const result = await window.pipilot.conversationExport.save({ ...target, includeTools, locale })
      if (requestEpoch !== epoch.current) return
      if (result.status === 'saved') setSaved(result)
    } catch (caught) {
      if (requestEpoch !== epoch.current) return
      setError(caught && typeof caught === 'object' && 'code' in caught && caught.code === 'EXPORT_STALE_SESSION' ? 'stale' : 'failed')
    } finally {
      if (requestEpoch === epoch.current) setBusy(false)
    }
  }
  return <Dialog open={target !== null} onOpenChange={(open) => { if (!open && !busy) onClose() }}>
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{t(target?.selection.kind === 'response' ? 'export.response' : target?.selection.kind === 'message' ? 'export.message' : 'export.conversation')}</DialogTitle>
        <DialogDescription>{t(target?.selection.kind === 'message' ? 'export.messageDescription'
          : target?.selection.kind === 'response' ? 'export.responseDescription' : 'export.description')}</DialogDescription>
      </DialogHeader>
      {conversationName ? <p className="truncate text-app font-medium" title={conversationName}>{conversationName}</p> : null}
      {saved ? <p className="flex items-start gap-2 break-words text-caption" role="status"><TbCheck className="mt-0.5 shrink-0 text-success" aria-hidden /><span>{t('export.saved', { name: saved.fileName })}{saved.imageCount > 0 ? <span className="mt-1 block text-muted-foreground">{t('export.assets', { count: saved.imageCount })}</span> : null}</span></p>
        : <div className="space-y-3">
          <div className="flex items-center justify-between gap-4">
            <label htmlFor={toolOptionId} className="text-app">{t('export.includeTools')}</label>
            <Switch id={toolOptionId} checked={includeTools} disabled={busy} onCheckedChange={setIncludeTools} />
          </div>
          <p className="text-caption text-muted-foreground">{t('export.contents')}</p>
          <p className="text-caption text-muted-foreground">{t('export.paths')}</p>
        </div>}
      {error ? <p className="text-caption text-destructive" role="alert">{t(error === 'stale' ? 'export.stale' : 'export.failed')}</p> : null}
      <DialogFooter>
        <Button variant="outline" disabled={busy} onClick={onClose}>{t(saved ? 'common.close' : 'common.cancel')}</Button>
        {!saved ? <Button disabled={busy || !window.pipilot} onClick={() => void save()}>
          {busy ? <TbLoader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : <TbDownload aria-hidden />}
          {t('export.save')}
        </Button> : null}
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
