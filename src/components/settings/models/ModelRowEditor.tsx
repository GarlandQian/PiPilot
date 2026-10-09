import * as React from 'react'
import { TbChevronRight, TbFlask, TbHelpCircle, TbLoader2, TbStar, TbStarFilled, TbTrash } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useLocale, useT, type MessageKey } from '@/i18n'
import { cn } from '@/lib/utils'
import { EditorField, TestResultLine, type TestState } from '../editor-page'
import { capabilitiesUnknown, isRecord, numberField, stringField, THINKING_LEVELS, withField, type JsonRecord, type ModelRow, type ThinkingLevel } from './provider-editor-model'

/** A whole number or a price, typed freely and written once it is valid. */
function NumberInput({ id, value, onChange, integer = false, placeholder, label }: {
  id?: string
  value: number | undefined
  onChange(value: number | undefined): void
  integer?: boolean
  placeholder?: string
  label?: string
}) {
  const [text, setText] = React.useState(value === undefined ? '' : String(value))
  const parse = (candidate: string) => {
    const trimmed = candidate.trim()
    if (trimmed === '') return { valid: true, value: undefined }
    const parsed = Number(trimmed)
    const valid = Number.isFinite(parsed) && parsed >= 0 && (!integer || (Number.isSafeInteger(parsed) && parsed >= 1))
    return { valid, value: valid ? parsed : undefined }
  }
  // Follow changes made elsewhere (the JSON view, filling from the catalog).
  React.useEffect(() => {
    const current = parse(text)
    if (!current.valid || current.value !== value) setText(value === undefined ? '' : String(value))
    // `text` is only compared, not followed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  const invalid = !parse(text).valid
  return <Input id={id} inputMode={integer ? 'numeric' : 'decimal'} value={text} placeholder={placeholder} aria-label={label}
    aria-invalid={invalid || undefined} className="font-mono tabular-nums"
    onChange={(event) => {
      setText(event.target.value)
      const next = parse(event.target.value)
      if (next.valid) onChange(next.value)
    }} />
}

const COST_FIELDS = ['input', 'output', 'cacheRead', 'cacheWrite'] as const

function costOf(raw: JsonRecord) {
  return isRecord(raw.cost) ? raw.cost : undefined
}

/** Price fields are written together: the ones left empty count as free. */
function withCost(raw: JsonRecord, field: typeof COST_FIELDS[number], value: number | undefined) {
  const cost = { ...costOf(raw) }
  if (value === undefined) delete cost[field]
  else cost[field] = value
  const set = COST_FIELDS.filter((key) => typeof cost[key] === 'number')
  if (set.length === 0 && cost.tiers === undefined) return withField(raw, 'cost', undefined)
  for (const key of COST_FIELDS) if (typeof cost[key] !== 'number') cost[key] = 0
  return withField(raw, 'cost', cost)
}

type LevelChoice = 'default' | 'unsupported' | 'custom'

function ThinkingLevels({ raw, onChange, idPrefix }: { raw: JsonRecord; onChange(raw: JsonRecord): void; idPrefix: string }) {
  const t = useT()
  const map = isRecord(raw.thinkingLevelMap) ? raw.thinkingLevelMap : {}
  const setLevel = (level: ThinkingLevel, value: string | null | undefined) => {
    const next = { ...map }
    if (value === undefined) delete next[level]
    else next[level] = value
    onChange(withField(raw, 'thinkingLevelMap', Object.keys(next).length ? next : undefined))
  }
  return <div className="min-w-0 space-y-1.5">
    <p className="text-caption font-medium text-foreground/85">{t('settings.models.editor.thinkingLevels')}</p>
    <div className="grid min-w-0 gap-1.5 @min-[560px]/settings-workspace:grid-cols-2">
      {THINKING_LEVELS.map((level) => {
        const value = map[level]
        const choice: LevelChoice = value === null ? 'unsupported' : typeof value === 'string' ? 'custom' : 'default'
        return <div key={level} className="flex min-w-0 items-center gap-2 rounded-md bg-fill px-2 py-1">
          <span className="w-16 shrink-0 text-caption">{t(`settings.models.thinking.${level}` as MessageKey)}</span>
          <Select value={choice} onValueChange={(next) => setLevel(level, next === 'default' ? undefined : next === 'unsupported' ? null : typeof value === 'string' ? value : level)}>
            <SelectTrigger size="sm" className="h-6 w-28 shrink-0" aria-label={t('settings.models.editor.thinkingLevelFor', { level: t(`settings.models.thinking.${level}` as MessageKey) })}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="default">{t('settings.models.editor.levelDefault')}</SelectItem>
              <SelectItem value="unsupported">{t('settings.models.editor.levelUnsupported')}</SelectItem>
              <SelectItem value="custom">{t('settings.models.editor.levelCustom')}</SelectItem>
            </SelectContent>
          </Select>
          {choice === 'custom' ? <Input id={`${idPrefix}-level-${level}`} value={value as string} className="h-6 min-w-0 flex-1 font-mono text-caption"
            aria-label={t('settings.models.editor.levelValue', { level: t(`settings.models.thinking.${level}` as MessageKey) })}
            onChange={(event) => setLevel(level, event.target.value)} /> : null}
        </div>
      })}
    </div>
    <p className="text-micro leading-relaxed text-muted-foreground">{t('settings.models.editor.thinkingLevelsHint')}</p>
  </div>
}

export function ModelRowEditor({ row, issue, expanded, onExpandedChange, isDefault, onDefault, onChange, onRemove, test, onTest, testDisabled, autoFocus, onIdCommit, numberFormat }: {
  row: ModelRow
  issue?: 'required' | 'duplicate'
  expanded: boolean
  onExpandedChange(expanded: boolean): void
  isDefault: boolean
  onDefault(): void
  onChange(raw: JsonRecord): void
  onRemove(): void
  test?: TestState
  onTest(): void
  testDisabled?: boolean
  autoFocus?: boolean
  /** The ID was typed: fill in what the catalog knows about it. */
  onIdCommit?(id: string): void
  numberFormat: Intl.NumberFormat
}) {
  const t = useT()
  const locale = useLocale()
  const raw = row.raw
  const id = stringField(raw, 'id')
  const name = stringField(raw, 'name')
  const input = Array.isArray(raw.input) ? raw.input : undefined
  const prefix = `model-${row.key}`
  const contextWindow = numberField(raw, 'contextWindow')
  const maxTokens = numberField(raw, 'maxTokens')
  const cost = costOf(raw)
  const unknown = capabilitiesUnknown(raw)
  const title = name || id || t('settings.models.editor.newModel')
  const chips = [
    raw.reasoning === true ? t('settings.models.form.reasoning') : null,
    input?.includes('image') ? t('settings.models.workspace.vision') : null,
    contextWindow ? t('settings.models.workspace.context', { count: numberFormat.format(contextWindow) }) : null,
  ].filter(Boolean)
  const lastCommitted = React.useRef(id)
  const commitId = () => {
    const trimmed = stringField(raw, 'id').trim()
    if (trimmed && trimmed !== lastCommitted.current) {
      lastCommitted.current = trimmed
      onIdCommit?.(trimmed)
    }
  }
  const price = new Intl.NumberFormat(locale, { maximumFractionDigits: 4 })

  return <article className={cn('min-w-0 border-t border-border/70 first:border-t-0', issue && 'bg-destructive/[0.04]')} data-model-row={id || row.key}>
    <div className="flex min-w-0 items-center gap-1.5 py-2.5 pr-1">
      <button type="button" className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-0.5 pl-1 text-left outline-none focus-visible:focus-ring"
        aria-expanded={expanded} aria-controls={`${prefix}-details`} onClick={() => onExpandedChange(!expanded)}>
        <TbChevronRight className={cn('size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none', expanded && 'rotate-90')} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className={cn('min-w-0 break-words text-app font-medium', !id && 'text-muted-foreground')}>{title}</span>
            {isDefault ? <span className="text-micro text-sage">{t('settings.models.defaultBadge')}</span> : null}
          </span>
          <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-micro text-muted-foreground">
            {name && id && name !== id ? <span className="break-all font-mono">{id}</span> : null}
            {chips.map((chip) => <span key={chip}>{chip}</span>)}
            {unknown && id ? <span className="inline-flex items-center gap-1 text-warning" title={t('settings.models.editor.unknownHint')}><TbHelpCircle className="size-3.5" aria-hidden />{t('settings.models.unknownCapabilities')}</span> : null}
            {issue ? <span className="text-destructive">{t(issue === 'required' ? 'settings.models.editor.modelIdRequired' : 'settings.models.editor.modelIdDuplicate')}</span> : null}
          </span>
        </span>
      </button>
      <Tooltip>
        <TooltipTrigger asChild><Button variant="ghost" size="icon-sm" aria-pressed={isDefault}
          aria-label={t('settings.models.editor.makeDefault', { name: title })} disabled={!id} onClick={onDefault}>
          {isDefault ? <TbStarFilled className="text-sage" aria-hidden /> : <TbStar aria-hidden />}
        </Button></TooltipTrigger>
        <TooltipContent>{t(isDefault ? 'settings.models.editor.isDefault' : 'settings.models.setDefault')}</TooltipContent>
      </Tooltip>
      <Button variant="ghost" size="xs" disabled={testDisabled || !id || test?.state === 'testing'} onClick={onTest}
        aria-label={t('settings.models.editor.testModel', { name: title })}>
        {test?.state === 'testing' ? <TbLoader2 className="animate-spin" aria-hidden /> : <TbFlask aria-hidden />}
        <span className="hidden @min-[520px]/settings-workspace:inline">{t(test?.state === 'testing' ? 'settings.models.testing' : 'settings.models.testModel')}</span>
      </Button>
      <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-destructive" aria-label={t('settings.models.editor.removeModel', { name: title })} onClick={onRemove}>
        <TbTrash aria-hidden />
      </Button>
    </div>
    <TestResultLine test={test} className="-mt-1 pb-2.5 pl-7" />
    {expanded ? <div id={`${prefix}-details`} className="min-w-0 space-y-4 pt-1 pb-4 pl-7 pr-1">
      <div className="grid min-w-0 gap-3 @min-[560px]/settings-workspace:grid-cols-2">
        <EditorField label={t('settings.models.editor.modelId')} htmlFor={`${prefix}-id`}
          error={issue ? t(issue === 'required' ? 'settings.models.editor.modelIdRequired' : 'settings.models.editor.modelIdDuplicate') : undefined}>
          <Input id={`${prefix}-id`} value={id} autoFocus={autoFocus} spellCheck={false} autoComplete="off" className="font-mono"
            aria-invalid={Boolean(issue) || undefined} placeholder={t('settings.models.editor.modelIdPlaceholder')}
            onChange={(event) => onChange(withField(raw, 'id', event.target.value))}
            onBlur={commitId} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commitId() } }} />
        </EditorField>
        <EditorField label={t('settings.models.editor.displayName')} htmlFor={`${prefix}-name`}>
          <Input id={`${prefix}-name`} value={name} placeholder={id || undefined}
            onChange={(event) => onChange(withField(raw, 'name', event.target.value || undefined))} />
        </EditorField>
        <EditorField label={t('settings.models.form.contextWindow')} htmlFor={`${prefix}-context`} hint={t('settings.models.editor.tokensHint')}>
          <NumberInput id={`${prefix}-context`} integer value={contextWindow} placeholder="128000"
            onChange={(value) => onChange(withField(raw, 'contextWindow', value))} />
        </EditorField>
        <EditorField label={t('settings.models.form.maxTokens')} htmlFor={`${prefix}-output`} hint={t('settings.models.editor.tokensHint')}>
          <NumberInput id={`${prefix}-output`} integer value={maxTokens} placeholder="16384"
            onChange={(value) => onChange(withField(raw, 'maxTokens', value))} />
        </EditorField>
      </div>
      <div className="grid min-w-0 gap-2 @min-[560px]/settings-workspace:grid-cols-2">
        <label className="flex min-w-0 items-center justify-between gap-3 rounded-md bg-fill px-3 py-2">
          <span className="min-w-0"><span className="block text-caption font-medium">{t('settings.models.form.reasoning')}</span>
            <span className="block text-micro text-muted-foreground">{t('settings.models.editor.reasoningHint')}</span></span>
          <Switch checked={raw.reasoning === true} onCheckedChange={(checked) => onChange(withField(raw, 'reasoning', checked ? true : undefined))} />
        </label>
        <label className="flex min-w-0 items-center justify-between gap-3 rounded-md bg-fill px-3 py-2">
          <span className="min-w-0"><span className="block text-caption font-medium">{t('settings.models.workspace.vision')}</span>
            <span className="block text-micro text-muted-foreground">{t('settings.models.editor.imageHint')}</span></span>
          <Switch checked={input?.includes('image') ?? false}
            onCheckedChange={(checked) => onChange(withField(raw, 'input', checked ? ['text', 'image'] : input ? ['text'] : undefined))} />
        </label>
      </div>
      <div className="min-w-0 space-y-1.5">
        <p className="text-caption font-medium text-foreground/85">{t('settings.models.editor.price')}</p>
        <div className="grid min-w-0 grid-cols-2 gap-2 @min-[560px]/settings-workspace:grid-cols-4">
          {COST_FIELDS.map((field) => <label key={field} className="min-w-0 space-y-1">
            <span className="block text-micro text-muted-foreground">{t(`settings.models.editor.cost.${field}` as MessageKey)}</span>
            <NumberInput value={typeof cost?.[field] === 'number' ? cost[field] as number : undefined} placeholder="0"
              label={t(`settings.models.editor.cost.${field}` as MessageKey)} onChange={(value) => onChange(withCost(raw, field, value))} />
          </label>)}
        </div>
        <p className="text-micro leading-relaxed text-muted-foreground">{cost ? t('settings.models.editor.priceSummary', {
          input: price.format(typeof cost.input === 'number' ? cost.input : 0), output: price.format(typeof cost.output === 'number' ? cost.output : 0),
        }) : t('settings.models.editor.priceHint')}</p>
      </div>
      {raw.reasoning === true || isRecord(raw.thinkingLevelMap) ? <ThinkingLevels raw={raw} onChange={onChange} idPrefix={prefix} /> : null}
    </div> : null}
  </article>
}
