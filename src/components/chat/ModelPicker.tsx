import * as React from 'react'
import { TbCheck, TbChevronDown, TbLoader2 } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Slider } from '@/components/ui/slider'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import { MarkdownContent } from './markdown/MarkdownContent'
import { projectModelThinkingTrigger, projectReasoningSlider } from '@/renderer/composer/composer-controls'
import { useConversationOperationFeedback } from '@/renderer/composer/use-operation-feedback'
import type { LocalPiThinkingLevel } from '@/shared/local-pi'

export interface PiModelOption {
  id: string
  name: string
  provider: string
}

interface ModelPickerProps {
  operationOwnerKey: string
  models: readonly PiModelOption[]
  selected: PiModelOption | null
  thinkingLevels: readonly LocalPiThinkingLevel[]
  selectedThinkingLevel: LocalPiThinkingLevel | null
  connected: boolean
  loading: boolean
  error?: string | null
  onSelect(provider: string, modelId: string): void | Promise<void>
  onThinkingSelect(level: LocalPiThinkingLevel): void | Promise<void>
}

/** Keyboard steps settle before Pi is asked to change, so ← → is not a burst of commands. */
const KEYBOARD_COMMIT_DELAY_MS = 300

function groupModels(models: readonly PiModelOption[]) {
  const groups = new Map<string, PiModelOption[]>()
  for (const model of models) {
    const group = groups.get(model.provider) ?? []
    group.push(model)
    groups.set(model.provider, group)
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([provider, entries]) => ({
      provider,
      models: [...entries].sort((left, right) =>
        (left.name || left.id).localeCompare(right.name || right.id)),
    }))
}

const modelKey = (model: Pick<PiModelOption, 'provider' | 'id'>) => `${model.provider}\0${model.id}`

/**
 * One button for model and effort, as in Codex. Its panel lists the models
 * and, below them, a slider over the reasoning levels the current model
 * supports. Unlike Codex's power slider it never changes the model.
 */
