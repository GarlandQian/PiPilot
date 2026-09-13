import * as React from 'react'
import { TbCheck, TbChevronRight, TbPackage, TbPlugConnected, TbServer } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { useT } from '@/i18n'
import type { PiIntegrationOperationResult, PiResourceKind } from '@/shared/pi-integrations'
import { usePiIntegrations } from '@/store/pi-integrations'
import { usePiExtensionUi } from '@/store/pi-rpc'
import type { IntegrationsTabId } from '../IntegrationsSettings'
import { MarkdownContent } from '@/components/chat/markdown/MarkdownContent'

const OVERVIEW_RESOURCE_KINDS: PiResourceKind[] = ['extension', 'skill', 'prompt']

export function Overview({ onTab }: { onTab(tab: IntegrationsTabId): void }) {
  const t = useT()
  const integrations = usePiIntegrations()
  const snapshot = integrations.snapshot
  const retry = snapshot?.retry
  const [retrySave, setRetrySave] = React.useState<{
    state: PiIntegrationOperationResult['runtimeSync'] | 'persistence-failed'
    runtimeError?: string
  } | null>(null)
  const retryEpoch = React.useRef(0)
  React.useEffect(() => () => { retryEpoch.current += 1 }, [])
  const totals = React.useMemo(() => {
    const result: Record<PiResourceKind, number> = {
      extension: 0,
      skill: 0,
      prompt: 0,
      theme: 0,
    }
    for (const resource of snapshot?.resources ?? []) result[resource.kind] += 1
    return result
  }, [snapshot?.resources])
  const visibleResourceKinds = OVERVIEW_RESOURCE_KINDS.filter((kind) => totals[kind] > 0)
  const totalResolvedResources = Object.values(totals)
    .reduce((total, count) => total + count, 0)
  const extension = usePiExtensionUi()
  const runtimeProblems = React.useMemo(() => [
    ...extension.unsupportedMethods.map((method) =>
      t('settings.integrations.runtimeSupport.unsupportedMethod', { method })),
    ...(snapshot?.diagnostics ?? [])
      .filter((diagnostic) => diagnostic.severity !== 'info')
      .map((diagnostic) => diagnostic.message),
  ], [extension.unsupportedMethods, snapshot?.diagnostics, t])

  React.useEffect(() => {
    retryEpoch.current += 1
    setRetrySave(null)
  }, [integrations.scope])

  const changeGlobalRetry = async (enabled: boolean) => {
    const epoch = ++retryEpoch.current
    setRetrySave(null)
    const result = await integrations.setRetryEnabled(enabled)
    if (retryEpoch.current !== epoch) return
    setRetrySave(result
      ? { state: result.runtimeSync, runtimeError: result.runtimeError }
      : { state: 'persistence-failed' })
  }

  return (
    <div
      className="space-y-7"
      role="region"
      aria-label={t('settings.integrations.tab.overview')}
    >
      <section>
        <div className="grid gap-3 @min-[520px]/integrations:grid-cols-2">
          <button
            type="button"
            className="group flex min-w-0 items-center justify-between gap-4 rounded-lg bg-muted/60 px-5 py-5 text-left outline-none transition-colors duration-(--duration-fast) hover:bg-muted focus-visible:focus-ring"
            onClick={() => onTab('packages')}
          >
            <span className="min-w-0 space-y-2 text-caption font-medium text-foreground">
              <TbPackage className="size-5 text-primary" aria-hidden />
              {t('settings.integrations.overview.packages')}
            </span>
            <span className="flex shrink-0 items-center gap-1.5 tabular-nums text-title text-foreground">
              {snapshot?.packages.length ?? 0}
              <TbChevronRight
                className="size-3.5 text-muted-foreground transition-transform duration-(--duration-fast) group-hover:translate-x-0.5"
                aria-hidden
              />
            </span>
          </button>
          <button
            type="button"
            className="group flex min-w-0 items-center justify-between gap-4 rounded-lg bg-muted/60 px-5 py-5 text-left outline-none transition-colors duration-(--duration-fast) hover:bg-muted focus-visible:focus-ring"
            onClick={() => onTab('resources')}
          >
            <span className="min-w-0 space-y-2 text-caption font-medium text-foreground">
              <TbPlugConnected className="size-5 text-primary" aria-hidden />
              {t('settings.integrations.overview.resources')}
            </span>
            <span className="flex shrink-0 items-center gap-1.5 tabular-nums text-title text-foreground">
              {totalResolvedResources}
              <TbChevronRight
                className="size-3.5 text-muted-foreground transition-transform duration-(--duration-fast) group-hover:translate-x-0.5"
                aria-hidden
              />
            </span>
          </button>
        </div>

        {(visibleResourceKinds.length > 0 || totals.theme > 0) && (
          <div className="mt-4 px-1">
            {visibleResourceKinds.length > 0 && (
              <dl className="flex flex-wrap gap-x-5 gap-y-1.5 text-caption">
                {visibleResourceKinds.map((kind) => (
                  <div key={kind} className="flex items-baseline gap-1.5">
                    <dt className="order-2 text-muted-foreground">
                      {t(`settings.integrations.resource.${kind}`)}
                    </dt>
                    <dd className="order-1 font-medium tabular-nums text-foreground">
                      {totals[kind]}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            {totals.theme > 0 && (
              <p className="mt-2 border-t border-border/70 pt-2 text-micro text-muted-foreground">
                <span className="font-medium tabular-nums text-foreground">
                  {totals.theme} {t('settings.integrations.resource.theme')}
                </span>
                {' · '}
                {t('settings.integrations.resources.themeBoundary')}
              </p>
            )}
          </div>
        )}
      </section>

      <section
        className="border-b border-border pb-6"
        role="region"
        aria-labelledby="pi-runtime-support-title"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 id="pi-runtime-support-title" className="text-app font-semibold">{t('settings.integrations.runtimeSupport.title')}</h3>
          <div className="flex flex-wrap gap-1">
            <Button variant="ghost" size="xs" onClick={() => onTab('mcp')}><TbServer aria-hidden />{t('settings.integrations.tab.mcp')}<TbChevronRight aria-hidden /></Button>
            <Button variant="ghost" size="xs" onClick={() => onTab('external-control')}><TbPlugConnected aria-hidden />{t('settings.integrations.tab.external-control')}<TbChevronRight aria-hidden /></Button>
          </div>
        </div>
        {runtimeProblems.length === 0 ? (
          <p className="mt-3 flex items-start gap-2 text-caption text-muted-foreground">
            <TbCheck className="mt-0.5 size-4 shrink-0 text-sage" aria-hidden />
            {t('settings.integrations.runtimeSupport.ok')}
          </p>
        ) : (
          <>
            <p className="mt-1 text-caption text-muted-foreground">
              {t('settings.integrations.runtimeSupport.problems', { count: runtimeProblems.length })}
            </p>
            <ul className="scroll-slim mt-3 max-h-48 space-y-2 overflow-y-auto rounded-lg bg-muted/50 p-3 text-caption text-muted-foreground">
              {runtimeProblems.map((message, index) => (
                <li key={`${message}-${index}`} className="break-words">
                  <MarkdownContent markdown={message} />
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {retry && (
        <section role="region" aria-labelledby="pi-retry-settings-title">
          <div className="grid gap-6 @min-[880px]/integrations:grid-cols-[minmax(0,1fr)_minmax(15rem,0.65fr)]">
            <div className="min-w-0">
              <h3 id="pi-retry-settings-title" className="text-app font-semibold">
                {t('settings.integrations.retry.title')}
              </h3>
              <p className="mt-1 text-caption text-muted-foreground">
                {t('settings.integrations.retry.globalDesc')}
              </p>
              <label className="mt-4 flex max-w-xl items-center justify-between gap-4 rounded-lg bg-muted/50 px-3 py-3">
                <span className="min-w-0">
                  <span className="block text-caption font-medium">
                    {t('settings.integrations.retry.globalLabel')}
                  </span>
                  <span className="mt-0.5 block text-micro text-muted-foreground">
                    {retry.globalEnabled
                      ? t('settings.integrations.retry.enabled')
                      : t('settings.integrations.retry.disabled')}
                  </span>
                </span>
                <Switch
                  checked={retry.globalEnabled}
                  disabled={integrations.status === 'operating' || integrations.status === 'loading' || integrations.status === 'checking'}
                  aria-label={t('settings.integrations.retry.globalLabel')}
                  onCheckedChange={(checked) => void changeGlobalRetry(checked)}
                />
              </label>
              {retrySave?.state === 'synchronized' && (
                <p className="mt-3 text-caption text-success" role="status">
                  {t('settings.integrations.retry.synchronized')}
                </p>
              )}
              {retrySave?.state === 'persisted-only' && (
                <div className="mt-3 text-caption text-warning" role="status">
                  <p>{t('settings.integrations.retry.persistedOnly')}</p>
                  {retrySave.runtimeError && <div className="mt-1 break-words text-micro"><MarkdownContent markdown={retrySave.runtimeError} /></div>}
                </div>
              )}
              {retrySave?.state === 'persistence-failed' && (
                <p className="mt-3 text-caption text-destructive" role="alert">
                  {t('settings.integrations.retry.persistenceFailed')}
                </p>
              )}
            </div>
            <div className="min-w-0 border-l-2 border-border pl-4">
              <h4 className="text-caption font-medium">
                {t('settings.integrations.retry.effectiveTitle', {
                  scope: t(`settings.integrations.scope.${integrations.scope.kind}`),
                })}
              </h4>
              <dl className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-x-5 gap-y-2 text-caption">
                <dt className="text-muted-foreground">{t('settings.integrations.retry.state')}</dt>
                <dd>{retry.effective.enabled
                  ? t('settings.integrations.retry.enabled')
                  : t('settings.integrations.retry.disabled')}</dd>
                <dt className="text-muted-foreground">{t('settings.integrations.retry.maxRetries')}</dt>
                <dd>{retry.effective.maxRetries}</dd>
                <dt className="text-muted-foreground">{t('settings.integrations.retry.baseDelay')}</dt>
                <dd>{t('settings.integrations.retry.milliseconds', { value: retry.effective.baseDelayMs })}</dd>
              </dl>
              {retry.globalEnabled !== retry.effective.enabled && (
                <p className="mt-3 text-micro text-muted-foreground">
                  {t('settings.integrations.retry.overrideNotice')}
                </p>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
