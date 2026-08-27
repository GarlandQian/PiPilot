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

    const result = await loadOfficialSessionCatalog({ list, refresh }, scope, true)

    expect(refresh).toHaveBeenCalledOnce()
    expect(list).toHaveBeenCalledOnce()
    expect(result.rows.map((item) => item.sessionId)).toEqual(['session-1', 'session-2'])
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
