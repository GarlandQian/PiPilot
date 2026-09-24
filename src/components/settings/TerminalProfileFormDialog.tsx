import * as React from 'react'
import { TbPlus, TbTrash } from 'react-icons/tb'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { FormDialog, FormRow } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { useT, type MessageKey } from '@/i18n'
import { terminalCustomProfileSchema, type TerminalCustomProfile } from '@/shared/terminal-profiles'

interface ArgumentRow { id: string; value: string }
interface EnvironmentRow { id: string; key: string; value: string; unset: boolean }
interface ProfileDraft { name: string; executable: string; args: ArgumentRow[]; env: EnvironmentRow[] }

function draftFromProfile(profile: TerminalCustomProfile): ProfileDraft {
  return {
    name: profile.name,
    executable: profile.executable,
    args: profile.args.map((value) => ({ id: crypto.randomUUID(), value })),
    env: Object.entries(profile.env).map(([key, value]) => ({ id: crypto.randomUUID(), key, value: value ?? '', unset: value === null })),
  }
}

function validateProfile(id: string, draft: ProfileDraft) {
  const profile = {
    id,
    name: draft.name.trim(),
    executable: draft.executable.trim(),
    args: draft.args.map(({ value }) => value),
    env: Object.fromEntries(draft.env.map(({ key, value, unset }) => [key, unset ? null : value])),
  }
  const errors: Record<string, MessageKey> = {}
  const result = terminalCustomProfileSchema.safeParse(profile)
  if (!result.success) {
    for (const issue of result.error.issues) {
      const field = String(issue.path[0])
      if (field === 'name') errors.name = 'settings.terminal.profiles.form.nameError'
      else if (field === 'executable') errors.executable = 'settings.terminal.profiles.form.executableError'
      else if (field === 'args') errors.args = 'settings.terminal.profiles.form.argsError'
      else if (field === 'env') errors.env = 'settings.terminal.profiles.form.envError'
    }
  }
  if (new Set(draft.env.map(({ key }) => key)).size !== draft.env.length) {
    errors.env = 'settings.terminal.profiles.form.envDuplicateError'
  }
  return { profile, errors }
}

