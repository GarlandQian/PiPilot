import * as React from 'react'
import {
  TbAdjustmentsHorizontal,
  TbAlertTriangle,
  TbCheck,
  TbCpu,
  TbDownload,
  TbExternalLink,
  TbInfoCircle,
  TbLanguage,
  TbLoader2,
  TbPackages,
  TbPalette,
  TbRefresh,
  TbTerminal2,
} from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Progress } from '@/components/ui/progress'
import { SettingRow, SettingSection } from './common'
import { GeneralSettings } from './GeneralSettings'
import { AppearanceSettings } from './AppearanceSettings'
import { LanguageSettings } from './LanguageSettings'
import { ModelsSettings } from './ModelsSettings'
import {
  IntegrationsSettings,
  type IntegrationsTabId,
} from './IntegrationsSettings'
import { TerminalSettings } from './TerminalSettings'
import { type MessageKey, useT } from '@/i18n'
import { cn } from '@/lib/utils'
import type { AppInfo } from '@/shared/ipc/contracts'
import { SUPPORTED_PI_VERSION } from '@/shared/local-pi'
import { usePiRpcActions, usePiRuntime } from '@/store/pi-rpc'
import { useApplicationUpdate } from '@/store/application-update'

export type SettingsSectionId =
  | 'general'
  | 'appearance'
  | 'language'
  | 'models'
  | 'integrations'
  | 'terminal'
  | 'about'

export type { IntegrationsTabId }

export interface SettingsSectionMeta {
  id: SettingsSectionId
  labelKey: MessageKey
  icon: React.ComponentType<{ className?: string }>
}

/** Section navigation metadata; rendered by the frame ContextPanel. */
export const SETTINGS_SECTIONS: readonly SettingsSectionMeta[] = [
  { id: 'general', labelKey: 'settings.nav.general', icon: TbAdjustmentsHorizontal },
  { id: 'appearance', labelKey: 'settings.nav.appearance', icon: TbPalette },
  { id: 'language', labelKey: 'settings.nav.language', icon: TbLanguage },
  { id: 'models', labelKey: 'settings.nav.models', icon: TbCpu },
  { id: 'integrations', labelKey: 'settings.nav.integrations', icon: TbPackages },
  { id: 'terminal', labelKey: 'settings.nav.terminal', icon: TbTerminal2 },
  { id: 'about', labelKey: 'settings.nav.about', icon: TbInfoCircle },
]

