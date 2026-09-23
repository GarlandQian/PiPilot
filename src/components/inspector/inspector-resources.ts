import {
  workspaceRelativePathSchema,
  type WorkspaceFilePreview,
} from '@/shared/workspace-content'

export const INSPECTOR_MAX_OPEN_FILES = 8

/** Files belong to a workspace; sessionKey is optional request provenance only. */
export interface InspectorPreviewState {
  sessionKey: string
  workspaceId: string
  path: string
  preview?: WorkspaceFilePreview
  phase: 'loading' | 'ready' | 'error'
  errorCode?: string
}

export interface InspectorResourcesSnapshot {
  files: readonly InspectorPreviewState[]
  activePath: string | null
  atCapacity: boolean
}

function previewMatches(preview: WorkspaceFilePreview, workspaceId: string, path: string) {
  return preview.workspaceId === workspaceId && preview.path === path
}

function getErrorCode(error: unknown) {
  if (typeof error !== 'object' || error === null || !('code' in error)) return 'UNKNOWN_ERROR'
  return typeof error.code === 'string' ? error.code : 'UNKNOWN_ERROR'
}

/** Workspace-scoped previews with independent request ownership and a bounded working set. */
export class InspectorResourcesController {
  private sessionKey: string | null = null
  private disposed = false
  private epoch = 0
  private requestSequence = 0
  private selectionSequence = 0
  private pending = new Map<string, number>()
  private reads = new Map<string, Promise<void>>()
  private selectedAt = new Map<string, number>()
  private listeners = new Set<() => void>()
  private snapshot: InspectorResourcesSnapshot = { files: [], activePath: null, atCapacity: false }

  constructor(
    private readonly workspaceId: string,
    private readonly readPreview: (path: string) => Promise<WorkspaceFilePreview>,
    restored?: InspectorPreviewState | null,
  ) {
    if (
      restored?.workspaceId === workspaceId &&
      restored.path !== '.' && workspaceRelativePathSchema.safeParse(restored.path).success &&
      (!restored.preview || previewMatches(restored.preview, workspaceId, restored.path))
    ) {
      this.snapshot = { files: [restored], activePath: restored.path, atCapacity: false }
      this.selectedAt.set(restored.path, ++this.selectionSequence)
    }
  }

  readonly getSnapshot = () => this.snapshot
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Session selection never blocks or invalidates project-owned reads. */
  setSession(sessionKey: string | null) {
    this.sessionKey = sessionKey
  }

  readonly open = (path: string, reload = false): boolean => {
    if (this.disposed || path === '.' || !workspaceRelativePathSchema.safeParse(path).success) return false
    const existing = this.snapshot.files.find((file) => file.path === path)
    let files = [...this.snapshot.files]
    if (!existing && files.length >= INSPECTOR_MAX_OPEN_FILES) {
      // Keep the current reading surface and unfinished requests. Evict only the
      // least recently selected completed file; if all are protected, ask for a close.
      const candidate = files
        .filter((file) => file.path !== this.snapshot.activePath && file.phase !== 'loading')
        .sort((a, b) => (this.selectedAt.get(a.path) ?? 0) - (this.selectedAt.get(b.path) ?? 0))[0]
      if (!candidate) {
        this.publish({ ...this.snapshot, atCapacity: true })
        return false
      }
      files = files.filter((file) => file.path !== candidate.path)
      this.selectedAt.delete(candidate.path)
    }
    this.selectedAt.set(path, ++this.selectionSequence)
    if (!existing) {
      files.push({ workspaceId: this.workspaceId, sessionKey: this.sessionKey ?? this.workspaceId, path, phase: 'loading' })
    }
    this.publish({ files, activePath: path, atCapacity: false })
    if (!existing || reload || (existing.phase === 'loading' && !this.pending.has(path))) this.read(path)
    return true
  }

  readonly showTree = () => {
    this.publish({ ...this.snapshot, activePath: null, atCapacity: false })
  }

  readonly close = (path: string) => {
    const index = this.snapshot.files.findIndex((file) => file.path === path)
    if (index < 0) return
    this.pending.delete(path)
    this.reads.delete(path)
    this.selectedAt.delete(path)
    const files = this.snapshot.files.filter((file) => file.path !== path)
    const activePath = this.snapshot.activePath === path
      ? files[Math.min(index, files.length - 1)]?.path ?? null
      : this.snapshot.activePath
    if (activePath && activePath !== this.snapshot.activePath) this.selectedAt.set(activePath, ++this.selectionSequence)
    this.publish({ files, activePath, atCapacity: false })
  }

  dispose() {
    this.disposed = true
    this.epoch += 1
    this.pending.clear()
    this.reads.clear()
  }

  /** Background refresh never changes selection or duplicates an in-flight read. */
  readonly refreshActive = (): Promise<void> => {
    const path = this.snapshot.activePath
    if (this.disposed || !path) return Promise.resolve()
    return this.reads.get(path) ?? this.read(path)
  }

  private read(path: string) {
    const sessionKey = this.sessionKey ?? this.workspaceId
    const epoch = this.epoch
    const request = ++this.requestSequence
    const previousPreview = this.snapshot.files.find((file) => file.path === path)?.preview
    this.pending.set(path, request)
    this.replace(path, { workspaceId: this.workspaceId, sessionKey, path, preview: previousPreview, phase: 'loading' })
    const current = () => !this.disposed && this.epoch === epoch && this.pending.get(path) === request
    const operation = Promise.resolve().then(() => {
      if (!current()) return undefined
      return this.readPreview(path)
    }).then((preview) => {
      if (!current() || !preview) return
      if (!previewMatches(preview, this.workspaceId, path)) {
        throw { code: 'WORKSPACE_CONTENT_STALE_WORKSPACE' }
      }
      this.pending.delete(path)
      const unchanged = previousPreview && JSON.stringify(previousPreview) === JSON.stringify(preview)
      this.replace(path, { workspaceId: this.workspaceId, sessionKey, path, preview: unchanged ? previousPreview : preview, phase: 'ready' })
    }).catch((error: unknown) => {
      if (!current()) return
      this.pending.delete(path)
      this.replace(path, { workspaceId: this.workspaceId, sessionKey, path, preview: previousPreview, phase: 'error', errorCode: getErrorCode(error) })
    }).finally(() => {
      if (this.reads.get(path) === operation) this.reads.delete(path)
    })
    this.reads.set(path, operation)
    return operation
  }

  private replace(path: string, next: InspectorPreviewState) {
    this.publish({ ...this.snapshot, files: this.snapshot.files.map((file) => file.path === path ? next : file) })
  }

  private publish(snapshot: InspectorResourcesSnapshot) {
    this.snapshot = snapshot
    for (const listener of this.listeners) listener()
  }
}
