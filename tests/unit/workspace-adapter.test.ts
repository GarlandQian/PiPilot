import { describe, expect, it, vi } from 'vitest'
import type {
  ConversationScope,
  OfficialPiSessionSummary,
  SessionCatalogListResult,
} from '../../src/shared/conversation-scope'
import { loadOfficialSessionCatalog } from '../../src/renderer/adapters/workspace-adapter'

const scope: ConversationScope = { kind: 'projectless' }

function row(index: number): OfficialPiSessionSummary {
  return {
    scope,
    sessionId: `session-${index}`,
    preview: `Prompt ${index}`,
    createdAt: '2026-08-08T00:00:00.000Z',
    modifiedAt: '2026-08-08T00:00:00.000Z',
    selectionToken: `sel_${String(index).padStart(2, '0')}${'a'.repeat(30)}`,
  }
}

function ready(
  rows: OfficialPiSessionSummary[],
  nextCursor: string | null,
): SessionCatalogListResult {
  return {
    status: 'ready',
    scope,
    rows,
    nextCursor,
    diagnostics: [],
  }
}

describe('workspace session catalog adapter', () => {
  it('loads every bounded page and preserves opaque row tokens', async () => {
    const list = vi.fn()
      .mockResolvedValueOnce(ready([row(1)], `cur_${'a'.repeat(32)}`))
      .mockResolvedValueOnce(ready([row(2)], null))
    const refresh = vi.fn()
      .mockResolvedValue(ready([row(0)], null))

    const result = await loadOfficialSessionCatalog({ list, refresh }, scope)

    expect(list).toHaveBeenNthCalledWith(1, scope)
    expect(list).toHaveBeenNthCalledWith(2, scope, `cur_${'a'.repeat(32)}`)
    expect(refresh).not.toHaveBeenCalled()
    expect(result.status).toBe('ready')
    expect(result.rows.map((item) => item.selectionToken)).toEqual([
      row(1).selectionToken,
      row(2).selectionToken,
    ])
  })

  it('uses refresh only for the first page and stops a cursor cycle', async () => {
    const cursor = `cur_${'b'.repeat(32)}`
    const list = vi.fn().mockResolvedValue(ready([row(2)], cursor))
    const refresh = vi.fn().mockResolvedValue(ready([row(1)], cursor))

    await expect(loadOfficialSessionCatalog({ list, refresh }, scope, true))
      .rejects.toThrow('repeated continuation cursor')

    expect(refresh).toHaveBeenCalledOnce()
    expect(list).toHaveBeenCalledOnce()
  })

  it('continues past four pages instead of truncating a directory at 200 sessions', async () => {
    const allRows = Array.from({ length: 251 }, (_, index) => row(index))
    const list = vi.fn(async (_scope: ConversationScope, cursor?: string) => {
      const start = cursor ? Number(cursor.slice(4)) : 0
      const end = Math.min(start + 50, allRows.length)
      return ready(allRows.slice(start, end), end < allRows.length ? `cur_${end}` : null)
    })
    const result = await loadOfficialSessionCatalog({ list, refresh: vi.fn() }, scope)
    expect(result.rows).toEqual(allRows)
    expect(list).toHaveBeenCalledTimes(6)
  })

  it('rejects a response for another conversation scope', async () => {
    const list = vi.fn().mockResolvedValue({
      ...ready([], null),
      scope: { kind: 'project', workspaceId: '11111111-1111-4111-8111-111111111111' },
    })

    await expect(loadOfficialSessionCatalog({
      list,
      refresh: vi.fn(),
    }, scope)).rejects.toThrow('another conversation scope')
  })
})
