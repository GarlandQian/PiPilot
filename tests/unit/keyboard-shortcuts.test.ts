import { describe, expect, it } from 'vitest'
import { enterKey, formatShortcut, fullScreenShortcut, isPrimaryModifier, matchesShortcut, primaryShiftShortcut, primaryShortcut } from '../../src/lib/keyboard-shortcuts'
import { APP_SHORTCUTS, goalModeShortcut } from '../../src/lib/app-shortcuts'

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

  it('spells keys the way each platform shows them', () => {
    expect(primaryShortcut('↩', 'Macintosh')).toBe('⌘↩')
    expect(primaryShortcut('↩', 'Windows NT 10.0')).toBe('Ctrl+Enter')
    expect(primaryShiftShortcut('Enter', 'Macintosh')).toBe('⇧⌘↩')
    expect(primaryShiftShortcut('P', 'X11; Linux x86_64')).toBe('Ctrl+Shift+P')
    expect(enterKey('Windows NT 10.0')).toBe('Enter')
    expect(fullScreenShortcut('Macintosh')).toBe('⌃⌘F')
    expect(fullScreenShortcut('Windows NT 10.0')).toBe('F11')
  })
})

const key = (event: Partial<KeyboardEvent>) => ({ key: '', code: '', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...event })

describe('workspace shortcuts', () => {
  it('writes modifiers the way each platform does', () => {
    expect(formatShortcut(APP_SHORTCUTS.switchChatAndTabs, 'Macintosh')).toBe('⌥⌘B')
    expect(formatShortcut(APP_SHORTCUTS.switchChatAndTabs, 'Windows NT 10.0')).toBe('Ctrl+Alt+B')
    expect(formatShortcut(APP_SHORTCUTS.openReview, 'Macintosh')).toBe('⌃⇧G')
    expect(formatShortcut(APP_SHORTCUTS.openReview, 'X11; Linux x86_64')).toBe('Ctrl+Shift+G')
    expect(formatShortcut(APP_SHORTCUTS.toggleTerminal, 'Macintosh')).toBe('⌃`')
    expect(formatShortcut(APP_SHORTCUTS.previousTab, 'Macintosh')).toBe('⌃⇧⇥')
    expect(formatShortcut(APP_SHORTCUTS.previousTab, 'Windows NT 10.0')).toBe('Ctrl+Shift+Tab')
  })

  it('matches ⌘ on macOS and Ctrl elsewhere, and only the modifiers asked for', () => {
    expect(matchesShortcut(key({ key: 'j', code: 'KeyJ', metaKey: true }), APP_SHORTCUTS.toggleBottomPanel, 'Macintosh')).toBe(true)
    expect(matchesShortcut(key({ key: 'j', code: 'KeyJ', ctrlKey: true }), APP_SHORTCUTS.toggleBottomPanel, 'Macintosh')).toBe(false)
    expect(matchesShortcut(key({ key: 'j', code: 'KeyJ', ctrlKey: true }), APP_SHORTCUTS.toggleBottomPanel, 'Windows NT 10.0')).toBe(true)
    expect(matchesShortcut(key({ key: 'J', code: 'KeyJ', ctrlKey: true, shiftKey: true }), APP_SHORTCUTS.toggleBottomPanel, 'Windows NT 10.0')).toBe(false)
    // ⌥ changes the character on macOS; the physical key still matches.
    expect(matchesShortcut(key({ key: '∫', code: 'KeyB', metaKey: true, altKey: true }), APP_SHORTCUTS.switchChatAndTabs, 'Macintosh')).toBe(true)
    expect(matchesShortcut(key({ key: 'G', code: 'KeyG', ctrlKey: true, shiftKey: true }), APP_SHORTCUTS.openReview, 'Macintosh')).toBe(true)
    expect(matchesShortcut(key({ key: 'G', code: 'KeyG', metaKey: true, shiftKey: true }), APP_SHORTCUTS.openReview, 'Macintosh')).toBe(false)
    expect(isPrimaryModifier(key({ ctrlKey: true }), 'Macintosh')).toBe(false)
    expect(isPrimaryModifier(key({ ctrlKey: true }), 'Windows NT 10.0')).toBe(true)
  })

  it('keeps goal mode clear of the review shortcut on Windows and Linux', () => {
    expect(formatShortcut(goalModeShortcut('Macintosh'), 'Macintosh')).toBe('⇧⌘G')
    expect(formatShortcut(goalModeShortcut('Windows NT 10.0'), 'Windows NT 10.0')).toBe('Ctrl+Alt+G')
  })
})
