import * as React from 'react'
import type { OfficialPiSessionSummary, ConversationScope } from '@/shared/conversation-scope'
import { useTaskNotifications } from '@/store/task-notifications'
import { conversationScopeKey } from '@/store/workspace'

/** Reading a notice is tied to the visible hydrated task, never to opening the bell. */
export function useTaskNotificationNavigation({ scope, sessionId, visible, selectionRevision, route, openSession }: {
  scope: ConversationScope
  sessionId: string | null
  visible: boolean
  selectionRevision: number
  route: string
  openSession(summary: OfficialPiSessionSummary): void
}) {
  const { snapshot, setPresentation, resolveTarget } = useTaskNotifications()
  const [nativeOpenFailed, setNativeOpenFailed] = React.useState(false)
  const attempt = React.useRef(0)
  const navigationKey = JSON.stringify([conversationScopeKey(scope), sessionId, selectionRevision, route])
  const navigation = React.useRef(navigationKey)
  navigation.current = navigationKey
  const handledNative = React.useRef<string | null>(null)
  const mounted = React.useRef(true)
  React.useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; attempt.current += 1 }
  }, [])

  const scopeKey = conversationScopeKey(scope)
  React.useEffect(() => {
    const presentation = visible && sessionId ? { scope, sessionId } : { scope: null, sessionId: null }
    const update = () => { void setPresentation(presentation) }
    update()
    window.addEventListener('focus', update)
    document.addEventListener('visibilitychange', update)
    return () => {
      window.removeEventListener('focus', update)
      document.removeEventListener('visibilitychange', update)
    }
    // Scope is a value object; its stable key prevents redundant IPC on unrelated renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey, sessionId, visible, setPresentation])

  const openNotification = React.useCallback(async (id: string) => {
    const currentAttempt = ++attempt.current
    const requestedFrom = navigation.current
    const isCurrent = () => mounted.current && currentAttempt === attempt.current && requestedFrom === navigation.current
    try {
      const target = await resolveTarget(id)
      if (!isCurrent()) return
      setNativeOpenFailed(false)
      openSession(target)
    } catch (error) {
      if (isCurrent()) throw error
    }
  }, [openSession, resolveTarget])

  React.useEffect(() => {
    const id = snapshot.requestedId
    if (!id) { handledNative.current = null; return }
    if (handledNative.current === id) return
    handledNative.current = id
    void openNotification(id).catch(() => { if (mounted.current) setNativeOpenFailed(true) })
  }, [openNotification, snapshot.requestedId])

  return { openNotification, nativeOpenFailed, dismissNativeError: () => setNativeOpenFailed(false) }
}
