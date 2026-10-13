import { describe, expect, it, vi } from 'vitest'
import type { IBuffer, ILink, Terminal } from '@xterm/xterm'
import {
  createLocalTerminalLinkProvider,
  findLocalTerminalLinks,
  findTerminalLinks,
  isTerminalLinkModifier,
  normalizeTerminalLink,
} from '../../src/components/inspector/terminal-links'

describe('terminal address targets', () => {
  it('opens HTTP(S), local names and IP endpoints while preserving copied text', () => {
    expect(normalizeTerminalLink('https://example.com/docs?theme=dark#intro')).toEqual({
      text: 'https://example.com/docs?theme=dark#intro', url: 'https://example.com/docs?theme=dark#intro',
    })
    expect(normalizeTerminalLink('localhost:5173/src?x=1#ready')).toEqual({
      text: 'localhost:5173/src?x=1#ready', url: 'http://localhost:5173/src?x=1#ready',
    })
    expect(normalizeTerminalLink('192.168.1.20:8080')).toEqual({ text: '192.168.1.20:8080', url: 'http://192.168.1.20:8080/' })
    expect(normalizeTerminalLink('[::1]:3000/')).toEqual({ text: '[::1]:3000/', url: 'http://[::1]:3000/' })
    expect(normalizeTerminalLink('[fd00::5]:8080')).toEqual({ text: '[fd00::5]:8080', url: 'http://[fd00::5]:8080/' })
  })

  it('maps wildcard listen hosts to browser-reachable localhost without losing URL components', () => {
    for (const [text, url] of [
      ['0.0.0.0:3000/app?hello=world#view', 'http://localhost:3000/app?hello=world#view'],
      ['http://0.0.0.0:3000/app', 'http://localhost:3000/app'],
      ['https://[::]:4443/?x=1#top', 'https://localhost:4443/?x=1#top'],
      ['[::]:3000', 'http://localhost:3000/'],
    ]) expect(normalizeTerminalLink(text)).toEqual({ text, url })
  })

  it('rejects dangerous schemes, credentials, malformed addresses and partial ports', () => {
    for (const text of [
      'javascript:alert(1)', 'file:///tmp/a', 'data:text/html,hello', 'ftp://localhost:3000',
      'https://user:password@localhost:3000', 'http://user@localhost:3000',
      'localhost', 'example.com:3000', 'localhost:0', 'localhost:65536', 'localhost:3000abc',
      '999.1.1.1:3000', '127.000.0.1:3000', '[invalid]:3000', '[1:2]:3000',
      'http://localhost:3000\n', ' http://localhost:3000', 'http://local\u0000host:3000',
      `https://example.com/${'x'.repeat(2048)}`,
    ]) expect(normalizeTerminalLink(text), text).toBeUndefined()
  })
})

describe('terminal printed address recognition', () => {
  it('recognizes dev-server output, punctuation and queries with exact original offsets', () => {
    const text = 'Local: http://localhost:5173/\nNetwork: 192.168.1.2:5173/app?q=1#top\nReady (localhost:3000). IPv6 [::1]:8080.'
    const links = findTerminalLinks(text)
    expect(links.map((link) => link.text)).toEqual([
      'http://localhost:5173/', '192.168.1.2:5173/app?q=1#top', 'localhost:3000', '[::1]:8080',
    ])
    for (const link of links) expect(text.slice(link.start, link.end)).toBe(link.text)
    expect(findLocalTerminalLinks(text).map((link) => link.text)).toEqual(links.slice(1).map((link) => link.text))
  })

  it('keeps balanced path brackets and Unicode while removing enclosing punctuation', () => {
    const text = '见 (https://example.com/doc_(draft)). 打开http://localhost:3000，已经启动。地址=localhost:3000/你好?q=好#标题。'
    expect(findTerminalLinks(text).map((link) => link.text)).toEqual([
      'https://example.com/doc_(draft)', 'http://localhost:3000', 'localhost:3000/你好?q=好#标题',
    ])
    expect(findTerminalLinks('打开 http://localhost:3000，已经启动。')[0]?.text).toBe('http://localhost:3000')
  })

  it('never produces overlapping or partial links from web URLs, credentials or unrelated tokens', () => {
    const text = [
      'https://example.com/proxy/localhost:3000?next=127.0.0.1:8080',
      'https://user@localhost:3000/', 'ftp://localhost:3000/', 'user@localhost:3000',
      'mylocalhost:3000', 'localhost:3000abc', 'localhost:3000.evil', 'localhost:123456',
      'file:///tmp/127.0.0.1:3000', 'javascript:http://localhost:3000',
    ].join(' ')
    expect(findTerminalLinks(text).map((link) => link.text)).toEqual(['https://example.com/proxy/localhost:3000?next=127.0.0.1:8080'])
    expect(findLocalTerminalLinks(text)).toEqual([])
  })

  it('does not join real line breaks or accept partial ports followed by text', () => {
    expect(findTerminalLinks('localhost:\n3000 http://\nlocalhost:3000')).toEqual([
      { text: 'localhost:3000', url: 'http://localhost:3000/', start: 24, end: 38 },
    ])
    expect(findTerminalLinks('localhost:3000:4 localhost:3000-nope localhost:3000@evil')).toEqual([])
  })

  it('requires the native link modifier without stealing alternative mouse gestures', () => {
    const pointer = { ctrlKey: false, metaKey: false, altKey: false, shiftKey: false }
    expect(isTerminalLinkModifier(pointer, 'MacIntel')).toBe(false)
    expect(isTerminalLinkModifier({ ...pointer, metaKey: true }, 'MacIntel')).toBe(true)
    expect(isTerminalLinkModifier({ ...pointer, metaKey: true }, 'darwin')).toBe(true)
    expect(isTerminalLinkModifier({ ...pointer, ctrlKey: true }, 'Win32')).toBe(true)
    expect(isTerminalLinkModifier({ ...pointer, ctrlKey: true }, 'Linux x86_64')).toBe(true)
    expect(isTerminalLinkModifier({ ...pointer, ctrlKey: true }, 'MacIntel')).toBe(false)
    expect(isTerminalLinkModifier({ ...pointer, metaKey: true, shiftKey: true }, 'MacIntel')).toBe(false)
    expect(isTerminalLinkModifier({ ...pointer, ctrlKey: true, altKey: true }, 'Win32')).toBe(false)
  })
})

