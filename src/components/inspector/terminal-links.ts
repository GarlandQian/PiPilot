import type { IBuffer, IBufferRange, ILink, ILinkProvider, Terminal } from '@xterm/xterm'
import { isSafeExternalUrl, MAX_EXTERNAL_URL_LENGTH } from '@/shared/external-url'

export interface TerminalLinkTarget {
  /** The printed address, retained for copying even when it is a listen address. */
  text: string
  /** A validated browser target, with wildcard listen hosts changed to localhost. */
  url: string
}

export interface TerminalTextLink extends TerminalLinkTarget {
  /** UTF-16 offsets into the original text; end is exclusive. */
  start: number
  end: number
}

const localAuthority = /^(localhost|\d{1,3}(?:\.\d{1,3}){3}|\[[\da-f:.]+\]):(\d{1,5})(?=$|[/?#])/iu
const webAddress = /https?:\/\/[^\s<>"'`\\\u3002\uff0c\uff1b\uff01\uff1f]+/giu
const localAddress = /(?:localhost|\d{1,3}(?:\.\d{1,3}){3}|\[[\da-f:.]+\]):\d{1,5}(?:[/?#][^\s<>"'`\\\u3002\uff0c\uff1b\uff01\uff1f]*)?/giu
const precedingAddressCharacter = /[a-z\d_@./:\\-]/iu

/** Accept web URLs and explicitly local/IP host:port addresses, never arbitrary URI schemes. */
export function normalizeTerminalLink(value: string): TerminalLinkTarget | undefined {
  if (!value || value.length > MAX_EXTERNAL_URL_LENGTH || /[\s\u0000-\u001f\u007f]/u.test(value)) return undefined
  let candidate = value
  if (!/^https?:\/\//iu.test(value)) {
    const authority = localAuthority.exec(value)
    if (!authority) return undefined
    const [, host, port] = authority
    if (Number(port) < 1 || Number(port) > 65_535) return undefined
    if (/^\d/u.test(host) && host.split('.').some((part) => Number(part) > 255 || (part.length > 1 && part.startsWith('0')))) return undefined
    candidate = `http://${value}`
  }
  if (!isSafeExternalUrl(candidate)) return undefined
  const parsed = new URL(candidate)
  if (parsed.hostname === '0.0.0.0' || parsed.hostname === '[::]') parsed.hostname = 'localhost'
  const url = parsed.href
  return isSafeExternalUrl(url) ? { text: value, url } : undefined
}

export function isTerminalLinkModifier(
  event: Pick<MouseEvent, 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>,
  platform: string,
): boolean {
  if (event.altKey || event.shiftKey) return false
  return /mac|darwin/iu.test(platform) ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
}

function trimPrintedPunctuation(value: string): string {
  let result = value.replace(/[.,;!\u3002\uff0c\uff1b\uff01\uff1f]+$/u, '')
  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' }
  while (result) {
    const closing = result[result.length - 1]
    const opening = pairs[closing]
    if (!opening) break
    const opens = result.split(opening).length - 1
    const closes = result.split(closing).length - 1
    if (closes <= opens) break
    result = result.slice(0, -1).replace(/[.,;!\u3002\uff0c\uff1b\uff01\uff1f]+$/u, '')
  }
  return result
}

function hasStartBoundary(text: string, start: number): boolean {
  return start === 0 || !precedingAddressCharacter.test(text[start - 1])
}

/** Shared by terminal links and plain-text command output; does not scan across real newlines. */
export function findTerminalLinks(text: string): TerminalTextLink[] {
  const links: TerminalTextLink[] = []
  // Reserve even invalid HTTP spans so a credential-bearing URL cannot become a bare local link.
  const webSpans: { start: number; end: number }[] = []
  for (const match of text.matchAll(webAddress)) {
    const start = match.index
    webSpans.push({ start, end: start + match[0].length })
    if (!hasStartBoundary(text, start)) continue
    const value = trimPrintedPunctuation(match[0])
    const target = normalizeTerminalLink(value)
    if (target) links.push({ ...target, start, end: start + value.length })
  }
  for (const match of text.matchAll(localAddress)) {
    const start = match.index
    if (!hasStartBoundary(text, start) || webSpans.some((span) => start >= span.start && start < span.end)) continue
    const value = trimPrintedPunctuation(match[0])
    const end = start + value.length
    // A partial match in a larger hostname/port/token is not an address.
    if (end === start + match[0].length && (
      /[\p{L}\p{N}_:@-]/u.test(text[end] ?? '') ||
      (text[end] === '.' && /[\p{L}\p{N}_-]/u.test(text[end + 1] ?? ''))
    )) continue
    const target = normalizeTerminalLink(value)
    if (target) links.push({ ...target, start, end })
  }
  return links.sort((left, right) => left.start - right.start)
}

export function findLocalTerminalLinks(text: string): TerminalTextLink[] {
  return findTerminalLinks(text).filter((link) => !/^https?:\/\//iu.test(link.text))
}

export interface TerminalLinkHandlers {
  activate(event: MouseEvent, text: string, range: IBufferRange): void
  hover?(event: MouseEvent, text: string, range: IBufferRange): void
  leave?(event: MouseEvent, text: string, range: IBufferRange): void
}

type LinkBuffer = Pick<IBuffer, 'length' | 'getLine' | 'getNullCell'>
type CellPosition = { x: number; y: number; width: number }

function wrappedLine(buffer: LinkBuffer, columns: number, row: number) {
  // Only adjacent text can belong to a valid URL. Bound work even for thousands of wrapped rows.
  const lookaround = Math.ceil(MAX_EXTERNAL_URL_LENGTH * 2 / columns) + 1
  let first = row
  while (first > Math.max(0, row - lookaround) && buffer.getLine(first)?.isWrapped) first -= 1
  let last = row
  while (last + 1 < Math.min(buffer.length, row + lookaround + 1) && buffer.getLine(last + 1)?.isWrapped) last += 1
  let text = ''
  const positions: CellPosition[] = []
  const reusableCell = buffer.getNullCell()
  for (let lineIndex = first; lineIndex <= last; lineIndex += 1) {
    const line = buffer.getLine(lineIndex)
    if (!line) break
    const nextLine = buffer.getLine(lineIndex + 1)
    const continuesWithWideCell = nextLine?.isWrapped && nextLine.getCell(0)?.getWidth() === 2
    for (let column = 0; column < Math.min(columns, line.length); column += 1) {
      const cell = line.getCell(column, reusableCell)
      if (!cell || cell.getWidth() === 0) continue
      const content = cell.getChars()
      // xterm leaves a null final cell when a wide character must wrap early.
      // A literal space still terminates a URL, even in that same position.
      if (!content && column === columns - 1 && continuesWithWideCell) continue
      const chars = content || ' '
      const position = { x: column + 1, y: lineIndex + 1, width: cell.getWidth() }
      text += chars
      for (let index = 0; index < chars.length; index += 1) positions.push(position)
    }
  }
  return { text, positions }
}

/** Supplements WebLinksAddon with host:port links, using xterm's public buffer/cell API. */
export function createLocalTerminalLinkProvider(
  terminal: Pick<Terminal, 'buffer' | 'cols'>,
  handlers: TerminalLinkHandlers,
): ILinkProvider {
  return {
    provideLinks(bufferLineNumber, callback) {
      const buffer = terminal.buffer.active
      const row = bufferLineNumber - 1
      if (terminal.cols < 1 || row < 0 || row >= buffer.length) { callback(undefined); return }
      const { text, positions } = wrappedLine(buffer, terminal.cols, row)
      const links: ILink[] = []
      for (const match of findLocalTerminalLinks(text)) {
        const start = positions[match.start]
        const end = positions[match.end - 1]
        if (!start || !end || bufferLineNumber < start.y || bufferLineNumber > end.y) continue
        const range = { start: { x: start.x, y: start.y }, end: { x: end.x + end.width - 1, y: end.y } }
        links.push({
          text: match.text,
          range,
          activate: (event, value) => handlers.activate(event, value, range),
          hover: (event, value) => handlers.hover?.(event, value, range),
          leave: (event, value) => handlers.leave?.(event, value, range),
        })
      }
      callback(links.length ? links : undefined)
    },
  }
}
