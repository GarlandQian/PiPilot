export type ComposerPickerGroup = 'commands' | 'files' | 'skills'

export type ComposerPickerIcon = 'command' | 'directory' | 'file' | 'skill'

export type ComposerPickerRow =
  | {
      kind: 'heading'
      id: string
      label: string
    }
  | {
      kind: 'status'
      id: string
      label: string
      tone?: 'danger' | 'muted'
    }
  | {
      kind: 'option'
      id: string
      group: ComposerPickerGroup
      icon: ComposerPickerIcon
      label: string
      description?: string
      descriptionTone?: 'danger' | 'muted'
      meta?: string
      title?: string
      disabled: boolean
    }

export interface ComposerPickerSection {
  id: string
  label: string
  rows: readonly Exclude<ComposerPickerRow, { kind: 'heading' }>[]
}

export type ComposerPickerTransition = 'first' | 'last' | 'next' | 'previous' | 'reconcile'

export function createComposerPickerRows(
  sections: readonly ComposerPickerSection[],
): ComposerPickerRow[] {
  const rows: ComposerPickerRow[] = []
  for (const section of sections) {
    if (section.rows.length === 0) continue
    rows.push({ kind: 'heading', id: `heading:${section.id}`, label: section.label })
    rows.push(...section.rows)
  }
  return rows
}

export function composerPickerSelectableIds(
  rows: readonly ComposerPickerRow[],
): string[] {
  return rows.flatMap((row) => row.kind === 'option' && !row.disabled ? [row.id] : [])
}

export function transitionComposerPickerActiveId(
  rows: readonly ComposerPickerRow[],
  activeId: string | null,
  transition: ComposerPickerTransition,
): string | null {
  const selectableIds = composerPickerSelectableIds(rows)
  if (selectableIds.length === 0) return null

  const currentIndex = activeId === null ? -1 : selectableIds.indexOf(activeId)
  if (transition === 'reconcile') {
    return currentIndex >= 0 ? selectableIds[currentIndex] : selectableIds[0]
  }
  if (transition === 'first') return selectableIds[0]
  if (transition === 'last') return selectableIds[selectableIds.length - 1]
  if (currentIndex < 0) {
    return transition === 'next'
      ? selectableIds[0]
      : selectableIds[selectableIds.length - 1]
  }

  const direction = transition === 'next' ? 1 : -1
  const nextIndex = (currentIndex + direction + selectableIds.length) % selectableIds.length
  return selectableIds[nextIndex]
}

export function composerPickerOptionId(listboxId: string, optionId: string) {
  return `${listboxId}-option-${encodeURIComponent(optionId)}`
}
