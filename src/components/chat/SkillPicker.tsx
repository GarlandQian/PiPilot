import * as React from 'react'
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from '@/components/ui/popover'
import type { ComposerPickerRow } from '@/renderer/composer/composer-picker'
import { ComposerPicker } from './ComposerPicker'

export const COMPOSER_SLASH_LISTBOX_ID = 'composer-slash-listbox'

interface SkillPickerProps {
  activeId: string | null
  ariaLabel: string
  anchor: React.ReactNode
  listboxId?: string
  open: boolean
  rows: readonly ComposerPickerRow[]
  onActiveIdChange(id: string): void
  onActiveIdInteraction?(): void
  onEscapeKeyDown?: React.ComponentProps<typeof PopoverContent>['onEscapeKeyDown']
  onOpenChange(open: boolean): void
  onSelect(id: string): void
}

export function SkillPicker({
  activeId,
  ariaLabel,
  anchor,
  listboxId = COMPOSER_SLASH_LISTBOX_ID,
  open,
  rows,
  onActiveIdChange,
  onActiveIdInteraction,
  onEscapeKeyDown,
  onOpenChange,
  onSelect,
}: SkillPickerProps) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>{anchor}</PopoverAnchor>
      <PopoverContent
        data-composer-picker-surface
        side="top"
        align="start"
        sideOffset={4}
        collisionPadding={12}
        className="w-[var(--radix-popover-trigger-width)] min-w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-24px)] border-0 bg-transparent p-0 shadow-none"
        onEscapeKeyDown={onEscapeKeyDown}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <ComposerPicker
          activeId={activeId}
          ariaLabel={ariaLabel}
          listboxId={listboxId}
          rows={rows}
          onActiveIdChange={onActiveIdChange}
          onActiveIdInteraction={onActiveIdInteraction}
          onSelect={onSelect}
        />
      </PopoverContent>
    </Popover>
  )
}
