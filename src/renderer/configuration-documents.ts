import type { McpConfigSaveResult } from '@/shared/mcp-config'

export type ConfigDocumentView = 'form' | 'json'

export interface ConfigDocumentSnapshot {
  content: string
  fingerprint: string
}

export interface ConfigDocumentSaveResult<TSnapshot extends ConfigDocumentSnapshot> {
  snapshot: TSnapshot
  apply: McpConfigSaveResult['apply']
}

export interface ConfigDocumentState<TSnapshot extends ConfigDocumentSnapshot> {
  snapshot: TSnapshot | null
  draftText: string
  revision: number
  view: ConfigDocumentView
  phase: 'idle' | 'loading' | 'saving'
  error: { code: string; message: string } | null
  savedApply: ConfigDocumentSaveResult<TSnapshot>['apply'] | null
}

interface ConfigDocumentOperations<TSnapshot extends ConfigDocumentSnapshot> {
  load(): Promise<TSnapshot>
  save(text: string, fingerprint: string, apply: boolean): Promise<ConfigDocumentSaveResult<TSnapshot>>
}

export function isConfigDocumentDirty<TSnapshot extends ConfigDocumentSnapshot>(
  state: ConfigDocumentState<TSnapshot>,
) {
  return state.snapshot ? state.draftText !== state.snapshot.content : state.draftText.length > 0
}

function documentError(error: unknown, fallback: string) {
  const code = typeof error === 'object' && error !== null && 'code' in error &&
    typeof error.code === 'string' ? error.code.slice(0, 128) : fallback
  return { code, message: error instanceof Error ? error.message.slice(0, 1_000) : '' }
}

function withinContentLimit(content: string, limit: number) {
  return content.length <= limit &&
    (content.length <= limit / 3 || new TextEncoder().encode(content).byteLength <= limit)
}

/** One document owns its draft and operations, regardless of the visible Settings target. */
export class ConfigurationDocument<TSnapshot extends ConfigDocumentSnapshot> {
  private state: ConfigDocumentState<TSnapshot> = {
    snapshot: null,
    draftText: '',
    revision: 0,
    view: 'form',
    phase: 'idle',
    error: null,
    savedApply: null,
  }
  private readonly listeners = new Set<() => void>()
  private shutdownLocked = false

  constructor(
    private readonly operations: ConfigDocumentOperations<TSnapshot>,
    private readonly contentLimit: number,
  ) {}

  getSnapshot = () => this.state

  setShutdownLocked(locked: boolean) { this.shutdownLocked = locked }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  canEvict() {
    return this.listeners.size === 0 && this.state.phase === 'idle' && !isConfigDocumentDirty(this.state)
  }

  private publish(next: ConfigDocumentState<TSnapshot>) {
    this.state = next
    for (const listener of this.listeners) listener()
  }

  private assertContent(content: string) {
    if (!withinContentLimit(content, this.contentLimit)) {
      throw Object.assign(new Error(''), { code: 'CONFIG_DOCUMENT_TOO_LARGE' })
    }
  }

  updateDraft = (draftText: string) => {
    if (this.shutdownLocked) return false
    if (!withinContentLimit(draftText, this.contentLimit)) {
      this.publish({ ...this.state, error: { code: 'CONFIG_DOCUMENT_TOO_LARGE', message: '' } })
      return false
    }
    if (draftText === this.state.draftText) return true
    this.publish({ ...this.state, draftText, revision: this.state.revision + 1, error: null })
    return true
  }

  setView = (view: ConfigDocumentView) => {
    if (view !== this.state.view) this.publish({ ...this.state, view })
  }

  updateSnapshot = (update: (snapshot: TSnapshot | null) => TSnapshot | null) => {
    if (this.shutdownLocked) return
    this.publish({ ...this.state, snapshot: update(this.state.snapshot) })
  }

  load = async (replace = false) => {
    if (this.shutdownLocked) return false
    if (this.state.phase !== 'idle' || (this.state.snapshot && !replace)) return false
    const revision = this.state.revision
    const replaceDraft = replace || !isConfigDocumentDirty(this.state)
    this.publish({ ...this.state, phase: 'loading', error: null, savedApply: null })
    try {
      const snapshot = await this.operations.load()
      this.assertContent(snapshot.content)
      const draftText = replaceDraft && this.state.revision === revision
        ? snapshot.content : this.state.draftText
      this.publish({
        ...this.state,
        snapshot,
        draftText,
        revision: this.state.revision + (draftText === this.state.draftText ? 0 : 1),
        phase: 'idle',
      })
      return true
    } catch (error) {
      this.publish({ ...this.state, phase: 'idle', error: documentError(error, 'CONFIG_DOCUMENT_LOAD_FAILED') })
      return false
    }
  }

  save = async (apply: boolean) => {
    if (this.shutdownLocked) return null
    const captured = this.state
    if (!captured.snapshot || captured.phase !== 'idle') return null
    this.publish({ ...captured, phase: 'saving', error: null, savedApply: null })
    try {
      const result = await this.operations.save(captured.draftText, captured.snapshot.fingerprint, apply)
      this.assertContent(result.snapshot.content)
      const draftText = this.state.revision === captured.revision
        ? result.snapshot.content : this.state.draftText
      this.publish({
        ...this.state,
        snapshot: result.snapshot,
        draftText,
        revision: this.state.revision + (draftText === this.state.draftText ? 0 : 1),
        phase: 'idle',
        savedApply: result.apply,
      })
      return result
    } catch (error) {
      this.publish({ ...this.state, phase: 'idle', error: documentError(error, 'CONFIG_DOCUMENT_SAVE_FAILED') })
      return null
    }
  }
}

/** Clean inactive entries are LRU-evicted; dirty or in-flight documents are never evicted. */
export class ConfigurationDocumentRegistry<TSnapshot extends ConfigDocumentSnapshot> {
  private readonly documents = new Map<string, ConfigurationDocument<TSnapshot>>()
  private shutdownLocked = false

  constructor(private readonly maxDocuments: number, private readonly contentLimit: number) {}

  values() { return [...this.documents.values()] }

  setShutdownLocked(locked: boolean) {
    this.shutdownLocked = locked
    for (const document of this.documents.values()) document.setShutdownLocked(locked)
  }

  get(key: string, operations: ConfigDocumentOperations<TSnapshot>) {
    const existing = this.documents.get(key)
    if (existing) {
      this.documents.delete(key)
      this.documents.set(key, existing)
      return existing
    }
    if (this.shutdownLocked) return null
    if (this.documents.size >= this.maxDocuments) {
      const evictable = [...this.documents].find(([, document]) => document.canEvict())
      if (!evictable) return null
      this.documents.delete(evictable[0])
    }
    const document = new ConfigurationDocument(operations, this.contentLimit)
    this.documents.set(key, document)
    return document
  }
}
