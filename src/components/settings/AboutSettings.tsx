import * as React from 'react'
import { TbAlertTriangle, TbCheck, TbDownload, TbExternalLink, TbLoader2, TbRefresh } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Progress } from '@/components/ui/progress'
import { AppIcon } from '@/components/AppIcon'
import { type MessageKey, useT } from '@/i18n'
import type { AppInfo } from '@/shared/ipc/contracts'
import { SUPPORTED_PI_VERSION } from '@/shared/local-pi'
import { useApplicationUpdate } from '@/store/application-update'
import { SettingsGroup, SettingsPage, SettingsRow } from './kit'

const REPOSITORY = 'https://github.com/GarlandQian/PiPilot'

/** Projects PiPilot is built on or borrows from, credited by name and license. */
const CREDITS: readonly { name: string; role: MessageKey; license: string; url: string }[] = [
  { name: 'Pi', role: 'settings.about.credit.pi', license: 'MIT', url: 'https://github.com/earendil-works/pi' },
  { name: 'cc-switch', role: 'settings.about.credit.ccSwitch', license: 'MIT', url: 'https://github.com/farion1231/cc-switch' },
  { name: 'LobeHub Icons', role: 'settings.about.credit.lobeIcons', license: 'MIT', url: 'https://github.com/lobehub/lobe-icons' },
  { name: 'models.dev', role: 'settings.about.credit.modelsDev', license: 'MIT', url: 'https://models.dev' },
]

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

function openLink(url: string) {
  window.open(url, '_blank', 'noopener')
}

