import { EMPTY_PANEL_TABS, restorePanelTabs, retainPanelTabs, serializePanelTabs, type PanelTabsState } from './panel-tabs'

export const PANEL_TABS_STORAGE_KEY = 'pipilot.panel-tabs.v1'
const MAX_REMEMBERED_CONVERSATIONS = 200
const MAX_DOCUMENT_CHARS = 512 * 1024

interface PanelTabsStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

function browserStorage(): PanelTabsStorage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage } catch { return null }
}

/**
 * Each conversation's tabs, kept in memory while the app runs and written
 * (without side questions, agents or command output) for the next launch.
 * Oldest conversations are forgotten first.
 */
export class PanelTabsStore {
  private readonly memory = new Map<string, PanelTabsState>()
  private persisted: Map<string, unknown> | null = null
  private writeTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly storage: PanelTabsStorage | null = browserStorage()) {}

  get(key: string): PanelTabsState {
    const cached = this.memory.get(key)
    if (cached) return cached
    const restored = restorePanelTabs(this.load().get(key)) ?? EMPTY_PANEL_TABS
    this.memory.set(key, restored)
    return restored
  }

  /** Leaving a conversation drops what only made sense while it was open. */
  leave(key: string) {
    const state = this.memory.get(key)
    if (!state) return
    const kept = retainPanelTabs(state, (tab) => tab.kind !== 'sidechat' && tab.kind !== 'subagent' && tab.kind !== 'command' && tab.kind !== 'action')
    if (kept !== state) this.memory.set(key, kept)
  }

  set(key: string, state: PanelTabsState) {
    if (this.memory.get(key) === state) return
    this.memory.set(key, state)
    const document = this.load()
    document.delete(key)
    document.set(key, serializePanelTabs(state))
    while (document.size > MAX_REMEMBERED_CONVERSATIONS) document.delete(document.keys().next().value as string)
    this.scheduleWrite()
  }

  flush() {
    if (this.writeTimer) clearTimeout(this.writeTimer)
    this.writeTimer = null
    if (!this.storage || !this.persisted) return
    try {
      const raw = JSON.stringify({ version: 1, conversations: [...this.persisted] })
      if (raw.length <= MAX_DOCUMENT_CHARS) this.storage.setItem(PANEL_TABS_STORAGE_KEY, raw)
    } catch {
      // Remembering tabs is a convenience; the panel works without it.
    }
  }

  private scheduleWrite() {
    if (this.writeTimer) return
    this.writeTimer = setTimeout(() => this.flush(), 250)
  }

  private load() {
    if (this.persisted) return this.persisted
    this.persisted = new Map()
    try {
      const raw = this.storage?.getItem(PANEL_TABS_STORAGE_KEY)
      const value = raw && raw.length <= MAX_DOCUMENT_CHARS ? JSON.parse(raw) as unknown : null
      const entries = value && typeof value === 'object' && (value as { version?: unknown }).version === 1
        ? (value as { conversations?: unknown }).conversations : null
      if (Array.isArray(entries)) {
        for (const entry of entries.slice(-MAX_REMEMBERED_CONVERSATIONS)) {
          if (Array.isArray(entry) && typeof entry[0] === 'string' && entry[0].length <= 1_024) this.persisted.set(entry[0], entry[1])
        }
      }
    } catch {
      // A damaged document starts every conversation without tabs.
    }
    return this.persisted
  }
}
