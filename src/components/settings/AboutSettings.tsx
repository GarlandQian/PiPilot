import * as React from 'react'
import { TbAlertTriangle, TbCheck, TbDownload, TbExternalLink, TbLoader2, TbRefresh } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Progress } from '@/components/ui/progress'
import { PiLogo } from '@/components/PiLogo'
import { SettingSection } from './common'
import { type MessageKey, useT } from '@/i18n'
import type { AppInfo } from '@/shared/ipc/contracts'
import { SUPPORTED_PI_VERSION } from '@/shared/local-pi'
import { useApplicationUpdate } from '@/store/application-update'

function platformName(platform: string) {
  if (platform === 'darwin') return 'macOS'
  if (platform === 'win32') return 'Windows'
  if (platform === 'linux') return 'Linux'
  return platform
}

function updateDescriptionKey(
  snapshot: ReturnType<typeof useApplicationUpdate>['snapshot'],
): MessageKey {
  if (snapshot?.policy.capability === 'native-install') {
    return 'applicationUpdate.nativeDescription'
  }
  return 'applicationUpdate.manualDescription'
}

function useAppInfo() {
  const [info, setInfo] = React.useState<AppInfo | null>(null)
  const [failed, setFailed] = React.useState(false)
  const [revision, retry] = React.useReducer((value: number) => value + 1, 0)

  React.useEffect(() => {
    const api = window.pipilot?.app
    if (!api) { setFailed(true); return }
    let active = true
    setFailed(false)
    void api.getInfo()
      .then((value) => {
        if (active) setInfo(value)
      })
      .catch(() => { if (active) setFailed(true) })
    return () => {
      active = false
    }
  }, [revision])

  return { info, failed, retry }
}

