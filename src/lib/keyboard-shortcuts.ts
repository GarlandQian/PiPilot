function currentPlatformHint() {
  return typeof navigator === 'undefined' ? '' : navigator.userAgent
}

export function isMacPlatform(platformHint = currentPlatformHint()) {
  return /Mac|iPhone|iPad|iPod/i.test(platformHint)
}

/** Render the same primary-modifier shortcut that App handles on this platform. */
export function primaryShortcut(key: string, platformHint = currentPlatformHint()) {
  if (isMacPlatform(platformHint)) return `⌘${key === 'Enter' ? '↩' : key}`
  // Windows and Linux spell keys out: Ctrl+Enter, not Ctrl+↩.
  const named = key === '↩' ? 'Enter' : key
  if (platformHint) return `Ctrl+${named}`
  return `Ctrl/⌘+${named}`
}

/** The Return key as a hint: ↩ on macOS, Enter elsewhere. */
export function enterKey(platformHint = currentPlatformHint()) {
  return isMacPlatform(platformHint) ? '↩' : 'Enter'
}

/** Primary modifier plus Shift, e.g. ⇧⌘F on macOS and Ctrl+Shift+F elsewhere. */
export function primaryShiftShortcut(key: string, platformHint = currentPlatformHint()) {
  if (isMacPlatform(platformHint)) return `⇧⌘${key === 'Enter' ? '↩' : key}`
  if (platformHint) return `Ctrl+Shift+${key}`
  return `Ctrl/⌘+Shift+${key}`
}

/** The system full-screen toggle: ⌃⌘F on macOS, F11 on Windows and Linux. */
export function fullScreenShortcut(platformHint = currentPlatformHint()) {
  return isMacPlatform(platformHint) ? '⌃⌘F' : 'F11'
}

/** ⌘ on macOS, Ctrl on Windows and Linux, and not the other one. */
export function isPrimaryModifier(event: Pick<KeyboardEvent, 'metaKey' | 'ctrlKey'>, platformHint = currentPlatformHint()) {
  return isMacPlatform(platformHint) ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
}

/**
 * A keyboard shortcut as Codex documents it. `primary` is ⌘ on macOS and Ctrl
 * elsewhere; `control` is the Control key everywhere (⌃ on macOS).
 * `code` matches the physical key, for combinations whose character changes
 * with ⌥ or Shift.
 */
export interface ShortcutSpec {
  key: string
  code?: string
  primary?: boolean
  control?: boolean
  shift?: boolean
  alt?: boolean
}

type ShortcutEvent = Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>

export function matchesShortcut(event: ShortcutEvent, spec: ShortcutSpec, platformHint = currentPlatformHint()) {
  const mac = isMacPlatform(platformHint)
  const meta = mac ? Boolean(spec.primary) : false
  const ctrl = mac ? Boolean(spec.control) : Boolean(spec.primary || spec.control)
  if (event.metaKey !== meta || event.ctrlKey !== ctrl) return false
  if (event.shiftKey !== Boolean(spec.shift) || event.altKey !== Boolean(spec.alt)) return false
  return spec.code ? event.code === spec.code : event.key.toLowerCase() === spec.key.toLowerCase()
}

const MAC_KEYS: Record<string, string> = { Enter: '↩', Tab: '⇥', Escape: '⎋', Backspace: '⌫' }

/** macOS orders modifiers ⌃⌥⇧⌘; Windows and Linux write Ctrl+Alt+Shift+Key. */
export function formatShortcut(spec: ShortcutSpec, platformHint = currentPlatformHint()) {
  if (isMacPlatform(platformHint)) {
    return `${spec.control ? '⌃' : ''}${spec.alt ? '⌥' : ''}${spec.shift ? '⇧' : ''}${spec.primary ? '⌘' : ''}${MAC_KEYS[spec.key] ?? spec.key}`
  }
  const parts = [spec.primary || spec.control ? 'Ctrl' : '', spec.alt ? 'Alt' : '', spec.shift ? 'Shift' : '', spec.key].filter(Boolean)
  return parts.join('+')
}
