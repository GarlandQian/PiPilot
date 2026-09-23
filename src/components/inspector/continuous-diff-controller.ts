import type {
  WorkspaceChangeSummary,
  WorkspaceDiffFile,
  WorkspaceDiffSnapshot,
} from '@/shared/workspace-content'

export const CONTINUOUS_DIFF_MAX_CONCURRENT_READS = 3
export const CONTINUOUS_DIFF_INITIAL_READ_COUNT = 3
export type DiffReadPhase = 'idle' | 'queued' | 'loading' | 'ready' | 'error'

export type ContinuousDiffFile = WorkspaceChangeSummary & {
  phase: DiffReadPhase
  patch?: string
  truncated?: boolean
  refreshing?: boolean
  errorCode?: string
}

export interface ContinuousDiffSnapshot {
  epoch: number
  files: ContinuousDiffFile[]
  gitAvailable: boolean
  listLoading: boolean
  listTruncated: boolean
  listErrorCode?: string
}

interface DiffReadJob {
  request: number
  revision: string
  id: string
  path: string
  stage: WorkspaceChangeSummary['stage']
}

type ReadDiffFile = (path: string, stage: WorkspaceChangeSummary['stage']) => Promise<WorkspaceDiffFile>
type Listener = () => void

function getErrorCode(error: unknown) {
  if (typeof error !== 'object' || error === null || !('code' in error)) return 'UNKNOWN_ERROR'
  return typeof error.code === 'string' ? error.code : 'UNKNOWN_ERROR'
}

export class ContinuousDiffController {
  private activeReads = 0
  private currentEpoch = 0
  private disposed = false
  private active = true
  private workspaceId: string | undefined
  private listeners = new Set<Listener>()
  private queue: DiffReadJob[] = []
  private pending = new Map<string, number>()
  private requestSequence = 0
  private snapshot: ContinuousDiffSnapshot = {
    epoch: 0, files: [], gitAvailable: true, listLoading: true, listTruncated: false,
  }

  constructor(private readonly readDiffFile: ReadDiffFile) {}
  readonly getSnapshot = () => this.snapshot
  readonly subscribe = (listener: Listener) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  setActive(active: boolean) {
    this.active = active
    if (active && !this.disposed) this.drain()
  }

  dispose() {
    this.disposed = true
    this.currentEpoch += 1
    this.queue = []
    this.pending.clear()
    this.listeners.clear()
  }

  beginListLoad() {
    const epoch = ++this.currentEpoch
    // The previous document stays mounted while its summary is revalidated.
    this.snapshot = { ...this.snapshot, epoch, listLoading: true, listErrorCode: undefined }
    this.emit()
    return epoch
  }

  resolveList(epoch: number, result: WorkspaceDiffSnapshot, readInitial = true) {
    if (this.disposed || epoch !== this.currentEpoch) return false
    this.workspaceId = result.workspaceId
    const previous = new Map(this.snapshot.files.map((file) => [file.id, file]))
    const revalidate: string[] = []
    const files: ContinuousDiffFile[] = result.files.map((file) => {
      const cached = previous.get(file.id)
      if (cached && cached.revision === file.revision && !cached.errorCode) {
        if (cached.refreshing) revalidate.push(file.id)
        return cached
      }
      this.pending.delete(file.id)
      if (file.binary) return { ...file, phase: 'ready', patch: '', truncated: false }
      if (cached?.patch !== undefined) {
        revalidate.push(file.id)
        return { ...file, phase: 'ready', patch: cached.patch, truncated: cached.truncated, refreshing: true }
      }
      if (cached && cached.phase !== 'idle') revalidate.push(file.id)
      return { ...file, phase: 'idle' }
    })
    this.snapshot = {
      epoch, files, gitAvailable: result.gitAvailable, listLoading: false,
      listTruncated: result.truncated,
    }
    for (const id of this.pending.keys()) {
      if (!files.some((file) => file.id === id)) this.pending.delete(id)
    }
    this.emit()
    if (readInitial) this.request([...revalidate, ...files.filter((file) => !file.binary).slice(0, CONTINUOUS_DIFF_INITIAL_READ_COUNT).map((file) => file.id)])
    return true
  }

  rejectList(epoch: number, error: unknown) {
    if (this.disposed || epoch !== this.currentEpoch) return false
    this.snapshot = { ...this.snapshot, epoch, listLoading: false, listErrorCode: getErrorCode(error) }
    this.emit()
    return true
  }

  /** IDs distinguish staged and unstaged patches; a path requests both sections. */
  readonly request = (ids: string | readonly string[]) => {
    if (this.disposed) return
    const requested = new Set(typeof ids === 'string' ? [ids] : ids)
    const changes = new Map<string, ContinuousDiffFile>()
    for (const key of requested) {
      for (const file of this.snapshot.files) {
        if ((key !== file.id && key !== file.path) || file.binary || this.pending.has(file.id)) continue
        if (file.phase === 'ready' && !file.refreshing && !file.errorCode) continue
        const request = ++this.requestSequence
        this.queue.push({ request, revision: file.revision, id: file.id, path: file.path, stage: file.stage })
        this.pending.set(file.id, request)
        changes.set(file.id, file.patch === undefined ? { ...file, phase: 'queued', errorCode: undefined } : { ...file, refreshing: true, errorCode: undefined })
      }
    }
    if (changes.size === 0) return
    const files = this.snapshot.files.map((file) => changes.get(file.id) ?? file)
    this.snapshot = { ...this.snapshot, files }
    this.emit()
    this.drain()
  }

  private drain() {
    while (this.active && !this.disposed && this.activeReads < CONTINUOUS_DIFF_MAX_CONCURRENT_READS) {
      const job = this.queue.shift()
      if (!job) return
      if (this.pending.get(job.id) !== job.request) continue
      const file = this.snapshot.files.find((item) => item.id === job.id)
      if (!file) continue
      this.activeReads += 1
      this.replaceFile(job.id, (item) => item.patch === undefined ? { ...item, phase: 'loading' } : item)
      void this.readDiffFile(job.path, job.stage).then((result) => {
        if (!this.isCurrent(job)) return
        if (result.id !== job.id || result.path !== job.path || result.stage !== job.stage || result.workspaceId !== this.workspaceId) {
          throw { code: 'WORKSPACE_CONTENT_STALE_WORKSPACE' }
        }
        this.replaceFile(job.id, () => ({ ...result, phase: 'ready' }))
      }).catch((error) => {
        if (!this.isCurrent(job)) return
        this.replaceFile(job.id, (item) => ({
          ...item, phase: item.patch === undefined ? 'error' : 'ready', refreshing: false,
          errorCode: getErrorCode(error),
        }))
      }).finally(() => {
        if (this.pending.get(job.id) === job.request) this.pending.delete(job.id)
        this.activeReads -= 1
        this.drain()
      })
    }
  }

  private isCurrent(job: DiffReadJob) {
    return !this.disposed && this.pending.get(job.id) === job.request
      && this.snapshot.files.some((file) => file.id === job.id && file.revision === job.revision)
  }

  private replaceFile(id: string, replace: (file: ContinuousDiffFile) => ContinuousDiffFile) {
    let changed = false
    const files = this.snapshot.files.map((file) => {
      if (file.id !== id) return file
      changed = true
      return replace(file)
    })
    if (!changed) return
    this.snapshot = { ...this.snapshot, files }
    this.emit()
  }

  private emit() {
    for (const listener of this.listeners) listener()
  }
}
