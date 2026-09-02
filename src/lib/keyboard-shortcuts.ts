function currentPlatformHint() {
  return typeof navigator === 'undefined' ? '' : navigator.userAgent
}

/** Render the same primary-modifier shortcut that App handles on this platform. */
export function primaryShortcut(key: string, platformHint = currentPlatformHint()) {
  if (/Mac|iPhone|iPad|iPod/i.test(platformHint)) return `⌘${key}`
  if (platformHint) return `Ctrl+${key}`
  return `Ctrl/⌘+${key}`
}