export function ModelPicker({
  operationOwnerKey,
  models,
  selected,
  thinkingLevels,
  selectedThinkingLevel,
  connected,
  loading,
  error,
  onSelect,
  onThinkingSelect,
}: ModelPickerProps) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const feedback = useConversationOperationFeedback(operationOwnerKey)
  const selecting = feedback.pending?.action ?? null
  const groups = React.useMemo(() => groupModels(models), [models])
  const ordered = React.useMemo(() => groups.flatMap((group) => group.models), [groups])
  const trigger = projectModelThinkingTrigger(selected, selectedThinkingLevel, thinkingLevels)
  const label = trigger.modelLabel ?? t('composer.noModel')
  const thinkingLabel = trigger.thinkingLevel
    ? t(`settings.models.thinking.${trigger.thinkingLevel}`)
    : null
  const selectedKey = selected ? modelKey(selected) : ''
  const unavailable = !connected || loading || groups.length === 0
  const listRef = React.useRef<HTMLDivElement>(null)
  const typeahead = React.useRef({ text: '', at: 0 })

  // While dragging only the label follows; the level is applied on release.
  const [draft, setDraft] = React.useState<number | null>(null)
  const commitTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const pointerDown = React.useRef(false)
  const slider = projectReasoningSlider(thinkingLevels, selectedThinkingLevel)
  const adjustable = connected && !loading && thinkingLevels.length > 1 && slider.index >= 0
  const shownIndex = draft ?? slider.index
  const shownLevel = thinkingLevels[shownIndex] ?? selectedThinkingLevel
  const shownCostly = projectReasoningSlider(thinkingLevels, shownLevel ?? null).costly
  React.useEffect(() => { setDraft(null) }, [selectedThinkingLevel, thinkingLevels])
  React.useEffect(() => () => { if (commitTimer.current) clearTimeout(commitTimer.current) }, [])

  const choose = React.useCallback(async (model: PiModelOption) => {
    if (!connected || loading || selecting) return
    if (modelKey(model) === selectedKey) {
      setOpen(false)
      return
    }
    await feedback.run(modelKey(model), async (isCurrent) => {
      await onSelect(model.provider, model.id)
      if (isCurrent()) setOpen(false)
    }, t('composer.modelActionFailed'))
  }, [connected, feedback.run, loading, onSelect, selectedKey, selecting, t])

  // A level chosen while another is still applying waits its turn.
  const queuedLevel = React.useRef<LocalPiThinkingLevel | null>(null)
  const chooseThinking = React.useCallback(async (level: LocalPiThinkingLevel) => {
    if (!connected || loading) return
    if (selecting) {
      queuedLevel.current = level
      return
    }
    if (level === selectedThinkingLevel) {
      setDraft(null)
      return
    }
    // The panel stays open so the level can be tuned further.
    const applied = await feedback.run(`thinking\0${level}`, async () => {
      await onThinkingSelect(level)
    }, t('composer.modelActionFailed'))
    if (!applied) setDraft(null)
  }, [connected, feedback.run, loading, onThinkingSelect, selectedThinkingLevel, selecting, t])
  React.useEffect(() => {
    if (selecting || !queuedLevel.current) return
    const level = queuedLevel.current
    queuedLevel.current = null
    void chooseThinking(level)
  }, [chooseThinking, selecting])

  const commit = (index: number, delay: number) => {
    if (commitTimer.current) clearTimeout(commitTimer.current)
    const level = thinkingLevels[index]
    if (!level) return
    commitTimer.current = setTimeout(() => {
      commitTimer.current = null
      void chooseThinking(level)
    }, delay)
  }

  const options = () => [...(listRef.current?.querySelectorAll<HTMLElement>('[role="option"]:not([aria-disabled="true"])') ?? [])]
  const focusOption = (target: HTMLElement | undefined) => {
    if (!target) return
    for (const option of options()) option.tabIndex = option === target ? 0 : -1
    target.focus()
    target.scrollIntoView({ block: 'nearest' })
  }
  const onListKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const all = options()
    const index = all.indexOf(document.activeElement as HTMLElement)
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      focusOption(all[Math.min(all.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)))])
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      focusOption(event.key === 'Home' ? all[0] : all[all.length - 1])
    } else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey && event.key !== ' ') {
      // Type a name's first letters to jump to it, like a native list.
      const now = Date.now()
      const text = (now - typeahead.current.at < 600 ? typeahead.current.text : '') + event.key.toLowerCase()
      typeahead.current = { text, at: now }
      const match = all.find((option) => option.dataset.name?.toLowerCase().startsWith(text))
      if (match) focusOption(match)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          // Borderless until hovered, so it reads as a setting, not a second action.
          className="h-[30px] min-w-0 max-w-72 shrink gap-1.5 px-2.5 text-caption font-medium"
          data-model-thinking-trigger
          aria-label={thinkingLabel
            ? t('composer.modelThinkingSwitcher', { model: label, thinking: thinkingLabel })
            : t('composer.modelSwitcher', { model: label })}
        >
          <span className="truncate">{label}</span>
          {thinkingLabel ? (
            // Codex-style "model effort". In a narrow composer the effort goes
            // first, then the model name truncates.
            <span className="min-w-0 shrink-[2] truncate text-muted-foreground @max-md:hidden">{thinkingLabel}</span>
          ) : null}
          {selecting
            ? <TbLoader2 className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
            : <TbChevronDown className="size-3.5 shrink-0 stroke-[2.4] text-muted-foreground" aria-hidden />}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        collisionPadding={12}
        aria-label={t('composer.modelPanel')}
        aria-busy={Boolean(selecting)}
        className="flex w-[min(300px,calc(100vw-24px))] max-h-[min(480px,calc(100vh-96px))] flex-col gap-0 overflow-hidden p-[6px]"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          const current = listRef.current?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]')
          focusOption(current ?? options()[0])
        }}
      >
        {unavailable ? (
          <p className="px-2.5 py-2 text-caption text-muted-foreground">
            {!connected
              ? t('composer.modelDisconnected')
              : loading
                ? t('settings.models.loading')
                : t('composer.modelEmpty')}
          </p>
        ) : (
          <div
            ref={listRef}
            role="listbox"
            aria-label={t('composer.models')}
            onKeyDown={onListKeyDown}
            className="scroll-slim min-h-0 flex-1 overflow-y-auto"
          >
            {groups.map((group) => (
              <div key={group.provider} role="group" aria-label={group.provider}>
                {groups.length > 1 ? <p aria-hidden className="px-2.5 pt-1.5 pb-0.5 text-micro font-semibold text-muted-foreground">{group.provider}</p> : null}
                {group.models.map((model) => {
                  const key = modelKey(model)
                  const active = key === selectedKey
                  const disabled = Boolean(selecting)
                  return (
                    <div
                      key={key}
                      role="option"
                      aria-selected={active}
                      aria-disabled={disabled || undefined}
                      tabIndex={active || (!selectedKey && model === ordered[0]) ? 0 : -1}
                      data-name={model.name || model.id}
                      title={`${model.provider} / ${model.id}`}
                      onClick={() => { if (!disabled) void choose(model) }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          if (!disabled) void choose(model)
                        }
                      }}
                      className={cn(
                        'relative flex min-h-[26px] cursor-default items-center gap-2 rounded-[8px] py-[3px] pr-2.5 pl-7 text-app leading-tight outline-none select-none',
                        'hover:bg-fill focus-visible:bg-primary focus-visible:text-primary-foreground focus-visible:[&_.text-muted-foreground]:text-primary-foreground/80',
                        disabled && 'opacity-40',
                      )}
                    >
                      {active ? <TbCheck className="absolute left-2 size-3.5 stroke-[2.6]" aria-hidden /> : null}
                      <span className="min-w-0 flex-1 truncate">{model.name || model.id}</span>
                      {selecting === key
                        ? <TbLoader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
                        : groups.length === 1 ? <span className="shrink-0 text-micro text-muted-foreground">{model.provider}</span> : null}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        )}

        {!unavailable && selected ? (
          <section aria-labelledby="model-reasoning-title" data-model-reasoning className="mt-[5px] shrink-0 border-t border-border px-2.5 pt-2.5 pb-1.5">
            <div className="mb-2 flex items-baseline gap-2">
              <span id="model-reasoning-title" className="min-w-0 flex-1 text-caption font-medium">{t('composer.reasoning')}</span>
              {adjustable ? <span className="text-caption font-semibold text-primary" data-model-reasoning-value>{t(`settings.models.thinking.${shownLevel!}`)}</span> : null}
            </div>
            {adjustable ? (
              <>
                <div className="flex items-start gap-2.5">
                  {/* Named steps already say which way is which. */}
                  {slider.labelEachStop ? null : <span aria-hidden className="shrink-0 pt-[3px] text-micro text-muted-foreground">{t('composer.reasoningFaster')}</span>}
                  <div className="min-w-0 flex-1">
                    <Slider
                      min={0}
                      max={thinkingLevels.length - 1}
                      step={1}
                      value={[shownIndex]}
                      ticks={thinkingLevels.length}
                      // Only a model switch blocks it; a level change in flight queues the next.
                      disabled={Boolean(selecting) && !selecting?.startsWith('thinking')}
                      thumbLabel={t('composer.reasoning')}
                      thumbValueText={shownLevel ? t(`settings.models.thinking.${shownLevel}`) : undefined}
                      onPointerDown={() => { pointerDown.current = true }}
                      onValueChange={([value]) => { if (value !== undefined) setDraft(value) }}
                      onValueCommit={([value]) => {
                        if (value === undefined) return
                        // Release applies at once; arrow keys wait for the steps to settle.
                        commit(value, pointerDown.current ? 0 : KEYBOARD_COMMIT_DELAY_MS)
                        pointerDown.current = false
                      }}
                    />
                    {slider.labelEachStop ? (
                      // Each mark's name sits under it, over the knob's travel.
                      <div aria-hidden className="relative mx-[10px] mt-0.5 h-4">
                        {thinkingLevels.map((level, index) => (
                          <span
                            key={level}
                            className={cn('absolute -translate-x-1/2 text-micro whitespace-nowrap', index === shownIndex ? 'font-medium text-foreground' : 'text-muted-foreground')}
                            style={{ left: `${(index / (thinkingLevels.length - 1)) * 100}%` }}
                          >
                            {t(`settings.models.thinking.${level}`)}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  {/* Named steps already say which way is which. */}
                  {slider.labelEachStop ? null : <span aria-hidden className="shrink-0 pt-[3px] text-micro text-muted-foreground">{t('composer.reasoningDeeper')}</span>}
                </div>
                {shownCostly ? <p className="mt-1.5 text-micro text-muted-foreground" data-model-reasoning-cost>{t('composer.reasoningCostly')}</p> : null}
              </>
            ) : (
              <p className="text-micro text-muted-foreground">{t('composer.reasoningUnsupported')}</p>
            )}
          </section>
        ) : null}

        {selecting ? (
          <p className="px-2.5 pt-1.5 pb-1 text-micro text-muted-foreground" role="status">
            {t('composer.actionPending')}
          </p>
        ) : null}
        {feedback.error || error ? (
          <div className="mx-1 mt-1 rounded-[8px] bg-destructive/10 px-2 py-1.5 text-caption text-destructive [&_.md-body]:text-caption [&_.md-body]:text-destructive" role="alert" data-model-action-error>
            <MarkdownContent markdown={feedback.error || error || ''} />
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
