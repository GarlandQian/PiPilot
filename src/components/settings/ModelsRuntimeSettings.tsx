import * as React from 'react'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { MarkdownContent } from '@/components/chat/markdown/MarkdownContent'
import { useT } from '@/i18n'
import { usePiIntegrations } from '@/store/pi-integrations'
import { usePiRpcActions, usePiRuntime } from '@/store/pi-rpc'
import { useConversationOperationFeedback } from '@/renderer/composer/use-operation-feedback'
import type { ModelsConfigSnapshot } from '@/shared/models-config'
import { PI_RETRY_DEFAULT_MAX_RETRIES, PI_RETRY_MAX_RETRIES_LIMIT } from '@/shared/pi-integrations'
import { SettingsGroup, SettingsRow, StatusText } from './kit'

const SEPARATOR = '\u0000'

/** Which model new chats use, the current chat's settings, and retrying failed requests. */
export function ModelsRuntimeSettings({ snapshot, operationOwnerKey, onSetDefault, defaultBusy }: {
  snapshot: ModelsConfigSnapshot | null
  operationOwnerKey: string
  onSetDefault(providerId: string, modelId: string): Promise<boolean>
  defaultBusy: boolean
}) {
  const t = useT()
  const runtime = usePiRuntime()
  const actions = usePiRpcActions()
  const integrations = usePiIntegrations()
  const feedback = useConversationOperationFeedback(operationOwnerKey)
  const [defaultFailed, setDefaultFailed] = React.useState(false)
  const [retryState, setRetryState] = React.useState<'synchronized' | 'persisted-only' | 'failed' | null>(null)
  const busy = feedback.pending !== null
  const connected = runtime.runtime?.state === 'ready'
  const run = (key: string, operation: () => Promise<void>) => void feedback.run(key, operation, t('composer.modelActionFailed'))
  const retry = integrations.snapshot?.retry
  const [retryCount, setRetryCount] = React.useState(String(PI_RETRY_DEFAULT_MAX_RETRIES))
  const retryBusy = ['operating', 'loading', 'checking'].includes(integrations.status)
  const retryCountValue = Number(retryCount)
  const validRetryCount = /^\d+$/u.test(retryCount) && Number.isSafeInteger(retryCountValue) && retryCountValue <= PI_RETRY_MAX_RETRIES_LIMIT
  React.useEffect(() => {
    setRetryCount(String(retry?.globalMaxRetries ?? PI_RETRY_DEFAULT_MAX_RETRIES))
  }, [operationOwnerKey, retry?.globalMaxRetries])
  React.useEffect(() => { setRetryState(null) }, [operationOwnerKey])

  // Models grouped by provider, the current default kept even when Pi cannot list it now.
  const byProvider = React.useMemo(() => {
    const groups = new Map<string, { id: string; name: string }[]>()
    for (const model of runtime.models) {
      if (model.type && model.type !== 'chat') continue
      groups.set(model.provider, [...(groups.get(model.provider) ?? []), { id: model.id, name: model.name || model.id }])
    }
    if (snapshot?.defaultProvider && snapshot.defaultModel && !groups.get(snapshot.defaultProvider)?.some((model) => model.id === snapshot.defaultModel)) {
      groups.set(snapshot.defaultProvider, [...(groups.get(snapshot.defaultProvider) ?? []), { id: snapshot.defaultModel, name: snapshot.defaultModel }])
    }
    return [...groups]
  }, [runtime.models, snapshot?.defaultModel, snapshot?.defaultProvider])
  const defaultValue = snapshot?.defaultProvider && snapshot.defaultModel ? `${snapshot.defaultProvider}${SEPARATOR}${snapshot.defaultModel}` : ''

  const changeRetry = async (enabled: boolean, maxRetries = retry?.globalMaxRetries ?? PI_RETRY_DEFAULT_MAX_RETRIES) => {
    setRetryState(null)
    const result = await integrations.setRetrySettings({ enabled, maxRetries })
    setRetryState(result ? (result.runtimeSync === 'synchronized' ? 'synchronized' : 'persisted-only') : 'failed')
  }

  return <SettingsGroup title={t('settings.models.usage.title')} data-models-usage>
    <SettingsRow label={t('settings.models.workspace.defaultModel')} info={t('settings.models.usage.defaultInfo')} htmlFor="models-default-model"
      description={defaultFailed ? <span className="text-destructive" role="alert">{t('settings.models.setDefaultFailed')}</span> : undefined}>
      <select id="models-default-model" className="mac-select max-w-72" value={defaultValue} disabled={defaultBusy || byProvider.length === 0}
        aria-label={t('settings.models.workspace.defaultModel')}
        onChange={(event) => {
          const [provider, model] = event.target.value.split(SEPARATOR)
          if (!provider || !model) return
          setDefaultFailed(false)
          void onSetDefault(provider, model).then((saved) => setDefaultFailed(!saved))
        }}>
        {defaultValue ? null : <option value="">{t('settings.models.workspace.noDefault')}</option>}
        {byProvider.map(([provider, models]) => <optgroup key={provider} label={provider}>
          {models.map((model) => <option key={model.id} value={`${provider}${SEPARATOR}${model.id}`}>{model.name}</option>)}
        </optgroup>)}
      </select>
    </SettingsRow>
    <SettingsRow label={t('settings.models.workspace.currentModel')} info={t('settings.models.usage.currentInfo')}>
      <span className="min-w-0 truncate text-app text-muted-foreground" title={runtime.selectedModel?.provider}>
        {runtime.selectedModel ? runtime.selectedModel.name || runtime.selectedModel.id : t('settings.models.workspace.noCurrent')}
      </span>
    </SettingsRow>
    <SettingsRow label={t('settings.models.thinkingTitle')} info={t('settings.models.thinkingDesc')} htmlFor="models-thinking">
      <select id="models-thinking" className="mac-select" value={runtime.session?.thinkingLevel ?? ''} aria-label={t('settings.models.thinkingTitle')}
        disabled={!connected || !runtime.selectedModel || runtime.thinkingLevels.length === 0 || busy}
        onChange={(event) => {
          const level = runtime.thinkingLevels.find((candidate) => candidate === event.target.value)
          if (level) run(`thinking:${level}`, () => actions.selectThinking(level))
        }}>
        {runtime.thinkingLevels.length ? null : <option value="">—</option>}
        {runtime.thinkingLevels.map((level) => <option key={level} value={level}>{t(`settings.models.thinking.${level}`)}</option>)}
      </select>
    </SettingsRow>
    <SettingsRow label={t('settings.models.autoCompaction')} info={t('settings.models.autoCompactionDesc')}>
      <Switch aria-label={t('settings.models.autoCompaction')} checked={runtime.session?.autoCompactionEnabled ?? false} disabled={!connected || busy}
        onCheckedChange={(enabled) => run('auto-compaction', () => actions.setAutoCompaction(enabled))} />
    </SettingsRow>
    {retry ? <SettingsRow label={t('settings.models.usage.retry')} info={t('settings.integrations.retry.globalDesc')}
      description={retryState === 'persisted-only' ? <StatusText tone="warning">{t('settings.integrations.retry.persistedOnly')}</StatusText>
        : retryState === 'failed' ? <StatusText tone="danger">{t('settings.integrations.retry.persistenceFailed')}</StatusText>
          : retry.globalEnabled !== retry.effective.enabled || retry.globalMaxRetries !== retry.effective.maxRetries ? t('settings.integrations.retry.overrideNotice') : undefined}>
      <Switch aria-label={t('settings.models.usage.retry')} checked={retry.globalEnabled}
        disabled={retryBusy}
        onCheckedChange={(checked) => void changeRetry(checked)} />
    </SettingsRow> : null}
    {retry ? <SettingsRow label={t('settings.integrations.retry.maxRetries')} htmlFor="models-retry-count"
      info={t('settings.integrations.retry.maxRetriesInfo', { max: PI_RETRY_MAX_RETRIES_LIMIT })}
      description={<span id="models-retry-count-feedback" role={!validRetryCount ? 'alert' : undefined} className={!validRetryCount ? 'text-destructive' : undefined}>
        {!validRetryCount ? t('settings.integrations.retry.invalidMaxRetries', { max: PI_RETRY_MAX_RETRIES_LIMIT })
          : retry.effective.enabled && retry.effective.maxRetries > 0
            ? t('settings.integrations.retry.effectiveCount', { count: retry.effective.maxRetries })
            : t('settings.integrations.retry.effectiveDisabled')}
      </span>}>
      <Input id="models-retry-count" className="w-20" type="number" inputMode="numeric" min={0} max={PI_RETRY_MAX_RETRIES_LIMIT} step={1}
        value={retryCount} disabled={retryBusy} aria-invalid={!validRetryCount} aria-describedby="models-retry-count-feedback"
        onChange={(event) => { setRetryCount(event.target.value); setRetryState(null) }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && validRetryCount && !retryBusy) {
            event.preventDefault()
            void changeRetry(retry.globalEnabled, retryCountValue)
          }
        }} />
      <Button size="sm" variant="outline" disabled={retryBusy || !validRetryCount || retryCountValue === retry.globalMaxRetries}
        onClick={() => void changeRetry(retry.globalEnabled, retryCountValue)}>{t('common.save')}</Button>
    </SettingsRow> : null}
    {feedback.error ? <div data-settings-row role="alert" data-model-settings-action-error className="px-3 py-2 text-caption text-destructive [&_.md-body]:text-caption [&_.md-body]:text-destructive"><MarkdownContent markdown={feedback.error} /></div> : null}
  </SettingsGroup>
}
