import type { PiResourceKind } from '@/shared/pi-integrations'

/*
 * "View resources" on a package: Skills & Resources opens filtered to that
 * package once it is showing.
 */

export interface ResourceFocus {
  packageId: string
  packageName: string
  kind?: PiResourceKind
}

let pending: ResourceFocus | null = null
const listeners = new Set<() => void>()

export function requestResourceFocus(focus: ResourceFocus) {
  pending = focus
  for (const listener of listeners) listener()
}

export function takeResourceFocus() {
  const focus = pending
  pending = null
  return focus
}

export function subscribeResourceFocus(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
