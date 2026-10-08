import type {
  ConversationScope,
  OfficialPiSessionSummary,
} from '@/shared/conversation-scope'
import type { LocalPiRuntimeSessionStatus } from '@/shared/local-pi'
import type { Session } from '@/types/chat'
import type { AgentStatus } from '@/types/chat'
import { sidebarConversationTitle } from '@/components/layout/session-navigation'

export const SESSION_PAGE_SIZE = 50

export type SessionActivityState =
  | 'opening'
  | 'running'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'released'

export function sessionPageForId(
  source: readonly Pick<Session, 'id'>[],
  sessionId: string,
  pageSize = SESSION_PAGE_SIZE,
) {
  const size = Math.max(1, Math.trunc(pageSize) || SESSION_PAGE_SIZE)
  const index = source.findIndex((session) => session.id === sessionId)
  return index < 0 ? 0 : Math.floor(index / size)
}

export function paginateSessions<T>(
  source: readonly T[],
  requestedPage: number,
  pageSize = SESSION_PAGE_SIZE,
) {
  const size = Math.max(1, Math.trunc(pageSize) || SESSION_PAGE_SIZE)
  const pageCount = Math.max(1, Math.ceil(source.length / size))
  const page = Math.min(
    pageCount - 1,
    Math.max(0, Number.isFinite(requestedPage) ? Math.trunc(requestedPage) : 0),
  )
  return {
    items: source.slice(page * size, (page + 1) * size),
    page,
    pageCount,
  }
}

export function deriveOfficialSessionState(
  source: readonly OfficialPiSessionSummary[],
  scopeName: string,
  activeSessionId = '',
): { sessions: Session[]; activeId: string } {
  const sessions = source
    .map((session): Session => ({
      id: session.sessionId,
      title: sidebarConversationTitle(session),
      repo: scopeName,
      updatedAt: Date.parse(session.modifiedAt),
      selectionToken: session.selectionToken,
    }))
    .sort((left, right) => right.updatedAt - left.updatedAt)

  return {
    sessions,
    activeId: sessions.some((session) => session.id === activeSessionId)
      ? activeSessionId
      : '',
  }
}

export function sameConversationScope(
  left: ConversationScope,
  right: ConversationScope,
) {
  return left.kind === right.kind && (
    left.kind === 'projectless' || (
      right.kind === 'project' && left.workspaceId === right.workspaceId
    )
  )
}

export interface OfficialSessionOpeningTarget {
  scope: ConversationScope
  selectionToken: string
  sessionId?: string
}

/**
 * Keep the pending-row indicator tied to the catalog's opaque identity. Once
 * activation has confirmed a canonical session id, use it only when that id
 * is unambiguous in the current catalog snapshot.
 */
export function isOfficialSessionOpeningRow(
  summary: OfficialPiSessionSummary,
  siblings: readonly OfficialPiSessionSummary[],
  target: OfficialSessionOpeningTarget | null,
) {
  if (!target || !sameConversationScope(summary.scope, target.scope)) return false
  if (summary.selectionToken === target.selectionToken) return true
  if (!target.sessionId || summary.sessionId !== target.sessionId) return false

  return !siblings.some((candidate) =>
    candidate.selectionToken !== summary.selectionToken &&
    sameConversationScope(candidate.scope, summary.scope) &&
    candidate.sessionId === summary.sessionId)
}

export function isOfficialSessionActiveRow(
  summary: OfficialPiSessionSummary,
  siblings: readonly OfficialPiSessionSummary[],
  activeScope: ConversationScope,
  activeSessionId: string,
  runtimeSelected = false,
) {
  if (!sameConversationScope(summary.scope, activeScope)) return false
  if (runtimeSelected) return true
  if (!activeSessionId || summary.sessionId !== activeSessionId) return false

  return !siblings.some((candidate) =>
    candidate !== summary &&
    sameConversationScope(candidate.scope, summary.scope) &&
    candidate.sessionId === summary.sessionId)
}

export function runtimeStateForOfficialSession(
  summary: OfficialPiSessionSummary,
  statuses: readonly LocalPiRuntimeSessionStatus[] | undefined,
  siblings: readonly OfficialPiSessionSummary[],
) {
  const scoped = statuses?.filter((status) =>
    sameConversationScope(status.scope, summary.scope)) ?? []
  const exact = scoped.find((status) =>
    status.selectionToken === summary.selectionToken)
  if (exact) return exact

  const duplicateSessionId = siblings.some((candidate) =>
    candidate !== summary && candidate.sessionId === summary.sessionId)
  if (duplicateSessionId) return undefined

  return scoped.find((status) =>
    status.selectionToken === undefined && status.sessionId === summary.sessionId)
}

/** Build once per catalogue rather than checking every sibling for every row. */
export function createOfficialSessionLookup(
  siblings: readonly OfficialPiSessionSummary[],
  statuses: readonly LocalPiRuntimeSessionStatus[] | undefined,
) {
  const counts = new Map<string, number>()
  const scopedCounts = new Map<string, number>()
  const exact = new Map<string, LocalPiRuntimeSessionStatus>()
  const fallback = new Map<string, LocalPiRuntimeSessionStatus>()
  const key = (scope: ConversationScope, id: string) => JSON.stringify([
    scope.kind === 'project' ? scope.workspaceId : null, id,
  ])
  for (const row of siblings) {
    counts.set(row.sessionId, (counts.get(row.sessionId) ?? 0) + 1)
    const scoped = key(row.scope, row.sessionId)
    scopedCounts.set(scoped, (scopedCounts.get(scoped) ?? 0) + 1)
  }
  for (const status of statuses ?? []) {
    const target = status.selectionToken === undefined ? fallback : exact
    const identity = key(status.scope, status.selectionToken ?? status.sessionId)
    // The single-row helpers use find: preserve the first matching status.
    if (!target.has(identity)) target.set(identity, status)
  }
  return {
    isUnique: (row: OfficialPiSessionSummary) => counts.get(row.sessionId) === 1,
    runtime(row: OfficialPiSessionSummary) {
      return exact.get(key(row.scope, row.selectionToken)) ?? (counts.get(row.sessionId) === 1
        ? fallback.get(key(row.scope, row.sessionId)) : undefined)
    },
    active(row: OfficialPiSessionSummary, activeScope: ConversationScope, activeSessionId: string, runtimeSelected = false) {
      return sameConversationScope(row.scope, activeScope) && (runtimeSelected || (
        Boolean(activeSessionId) && row.sessionId === activeSessionId && scopedCounts.get(key(row.scope, row.sessionId)) === 1
      ))
    },
  }
}

export function runtimeStatusForOfficialSession(
  summary: OfficialPiSessionSummary,
  statuses: readonly LocalPiRuntimeSessionStatus[] | undefined,
  siblings: readonly OfficialPiSessionSummary[],
) {
  return runtimeStateForOfficialSession(summary, statuses, siblings)?.status
}

export function deriveSessionActivityState({
  opening = false,
  status,
  pendingMessageCount = 0,
}: {
  opening?: boolean
  status?: AgentStatus | LocalPiRuntimeSessionStatus['status']
  pendingMessageCount?: number
}): SessionActivityState {
  if (opening) return 'opening'
  if (pendingMessageCount > 0) return 'waiting'
  if (status === 'planning' || status === 'running') return 'running'
  if (status === 'failed') return 'failed'
  if (status === 'completed' || status === 'cancelled' || status === 'idle') {
    return 'completed'
  }
  return 'released'
}
