import * as React from 'react'
import { TbCheck, TbChevronDown } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
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

export interface PiModelOption {
  id: string
  name: string
  provider: string
}

interface ModelPickerProps {
  models: readonly PiModelOption[]
  selected: PiModelOption | null
  connected: boolean
  loading: boolean
  error?: string | null
  onSelect(provider: string, modelId: string): void | Promise<void>
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
  models,
  selected,
  connected,
  loading,
  error,
  onSelect,
}: ModelPickerProps) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const [selecting, setSelecting] = React.useState<string | null>(null)
  const groups = React.useMemo(() => groupModels(models), [models])
  const label = selected?.name || selected?.id || t('composer.noModel')

  const choose = React.useCallback(async (model: PiModelOption) => {
    const key = `${model.provider}\0${model.id}`
    if (selecting) return
    setSelecting(key)
    try {
      await onSelect(model.provider, model.id)
      setOpen(false)
    } catch {
      // The shared Pi runtime error remains visible in this popover.
    } finally {
      setSelecting(null)
    }
  }, [onSelect, selecting])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="min-w-0 max-w-44 shrink gap-1 px-2 font-mono text-caption"
          aria-label={t('composer.modelSwitcher', { model: label })}
        >
          <span className="truncate">{label}</span>
          <TbChevronDown className="size-3 shrink-0 opacity-60" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        collisionPadding={12}
        className="w-[min(360px,calc(100vw-24px))] max-h-[min(440px,calc(100vh-96px))] overflow-hidden p-0"
      >
        <Command className="max-h-[min(440px,calc(100vh-96px))]">
          <CommandInput placeholder={t('composer.modelSearch')} />
          <CommandList className="max-h-[min(352px,calc(100vh-184px))]">
            <CommandEmpty>
              {!connected
                ? t('composer.modelDisconnected')
                : loading
                  ? t('settings.models.loading')
                  : t('composer.modelEmpty')}
            </CommandEmpty>
            {groups.map((group) => (
              <CommandGroup key={group.provider} heading={group.provider}>
                {group.models.map((model) => {
                  const key = `${model.provider}\0${model.id}`
                  const active = selected?.provider === model.provider &&
                    selected.id === model.id
                  return (
                    <CommandItem
                      key={key}
                      value={`${model.name} ${model.id} ${model.provider}`}
                      disabled={Boolean(selecting)}
                      onSelect={() => void choose(model)}
                      className="min-w-0 items-start py-2"
                    >
                      <TbCheck
                        className={cn(
                          'mt-0.5 size-4 shrink-0',
                          active ? 'opacity-100' : 'opacity-0',
                        )}
                        aria-hidden
                      />
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
          {error && (
            <p className="border-t border-border px-3 py-2 text-caption text-destructive" role="alert">
              {error}
            </p>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  )
}
