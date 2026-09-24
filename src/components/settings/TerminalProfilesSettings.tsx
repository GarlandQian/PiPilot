import * as React from 'react'
import { TbAlertTriangle, TbLoader2, TbPencil, TbPlus, TbRefresh, TbTerminal2, TbTrash } from 'react-icons/tb'
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useT } from '@/i18n'
import type { TerminalCustomProfile, TerminalShellProfile } from '@/shared/terminal-profiles'
import { useSettings, useSettingsSaveStatus, useUpdateSettings } from '@/store/settings'
import { SettingRow, SettingSection } from './common'
import { TerminalProfileFormDialog } from './TerminalProfileFormDialog'

const AUTOMATIC_PROFILE = '__automatic__'

export function TerminalProfilesSettings() {
  const t = useT()
  const { terminal } = useSettings()
  const { updateTerminal } = useUpdateSettings()
  const saveStatus = useSettingsSaveStatus()
  const [profiles, setProfiles] = React.useState<TerminalShellProfile[]>([])
  const [loading, setLoading] = React.useState(true)
  const [loadFailed, setLoadFailed] = React.useState(false)
  const [loaded, setLoaded] = React.useState(false)
  const [editing, setEditing] = React.useState<{ mode: 'add' | 'edit'; profile: TerminalCustomProfile } | null>(null)
  const [removing, setRemoving] = React.useState<TerminalCustomProfile | null>(null)
  const [removeFailed, setRemoveFailed] = React.useState(false)
  const [removingBusy, setRemovingBusy] = React.useState(false)
  const requestId = React.useRef(0)
  const mounted = React.useRef(true)
  const removeBusyRef = React.useRef(false)
  const busy = saveStatus === 'saving' || removingBusy
  const selectionId = React.useId()
  const profilesRevision = JSON.stringify(terminal.profiles)

  const refresh = React.useCallback(async () => {
    const request = ++requestId.current
    setLoading(true)
    setLoadFailed(false)
    try {
      const api = window.pipilot?.terminal
      if (!api) throw new Error('Terminal API unavailable')
      const next = await api.listShellProfiles()
      if (!mounted.current || request !== requestId.current) return
      setProfiles(next)
      setLoaded(true)
    } catch {
      if (mounted.current && request === requestId.current) setLoadFailed(true)
    } finally {
      if (mounted.current && request === requestId.current) setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; requestId.current += 1 }
  }, [])

  React.useEffect(() => {
    // Discovery reads persisted profiles; wait until the optimistic save settles.
    if (saveStatus === 'saving') { requestId.current += 1; return }
    void refresh()
  }, [profilesRevision, terminal.defaultProfileId, saveStatus, refresh])

  const mergedProfiles = [
    ...profiles.filter(({ source }) => source !== 'custom').map((profile) => ({
      ...profile,
      label: !profile.available && !profile.executable ? t('settings.terminal.profiles.unavailable') : profile.label,
    })),
    ...terminal.profiles.map((profile): TerminalShellProfile => {
      const found = profiles.find(({ id }) => id === profile.id)
      return {
        id: profile.id,
        label: profile.name,
        source: 'custom',
        executable: profile.executable,
        args: profile.args,
        isDefault: terminal.defaultProfileId === profile.id,
        available: found?.available ?? true,
        unavailableReason: found?.unavailableReason,
      }
    }),
  ]
  const defaultProfile = mergedProfiles.find(({ id }) => id === terminal.defaultProfileId)
  const missingDefault = terminal.defaultProfileId !== null && !defaultProfile
  const defaultUnavailable = terminal.defaultProfileId !== null && loaded && !loading && !loadFailed && (!defaultProfile || !defaultProfile.available)
  const automaticProfile = profiles.find(({ isDefault, source, available }) => isDefault && available && source !== 'custom')

  const add = () => setEditing({ mode: 'add', profile: { id: `custom:${crypto.randomUUID()}`, name: '', executable: '', args: [], env: {} } })
  const saveProfile = async (profile: TerminalCustomProfile) => {
    const existing = terminal.profiles.some(({ id }) => id === profile.id)
    if (editing?.mode === 'edit' && !existing) return false
    const next = existing ? terminal.profiles.map((item) => item.id === profile.id ? profile : item) : [...terminal.profiles, profile]
    return updateTerminal({ profiles: next })
  }
  const remove = async () => {
    if (!removing || busy || removeBusyRef.current) return
    removeBusyRef.current = true
    setRemovingBusy(true)
    setRemoveFailed(false)
    try {
      const saved = await updateTerminal({
        profiles: terminal.profiles.filter(({ id }) => id !== removing.id),
        ...(terminal.defaultProfileId === removing.id ? { defaultProfileId: null } : {}),
      })
      if (!mounted.current) return
      if (saved) setRemoving(null)
      else setRemoveFailed(true)
    } catch {
      if (mounted.current) setRemoveFailed(true)
    } finally {
      removeBusyRef.current = false
      if (mounted.current) setRemovingBusy(false)
    }
  }

  return <>
    <SettingSection title={t('settings.terminal.profiles.title')} desc={t('settings.terminal.profiles.description')}>
      <SettingRow label={t('settings.terminal.profiles.default')} desc={t('settings.terminal.profiles.defaultDescription')}>
        <Select value={terminal.defaultProfileId ?? AUTOMATIC_PROFILE} disabled={busy} onValueChange={(value) => { void updateTerminal({ defaultProfileId: value === AUTOMATIC_PROFILE ? null : value }) }}>
          <SelectTrigger id={selectionId} className="w-full min-w-0 sm:w-64" aria-label={t('settings.terminal.profiles.default')} aria-describedby={defaultUnavailable ? `${selectionId}-warning` : undefined}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={AUTOMATIC_PROFILE}>{t('settings.terminal.profiles.automatic')}</SelectItem>
            {mergedProfiles.map((profile) => <SelectItem key={profile.id} value={profile.id} disabled={!profile.available}>{profile.label}{!profile.available ? ` · ${t('settings.terminal.profiles.unavailable')}` : ''}</SelectItem>)}
            {missingDefault ? <SelectItem value={terminal.defaultProfileId!} disabled>{terminal.defaultProfileId} · {t('settings.terminal.profiles.unavailable')}</SelectItem> : null}
          </SelectContent>
        </Select>
      </SettingRow>
      {terminal.defaultProfileId === null && automaticProfile && !loading && !busy && !loadFailed ? <p className="text-caption text-muted-foreground">{t('settings.terminal.profiles.automaticResolved', { name: automaticProfile.label })}</p> : null}
      {defaultUnavailable ? <div id={`${selectionId}-warning`} role="alert" className="flex min-w-0 flex-wrap items-center gap-3 rounded-md border border-warning/35 bg-warning/5 p-3">
        <TbAlertTriangle className="size-4 shrink-0 text-warning" aria-hidden />
        <p className="min-w-0 flex-1 text-caption text-foreground">{t('settings.terminal.profiles.defaultUnavailable')}</p>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => { void updateTerminal({ defaultProfileId: null }) }}>{t('settings.terminal.profiles.useAutomatic')}</Button>
      </div> : null}
      <div className="mt-3 flex min-w-0 flex-wrap items-center justify-between gap-2">
        <h3 className="text-app font-medium">{t('settings.terminal.profiles.listTitle')}</h3>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" disabled={loading || busy} onClick={() => void refresh()}><TbRefresh aria-hidden className={loading ? 'animate-spin' : undefined} />{t('settings.terminal.profiles.refresh')}</Button>
          <Button variant="outline" size="sm" disabled={busy || terminal.profiles.length >= 64} onClick={add}><TbPlus aria-hidden />{t('settings.terminal.profiles.add')}</Button>
        </div>
      </div>
      {loading ? <p role="status" className="flex items-center gap-2 py-2 text-caption text-muted-foreground"><TbLoader2 aria-hidden className="size-3.5 animate-spin" />{t('settings.terminal.profiles.loading')}</p> : null}
      {loadFailed ? <p role="alert" className="py-2 text-caption text-destructive">{t('settings.terminal.profiles.loadFailed')}</p> : null}
      <ul className="min-w-0 divide-y divide-border overflow-hidden rounded-md border border-border" aria-label={t('settings.terminal.profiles.listTitle')}>
        {mergedProfiles.map((profile) => {
          const custom = terminal.profiles.find(({ id }) => id === profile.id)
          const isSelected = terminal.defaultProfileId === profile.id
          return <li key={profile.id} data-terminal-profile-id={profile.id} className="flex min-w-0 items-start gap-3 bg-surface px-3 py-3">
            <TbTerminal2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"><span className="min-w-0 break-words text-app font-medium">{profile.label}</span><span className="text-micro text-muted-foreground">{t(profile.source === 'custom' ? 'settings.terminal.profiles.sourceCustom' : profile.source === 'wsl' ? 'settings.terminal.profiles.sourceWsl' : 'settings.terminal.profiles.sourceDetected')}</span>{isSelected ? <span className="rounded bg-sage/10 px-1.5 py-0.5 text-micro text-sage">{t('settings.terminal.profiles.selected')}</span> : null}</div>
              <p className="mt-1 break-all font-mono text-micro text-muted-foreground">{profile.executable}</p>
              {!profile.available ? <p className="mt-1 text-caption text-destructive">{t(profile.unavailableReason === 'distribution-unavailable' ? 'settings.terminal.profiles.distributionUnavailable' : 'settings.terminal.profiles.executableUnavailable')}</p> : null}
            </div>
            {custom ? <div className="flex shrink-0 items-center gap-1">
              <Button variant="ghost" size="icon-sm" disabled={busy} aria-label={t('settings.terminal.profiles.editNamed', { name: profile.label })} title={t('settings.terminal.profiles.editNamed', { name: profile.label })} onClick={() => setEditing({ mode: 'edit', profile: custom })}><TbPencil aria-hidden /></Button>
              <Button variant="ghost" size="icon-sm" disabled={busy} aria-label={t('settings.terminal.profiles.removeNamed', { name: profile.label })} title={t('settings.terminal.profiles.removeNamed', { name: profile.label })} onClick={() => { setRemoveFailed(false); setRemoving(custom) }}><TbTrash aria-hidden /></Button>
            </div> : null}
          </li>
        })}
        {!loading && mergedProfiles.length === 0 ? <li className="p-4 text-caption text-muted-foreground">{t('settings.terminal.profiles.empty')}</li> : null}
      </ul>
      {terminal.profiles.length >= 64 ? <p className="text-caption text-muted-foreground">{t('settings.terminal.profiles.limit')}</p> : null}
    </SettingSection>
    {editing ? <TerminalProfileFormDialog key={editing.profile.id} initial={editing.profile} mode={editing.mode} saveBlocked={busy} onClose={() => setEditing(null)} onSave={saveProfile} /> : null}
    <AlertDialog open={Boolean(removing)} onOpenChange={(open) => { if (!open && !removeBusyRef.current) setRemoving(null) }}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>{t('settings.terminal.profiles.removeTitle', { name: removing?.name ?? '' })}</AlertDialogTitle><AlertDialogDescription>{t(removing?.id === terminal.defaultProfileId ? 'settings.terminal.profiles.removeDefaultDescription' : 'settings.terminal.profiles.removeDescription')}</AlertDialogDescription></AlertDialogHeader>
        {removeFailed ? <p role="alert" className="text-caption text-destructive">{t('settings.terminal.profiles.removeFailed')}</p> : null}
        <AlertDialogFooter><AlertDialogCancel disabled={removingBusy}>{t('common.cancel')}</AlertDialogCancel><Button variant="destructive" disabled={busy} onClick={() => void remove()}>{t(removingBusy ? 'settings.redesign.save.saving' : 'settings.terminal.profiles.remove')}</Button></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>
}
