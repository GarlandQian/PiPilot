import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { ConversationScope } from '../../src/shared/conversation-scope'
import { conversationScopeKey } from '../../src/main/conversations/conversation-scope-resolver'
import type {
  OfficialPiSessionControlTarget,
  OfficialPiSessionControlTargetListResult,
} from '../../src/main/conversations/official-pi-session-catalog'
import {
  ConversationMcpInventoryService,
} from '../../src/main/external-control/conversation-inventory'
import type { PiRuntimeControlSummary } from '../../src/main/pi-host/pi-runtime-frontend'

const workspaceId = '00000000-0000-4000-8000-000000000501'
const unavailableWorkspaceId = '00000000-0000-4000-8000-000000000502'
const projectScope = {
  kind: 'project',
  workspaceId,
} as const satisfies ConversationScope
const projectlessScope = { kind: 'projectless' } as const satisfies ConversationScope

function controlTarget(
  sessionFile: string,
  sessionId: string,
  modifiedAt: string,
): OfficialPiSessionControlTarget {
  return {
    scope: projectScope,
    cwd: '/projects/alpha',
    sessionId,
    sessionFile,
    mode: 'open',
    name: `Conversation ${sessionId}`,
    createdAt: '2026-08-20T00:00:00.000Z',
    modifiedAt,
    root: '/sessions',
    headerIdentity: `header-${sessionId}`,
    contentDigest: `digest-${sessionId}`,
    identity: {
      dev: 1,
      ino: Number(sessionId.replace(/\D/gu, '')) || 1,
      size: 100,
      mtimeMs: 1,
      ctimeMs: 1,
    },
  }
}

class FakeCatalog {
  readonly results = new Map<string, OfficialPiSessionControlTargetListResult>()
  readonly listControlTargets = vi.fn(async (scope: ConversationScope) => {
    const result = this.results.get(conversationScopeKey(scope))
    if (!result) throw new Error('Missing catalog fixture.')
    return structuredClone(result)
  })
  readonly revalidateControlTarget = vi.fn(async (
    target: OfficialPiSessionControlTarget,
  ) => structuredClone(target))
}

function createHarness() {
  const catalog = new FakeCatalog()
  const runtimes: PiRuntimeControlSummary[] = []
  const workspaceSnapshot = {
    revision: 7,
    recent: [
      {
        id: workspaceId,
        name: 'Alpha',
        lastOpenedAt: '2026-08-21T00:00:00.000Z',
        pinned: true,
        available: true,
      },
      {
        id: unavailableWorkspaceId,
        name: 'Offline',
        lastOpenedAt: '2026-08-20T00:00:00.000Z',
        pinned: false,
        available: false,
      },
    ],
  }
  const service = new ConversationMcpInventoryService(
    { get: () => structuredClone(workspaceSnapshot) },
    catalog,
    { listControlRuntimes: () => structuredClone(runtimes) },
    {
      conversationId(scopeKey, sessionFile) {
        return `conv_${createHash('sha256')
          .update(`${scopeKey}\0${sessionFile}`)
          .digest('base64url')}`
      },
    },
    {
      createCursorId: () => 'c'.repeat(32),
      now: () => Date.parse('2026-08-22T00:00:00.000Z'),
    },
  )
  catalog.results.set(conversationScopeKey(projectlessScope), {
    status: 'notLoaded',
    scope: projectlessScope,
    revision: 0,
    targets: [],
    diagnostics: [],
  })
  return { catalog, runtimes, service, workspaceSnapshot }
}

