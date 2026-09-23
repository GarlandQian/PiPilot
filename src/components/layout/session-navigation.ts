import type { OfficialPiSessionSummary } from '@/shared/conversation-scope'
import type { AgentStatus } from '@/types/chat'
import type { SessionActivityState } from '@/store/workspace-state'

export type SidebarSessionFilter = 'all' | 'running' | 'attention' | 'archived'
export type SidebarSessionSort = 'recent' | 'name'

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

export function sidebarConversationTitle(summary: OfficialPiSessionSummary, untitled = '') {
  return summary.name?.trim() || summary.preview.trim() || untitled
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

/** Project labels resume work; explicit new-task controls own creation. */
export function preferredProjectSession<T extends SessionPresentationItem>(items: readonly T[], rememberedKey?: string): T | undefined {
  const available = items.filter((item) => !item.archived)
  return available.find((item) => item.selected) ??
    available.find((item) => rememberedKey && item.organizationKey === rememberedKey) ??
    [...available].sort((a, b) => b.summary.modifiedAt.localeCompare(a.summary.modifiedAt))[0]
}

export function presentPrioritySessions<T extends SessionPresentationItem>(items: readonly T[]): T[] {
  return items.filter((item) => sidebarSessionNeedsAttention(item) || isSidebarSessionRunning(item) || item.selected || (item.pinned && !item.archived))
    .sort((a, b) => Number(sidebarSessionNeedsAttention(b)) - Number(sidebarSessionNeedsAttention(a)) ||
      Number(isSidebarSessionRunning(b)) - Number(isSidebarSessionRunning(a)) ||
      Number(Boolean(b.selected)) - Number(Boolean(a.selected)) ||
      b.summary.modifiedAt.localeCompare(a.summary.modifiedAt))
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
    (filter === 'archived' ? item.archived === true :
      filter === 'running' ? isSidebarSessionRunning(item) :
        filter === 'attention' ? sidebarSessionNeedsAttention(item) :
          normalizedQuery.length > 0 || !item.archived || item.selected || isSidebarSessionRunning(item) || sidebarSessionNeedsAttention(item)) &&
    (!normalizedQuery || projectMatches ||
      sidebarConversationTitle(item.summary).toLowerCase().includes(normalizedQuery) ||
      item.summary.preview.toLowerCase().includes(normalizedQuery)),
  ).sort((left, right) => {
    const pinned = Number(Boolean(right.pinned)) - Number(Boolean(left.pinned))
    if (pinned) return pinned
    if (sort === 'name') {
      const byName = sidebarConversationTitle(left.summary).localeCompare(
        sidebarConversationTitle(right.summary),
        undefined,
        { numeric: true, sensitivity: 'base' },
      )
      if (byName !== 0) return byName
    }
    return right.summary.modifiedAt.localeCompare(left.summary.modifiedAt) ||
      left.summary.selectionToken.localeCompare(right.summary.selectionToken)
  })
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
