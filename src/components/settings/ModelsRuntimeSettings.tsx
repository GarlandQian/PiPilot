import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { MarkdownContent } from '@/components/chat/markdown/MarkdownContent'
import { useT } from '@/i18n'
import { usePiRpcActions, usePiRuntime } from '@/store/pi-rpc'
import { useConversationOperationFeedback } from '@/renderer/composer/use-operation-feedback'
import type { ModelsConfigSnapshot } from '@/shared/models-config'
import { SettingRow } from './common'

export function ModelsRuntimeSettings({ snapshot, operationOwnerKey }: {
  snapshot: ModelsConfigSnapshot | null
  operationOwnerKey: string
}) {
  const t = useT()
  const runtime = usePiRuntime()
  const actions = usePiRpcActions()
  const feedback = useConversationOperationFeedback(operationOwnerKey)
  const busy = feedback.pending !== null
  const connected = runtime.runtime?.state === 'ready'
  const run = (key: string, operation: () => Promise<void>) =>
    void feedback.run(key, operation, t('composer.modelActionFailed'))

  return <section className="min-w-0" aria-label={t('settings.models.workspace.usage')}>
    <div className="grid gap-5 border-b border-border pb-6 @min-[600px]/settings-workspace:grid-cols-2">
      <div className="min-w-0"><p className="text-micro text-muted-foreground">{t('settings.models.workspace.defaultModel')}</p>
        <p className="mt-2 break-words text-app font-medium">{snapshot?.defaultModel || t('settings.models.workspace.noDefault')}</p>
        <p className="mt-1 break-all font-mono text-micro text-muted-foreground">{snapshot?.defaultProvider || t('settings.models.workspace.defaultDescription')}</p></div>
      <div className="min-w-0"><p className="text-micro text-muted-foreground">{t('settings.models.workspace.currentModel')}</p>
        <p className="mt-2 break-words text-app font-medium">{runtime.selectedModel?.name || runtime.selectedModel?.id || t('settings.models.workspace.noCurrent')}</p>
        <p className="mt-1 break-all font-mono text-micro text-muted-foreground">{runtime.selectedModel?.provider || t('settings.models.thinkingDesc')}</p></div>
    </div>
    <div className="divide-y divide-border/60 pt-3">
      <SettingRow label={t('settings.models.thinkingTitle')} desc={t('settings.models.thinkingDesc')}>
        <Select value={runtime.session?.thinkingLevel} disabled={!connected || !runtime.selectedModel || runtime.thinkingLevels.length === 0 || busy}
          onValueChange={(value) => {
            const level = runtime.thinkingLevels.find((candidate) => candidate === value)
            if (level) run(`thinking:${value}`, () => actions.selectThinking(level))
          }}>
          <SelectTrigger size="sm" className="w-40" aria-label={t('settings.models.thinkingTitle')}><SelectValue /></SelectTrigger>
          <SelectContent align="end">{runtime.thinkingLevels.map((level) => <SelectItem key={level} value={level}>{t(`settings.models.thinking.${level}`)}</SelectItem>)}</SelectContent>
        </Select>
      </SettingRow>
      <SettingRow label={t('settings.models.autoCompaction')} desc={t('settings.models.autoCompactionDesc')}>
        <Switch aria-label={t('settings.models.autoCompaction')} checked={runtime.session?.autoCompactionEnabled ?? false} disabled={!connected || busy}
          onCheckedChange={(enabled) => run('auto-compaction', () => actions.setAutoCompaction(enabled))} />
      </SettingRow>
    </div>
    {feedback.error ? <div role="alert" data-model-settings-action-error className="pt-2 text-caption text-destructive [&_.md-body]:text-caption [&_.md-body]:text-destructive"><MarkdownContent markdown={feedback.error} /></div> : null}
  </section>
}