describe('ConversationMcpInventoryService', () => {
  it('merges catalog and exact Runtime state without exposing Main targets', async () => {
    const { catalog, runtimes, service } = createHarness()
    const inactive = controlTarget(
      '/sessions/inactive.jsonl',
      'session-1',
      '2026-08-21T01:00:00.000Z',
    )
    const queued = controlTarget(
      '/sessions/queued.jsonl',
      'session-2',
      '2026-08-21T02:00:00.000Z',
    )
    catalog.results.set(conversationScopeKey(projectScope), {
      status: 'ready',
      scope: projectScope,
      revision: 3,
      targets: [inactive, queued],
      diagnostics: [],
    })
    runtimes.push({
      hostEpoch: 4,
      runtimeId: 'rt_queued',
      generation: 2,
      scope: projectScope,
      sessionFile: queued.sessionFile,
      sessionId: queued.sessionId,
      selected: false,
      lifecycle: 'queued',
      queueCount: 2,
      activity: 'prompt',
    })

    const result = await service.listConversations({ limit: 50 })

    expect(result.conversations).toHaveLength(2)
    expect(result.conversations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'Conversation session-1',
        project: 'Alpha',
        lifecycle: 'inactive',
      }),
      expect.objectContaining({
        name: 'Conversation session-2',
        lifecycle: 'queued',
        queueCount: 2,
        activity: 'prompt',
      }),
    ]))
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      { scope: 'Projectless', status: 'not_loaded' },
      { scope: 'Offline', status: 'unavailable' },
    ]))
    expect(JSON.stringify(result)).not.toContain('/sessions/')
    expect(JSON.stringify(result)).not.toContain('selectionToken')
    expect(catalog.revalidateControlTarget).not.toHaveBeenCalled()
  })

  it('pages one coherent inventory revision and rejects a stale cursor', async () => {
    const { catalog, service } = createHarness()
    const first = controlTarget(
      '/sessions/first.jsonl',
      'session-1',
      '2026-08-21T01:00:00.000Z',
    )
    const second = controlTarget(
      '/sessions/second.jsonl',
      'session-2',
      '2026-08-21T02:00:00.000Z',
    )
    catalog.results.set(conversationScopeKey(projectScope), {
      status: 'ready',
      scope: projectScope,
      revision: 1,
      targets: [first, second],
      diagnostics: [],
    })

    const page = await service.listConversations({ limit: 1 })
    expect(page.conversations).toHaveLength(1)
    expect(page.nextCursor).not.toBeNull()

    catalog.results.set(conversationScopeKey(projectScope), {
      status: 'ready',
      scope: projectScope,
      revision: 2,
      targets: [{
        ...first,
        modifiedAt: '2026-08-22T01:00:00.000Z',
      }, second],
      diagnostics: [],
    })
    await expect(service.listConversations({
      cursor: page.nextCursor ?? undefined,
      limit: 1,
    })).rejects.toMatchObject({ code: 'invalid_state' })
  })

  it('resolves and revalidates a catalog target without returning its path', async () => {
    const { catalog, service } = createHarness()
    const target = controlTarget(
      '/sessions/exact.jsonl',
      'session-3',
      '2026-08-21T03:00:00.000Z',
    )
    catalog.results.set(conversationScopeKey(projectScope), {
      status: 'ready',
      scope: projectScope,
      revision: 1,
      targets: [target],
      diagnostics: [],
    })
    const listed = await service.listConversations({ limit: 50 })
    const conversationId = listed.conversations[0]?.conversationId
    if (!conversationId) throw new Error('Expected a conversation identity.')

    const status = await service.getConversationStatus({ conversationId })
    expect(status.conversation.conversationId).toBe(conversationId)
    expect(JSON.stringify(status)).not.toContain(target.sessionFile)
    const resolved = await service.resolveConversation(conversationId)
    await expect(service.revalidateTarget(resolved)).resolves.toMatchObject({
      conversation: { conversationId },
    })
    expect(catalog.revalidateControlTarget).toHaveBeenCalledWith(
      expect.objectContaining({ sessionFile: target.sessionFile }),
    )
  })

  it('fails closed when a Runtime-only target changes generation', async () => {
    const { catalog, runtimes, service } = createHarness()
    catalog.results.set(conversationScopeKey(projectScope), {
      status: 'ready',
      scope: projectScope,
      revision: 1,
      targets: [],
      diagnostics: [],
    })
    runtimes.push({
      hostEpoch: 1,
      runtimeId: 'rt_runtime_only',
      generation: 1,
      scope: projectScope,
      sessionFile: '/sessions/future.jsonl',
      sessionId: 'future-session',
      selected: false,
      lifecycle: 'idle',
      queueCount: 0,
    })
    const listed = await service.listConversations({ limit: 50 })
    const conversationId = listed.conversations[0]?.conversationId
    if (!conversationId) throw new Error('Expected a Runtime-only conversation.')
    const resolved = await service.resolveConversation(conversationId)
    runtimes[0] = { ...runtimes[0]!, generation: 2 }

    await expect(service.revalidateTarget(resolved)).rejects.toMatchObject({
      code: 'conversation_unavailable',
    })
  })
})
