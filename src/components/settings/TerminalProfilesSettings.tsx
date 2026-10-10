import * as React from 'react'
import { TbAlertTriangle, TbCheck, TbDots, TbPencil, TbPlus, TbRefresh, TbTerminal2, TbTrash } from 'react-icons/tb'
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import type { TerminalCustomProfile, TerminalShellProfile } from '@/shared/terminal-profiles'
import { useSettings, useSettingsSaveStatus, useUpdateSettings } from '@/store/settings'
import { SettingsBadge, SettingsGroup, SettingsListRow, SettingsRow, StatusText } from './kit'
import { TerminalProfileSheet } from './TerminalProfileSheet'

const AUTOMATIC_PROFILE = '__automatic__'

export function TerminalRowIcon({ available = true, icon: Icon = TbTerminal2 }: { available?: boolean; icon?: React.ComponentType<{ className?: string }> }) {
  return <span className={cn('grid size-8 shrink-0 place-items-center rounded-[9px] bg-[linear-gradient(to_bottom,rgb(255_255_255/0.16),transparent)] text-white shadow-[inset_0_0_0_0.5px_rgb(0_0_0/0.1)]',
    available ? 'bg-[#2c2c2e] dark:bg-[#48484a]' : 'bg-[#8e8e93]')} aria-hidden>
    <Icon className="size-[18px]" />
  </span>
}

/** A saved default that is gone: say so in the group, with a way back to Auto. */
export function UnavailableDefaultRow({ id, message, busy, onUseAutomatic }: { id?: string; message: string; busy: boolean; onUseAutomatic(): void }) {
  const t = useT()
  return <div id={id} data-settings-row role="alert" className="flex min-w-0 flex-wrap items-center gap-3 bg-warning/8 px-3 py-2">
    <TbAlertTriangle className="size-4 shrink-0 text-warning" aria-hidden />
    <p className="min-w-0 flex-1 text-caption text-foreground">{message}</p>
    <Button variant="outline" size="sm" disabled={busy} onClick={onUseAutomatic}>{t('settings.terminal.profiles.useAutomatic')}</Button>
  </div>
}

