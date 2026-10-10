import * as React from 'react'
import { TbFileImport, TbLoader2 } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { MarkdownContent } from '@/components/chat/markdown/MarkdownContent'
import { FormActions, SettingsDisclosure, SettingsField, SettingsGroup, SettingsRow, SettingsSheet } from '@/components/settings/kit'
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
  const [previewOpen, setPreviewOpen] = React.useState(false)
  return <SettingsSheet open onOpenChange={(open) => { if (!open && phase !== 'creating') onClose() }} wide aria-busy={busy}
    title={t('import.open')} description={t('import.description')}
    footer={<FormActions onCancel={onClose} onSave={() => void create()} saving={phase === 'creating'} canSave={!busy && Boolean(preview) && Boolean(title.trim()) && scopeAvailable}
      saveLabel={t(phase === 'creating' ? 'import.creating' : 'import.create')}
      error={error ? t(error === 'read' ? 'import.readFailed' : error === 'tooLarge' ? 'import.tooLarge' : error === 'expired' ? 'import.expired' : 'import.createFailed') : null} />}>
    <div className="space-y-5">
      <SettingsGroup>
        <SettingsRow label={<span className="truncate" title={preview?.fileName}>{preview?.fileName ?? t('import.chooseHint')}</span>}
          icon={<TbFileImport className="size-5 shrink-0 text-muted-foreground" aria-hidden />}>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void chooseFile()}>{t(preview ? 'import.changeFile' : 'import.chooseFile')}</Button>
        </SettingsRow>
      </SettingsGroup>
      {phase === 'reading' ? <div role="status" className="settings-group flex min-h-36 items-center justify-center gap-2 text-caption text-muted-foreground"><TbLoader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />{t('import.reading')}</div> : null}
      {preview ? <>
        <SettingsGroup footer={<>
          <span className="block">{t(preview.format === 'pipilot' ? 'import.historyHint' : 'import.documentHint')}</span>
          <span className="mt-0.5 block">{t('import.counts', { messages: preview.messageCount, images: preview.imageCount })}</span>
        </>}>
          <SettingsField label={t('import.title')} htmlFor={titleId} error={!title.trim() ? <span id={titleErrorId}>{t('import.titleRequired')}</span> : undefined}>
            <Input id={titleId} value={title} maxLength={256} disabled={busy} onChange={(event) => setTitle(event.target.value)} aria-invalid={!title.trim()} aria-describedby={!title.trim() ? titleErrorId : undefined} />
          </SettingsField>
          <SettingsRow label={t('import.destination')} htmlFor={scopeId} description={t(preview.format === 'pipilot' ? 'import.history' : 'import.document')}>
            <Select value={scopeValue} onValueChange={setScopeValue} disabled={busy}>
              <SelectTrigger id={scopeId} className="w-56 max-w-full" aria-describedby={hintId}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="projectless">{t('conversation.projectless')}</SelectItem>
                {projects.map((project) => <SelectItem key={project.id} value={`project:${project.id}`} disabled={!project.available}>{project.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <span id={hintId} className="sr-only">{t(preview.format === 'pipilot' ? 'import.historyHint' : 'import.documentHint')}</span>
          </SettingsRow>
          <SettingsDisclosure label={t('import.preview')} open={previewOpen} onOpenChange={setPreviewOpen}>
            <div data-settings-row className="scroll-slim max-h-56 overflow-auto px-3 py-2.5 [&_.md-body]:text-caption" data-import-preview><MarkdownContent markdown={preview.previewMarkdown} /></div>
          </SettingsDisclosure>
        </SettingsGroup>
        {preview.warnings.length ? <ul role="status" className="space-y-1 rounded-[12px] bg-warning/10 px-3.5 py-2.5 text-caption">{preview.warnings.map((warning) => <li key={warning}>{t(`import.warning.${warning}`)}</li>)}</ul> : null}
      </> : null}
    </div>
  </SettingsSheet>
}
