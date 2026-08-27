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

function summary(path: string, binary = false): WorkspaceChangeSummary {
  return {
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

  it('ignores an older epoch response even when the refreshed path is identical', async () => {
    const oldOperation = deferred<WorkspaceDiffFile>()
    const newOperation = deferred<WorkspaceDiffFile>()
    const operations = [oldOperation, newOperation]
    const read = vi.fn(() => operations.shift()!.promise)
    const controller = new ContinuousDiffController(read)

    const firstEpoch = controller.beginListLoad()
    controller.resolveList(firstEpoch, list(['same.ts']))
    const secondEpoch = controller.beginListLoad()
    controller.resolveList(secondEpoch, list(['same.ts']))
    expect(read).toHaveBeenCalledTimes(2)

    oldOperation.resolve(file('same.ts', 'old patch'))
    await flushPromises()
    expect(controller.getSnapshot()).toMatchObject({
      epoch: secondEpoch,
      files: [{ path: 'same.ts', phase: 'loading' }],
    })

    newOperation.resolve(file('same.ts', 'new patch'))
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
