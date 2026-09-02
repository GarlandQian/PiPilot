import * as React from 'react'
import {
  TbAdjustmentsHorizontal,
  TbAlertTriangle,
  TbArrowLeft,
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
import {
  SETTINGS_ROUTE_IDS,
  type SettingsRouteId,
} from '@/renderer/layout-preferences'

export type SettingsSectionId = SettingsRouteId

export type SettingsGroupId =
  | 'preferences'
  | 'models-runtime'
  | 'packages-mcp'
  | 'about'

export type { IntegrationsTabId }

export interface SettingsSectionMeta {
  id: SettingsSectionId
  labelKey: MessageKey
  icon: React.ComponentType<{ className?: string }>
}

export interface SettingsGroupMeta {
  id: SettingsGroupId
  labelKey: MessageKey
  sections: readonly SettingsSectionMeta[]
}

/** Grouped navigation metadata; the flat export remains for deep-link consumers. */
export const SETTINGS_GROUPS: readonly SettingsGroupMeta[] = [
  {
    id: 'preferences',
    labelKey: 'settings.group.preferences',
    sections: [
      { id: 'general', labelKey: 'settings.nav.general', icon: TbAdjustmentsHorizontal },
      { id: 'appearance', labelKey: 'settings.nav.appearance', icon: TbPalette },
      { id: 'language', labelKey: 'settings.nav.language', icon: TbLanguage },
      { id: 'terminal', labelKey: 'settings.nav.terminal', icon: TbTerminal2 },
    ],
  },
  {
    id: 'models-runtime',
    labelKey: 'settings.group.modelsRuntime',
    sections: [
      { id: 'models', labelKey: 'settings.nav.models', icon: TbCpu },
    ],
  },
  {
    id: 'packages-mcp',
    labelKey: 'settings.group.packagesMcp',
    sections: [
      { id: 'integrations', labelKey: 'settings.nav.integrations', icon: TbPackages },
    ],
  },
  {
    id: 'about',
    labelKey: 'settings.group.about',
    sections: [
      { id: 'about', labelKey: 'settings.nav.about', icon: TbInfoCircle },
    ],
  },
]

const SETTINGS_SECTIONS_BY_ID = new Map(
  SETTINGS_GROUPS.flatMap((group) => group.sections)
    .map((section) => [section.id, section] as const),
)

/** Flat route order is intentionally kept stable for command/search consumers. */
export const SETTINGS_SECTIONS: readonly SettingsSectionMeta[] = SETTINGS_ROUTE_IDS
  .map((id) => SETTINGS_SECTIONS_BY_ID.get(id))
  .filter((section): section is SettingsSectionMeta => section !== undefined)

export function isSettingsSectionId(id: string): id is SettingsSectionId {
  return SETTINGS_ROUTE_IDS.some((section) => section === id)
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
  compact?: boolean
  detailVisible?: boolean
  onBack?: () => void
}

export function SettingsLayout({
  section,
  integrationsTab,
  onIntegrationsTab,
  compact = false,
  detailVisible = true,
  onBack,
}: SettingsLayoutProps) {
  const t = useT()
  const compactBackRef = React.useRef<HTMLButtonElement>(null)
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

  React.useEffect(() => {
    if (!compact || !detailVisible) return
    const frame = requestAnimationFrame(() => compactBackRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [compact, detailVisible, section])

  return (
    <main
      hidden={!detailVisible}
      className="scroll-slim min-w-0 flex-1 overflow-x-hidden overflow-y-auto bg-background"
      aria-label={t(`settings.nav.${section}`)}
    >
      {compact && onBack ? (
        <header className="sticky top-0 z-10 flex h-10 items-center gap-2 border-b border-border bg-background/95 px-3">
          <Button
            ref={compactBackRef}
            variant="ghost"
            size="sm"
            aria-label={t('settings.back')}
            onClick={onBack}
          >
            <TbArrowLeft aria-hidden />
            {t('settings.back')}
          </Button>
          <span className="min-w-0 truncate text-caption font-medium text-foreground">
            {t(`settings.nav.${section}`)}
          </span>
        </header>
      ) : null}
      <div className={cn(
        '@container/settings-workspace mx-auto w-full',
        section === 'integrations' || section === 'models' ? 'max-w-6xl' : 'max-w-2xl',
      )}>
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
