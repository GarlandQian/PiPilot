import * as React from 'react'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useLocale, useT, type MessageKey } from '@/i18n'
import type { ModelCatalogDetails } from '@/shared/model-catalog'
import { FormActions, SettingsField, SettingsGroup, SettingsRow, SettingsSheet } from '../kit'
import { fillFromDetails, isRecord, numberField, stringField, THINKING_LEVELS, withField, type JsonRecord, type ThinkingLevel } from './provider-editor-model'

/** A whole number or a price, typed freely and written once it is valid. */
export function NumberInput({ id, value, onChange, integer = false, placeholder, label, className }: {
  id?: string
  value: number | undefined
  onChange(value: number | undefined): void
  integer?: boolean
  placeholder?: string
  label?: string
  className?: string
}) {
  const [text, setText] = React.useState(value === undefined ? '' : String(value))
  const parse = (candidate: string) => {
    const trimmed = candidate.trim()
    if (trimmed === '') return { valid: true, value: undefined }
    const parsed = Number(trimmed)
    const valid = Number.isFinite(parsed) && parsed >= 0 && (!integer || (Number.isSafeInteger(parsed) && parsed >= 1))
    return { valid, value: valid ? parsed : undefined }
  }
  // Follow changes made elsewhere (filling from the catalog).
  React.useEffect(() => {
    const current = parse(text)
    if (!current.valid || current.value !== value) setText(value === undefined ? '' : String(value))
    // `text` is only compared, not followed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  const invalid = !parse(text).valid
  return <Input id={id} inputMode={integer ? 'numeric' : 'decimal'} value={text} placeholder={placeholder} aria-label={label}
    aria-invalid={invalid || undefined} className={className ?? 'font-mono tabular-nums'}
    onChange={(event) => {
      setText(event.target.value)
      const next = parse(event.target.value)
      if (next.valid) onChange(next.value)
    }} />
}

const COST_FIELDS = ['input', 'output', 'cacheRead', 'cacheWrite'] as const

/** Price fields are written together: the ones left empty count as free. */
function withCost(raw: JsonRecord, field: typeof COST_FIELDS[number], value: number | undefined) {
  const cost = { ...(isRecord(raw.cost) ? raw.cost : {}) }
  if (value === undefined) delete cost[field]
  else cost[field] = value
  const set = COST_FIELDS.filter((key) => typeof cost[key] === 'number')
  if (set.length === 0 && cost.tiers === undefined) return withField(raw, 'cost', undefined)
  for (const key of COST_FIELDS) if (typeof cost[key] !== 'number') cost[key] = 0
  return withField(raw, 'cost', cost)
}

/** One model of a provider, edited in a sheet; OK hands it back to the provider page, which saves it. */
export function ModelSheet({ open, onOpenChange, initial, isNew, takenIds, lookup, onSubmit }: {
  open: boolean
  onOpenChange(open: boolean): void
  initial: JsonRecord
  isNew: boolean
  /** IDs the provider's other models use. */
  takenIds: readonly string[]
  /** What Pi's catalog and models.dev know about an ID. */
  lookup(id: string): Promise<ModelCatalogDetails | null>
  onSubmit(raw: JsonRecord): void
}) {
  const t = useT()
  const locale = useLocale()
  const [raw, setRaw] = React.useState(initial)
  const [showIssues, setShowIssues] = React.useState(false)
  const [filled, setFilled] = React.useState<string | null>(null)
  const lookedUp = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (!open) return
    setRaw(initial)
    setShowIssues(false)
    setFilled(null)
    lookedUp.current = isNew ? null : stringField(initial, 'id')
    // A new sheet each time it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  const id = stringField(raw, 'id').trim()
  const issue = !id ? 'required' : takenIds.includes(id) ? 'duplicate' : null
  const map = isRecord(raw.thinkingLevelMap) ? raw.thinkingLevelMap : {}
  const input = Array.isArray(raw.input) ? raw.input : undefined
  const cost = isRecord(raw.cost) ? raw.cost : undefined
  const price = new Intl.NumberFormat(locale, { maximumFractionDigits: 4 })

  /** A typed ID: fill in what is known, never over what is set. */
  const fill = async () => {
    if (!id || lookedUp.current === id) return
    lookedUp.current = id
    const details = await lookup(id)
    if (!details) return
    setRaw((current) => stringField(current, 'id').trim() === id ? fillFromDetails(current, details) : current)
    setFilled(id)
  }

  const setLevel = (level: ThinkingLevel, value: string | null | undefined) => {
    const next = { ...map }
    if (value === undefined) delete next[level]
    else next[level] = value
    setRaw((current) => withField(current, 'thinkingLevelMap', Object.keys(next).length ? next : undefined))
  }

  const submit = () => {
    if (issue) {
      setShowIssues(true)
      return
    }
    onSubmit({ ...raw, id })
  }

  return <SettingsSheet open={open} onOpenChange={onOpenChange} wide data-models-model-sheet
    title={t(isNew ? 'settings.models.sheet.addTitle' : 'settings.models.sheet.editTitle')}
    description={filled ? t('settings.models.sheet.filled') : t('settings.models.sheet.description')}
    footer={<FormActions onCancel={() => onOpenChange(false)} onSave={submit} saveLabel={t('common.done')} />}>
    <div className="space-y-5">
      <SettingsGroup>
        <SettingsField label={t('settings.models.editor.modelId')} htmlFor="model-sheet-id"
          error={showIssues && issue ? t(issue === 'required' ? 'settings.models.editor.modelIdRequired' : 'settings.models.editor.modelIdDuplicate') : undefined}>
          <Input id="model-sheet-id" value={stringField(raw, 'id')} autoFocus={isNew} spellCheck={false} autoComplete="off" className="font-mono"
            aria-invalid={(showIssues && Boolean(issue)) || undefined} placeholder={t('settings.models.editor.modelIdPlaceholder')}
            onChange={(event) => setRaw((current) => withField(current, 'id', event.target.value))}
            onBlur={() => void fill()} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void fill() } }} />
        </SettingsField>
        <SettingsField label={t('settings.models.editor.displayName')} htmlFor="model-sheet-name">
          <Input id="model-sheet-name" value={stringField(raw, 'name')} placeholder={id || undefined}
            onChange={(event) => setRaw((current) => withField(current, 'name', event.target.value || undefined))} />
        </SettingsField>
      </SettingsGroup>

      <SettingsGroup title={t('settings.models.sheet.capabilities')} info={t('settings.models.editor.modelsFootnote')}>
        <SettingsRow label={t('settings.models.form.reasoning')} info={t('settings.models.editor.reasoningHint')}>
          <Switch aria-label={t('settings.models.form.reasoning')} checked={raw.reasoning === true}
            onCheckedChange={(checked) => setRaw((current) => withField(current, 'reasoning', checked ? true : undefined))} />
        </SettingsRow>
        <SettingsRow label={t('settings.models.workspace.vision')} info={t('settings.models.editor.imageHint')}>
          <Switch aria-label={t('settings.models.workspace.vision')} checked={input?.includes('image') ?? false}
            onCheckedChange={(checked) => setRaw((current) => withField(current, 'input', checked ? ['text', 'image'] : input ? ['text'] : undefined))} />
        </SettingsRow>
        <SettingsField label={t('settings.models.form.contextWindow')} htmlFor="model-sheet-context" info={t('settings.models.editor.tokensHint')}>
          <NumberInput id="model-sheet-context" integer value={numberField(raw, 'contextWindow')} placeholder="128000" className="w-44 font-mono tabular-nums"
            onChange={(value) => setRaw((current) => withField(current, 'contextWindow', value))} />
        </SettingsField>
        <SettingsField label={t('settings.models.form.maxTokens')} htmlFor="model-sheet-output" info={t('settings.models.editor.tokensHint')}>
          <NumberInput id="model-sheet-output" integer value={numberField(raw, 'maxTokens')} placeholder="16384" className="w-44 font-mono tabular-nums"
            onChange={(value) => setRaw((current) => withField(current, 'maxTokens', value))} />
        </SettingsField>
      </SettingsGroup>

      <SettingsGroup title={t('settings.models.editor.price')} info={t('settings.models.editor.priceHint')}
        footer={cost ? t('settings.models.editor.priceSummary', {
          input: price.format(typeof cost.input === 'number' ? cost.input : 0), output: price.format(typeof cost.output === 'number' ? cost.output : 0),
        }) : undefined}>
        {COST_FIELDS.map((field) => <SettingsField key={field} label={t(`settings.models.editor.cost.${field}` as MessageKey)} htmlFor={`model-sheet-cost-${field}`}>
          <NumberInput id={`model-sheet-cost-${field}`} value={typeof cost?.[field] === 'number' ? cost[field] as number : undefined} placeholder="0"
            className="w-44 font-mono tabular-nums" label={t(`settings.models.editor.cost.${field}` as MessageKey)}
            onChange={(value) => setRaw((current) => withCost(current, field, value))} />
        </SettingsField>)}
      </SettingsGroup>

      {raw.reasoning === true || isRecord(raw.thinkingLevelMap) ? <SettingsGroup title={t('settings.models.editor.thinkingLevels')} info={t('settings.models.editor.thinkingLevelsHint')}>
        {THINKING_LEVELS.map((level) => {
          const value = map[level]
          const choice = value === null ? 'unsupported' : typeof value === 'string' ? 'custom' : 'default'
          const levelName = t(`settings.models.thinking.${level}` as MessageKey)
          return <SettingsRow key={level} label={levelName}>
            {choice === 'custom' ? <Input value={value as string} className="h-[26px] w-36 font-mono text-caption" aria-label={t('settings.models.editor.levelValue', { level: levelName })}
              onChange={(event) => setLevel(level, event.target.value)} /> : null}
            <select className="mac-select" value={choice} aria-label={t('settings.models.editor.thinkingLevelFor', { level: levelName })}
              onChange={(event) => setLevel(level, event.target.value === 'default' ? undefined : event.target.value === 'unsupported' ? null : typeof value === 'string' ? value : level)}>
              <option value="default">{t('settings.models.editor.levelDefault')}</option>
              <option value="unsupported">{t('settings.models.editor.levelUnsupported')}</option>
              <option value="custom">{t('settings.models.editor.levelCustom')}</option>
            </select>
          </SettingsRow>
        })}
      </SettingsGroup> : null}
    </div>
  </SettingsSheet>
}
