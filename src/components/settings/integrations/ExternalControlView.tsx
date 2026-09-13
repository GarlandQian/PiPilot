import * as React from 'react'
import { TbCheck, TbCopy, TbDownload, TbPlugConnected, TbRefresh, TbTrash } from 'react-icons/tb'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { useLocale, useT } from '@/i18n'
import { cn } from '@/lib/utils'
import type { ExternalControlMcpConfiguration } from '@/shared/external-control'
import { useExternalControl } from '@/store/external-control'
import { EmptyState, SearchField } from './CatalogPrimitives'

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

export function ExternalControlView({ active = true }: { active?: boolean }) {
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
    () => snapshot?.configuration
      ? serializeExternalControlConfiguration(snapshot.configuration)
      : '',
    [snapshot?.configuration],
  )
  const formatTimestamp = React.useMemo(() => new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }), [locale])
  const visibleOperations = React.useMemo(() => {
    const query = activityQuery.trim().toLocaleLowerCase()
    return (snapshot?.recentOperations ?? []).filter((operation) => !query ||
      `${operation.conversationLabel ?? ''} ${t(`settings.externalControl.action.${operation.action}`)} ${t(`settings.externalControl.operation.${operation.status}`)}`.toLocaleLowerCase().includes(query))
  }, [activityQuery, snapshot?.recentOperations, t])

  if (!snapshot) {
    return (
      <EmptyState>
        <div
          className="flex flex-col items-center gap-2"
          role={externalControl.errorMessage ? 'alert' : 'status'}
        >
          <span>
            {externalControl.errorMessage
              ? t('settings.externalControl.loadError')
              : t('settings.externalControl.loading')}
          </span>
          {externalControl.errorMessage ? (
            <Button variant="ghost" size="sm" onClick={() => void externalControl.retry()}>
              <TbRefresh aria-hidden />
              {t('common.retry')}
            </Button>
          ) : null}
        </div>
      </EmptyState>
    )
  }

  const transitioning = snapshot.state === 'enabling' || snapshot.state === 'disabling'
  const unavailable = snapshot.state === 'unavailable'
  const statusVariant = snapshot.state === 'ready'
    ? 'soft-success' as const
    : snapshot.state === 'error'
      ? 'soft-danger' as const
      : transitioning
        ? 'soft-warning' as const
        : 'outline' as const
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
  const launcherStatusVariant = launcherState === 'installed'
    ? 'soft-success' as const
    : launcherState === 'repair'
      ? 'soft-warning' as const
      : launcherState === 'unsupported' || externalControl.launcherErrorMessage
        ? 'soft-danger' as const
        : 'outline' as const

  return (
    <>
      <div className="grid min-w-0 gap-x-6 gap-y-6 @min-[880px]/integrations:grid-cols-2" data-external-control-workspace>
        <section className="border-b border-border pb-5 @min-[880px]/integrations:col-span-2" aria-labelledby="external-control-title">
          <div className="flex min-w-0 items-start gap-3">
            <TbPlugConnected className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h3 id="external-control-title" className="text-title">
                  {t('settings.externalControl.title')}
                </h3>
                <Badge variant={statusVariant}>
                  {t(`settings.externalControl.state.${snapshot.state}`)}
                </Badge>
              </div>
              <p className="mt-1 max-w-2xl text-caption text-muted-foreground">
                {t('settings.externalControl.description')}
              </p>
            </div>
            <Switch
              id="external-control-enabled"
              checked={snapshot.enabled}
              disabled={transitioning || (unavailable && !snapshot.enabled)}
              aria-label={t('settings.externalControl.enableLabel')}
              onCheckedChange={toggle}
            />
          </div>

          <div className="mt-3 flex min-w-0 flex-wrap items-center justify-between gap-2 pl-8" aria-live="polite">
            <p className={cn(
              'min-w-0 text-caption text-muted-foreground',
              snapshot.state === 'error' && 'text-destructive',
            )}>
              {t(`settings.externalControl.state.${snapshot.state}.desc`, {
                count: snapshot.connectedClients,
              })}
            </p>
            {snapshot.state === 'error' || externalControl.errorMessage ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={transitioning}
                onClick={() => void externalControl.retry()}
              >
                <TbRefresh aria-hidden />
                {t('common.retry')}
              </Button>
            ) : null}
          </div>
        </section>

        <section className="min-w-0 border-b border-border pb-5" aria-labelledby="external-control-launcher-title">
          <div className="flex min-w-0 items-start gap-3">
            <TbDownload className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h3 id="external-control-launcher-title" className="text-caption font-medium text-foreground">
                  {t('settings.externalControl.launcher.title')}
                </h3>
                <Badge variant={launcherStatusVariant}>
                  {t(`settings.externalControl.launcher.state.${launcherState}`)}
                </Badge>
              </div>
              <p className="mt-1 max-w-2xl text-micro text-muted-foreground">
                {t(
                  launcherState === 'installed' && launcher && !launcher.managed
                    ? 'settings.externalControl.launcher.state.installed.unmanaged.desc'
                    : `settings.externalControl.launcher.state.${launcherState}.desc`,
                )}
              </p>
              {launcher?.requiresClientRestart ? (
                <p className="mt-1 text-micro text-warning" role="status">
                  {t('settings.externalControl.launcher.restartClients')}
                </p>
              ) : null}
              {externalControl.launcherErrorMessage ? (
                <p className="mt-1 text-micro text-destructive" role="alert">
                  {t(externalControl.launcherErrorAction === 'uninstall'
                    ? 'settings.externalControl.launcher.uninstallFailed'
                    : externalControl.launcherErrorAction === 'install'
                      ? 'settings.externalControl.launcher.installFailed'
                      : 'settings.externalControl.launcher.loadFailed')}
                </p>
              ) : null}
            </div>
            {launcherState === 'loadError' ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void externalControl.retryLauncher()}
              >
                <TbRefresh aria-hidden />
                {t('common.retry')}
              </Button>
            ) : launcherState === 'missing' || launcherState === 'repair' ? (
              <Button
                variant="outline"
                size="sm"
                disabled={externalControl.launcherOperation !== null}
                onClick={() => void externalControl.installLauncher()}
              >
                <TbDownload aria-hidden />
                {t(launcherState === 'repair'
                  ? 'settings.externalControl.launcher.repair'
                  : 'settings.externalControl.launcher.install')}
              </Button>
            ) : launcherState === 'installed' && launcher?.managed ? (
              <Button
                variant="outline"
                size="sm"
                disabled={externalControl.launcherOperation !== null}
                onClick={() => setConfirmUninstall(true)}
              >
                <TbTrash aria-hidden />
                {t('settings.externalControl.launcher.uninstall')}
              </Button>
            ) : null}
          </div>
        </section>

        {snapshot.state === 'ready' && snapshot.configuration ? (
          <section className="min-w-0 border-b border-border pb-5" aria-labelledby="external-control-configuration-title">
            <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 id="external-control-configuration-title" className="text-caption font-medium text-foreground">
                  {t('settings.externalControl.configuration')}
                </h3>
                <p className="mt-1 text-micro text-muted-foreground">
                  {t('settings.externalControl.configurationDesc')}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => void copyConfiguration()}>
                {copyState === 'copied'
                  ? <TbCheck className="text-sage" aria-hidden />
                  : <TbCopy aria-hidden />}
                {copyState === 'copied'
                  ? t('settings.externalControl.copied')
                  : t('settings.externalControl.copy')}
              </Button>
            </div>
            <pre className="scroll-slim mt-3 max-h-52 max-w-full overflow-auto rounded-lg bg-muted/60 p-3 font-mono text-micro text-foreground">
              <code>{configurationText}</code>
            </pre>
            {copyState === 'failed' ? (
              <p className="mt-2 text-micro text-destructive" role="alert">
                {t('settings.externalControl.copyFailed')}
              </p>
            ) : null}
          </section>
        ) : <section className="min-w-0 border-b border-border pb-5" aria-label={t('settings.externalControl.configuration')}>
          <h3 className="text-caption font-medium">{t('settings.externalControl.configuration')}</h3>
          <p className="mt-2 text-caption leading-relaxed text-muted-foreground">{t('settings.integrations.external.configurationPending')}</p>
        </section>}

        <section className="min-w-0 @min-[880px]/integrations:col-span-2" aria-labelledby="external-control-recent-title">
          <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-2">
            <h3 id="external-control-recent-title" className="text-caption font-medium text-foreground">
              {t('settings.externalControl.recent')}
            </h3>
            {snapshot.state === 'ready' ? (
              <span className="text-micro tabular-nums text-muted-foreground">
                {t(snapshot.connectedClients === 1
                  ? 'settings.externalControl.client'
                  : 'settings.externalControl.clients', {
                  count: snapshot.connectedClients,
                })}
              </span>
            ) : null}
          </div>
          {snapshot.recentOperations.length > 0 ? <div className="mt-3 max-w-md">
            <SearchField value={activityQuery} onChange={setActivityQuery} label={t('settings.integrations.external.searchActivity')} />
          </div> : null}
          {snapshot.recentOperations.length === 0 ? (
            <p className="py-8 text-center text-caption text-muted-foreground">
              {t('settings.externalControl.recentEmpty')}
            </p>
          ) : (
            <ul className="scroll-slim mt-3 max-h-72 divide-y divide-border overflow-y-auto" aria-label={t('settings.externalControl.recent')}>
              {visibleOperations.map((operation) => (
                <li
                  key={operation.presentationId}
                  className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 py-2"
                >
                  <div className="min-w-40 flex-1">
                    <p className="truncate text-caption text-foreground" title={operation.conversationLabel}>
                      {operation.conversationLabel ?? t('settings.externalControl.conversation')}
                    </p>
                    <p className="mt-0.5 text-micro text-muted-foreground">
                      {t(`settings.externalControl.action.${operation.action}`)}
                    </p>
                  </div>
                  <Badge variant={operation.status === 'completed'
                    ? 'soft-success'
                    : operation.status === 'failed' || operation.status === 'runtime_replaced'
                      ? 'soft-danger'
                      : 'outline'}>
                    {t(`settings.externalControl.operation.${operation.status}`)}
                  </Badge>
                  <time
                    dateTime={operation.timestamp}
                    className="w-32 text-right text-micro tabular-nums text-muted-foreground"
                  >
                    {formatTimestamp.format(new Date(operation.timestamp))}
                  </time>
                </li>
              ))}
            </ul>
          )}
          {snapshot.recentOperations.length > 0 && visibleOperations.length === 0 ? <EmptyState>
            <div className="space-y-2"><p>{t('settings.integrations.external.noMatchingActivity')}</p><Button variant="ghost" size="sm" onClick={() => setActivityQuery('')}>{t('settings.integrations.catalog.clearSearch')}</Button></div>
          </EmptyState> : null}
        </section>
      </div>

      <AlertDialog open={confirmDisable} onOpenChange={setConfirmDisable}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('settings.externalControl.disableTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('settings.externalControl.disableDesc', {
                count: snapshot.connectedClients,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setConfirmDisable(false)
                void externalControl.setEnabled(false)
              }}
            >
              {t('settings.externalControl.disableAction')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmUninstall} onOpenChange={setConfirmUninstall}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('settings.externalControl.launcher.uninstallTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('settings.externalControl.launcher.uninstallDesc')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setConfirmUninstall(false)
                void externalControl.uninstallLauncher()
              }}
            >
              {t('settings.externalControl.launcher.uninstallAction')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
