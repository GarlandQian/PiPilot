import type {
  WorkspaceChangeSummary,
  WorkspaceDiffFile,
  WorkspaceDiffSnapshot,
} from '@/shared/workspace-content'

export const CONTINUOUS_DIFF_MAX_CONCURRENT_READS = 3
export const CONTINUOUS_DIFF_INITIAL_READ_COUNT = 3

export type DiffReadPhase = 'idle' | 'queued' | 'loading' | 'ready' | 'error'

type PendingDiffViewerFile = WorkspaceChangeSummary & {
  phase: 'idle' | 'queued' | 'loading'
}

type ReadyDiffViewerFile = WorkspaceChangeSummary & {
  phase: 'ready'
  patch: string
  truncated: boolean
}

type ErrorDiffViewerFile = WorkspaceChangeSummary & {
  phase: 'error'
  errorCode: string
}

export type ContinuousDiffFile =
  | PendingDiffViewerFile
  | ReadyDiffViewerFile
  | ErrorDiffViewerFile

export interface ContinuousDiffSnapshot {
  epoch: number
  files: ContinuousDiffFile[]
  gitAvailable: boolean
  listLoading: boolean
  listTruncated: boolean
  listErrorCode?: string
}

interface DiffReadJob {
  epoch: number
  path: string
}

type ReadDiffFile = (path: string) => Promise<WorkspaceDiffFile>
type Listener = () => void

function getErrorCode(error: unknown) {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return 'UNKNOWN_ERROR'
  }
  return typeof error.code === 'string' ? error.code : 'UNKNOWN_ERROR'
}

function createInitialSnapshot(): ContinuousDiffSnapshot {
  return {
    epoch: 0,
    files: [],
    gitAvailable: true,
    listLoading: true,
    listTruncated: false,
  }
}

export class ContinuousDiffController {
  private activeReads = 0
  private currentEpoch = 0
  private listeners = new Set<Listener>()
  private queue: DiffReadJob[] = []
  private snapshot = createInitialSnapshot()

  constructor(private readonly readDiffFile: ReadDiffFile) {}

  readonly getSnapshot = () => this.snapshot

  readonly subscribe = (listener: Listener) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  dispose() {
    this.currentEpoch += 1
    this.queue = []
    this.listeners.clear()
  }

  beginListLoad() {
    const epoch = ++this.currentEpoch
    this.queue = []
    this.snapshot = {
      epoch,
      files: [],
      gitAvailable: true,
      listLoading: true,
      listTruncated: false,
    }
    this.emit()
    return epoch
  }

  resolveList(epoch: number, result: WorkspaceDiffSnapshot) {
    if (epoch !== this.currentEpoch) return false

    const files: ContinuousDiffFile[] = result.files.map((file) => (
      file.binary
        ? { ...file, phase: 'ready', patch: '', truncated: false }
        : { ...file, phase: 'idle' }
    ))
    this.snapshot = {
      epoch,
      files,
      gitAvailable: result.gitAvailable,
      listLoading: false,
      listTruncated: result.truncated,
    }
    this.emit()

    const initialPaths: string[] = []
    for (const file of files) {
      if (file.binary) continue
      initialPaths.push(file.path)
      if (initialPaths.length === CONTINUOUS_DIFF_INITIAL_READ_COUNT) break
    }
    this.request(initialPaths)
    return true
  }

  rejectList(epoch: number, error: unknown) {
    if (epoch !== this.currentEpoch) return false
    this.snapshot = {
      epoch,
      files: [],
      gitAvailable: true,
      listLoading: false,
      listTruncated: false,
      listErrorCode: getErrorCode(error),
    }
    this.emit()
    return true
  }

  readonly request = (paths: string | readonly string[]) => {
    const requestedPaths = typeof paths === 'string' ? [paths] : paths
    const requested = [...new Set(requestedPaths)]
    if (requested.length === 0) return

    let changed = false
    const files = [...this.snapshot.files]
    for (const path of requested) {
      const index = files.findIndex((file) => file.path === path)
      const file = files[index]
      if (!file || file.binary) continue
      if (file.phase !== 'idle' && file.phase !== 'error') continue
      this.queue.push({ epoch: this.currentEpoch, path: file.path })
      changed = true
      files[index] = { ...file, phase: 'queued' }
    }
    if (!changed) return

    this.snapshot = { ...this.snapshot, files }
    this.emit()
    this.drain()
  }

  private drain() {
    while (this.activeReads < CONTINUOUS_DIFF_MAX_CONCURRENT_READS) {
      const job = this.queue.shift()
      if (!job) return
      if (job.epoch !== this.currentEpoch) continue

      const file = this.snapshot.files.find((item) => item.path === job.path)
      if (!file || file.phase !== 'queued') continue

      this.activeReads += 1
      this.replaceFile(job.path, (item) => ({ ...item, phase: 'loading' }))
      void this.readDiffFile(job.path)
        .then((result) => {
          if (job.epoch !== this.currentEpoch) return
          if (result.path !== job.path) {
            throw Object.assign(new Error('Diff response path mismatch.'), {
              code: 'WORKSPACE_CONTENT_STALE_WORKSPACE',
            })
          }
          this.replaceFile(job.path, () => ({
            ...result,
            phase: 'ready',
          }))
        })
        .catch((error) => {
          if (job.epoch !== this.currentEpoch) return
          this.replaceFile(job.path, (item) => ({
            ...item,
            phase: 'error',
            errorCode: getErrorCode(error),
          }))
        })
        .finally(() => {
          this.activeReads -= 1
          this.drain()
        })
    }
  }

  private replaceFile(
    path: string,
    replace: (file: ContinuousDiffFile) => ContinuousDiffFile,
  ) {
    let changed = false
    const files = this.snapshot.files.map((file) => {
      if (file.path !== path) return file
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
