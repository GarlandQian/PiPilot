const MAX_LOG_BYTES = 96 * 1_024
export const MAX_LOG_MATCHES = 1_000
const MAX_STYLE_SPANS = 1_024

export type ShellLogColor = 'black' | 'red' | 'green' | 'yellow' | 'blue' | 'magenta' | 'cyan' | 'white'
export interface ShellLogStyle { color?: ShellLogColor; bold?: boolean; dim?: boolean; italic?: boolean; underline?: boolean }
export interface ShellLogStyleSpan { start: number; end: number; style: ShellLogStyle }
const colors: readonly ShellLogColor[] = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white']

function sgrStyle(parameters: string, previous: ShellLogStyle): ShellLogStyle {
  let style = { ...previous }
  const values = parameters === '' ? [0] : parameters.split(';').map(Number)
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (value === 0) style = {}
    else if (value === 1) style.bold = true
    else if (value === 2) style.dim = true
    else if (value === 3) style.italic = true
    else if (value === 4) style.underline = true
    else if (value === 22) { delete style.bold; delete style.dim }
    else if (value === 23) delete style.italic
    else if (value === 24) delete style.underline
    else if (value === 39) delete style.color
    else if (value !== undefined && value >= 30 && value <= 37) style.color = colors[value - 30]
    else if (value !== undefined && value >= 90 && value <= 97) style.color = colors[value - 90]
    // Extended and background colors are ignored as one whole instruction;
    // their channel values must never be mistaken for separate SGR commands.
    else if (value === 38 || value === 48 || value === 58) index += values[index + 1] === 2 ? 4 : values[index + 1] === 5 ? 2 : 0
  }
  return style
}

/** A fixed SGR text palette is safe; cursor, title, hyperlink and other controls are discarded. */
export function projectShellLog(source: string) {
  const normalized = source
    .replace(/\u001b\][\s\S]*?(?:\u0007|\u001b\\)/gu, '')
    .replace(/\r\n?/gu, '\n')
  const pieces: string[] = []
  let styles: ShellLogStyleSpan[] = []
  let style: ShellLogStyle = {}
  let textLength = 0
  let previous = 0
  let tooManyStyles = false
  const append = (value: string) => {
    const text = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '')
    if (!text) return
    pieces.push(text)
    if (Object.keys(style).length && !tooManyStyles) {
      if (styles.length === MAX_STYLE_SPANS) { styles = []; tooManyStyles = true }
      else styles.push({ start: textLength, end: textLength + text.length, style })
    }
    textLength += text.length
  }
  for (const match of normalized.matchAll(/(?:\u001b\[|\u009b)([0-?]*)([ -/]*)([@-~])/gu)) {
    append(normalized.slice(previous, match.index))
    if (match[3] === 'm' && !match[2] && /^[\d;]*$/u.test(match[1]!)) style = sgrStyle(match[1]!, style)
    previous = match.index + match[0].length
  }
  append(normalized.slice(previous))
  const text = pieces.join('')
  const bytes = new TextEncoder().encode(text)
  if (bytes.length <= MAX_LOG_BYTES) return { text, truncated: false, styles }
  let start = bytes.length - MAX_LOG_BYTES
  // A UTF-8 tail must begin at a character boundary.
  while (start < bytes.length && (bytes[start]! & 0xc0) === 0x80) start += 1
  const tail = new TextDecoder().decode(bytes.subarray(start))
  const removed = text.length - tail.length
  return { text: tail, truncated: true, styles: styles.filter((span) => span.end > removed).map((span) => ({
    start: Math.max(0, span.start - removed), end: span.end - removed, style: span.style,
  })) }
}

export interface LogMatch { start: number; end: number }

/** Literal search cannot execute user-supplied expressions or grow without a bound. */
export function findShellLogMatches(text: string, query: string): LogMatch[] {
  if (!query) return []
  const matches: LogMatch[] = []
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'giu')
  while (matches.length < MAX_LOG_MATCHES) {
    const match = pattern.exec(text)
    if (!match) break
    matches.push({ start: match.index, end: match.index + match[0].length })
  }
  return matches
}
