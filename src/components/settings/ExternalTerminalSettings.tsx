import * as React from 'react'
import { TbAlertTriangle, TbCheck, TbExternalLink, TbLoader2, TbPencil, TbPlus, TbRefresh, TbTrash } from 'react-icons/tb'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { FormDialog, FormRow } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useT } from '@/i18n'
import { isMacPlatform } from '@/lib/keyboard-shortcuts'
import { terminalCustomExternalAppSchema, type TerminalCustomExternalApp, type TerminalExternalAdapter, type TerminalExternalApp } from '@/shared/terminal-profiles'
import { useSettings, useSettingsSaveStatus, useUpdateSettings } from '@/store/settings'
import { SettingRow, SettingSection } from './common'

const AUTOMATIC_APP = '__automatic__'
const APP_ADAPTERS: Array<{ value: TerminalExternalAdapter; label: string; platforms: string[] }> = [
  { value: 'mac-terminal', label: 'Terminal.app', platforms: ['mac'] },
  { value: 'mac-iterm', label: 'iTerm', platforms: ['mac'] },
  { value: 'ghostty', label: 'Ghostty', platforms: ['mac', 'linux'] },
  { value: 'windows-terminal', label: 'Windows Terminal', platforms: ['windows'] },
  { value: 'windows-powershell', label: 'Windows PowerShell', platforms: ['windows'] },
  { value: 'windows-cmd', label: 'Command Prompt', platforms: ['windows'] },
  { value: 'gnome-terminal', label: 'GNOME Terminal', platforms: ['linux'] },
  { value: 'konsole', label: 'Konsole', platforms: ['linux'] },
  { value: 'xfce4-terminal', label: 'Xfce Terminal', platforms: ['linux'] },
  { value: 'kitty', label: 'kitty', platforms: ['linux'] },
  { value: 'alacritty', label: 'Alacritty', platforms: ['linux'] },
]

function availableAdapters(current?: TerminalExternalAdapter) {
  const platform = isMacPlatform() ? 'mac' : /Windows/i.test(navigator.userAgent) ? 'windows' : 'linux'
  return APP_ADAPTERS.filter((app) => app.platforms.includes(platform) || app.value === current)
}

function ExternalAppForm({ initial, editing, blocked, onSave, onClose }: {
  initial: TerminalCustomExternalApp
  editing: boolean
  blocked: boolean
  onSave(app: TerminalCustomExternalApp): Promise<boolean>
  onClose(): void
}) {
  const t = useT()
  const [draft, setDraft] = React.useState(initial)
  const [attempted, setAttempted] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [failed, setFailed] = React.useState(false)
  const [confirmDiscard, setConfirmDiscard] = React.useState(false)
  const busyRef = React.useRef(false)
  const id = React.useId()
  const result = terminalCustomExternalAppSchema.safeParse(draft)
  const invalid = new Set(result.success ? [] : result.error.issues.map((issue) => String(issue.path[0])))
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial)
  const close = () => { if (!busyRef.current) { if (dirty) setConfirmDiscard(true); else onClose() } }
  const save = async () => {
    if (busyRef.current || blocked) return
    setAttempted(true)
    if (!result.success) {
      document.getElementById(`${id}-${[...invalid][0]}`)?.focus()
      return
    }
    busyRef.current = true
    setSaving(true)
    setFailed(false)
    try {
      if (await onSave(result.data)) onClose()
      else setFailed(true)
    } catch { setFailed(true) }
    finally { busyRef.current = false; setSaving(false) }
  }
  return <>
    <FormDialog open onOpenChange={(open) => { if (!open) close() }} title={t(editing ? 'settings.terminal.external.editTitle' : 'settings.terminal.external.addTitle')}
      description={t('settings.terminal.external.formDescription')} cancelLabel={t('common.cancel')} submitLabel={t(saving ? 'settings.redesign.save.saving' : 'common.save')} onSubmit={save} disabled={saving} submitDisabled={blocked}>
      <form className="space-y-5" onSubmit={(event) => { event.preventDefault(); void save() }}>
        <FormRow label={t('settings.terminal.external.name')} htmlFor={`${id}-name`} error={attempted && invalid.has('name') ? t('settings.terminal.profiles.form.nameError') : undefined}>
          <Input id={`${id}-name`} autoFocus autoComplete="off" value={draft.name} maxLength={128} onChange={(event) => setDraft({ ...draft, name: event.target.value })} aria-invalid={attempted && invalid.has('name')} />
        </FormRow>
        <FormRow label={t('settings.terminal.external.application')} htmlFor={`${id}-adapter`} hint={t('settings.terminal.external.applicationHint')}>
          <Select value={draft.adapter} onValueChange={(value) => setDraft({ ...draft, adapter: value as TerminalExternalAdapter })}>
            <SelectTrigger id={`${id}-adapter`}><SelectValue /></SelectTrigger>
            <SelectContent>{availableAdapters(initial.adapter).map((app) => <SelectItem key={app.value} value={app.value}>{app.label}</SelectItem>)}</SelectContent>
          </Select>
        </FormRow>
        <FormRow label={t('settings.terminal.external.executable')} htmlFor={`${id}-executable`} hint={t('settings.terminal.external.executableHint')} error={attempted && invalid.has('executable') ? t('settings.terminal.profiles.form.executableError') : undefined}>
          <Input id={`${id}-executable`} autoComplete="off" spellCheck={false} className="font-mono" value={draft.executable} maxLength={4096} onChange={(event) => setDraft({ ...draft, executable: event.target.value })} aria-invalid={attempted && invalid.has('executable')} />
        </FormRow>
        {failed ? <p role="alert" className="text-caption text-destructive">{t('settings.terminal.profiles.form.saveFailed')}</p> : null}
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

