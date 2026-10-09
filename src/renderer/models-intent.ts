/*
 * "Add model" from outside Settings (the composer's model picker when no model
 * is available): Settings › Models opens its add sheet once it is showing.
 */

let pending = false
const listeners = new Set<() => void>()

export function requestModelsQuickAdd() {
  pending = true
  for (const listener of listeners) listener()
}

/** True once per request: the caller opens the sheet. */
export function takeModelsQuickAddRequest() {
  const requested = pending
  pending = false
  return requested
}

export function subscribeModelsQuickAddRequest(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
