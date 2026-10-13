import type { ConversationScope, OfficialPiSessionSummary } from '@/shared/conversation-scope'
import { taskOrganizationKey, type NavigationPreferences } from './navigation-preferences'

export interface ArchivedDeletionFailure {
  summary: OfficialPiSessionSummary
  reason: 'unavailable' | 'missing' | 'deleteFailed'
  message?: string
}

/** The confirmed list is a fixed set of physical files, never a session-ID query. */
export async function deleteArchivedSessions(targets: readonly OfficialPiSessionSummary[], operations: {
  preferences(): NavigationPreferences
  list(scope: ConversationScope): Promise<{ status: string; rows: readonly OfficialPiSessionSummary[] }>
  delete(summary: OfficialPiSessionSummary): Promise<unknown>
  deleted(summary: OfficialPiSessionSummary): void
}) {
  const failures: ArchivedDeletionFailure[] = []
  const seen = new Set<string>()
  for (const target of targets) {
    const key = taskOrganizationKey(target)
    if (seen.has(key)) continue
    seen.add(key)
    if (operations.preferences().tasks[key]?.archived !== true) continue
    try {
      // Deletion refreshes the catalog and consumes its capability. Resolve a
      // fresh one for every file; matching session IDs can refer to copied files.
      const catalog = await operations.list(target.scope)
      if (catalog.status !== 'ready') {
        failures.push({ summary: target, reason: 'unavailable' })
        continue
      }
      const current = catalog.rows.find((row) => taskOrganizationKey(row) === key)
      if (!current) {
        failures.push({ summary: target, reason: 'missing' })
        continue
      }
      // A restore action that finishes during discovery revokes this deletion.
      if (operations.preferences().tasks[key]?.archived !== true) continue
      await operations.delete(current)
      operations.deleted(current)
    } catch (error) {
      failures.push({ summary: target, reason: 'deleteFailed',
        message: error instanceof Error ? error.message : String(error) })
    }
  }
  return failures
}
