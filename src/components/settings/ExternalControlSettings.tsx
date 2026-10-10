import * as React from 'react'
import { TbCheck, TbCopy, TbDownload, TbLoader2, TbPlugConnected, TbRefresh, TbSearch, TbTerminal2, TbTrash } from 'react-icons/tb'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useLocale, useT, type MessageKey } from '@/i18n'
import type { ExternalControlMcpConfiguration } from '@/shared/external-control'
import { useExternalControl } from '@/store/external-control'
import { SettingsGroup, SettingsListRow, SettingsPage, SettingsRow, StatusText } from './kit'
import { RuntimeProblemsBanner } from './packages/integration-notices'

export function serializeExternalControlConfiguration(
  configuration: ExternalControlMcpConfiguration,
) {
  return `${JSON.stringify({
    mcpServers: {
      pipilot: {
        command: configuration.command,
        args: configuration.args,
      },
    },
  }, null, 2)}\n`
}

function RowIcon({ tint, children }: { tint: string; children: React.ReactNode }) {
  return <span aria-hidden style={{ backgroundColor: tint }} className="flex size-[26px] shrink-0 items-center justify-center rounded-[7px] bg-[linear-gradient(to_bottom,rgb(255_255_255/0.2),transparent)] text-white shadow-[inset_0_0_0_0.5px_rgb(0_0_0/0.08)]">
    {children}
  </span>
}

