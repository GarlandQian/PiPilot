import * as React from 'react'
import { TbBrain, TbCheck, TbChevronDown, TbLoader2 } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { MarkdownContent } from './markdown/MarkdownContent'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import { projectModelThinkingTrigger } from '@/renderer/composer/composer-controls'
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
  const trigger = projectModelThinkingTrigger(
    selected,
    selectedThinkingLevel,
    thinkingLevels,
  )
  const label = trigger.modelLabel ?? t('composer.noModel')
  const thinkingLabel = trigger.thinkingLevel
    ? t(`settings.models.thinking.${trigger.thinkingLevel}`)
    : null

  const choose = React.useCallback(async (model: PiModelOption) => {
    const key = `${model.provider}\0${model.id}`
    if (!connected || loading || selecting) return
    await feedback.run(key, async (isCurrent) => {
      await onSelect(model.provider, model.id)
      if (isCurrent()) setOpen(false)
    }, t('composer.modelActionFailed'))
  }, [connected, feedback.run, loading, onSelect, selecting, t])

  const chooseThinking = React.useCallback(async (level: LocalPiThinkingLevel) => {
    if (!connected || loading || selecting || level === selectedThinkingLevel) return
    await feedback.run(`thinking\0${level}`, async (isCurrent) => {
      await onThinkingSelect(level)
      if (isCurrent()) setOpen(false)
    }, t('composer.modelActionFailed'))
  }, [connected, feedback.run, loading, onThinkingSelect, selectedThinkingLevel, selecting, t])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="min-w-0 max-w-72 shrink gap-1.5 px-2 text-caption"
          data-model-thinking-trigger
          aria-label={thinkingLabel
            ? t('composer.modelThinkingSwitcher', {
                model: label,
                thinking: thinkingLabel,
              })
            : t('composer.modelSwitcher', { model: label })}
        >
          <span className="truncate">{label}</span>
          {thinkingLabel ? (
            <>
              <span className="shrink-0 text-muted-foreground" aria-hidden>·</span>
              <span className="min-w-0 truncate text-muted-foreground">{thinkingLabel}</span>
            </>
          ) : null}
          {selecting
            ? <TbLoader2 className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
            : <TbChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        collisionPadding={12}
        className="w-[min(360px,calc(100vw-24px))] max-h-[min(440px,calc(100vh-96px))] overflow-hidden p-0"
      >
        <Command className="max-h-[min(440px,calc(100vh-96px))]" loop aria-busy={Boolean(selecting)}>
          <CommandInput placeholder={t('composer.modelSearch')} aria-label={t('composer.modelSearch')} />
          <CommandList className="max-h-[min(352px,calc(100vh-184px))]">
            <CommandEmpty>{t('composer.modelThinkingEmpty')}</CommandEmpty>
            {selectedThinkingLevel && thinkingLevels.length > 1 ? (
              <CommandGroup
                heading={t('settings.models.thinkingTitle')}
                className="border-b border-border [&_[cmdk-group-items]]:flex [&_[cmdk-group-items]]:flex-wrap [&_[cmdk-group-items]]:gap-1"
              >
                {thinkingLevels.map((level) => {
                  const active = level === selectedThinkingLevel
                  const pending = selecting === `thinking\0${level}`
                  return (
                    <CommandItem
                      key={level}
                      value={`thinking reasoning ${t(`settings.models.thinking.${level}`)} ${level}`}
                      disabled={!connected || loading || Boolean(selecting)}
                      onSelect={() => void chooseThinking(level)}
                      className="min-h-8 gap-1.5 px-2"
                    >
                      <TbBrain className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="min-w-0 flex-1 truncate text-caption">
                        {t(`settings.models.thinking.${level}`)}
                      </span>
                      {pending
                        ? <TbLoader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
                        : <TbCheck className={cn('size-3.5 shrink-0', active ? 'opacity-100' : 'opacity-0')} aria-hidden />}
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            ) : null}
            {!connected || loading || groups.length === 0 ? (
              <CommandGroup heading={t('composer.models')}>
                <p className="px-2 py-3 text-caption text-muted-foreground">
                  {!connected
                    ? t('composer.modelDisconnected')
                    : loading
                      ? t('settings.models.loading')
                      : t('composer.modelEmpty')}
                </p>
              </CommandGroup>
            ) : groups.map((group) => (
                <CommandGroup key={group.provider} heading={group.provider}>
                  {group.models.map((model) => {
                    const key = `${model.provider}\0${model.id}`
                    const active = selected?.provider === model.provider &&
                      selected.id === model.id
                    return (
                      <CommandItem
                        key={key}
                        value={`${model.name} ${model.id} ${model.provider}`}
                        disabled={!connected || loading || Boolean(selecting)}
                        onSelect={() => void choose(model)}
                        className="min-w-0 items-start py-2"
                      >
                        {selecting === key ? (
                          <TbLoader2 className="mt-0.5 size-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
                        ) : (
                          <TbCheck className={cn('mt-0.5 size-4 shrink-0', active ? 'opacity-100' : 'opacity-0')} aria-hidden />
                        )}
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-caption font-medium">
                                {model.name || model.id}
                              </span>
                              <span className="block truncate font-mono text-micro text-muted-foreground">
                                {model.provider} / {model.id}
                              </span>
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="left" className="max-w-80 break-all">
                            {model.provider} / {model.id}
                          </TooltipContent>
                        </Tooltip>
                      </CommandItem>
                    )
                  })}
                </CommandGroup>
              ))}
          </CommandList>
          {selecting ? (
            <p className="border-t border-border px-3 py-2 text-caption text-muted-foreground" role="status">
              {t('composer.actionPending')}
            </p>
          ) : null}
          {(feedback.error || error) && (
            <div className="border-t border-border px-3 py-2 text-caption text-destructive [&_.md-body]:text-caption [&_.md-body]:text-destructive" role="alert" data-model-action-error>
              <MarkdownContent markdown={feedback.error || error || ''} />
            </div>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  )
}