export function isSettingsSectionId(id: string): id is SettingsSectionId {
  return SETTINGS_SECTIONS.some((section) => section.id === id)
}

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

  React.useEffect(() => {
    const api = window.pipilot?.app
    if (!api) return
    let active = true
    void api.getInfo()
      .then((value) => {
        if (active) setInfo(value)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [])

  return info
}

function AboutSection({
  info,
}: {
  info: AppInfo | null
}) {
  const t = useT()
  const update = useApplicationUpdate()
  const [confirmInstall, setConfirmInstall] = React.useState(false)
  const snapshot = update.snapshot

  const updateVersion = snapshot && 'availableVersion' in snapshot
    ? snapshot.availableVersion
    : null
  const trustNotice = snapshot?.policy.package === 'macos'
    ? t('applicationUpdate.trust.macos')
    : snapshot?.policy.package === 'nsis'
      ? t('applicationUpdate.trust.windows')
      : null
  const updateStatus = snapshot?.state === 'disabled'
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
                : t('settings.about.loading')
  const canCheck = snapshot?.state === 'idle' || snapshot?.state === 'current'
  const canRetry = snapshot?.state === 'error' && snapshot.recoverable

  const runInstall = React.useCallback(async (confirmActiveWork: boolean) => {
    const result = await update.install(confirmActiveWork)
    if (result?.outcome === 'confirmation-required') setConfirmInstall(true)
    else if (result?.outcome === 'accepted') setConfirmInstall(false)
  }, [update])

  const retryUpdate = React.useCallback(() => {
    if (snapshot?.state !== 'error') return
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
      <SettingSection title={t('settings.about.title')}>
        <dl className="flex flex-col gap-1.5 px-2">
        <div className="flex gap-3">
          <dt className="w-28 shrink-0 text-caption text-muted-foreground">{t('settings.about.version')}</dt>
          <dd className="font-mono text-caption text-foreground">
            {info?.version ?? t('settings.about.loading')}
          </dd>
        </div>
        <div className="flex gap-3">
          <dt className="w-28 shrink-0 text-caption text-muted-foreground">{t('settings.about.piRuntime')}</dt>
          <dd className="break-all font-mono text-caption text-foreground">
                {t('settings.about.piVersion', { version: SUPPORTED_PI_VERSION })}
          </dd>
        </div>
        <div className="flex gap-3">
          <dt className="w-28 shrink-0 text-caption text-muted-foreground">{t('settings.about.platform')}</dt>
          <dd className="text-caption text-foreground">
            {info
              ? `${platformName(info.platform)} · ${info.arch} · Electron ${info.electronVersion}`
              : t('settings.about.loading')}
          </dd>
        </div>
        <div className="flex gap-3">
          <dt className="w-28 shrink-0 text-caption text-muted-foreground">{t('settings.about.issues')}</dt>
          <dd className="text-caption text-foreground">github.com/GarlandQian/PiPilot</dd>
        </div>
        </dl>
        <p className="px-2 pt-3 text-micro text-muted-foreground/70">{t('settings.about.copyright')}</p>
        <p className="px-2 pt-1 text-micro text-muted-foreground/70">{t('settings.about.madeWith')}</p>
      </SettingSection>
      <SettingSection
        title={t('applicationUpdate.settings.title')}
        desc={t('applicationUpdate.settings.description')}
      >
        <SettingRow
          label={t('applicationUpdate.settings.status')}
          desc={t(updateDescriptionKey(snapshot))}
        >
          <span className="flex max-w-[24rem] items-center gap-1.5 text-right text-caption text-muted-foreground">
            {snapshot?.state === 'checking' || snapshot?.state === 'downloading'
              ? <TbLoader2 className="size-4 animate-spin" aria-hidden />
              : snapshot?.state === 'error'
                ? <TbAlertTriangle className="size-4 text-destructive" aria-hidden />
                : snapshot?.state === 'current' || snapshot?.state === 'downloaded'
                  ? <TbCheck className="size-4 text-sage" aria-hidden />
                  : null}
            <span className="truncate">{updateStatus}</span>
          </span>
        </SettingRow>
        {snapshot?.state === 'downloading' && (
          <div className="px-2">
            <Progress value={snapshot.progress.percent} aria-label={t('applicationUpdate.progress', { percent: Math.round(snapshot.progress.percent) })} />
          </div>
        )}
        {trustNotice && (
          <div
            className="mx-2 flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 px-2.5 py-2 text-caption text-muted-foreground"
            role="note"
          >
            <TbAlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            <span>{trustNotice}</span>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 px-2 pt-1">
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

export interface SettingsLayoutProps {
  section: SettingsSectionId
  integrationsTab: IntegrationsTabId
  onIntegrationsTab: (tab: IntegrationsTabId) => void
}

export function SettingsLayout({
  section,
  integrationsTab,
  onIntegrationsTab,
}: SettingsLayoutProps) {
  const t = useT()
  const appInfo = useAppInfo()
  const piRuntime = usePiRuntime()
  const piActions = usePiRpcActions()
  const [restartBusy, setRestartBusy] = React.useState(false)
  const [restartMessage, setRestartMessage] = React.useState<string | null>(null)

  const restartPi = React.useCallback(async () => {
    const api = window.pipilot?.localPi.runtime
    if (!api || restartBusy) return
    setRestartBusy(true)
    setRestartMessage(null)
    try {
      await api.restart()
      await piActions.refresh()
      setRestartMessage(t('settings.general.piRestarted'))
    } catch {
      setRestartMessage(t('settings.general.piRestartFailed'))
    } finally {
      setRestartBusy(false)
    }
  }, [piActions, restartBusy, t])

  return (
    <main className="scroll-slim min-w-0 flex-1 overflow-x-hidden overflow-y-auto bg-background" aria-label={t(`settings.nav.${section}`)}>
      <div className={cn('mx-auto w-full', section === 'integrations' ? 'max-w-6xl' : 'max-w-2xl')}>
        {section === 'general' && (
          <GeneralSettings
            restartBusy={restartBusy}
            restartMessage={restartMessage}
            restartAvailable={piRuntime.runtime?.state === 'ready'}
            onRestart={() => void restartPi()}
          />
        )}
        {section === 'appearance' && <AppearanceSettings />}
        {section === 'language' && <LanguageSettings />}
        {section === 'models' && <ModelsSettings />}
        {section === 'integrations' && (
          <IntegrationsSettings tab={integrationsTab} onTab={onIntegrationsTab} />
        )}
        {section === 'about' && <AboutSection info={appInfo} />}
        {section === 'terminal' && <TerminalSettings />}
      </div>
    </main>
  )
}