/** Lets local MCP clients drive PiPilot conversations: the switch, the launcher command, what to paste into a client, and what clients did. */
export function ExternalControlSettings({ active = true }: { active?: boolean }) {
  const t = useT()
  const locale = useLocale()
  const externalControl = useExternalControl()
  const snapshot = externalControl.snapshot
  const launcher = externalControl.launcher
  const [confirmDisable, setConfirmDisable] = React.useState(false)
  const [confirmUninstall, setConfirmUninstall] = React.useState(false)
  const [copyState, setCopyState] = React.useState<'idle' | 'copied' | 'failed'>('idle')
  const [activityQuery, setActivityQuery] = React.useState('')
  const copyTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  React.useEffect(() => {
    if (!active) { setConfirmDisable(false); setConfirmUninstall(false) }
  }, [active])
  React.useEffect(() => () => {
    if (copyTimer.current) clearTimeout(copyTimer.current)
  }, [])

  const configurationText = React.useMemo(
    () => snapshot?.configuration ? serializeExternalControlConfiguration(snapshot.configuration) : '',
    [snapshot?.configuration],
  )
  const formatTimestamp = React.useMemo(() => new Intl.DateTimeFormat(locale, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }), [locale])
  const visibleOperations = React.useMemo(() => {
    const query = activityQuery.trim().toLocaleLowerCase()
    return (snapshot?.recentOperations ?? []).filter((operation) => !query ||
      `${operation.conversationLabel ?? ''} ${t(`settings.externalControl.action.${operation.action}`)} ${t(`settings.externalControl.operation.${operation.status}`)}`.toLocaleLowerCase().includes(query))
  }, [activityQuery, snapshot?.recentOperations, t])

  if (!snapshot) {
    return <SettingsPage data-external-control-workspace>
      <div className="settings-group flex flex-col items-center gap-2 px-3 py-10 text-caption text-muted-foreground" role={externalControl.errorMessage ? 'alert' : 'status'}>
        <span className="flex items-center gap-2">
          {externalControl.errorMessage ? null : <TbLoader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />}
          {t(externalControl.errorMessage ? 'settings.externalControl.loadError' : 'settings.externalControl.loading')}
        </span>
        {externalControl.errorMessage ? <Button variant="ghost" size="sm" onClick={() => void externalControl.retry()}><TbRefresh aria-hidden />{t('common.retry')}</Button> : null}
      </div>
    </SettingsPage>
  }

  const transitioning = snapshot.state === 'enabling' || snapshot.state === 'disabling'
  const unavailable = snapshot.state === 'unavailable'
  const stateTone = snapshot.state === 'ready' ? 'success' as const
    : snapshot.state === 'error' ? 'danger' as const
      : transitioning ? 'warning' as const : 'neutral' as const
  const toggle = (enabled: boolean) => {
    if (!enabled && snapshot.connectedClients > 0) {
      setConfirmDisable(true)
      return
    }
    void externalControl.setEnabled(enabled)
  }
  const copyConfiguration = async () => {
    if (copyTimer.current) clearTimeout(copyTimer.current)
    try {
      await navigator.clipboard.writeText(configurationText)
      setCopyState('copied')
      copyTimer.current = setTimeout(() => {
        setCopyState('idle')
        copyTimer.current = null
      }, 1_200)
    } catch {
      setCopyState('failed')
    }
  }
  const launcherState = externalControl.launcherOperation === 'install'
    ? 'installing'
    : externalControl.launcherOperation === 'uninstall'
      ? 'uninstalling'
      : launcher?.state ?? (externalControl.launcherErrorMessage ? 'loadError' : 'loading')
  const launcherTone = launcherState === 'installed' ? 'success' as const
    : launcherState === 'repair' ? 'warning' as const
      : launcherState === 'unsupported' || externalControl.launcherErrorMessage ? 'danger' as const : 'neutral' as const
  const launcherDescription = t(
    launcherState === 'installed' && launcher && !launcher.managed
      ? 'settings.externalControl.launcher.state.installed.unmanaged.desc'
      : launcherState === 'unsupported' && launcher?.error
        ? `settings.externalControl.launcher.error.${launcher.error.code}`
        : `settings.externalControl.launcher.state.${launcherState}.desc` as MessageKey,
  )
  const launcherFailure = externalControl.launcherErrorMessage
    ? t(externalControl.launcherErrorAction === 'uninstall'
      ? 'settings.externalControl.launcher.uninstallFailed'
      : externalControl.launcherErrorAction === 'install'
        ? 'settings.externalControl.launcher.installFailed'
        : 'settings.externalControl.launcher.loadFailed')
    : null

  return <SettingsPage data-external-control-workspace>
    {snapshot.state === 'error' || externalControl.errorMessage || launcher?.requiresClientRestart || launcherFailure ? <div className="min-w-0 space-y-2">
      {snapshot.state === 'error' || externalControl.errorMessage ? <div className="flex min-w-0 flex-wrap items-center gap-3 rounded-[12px] bg-destructive/8 px-3.5 py-2.5" role="alert">
        <p className="min-w-0 flex-1 text-caption text-destructive">{t('settings.externalControl.state.error.desc')}</p>
        <Button variant="outline" size="sm" disabled={transitioning} onClick={() => void externalControl.retry()}><TbRefresh aria-hidden />{t('common.retry')}</Button>
      </div> : null}
      {launcherFailure ? <p className="rounded-[12px] bg-destructive/8 px-3.5 py-2.5 text-caption text-destructive" role="alert">{launcherFailure}</p> : null}
      {launcher?.requiresClientRestart ? <p className="rounded-[12px] bg-warning/10 px-3.5 py-2.5 text-caption" role="status">{t('settings.externalControl.launcher.restartClients')}</p> : null}
    </div> : null}
    <RuntimeProblemsBanner />

    <SettingsGroup footer={t('settings.externalControl.localOnly')} data-external-control-status>
      <SettingsRow label={t('settings.externalControl.enableLabel')} htmlFor="external-control-enabled"
        icon={<RowIcon tint="#34c759"><TbPlugConnected className="size-4" /></RowIcon>}
        info={t('settings.externalControl.description')}
        description={<span aria-live="polite">{t(`settings.externalControl.state.${snapshot.state}.desc`, { count: snapshot.connectedClients })}</span>}>
        <StatusText tone={stateTone}>{t(`settings.externalControl.state.${snapshot.state}`)}</StatusText>
        <Switch id="external-control-enabled" checked={snapshot.enabled} disabled={transitioning || (unavailable && !snapshot.enabled)}
          aria-label={t('settings.externalControl.enableLabel')} onCheckedChange={toggle} />
      </SettingsRow>
      {snapshot.state === 'ready' ? <SettingsRow label={t('settings.externalControl.connectedClients')}>
        <span className="text-app tabular-nums text-muted-foreground">{t(snapshot.connectedClients === 1 ? 'settings.externalControl.client' : 'settings.externalControl.clients', { count: snapshot.connectedClients })}</span>
      </SettingsRow> : null}
    </SettingsGroup>

    <SettingsGroup title={t('settings.externalControl.launcher.title')} data-external-control-launcher>
      <SettingsRow label={<code className="font-mono">pipilot-mcp</code>}
        icon={<RowIcon tint="#007aff"><TbTerminal2 className="size-4" /></RowIcon>}
        info={launcherState === 'unsupported' && launcher?.error ? <span className="break-words">{launcher.error.message}</span> : undefined}
        description={launcherDescription}>
        <StatusText tone={launcherTone}>{t(`settings.externalControl.launcher.state.${launcherState}` as MessageKey)}</StatusText>
        {launcherState === 'loadError' || launcherState === 'unsupported'
          ? <Button variant="outline" size="sm" onClick={() => void externalControl.retryLauncher()}><TbRefresh aria-hidden />{t('common.retry')}</Button>
          : launcherState === 'missing' || launcherState === 'repair'
            ? <Button variant="outline" size="sm" disabled={externalControl.launcherOperation !== null} onClick={() => void externalControl.installLauncher()}>
              <TbDownload aria-hidden />{t(launcherState === 'repair' ? 'settings.externalControl.launcher.repair' : 'settings.externalControl.launcher.install')}
            </Button>
            : launcherState === 'installed' && launcher?.managed
              ? <Button variant="outline" size="sm" disabled={externalControl.launcherOperation !== null} onClick={() => setConfirmUninstall(true)}>
                <TbTrash aria-hidden />{t('settings.externalControl.launcher.uninstall')}
              </Button>
              : null}
      </SettingsRow>
    </SettingsGroup>

    <SettingsGroup title={t('settings.externalControl.configuration')} info={t('settings.externalControl.configurationDesc')} data-external-control-configuration
      actions={snapshot.state === 'ready' && snapshot.configuration ? <Button variant="ghost" size="sm" onClick={() => void copyConfiguration()}>
        {copyState === 'copied' ? <TbCheck className="text-success" aria-hidden /> : <TbCopy aria-hidden />}
        {t(copyState === 'copied' ? 'settings.externalControl.copied' : 'settings.externalControl.copy')}
      </Button> : undefined}
      footer={copyState === 'failed' ? <span className="text-destructive" role="alert">{t('settings.externalControl.copyFailed')}</span> : undefined}>
      {snapshot.state === 'ready' && snapshot.configuration
        ? <pre className="scroll-slim max-h-52 max-w-full overflow-auto px-3.5 py-3 font-mono text-caption leading-relaxed text-foreground"><code>{configurationText}</code></pre>
        : <p className="px-3.5 py-3 text-caption leading-relaxed text-muted-foreground">{t('settings.integrations.external.configurationPending')}</p>}
    </SettingsGroup>

    <SettingsGroup title={t('settings.externalControl.recent')} boxRole={snapshot.recentOperations.length ? 'list' : undefined} data-external-control-recent
      actions={snapshot.recentOperations.length > 0 ? <div className="relative w-48 max-w-full">
        <TbSearch className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input type="search" value={activityQuery} onChange={(event) => setActivityQuery(event.target.value)} placeholder={t('settings.integrations.external.searchActivity')}
          aria-label={t('settings.integrations.external.searchActivity')} className="h-7 rounded-full bg-fill pl-8 shadow-none focus-visible:bg-control" />
      </div> : undefined}>
      {snapshot.recentOperations.length === 0
        ? <p className="px-3 py-8 text-center text-caption text-muted-foreground">{t('settings.externalControl.recentEmpty')}</p>
        : visibleOperations.length === 0
          ? <div className="px-3 py-8 text-center text-caption text-muted-foreground" role="status">
            <p>{t('settings.integrations.external.noMatchingActivity')}</p>
            <Button variant="ghost" size="sm" className="mt-2" onClick={() => setActivityQuery('')}>{t('settings.integrations.catalog.clearSearch')}</Button>
          </div>
          : <div className="scroll-slim max-h-80 overflow-y-auto rounded-[inherit]">
            {visibleOperations.map((operation) => <SettingsListRow key={operation.presentationId} data-external-control-operation={operation.status}
              title={<span title={operation.conversationLabel}>{operation.conversationLabel ?? t('settings.externalControl.conversation')}</span>}
              subtitle={t(`settings.externalControl.action.${operation.action}`)}
              status={<span className="flex min-w-0 flex-col items-end gap-0.5">
                <StatusText tone={operation.status === 'completed' ? 'success' : operation.status === 'failed' || operation.status === 'runtime_replaced' ? 'danger' : 'neutral'}>
                  {t(`settings.externalControl.operation.${operation.status}`)}
                </StatusText>
                <time dateTime={operation.timestamp} className="text-micro tabular-nums text-muted-foreground">{formatTimestamp.format(new Date(operation.timestamp))}</time>
              </span>} />)}
          </div>}
    </SettingsGroup>

    <AlertDialog open={confirmDisable} onOpenChange={setConfirmDisable}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('settings.externalControl.disableTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('settings.externalControl.disableDesc', { count: snapshot.connectedClients })}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => { setConfirmDisable(false); void externalControl.setEnabled(false) }}>
            {t('settings.externalControl.disableAction')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <AlertDialog open={confirmUninstall} onOpenChange={setConfirmUninstall}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('settings.externalControl.launcher.uninstallTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('settings.externalControl.launcher.uninstallDesc')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => { setConfirmUninstall(false); void externalControl.uninstallLauncher() }}>
            {t('settings.externalControl.launcher.uninstallAction')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </SettingsPage>
}
