import { createHash } from 'node:crypto'
import { open } from 'node:fs/promises'
import type { ConfigApplyStatus } from '../../shared/config-apply'
import type { PiRuntimeFrontend } from '../pi-host/pi-runtime-frontend'
import { runtimeConfigurationKey } from '../pi-host/runtime-configuration'

interface ConfigApplyRevision {
  path: string
  fingerprint: string
  cwd?: string
}

interface ApplyJob extends ConfigApplyRevision {
  confirmed: Map<string, number>
  status: ConfigApplyStatus
  inFlight?: Promise<ConfigApplyStatus>
}

const MAX_RETAINED_TARGETS = 256
const MAX_CONFIG_BYTES = 1024 * 1024

export function configApplySaveFields(status: ConfigApplyStatus) {
  return {
    apply: status.state === 'superseded' ? 'failed' as const : status.state,
    ...(status.state === 'failed' || status.state === 'superseded'
      ? { applyError: status.reason === 'interaction-required'
          ? 'The configuration was saved, but reload required interactive extension setup. New reload dialogs were cancelled; existing work was not interrupted.'
          : status.state === 'superseded'
          ? 'The saved configuration changed before application could be confirmed. Reload and apply the current document.'
          : 'The configuration was saved, but could not be applied to every affected runtime. Retry application.' }
      : {}),
  }
}

/** Saved documents outlive selection. Only compatible revisions share an apply job. */
export class ConfigApplyCoordinator {
  private readonly jobs = new Map<string, ApplyJob>()
  private readonly detach: () => void
  private disposed = false
  private scheduled = false

  constructor(private readonly runtime: Pick<
    PiRuntimeFrontend,
    'applyConfiguration' | 'subscribeControlRuntimes'
  >) {
    this.detach = runtime.subscribeControlRuntimes(() => this.schedulePending())
  }

  getStatus(path: string, fingerprint?: string): ConfigApplyStatus | undefined {
    const job = this.jobs.get(path)
    if (job && fingerprint !== undefined && job.fingerprint !== fingerprint) {
      job.status = { ...job.status, state: 'superseded' }
    }
    const status = job?.status
    return status ? { ...status } : undefined
  }

  async apply(revision: ConfigApplyRevision): Promise<ConfigApplyStatus> {
    let job = this.jobs.get(revision.path)
    if (!job && this.jobs.size >= MAX_RETAINED_TARGETS) {
      this.pruneCompleted(MAX_RETAINED_TARGETS - 1)
      if (this.jobs.size >= MAX_RETAINED_TARGETS) {
        return { fingerprint: revision.fingerprint, state: 'failed', total: 0, applied: 0, failed: 0 }
      }
    }
    if (!job || job.fingerprint !== revision.fingerprint || job.cwd !== revision.cwd) {
      job = {
        ...revision,
        confirmed: new Map(),
        status: {
          fingerprint: revision.fingerprint,
          state: 'pending',
          total: 0,
          applied: 0,
          failed: 0,
        },
      }
      this.jobs.set(revision.path, job)
      this.pruneCompleted()
    }
    return this.attempt(job)
  }

  async retryPending(): Promise<ConfigApplyStatus[]> {
    return Promise.all([...this.jobs.values()]
      .filter((job) => job.status.state !== 'applied')
      .map((job) => this.attempt(job)))
  }

  dispose(): void {
    this.disposed = true
    this.detach()
    this.jobs.clear()
  }

  private attempt(job: ApplyJob): Promise<ConfigApplyStatus> {
    if (job.inFlight) return job.inFlight
    const operation = this.run(job)
    job.inFlight = operation
    void operation.finally(() => {
      if (job.inFlight === operation) job.inFlight = undefined
      if (this.jobs.get(job.path) !== job) this.schedulePending()
    })
    return operation
  }

  private async run(job: ApplyJob): Promise<ConfigApplyStatus> {
    const observed = new Set<string>()
    try {
      const { retryAfter, ...result } = await this.runtime.applyConfiguration({
        ...(job.cwd === undefined ? {} : { cwd: job.cwd }),
        isCurrent: () => this.isCurrent(job),
        isApplied: (identity) => {
          const key = runtimeConfigurationKey(identity)
          observed.add(key)
          return job.confirmed.get(key) === identity.generation
        },
        didApply: (identity) => {
          const key = runtimeConfigurationKey(identity)
          observed.add(key)
          job.confirmed.set(key, identity.generation)
        },
      })
      job.status = { fingerprint: job.fingerprint, ...result }
      if (retryAfter) {
        void retryAfter.then(() => {
          setImmediate(() => {
            if (!this.disposed && this.jobs.get(job.path) === job &&
                job.status.state === 'pending' && !job.inFlight) void this.attempt(job)
          })
        })
      }
      if (result.state !== 'pending' && result.total === observed.size) {
        for (const key of job.confirmed.keys()) {
          if (!observed.has(key)) job.confirmed.delete(key)
        }
      }
    } catch {
      job.status = { ...job.status, state: 'failed', failed: Math.max(1, job.status.failed) }
    }
    return { ...job.status }
  }

  private async isCurrent(job: ApplyJob): Promise<boolean> {
    if (this.disposed || this.jobs.get(job.path) !== job) return false
    try {
      const handle = await open(job.path, 'r')
      try {
        const details = await handle.stat()
        if (!details.isFile() || details.size > MAX_CONFIG_BYTES) return false
        const content = Buffer.alloc(MAX_CONFIG_BYTES + 1)
        const { bytesRead } = await handle.read(content, 0, content.length, 0)
        return bytesRead <= MAX_CONFIG_BYTES &&
          createHash('sha256').update(content.subarray(0, bytesRead)).digest('hex') === job.fingerprint &&
          !this.disposed && this.jobs.get(job.path) === job
      } finally {
        await handle.close()
      }
    } catch {
      return false
    }
  }

  private schedulePending(): void {
    if (this.disposed || this.scheduled) return
    this.scheduled = true
    // Do not retain Host event credit while an apply performs SDK requests.
    setImmediate(() => {
      this.scheduled = false
      if (this.disposed) return
      for (const job of this.jobs.values()) {
        if (job.status.state === 'pending' && !job.inFlight) void this.attempt(job)
      }
    })
  }

  private pruneCompleted(limit = MAX_RETAINED_TARGETS): void {
    for (const [path, job] of this.jobs) {
      if (this.jobs.size <= limit) break
      if (!job.inFlight && !['pending', 'failed'].includes(job.status.state)) this.jobs.delete(path)
    }
  }
}
