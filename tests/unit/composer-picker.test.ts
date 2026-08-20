import { describe, expect, it } from 'vitest'
import {
  composerPickerOptionId,
  composerPickerSelectableIds,
  createComposerPickerRows,
  transitionComposerPickerActiveId,
  type ComposerPickerSection,
} from '../../src/renderer/composer/composer-picker'

function sections(): ComposerPickerSection[] {
  return [
    {
      id: 'commands',
      label: 'Commands',
      rows: [
        { kind: 'status', id: 'loading', label: 'Loading' },
        {
          kind: 'option',
          id: 'command:disabled',
          group: 'commands',
          icon: 'command',
          label: '/disabled',
          disabled: true,
        },
        {
          kind: 'option',
          id: 'command:review',
          group: 'commands',
          icon: 'command',
          label: '/review',
          disabled: false,
        },
      ],
    },
    {
      id: 'skills',
      label: 'Skills',
      rows: [{
        kind: 'option',
        id: 'skill:audit',
        group: 'skills',
        icon: 'skill',
        label: '/skill:audit',
        disabled: false,
      }],
    },
  ]
}

describe('composer picker navigation', () => {
  it('projects headings and skips statuses and disabled options', () => {
    const rows = createComposerPickerRows(sections())

    expect(rows.map((row) => row.id)).toEqual([
      'heading:commands',
      'loading',
      'command:disabled',
      'command:review',
      'heading:skills',
      'skill:audit',
    ])
    expect(composerPickerSelectableIds(rows)).toEqual([
      'command:review',
      'skill:audit',
    ])
  })

  it('reconciles stale IDs and wraps across group boundaries', () => {
    const rows = createComposerPickerRows(sections())

    expect(transitionComposerPickerActiveId(rows, null, 'reconcile'))
      .toBe('command:review')
    expect(transitionComposerPickerActiveId(rows, 'removed', 'reconcile'))
      .toBe('command:review')
    expect(transitionComposerPickerActiveId(rows, 'skill:audit', 'reconcile'))
      .toBe('skill:audit')
    expect(transitionComposerPickerActiveId(rows, 'command:review', 'next'))
      .toBe('skill:audit')
    expect(transitionComposerPickerActiveId(rows, 'skill:audit', 'next'))
      .toBe('command:review')
    expect(transitionComposerPickerActiveId(rows, 'command:review', 'previous'))
      .toBe('skill:audit')
    expect(transitionComposerPickerActiveId(rows, null, 'previous'))
      .toBe('skill:audit')
    expect(transitionComposerPickerActiveId(rows, 'skill:audit', 'first'))
      .toBe('command:review')
    expect(transitionComposerPickerActiveId(rows, 'command:review', 'last'))
      .toBe('skill:audit')
  })

  it('clears selection for an empty or status-only menu and creates stable DOM IDs', () => {
    const rows = createComposerPickerRows([{
      id: 'files',
      label: 'Files',
      rows: [{ kind: 'status', id: 'empty', label: 'No files' }],
    }])

    expect(transitionComposerPickerActiveId(rows, 'old', 'reconcile')).toBeNull()
    expect(composerPickerOptionId('composer-listbox', 'skill:release/notes'))
      .toBe('composer-listbox-option-skill%3Arelease%2Fnotes')
  })
})
