import type { OfficialPiSessionSummary } from '@/shared/conversation-scope'

export interface TaskOrganization {
  pinned?: boolean
  archived?: boolean
  unread?: boolean
}

export interface NavigationPreferences {
  tasks: Record<string, TaskOrganization>
  lastSelected: Record<string, string>
}

const STORAGE_KEY = 'pipilot.navigation.tasks.v1'

export function taskScopeKey(summary: Pick<OfficialPiSessionSummary, 'scope'>): string {
  return summary.scope.kind === 'project' ? `project:${summary.scope.workspaceId}` : 'projectless'
}

/** Main supplies a stable opaque file identity; incomplete fixture rows remain capability-scoped. */
export function taskOrganizationKey(summary: OfficialPiSessionSummary): string {
  return JSON.stringify([taskScopeKey(summary), summary.catalogId ?? summary.selectionToken])
}

export function parseNavigationPreferences(raw: string | null): NavigationPreferences {
  const empty: NavigationPreferences = { tasks: {}, lastSelected: {} }
  if (!raw) return empty
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return empty
    const document = value as Record<string, unknown>
    if (document.version !== 1) return empty
    if (document.tasks && typeof document.tasks === 'object' && !Array.isArray(document.tasks)) {
      for (const [key, entry] of Object.entries(document.tasks)) {
        if (!key.startsWith('[') || key.length > 1_024 || !entry || typeof entry !== 'object') continue
        const item = entry as Record<string, unknown>
        if (item.pinned === true || item.archived === true || item.unread === true) {
          empty.tasks[key] = {
            ...(item.pinned === true ? { pinned: true } : {}),
            ...(item.archived === true ? { archived: true } : {}),
            ...(item.unread === true ? { unread: true } : {}),
          }
        }
      }
    }
    if (document.lastSelected && typeof document.lastSelected === 'object' && !Array.isArray(document.lastSelected)) {
      for (const [key, value] of Object.entries(document.lastSelected)) {
        if ((key === 'projectless' || key.startsWith('project:')) && typeof value === 'string' && value.startsWith('[') && value.length <= 1_024) {
          empty.lastSelected[key] = value
        }
      }
    }
    return empty
  } catch {
    return empty
  }
}

export function readNavigationPreferences(): NavigationPreferences {
  try { return parseNavigationPreferences(localStorage.getItem(STORAGE_KEY)) } catch { return { tasks: {}, lastSelected: {} } }
}

export function writeNavigationPreferences(preferences: NavigationPreferences): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, ...preferences })) } catch { /* In-memory organization remains available. */ }
}

export function updateTaskOrganization(
  preferences: NavigationPreferences,
  summary: OfficialPiSessionSummary,
  patch: TaskOrganization,
): NavigationPreferences {
  const key = taskOrganizationKey(summary)
  const next = { ...preferences.tasks[key], ...patch }
  const tasks = { ...preferences.tasks }
  if (!next.pinned && !next.archived && !next.unread) delete tasks[key]
  else tasks[key] = next
  return { ...preferences, tasks }
}
