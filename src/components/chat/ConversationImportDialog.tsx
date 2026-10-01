import * as React from 'react'
import { TbFileImport, TbLoader2 } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { MarkdownContent } from '@/components/chat/markdown/MarkdownContent'
import { useLocale, useT } from '@/i18n'
import type { ConversationScope } from '@/shared/conversation-scope'
import type { RecentProject } from '@/types/chat'

type ImportPreview = Extract<Awaited<ReturnType<NonNullable<Window['pipilot']>['conversationImport']['preview']>>, { status: 'ready' }>
type ImportInput = Parameters<NonNullable<Window['pipilot']>['conversationImport']['commit']>[0]

export function ConversationImportDialog({ initialScope, projects, onCommit, onClose }: {
  initialScope: ConversationScope
  projects: readonly RecentProject[]
  onCommit(input: ImportInput): Promise<void>
  onClose(): void
}) {
  const t = useT()
  const locale = useLocale()
  const [preview, setPreview] = React.useState<ImportPreview | null>(null)
  const [title, setTitle] = React.useState('')
  const [scopeValue, setScopeValue] = React.useState(initialScope.kind === 'project' ? `project:${initialScope.workspaceId}` : 'projectless')
  const [phase, setPhase] = React.useState<'idle' | 'reading' | 'creating'>('idle')
  const [error, setError] = React.useState<'read' | 'create' | 'tooLarge' | 'expired' | null>(null)
  const requestEpoch = React.useRef(0)
  const token = React.useRef<string | null>(null)
  const started = React.useRef(false)
  const titleId = React.useId(), scopeId = React.useId(), hintId = React.useId(), titleErrorId = React.useId()
  const busy = phase !== 'idle'
  const scopeAvailable = scopeValue === 'projectless' || projects.some((project) => `project:${project.id}` === scopeValue && project.available)
  const discard = React.useCallback((value: string | null) => {
    if (value) void window.pipilot?.conversationImport.discard({ token: value }).catch(() => undefined)
  }, [])
  const chooseFile = React.useCallback(async () => {
    const api = window.pipilot?.conversationImport
    if (!api) { setError('read'); return }
    const epoch = ++requestEpoch.current
    discard(token.current); token.current = null
    setPreview(null); setError(null); setPhase('reading')
    try {
      const result = await api.preview({ locale })
      if (epoch !== requestEpoch.current) { if (result.status === 'ready') discard(result.token); return }
      if (result.status === 'ready') {
        token.current = result.token
        setPreview(result); setTitle(result.title)
      }
    } catch (caught) {
      if (epoch === requestEpoch.current) setError(caught && typeof caught === 'object' && 'code' in caught && caught.code === 'IMPORT_TOO_LARGE' ? 'tooLarge' : 'read')
    }
    finally { if (epoch === requestEpoch.current) setPhase('idle') }
  }, [discard, locale])
  React.useEffect(() => {
    let mounted = true
    // The deferred first choice avoids opening two native dialogs in StrictMode.
    queueMicrotask(() => { if (mounted && !started.current) { started.current = true; void chooseFile() } })
    return () => { mounted = false }
  }, [chooseFile])
  React.useEffect(() => () => {
    requestEpoch.current += 1
    discard(token.current)
  }, [discard])
  const create = async () => {
    if (!preview || busy || !title.trim() || !scopeAvailable) return
    setPhase('creating'); setError(null)
    try {
      await onCommit({ token: preview.token, title: title.trim(), scope: scopeValue === 'projectless' ? { kind: 'projectless' } : { kind: 'project', workspaceId: scopeValue.slice('project:'.length) } })
      token.current = null
      onClose()
    } catch (caught) {
      setError(caught && typeof caught === 'object' && 'code' in caught && caught.code === 'IMPORT_EXPIRED' ? 'expired' : 'create')
      setPhase('idle')
    }
  }
  return <Dialog open onOpenChange={(open) => { if (!open && phase !== 'creating') onClose() }}>
    <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl" showCloseButton={phase !== 'creating'} aria-busy={busy}>
      <DialogHeader><DialogTitle>{t('import.open')}</DialogTitle><DialogDescription>{t('import.description')}</DialogDescription></DialogHeader>
      <div className="flex min-w-0 items-center gap-3">
        <TbFileImport className="size-5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-caption">{preview?.fileName ?? t('import.chooseHint')}</span>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void chooseFile()}>{t(preview ? 'import.changeFile' : 'import.chooseFile')}</Button>
      </div>
      {phase === 'reading' ? <div role="status" className="flex min-h-36 items-center justify-center gap-2 text-caption text-muted-foreground"><TbLoader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />{t('import.reading')}</div> : null}
      {preview ? <>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="min-w-0 space-y-1.5"><label htmlFor={titleId} className="text-caption font-medium">{t('import.title')}</label><Input id={titleId} value={title} maxLength={256} disabled={busy} onChange={(event) => setTitle(event.target.value)} aria-invalid={!title.trim()} aria-describedby={!title.trim() ? titleErrorId : undefined} />{!title.trim() ? <p id={titleErrorId} className="text-caption text-destructive">{t('import.titleRequired')}</p> : null}</div>
          <div className="min-w-0 space-y-1.5"><label htmlFor={scopeId} className="text-caption font-medium">{t('import.destination')}</label><Select value={scopeValue} onValueChange={setScopeValue} disabled={busy}><SelectTrigger id={scopeId} className="w-full" aria-describedby={hintId}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="projectless">{t('conversation.projectless')}</SelectItem>{projects.map((project) => <SelectItem key={project.id} value={`project:${project.id}`} disabled={!project.available}>{project.name}</SelectItem>)}</SelectContent></Select></div>
        </div>
        <div className="space-y-1 text-caption"><p className="font-medium">{t(preview.format === 'pipilot' ? 'import.history' : 'import.document')}</p><p id={hintId} className="text-muted-foreground">{t(preview.format === 'pipilot' ? 'import.historyHint' : 'import.documentHint')}</p><p className="text-micro text-muted-foreground">{t('import.counts', { messages: preview.messageCount, images: preview.imageCount })}</p></div>
        {preview.warnings.length ? <ul role="status" className="space-y-1 border-l-2 border-warning pl-3 text-caption text-muted-foreground">{preview.warnings.map((warning) => <li key={warning}>{t(`import.warning.${warning}`)}</li>)}</ul> : null}
        <details className="min-w-0 rounded-lg border border-border">
          <summary className="cursor-pointer rounded-lg px-3 py-2 text-caption font-medium focus-visible:focus-ring">{t('import.preview')}</summary>
          <div className="scroll-slim max-h-56 overflow-auto border-t border-border p-3 [&_.md-body]:text-caption" data-import-preview><MarkdownContent markdown={preview.previewMarkdown} /></div>
        </details>
      </> : null}
      {error ? <p role="alert" className="text-caption text-destructive">{t(error === 'read' ? 'import.readFailed' : error === 'tooLarge' ? 'import.tooLarge' : error === 'expired' ? 'import.expired' : 'import.createFailed')}</p> : null}
      <DialogFooter><Button variant="outline" disabled={phase === 'creating'} onClick={onClose}>{t('common.cancel')}</Button><Button disabled={busy || !preview || !title.trim() || !scopeAvailable} onClick={() => void create()}>{phase === 'creating' ? <TbLoader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : <TbFileImport aria-hidden />}{t(phase === 'creating' ? 'import.creating' : 'import.create')}</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}
