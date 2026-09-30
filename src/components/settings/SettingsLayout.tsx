import * as React from 'react'
import { TbAlertTriangle, TbCheck, TbChevronLeft, TbLoader2 } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { SettingsIconTile } from './common'
import type { IntegrationsTabId } from './IntegrationsSettings'
import { SETTINGS_SECTIONS, type SettingsSectionId } from './settings-navigation'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import { usePiRpcActions, usePiRuntime } from '@/store/pi-rpc'
import { useSettingsSaveStatus } from '@/store/settings'
import { SETTINGS_ROUTE_IDS } from '@/renderer/layout-preferences'

const GeneralSettings = React.lazy(() => import('./GeneralSettings').then((module) => ({ default: module.GeneralSettings })))
const AppearanceSettings = React.lazy(() => import('./AppearanceSettings').then((module) => ({ default: module.AppearanceSettings })))
const LanguageSettings = React.lazy(() => import('./LanguageSettings').then((module) => ({ default: module.LanguageSettings })))
const ModelsSettings = React.lazy(() => import('./ModelsSettings').then((module) => ({ default: module.ModelsSettings })))
const IntegrationsSettings = React.lazy(() => import('./IntegrationsSettings').then((module) => ({ default: module.IntegrationsSettings })))
const TerminalSettings = React.lazy(() => import('./TerminalSettings').then((module) => ({ default: module.TerminalSettings })))
const AboutSettings = React.lazy(() => import('./AboutSettings').then((module) => ({ default: module.AboutSettings })))
const ScheduledTasksSettings = React.lazy(() => import('./ScheduledTasksSettings').then((module) => ({ default: module.ScheduledTasksSettings })))

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
      case 'scheduled-tasks': return <ScheduledTasksSettings />
    }
  }

  const metadata = SETTINGS_SECTIONS.find((item) => item.id === section)!
  const showSaveStatus = section !== 'models' && section !== 'integrations' && section !== 'about' && section !== 'scheduled-tasks'

  return (
    <main
      hidden={hidden || !detailVisible}
      className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface"
      aria-label={t(metadata.labelKey)}
    >
      {/* Unified toolbar, like a System Settings pane title. */}
      <header className="app-drag toolbar-material absolute inset-x-0 top-0 z-30 flex h-(--frame-header-h) items-center gap-2 pr-4 pl-3">
        {compact && onBack ? (
          <Button
            ref={compactBackRef}
            variant="ghost"
            size="icon-sm"
            className="glass size-[34px] hover:bg-(--glass-fill) hover:brightness-[0.97]"
            aria-label={t('settings.back')}
            title={t('settings.back')}
            onClick={onBack}
          >
            <TbChevronLeft className="size-[18px] stroke-[2.4]" aria-hidden />
          </Button>
        ) : <span className="w-2" aria-hidden />}
        <h1 className="min-w-0 flex-1 truncate text-[calc(var(--app-font-size)+2px)] font-bold text-foreground">{t(metadata.labelKey)}</h1>
        {showSaveStatus && saveStatus !== 'idle' ? (
          <div className={cn('flex max-w-[45%] items-center gap-1.5 text-caption', saveStatus === 'error' ? 'text-destructive' : 'text-muted-foreground')} role={saveStatus === 'error' ? 'alert' : 'status'} data-settings-save-status={saveStatus}>
            {saveStatus === 'saving' ? <TbLoader2 className="size-3.5 shrink-0 animate-spin" aria-hidden /> : saveStatus === 'saved' ? <TbCheck className="size-3.5 shrink-0 text-success" aria-hidden /> : <TbAlertTriangle className="size-3.5 shrink-0" aria-hidden />}
            <span className="truncate">{t(`settings.redesign.save.${saveStatus}`)}</span>
          </div>
        ) : null}
      </header>
      {SETTINGS_ROUTE_IDS.map((id) => visitedSections.has(id) || id === section ? (
        <div
          key={id}
          hidden={id !== section}
          data-settings-section={id}
          className="scroll-slim min-h-0 min-w-0 flex-1 scroll-pt-[calc(var(--frame-header-h)+12px)] overflow-x-hidden overflow-y-auto"
        >
          <div className={cn(
            '@container/settings-workspace mx-auto w-full px-6 pt-[calc(var(--frame-header-h)+1.5rem)] pb-10 @min-[880px]/frame:px-8',
            id === 'integrations' || id === 'models' ? 'max-w-6xl' : 'max-w-[720px]',
          )}>
            {id === 'about' ? null : (() => {
              const meta = SETTINGS_SECTIONS.find((item) => item.id === id)!
              // System Settings pane hero: big tile, bold name, one-line summary.
              return <div className="mb-6 flex flex-col items-center gap-1 rounded-xl bg-group px-6 pt-5 pb-4 text-center shadow-[inset_0_0_0_0.5px_var(--color-group-border)]">
                <SettingsIconTile section={meta} className="mb-1.5 size-14 rounded-[15px] [&_svg]:size-[58%]" />
                <p className="text-[calc(var(--app-font-size)+4px)] leading-tight font-bold text-foreground">{t(meta.labelKey)}</p>
                <p className="max-w-md text-caption text-muted-foreground">{t(meta.descriptionKey)}</p>
              </div>
            })()}
            <React.Suspense fallback={<div className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground" role="status"><TbLoader2 className="size-4 animate-spin" aria-hidden />{t('settings.loadingPage')}</div>}>
              {content(id)}
            </React.Suspense>
          </div>
        </div>
      ) : null)}
    </main>
  )
}
