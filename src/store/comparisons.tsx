import * as React from 'react'
import type { Comparison } from '@/shared/comparisons'

/* Model comparisons, kept current by Main's change events. */
let comparisons: Comparison[] | null = null
const listeners = new Set<() => void>()
let version = 0
let attached = false
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
const getVersion = () => version
function publish(next: Comparison[]) {
  comparisons = next
  version += 1
  for (const listener of listeners) listener()
}
function attach() {
  const api = window.pipilot?.comparisons
  if (attached || !api) return
  attached = true
  api.subscribe(publish)
  void api.list().then(publish, () => undefined)
}

export function useComparisons(projectId?: string | null) {
  React.useSyncExternalStore(subscribe, getVersion)
  React.useEffect(attach, [])
  const all = comparisons ?? []
  return projectId === undefined ? all : all.filter((comparison) => comparison.projectId === projectId)
}

/* Which comparison the Compare tab shows. */
let selected: string | null = null
const selectionListeners = new Set<() => void>()
export function selectComparison(id: string | null) {
  selected = id
  for (const listener of selectionListeners) listener()
}
export function useSelectedComparison() {
  return React.useSyncExternalStore((listener) => { selectionListeners.add(listener); return () => { selectionListeners.delete(listener) } }, () => selected)
}
