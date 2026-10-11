/**
 * ⌘⌥A (Ctrl+Alt+A): open the next conversation that needs you — Pi waiting
 * for an answer, a failed run, or an unread result (Codex's "next chat
 * needing attention"). The sidebar, which knows each row's state, answers.
 */
const listeners = new Set<() => boolean>()

export function requestNextAttention(): boolean {
  for (const listener of listeners) if (listener()) return true
  return false
}

export function subscribeNextAttention(listener: () => boolean) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
