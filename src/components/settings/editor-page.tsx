import * as React from 'react'
import { TbExternalLink, TbEye, TbEyeOff, TbMinus, TbPlus } from 'react-icons/tb'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'

/** A key or token: hidden until asked, never autocompleted or spell-checked. */
export function SecretInput({ id, value, onChange, placeholder, invalid, describedBy, disabled, className, label }: {
  id?: string
  value: string
  onChange(value: string): void
  placeholder?: string
  invalid?: boolean
  describedBy?: string
  disabled?: boolean
  className?: string
  label?: string
}) {
  const t = useT()
  const [visible, setVisible] = React.useState(false)
  return <div className={cn('relative min-w-0 flex-1', className)}>
    <Input id={id} type={visible ? 'text' : 'password'} value={value} autoComplete="off" spellCheck={false}
      aria-invalid={invalid || undefined} aria-describedby={describedBy} aria-label={label} disabled={disabled}
      placeholder={placeholder} className="pr-8 font-mono" onChange={(event) => onChange(event.target.value)} />
    <Button variant="ghost" size="icon-xs" disabled={disabled} className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground"
      aria-label={t(visible ? 'settings.editor.hideSecret' : 'settings.editor.showSecret')}
      aria-pressed={visible} onClick={() => setVisible((current) => !current)}>
      {visible ? <TbEyeOff aria-hidden /> : <TbEye aria-hidden />}
    </Button>
  </div>
}

/** A link to a page outside the app (a key console, a project's docs), opened in the browser. */
export function OutboundLink({ href, children }: { href?: string; children: React.ReactNode }) {
  if (!href) return null
  return <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-[4px] text-caption font-normal text-primary outline-none hover:underline focus-visible:focus-ring">
    {children}<TbExternalLink className="size-3.5" aria-hidden />
  </a>
}

/** "Get an API key ↗" on the provider's own site. */
export function ApiKeyLink({ href }: { href?: string }) {
  const t = useT()
  return <OutboundLink href={href}>{t('settings.models.editor.getApiKey')}</OutboundLink>
}

export function DiscardChangesDialog({ open, onOpenChange, onDiscard }: {
  open: boolean
  onOpenChange(open: boolean): void
  onDiscard(): void
}) {
  const t = useT()
  return <AlertDialog open={open} onOpenChange={onOpenChange}>
    <AlertDialogContent className="sm:max-w-[420px]">
      <AlertDialogHeader>
        <AlertDialogTitle>{t('settings.editor.discardTitle')}</AlertDialogTitle>
        <AlertDialogDescription>{t('settings.editor.discardDescription')}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>{t('settings.editor.keepEditing')}</AlertDialogCancel>
        <AlertDialogAction variant="destructive" onClick={onDiscard}>{t('settings.editor.discard')}</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
}

export type TestState =
  | { state: 'testing' }
  | { state: 'success'; latencyMs: number; preview: string }
  | { state: 'error'; message: string }

/** The provider as JSON: edits here and in the form above follow each other. */
export function JsonEditor({ id, value, onChange, error, label }: {
  id: string
  value: string
  onChange(value: string): void
  error?: string
  label: string
}) {
  return <div className="min-w-0 space-y-1.5">
    <Textarea id={id} value={value} spellCheck={false} aria-label={label} aria-invalid={Boolean(error) || undefined}
      aria-describedby={error ? `${id}-error` : undefined}
      className="scroll-slim min-h-64 resize-y rounded-lg bg-surface-inset p-3 font-mono text-caption leading-relaxed dark:bg-black/20"
      onChange={(event) => onChange(event.target.value)} />
    {error ? <p id={`${id}-error`} className="text-caption text-destructive" role="alert">{error}</p> : null}
  </div>
}

export interface RecordRowsLabels {
  add: string
  remove: string
  name: string
  value: string
  /** A value that is not text can only be edited as JSON. */
  notText: string
  namePlaceholder?: string
}

const SECRET_NAME = /auth|key|token|secret|password|cookie|credential/iu

/** Names whose values are hidden until shown: tokens, keys, passwords. */
export const isSecretName = (name: string) => SECRET_NAME.test(name)

/**
 * Name/value rows over a record (headers, environment variables). Blank rows
 * stay while typed; the record holds the named ones, and secret-looking
 * values are hidden until shown.
 */
export function RecordRowsEditor({ record, onChange, labels }: {
  record: Record<string, unknown>
  onChange(record: Record<string, unknown> | undefined): void
  labels: RecordRowsLabels
}) {
  type Row = { name: string; value: string; raw: unknown }
  const fromRecord = (value: Record<string, unknown>): Row[] => Object.entries(value).map(([name, raw]) => ({ name, value: typeof raw === 'string' ? raw : JSON.stringify(raw), raw }))
  const [rows, setRows] = React.useState(() => fromRecord(record))
  const toRecord = (next: readonly Row[]) => Object.fromEntries(next.filter((row) => row.name.trim()).map((row) => [row.name.trim(), typeof row.raw === 'string' || row.raw === undefined ? row.value : row.raw]))
  React.useEffect(() => {
    if (JSON.stringify(toRecord(rows)) !== JSON.stringify(record)) setRows(fromRecord(record))
    // Rows follow the record only when it changed elsewhere (the JSON view).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record])
  const commit = (next: Row[]) => {
    setRows(next)
    const value = toRecord(next)
    onChange(Object.keys(value).length ? value : undefined)
  }
  const change = (index: number, patch: Partial<Row>) => commit(rows.map((row, position) => position === index ? { ...row, ...patch } : row))
  return <div className="mac-box flex min-w-0 flex-col divide-y divide-border overflow-hidden">
    {rows.map((row, index) => <div key={index} className="flex min-w-0 items-center gap-2 px-2 py-1.5">
      <Input value={row.name} placeholder={labels.namePlaceholder} aria-label={labels.name} spellCheck={false} className="w-[38%] shrink-0 font-mono"
        onChange={(event) => change(index, { name: event.target.value })} />
      {typeof row.raw !== 'string' && row.raw !== undefined
        ? <span className="min-w-0 flex-1 truncate font-mono text-micro text-muted-foreground" title={row.value}>{labels.notText}</span>
        : isSecretName(row.name)
          ? <SecretInput value={row.value} label={labels.value} onChange={(value) => change(index, { value, raw: value })} />
          : <Input value={row.value} placeholder={labels.value} aria-label={labels.value} spellCheck={false} className="min-w-0 flex-1 font-mono"
            onChange={(event) => change(index, { value: event.target.value, raw: event.target.value })} />}
      <Button variant="ghost" size="icon-xs" aria-label={labels.remove} className="text-muted-foreground hover:text-destructive"
        onClick={() => commit(rows.filter((_, position) => position !== index))}><TbMinus aria-hidden /></Button>
    </div>)}
    <div className="flex items-center gap-0.5 bg-fill/60 px-1 py-0.5">
      <Button variant="ghost" size="icon-xs" aria-label={labels.add} title={labels.add} className="text-foreground/75"
        onClick={() => commit([...rows, { name: '', value: '', raw: undefined }])}><TbPlus aria-hidden /></Button>
    </div>
  </div>
}
