import * as React from 'react'
import type { ExternalEditor } from '@/shared/external-editors'

const PREFERRED_KEY = 'pipilot.editor.preferred.v1'
const LIST_TTL_MS = 60_000

let listed: { at: number; editors: Promise<ExternalEditor[]> } | null = null
let preferredId: string | null = (() => {
  try { return typeof window === 'undefined' ? null : window.localStorage.getItem(PREFERRED_KEY) } catch { return null }
})()
const listeners = new Set<() => void>()

function listEditors(refresh = false) {
  const api = typeof window === 'undefined' ? undefined : window.pipilot
  if (!api) return Promise.resolve([])
  if (!listed || refresh || Date.now() - listed.at > LIST_TTL_MS) {
    listed = { at: Date.now(), editors: api.editors.list().catch(() => []) }
  }
  return listed.editors
}

/** The last app used to open a file becomes the default (Codex). */
export function rememberEditor(id: string) {
  preferredId = id
  try { localStorage.setItem(PREFERRED_KEY, id) } catch { /* The choice still applies until restart. */ }
  for (const listener of listeners) listener()
}

/** The default editor among those installed: the remembered one, else the first editor, else the default app. */
export function preferredEditor(editors: readonly ExternalEditor[], id: string | null = preferredId) {
  return editors.find((editor) => editor.id === id) ?? editors.find((editor) => editor.kind === 'editor') ?? editors.find((editor) => editor.kind === 'system') ?? null
}

export function useExternalEditors() {
  const [editors, setEditors] = React.useState<readonly ExternalEditor[]>([])
  const remembered = React.useSyncExternalStore((listener) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }, () => preferredId, () => preferredId)
  React.useEffect(() => {
    let current = true
    const load = (refresh = false) => void listEditors(refresh).then((items) => { if (current) setEditors(items) })
    load()
    // An editor installed while PiPilot runs shows up the next time the window comes forward.
    const focus = () => load(true)
    window.addEventListener('focus', focus)
    return () => { current = false; window.removeEventListener('focus', focus) }
  }, [])
  const open = React.useCallback(async (workspaceId: string, editor: ExternalEditor, target?: { path?: string; line?: number }) => {
    await window.pipilot!.editors.open(workspaceId, editor.id, target)
    if (editor.kind === 'editor' || editor.kind === 'system') rememberEditor(editor.id)
  }, [])
  return { editors, preferred: preferredEditor(editors, remembered), open, setPreferred: rememberEditor }
}
