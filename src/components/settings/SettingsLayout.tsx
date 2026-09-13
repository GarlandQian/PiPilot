import * as React from 'react'
import { TbAlertTriangle, TbArrowLeft, TbCheck, TbLoader2 } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { GeneralSettings } from './GeneralSettings'
import { AppearanceSettings } from './AppearanceSettings'
import { LanguageSettings } from './LanguageSettings'
import { ModelsSettings } from './ModelsSettings'
import { IntegrationsSettings, type IntegrationsTabId } from './IntegrationsSettings'
import { TerminalSettings } from './TerminalSettings'
import { AboutSettings } from './AboutSettings'
import { SETTINGS_SECTIONS, type SettingsSectionId } from './settings-navigation'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import { usePiRpcActions, usePiRuntime } from '@/store/pi-rpc'
import { useSettingsSaveStatus } from '@/store/settings'
import { SETTINGS_ROUTE_IDS } from '@/renderer/layout-preferences'

export { SETTINGS_GROUPS, SETTINGS_SECTIONS, isSettingsSectionId } from './settings-navigation'
export type { SettingsSectionId, SettingsGroupId, SettingsSectionMeta, SettingsGroupMeta } from './settings-navigation'
export type { IntegrationsTabId }

export interface SettingsLayoutProps {
  hidden?: boolean
  operationOwnerKey: string
  section: SettingsSectionId
  integrationsTab: IntegrationsTabId
  onIntegrationsTab: (tab: IntegrationsTabId) => void
  compact?: boolean
  detailVisible?: boolean
  onBack?: () => void
}

export function SettingsLayout({
  hidden = false,
  operationOwnerKey,
  section,
  integrationsTab,
  onIntegrationsTab,
  compact = false,
  detailVisible = true,
  onBack,
}: SettingsLayoutProps) {
  const t = useT()
  const compactBackRef = React.useRef<HTMLButtonElement>(null)
  const saveStatus = useSettingsSaveStatus()
  const piRuntime = usePiRuntime()
  const piActions = usePiRpcActions()
  const [restartBusy, setRestartBusy] = React.useState(false)
  const [restartMessage, setRestartMessage] = React.useState<string | null>(null)
  const [visitedSections, setVisitedSections] = React.useState<ReadonlySet<SettingsSectionId>>(
    () => new Set([section]),
  )

  React.useEffect(() => {
    setVisitedSections((current) => current.has(section) ? current : new Set([...current, section]))
  }, [section])

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
    if (hidden || !compact || !detailVisible) return
    const frame = requestAnimationFrame(() => compactBackRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [compact, detailVisible, hidden, section])

  const content = (id: SettingsSectionId) => {
    switch (id) {
      case 'general': return (
        <GeneralSettings
          restartBusy={restartBusy}
          restartMessage={restartMessage}
          restartAvailable={Boolean(piRuntime.runtime?.cwd && ['ready', 'crashed', 'error'].includes(piRuntime.runtime.state))}
          runtimeState={piRuntime.runtime?.state ?? 'stopped'}
          onRestart={() => void restartPi()}
        />
      )
      case 'appearance': return <AppearanceSettings />
      case 'language': return <LanguageSettings />
      case 'models': return <ModelsSettings operationOwnerKey={operationOwnerKey} active={!hidden && detailVisible && section === 'models'} />
      case 'integrations': return <IntegrationsSettings tab={integrationsTab} onTab={onIntegrationsTab} active={!hidden && detailVisible && section === 'integrations'} />
      case 'terminal': return <TerminalSettings />
      case 'about': return <AboutSettings />
    }
  }

  const metadata = SETTINGS_SECTIONS.find((item) => item.id === section)!
  const showSaveStatus = section !== 'models' && section !== 'integrations' && section !== 'about'

  return (
    <main
      hidden={hidden || !detailVisible}
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface"
      aria-label={t(`settings.nav.${section}`)}
    >
      <header className="flex shrink-0 items-start gap-3 border-b border-border/60 px-6 py-5 @min-[880px]/frame:px-10">
        {compact && onBack ? (
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
        ) : null}
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold text-foreground">{t(metadata.labelKey)}</h1>
          <p className="mt-1 text-caption text-muted-foreground">{t(metadata.descriptionKey)}</p>
        </div>
        {showSaveStatus && saveStatus !== 'idle' ? (
          <div className={cn('flex max-w-[45%] items-start gap-1.5 pt-1 text-caption', saveStatus === 'error' ? 'text-destructive' : 'text-muted-foreground')} role={saveStatus === 'error' ? 'alert' : 'status'} data-settings-save-status={saveStatus}>
            {saveStatus === 'saving' ? <TbLoader2 className="mt-0.5 size-3.5 shrink-0 animate-spin" aria-hidden /> : saveStatus === 'saved' ? <TbCheck className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden /> : <TbAlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />}
            <span>{t(`settings.redesign.save.${saveStatus}`)}</span>
          </div>
        ) : null}
      </header>
      {SETTINGS_ROUTE_IDS.map((id) => visitedSections.has(id) || id === section ? (
        <div
          key={id}
          hidden={id !== section}
          data-settings-section={id}
          className="scroll-slim min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto"
        >
          <div className={cn(
            '@container/settings-workspace mx-auto w-full px-6 py-7 @min-[880px]/frame:px-10',
            id === 'integrations' || id === 'models' ? 'max-w-6xl' : 'max-w-4xl',
          )}>
            {content(id)}
          </div>
        </div>
      ) : null)}
    </main>
  )
}
