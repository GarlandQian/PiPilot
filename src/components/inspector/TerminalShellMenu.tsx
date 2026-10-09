import * as React from 'react'
import { TbCheck, TbChevronDown, TbLoader2, TbRefresh, TbSettings, TbTerminal2 } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useT } from '@/i18n'
import type { PiPilotApi } from '@/shared/pipilot-api'
import type { TerminalShellProfile } from '@/shared/terminal-profiles'
import { useSettings, useSettingsSaveStatus, useUpdateSettings } from '@/store/settings'
import { TerminalExternalAppMenu } from './TerminalExternalAppMenu'

/** A one-time shell choice never changes the saved default. */
export function TerminalShellMenu({ terminalApi, open, onOpenChange, disabled, focusExternal = false, onCreate, onOpenExternal, onOpenSettings }: {
  terminalApi: PiPilotApi['terminal']
  open: boolean
  onOpenChange(open: boolean): void
  disabled: boolean
  focusExternal?: boolean
  onCreate(profileId: string, profileName: string): void
  onOpenExternal(appId?: string, appName?: string): void
  onOpenSettings?(): void
}) {
  const t = useT()
  const { terminal } = useSettings()
  const { updateTerminal } = useUpdateSettings()
  const saveStatus = useSettingsSaveStatus()
  const [profiles, setProfiles] = React.useState<TerminalShellProfile[]>([])
  const [loading, setLoading] = React.useState(false)
  const [failed, setFailed] = React.useState(false)
  const [saveFailed, setSaveFailed] = React.useState(false)
  const requestId = React.useRef(0)
  const mounted = React.useRef(true)
  const revision = JSON.stringify([terminal.defaultProfileId, terminal.defaultProfileSnapshot, terminal.profiles])

  const load = React.useCallback(async (refresh = false) => {
    const request = ++requestId.current
    setLoading(true)
    setFailed(false)
    try {
      const next = await terminalApi.listShellProfiles(refresh)
      if (mounted.current && request === requestId.current) setProfiles(next)
    } catch {
      if (mounted.current && request === requestId.current) setFailed(true)
    } finally {
      if (mounted.current && request === requestId.current) setLoading(false)
    }
  }, [terminalApi])
  React.useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; requestId.current += 1 }
  }, [])
  React.useEffect(() => {
    if (open && saveStatus !== 'saving') void load()
  }, [open, revision, saveStatus, load])

  const saveDefault = async (profile: TerminalShellProfile | null) => {
    setSaveFailed(false)
    const saved = await updateTerminal({
      defaultProfileId: profile?.id ?? null,
      defaultProfileSnapshot: profile ? { id: profile.id, label: profile.label, executable: profile.executable } : null,
    }).catch(() => false)
    if (!mounted.current) return
    if (saved) onOpenChange(false)
    else setSaveFailed(true)
  }
  const saving = saveStatus === 'saving'

  return <DropdownMenu open={open} onOpenChange={onOpenChange}>
    <DropdownMenuTrigger asChild>
      <Button variant="ghost" size="icon-xs" className="w-5" disabled={disabled} aria-label={t('terminal.drawer.newWithShell')} title={t('terminal.drawer.newWithShell')}><TbChevronDown aria-hidden /></Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="max-w-[min(28rem,calc(100vw-2rem))]">
      <DropdownMenuLabel>{t('terminal.drawer.newWithShell')}</DropdownMenuLabel>
      {loading ? <div role="status" className="flex items-center gap-2 px-2 py-2 text-caption text-muted-foreground"><TbLoader2 aria-hidden className="size-3.5 animate-spin" />{t('terminal.drawer.loadingShells')}</div> : null}
      {failed ? <p role="alert" className="px-2 py-2 text-caption text-destructive">{t('terminal.drawer.loadShellsFailed')}</p> : null}
      {!loading && !failed && !profiles.length ? <p className="px-2 py-2 text-caption text-muted-foreground">{t('terminal.drawer.noShells')}</p> : null}
      {profiles.map((profile) => <DropdownMenuItem key={profile.id} data-create-shell-profile-id={profile.id} disabled={disabled || loading || !profile.available} title={profile.executable || undefined} onSelect={() => onCreate(profile.id, profile.label)}>
        <TbTerminal2 aria-hidden />
        <span className="min-w-0 flex-1 break-words">{profile.label}</span>
        {profile.isDefault ? <span className="shrink-0 text-micro opacity-70">{t('terminal.drawer.defaultShell')}</span> : null}
        {!profile.available ? <span className="shrink-0 text-micro opacity-70">{t('settings.terminal.profiles.unavailable')}</span> : null}
      </DropdownMenuItem>)}
      <DropdownMenuSeparator />
      <DropdownMenuItem disabled={loading} onSelect={(event) => { event.preventDefault(); void load(true) }}><TbRefresh aria-hidden />{t(failed ? 'terminal.drawer.retryShells' : 'settings.terminal.profiles.refresh')}</DropdownMenuItem>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger disabled={saving}>{t('terminal.drawer.selectDefault')}</DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="max-w-[min(28rem,calc(100vw-2rem))]">
          <DropdownMenuItem disabled={saving} onSelect={(event) => { event.preventDefault(); void saveDefault(null) }}>
            <span className="size-4">{terminal.defaultProfileId === null ? <TbCheck aria-hidden /> : null}</span>{t('settings.terminal.profiles.automatic')}
          </DropdownMenuItem>
          {profiles.map((profile) => <DropdownMenuItem key={profile.id} disabled={saving || loading || !profile.available} onSelect={(event) => { event.preventDefault(); void saveDefault(profile) }}>
            <span className="size-4 shrink-0">{terminal.defaultProfileId === profile.id ? <TbCheck aria-hidden /> : null}</span><span className="min-w-0 break-words">{profile.label}</span>
          </DropdownMenuItem>)}
          {saveFailed ? <p role="alert" className="max-w-64 px-2 py-2 text-caption text-destructive">{t('settings.terminal.profiles.form.saveFailed')}</p> : null}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSeparator />
      <TerminalExternalAppMenu terminalApi={terminalApi} disabled={disabled} initiallyOpen={focusExternal && open} onOpen={onOpenExternal} />
      {onOpenSettings ? <DropdownMenuItem onSelect={onOpenSettings}><TbSettings aria-hidden />{t('terminal.drawer.manageProfiles')}</DropdownMenuItem> : null}
    </DropdownMenuContent>
  </DropdownMenu>
}
