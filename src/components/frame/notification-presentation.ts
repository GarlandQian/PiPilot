export type NotificationFilter = 'all' | 'attention'

/** Filtering preserves arrival order and notification identity. */
export function filterWorkbenchNotifications<T extends { type: 'info' | 'warning' | 'error' }>(
  notifications: readonly T[],
  filter: NotificationFilter,
): readonly T[] {
  return filter === 'all' ? notifications : notifications.filter((item) => item.type !== 'info')
}
