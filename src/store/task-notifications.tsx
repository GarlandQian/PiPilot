import * as React from 'react'
import { useT, type MessageKey } from '@/i18n'
import type { OfficialPiSessionSummary } from '@/shared/conversation-scope'
import type { PiPilotApi } from '@/shared/pipilot-api'
import type { TaskNotificationPresentation, TaskNotificationSnapshot } from '@/shared/task-notifications'

type NotificationApi = PiPilotApi['notifications']
interface NotificationState {
  snapshot: TaskNotificationSnapshot
  loading: boolean
  errorKey: MessageKey | null
}

function emptySnapshot(): TaskNotificationSnapshot {
  return { revision: 0, items: [], requestedId: null, desktopSupported: false }
}

export function createTaskNotificationsStore(
  api: NotificationApi | undefined = typeof window === 'undefined' ? undefined : window.pipilot?.notifications,
) {
  let state: NotificationState = { snapshot: emptySnapshot(), loading: Boolean(api), errorKey: null }
  let acceptedRevision = -1
  let generation = 0
  let requestEpoch = 0
  let loadEpoch = 0
  const listeners = new Set<() => void>()
  const update = (patch: Partial<NotificationState>) => {
    state = { ...state, ...patch }
    for (const listener of listeners) listener()
  }
  const accept = (snapshot: TaskNotificationSnapshot) => {
    if (snapshot.revision <= acceptedRevision) return false
    acceptedRevision = snapshot.revision
    update({
      snapshot: { ...snapshot, items: snapshot.items.map((item) => ({ ...item, scope: { ...item.scope } })) },
      loading: false,
    })
    return true
  }
  const run = async (
    operation: (notifications: NotificationApi) => Promise<TaskNotificationSnapshot>,
    errorKey: MessageKey,
    load = false,
  ): Promise<boolean> => {
    if (!api) return false
    const epoch = ++requestEpoch
    const loadRequest = load ? ++loadEpoch : 0
    const lifecycle = generation
    update({ errorKey: null, ...(load ? { loading: true } : {}) })
    try {
      const snapshot = await operation(api)
      if (lifecycle !== generation) return false
      accept(snapshot)
      if (epoch === requestEpoch) update({ errorKey: null })
      return true
    } catch {
      if (lifecycle === generation && epoch === requestEpoch) update({ errorKey })
      return false
    } finally {
      if (load && lifecycle === generation && loadRequest === loadEpoch) update({ loading: false })
    }
  }
  const reload = () => run((notifications) => notifications.get(), 'notifications.loadFailed', true)
  const setPresentation = (presentation: TaskNotificationPresentation) => run(
    (notifications) => notifications.setPresentation(presentation), 'notifications.updateFailed',
  )
  const markRead = (id?: string) => run((notifications) => notifications.markRead(id), 'notifications.markReadFailed')
  const clear = (id?: string) => run((notifications) => notifications.clear(id), 'notifications.clearFailed')
  const resolveTarget = async (id: string): Promise<OfficialPiSessionSummary> => {
    if (!api) throw new Error('Notification navigation is unavailable.')
    return api.resolveTarget(id)
  }

  return {
    get: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    start() {
      if (!api) return () => {}
      const lifecycle = ++generation
      const unsubscribe = api.subscribe((snapshot) => {
        if (lifecycle === generation) accept(snapshot)
      })
      void reload()
      return () => { generation += 1; unsubscribe() }
    },
    reload,
    setPresentation,
    markRead,
    clear,
    resolveTarget,
  }
}

type TaskNotificationsStore = ReturnType<typeof createTaskNotificationsStore>
type TaskNotificationsValue = Pick<TaskNotificationsStore, 'reload' | 'setPresentation' | 'markRead' | 'clear' | 'resolveTarget'> & {
  snapshot: TaskNotificationSnapshot
  loading: boolean
  errorMessage: string | null
}
const TaskNotificationsContext = React.createContext<TaskNotificationsValue | null>(null)

export function TaskNotificationsProvider({ children }: { children: React.ReactNode }) {
  const t = useT()
  const [store] = React.useState(() => createTaskNotificationsStore())
  const state = React.useSyncExternalStore(store.subscribe, store.get, store.get)
  React.useEffect(() => store.start(), [store])
  const value = React.useMemo<TaskNotificationsValue>(() => ({
    snapshot: state.snapshot,
    loading: state.loading,
    errorMessage: state.errorKey ? t(state.errorKey) : null,
    reload: store.reload,
    setPresentation: store.setPresentation,
    markRead: store.markRead,
    clear: store.clear,
    resolveTarget: store.resolveTarget,
  }), [state, store, t])
  return <TaskNotificationsContext.Provider value={value}>{children}</TaskNotificationsContext.Provider>
}

export function useTaskNotifications() {
  const value = React.useContext(TaskNotificationsContext)
  if (!value) throw new Error('useTaskNotifications must be used within TaskNotificationsProvider')
  return value
}
