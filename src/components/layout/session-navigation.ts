import type { OfficialPiSessionSummary } from '@/shared/conversation-scope'
import { conversationTitleFromText } from '@/shared/conversation-title'
import type { AgentStatus } from '@/types/chat'
import type { SessionActivityState } from '@/store/workspace-state'

/** `all` lists active tasks outside Pinned; `archived` lists only archived ones. */
export type SidebarSessionFilter = 'all' | 'archived'
export type SidebarSessionSort = 'recent' | 'created' | 'name'
/** Codex: group tasks under their projects, or show every task in one list. */
export type SidebarOrganization = 'project' | 'chronological'

interface SessionPresentationItem {
  summary: OfficialPiSessionSummary
  status?: AgentStatus
  activityState?: SessionActivityState
  selected?: boolean
  pinned?: boolean
  archived?: boolean
  needsAttention?: boolean
  unread?: boolean
  organizationKey?: string
}

/** A session's display title: its name, else a clean title from its first message. */
export function sidebarConversationTitle(summary: Pick<OfficialPiSessionSummary, 'name' | 'title' | 'preview'>, untitled = '') {
  return summary.name?.trim() || summary.title || conversationTitleFromText(summary.preview) || untitled
}

/** Opening a historical transcript alone is not an active agent run. */
export function isSidebarSessionRunning(item: SessionPresentationItem) {
  if (item.activityState && item.activityState !== 'opening') {
    return item.activityState === 'running' || item.activityState === 'waiting'
  }
  return item.status === 'planning' || item.status === 'running'
}

export function sidebarSessionNeedsAttention(item: SessionPresentationItem) {
  return item.needsAttention === true || item.unread === true || item.activityState === 'failed' || item.status === 'failed'
}

export function isNewBackgroundResult(item: SessionPresentationItem, previousStatus?: AgentStatus): boolean {
  return !item.selected && (previousStatus === 'running' || previousStatus === 'planning') &&
    item.status === 'completed'
}

export type SidebarProjectIndicator = 'attention' | 'failed' | 'running' | 'unread' | 'none'

/** What a collapsed project row shows for the tasks it hides. */
export function sidebarProjectIndicator(items: readonly SessionPresentationItem[]): SidebarProjectIndicator {
  const visible = items.filter((item) => !item.archived)
  if (visible.some((item) => item.needsAttention)) return 'attention'
  if (visible.some((item) => item.activityState === 'failed' || item.status === 'failed')) return 'failed'
  if (visible.some(isSidebarSessionRunning)) return 'running'
  return visible.some((item) => item.unread && !item.selected) ? 'unread' : 'none'
}

function compareSessions(left: SessionPresentationItem, right: SessionPresentationItem, sort: SidebarSessionSort) {
  if (sort === 'name') {
    const byName = sidebarConversationTitle(left.summary).localeCompare(
      sidebarConversationTitle(right.summary),
      undefined,
      { numeric: true, sensitivity: 'base' },
    )
    if (byName !== 0) return byName
  }
  if (sort === 'created') {
    const byCreated = right.summary.createdAt.localeCompare(left.summary.createdAt)
    if (byCreated !== 0) return byCreated
  }
  return right.summary.modifiedAt.localeCompare(left.summary.modifiedAt) ||
    left.summary.selectionToken.localeCompare(right.summary.selectionToken)
}

/** Pinned tasks leave their project and live in one Pinned section, as in Codex. */
export function presentPinnedSessions<T extends SessionPresentationItem>(items: readonly T[], sort: SidebarSessionSort): T[] {
  return items.filter((item) => item.pinned && !item.archived).sort((left, right) => compareSessions(left, right, sort))
}

/** Filter before paginating so a matching older session stays discoverable. */
export function presentSidebarSessions<T extends SessionPresentationItem>(
  items: readonly T[],
  { query, filter, sort, projectName = '', limit }: {
    query: string
    filter: SidebarSessionFilter
    sort: SidebarSessionSort
    projectName?: string
    limit?: number
  },
) {
  const normalizedQuery = query.trim().toLowerCase()
  const projectMatches = projectName.toLowerCase().includes(normalizedQuery)
  const matchingItems = items.filter((item) =>
    (filter === 'archived' ? item.archived === true
      : !item.pinned && (normalizedQuery.length > 0 || !item.archived || item.selected || isSidebarSessionRunning(item) || sidebarSessionNeedsAttention(item))) &&
    (!normalizedQuery || projectMatches ||
      sidebarConversationTitle(item.summary).toLowerCase().includes(normalizedQuery) ||
      item.summary.preview.toLowerCase().includes(normalizedQuery)),
  ).sort((left, right) => compareSessions(left, right, sort))
  const visibleItems = limit === undefined ? matchingItems : matchingItems.slice(0, limit)

  return {
    items: visibleItems,
    loadedCount: items.length,
    matchingCount: matchingItems.length,
    hasMore: visibleItems.length < matchingItems.length,
  }
}

/** Pinning is authoritative; sorting never mutates the shared project list. */
export function sortSidebarProjects<T extends {
  pinned?: boolean
  name: string
  lastOpenedAt: string | number
}>(projects: readonly T[], sort: SidebarSessionSort): T[] {
  return [...projects].sort((left, right) => {
    const byPinned = Number(Boolean(right.pinned)) - Number(Boolean(left.pinned))
    if (byPinned !== 0) return byPinned
    if (sort === 'name') {
      const byName = left.name.localeCompare(right.name, undefined, {
        numeric: true,
        sensitivity: 'base',
      })
      if (byName !== 0) return byName
    }
    return new Date(right.lastOpenedAt).getTime() - new Date(left.lastOpenedAt).getTime()
  })
}
