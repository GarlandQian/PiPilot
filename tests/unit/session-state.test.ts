import { describe, expect, it } from 'vitest'
import type {
  ConversationScope,
  OfficialPiSessionSummary,
} from '../../src/shared/conversation-scope'
import {
  deriveOfficialSessionState,
  paginateSessions,
  sameConversationScope,
  sessionPageForId,
} from '../../src/store/workspace-state'

const projectScope: ConversationScope = {
  kind: 'project',
  workspaceId: '11111111-1111-4111-8111-111111111111',
}

function session(
  id: string,
  token: string,
  modifiedAt: string,
  overrides: Partial<OfficialPiSessionSummary> = {},
): OfficialPiSessionSummary {
  return {
    scope: projectScope,
    sessionId: id,
    preview: `First ${id}`,
    createdAt: '2026-08-08T00:00:00.000Z',
    modifiedAt,
    selectionToken: `sel_${token}`,
    ...overrides,
  }
}

describe('workspace session state', () => {
  it('maps official rows, sorts by activity, and preserves the active identity', () => {
    const result = deriveOfficialSessionState([
      session('active', 'a'.repeat(32), '2026-08-08T03:00:00.000Z'),
      session('older', 'b'.repeat(32), '2026-08-08T01:00:00.000Z', {
        name: 'Named session',
      }),
      session('recent', 'c'.repeat(32), '2026-08-08T02:00:00.000Z'),
    ], 'workspace', 'active')

    expect(result.activeId).toBe('active')
    expect(result.sessions.map((item) => item.id)).toEqual([
      'active',
      'recent',
      'older',
    ])
    expect(result.sessions[0]).toMatchObject({
      title: 'First active',
      repo: 'workspace',
      selectionToken: `sel_${'a'.repeat(32)}`,
    })
    expect(result.sessions[2].title).toBe('Named session')
  })

  it('keeps duplicate official session IDs distinct through selection tokens', () => {
    const result = deriveOfficialSessionState([
      session('same-id', 'a'.repeat(32), '2026-08-08T01:00:00.000Z'),
      session('same-id', 'b'.repeat(32), '2026-08-08T02:00:00.000Z'),
    ], '', 'same-id')

    expect(result.sessions).toHaveLength(2)
    expect(result.sessions.map((item) => item.selectionToken)).toEqual([
      `sel_${'b'.repeat(32)}`,
      `sel_${'a'.repeat(32)}`,
    ])
    expect(result.activeId).toBe('same-id')
  })

  it('uses an empty active identity when the current session is not catalogued', () => {
    expect(deriveOfficialSessionState([], 'workspace', 'missing')).toEqual({
      sessions: [],
      activeId: '',
    })
  })

  it('compares project and projectless scopes without accepting widened shapes', () => {
    expect(sameConversationScope(
      { kind: 'projectless' },
      { kind: 'projectless' },
    )).toBe(true)
    expect(sameConversationScope(projectScope, {
      kind: 'project',
      workspaceId: projectScope.workspaceId,
    })).toBe(true)
    expect(sameConversationScope(projectScope, { kind: 'projectless' })).toBe(false)
  })

  it('keeps large session lists on bounded pages and locates the active page', () => {
    const sessions = Array.from({ length: 125 }, (_, index) => ({
      id: `session-${index}`,
    }))

    expect(sessionPageForId(sessions, 'session-87')).toBe(1)
    expect(sessionPageForId(sessions, 'missing')).toBe(0)
    expect(paginateSessions(sessions, 1)).toMatchObject({
      page: 1,
      pageCount: 3,
      items: sessions.slice(50, 100),
    })
    expect(paginateSessions(sessions, 99)).toMatchObject({
      page: 2,
      pageCount: 3,
      items: sessions.slice(100),
    })
  })
})