function terminalBuffer(rows: { cells: (string | [string, number])[]; wrapped?: boolean }[], columns: number) {
  const lines = rows.map((row) => {
    const cells = row.cells.flatMap((value) => {
      const [chars, width] = typeof value === 'string' ? [value, 1] : value
      return width === 2 ? [{ chars, width }, { chars: '', width: 0 }] : [{ chars, width }]
    })
    while (cells.length < columns) cells.push({ chars: '', width: 1 })
    return {
      isWrapped: row.wrapped ?? false, length: cells.length,
      getCell: (column: number) => {
        const cell = cells[column]
        return cell ? { getChars: () => cell.chars, getWidth: () => cell.width } : undefined
      },
    }
  })
  const active = { length: lines.length, getLine: (row: number) => lines[row], getNullCell: () => ({}) } as unknown as IBuffer
  return { cols: columns, buffer: { active } } as Pick<Terminal, 'buffer' | 'cols'>
}

describe('xterm local link provider', () => {
  it('skips only xterm early-wrap padding before a wide URL character, preserving literal spaces', () => {
    for (const explicitSpace of [false, true]) {
      const terminal = terminalBuffer([
        { cells: [...'localhost:30/', ...(explicitSpace ? [' '] : [])] },
        { cells: [['中', 2]], wrapped: true },
      ], 14)
      const provider = createLocalTerminalLinkProvider(terminal, { activate: vi.fn() })
      const callback = vi.fn()
      provider.provideLinks(1, callback)
      expect(callback.mock.calls[0][0][0]).toMatchObject(explicitSpace
        ? { text: 'localhost:30/', range: { start: { x: 1, y: 1 }, end: { x: 13, y: 1 } } }
        : { text: 'localhost:30/中', range: { start: { x: 1, y: 1 }, end: { x: 2, y: 2 } } })
    }
  })

  it('joins soft wraps and returns inclusive cell ranges accounting for wide and combining characters', () => {
    const terminal = terminalBuffer([
      { cells: [['中', 2], ['😀', 2], 'e\u0301', ' ', ...'localhos'] },
      { cells: [...'t:3000/a'] , wrapped: true },
    ], 14)
    const activate = vi.fn()
    const hover = vi.fn()
    const leave = vi.fn()
    const provider = createLocalTerminalLinkProvider(terminal, { activate, hover, leave })
    for (const row of [1, 2]) {
      let links: ILink[] | undefined
      provider.provideLinks(row, (result) => { links = result })
      expect(links).toHaveLength(1)
      const link = links![0]
      expect(link.text).toBe('localhost:3000/a')
      expect(link.range).toEqual({ start: { x: 7, y: 1 }, end: { x: 8, y: 2 } })
      const event = {} as MouseEvent
      link.activate(event, link.text)
      link.hover?.(event, link.text)
      link.leave?.(event, link.text)
      expect(activate).toHaveBeenLastCalledWith(event, link.text, link.range)
      expect(hover).toHaveBeenLastCalledWith(event, link.text, link.range)
      expect(leave).toHaveBeenLastCalledWith(event, link.text, link.range)
    }
  })

  it('does not join independent lines or compete with HTTP links from the official addon', () => {
    const terminal = terminalBuffer([
      { cells: [...'localhost:'] }, { cells: [...'3000'] },
      { cells: [...'http://localhost:3000'] }, { cells: [...'localhost:8080'] },
    ], 24)
    const provider = createLocalTerminalLinkProvider(terminal, { activate: vi.fn() })
    for (const row of [0, 1, 2, 3, 5]) {
      const callback = vi.fn()
      provider.provideLinks(row, callback)
      expect(callback).toHaveBeenCalledWith(undefined)
    }
    const callback = vi.fn()
    provider.provideLinks(4, callback)
    expect(callback.mock.calls[0][0][0]).toMatchObject({ text: 'localhost:8080', range: { start: { x: 1, y: 4 }, end: { x: 14, y: 4 } } })
  })
})
