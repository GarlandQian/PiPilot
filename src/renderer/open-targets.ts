import * as React from 'react'
import { matchesAppId } from '@/shared/app-identity'
import type { ExternalEditor } from '@/shared/external-editors'
import type { TerminalExternalApp } from '@/shared/terminal-profiles'
import { useSettings, useUpdateSettings } from '@/store/settings'

/**
 * Codex's "Open in": one list of apps that open a project or a file, grouped
 * as editors, terminals, then the default app and the file manager.
 */
export type OpenTarget =
  | { group: 'editor' | 'other'; id: string; name: string; icon?: string; editor: ExternalEditor }
  | { group: 'terminal'; id: string; name: string; icon?: string; app: TerminalExternalApp }

interface Inventory { editors: readonly ExternalEditor[]; terminals: readonly TerminalExternalApp[] }

const PREFERRED_KEY = 'pipilot.editor.preferred.v1'
const LIST_TTL_MS = 60_000
const EMPTY: Inventory = { editors: [], terminals: [] }

let listed: { at: number; inventory: Promise<Inventory> } | null = null
let latest: Inventory = EMPTY
const inventoryListeners = new Set<(inventory: Inventory) => void>()
let preferredId: string | null = (() => {
  try { return typeof window === 'undefined' ? null : window.localStorage.getItem(PREFERRED_KEY) } catch { return null }
})()
const preferenceListeners = new Set<() => void>()

/** Every hook sees one inventory; `refresh` rescans now (Codex rescans when the menu opens). */
function loadInventory(refresh = false) {
  const api = typeof window === 'undefined' ? undefined : window.pipilot
  if (!api) return Promise.resolve(EMPTY)
  if (!listed || refresh || Date.now() - listed.at > LIST_TTL_MS) {
    const inventory = Promise.all([
      api.editors.list(refresh).catch(() => [] as ExternalEditor[]),
      api.terminal.listExternalApps(refresh).catch(() => [] as TerminalExternalApp[]),
    ]).then(([editors, terminals]) => ({ editors, terminals }))
    listed = { at: Date.now(), inventory }
    void inventory.then((value) => {
      if (listed?.inventory !== inventory) return
      latest = value
      for (const listener of inventoryListeners) listener(value)
    })
  }
  return listed.inventory
}

/** The last app used to open something becomes the default (Codex), editor or terminal. */
export function rememberOpenTarget(id: string) {
  preferredId = id
  try { localStorage.setItem(PREFERRED_KEY, id) } catch { /* The choice still applies until restart. */ }
  for (const listener of preferenceListeners) listener()
}

export function openTargetsOf({ editors, terminals }: Inventory): OpenTarget[] {
  return [
    ...editors.filter((editor) => editor.kind === 'editor').map((editor): OpenTarget => ({ group: 'editor', id: editor.id, name: editor.name, ...(editor.icon ? { icon: editor.icon } : {}), editor })),
    ...terminals.map((app): OpenTarget => ({ group: 'terminal', id: app.id, name: app.label, ...(app.icon ? { icon: app.icon } : {}), app })),
    ...editors.filter((editor) => editor.kind !== 'editor').map((editor): OpenTarget => ({ group: 'other', id: editor.id, name: editor.name, ...(editor.icon ? { icon: editor.icon } : {}), editor })),
  ]
}

export function isAvailable(target: OpenTarget) {
  return target.group === 'terminal' ? target.app.available : target.editor.available !== false
}

/** The default among those installed: the remembered one, else the first editor, else the default app. */
export function preferredTarget(targets: readonly OpenTarget[], id: string | null = preferredId) {
  const usable = targets.filter((target) => isAvailable(target) && !(target.group === 'other' && target.editor.kind === 'file-manager'))
  return usable.find((target) => matchesAppId(target.group === 'terminal' ? target.app : target.editor, id))
    ?? usable.find((target) => target.group === 'editor')
    ?? usable.find((target) => target.group === 'other')
    ?? null
}

/** A workspace-relative file's folder; a terminal opens folders (Codex opens $EDITOR there, which needs Automation). */
function folderOf(path: string | undefined) {
  if (!path) return '.'
  const index = path.lastIndexOf('/')
  return index > 0 ? path.slice(0, index) : '.'
}

export function useOpenTargets() {
  const [inventory, setInventory] = React.useState<Inventory>(latest)
  const remembered = React.useSyncExternalStore((listener) => {
    preferenceListeners.add(listener)
    return () => preferenceListeners.delete(listener)
  }, () => preferredId, () => preferredId)
  const { terminal } = useSettings()
  const { updateTerminal } = useUpdateSettings()
  React.useEffect(() => {
    let current = true
    const listener = (value: Inventory) => { if (current) setInventory(value) }
    inventoryListeners.add(listener)
    void loadInventory().then(listener)
    // An app installed while PiPilot runs shows up the next time the window comes forward.
    const focus = () => void loadInventory(true)
    window.addEventListener('focus', focus)
    return () => { current = false; inventoryListeners.delete(listener); window.removeEventListener('focus', focus) }
  }, [])
  const targets = React.useMemo(() => openTargetsOf(inventory), [inventory])
  const refresh = React.useCallback(() => loadInventory(true), [])
  const defaultTerminalId = terminal.defaultExternalAppId
  const open = React.useCallback(async (workspaceId: string, target: OpenTarget, file?: { path?: string; line?: number }) => {
    if (target.group === 'terminal') {
      await window.pipilot!.terminal.openExternal({ kind: 'project', workspaceId }, target.id, folderOf(file?.path))
      // "Open in external terminal" elsewhere follows the terminal used last.
      if (!matchesAppId(target.app, defaultTerminalId)) {
        const { id, label, executable, adapter } = target.app
        void updateTerminal({ defaultExternalAppId: id, defaultExternalAppSnapshot: { id, label, executable, adapter } }).catch(() => false)
      }
    } else {
      await window.pipilot!.editors.open(workspaceId, target.id, file)
    }
    if (target.group !== 'other' || target.editor.kind === 'system') rememberOpenTarget(target.id)
  }, [defaultTerminalId, updateTerminal])
  return { targets, inventory, preferred: preferredTarget(targets, remembered), open, refresh, setPreferred: rememberOpenTarget }
}
