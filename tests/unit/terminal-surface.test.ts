import { describe, expect, it } from 'vitest'
import type { IBuffer } from '@xterm/xterm'
import { TERMINAL_INPUT_LIMIT } from '../../src/shared/terminal'
import {
  findTerminalMatches,
  splitTerminalInput,
  terminalBufferText,
  terminalShortcut,
} from '../../src/components/inspector/terminal-surface'

function buffer(rows: { cells: (string | [string, number])[]; wrapped?: boolean }[], columns = 8) {
  const lines = rows.map((row) => {
    const cells = row.cells.flatMap((value) => {
      const [chars, width] = typeof value === 'string' ? [value, 1] : value
      return width === 2 ? [{ chars, width }, { chars: '', width: 0 }] : [{ chars, width }]
    })
    while (cells.length < columns) cells.push({ chars: '', width: 1 })
    return {
      isWrapped: row.wrapped ?? false,
      length: cells.length,
      getCell: (column: number) => {
        const cell = cells[column]
        return cell ? { getChars: () => cell.chars, getWidth: () => cell.width } : undefined
      },
      translateToString: (trim: boolean, from = 0, to = columns) => {
        const text = cells.slice(from, to).map((cell) => cell.width === 0 ? '' : cell.chars || ' ').join('')
        return trim ? text.trimEnd() : text
      },
    }
  })
  return { length: lines.length, getLine: (row: number) => lines[row], getNullCell: () => ({}) } as unknown as IBuffer
}

describe('terminal rendered buffer actions', () => {
  it('finds literal, case-insensitive text across soft wraps without matching across real newlines', () => {
    const lines = buffer([
      { cells: [...'npm test'] },
      { cells: [...' PASS.* '], wrapped: true },
      { cells: [...'separate'] },
    ])
    expect(findTerminalMatches(lines, 8, 'test PASS.*')).toEqual([{ row: 0, column: 4, length: 11 }])
    expect(findTerminalMatches(lines, 8, 'pass.*')).toEqual([{ row: 1, column: 1, length: 6 }])
    expect(findTerminalMatches(lines, 8, '.* separate')).toEqual([])
    expect(terminalBufferText(lines, 8)).toBe('npm test PASS.*\nseparate')
  })

  it('selects terminal cells rather than UTF-16 units for wide and combining characters', () => {
    const lines = buffer([{ cells: ['>', ['中', 2], ['😀', 2], 'e\u0301', 'x'] }])
    expect(findTerminalMatches(lines, 8, '中😀e\u0301')).toEqual([{ row: 0, column: 1, length: 5 }])
    expect(findTerminalMatches(lines, 8, 'x')).toEqual([{ row: 0, column: 6, length: 1 }])
    expect(terminalBufferText(lines, 8)).toBe('>中😀e\u0301x')
  })

  it('returns every occurrence while ignoring blank scrollback padding', () => {
    const lines = buffer([{ cells: [...'foo FOO '] }, { cells: [] }])
    expect(findTerminalMatches(lines, 8, 'foo')).toEqual([
      { row: 0, column: 0, length: 3 }, { row: 0, column: 4, length: 3 },
    ])
    expect(findTerminalMatches(lines, 8, '')).toEqual([])
    expect(terminalBufferText(lines, 8)).toBe('foo FOO')
  })
})

describe('terminal native input', () => {
  it('chunks large pastes without separating an emoji surrogate pair', () => {
    const input = `${'x'.repeat(TERMINAL_INPUT_LIMIT - 1)}😀\n${'y'.repeat(TERMINAL_INPUT_LIMIT)}`
    const chunks = splitTerminalInput(input)
    expect(chunks.join('')).toBe(input)
    expect(chunks.every((chunk) => chunk.length <= TERMINAL_INPUT_LIMIT)).toBe(true)
    expect(chunks[0]).toHaveLength(TERMINAL_INPUT_LIMIT - 1)
    expect(chunks[1].startsWith('😀')).toBe(true)
    expect(splitTerminalInput('')).toEqual([])
  })

  const key = (overrides: Partial<KeyboardEvent>) => ({
    key: '', ctrlKey: false, metaKey: false, altKey: false,
    shiftKey: false, isComposing: false, keyCode: 0, ...overrides,
  })

  it('preserves interrupt and IME while handling standard terminal clipboard shortcuts', () => {
    expect(terminalShortcut(key({ key: 'c', ctrlKey: true }))).toBeUndefined()
    expect(terminalShortcut(key({ key: 'C', ctrlKey: true, shiftKey: true }))).toBe('copy')
    expect(terminalShortcut(key({ key: 'c', metaKey: true }))).toBe('copy')
    expect(terminalShortcut(key({ key: 'V', ctrlKey: true, shiftKey: true }))).toBe('paste')
    expect(terminalShortcut(key({ key: 'v', metaKey: true }))).toBe('paste')
    expect(terminalShortcut(key({ key: 'Insert', shiftKey: true }))).toBe('paste')
    expect(terminalShortcut(key({ key: 'f', ctrlKey: true }))).toBe('find')
    expect(terminalShortcut(key({ key: 'f', metaKey: true, isComposing: true }))).toBeUndefined()
    expect(terminalShortcut(key({ key: 'f', metaKey: true, keyCode: 229 }))).toBeUndefined()
  })
})