export function ExternalTerminalSettings() {
  const t = useT()
  const { terminal } = useSettings()
  const { updateTerminal } = useUpdateSettings()
  const saveStatus = useSettingsSaveStatus()
  const [apps, setApps] = React.useState<TerminalExternalApp[]>([])
  const [loading, setLoading] = React.useState(true)
  const [loaded, setLoaded] = React.useState(false)
  const [loadFailed, setLoadFailed] = React.useState(false)
  const [saveFailed, setSaveFailed] = React.useState(false)
  const [editing, setEditing] = React.useState<{ app: TerminalCustomExternalApp; existing: boolean } | null>(null)
  const [removing, setRemoving] = React.useState<TerminalCustomExternalApp | null>(null)
  const [removingBusy, setRemovingBusy] = React.useState(false)
  const requestId = React.useRef(0)
  const mounted = React.useRef(true)
  const removeBusyRef = React.useRef(false)
  const busy = saveStatus === 'saving' || removingBusy
  const revision = JSON.stringify([terminal.externalApps, terminal.defaultExternalAppId, terminal.defaultExternalAppSnapshot])

  const refresh = React.useCallback(async (force = false) => {
    const request = ++requestId.current
    setLoading(true)
    setLoadFailed(false)
    try {
      const api = window.pipilot?.terminal
      if (!api) throw new Error('Terminal API unavailable')
      const next = await api.listExternalApps(force)
      if (!mounted.current || request !== requestId.current) return
      setApps(next)
      setLoaded(true)
    } catch { if (mounted.current && request === requestId.current) setLoadFailed(true) }
    finally { if (mounted.current && request === requestId.current) setLoading(false) }
  }, [])
  React.useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; requestId.current += 1 }
  }, [])
  React.useEffect(() => {
    if (saveStatus === 'saving') { requestId.current += 1; return }
    void refresh()
  }, [revision, saveStatus, refresh])

  const mergedApps: TerminalExternalApp[] = [
    ...apps.filter((app) => app.source !== 'custom'),
    ...terminal.externalApps.map((app): TerminalExternalApp => ({
      id: app.id, label: app.name, source: 'custom', adapter: app.adapter, executable: app.executable,
      available: apps.find(({ id }) => id === app.id)?.available ?? true,
      unavailableReason: apps.find(({ id }) => id === app.id)?.unavailableReason,
    })),
  ]
  const selected = mergedApps.find(({ id }) => id === terminal.defaultExternalAppId)
  const unavailable = terminal.defaultExternalAppId !== null && loaded && !loading && !loadFailed && !selected?.available
  const automatic = mergedApps.find((app) => app.available && app.source === 'detected')
  const saveDefault = async (value: string) => {
    const app = mergedApps.find(({ id }) => id === value)
    const saved = await updateTerminal({
      defaultExternalAppId: value === AUTOMATIC_APP ? null : value,
      defaultExternalAppSnapshot: app ? { id: app.id, label: app.label, executable: app.executable, adapter: app.adapter } : null,
    }).catch(() => false)
    if (mounted.current) setSaveFailed(!saved)
  }
  const saveApp = (app: TerminalCustomExternalApp) => updateTerminal({
    externalApps: editing?.existing ? terminal.externalApps.map((item) => item.id === app.id ? app : item) : [...terminal.externalApps, app],
    ...(terminal.defaultExternalAppId === app.id ? { defaultExternalAppSnapshot: { id: app.id, label: app.name, executable: app.executable, adapter: app.adapter } } : {}),
  })
  const remove = async () => {
    if (!removing || busy || removeBusyRef.current) return
    removeBusyRef.current = true
    setRemovingBusy(true)
    setSaveFailed(false)
    try {
      const saved = await updateTerminal({ externalApps: terminal.externalApps.filter(({ id }) => id !== removing.id), ...(terminal.defaultExternalAppId === removing.id ? { defaultExternalAppId: null, defaultExternalAppSnapshot: null } : {}) })
      if (!mounted.current) return
      if (saved) setRemoving(null)
      else setSaveFailed(true)
    } catch { if (mounted.current) setSaveFailed(true) }
    finally { removeBusyRef.current = false; if (mounted.current) setRemovingBusy(false) }
  }

  return <>
    <SettingSection title={t('settings.terminal.external.title')} desc={t('settings.terminal.external.description')}>
      <SettingRow label={t('settings.terminal.external.default')} desc={t('settings.terminal.external.defaultDescription')}>
        <Select value={terminal.defaultExternalAppId ?? AUTOMATIC_APP} disabled={busy} onValueChange={(value) => void saveDefault(value)}>
          <SelectTrigger className="w-full min-w-0 sm:w-64" aria-label={t('settings.terminal.external.default')}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={AUTOMATIC_APP}>{t('settings.terminal.profiles.automatic')}</SelectItem>
            {mergedApps.map((app) => <SelectItem key={app.id} value={app.id} disabled={!app.available}>{app.label}{!app.available ? ` · ${t('settings.terminal.profiles.unavailable')}` : ''}</SelectItem>)}
            {terminal.defaultExternalAppId && !selected ? <SelectItem value={terminal.defaultExternalAppId} disabled>{terminal.defaultExternalAppSnapshot?.label ?? t('settings.terminal.external.savedDefault')} · {t('settings.terminal.profiles.unavailable')}</SelectItem> : null}
          </SelectContent>
        </Select>
      </SettingRow>
      {!terminal.defaultExternalAppId && automatic && !loading && !loadFailed ? <p className="text-caption text-muted-foreground">{t('settings.terminal.profiles.automaticResolved', { name: automatic.label })}</p> : null}
      {unavailable ? <div role="alert" className="flex min-w-0 flex-wrap items-center gap-3 bg-warning/8">
        <TbAlertTriangle className="size-4 shrink-0 text-warning" aria-hidden /><p className="min-w-0 flex-1 text-caption">{t('settings.terminal.external.defaultUnavailable')}</p>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void saveDefault(AUTOMATIC_APP)}>{t('settings.terminal.profiles.useAutomatic')}</Button>
      </div> : null}
      {saveFailed && !removing ? <p role="alert" className="text-caption text-destructive">{t('settings.terminal.profiles.form.saveFailed')}</p> : null}
    </SettingSection>
    <section className="min-w-0 pb-6" aria-label={t('settings.terminal.external.listTitle')}>
      <header className="mb-2 flex min-w-0 flex-wrap items-center gap-2 px-1">
        <h2 className="min-w-0 flex-1 text-app font-semibold">{t('settings.terminal.external.listTitle')}</h2>
        <Button variant="ghost" size="sm" disabled={loading || busy} onClick={() => void refresh(true)}><TbRefresh aria-hidden className={loading ? 'animate-spin' : undefined} />{t('settings.terminal.profiles.refresh')}</Button>
        <Button variant="outline" size="sm" disabled={busy || terminal.externalApps.length >= 64} onClick={() => setEditing({ existing: false, app: { id: `external:custom:${crypto.randomUUID()}`, name: '', executable: '', adapter: availableAdapters()[0].value } })}><TbPlus aria-hidden />{t('settings.terminal.external.add')}</Button>
      </header>
      {loading ? <p role="status" className="flex items-center gap-2 px-1 pb-2 text-caption text-muted-foreground"><TbLoader2 aria-hidden className="size-3.5 animate-spin" />{t('settings.terminal.external.loading')}</p> : null}
      {loadFailed ? <p role="alert" className="px-1 pb-2 text-caption text-destructive">{t('settings.terminal.external.loadFailed')}</p> : null}
      <ul className="mac-group min-w-0 overflow-hidden">
        {mergedApps.map((app) => {
          const custom = terminal.externalApps.find(({ id }) => id === app.id)
          return <li key={app.id} className="group/external flex min-w-0 items-center gap-3 py-2.5" data-external-terminal-app-id={app.id}>
            <span className="grid size-7 shrink-0 place-items-center rounded-[7px] bg-fill text-foreground/70"><TbExternalLink className="size-4" aria-hidden /></span>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-2"><span className="break-words text-app font-medium">{app.label}</span><span className="text-micro text-muted-foreground">{t(custom ? 'settings.terminal.profiles.sourceCustom' : 'settings.terminal.profiles.sourceDetected')}</span>{terminal.defaultExternalAppId === app.id ? <span className="inline-flex items-center gap-0.5 text-micro text-primary"><TbCheck className="size-3" aria-hidden />{t('settings.terminal.profiles.selected')}</span> : null}</div>
              <p className="mt-0.5 break-all font-mono text-micro text-muted-foreground">{app.executable}</p>
              {!app.available ? <p className="mt-0.5 text-caption text-destructive">{t(app.unavailableReason === 'unsupported-platform' ? 'settings.terminal.external.unsupportedPlatform' : 'settings.terminal.profiles.executableUnavailable')}</p> : null}
            </div>
            {custom ? <div className="flex shrink-0 items-center gap-0.5">
              <Button variant="ghost" size="icon-sm" disabled={busy} aria-label={t('settings.terminal.external.editNamed', { name: app.label })} title={t('settings.terminal.external.editNamed', { name: app.label })} onClick={() => setEditing({ existing: true, app: custom })}><TbPencil aria-hidden /></Button>
              <Button variant="ghost" size="icon-sm" disabled={busy} aria-label={t('settings.terminal.external.removeNamed', { name: app.label })} title={t('settings.terminal.external.removeNamed', { name: app.label })} onClick={() => { setSaveFailed(false); setRemoving(custom) }}><TbTrash aria-hidden /></Button>
            </div> : null}
          </li>
        })}
        {!loading && !mergedApps.length ? <li className="py-6 text-center text-caption text-muted-foreground">{t('settings.terminal.external.empty')}</li> : null}
      </ul>
      {terminal.externalApps.length >= 64 ? <p className="px-1 pt-2 text-caption text-muted-foreground">{t('settings.terminal.external.limit')}</p> : null}
    </section>
    {editing ? <ExternalAppForm key={editing.app.id} initial={editing.app} editing={editing.existing} blocked={busy} onSave={saveApp} onClose={() => setEditing(null)} /> : null}
    <AlertDialog open={Boolean(removing)} onOpenChange={(open) => { if (!open && !removeBusyRef.current) setRemoving(null) }}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>{t('settings.terminal.profiles.removeTitle', { name: removing?.name ?? '' })}</AlertDialogTitle><AlertDialogDescription>{t(removing?.id === terminal.defaultExternalAppId ? 'settings.terminal.external.removeDefaultDescription' : 'settings.terminal.external.removeDescription')}</AlertDialogDescription></AlertDialogHeader>
        {saveFailed ? <p role="alert" className="text-caption text-destructive">{t('settings.terminal.profiles.removeFailed')}</p> : null}
        <AlertDialogFooter><AlertDialogCancel disabled={removingBusy}>{t('common.cancel')}</AlertDialogCancel><Button variant="destructive" disabled={busy} onClick={() => void remove()}>{t(removingBusy ? 'settings.redesign.save.saving' : 'settings.terminal.external.remove')}</Button></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>
}