export function TerminalProfileFormDialog({
  initial,
  mode,
  saveBlocked,
  onClose,
  onSave,
}: {
  initial: TerminalCustomProfile
  mode: 'add' | 'edit'
  saveBlocked: boolean
  onClose(): void
  onSave(profile: TerminalCustomProfile): Promise<boolean>
}) {
  const t = useT()
  const [draft, setDraft] = React.useState(() => draftFromProfile(initial))
  const [baseline] = React.useState(() => JSON.stringify(draft))
  const [attempted, setAttempted] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [saveFailed, setSaveFailed] = React.useState(false)
  const [confirmDiscard, setConfirmDiscard] = React.useState(false)
  const [advanced, setAdvanced] = React.useState(initial.args.length > 0 || Object.keys(initial.env).length > 0)
  const id = React.useId()
  const busyRef = React.useRef(false)
  const { profile, errors } = validateProfile(initial.id, draft)
  const dirty = JSON.stringify(draft) !== baseline
  const fieldId = (field: string) => `${id}-${field}`
  const fieldError = (field: string) => attempted && errors[field]
    ? <span id={`${fieldId(field)}-error`} role="alert">{t(errors[field])}</span>
    : undefined
  const description = (field: string) => attempted && errors[field]
    ? `${fieldId(field)}-error`
    : `${fieldId(field)}-hint`
  const requestClose = () => {
    if (busyRef.current) return
    if (dirty) setConfirmDiscard(true)
    else onClose()
  }
  const save = async () => {
    if (busyRef.current || saveBlocked) return
    setAttempted(true)
    const invalid = Object.keys(errors)[0]
    if (invalid) {
      if (invalid === 'args' || invalid === 'env') setAdvanced(true)
      requestAnimationFrame(() => {
        const field = document.getElementById(fieldId(invalid))
        if (field instanceof HTMLInputElement) field.focus()
        else field?.querySelector<HTMLInputElement>('input')?.focus()
      })
      return
    }
    busyRef.current = true
    setSaving(true)
    setSaveFailed(false)
    try {
      if (await onSave(profile)) onClose()
      else setSaveFailed(true)
    } catch {
      setSaveFailed(true)
    } finally {
      busyRef.current = false
      setSaving(false)
    }
  }

  return <>
    <FormDialog
      open
      onOpenChange={(open) => { if (!open) requestClose() }}
      title={t(mode === 'add' ? 'settings.terminal.profiles.form.addTitle' : 'settings.terminal.profiles.form.editTitle')}
      description={t('settings.terminal.profiles.form.description')}
      cancelLabel={t('common.cancel')}
      submitLabel={t(saving ? 'settings.redesign.save.saving' : 'common.save')}
      onSubmit={save}
      disabled={saving}
      submitDisabled={saveBlocked}
    >
      <form className="min-w-0 space-y-5" onSubmit={(event) => { event.preventDefault(); void save() }}>
        <FormRow label={t('settings.terminal.profiles.form.name')} htmlFor={fieldId('name')} error={fieldError('name')}>
          <Input id={fieldId('name')} autoFocus autoComplete="off" value={draft.name} maxLength={128} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} aria-invalid={attempted && Boolean(errors.name)} aria-describedby={attempted && errors.name ? `${fieldId('name')}-error` : undefined} />
        </FormRow>
        <FormRow label={t('settings.terminal.profiles.form.executable')} htmlFor={fieldId('executable')} error={fieldError('executable')} hint={<span id={`${fieldId('executable')}-hint`}>{t('settings.terminal.profiles.form.executableHint')}</span>}>
          <Input id={fieldId('executable')} autoComplete="off" spellCheck={false} value={draft.executable} maxLength={4096} onChange={(event) => setDraft((current) => ({ ...current, executable: event.target.value }))} aria-invalid={attempted && Boolean(errors.executable)} aria-describedby={description('executable')} className="font-mono" />
        </FormRow>
        <details open={advanced} onToggle={(event) => setAdvanced(event.currentTarget.open)} className="min-w-0 rounded-md border border-border">
          <summary className="cursor-pointer rounded-md px-4 py-3 text-app font-medium outline-none focus-visible:focus-ring">{t('settings.terminal.profiles.form.advanced')}</summary>
          <div className="min-w-0 space-y-5 border-t border-border p-4">
            <fieldset id={fieldId('args')} aria-describedby={description('args')} className="min-w-0 space-y-2">
              <legend className="mb-1 text-app font-medium">{t('settings.terminal.profiles.form.args')}</legend>
              <p id={`${fieldId('args')}-hint`} className="text-caption text-muted-foreground">{t('settings.terminal.profiles.form.argsHint')}</p>
              {draft.args.map((row, index) => <div key={row.id} className="flex min-w-0 items-center gap-2">
                <Input value={row.value} autoComplete="off" spellCheck={false} maxLength={4096} aria-label={t('settings.terminal.profiles.form.argument', { index: index + 1 })} aria-invalid={attempted && Boolean(errors.args)} aria-describedby={description('args')} onChange={(event) => setDraft((current) => ({ ...current, args: current.args.map((argument) => argument.id === row.id ? { ...argument, value: event.target.value } : argument) }))} className="min-w-0 flex-1 font-mono" />
                <Button variant="ghost" size="icon-sm" aria-label={t('settings.terminal.profiles.form.removeArgument', { index: index + 1 })} onClick={() => setDraft((current) => ({ ...current, args: current.args.filter(({ id }) => id !== row.id) }))}><TbTrash aria-hidden /></Button>
              </div>)}
              {fieldError('args') ? <p className="text-caption text-destructive">{fieldError('args')}</p> : null}
              <Button variant="outline" size="sm" disabled={draft.args.length >= 64} onClick={() => setDraft((current) => ({ ...current, args: [...current.args, { id: crypto.randomUUID(), value: '' }] }))}><TbPlus aria-hidden />{t('settings.terminal.profiles.form.addArgument')}</Button>
            </fieldset>
            <fieldset id={fieldId('env')} aria-describedby={description('env')} className="min-w-0 space-y-2">
              <legend className="mb-1 text-app font-medium">{t('settings.terminal.profiles.form.env')}</legend>
              <p id={`${fieldId('env')}-hint`} className="text-caption text-muted-foreground">{t('settings.terminal.profiles.form.envHint')}</p>
              {draft.env.map((row, index) => {
                const updateRow = (patch: Partial<EnvironmentRow>) => setDraft((current) => ({ ...current, env: current.env.map((variable) => variable.id === row.id ? { ...variable, ...patch } : variable) }))
                const unsetId = `${id}-unset-${row.id}`
                return <div key={row.id} className="min-w-0 rounded-md border border-border bg-surface-inset p-3">
                  <div className="flex min-w-0 items-start gap-2">
                    <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-2">
                      <Input value={row.key} autoComplete="off" spellCheck={false} maxLength={256} aria-label={t('settings.terminal.profiles.form.envKey', { index: index + 1 })} placeholder={t('settings.terminal.profiles.form.envKeyPlaceholder')} aria-invalid={attempted && Boolean(errors.env)} aria-describedby={description('env')} onChange={(event) => updateRow({ key: event.target.value })} className="min-w-0 font-mono" />
                      <Input value={row.value} autoComplete="off" spellCheck={false} maxLength={4096} disabled={row.unset} aria-label={t('settings.terminal.profiles.form.envValue', { index: index + 1 })} placeholder={t('settings.terminal.profiles.form.envValuePlaceholder')} aria-invalid={attempted && Boolean(errors.env)} aria-describedby={description('env')} onChange={(event) => updateRow({ value: event.target.value })} className="min-w-0 font-mono" />
                    </div>
                    <Button variant="ghost" size="icon-sm" aria-label={t('settings.terminal.profiles.form.removeEnv', { index: index + 1 })} onClick={() => setDraft((current) => ({ ...current, env: current.env.filter(({ id }) => id !== row.id) }))}><TbTrash aria-hidden /></Button>
                  </div>
                  <div className="mt-2 flex items-center gap-2"><Checkbox id={unsetId} checked={row.unset} onCheckedChange={(checked) => updateRow({ unset: checked === true })} /><label htmlFor={unsetId} className="cursor-pointer text-caption text-muted-foreground">{t('settings.terminal.profiles.form.unset')}</label></div>
                </div>
              })}
              {fieldError('env') ? <p className="text-caption text-destructive">{fieldError('env')}</p> : null}
              <Button variant="outline" size="sm" disabled={draft.env.length >= 64} onClick={() => setDraft((current) => ({ ...current, env: [...current.env, { id: crypto.randomUUID(), key: '', value: '', unset: false }] }))}><TbPlus aria-hidden />{t('settings.terminal.profiles.form.addEnv')}</Button>
            </fieldset>
          </div>
        </details>
        {saveFailed ? <p role="alert" className="text-caption text-destructive">{t('settings.terminal.profiles.form.saveFailed')}</p> : null}
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </FormDialog>
    <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>{t('settings.terminal.profiles.form.discardTitle')}</AlertDialogTitle><AlertDialogDescription>{t('settings.terminal.profiles.form.discardDescription')}</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel><AlertDialogAction onClick={onClose}>{t('app.shutdown.discard')}</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>
}
