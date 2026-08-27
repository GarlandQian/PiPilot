import * as React from 'react'
import { TbCommand, TbFile, TbFolder, TbSparkles } from 'react-icons/tb'
import {
  Command,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { cn } from '@/lib/utils'
import {
  composerPickerOptionId,
  composerPickerSelectableIds,
  type ComposerPickerIcon,
  type ComposerPickerRow,
} from '@/renderer/composer/composer-picker'

const PICKER_ICON = {
  command: TbCommand,
  directory: TbFolder,
  file: TbFile,
  skill: TbSparkles,
} satisfies Record<ComposerPickerIcon, React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>>

interface ComposerPickerProps {
  activeId: string | null
  ariaLabel: string
  className?: string
  listboxId: string
  rows: readonly ComposerPickerRow[]
  onActiveIdChange(id: string): void
  onActiveIdInteraction?(): void
  onSelect(id: string): void
}

export function ComposerPicker({
  activeId,
  ariaLabel,
  className,
  listboxId,
  rows,
  onActiveIdChange,
  onActiveIdInteraction,
  onSelect,
}: ComposerPickerProps) {
  const selectableIds = React.useMemo(() => composerPickerSelectableIds(rows), [rows])
  const selectableSet = React.useMemo(() => new Set(selectableIds), [selectableIds])

  React.useEffect(() => {
    if (!activeId || !selectableSet.has(activeId)) return
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(composerPickerOptionId(listboxId, activeId))
        ?.scrollIntoView({ block: 'nearest' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [activeId, listboxId, selectableSet])

  return (
    <Command
      shouldFilter={false}
      value={activeId ?? ''}
      onValueChange={(id) => {
        if (selectableSet.has(id)) onActiveIdChange(id)
      }}
      aria-label={ariaLabel}
      className={cn(
        'z-50 w-full min-w-0 max-w-[calc(100vw-24px)] overflow-hidden rounded-lg border border-input bg-popover text-popover-foreground shadow-sm',
        className,
      )}
    >
      <CommandList
        ref={(element) => {
          if (element) element.id = listboxId
        }}
        id={listboxId}
        className="scroll-slim max-h-72 p-1"
      >
        {rows.map((row) => {
          if (row.kind === 'heading') {
            return (
              <div
                key={row.id}
                role="presentation"
                className="flex h-6 items-end px-2 pb-1 text-micro font-medium text-muted-foreground"
              >
                {row.label}
              </div>
            )
          }
          if (row.kind === 'status') {
            return (
              <p
                key={row.id}
                role={row.tone === 'danger' ? 'alert' : 'status'}
                className={cn(
                  'flex min-h-10 items-center justify-center px-2 py-2 text-center text-caption',
                  row.tone === 'danger' ? 'text-destructive' : 'text-muted-foreground',
                )}
              >
                {row.label}
              </p>
            )
          }

          const Icon = PICKER_ICON[row.icon]
          return (
            <CommandItem
              key={row.id}
              ref={(element) => {
                if (element) element.id = composerPickerOptionId(listboxId, row.id)
              }}
              id={composerPickerOptionId(listboxId, row.id)}
              value={row.id}
              disabled={row.disabled}
              data-composer-picker-group={row.group}
              className="min-h-10 items-center rounded-md py-1.5"
              title={row.title}
              onMouseDown={(event) => event.preventDefault()}
              onMouseMove={() => {
                if (!row.disabled && activeId !== row.id) {
                  onActiveIdInteraction?.()
                  onActiveIdChange(row.id)
                }
              }}
              onSelect={() => {
                if (!row.disabled) onSelect(row.id)
              }}
            >
              <span className="flex w-4 shrink-0 justify-center">
                <Icon className="size-4 text-muted-foreground" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center justify-between gap-3">
                  <span className="truncate font-mono text-caption text-foreground">
                    {row.label}
                  </span>
                  {row.meta ? (
                    <span className="max-w-28 shrink-0 truncate text-micro text-muted-foreground">
                      {row.meta}
                    </span>
                  ) : null}
                </span>
                {row.description ? (
                  <span className={cn(
                    'mt-0.5 block truncate text-caption',
                    row.descriptionTone === 'danger'
                      ? 'text-destructive'
                      : 'text-muted-foreground',
                  )}>
                    {row.description}
                  </span>
                ) : null}
              </span>
            </CommandItem>
          )
        })}
      </CommandList>
    </Command>
  )
}
