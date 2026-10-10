import * as React from 'react'
import { TbMinus, TbPlus } from 'react-icons/tb'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { useT, type MessageKey } from '@/i18n'
import { terminalCustomProfileSchema, type TerminalCustomProfile } from '@/shared/terminal-profiles'
import { FormActions, SettingsDisclosure, SettingsField, SettingsGroup, SettingsSheet } from './kit'

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

/** The +/− table rows sit in: one row per item, a + bar below. */
function RowsTable({ id, describedBy, addLabel, addDisabled, onAdd, children }: {
  id: string
  describedBy: string
  addLabel: string
  addDisabled: boolean
  onAdd(): void
  children: React.ReactNode
}) {
  return <div id={id} role="group" aria-describedby={describedBy} className="mac-box flex min-w-0 flex-col divide-y divide-border overflow-hidden">
    {children}
    <div className="flex items-center gap-0.5 bg-fill/60 px-1 py-0.5">
      <Button variant="ghost" size="icon-xs" aria-label={addLabel} title={addLabel} className="text-foreground/75" disabled={addDisabled} onClick={onAdd}><TbPlus aria-hidden /></Button>
    </div>
  </div>
}

/** A custom shell for integrated terminals: a name, the executable, and optionally its arguments and environment. */
export function TerminalProfileSheet({ initial, mode, saveBlocked, onClose, onSave }: {
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
  const error = (field: string) => attempted && errors[field] ? t(errors[field]) : undefined
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
  const setArgs = (update: (rows: ArgumentRow[]) => ArgumentRow[]) => setDraft((current) => ({ ...current, args: update(current.args) }))
  const setEnv = (update: (rows: EnvironmentRow[]) => EnvironmentRow[]) => setDraft((current) => ({ ...current, env: update(current.env) }))

  return <>
    <SettingsSheet open onOpenChange={(open) => { if (!open) requestClose() }} wide data-terminal-profile-sheet
      title={t(mode === 'add' ? 'settings.terminal.profiles.form.addTitle' : 'settings.terminal.profiles.form.editTitle')}
      description={t('settings.terminal.profiles.form.description')}
      footer={<FormActions onCancel={requestClose} onSave={() => void save()} saving={saving} canSave={!saveBlocked}
        error={saveFailed ? t('settings.terminal.profiles.form.saveFailed') : null} />}>
      <form className="min-w-0 space-y-5" onSubmit={(event) => { event.preventDefault(); void save() }}>
        <SettingsGroup>
          <SettingsField label={t('settings.terminal.profiles.form.name')} htmlFor={fieldId('name')} error={error('name')}>
            <Input id={fieldId('name')} autoFocus autoComplete="off" value={draft.name} maxLength={128} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
              aria-invalid={attempted && Boolean(errors.name)} aria-describedby={attempted && errors.name ? `${fieldId('name')}-feedback` : undefined} />
          </SettingsField>
          <SettingsField label={t('settings.terminal.profiles.form.executable')} htmlFor={fieldId('executable')} error={error('executable')} hint={t('settings.terminal.profiles.form.executableHint')}>
            <Input id={fieldId('executable')} autoComplete="off" spellCheck={false} value={draft.executable} maxLength={4096} className="font-mono"
              onChange={(event) => setDraft((current) => ({ ...current, executable: event.target.value }))}
              aria-invalid={attempted && Boolean(errors.executable)} aria-describedby={`${fieldId('executable')}-feedback`} />
          </SettingsField>
          <SettingsDisclosure label={t('settings.terminal.profiles.form.advanced')} open={advanced} onOpenChange={setAdvanced}>
            <SettingsField label={t('settings.terminal.profiles.form.args')} feedbackId={`${fieldId('args')}-feedback`}
              error={error('args')} hint={t('settings.terminal.profiles.form.argsHint')}>
              <RowsTable id={fieldId('args')} describedBy={`${fieldId('args')}-feedback`} addLabel={t('settings.terminal.profiles.form.addArgument')} addDisabled={draft.args.length >= 64}
                onAdd={() => setArgs((rows) => [...rows, { id: crypto.randomUUID(), value: '' }])}>
                {draft.args.map((row, index) => <div key={row.id} className="flex min-w-0 items-center gap-2 px-2 py-1.5">
                  <Input value={row.value} autoComplete="off" spellCheck={false} maxLength={4096} className="min-w-0 flex-1 font-mono"
                    aria-label={t('settings.terminal.profiles.form.argument', { index: index + 1 })} aria-invalid={attempted && Boolean(errors.args)}
                    onChange={(event) => setArgs((rows) => rows.map((argument) => argument.id === row.id ? { ...argument, value: event.target.value } : argument))} />
                  <Button variant="ghost" size="icon-xs" className="text-muted-foreground hover:text-destructive" aria-label={t('settings.terminal.profiles.form.removeArgument', { index: index + 1 })}
                    onClick={() => setArgs((rows) => rows.filter(({ id }) => id !== row.id))}><TbMinus aria-hidden /></Button>
                </div>)}
              </RowsTable>
            </SettingsField>
            <SettingsField label={t('settings.terminal.profiles.form.env')} feedbackId={`${fieldId('env')}-feedback`}
              error={error('env')} hint={t('settings.terminal.profiles.form.envHint')}>
              <RowsTable id={fieldId('env')} describedBy={`${fieldId('env')}-feedback`} addLabel={t('settings.terminal.profiles.form.addEnv')} addDisabled={draft.env.length >= 64}
                onAdd={() => setEnv((rows) => [...rows, { id: crypto.randomUUID(), key: '', value: '', unset: false }])}>
                {draft.env.map((row, index) => {
                  const updateRow = (patch: Partial<EnvironmentRow>) => setEnv((rows) => rows.map((variable) => variable.id === row.id ? { ...variable, ...patch } : variable))
                  const unsetId = `${id}-unset-${row.id}`
                  return <div key={row.id} className="min-w-0 space-y-1.5 px-2 py-1.5">
                    <div className="flex min-w-0 items-center gap-2">
                      <Input value={row.key} autoComplete="off" spellCheck={false} maxLength={256} className="w-[38%] min-w-0 shrink-0 font-mono" placeholder={t('settings.terminal.profiles.form.envKeyPlaceholder')}
                        aria-label={t('settings.terminal.profiles.form.envKey', { index: index + 1 })} aria-invalid={attempted && Boolean(errors.env)} onChange={(event) => updateRow({ key: event.target.value })} />
                      <Input value={row.value} autoComplete="off" spellCheck={false} maxLength={4096} disabled={row.unset} className="min-w-0 flex-1 font-mono" placeholder={t('settings.terminal.profiles.form.envValuePlaceholder')}
                        aria-label={t('settings.terminal.profiles.form.envValue', { index: index + 1 })} aria-invalid={attempted && Boolean(errors.env)} onChange={(event) => updateRow({ value: event.target.value })} />
                      <Button variant="ghost" size="icon-xs" className="text-muted-foreground hover:text-destructive" aria-label={t('settings.terminal.profiles.form.removeEnv', { index: index + 1 })}
                        onClick={() => setEnv((rows) => rows.filter(({ id }) => id !== row.id))}><TbMinus aria-hidden /></Button>
                    </div>
                    <div className="flex items-center gap-2 pl-0.5"><Checkbox id={unsetId} checked={row.unset} onCheckedChange={(checked) => updateRow({ unset: checked === true })} />
                      <label htmlFor={unsetId} className="cursor-pointer text-caption text-muted-foreground">{t('settings.terminal.profiles.form.unset')}</label></div>
                  </div>
                })}
              </RowsTable>
            </SettingsField>
          </SettingsDisclosure>
        </SettingsGroup>
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </SettingsSheet>
    <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>{t('settings.terminal.profiles.form.discardTitle')}</AlertDialogTitle><AlertDialogDescription>{t('settings.terminal.profiles.form.discardDescription')}</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel><AlertDialogAction onClick={onClose}>{t('app.shutdown.discard')}</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>
}
