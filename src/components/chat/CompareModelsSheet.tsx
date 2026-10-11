import * as React from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { FormActions, SettingsField, SettingsGroup, SettingsRow, SettingsSheet } from '@/components/settings/kit'
import { useT } from '@/i18n'
import type { PiModelOption } from './ModelPicker'

const key = (model: PiModelOption) => `${model.provider}\u0000${model.id}`

/**
 * Cursor's best-of-n: send one task to 2–4 models at once. Each works in its
 * own working copy of the current branch; a judge model can compare them.
 */
export function CompareModelsSheet({ open, onOpenChange, models, current, initialPrompt, onStart }: {
  open: boolean
  onOpenChange(open: boolean): void
  models: readonly PiModelOption[]
  current: PiModelOption | null
  initialPrompt: string
  onStart(input: { prompt: string; models: PiModelOption[]; judge?: PiModelOption }): Promise<void>
}) {
  const t = useT()
  const [prompt, setPrompt] = React.useState(initialPrompt)
  const [chosen, setChosen] = React.useState<ReadonlySet<string>>(new Set())
  const [judgeOn, setJudgeOn] = React.useState(false)
  const [judge, setJudge] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const promptId = React.useId(), judgeId = React.useId()
  React.useEffect(() => {
    if (!open) return
    setPrompt(initialPrompt); setError(null); setJudgeOn(false)
    setChosen(new Set(current ? [key(current)] : []))
    setJudge(current ? key(current) : models[0] ? key(models[0]) : '')
  }, [current, initialPrompt, models, open])
  const selected = models.filter((model) => chosen.has(key(model)))
  const canStart = prompt.trim().length > 0 && selected.length >= 2 && selected.length <= 4 && !busy
  const start = () => {
    if (!canStart) return
    setBusy(true); setError(null)
    const judgeModel = judgeOn ? models.find((model) => key(model) === judge) : undefined
    void onStart({ prompt: prompt.trim(), models: selected, ...(judgeModel ? { judge: judgeModel } : {}) })
      .then(() => onOpenChange(false), (caught: unknown) => setError(caught instanceof Error ? caught.message : String(caught)))
      .finally(() => setBusy(false))
  }
  return <SettingsSheet open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next) }} wide data-compare-sheet
    title={t('compare.title')} description={t('compare.description')}
    footer={<FormActions onCancel={() => onOpenChange(false)} onSave={start} saving={busy} canSave={canStart} saveLabel={t('compare.start')} error={error} />}>
    <div className="space-y-4">
      <SettingsField label={t('compare.task')} htmlFor={promptId}>
        <Textarea id={promptId} rows={4} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={t('compare.taskPlaceholder')} />
      </SettingsField>
      <SettingsGroup title={t('compare.models', { count: selected.length })} footer={t('compare.modelsHint')} boxRole="list">
        {models.map((model) => {
          const checked = chosen.has(key(model))
          return <label key={key(model)} data-settings-row data-compare-model={model.id} className="flex min-h-10 cursor-default items-center gap-3 px-3 py-2">
            <Checkbox checked={checked} disabled={!checked && chosen.size >= 4} onCheckedChange={(next) => setChosen((previous) => {
              const updated = new Set(previous)
              if (next === true) updated.add(key(model)); else updated.delete(key(model))
              return updated
            })} />
            <span className="min-w-0 flex-1 truncate text-app">{model.name}</span>
            <span className="shrink-0 truncate text-micro text-muted-foreground">{model.provider}</span>
          </label>
        })}
      </SettingsGroup>
      <SettingsGroup>
        <SettingsRow label={t('compare.judge')} info={t('compare.judgeInfo')}>
          <Switch checked={judgeOn} onCheckedChange={setJudgeOn} aria-label={t('compare.judge')} />
        </SettingsRow>
        {judgeOn ? <SettingsRow label={t('compare.judgeModel')} htmlFor={judgeId}>
          <select id={judgeId} className="mac-select max-w-64" value={judge} onChange={(event) => setJudge(event.target.value)}>
            {models.map((model) => <option key={key(model)} value={key(model)}>{model.name}</option>)}
          </select>
        </SettingsRow> : null}
      </SettingsGroup>
    </div>
  </SettingsSheet>
}
