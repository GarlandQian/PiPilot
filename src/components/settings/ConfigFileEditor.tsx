import * as React from 'react'
import { TbRefresh } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useT } from '@/i18n'
import { FormActions } from './kit'

interface Diagnostic {
  code: string
  offset: number
  line: number
  column: number
  message: string
}

/**
 * A whole configuration file as text, for what the structured pages do not
 * show. It edits the document's own draft, so the draft outlives the page
 * (another target, another pane) and Quit sees it like any other change.
 */
export function ConfigFileEditor({ draftText, savedText, onChange, path, description, label, parse, save, disabled, notice, onReload, onDone, onCancel, onDirtyChange }: {
  draftText: string
  /** What is on disk; the draft differs from it while there are unsaved changes. */
  savedText: string | null
  onChange(text: string): void
  path?: string
  description: string
  label: string
  parse(text: string): { valid: boolean; diagnostics: readonly Diagnostic[] }
  /** Save the draft and apply it; false keeps the page open. */
  save(): Promise<boolean>
  disabled?: boolean
  notice?: React.ReactNode
  /** Read the file again (it asks first when the draft has changes). */
  onReload?(): void
  onDone(): void
  onCancel(): void
  onDirtyChange(dirty: boolean): void
}) {
  const t = useT()
  const diagnosticsId = React.useId()
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const parsed = React.useMemo(() => parse(draftText), [parse, draftText])
  const dirty = savedText !== null && draftText !== savedText
  React.useEffect(() => { onDirtyChange(dirty) }, [dirty, onDirtyChange])

  const submit = async () => {
    setSaving(true)
    setError(null)
    const saved = await save()
    setSaving(false)
    if (saved) onDone()
    else setError(t('settings.editor.fileSaveFailed'))
  }

  return <div className="min-w-0 space-y-3" data-config-file-editor>
    <p className="px-2.5 text-caption leading-relaxed text-muted-foreground">{description}</p>
    {path || onReload ? <div className="settings-group flex min-w-0 items-center gap-2 px-3 py-1.5">
      <p className="min-w-0 flex-1 break-all font-mono text-micro text-muted-foreground">{path}</p>
      {onReload ? <Button variant="ghost" size="icon-sm" aria-label={t('common.refresh')} title={t('common.refresh')} disabled={saving} onClick={onReload}><TbRefresh aria-hidden /></Button> : null}
    </div> : null}
    {notice}
    <Textarea value={draftText} onChange={(event) => onChange(event.target.value)} spellCheck={false} disabled={saving}
      aria-invalid={!parsed.valid} aria-describedby={parsed.diagnostics.length ? diagnosticsId : undefined} aria-label={label}
      className="scroll-slim min-h-[28rem] resize-y rounded-[12px] bg-surface-inset p-4 font-mono text-caption leading-relaxed dark:bg-black/20" />
    {parsed.diagnostics.length > 0 ? <div id={diagnosticsId} className="space-y-1 rounded-lg bg-destructive/8 px-3 py-2" role="alert">
      {parsed.diagnostics.slice(0, 5).map((diagnostic, index) => <p key={`${diagnostic.code}:${diagnostic.offset}:${index}`} className="text-caption text-destructive">
        {t('settings.editor.diagnostic', { line: diagnostic.line, column: diagnostic.column, message: diagnostic.message })}</p>)}
    </div> : null}
    <FormActions onCancel={onCancel} onSave={() => void submit()} saving={saving} canSave={dirty && parsed.valid && !disabled} error={error}
      status={dirty ? t('settings.document.unsaved') : undefined} />
  </div>
}
