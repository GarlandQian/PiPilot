import { isMacPlatform, type ShortcutSpec } from './keyboard-shortcuts'

/** The workspace shortcuts from Codex's keyboard reference, on every platform. */
export const APP_SHORTCUTS = {
  toggleBottomPanel: { key: 'J', code: 'KeyJ', primary: true },
  toggleTerminal: { key: '`', code: 'Backquote', control: true },
  cycleLayout: { key: 'B', code: 'KeyB', primary: true, shift: true },
  toggleFullView: { key: 'F', code: 'KeyF', primary: true, shift: true },
  switchChatAndTabs: { key: 'B', code: 'KeyB', primary: true, alt: true },
  closeTab: { key: 'W', code: 'KeyW', primary: true },
  nextTab: { key: 'Tab', control: true },
  previousTab: { key: 'Tab', control: true, shift: true },
  openReview: { key: 'G', code: 'KeyG', control: true, shift: true },
  searchFiles: { key: 'P', code: 'KeyP', primary: true },
  toggleFileTree: { key: 'E', code: 'KeyE', primary: true, shift: true },
  openSideChat: { key: 'S', code: 'KeyS', primary: true, alt: true },
  searchConversations: { key: 'F', code: 'KeyF', primary: true, alt: true },
} satisfies Record<string, ShortcutSpec>

/**
 * Goal mode keeps ⇧⌘G on macOS. On Windows and Linux Ctrl+Shift+G opens the
 * review tab (Codex), so goal mode moves to Ctrl+Alt+G there.
 */
export function goalModeShortcut(platformHint?: string): ShortcutSpec {
  return isMacPlatform(platformHint) ? { key: 'G', code: 'KeyG', primary: true, shift: true } : { key: 'G', code: 'KeyG', primary: true, alt: true }
}

export const PLAN_MODE_SHORTCUT: ShortcutSpec = { key: 'P', code: 'KeyP', primary: true, shift: true }
