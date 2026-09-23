import type { IBuffer } from '@xterm/xterm'
import { TERMINAL_INPUT_LIMIT } from '@/shared/terminal'

export interface TerminalSearchMatch {
  column: number
  row: number
  length: number
}

type SearchBuffer = Pick<IBuffer, 'length' | 'getLine' | 'getNullCell'>

/** Keep each transport message bounded without splitting a surrogate pair. */
export function splitTerminalInput(value: string): string[] {
  const chunks: string[] = []
  for (let start = 0; start < value.length;) {
    let end = Math.min(start + TERMINAL_INPUT_LIMIT, value.length)
    const last = value.charCodeAt(end - 1)
    if (end < value.length && last >= 0xd800 && last <= 0xdbff) end -= 1
    chunks.push(value.slice(start, end))
    start = end
  }
  return chunks
}

/** Join visual wraps, retaining real terminal line breaks and rendered text. */
export function terminalBufferText(buffer: SearchBuffer, columns: number): string {
  let output = ''
  for (let row = 0; row < buffer.length; row += 1) {
    const line = buffer.getLine(row)
    if (!line) continue
    const wrapped = buffer.getLine(row + 1)?.isWrapped ?? false
    output += line.translateToString(!wrapped, 0, columns)
    if (!wrapped) output += '\n'
  }
  return output.trimEnd()
}

/** Map string matches to cells so CJK, emoji and soft wraps select correctly. */
export function findTerminalMatches(
  buffer: SearchBuffer,
  columns: number,
  query: string,
): TerminalSearchMatch[] {
  if (!query || columns < 1) return []
  const matcher = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'giu')
  const matches: TerminalSearchMatch[] = []
  const cell = buffer.getNullCell()
  let text = ''
  let positions: { row: number; column: number; width: number }[] = []

  for (let row = 0; row < buffer.length; row += 1) {
    const line = buffer.getLine(row)
    if (!line) continue
    const wrapped = buffer.getLine(row + 1)?.isWrapped ?? false
    for (let column = 0; column < Math.min(line.length, columns); column += 1) {
      const current = line.getCell(column, cell)
      if (!current || current.getWidth() === 0) continue
      const chars = current.getChars() || ' '
      const position = { row, column, width: current.getWidth() }
      text += chars
      for (let index = 0; index < chars.length; index += 1) positions.push(position)
    }
    if (wrapped) continue
    matcher.lastIndex = 0
    for (const match of text.trimEnd().matchAll(matcher)) {
      const first = positions[match.index]
      const last = positions[match.index + match[0].length - 1]
      if (!first || !last) continue
      matches.push({
        row: first.row,
        column: first.column,
        length: (last.row - first.row) * columns + last.column + last.width - first.column,
      })
    }
    text = ''
    positions = []
  }
  return matches
}

export function terminalShortcut(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'isComposing' | 'keyCode'>,
): 'find' | 'copy' | 'paste' | undefined {
  if (event.isComposing || event.keyCode === 229 || event.altKey) return undefined
  const key = event.key.toLowerCase()
  if ((event.metaKey || event.ctrlKey) && key === 'f') return 'find'
  const clipboardModifier = event.metaKey || (event.ctrlKey && event.shiftKey)
  if (clipboardModifier && key === 'c') return 'copy'
  if ((clipboardModifier && key === 'v') || (event.shiftKey && !event.ctrlKey && !event.metaKey && key === 'insert')) return 'paste'
  // Ctrl+C is deliberately left to the PTY, even when text is selected.
  return undefined
}