export function AboutSettings() {
  const { info, failed: infoFailed, retry: retryInfo } = useAppInfo()
  const t = useT()
  const update = useApplicationUpdate()
  const [confirmInstall, setConfirmInstall] = React.useState(false)
  const snapshot = update.snapshot
  const requestFailed = update.errorMessage !== null

  const updateVersion = snapshot && 'availableVersion' in snapshot
    ? snapshot.availableVersion
    : null
  const trustNotice = snapshot?.policy.package === 'macos'
    ? t('applicationUpdate.trust.macos')
    : snapshot?.policy.package === 'nsis'
      ? t('applicationUpdate.trust.windows')
      : null
  const updateStatus = update.errorMessage ?? (snapshot?.state === 'idle'
    ? t('settings.redesign.updatesIdle')
    : snapshot?.state === 'disabled'
    ? t('applicationUpdate.status.disabled')
    : snapshot?.state === 'checking'
      ? t('applicationUpdate.status.checking')
      : snapshot?.state === 'current'
        ? t('applicationUpdate.status.current')
        : snapshot?.state === 'available'
          ? t('applicationUpdate.status.available', { version: updateVersion ?? '' })
          : snapshot?.state === 'downloading'
            ? t('applicationUpdate.status.downloading', { percent: Math.round(snapshot.progress.percent) })
            : snapshot?.state === 'downloaded'
              ? t('applicationUpdate.status.downloaded', { version: updateVersion ?? '' })
              : snapshot?.state === 'error'
                ? update.errorMessage ?? t('applicationUpdate.status.error')
                : t('settings.about.loading'))
  const canCheck = snapshot?.state === 'idle' || snapshot?.state === 'current'
  const canRetry = (snapshot?.state === 'error' && snapshot.recoverable) || (requestFailed && update.mode === 'electron')

  const runInstall = React.useCallback(async (confirmActiveWork: boolean) => {
    const result = await update.install(confirmActiveWork)
    if (result?.outcome === 'confirmation-required') setConfirmInstall(true)
    else if (result?.outcome === 'accepted') setConfirmInstall(false)
  }, [update])

  const retryUpdate = React.useCallback(() => {
    if (snapshot?.state !== 'error') { void update.check(); return }
    if (
      snapshot.operation === 'download' &&
      snapshot.retryState === 'available' &&
      snapshot.policy.capability === 'native-install'
    ) {
      void update.download()
      return
    }
    if (
      snapshot.operation === 'install' &&
      snapshot.retryState === 'downloaded' &&
      snapshot.policy.capability === 'native-install'
    ) {
      void runInstall(false)
      return
    }
    void update.check()
  }, [runInstall, snapshot, update])

  return (
    <>
      <div className="flex items-center gap-4 border-b border-border/70 pb-6">
        <div className="flex size-14 shrink-0 items-center justify-center rounded-md border border-border bg-surface-inset"><PiLogo className="size-10 text-foreground" /></div>
        <div className="min-w-0"><h2 className="text-xl font-semibold">{t('app.name')}</h2><p className="mt-1 text-caption text-muted-foreground">{info ? `${t('settings.about.version')} ${info.version}` : infoFailed ? t('settings.redesign.infoUnavailable') : t('settings.about.loading')}</p></div>
        {infoFailed ? <Button variant="outline" size="sm" className="ml-auto" onClick={retryInfo}><TbRefresh aria-hidden />{t('applicationUpdate.retry')}</Button> : null}
      </div>
      <SettingSection title={t('settings.redesign.systemInfo')}>
        <dl className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-x-6 gap-y-1">
          <dt className="w-28 shrink-0 text-caption text-muted-foreground">{t('settings.about.piRuntime')}</dt>
          <dd className="break-all font-mono text-caption text-foreground">
                {t('settings.about.piVersion', { version: SUPPORTED_PI_VERSION })}
          </dd>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-1">
          <dt className="w-28 shrink-0 text-caption text-muted-foreground">{t('settings.about.platform')}</dt>
          <dd className="text-caption text-foreground">
            {info
              ? `${platformName(info.platform)} · ${info.arch} · Electron ${info.electronVersion}`
              : t(infoFailed ? 'settings.redesign.infoUnavailable' : 'settings.about.loading')}
          </dd>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-1">
          <dt className="w-28 shrink-0 text-caption text-muted-foreground">{t('settings.about.issues')}</dt>
          <dd className="break-all text-caption text-foreground">github.com/GarlandQian/PiPilot</dd>
        </div>
        </dl>
        <p className="pt-3 text-micro text-muted-foreground">{t('settings.about.copyright')}</p>
        <p className="text-micro text-muted-foreground">{t('settings.about.madeWith')}</p>
      </SettingSection>
      <SettingSection
        title={t('applicationUpdate.settings.title')}
        desc={t('applicationUpdate.settings.description')}
      >
        <div role={snapshot?.state === 'error' || requestFailed ? 'alert' : 'status'} className="py-2">
          <p className="flex items-start gap-2 text-app text-foreground">
            {requestFailed ? <TbAlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden /> : snapshot?.state === 'checking' || snapshot?.state === 'downloading'
              ? <TbLoader2 className="mt-0.5 size-4 shrink-0 animate-spin" aria-hidden />
              : snapshot?.state === 'error'
                ? <TbAlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
                : snapshot?.state === 'current' || snapshot?.state === 'downloaded'
                  ? <TbCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                  : null}
            <span className="min-w-0 break-words">{updateStatus}</span>
          </p>
          <p className="mt-2 text-caption text-muted-foreground">{t(updateDescriptionKey(snapshot))}</p>
        </div>
        {snapshot?.state === 'downloading' && (
          <div>
            <Progress value={snapshot.progress.percent} aria-label={t('applicationUpdate.progress', { percent: Math.round(snapshot.progress.percent) })} />
          </div>
        )}
        {trustNotice && (
          <div
            className="flex items-start gap-2 border-l-2 border-warning/50 py-2 pl-3 text-caption text-muted-foreground"
            role="note"
          >
            <TbAlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            <span>{trustNotice}</span>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 pt-2">
          {(canCheck || canRetry) && (
            <Button
              variant="outline"
              size="sm"
              disabled={update.busy}
              onClick={canRetry ? retryUpdate : () => void update.check()}
            >
              <TbRefresh aria-hidden />
              {t(canRetry ? 'applicationUpdate.retry' : 'applicationUpdate.check')}
            </Button>
          )}
          {snapshot?.state === 'available' && snapshot.policy.capability === 'manual-release' && (
            <Button variant="ghost" size="sm" onClick={() => void update.openRelease()}>
              <TbExternalLink aria-hidden />{t('applicationUpdate.openRelease')}
            </Button>
          )}
          {snapshot?.state === 'error' && snapshot.policy.capability === 'manual-release' && (
            <Button variant="ghost" size="sm" onClick={() => void update.openRelease()}>
              <TbExternalLink aria-hidden />{t('applicationUpdate.openRelease')}
            </Button>
          )}
          {snapshot?.state === 'available' && snapshot.policy.capability === 'native-install' && (
            <Button variant="accent" size="sm" disabled={update.busy} onClick={() => void update.download()}>
              <TbDownload aria-hidden />{t('applicationUpdate.download')}
            </Button>
          )}
          {snapshot?.state === 'downloaded' && (
            <Button variant="accent" size="sm" disabled={update.busy} onClick={() => void runInstall(false)}>
              <TbRefresh aria-hidden />{t('applicationUpdate.restart')}
            </Button>
          )}
        </div>
        <AlertDialog open={confirmInstall} onOpenChange={setConfirmInstall}>
          <AlertDialogContent size="sm">
            <AlertDialogHeader>
              <AlertDialogTitle>{t('applicationUpdate.confirmRestartTitle')}</AlertDialogTitle>
              <AlertDialogDescription>{t('applicationUpdate.activeWorkConfirmation')}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('applicationUpdate.cancel')}</AlertDialogCancel>
              <AlertDialogAction variant="accent" onClick={() => void runInstall(true)}>
                {t('applicationUpdate.confirmRestart')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SettingSection>
    </>
  )
}
