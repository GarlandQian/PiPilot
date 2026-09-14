import { opendir } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import {
  SESSION_CATALOG_MAX_CONCURRENT_READERS,
  SESSION_CATALOG_MAX_REFRESH_BYTES,
  SESSION_CATALOG_MAX_SCAN_ENTRIES,
} from '../../shared/conversation-scope'

export const SESSION_CATALOG_SCAN_SLICE_MS = 250

export function yieldCatalogScan() {
  return new Promise<void>((resume) => { setTimeout(resume, 0) })
}

/** Keep the directory iterator open across slices instead of restarting at 0. */
export async function* readSessionDirectoryBatches(
  root: string,
  yieldContinuation: () => Promise<void>,
) {
  const directory = await opendir(root)
  let batch: Dirent[] = []
  let startedAt = performance.now()
  for await (const entry of directory) {
    batch.push(entry)
    if (
      batch.length < SESSION_CATALOG_MAX_SCAN_ENTRIES &&
      performance.now() - startedAt < SESSION_CATALOG_SCAN_SLICE_MS
    ) continue
    yield batch
    batch = []
    await yieldContinuation()
    startedAt = performance.now()
  }
  if (batch.length > 0) yield batch
}

/**
 * Admission uses the actual bytes to read (zero for metadata cache hits).
 * Every batch has a fresh byte budget and a bounded number of file handles.
 * A large directory therefore continues across slices without dropping rows
 * just because an earlier filename consumed the refresh budget.
 */
export async function mapSessionReadBatches<T, TResult>(
  candidates: readonly T[],
  readBytes: (candidate: T) => number,
  readBatch: (batch: readonly T[]) => Promise<readonly TResult[]>,
  yieldContinuation: () => Promise<void>,
): Promise<TResult[]> {
  const results: TResult[] = []
  let batch: T[] = []
  let admittedBytes = 0
  const flush = async () => {
    results.push(...await readBatch(batch))
    batch = []
    admittedBytes = 0
  }
  for (const candidate of candidates) {
    const size = readBytes(candidate)
    if (size < 0 || size > SESSION_CATALOG_MAX_REFRESH_BYTES) {
      throw new Error('A catalog candidate exceeds the read slice budget.')
    }
    if (batch.length > 0 && (
      batch.length >= SESSION_CATALOG_MAX_CONCURRENT_READERS ||
      admittedBytes + size > SESSION_CATALOG_MAX_REFRESH_BYTES
    )) {
      await flush()
      await yieldContinuation()
    }
    batch.push(candidate)
    admittedBytes += size
  }
  if (batch.length > 0) await flush()
  return results
}
