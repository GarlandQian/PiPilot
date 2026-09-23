import { describe, expect, it, vi } from 'vitest'
import {
  CONTINUOUS_DIFF_MAX_CONCURRENT_READS,
  ContinuousDiffController,
} from '../../src/components/inspector/continuous-diff-controller'
import type {
  WorkspaceChangeSummary,
  WorkspaceDiffFile,
  WorkspaceDiffSnapshot,
} from '../../src/shared/workspace-content'

const workspaceId = '11111111-1111-4111-8111-111111111111'

function summary(path: string, binary = false, stage: 'staged' | 'unstaged' = 'unstaged'): WorkspaceChangeSummary {
  return {
    id: `${stage}:${path}`,
    stage,
    revision: 'a'.repeat(64),
    path,
    status: 'modified',
    added: 1,
    deleted: 1,
    binary,
  }
}

function list(
  paths: Array<string | { path: string; binary: true }>,
  truncated = false,
): WorkspaceDiffSnapshot {
  return {
    workspaceId,
    gitAvailable: true,
    branch: 'main',
    files: paths.map((entry) => (
      typeof entry === 'string' ? summary(entry) : summary(entry.path, entry.binary)
    )),
    truncated,
  }
}

function file(path: string, patch = `diff --git a/${path} b/${path}\n@@ -1 +1 @@\n-old\n+new\n`): WorkspaceDiffFile {
  return {
    workspaceId,
    ...summary(path),
    patch,
    truncated: false,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

async function flushPromises() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

describe('continuous diff controller', () => {
  it('loads the first files and visible requests through a three-wide FIFO', async () => {
    const pending = new Map<string, ReturnType<typeof deferred<WorkspaceDiffFile>>>()
    let active = 0
    let maximumActive = 0
    const read = vi.fn((path: string) => {
      const operation = deferred<WorkspaceDiffFile>()
      pending.set(path, operation)
      active += 1
      maximumActive = Math.max(maximumActive, active)
      return operation.promise.finally(() => {
        active -= 1
      })
    })
    const controller = new ContinuousDiffController(read)
    const epoch = controller.beginListLoad()
    controller.resolveList(epoch, list(['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts']))

    expect(read.mock.calls.map(([path]) => path)).toEqual(['a.ts', 'b.ts', 'c.ts'])
    expect(controller.getSnapshot().files.map((entry) => entry.phase)).toEqual([
      'loading',
      'loading',
      'loading',
      'idle',
      'idle',
    ])

    controller.request(['e.ts', 'd.ts'])
    expect(controller.getSnapshot().files.slice(3).map((entry) => entry.phase)).toEqual([
      'queued',
      'queued',
    ])

    pending.get('a.ts')?.resolve(file('a.ts'))
    await flushPromises()
    expect(read.mock.calls.map(([path]) => path)).toEqual(['a.ts', 'b.ts', 'c.ts', 'e.ts'])

    pending.get('b.ts')?.resolve(file('b.ts'))
    await flushPromises()
    expect(read.mock.calls.map(([path]) => path)).toEqual([
      'a.ts',
      'b.ts',
      'c.ts',
      'e.ts',
      'd.ts',
    ])
    expect(maximumActive).toBe(CONTINUOUS_DIFF_MAX_CONCURRENT_READS)

    for (const [path, operation] of pending) operation.resolve(file(path))
    await flushPromises()
  })

  it('ignores a superseded revision response even when the refreshed path is identical', async () => {
    const oldOperation = deferred<WorkspaceDiffFile>()
    const newOperation = deferred<WorkspaceDiffFile>()
    const operations = [oldOperation, newOperation]
    const read = vi.fn(() => operations.shift()!.promise)
    const controller = new ContinuousDiffController(read)

    const firstEpoch = controller.beginListLoad()
    controller.resolveList(firstEpoch, list(['same.ts']))
    const secondEpoch = controller.beginListLoad()
    const changed = list(['same.ts'])
    changed.files[0].revision = 'b'.repeat(64)
    controller.resolveList(secondEpoch, changed)
    expect(read).toHaveBeenCalledTimes(2)

    oldOperation.resolve(file('same.ts', 'old patch'))
    await flushPromises()
    expect(controller.getSnapshot()).toMatchObject({
      epoch: secondEpoch,
      files: [{ path: 'same.ts', phase: 'loading' }],
    })

    newOperation.resolve({ ...file('same.ts', 'new patch'), revision: 'b'.repeat(64) })
    await flushPromises()
    expect(controller.getSnapshot().files[0]).toMatchObject({
      path: 'same.ts',
      phase: 'ready',
      patch: 'new patch',
    })
  })

  it('keeps read failures local and retries only the failed path', async () => {
    const read = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('read failed'), { code: 'READ_FAILED' }))
      .mockResolvedValueOnce(file('retry.ts'))
    const controller = new ContinuousDiffController(read)
    const epoch = controller.beginListLoad()
    controller.resolveList(epoch, list(['retry.ts']))
    await flushPromises()

    expect(controller.getSnapshot().files[0]).toMatchObject({
      path: 'retry.ts',
      phase: 'error',
      errorCode: 'READ_FAILED',
    })

    controller.request('retry.ts')
    await flushPromises()
    expect(read).toHaveBeenCalledTimes(2)
    expect(controller.getSnapshot().files[0]).toMatchObject({
      path: 'retry.ts',
      phase: 'ready',
    })
  })

  it('renders binary summaries without a read and preserves list truncation', () => {
    const read = vi.fn()
    const controller = new ContinuousDiffController(read)
    const epoch = controller.beginListLoad()
    controller.resolveList(epoch, list([{ path: 'asset.bin', binary: true }], true))

    expect(read).not.toHaveBeenCalled()
    expect(controller.getSnapshot()).toMatchObject({
      listTruncated: true,
      files: [{
        path: 'asset.bin',
        binary: true,
        phase: 'ready',
        patch: '',
      }],
    })
  })

  it('preserves an unchanged reading surface and pending reads across background list refreshes', async () => {
    const pending = deferred<WorkspaceDiffFile>()
    const read = vi.fn(() => pending.promise)
    const controller = new ContinuousDiffController(read)
    controller.resolveList(controller.beginListLoad(), list(['same.ts']))
    const loadingFile = controller.getSnapshot().files[0]
    controller.resolveList(controller.beginListLoad(), list(['same.ts']))
    expect(controller.getSnapshot().files[0]).toBe(loadingFile)
    expect(read).toHaveBeenCalledTimes(1)
    pending.resolve(file('same.ts'))
    await flushPromises()
    const readyFile = controller.getSnapshot().files[0]
    const epoch = controller.beginListLoad()
    expect(controller.getSnapshot().files[0]).toBe(readyFile)
    controller.resolveList(epoch, list(['same.ts']))
    expect(controller.getSnapshot().files[0]).toBe(readyFile)
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('retains the previous patch during a changed revision refresh and a failed refresh', async () => {
    const pending = deferred<WorkspaceDiffFile>()
    const read = vi.fn().mockResolvedValueOnce(file('same.ts', 'old patch')).mockReturnValueOnce(pending.promise)
    const controller = new ContinuousDiffController(read)
    controller.resolveList(controller.beginListLoad(), list(['same.ts']))
    await flushPromises()
    const changed = list(['same.ts'])
    changed.files[0].revision = 'b'.repeat(64)
    controller.resolveList(controller.beginListLoad(), changed)
    expect(controller.getSnapshot().files[0]).toMatchObject({ phase: 'ready', patch: 'old patch', refreshing: true })
    pending.reject({ code: 'READ_FAILED' })
    await flushPromises()
    expect(controller.getSnapshot().files[0]).toMatchObject({ phase: 'ready', patch: 'old patch', errorCode: 'READ_FAILED' })
    controller.rejectList(controller.beginListLoad(), { code: 'LIST_FAILED' })
    expect(controller.getSnapshot()).toMatchObject({ files: [{ patch: 'old patch' }], listErrorCode: 'LIST_FAILED' })
  })

  it('requeues a visible later file when its revision changes while its patch is still loading', async () => {
    const previous = deferred<WorkspaceDiffFile>()
    const next = deferred<WorkspaceDiffFile>()
    let laterReads = 0
    const read = vi.fn((path: string) => path === 'd.ts'
      ? (++laterReads === 1 ? previous.promise : next.promise)
      : Promise.resolve(file(path)))
    const controller = new ContinuousDiffController(read)
    controller.resolveList(controller.beginListLoad(), list(['a.ts', 'b.ts', 'c.ts', 'd.ts']))
    await flushPromises()
    controller.request('d.ts')
    const changed = list(['a.ts', 'b.ts', 'c.ts', 'd.ts'])
    changed.files[3].revision = 'b'.repeat(64)
    controller.resolveList(controller.beginListLoad(), changed)
    expect(laterReads).toBe(2)
    previous.resolve(file('d.ts', 'stale'))
    next.resolve({ ...file('d.ts', 'fresh'), revision: 'b'.repeat(64) })
    await flushPromises()
    expect(controller.getSnapshot().files[3]).toMatchObject({ phase: 'ready', patch: 'fresh' })
  })

  it('keeps staged and unstaged versions of one path independent and defers hidden diff reads', async () => {
    const read = vi.fn(async (path: string, stage: 'staged' | 'unstaged') => ({ ...file(path, stage), ...summary(path, false, stage) }))
    const controller = new ContinuousDiffController(read)
    const snapshot = { ...list([]), files: [summary('same.ts', false, 'staged'), summary('same.ts')] }
    controller.resolveList(controller.beginListLoad(), snapshot, false)
    expect(read).not.toHaveBeenCalled()
    controller.request('staged:same.ts')
    await flushPromises()
    expect(read.mock.calls).toEqual([['same.ts', 'staged']])
    expect(controller.getSnapshot().files.map((entry) => entry.phase)).toEqual(['ready', 'idle'])
    controller.request('unstaged:same.ts')
    await flushPromises()
    expect(controller.getSnapshot().files.map((entry) => entry.patch)).toEqual(['staged', 'unstaged'])
  })

  it('pauses queued reads while hidden, including a list that completes after hiding', async () => {
    const pending = deferred<WorkspaceDiffFile>()
    const read = vi.fn((path: string) => path === 'a.ts' ? pending.promise : Promise.resolve(file(path)))
    const controller = new ContinuousDiffController(read)
    controller.setActive(false)
    controller.resolveList(controller.beginListLoad(), list(['a.ts', 'b.ts', 'c.ts', 'd.ts']), false)
    expect(read).not.toHaveBeenCalled()
    controller.setActive(true)
    controller.request(['a.ts', 'b.ts', 'c.ts', 'd.ts'])
    controller.setActive(false)
    await flushPromises()
    expect(read.mock.calls.map(([path]) => path)).toEqual(['a.ts', 'b.ts', 'c.ts'])
    pending.resolve(file('a.ts'))
    await flushPromises()
    expect(read).toHaveBeenCalledTimes(3)
    controller.setActive(true)
    await flushPromises()
    expect(read.mock.calls.map(([path]) => path)).toEqual(['a.ts', 'b.ts', 'c.ts', 'd.ts'])
  })

  it('invalidates in-flight reads and queued work when disposed', async () => {
    const operation = deferred<WorkspaceDiffFile>()
    const read = vi.fn(() => operation.promise)
    const listener = vi.fn()
    const controller = new ContinuousDiffController(read)
    const epoch = controller.beginListLoad()
    controller.resolveList(epoch, list(['late.ts']))
    const loadingSnapshot = controller.getSnapshot()
    controller.subscribe(listener)

    controller.dispose()
    operation.resolve(file('late.ts', 'late patch'))
    await flushPromises()

    expect(controller.getSnapshot()).toBe(loadingSnapshot)
    expect(controller.getSnapshot().files[0]).toMatchObject({
      path: 'late.ts',
      phase: 'loading',
    })
    expect(listener).not.toHaveBeenCalled()
  })
})
