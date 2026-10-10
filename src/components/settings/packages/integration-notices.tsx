import * as React from 'react'
import { TbCheck, TbLoader2, TbRefresh } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { useT, type MessageKey } from '@/i18n'
import { usePiIntegrations } from '@/store/pi-integrations'
import { usePiExtensionUi } from '@/store/pi-rpc'

/** What Pi is doing with packages now, a restart it needs, or what went wrong — shown above a pane's groups. */
export function IntegrationNotices() {
  const t = useT()
  const integrations = usePiIntegrations()
  const snapshot = integrations.snapshot
  const busy = integrations.status === 'operating'
  const operation = integrations.operation
  return <>
    {snapshot?.restartRequired ? <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-[12px] bg-warning/10 px-3.5 py-2.5" role="status">
      <span className="min-w-0 flex-1 text-caption text-foreground">{t('settings.integrations.restartRequired')}</span>
      <Button size="sm" disabled={busy} onClick={() => void integrations.restart()}>
        <TbRefresh className={busy ? 'animate-spin motion-reduce:animate-none' : ''} aria-hidden />{t('settings.integrations.restart')}
      </Button>
    </div> : null}
    {operation ? ['queued', 'running', 'progress'].includes(operation.phase)
      ? <p className="flex items-center gap-1.5 px-2.5 text-caption text-muted-foreground" role="status"><TbLoader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
        {operation.progress?.message ?? t(`settings.integrations.operation.${operation.kind}` as MessageKey)}</p>
      : operation.phase === 'succeeded'
        ? <p className="flex items-center gap-1.5 px-2.5 text-caption text-success" role="status"><TbCheck className="size-3.5" aria-hidden />{t(`settings.integrations.operation.success.${operation.kind}` as MessageKey)}</p>
        : null : null}
    {integrations.errorMessage ? <div className="flex min-w-0 items-center justify-between gap-3 px-2.5 text-caption text-destructive" role="alert">
      <span className="min-w-0 break-words">{integrations.errorMessage}</span>
      <Button variant="ghost" size="sm" onClick={() => void integrations.refresh()}>{t('common.retry')}</Button>
    </div> : null}
  </>
}

/** Pi's package manager could not be reached: the pane says so instead of its groups. */
export function IntegrationsUnavailable() {
  const t = useT()
  const integrations = usePiIntegrations()
  const snapshot = integrations.snapshot
  if (!snapshot && (integrations.status === 'checking' || integrations.status === 'loading')) {
    return <div className="settings-group flex items-center justify-center gap-2 px-3 py-10 text-caption text-muted-foreground" role="status"><TbLoader2 className="size-4 animate-spin" aria-hidden />{t('settings.integrations.loading')}</div>
  }
  if (snapshot?.state !== 'unavailable') return null
  return <div className="settings-group space-y-1 px-4 py-4">
    <p className="text-app font-medium">{t('settings.integrations.unavailable')}</p>
    <p className="text-caption text-muted-foreground">{t('settings.integrations.unavailableDesc')}</p>
    {snapshot.diagnostics.map((diagnostic) => <p key={`${diagnostic.code}:${diagnostic.source ?? ''}`} className="text-micro text-muted-foreground">{diagnostic.message}</p>)}
  </div>
}

/** Problems the open Pi runtime reported (unsupported extension surfaces and the like), for the panes they concern. */
export function useRuntimeProblems() {
  const t = useT()
  const integrations = usePiIntegrations()
  const extension = usePiExtensionUi()
  return [
    ...extension.unsupportedMethods.map((method) => t('settings.integrations.runtimeSupport.unsupportedMethod', { method })),
    ...(integrations.snapshot?.diagnostics ?? []).filter((diagnostic) => diagnostic.severity !== 'info').map((diagnostic) => diagnostic.message),
  ]
}

/** The runtime's problems as a warning above a pane's groups; nothing when there are none. */
export function RuntimeProblemsBanner() {
  const t = useT()
  const problems = useRuntimeProblems()
  if (!problems.length) return null
  return <div className="rounded-[12px] bg-warning/10 px-3.5 py-2.5 text-caption" role="status" data-runtime-problems>
    <p className="font-medium">{t('settings.integrations.runtimeSupport.problems', { count: problems.length })}</p>
    <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">{problems.slice(0, 4).map((problem, index) => <li key={`${index}:${problem}`} className="break-words">{problem}</li>)}</ul>
  </div>
}

/** Opening a pane shows what Pi has now: packages may have changed outside PiPilot (pi install, another window). */
export function useRefreshWhenShown(active: boolean) {
  const integrations = usePiIntegrations()
  const latest = React.useRef(integrations)
  latest.current = integrations
  const shown = React.useRef(false)
  React.useEffect(() => {
    if (!active) { shown.current = false; return }
    if (shown.current) return
    shown.current = true
    const current = latest.current
    if (current.snapshot && current.status !== 'operating' && current.status !== 'loading' && current.status !== 'checking') void current.refresh()
  }, [active])
}
