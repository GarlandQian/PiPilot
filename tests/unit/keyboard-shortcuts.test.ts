import { describe, expect, it } from 'vitest'
import { primaryShortcut } from '../../src/lib/keyboard-shortcuts'

describe('primaryShortcut', () => {
  it('uses Command on Apple platforms', () => {
    expect(primaryShortcut('K', 'Macintosh')).toBe('⌘K')
    expect(primaryShortcut('1', 'iPhone')).toBe('⌘1')
  })

  it('uses Ctrl on Windows and Linux', () => {
    expect(primaryShortcut('B', 'Windows NT 10.0')).toBe('Ctrl+B')
    expect(primaryShortcut('J', 'X11; Linux x86_64')).toBe('Ctrl+J')
  })

  it('keeps the server-side fallback platform-neutral', () => {
    expect(primaryShortcut('3', '')).toBe('Ctrl/⌘+3')
  })
})