/** A row that opens a web page: its name, an optional note, ↗. */
function LinkRow({ label, note, url }: { label: React.ReactNode; note?: React.ReactNode; url: string }) {
  return <div data-settings-row data-pressable className="flex min-h-[40px] min-w-0 items-center gap-2.5 px-3 py-1.5">
    <button type="button" data-settings-row-action onClick={() => openLink(url)} className="absolute inset-0 rounded-[inherit] outline-none focus-visible:focus-ring"
      aria-label={typeof label === 'string' ? label : undefined} />
    <span className="pointer-events-none relative min-w-0 flex-1">
      <span className="block text-app text-foreground">{label}</span>
      {note ? <span className="mt-0.5 block text-caption leading-snug text-muted-foreground">{note}</span> : null}
    </span>
    <TbExternalLink className="pointer-events-none relative size-4 shrink-0 text-muted-foreground/70" aria-hidden />
  </div>
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
  const canCheck = snapshot?.state === 'idle' || snapshot?.state === 'current' ||
    snapshot?.state === 'available' || (snapshot?.state === 'error' && snapshot.recoverable)
  const canRetry = (snapshot?.state === 'error' && snapshot.recoverable) || (requestFailed && update.mode === 'electron')
  const failedState = snapshot?.state === 'error' || requestFailed

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

  return <SettingsPage data-about-settings>
    {/* About This Mac: the icon, the name, the version, and the one thing to do here. */}
    <div className="flex flex-col items-center gap-1 pt-2 text-center" data-about-identity>
      <AppIcon className="mb-2 size-20" />
      <h2 className="text-[24px] leading-tight font-bold tracking-[-0.02em]">{t('app.name')}</h2>
      <p className="text-caption text-muted-foreground">
        {info ? `${t('settings.about.version')} ${info.version}` : infoFailed ? t('settings.redesign.infoUnavailable') : t('settings.about.loading')}
      </p>
      <p className="text-caption text-muted-foreground">{t('settings.about.piLine', { version: SUPPORTED_PI_VERSION })}</p>
      {infoFailed ? <Button variant="outline" size="sm" className="mt-2" onClick={retryInfo}><TbRefresh aria-hidden />{t('applicationUpdate.retry')}</Button> : null}

      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        <Button variant="outline" disabled={update.busy || update.mode !== 'electron' || !canCheck} onClick={() => void update.check()}>
          <TbRefresh className={snapshot?.state === 'checking' ? 'animate-spin motion-reduce:animate-none' : undefined} aria-hidden />
          {t('applicationUpdate.check')}
        </Button>
        {canRetry ? <Button variant="outline" disabled={update.busy} onClick={retryUpdate}><TbRefresh aria-hidden />{t('applicationUpdate.retry')}</Button> : null}
        {(snapshot?.state === 'available' || snapshot?.state === 'error') && snapshot.policy.capability === 'manual-release'
          ? <Button variant="ghost" onClick={() => void update.openRelease()}><TbExternalLink aria-hidden />{t('applicationUpdate.openRelease')}</Button> : null}
        {snapshot?.state === 'available' && snapshot.policy.capability === 'native-install'
          ? <Button variant="accent" disabled={update.busy} onClick={() => void update.download()}><TbDownload aria-hidden />{t('applicationUpdate.download')}</Button> : null}
        {snapshot?.state === 'downloaded'
          ? <Button variant="accent" disabled={update.busy} onClick={() => void runInstall(false)}><TbRefresh aria-hidden />{t('applicationUpdate.restart')}</Button> : null}
      </div>
      <div role={failedState ? 'alert' : 'status'} className="mt-1 flex max-w-md items-start justify-center gap-1.5 text-caption text-muted-foreground" data-about-update-status>
        {failedState ? <TbAlertTriangle className="mt-px size-3.5 shrink-0 text-destructive" aria-hidden />
          : snapshot?.state === 'checking' || snapshot?.state === 'downloading' ? <TbLoader2 className="mt-px size-3.5 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
            : snapshot?.state === 'current' || snapshot?.state === 'downloaded' ? <TbCheck className="mt-px size-3.5 shrink-0 text-success" aria-hidden /> : null}
        <span className="min-w-0 break-words">{updateStatus}</span>
      </div>
      {snapshot?.state === 'downloading' ? <Progress className="mt-2 w-full max-w-xs" value={snapshot.progress.percent}
        aria-label={t('applicationUpdate.progress', { percent: Math.round(snapshot.progress.percent) })} /> : null}
    </div>

    {trustNotice ? <div className="flex items-start gap-2 rounded-[12px] bg-warning/10 px-3.5 py-2.5 text-caption text-muted-foreground" role="note">
      <TbAlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
      <span>{trustNotice}</span>
    </div> : null}

    <SettingsGroup title={t('settings.redesign.systemInfo')}>
      <SettingsRow label={t('settings.about.piRuntime')} info={t('settings.about.piHint')}>
        <span className="font-mono text-caption text-muted-foreground">{t('settings.about.piVersion', { version: SUPPORTED_PI_VERSION })}</span>
      </SettingsRow>
      <SettingsRow label={t('settings.about.platform')}>
        <span className="text-caption text-muted-foreground">
          {info ? `${platformName(info.platform)} · ${info.arch} · Electron ${info.electronVersion}` : t(infoFailed ? 'settings.redesign.infoUnavailable' : 'settings.about.loading')}
        </span>
      </SettingsRow>
      <SettingsRow label={t('applicationUpdate.settings.title')} info={`${t('applicationUpdate.settings.description')} ${t(updateDescriptionKey(snapshot))}`}>
        <span className="text-caption text-muted-foreground">{t('settings.about.updatesAutomatic')}</span>
      </SettingsRow>
    </SettingsGroup>

    <SettingsGroup>
      <LinkRow label={t('settings.about.website')} note="github.com/GarlandQian/PiPilot" url={REPOSITORY} />
      <LinkRow label={t('settings.about.releaseNotes')} url={`${REPOSITORY}/releases`} />
      <LinkRow label={t('settings.about.issues')} url={`${REPOSITORY}/issues`} />
    </SettingsGroup>

    <SettingsGroup title={t('settings.about.credits')} data-about-credits>
      {CREDITS.map((credit) => <LinkRow key={credit.name} label={credit.name} note={`${t(credit.role)} · ${credit.license}`} url={credit.url} />)}
    </SettingsGroup>

    <div className="space-y-0.5 px-2.5 text-center">
      <p className="text-micro text-muted-foreground">{t('settings.about.madeWith')}</p>
      <p className="text-micro text-muted-foreground">{t('settings.about.copyright')}</p>
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
  </SettingsPage>
}
