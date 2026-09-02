import type {
  ConversationScope,
  OfficialPiSessionSummary,
} from '@/shared/conversation-scope'
import type { LocalPiRuntimeSessionStatus } from '@/shared/local-pi'
import type { Session } from '@/types/chat'
import type { AgentStatus } from '@/types/chat'

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
      title: session.name ?? session.preview,
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

export function runtimeStatusForOfficialSession(
  summary: OfficialPiSessionSummary,
  statuses: readonly LocalPiRuntimeSessionStatus[] | undefined,
  siblings: readonly OfficialPiSessionSummary[],
) {
  const scoped = statuses?.filter((status) =>
    sameConversationScope(status.scope, summary.scope)) ?? []
  const exact = scoped.find((status) =>
    status.selectionToken === summary.selectionToken)
  if (exact) return exact.status

  const duplicateSessionId = siblings.some((candidate) =>
    candidate !== summary && candidate.sessionId === summary.sessionId)
  if (duplicateSessionId) return undefined

  return scoped.find((status) =>
    status.selectionToken === undefined && status.sessionId === summary.sessionId)?.status
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