/** The shells new integrated terminals can run: which one is the default, and the custom ones. */
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

  const refresh = React.useCallback(async (force = false) => {
    const request = ++requestId.current
    setLoading(true)
    setLoadFailed(false)
    try {
      const api = window.pipilot?.terminal
      if (!api) throw new Error('Terminal API unavailable')
      const next = await api.listShellProfiles(force)
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
      label: !profile.available && !profile.executable
        ? terminal.defaultProfileSnapshot?.id === profile.id ? terminal.defaultProfileSnapshot.label : t('settings.terminal.profiles.savedDefault')
        : profile.label,
      executable: profile.executable || (terminal.defaultProfileSnapshot?.id === profile.id ? terminal.defaultProfileSnapshot.executable : ''),
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

  const setDefault = (value: string) => {
    const profile = mergedProfiles.find(({ id }) => id === value)
    void updateTerminal({ defaultProfileId: value === AUTOMATIC_PROFILE ? null : value, defaultProfileSnapshot: profile ? { id: profile.id, label: profile.label, executable: profile.executable } : null })
  }
  const add = () => setEditing({ mode: 'add', profile: { id: `custom:${crypto.randomUUID()}`, name: '', executable: '', args: [], env: {} } })
  const saveProfile = async (profile: TerminalCustomProfile) => {
    const existing = terminal.profiles.some(({ id }) => id === profile.id)
    if (editing?.mode === 'edit' && !existing) return false
    const next = existing ? terminal.profiles.map((item) => item.id === profile.id ? profile : item) : [...terminal.profiles, profile]
    return updateTerminal({
      profiles: next,
      ...(terminal.defaultProfileId === profile.id ? { defaultProfileSnapshot: { id: profile.id, label: profile.name, executable: profile.executable } } : {}),
    })
  }
  const remove = async () => {
    if (!removing || busy || removeBusyRef.current) return
    removeBusyRef.current = true
    setRemovingBusy(true)
    setRemoveFailed(false)
    try {
      const saved = await updateTerminal({
        profiles: terminal.profiles.filter(({ id }) => id !== removing.id),
        ...(terminal.defaultProfileId === removing.id ? { defaultProfileId: null, defaultProfileSnapshot: null } : {}),
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
    <SettingsGroup title={t('settings.terminal.profiles.title')} info={t('settings.terminal.profiles.description')} data-terminal-profiles-default>
      <SettingsRow label={t('settings.terminal.profiles.default')} info={t('settings.terminal.profiles.defaultDescription')}
        description={terminal.defaultProfileId === null && automaticProfile && !loading && !busy && !loadFailed ? t('settings.terminal.profiles.automaticResolved', { name: automaticProfile.label }) : undefined}>
        <Select value={terminal.defaultProfileId ?? AUTOMATIC_PROFILE} disabled={busy} onValueChange={setDefault}>
          <SelectTrigger id={selectionId} className="w-56 max-w-full" aria-label={t('settings.terminal.profiles.default')} aria-describedby={defaultUnavailable ? `${selectionId}-warning` : undefined}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={AUTOMATIC_PROFILE}>{t('settings.terminal.profiles.automatic')}</SelectItem>
            {mergedProfiles.map((profile) => <SelectItem key={profile.id} value={profile.id} disabled={!profile.available}>{profile.label}{!profile.available ? ` · ${t('settings.terminal.profiles.unavailable')}` : ''}</SelectItem>)}
            {missingDefault ? <SelectItem value={terminal.defaultProfileId!} disabled>{terminal.defaultProfileSnapshot?.label ?? t('settings.terminal.profiles.savedDefault')} · {t('settings.terminal.profiles.unavailable')}</SelectItem> : null}
          </SelectContent>
        </Select>
      </SettingsRow>
      {defaultUnavailable ? <UnavailableDefaultRow id={`${selectionId}-warning`} message={t('settings.terminal.profiles.defaultUnavailable')} busy={busy}
        onUseAutomatic={() => { void updateTerminal({ defaultProfileId: null, defaultProfileSnapshot: null }) }} /> : null}
    </SettingsGroup>

    <SettingsGroup title={t('settings.terminal.profiles.listTitle')} boxRole="list" data-terminal-profiles
      actions={<>
        <Button variant="ghost" size="icon-sm" aria-label={t('settings.terminal.profiles.refresh')} title={t('settings.terminal.profiles.refresh')} disabled={loading || busy} onClick={() => void refresh(true)}>
          <TbRefresh aria-hidden className={loading ? 'animate-spin motion-reduce:animate-none' : undefined} />
        </Button>
        <Button variant="outline" size="sm" disabled={busy || terminal.profiles.length >= 64} onClick={add}><TbPlus aria-hidden />{t('settings.terminal.profiles.add')}</Button>
      </>}
      footer={loadFailed ? <span className="text-destructive" role="alert">{t('settings.terminal.profiles.loadFailed')}</span>
        : terminal.profiles.length >= 64 ? t('settings.terminal.profiles.limit') : undefined}>
      {mergedProfiles.map((profile) => {
        const custom = terminal.profiles.find(({ id }) => id === profile.id)
        const isDefault = terminal.defaultProfileId === profile.id
        return <SettingsListRow key={profile.id} data-terminal-profile-id={profile.id} disabled={busy}
          icon={<TerminalRowIcon available={profile.available} />}
          title={profile.label}
          badges={<>
            <SettingsBadge>{t(profile.source === 'custom' ? 'settings.terminal.profiles.sourceCustom' : profile.source === 'wsl' ? 'settings.terminal.profiles.sourceWsl' : 'settings.terminal.profiles.sourceDetected')}</SettingsBadge>
            {isDefault ? <SettingsBadge tone="accent">{t('settings.terminal.profiles.selected')}</SettingsBadge> : null}
          </>}
          subtitle={<span className="font-mono">{profile.executable}</span>}
          status={!profile.available ? <StatusText tone="danger" title={t(profile.unavailableReason === 'distribution-unavailable' ? 'settings.terminal.profiles.distributionUnavailable' : 'settings.terminal.profiles.executableUnavailable')}>
            {t('settings.terminal.profiles.unavailable')}
          </StatusText> : undefined}
          onOpen={custom ? () => setEditing({ mode: 'edit', profile: custom }) : undefined}
          openLabel={custom ? t('settings.terminal.profiles.editNamed', { name: profile.label }) : undefined}
          menu={<DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-xs" className="text-muted-foreground" disabled={busy} aria-label={t('settings.terminal.profiles.actions', { name: profile.label })}><TbDots aria-hidden /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem disabled={isDefault || !profile.available} onSelect={() => setDefault(profile.id)}><TbCheck aria-hidden />{t('settings.terminal.profiles.makeDefault')}</DropdownMenuItem>
              {custom ? <>
                <DropdownMenuItem onSelect={() => setEditing({ mode: 'edit', profile: custom })}><TbPencil aria-hidden />{t('settings.terminal.profiles.edit')}</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => { setRemoveFailed(false); setRemoving(custom) }}><TbTrash aria-hidden />{t('settings.terminal.profiles.remove')}</DropdownMenuItem>
              </> : null}
            </DropdownMenuContent>
          </DropdownMenu>} />
      })}
      {mergedProfiles.length === 0 ? <div data-settings-row role="status" className="px-3 py-8 text-center text-caption text-muted-foreground">
        {t(loading ? 'settings.terminal.profiles.loading' : 'settings.terminal.profiles.empty')}
      </div> : null}
    </SettingsGroup>

    {editing ? <TerminalProfileSheet key={editing.profile.id} initial={editing.profile} mode={editing.mode} saveBlocked={busy} onClose={() => setEditing(null)} onSave={saveProfile} /> : null}
    <AlertDialog open={Boolean(removing)} onOpenChange={(open) => { if (!open && !removeBusyRef.current) setRemoving(null) }}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>{t('settings.terminal.profiles.removeTitle', { name: removing?.name ?? '' })}</AlertDialogTitle><AlertDialogDescription>{t(removing?.id === terminal.defaultProfileId ? 'settings.terminal.profiles.removeDefaultDescription' : 'settings.terminal.profiles.removeDescription')}</AlertDialogDescription></AlertDialogHeader>
        {removeFailed ? <p role="alert" className="text-caption text-destructive">{t('settings.terminal.profiles.removeFailed')}</p> : null}
        <AlertDialogFooter><AlertDialogCancel disabled={removingBusy}>{t('common.cancel')}</AlertDialogCancel><Button variant="destructive" disabled={busy} onClick={() => void remove()}>{t(removingBusy ? 'settings.redesign.save.saving' : 'settings.terminal.profiles.remove')}</Button></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>
}
