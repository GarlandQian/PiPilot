import * as React from 'react'
import { TbExternalLink, TbLoader2, TbRefresh } from 'react-icons/tb'
import { DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger } from '@/components/ui/dropdown-menu'
import { useT } from '@/i18n'
import type { PiPilotApi } from '@/shared/pipilot-api'
import type { TerminalExternalApp } from '@/shared/terminal-profiles'
import { useSettings } from '@/store/settings'

/** External applications have a separate default from the integrated shell. */
export function TerminalExternalAppMenu({ terminalApi, disabled, initiallyOpen = false, standalone = false, onOpen }: {
  terminalApi: PiPilotApi['terminal']
  disabled: boolean
  initiallyOpen?: boolean
  /** Render inside an existing DropdownMenuContent, for a scoped error recovery menu. */
  standalone?: boolean
  onOpen(appId?: string, appName?: string): void
}) {
  const t = useT()
  const { terminal } = useSettings()
  const [open, setOpen] = React.useState(initiallyOpen)
  const [apps, setApps] = React.useState<TerminalExternalApp[]>([])
  const [loading, setLoading] = React.useState(false)
  const [failed, setFailed] = React.useState(false)
  const requestId = React.useRef(0)
  const mounted = React.useRef(true)
  const revision = JSON.stringify([terminal.externalApps, terminal.defaultExternalAppId, terminal.defaultExternalAppSnapshot])
  const load = React.useCallback(async (refresh = false) => {
    const request = ++requestId.current
    setLoading(true)
    setFailed(false)
    try {
      const next = await terminalApi.listExternalApps(refresh)
      if (mounted.current && request === requestId.current) setApps(next)
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
  React.useEffect(() => { if (standalone || open) void load() }, [standalone, open, revision, load])
  React.useEffect(() => { if (initiallyOpen) setOpen(true) }, [initiallyOpen])

  const items = <>
      <DropdownMenuItem disabled={disabled} onSelect={() => onOpen()}>{t('terminal.drawer.openDefaultExternal')}</DropdownMenuItem>
      <DropdownMenuSeparator />
      {loading ? <div role="status" className="flex items-center gap-2 px-2 py-2 text-caption text-muted-foreground"><TbLoader2 aria-hidden className="size-3.5 animate-spin" />{t('settings.terminal.external.loading')}</div> : null}
      {failed ? <p role="alert" className="max-w-64 px-2 py-2 text-caption text-destructive">{t('settings.terminal.external.loadFailed')}</p> : null}
      {!loading && !failed && !apps.length ? <p className="max-w-64 px-2 py-2 text-caption text-muted-foreground">{t('settings.terminal.external.empty')}</p> : null}
      {apps.map((app) => <DropdownMenuItem key={app.id} disabled={disabled || loading || !app.available} title={app.executable || undefined} onSelect={() => onOpen(app.id, app.label)}>
        <span className="min-w-0 flex-1 break-words">{app.label}</span>
        {app.id === terminal.defaultExternalAppId ? <span className="shrink-0 text-micro opacity-70">{t('terminal.drawer.defaultShell')}</span> : null}
        {!app.available ? <span className="shrink-0 text-micro opacity-70">{t('settings.terminal.profiles.unavailable')}</span> : null}
      </DropdownMenuItem>)}
      <DropdownMenuSeparator />
      <DropdownMenuItem disabled={loading} onSelect={(event) => { event.preventDefault(); void load(true) }}><TbRefresh aria-hidden />{t('settings.terminal.profiles.refresh')}</DropdownMenuItem>
  </>
  if (standalone) return items
  return <DropdownMenuSub open={open} onOpenChange={setOpen}>
    <DropdownMenuSubTrigger disabled={disabled}><TbExternalLink aria-hidden />{t('terminal.drawer.openExternal')}</DropdownMenuSubTrigger>
    <DropdownMenuSubContent className="max-w-[min(28rem,calc(100vw-2rem))]">{items}</DropdownMenuSubContent>
  </DropdownMenuSub>
}
