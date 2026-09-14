import { describe, expect, it, vi } from 'vitest'
import {
  SESSION_CATALOG_MAX_CONCURRENT_READERS,
  SESSION_CATALOG_MAX_FILE_BYTES,
  SESSION_CATALOG_MAX_REFRESH_BYTES,
} from '../../src/shared/conversation-scope'
import { mapSessionReadBatches } from '../../src/main/conversations/official-pi-session-scan'

describe('catalog read slices', () => {
  it('continues after the byte budget instead of omitting later large sessions', async () => {
    const candidates = Array.from({ length: 11 }, (_, id) => ({ id, bytes: SESSION_CATALOG_MAX_FILE_BYTES }))
    const batches: number[][] = []
    const yieldContinuation = vi.fn(async () => undefined)
    const result = await mapSessionReadBatches(candidates, (candidate) => candidate.bytes, async (batch) => {
      expect(batch.length).toBeLessThanOrEqual(SESSION_CATALOG_MAX_CONCURRENT_READERS)
      expect(batch.reduce((total, item) => total + item.bytes, 0))
        .toBeLessThanOrEqual(SESSION_CATALOG_MAX_REFRESH_BYTES)
      batches.push(batch.map((candidate) => candidate.id))
      return batch.map((candidate) => candidate.id)
    }, yieldContinuation)
    expect(result).toEqual(candidates.map((candidate) => candidate.id))
    expect(batches.map((batch) => batch.length)).toEqual([4, 4, 3])
    expect(yieldContinuation).toHaveBeenCalledTimes(2)
  })

  it('keeps file concurrency bounded even when every metadata entry is cached', async () => {
    const candidates = Array.from({ length: 19 }, (_, id) => id)
    const sizes: number[] = []
    const result = await mapSessionReadBatches(candidates, () => 0, async (batch) => {
      sizes.push(batch.length)
      return batch
    }, async () => undefined)
    expect(result).toEqual(candidates)
    expect(sizes).toEqual([8, 8, 3])
  })
})
