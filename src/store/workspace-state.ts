import type {
  ConversationScope,
  OfficialPiSessionSummary,
} from '@/shared/conversation-scope'
import type { Session } from '@/types/chat'

export const SESSION_PAGE_SIZE = 50

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
