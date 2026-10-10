import * as React from 'react'
import { TbCheck, TbDots, TbExternalLink, TbPencil, TbPlus, TbRefresh, TbTrash } from 'react-icons/tb'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useT } from '@/i18n'
import { isMacPlatform } from '@/lib/keyboard-shortcuts'
import { terminalCustomExternalAppSchema, type TerminalCustomExternalApp, type TerminalExternalAdapter, type TerminalExternalApp } from '@/shared/terminal-profiles'
import { useSettings, useSettingsSaveStatus, useUpdateSettings } from '@/store/settings'
import { FormActions, SettingsBadge, SettingsField, SettingsGroup, SettingsListRow, SettingsRow, SettingsSheet, StatusText } from './kit'
import { TerminalRowIcon, UnavailableDefaultRow } from './TerminalProfilesSettings'

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

function ExternalAppSheet({ initial, editing, blocked, onSave, onClose }: {
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
    <SettingsSheet open onOpenChange={(open) => { if (!open) close() }} data-external-terminal-sheet
      title={t(editing ? 'settings.terminal.external.editTitle' : 'settings.terminal.external.addTitle')} description={t('settings.terminal.external.formDescription')}
      footer={<FormActions onCancel={close} onSave={() => void save()} saving={saving} canSave={!blocked} error={failed ? t('settings.terminal.profiles.form.saveFailed') : null} />}>
      <form onSubmit={(event) => { event.preventDefault(); void save() }}>
        <SettingsGroup>
          <SettingsField label={t('settings.terminal.external.name')} htmlFor={`${id}-name`} error={attempted && invalid.has('name') ? t('settings.terminal.profiles.form.nameError') : undefined}>
            <Input id={`${id}-name`} autoFocus autoComplete="off" value={draft.name} maxLength={128} onChange={(event) => setDraft({ ...draft, name: event.target.value })} aria-invalid={attempted && invalid.has('name')} />
          </SettingsField>
          <SettingsField label={t('settings.terminal.external.application')} htmlFor={`${id}-adapter`} hint={t('settings.terminal.external.applicationHint')}>
            <Select value={draft.adapter} onValueChange={(value) => setDraft({ ...draft, adapter: value as TerminalExternalAdapter })}>
              <SelectTrigger id={`${id}-adapter`} className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{availableAdapters(initial.adapter).map((app) => <SelectItem key={app.value} value={app.value}>{app.label}</SelectItem>)}</SelectContent>
            </Select>
          </SettingsField>
          <SettingsField label={t('settings.terminal.external.executable')} htmlFor={`${id}-executable`} hint={t('settings.terminal.external.executableHint')}
            error={attempted && invalid.has('executable') ? t('settings.terminal.profiles.form.executableError') : undefined}>
            <Input id={`${id}-executable`} autoComplete="off" spellCheck={false} className="font-mono" value={draft.executable} maxLength={4096}
              onChange={(event) => setDraft({ ...draft, executable: event.target.value })} aria-invalid={attempted && invalid.has('executable')} />
          </SettingsField>
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

/** Separate terminal applications a project folder can open in. */
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
    <SettingsGroup title={t('settings.terminal.external.title')} info={t('settings.terminal.external.description')} data-external-terminal-default
      footer={saveFailed && !removing ? <span className="text-destructive" role="alert">{t('settings.terminal.profiles.form.saveFailed')}</span> : undefined}>
      <SettingsRow label={t('settings.terminal.external.default')} info={t('settings.terminal.external.defaultDescription')}
        description={!terminal.defaultExternalAppId && automatic && !loading && !loadFailed ? t('settings.terminal.profiles.automaticResolved', { name: automatic.label }) : undefined}>
        <Select value={terminal.defaultExternalAppId ?? AUTOMATIC_APP} disabled={busy} onValueChange={(value) => void saveDefault(value)}>
          <SelectTrigger className="w-56 max-w-full" aria-label={t('settings.terminal.external.default')}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={AUTOMATIC_APP}>{t('settings.terminal.profiles.automatic')}</SelectItem>
            {mergedApps.map((app) => <SelectItem key={app.id} value={app.id} disabled={!app.available}>{app.label}{!app.available ? ` · ${t('settings.terminal.profiles.unavailable')}` : ''}</SelectItem>)}
            {terminal.defaultExternalAppId && !selected ? <SelectItem value={terminal.defaultExternalAppId} disabled>{terminal.defaultExternalAppSnapshot?.label ?? t('settings.terminal.external.savedDefault')} · {t('settings.terminal.profiles.unavailable')}</SelectItem> : null}
          </SelectContent>
        </Select>
      </SettingsRow>
      {unavailable ? <UnavailableDefaultRow message={t('settings.terminal.external.defaultUnavailable')} busy={busy} onUseAutomatic={() => void saveDefault(AUTOMATIC_APP)} /> : null}
    </SettingsGroup>

    <SettingsGroup title={t('settings.terminal.external.listTitle')} boxRole="list" data-external-terminal-apps
      actions={<>
        <Button variant="ghost" size="icon-sm" aria-label={t('settings.terminal.profiles.refresh')} title={t('settings.terminal.profiles.refresh')} disabled={loading || busy} onClick={() => void refresh(true)}>
          <TbRefresh aria-hidden className={loading ? 'animate-spin motion-reduce:animate-none' : undefined} />
        </Button>
        <Button variant="outline" size="sm" disabled={busy || terminal.externalApps.length >= 64}
          onClick={() => setEditing({ existing: false, app: { id: `external:custom:${crypto.randomUUID()}`, name: '', executable: '', adapter: availableAdapters()[0].value } })}>
          <TbPlus aria-hidden />{t('settings.terminal.external.add')}
        </Button>
      </>}
      footer={loadFailed ? <span className="text-destructive" role="alert">{t('settings.terminal.external.loadFailed')}</span>
        : terminal.externalApps.length >= 64 ? t('settings.terminal.external.limit') : undefined}>
      {mergedApps.map((app) => {
        const custom = terminal.externalApps.find(({ id }) => id === app.id)
        const isDefault = terminal.defaultExternalAppId === app.id
        return <SettingsListRow key={app.id} data-external-terminal-app-id={app.id} disabled={busy}
          icon={<TerminalRowIcon available={app.available} icon={TbExternalLink} />}
          title={app.label}
          badges={<>
            {custom ? <SettingsBadge>{t('settings.terminal.profiles.sourceCustom')}</SettingsBadge> : null}
            {isDefault ? <SettingsBadge tone="accent">{t('settings.terminal.profiles.selected')}</SettingsBadge> : null}
          </>}
          subtitle={<span className="font-mono">{app.executable}</span>}
          status={!app.available ? <StatusText tone="danger" title={t(app.unavailableReason === 'unsupported-platform' ? 'settings.terminal.external.unsupportedPlatform' : 'settings.terminal.profiles.executableUnavailable')}>
            {t('settings.terminal.profiles.unavailable')}
          </StatusText> : undefined}
          onOpen={custom ? () => setEditing({ existing: true, app: custom }) : undefined}
          openLabel={custom ? t('settings.terminal.external.editNamed', { name: app.label }) : undefined}
          menu={<DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-xs" className="text-muted-foreground" disabled={busy} aria-label={t('settings.terminal.profiles.actions', { name: app.label })}><TbDots aria-hidden /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem disabled={isDefault || !app.available} onSelect={() => void saveDefault(app.id)}><TbCheck aria-hidden />{t('settings.terminal.profiles.makeDefault')}</DropdownMenuItem>
              {custom ? <>
                <DropdownMenuItem onSelect={() => setEditing({ existing: true, app: custom })}><TbPencil aria-hidden />{t('settings.terminal.profiles.edit')}</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => { setSaveFailed(false); setRemoving(custom) }}><TbTrash aria-hidden />{t('settings.terminal.external.remove')}</DropdownMenuItem>
              </> : null}
            </DropdownMenuContent>
          </DropdownMenu>} />
      })}
      {!mergedApps.length ? <div data-settings-row role="status" className="px-3 py-8 text-center text-caption text-muted-foreground">
        {t(loading ? 'settings.terminal.external.loading' : 'settings.terminal.external.empty')}
      </div> : null}
    </SettingsGroup>

    {editing ? <ExternalAppSheet key={editing.app.id} initial={editing.app} editing={editing.existing} blocked={busy} onSave={saveApp} onClose={() => setEditing(null)} /> : null}
    <AlertDialog open={Boolean(removing)} onOpenChange={(open) => { if (!open && !removeBusyRef.current) setRemoving(null) }}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>{t('settings.terminal.profiles.removeTitle', { name: removing?.name ?? '' })}</AlertDialogTitle><AlertDialogDescription>{t(removing?.id === terminal.defaultExternalAppId ? 'settings.terminal.external.removeDefaultDescription' : 'settings.terminal.external.removeDescription')}</AlertDialogDescription></AlertDialogHeader>
        {saveFailed ? <p role="alert" className="text-caption text-destructive">{t('settings.terminal.profiles.removeFailed')}</p> : null}
        <AlertDialogFooter><AlertDialogCancel disabled={removingBusy}>{t('common.cancel')}</AlertDialogCancel><Button variant="destructive" disabled={busy} onClick={() => void remove()}>{t(removingBusy ? 'settings.redesign.save.saving' : 'settings.terminal.external.remove')}</Button></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>
}
