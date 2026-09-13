import * as React from 'react'
import { useT } from '@/i18n'
import type { SidebarConversationItem } from '@/components/layout/SessionList'
import type { ConversationActivationResult, ConversationScope } from '@/shared/conversation-scope'
import {
  cancelPiGenerationHydrationWaiter,
  piGenerationHydrationOutcome,
  type usePiRuntime,
} from '@/store/pi-rpc'
import { conversationScopeKey, type useWorkspaceStore } from '@/store/workspace'

interface SessionOpening {
  operationId: number
  scope: ConversationScope
  scopeKey: string
  selectionToken: string
  activation: ConversationActivationResult | null
  title: string
  error: string | null
}

interface SessionOpeningHandle extends SessionOpening {
  hydration: Promise<boolean>
  resolveHydration(success: boolean): void
}

/** A catalog click settles only after Main confirms and that exact target hydrates. */
export function useSessionOpening({
  workspace,
  pi,
  transcriptLoading,
}: {
  workspace: ReturnType<typeof useWorkspaceStore>
  pi: ReturnType<typeof usePiRuntime>
  transcriptLoading: boolean
}) {
  const t = useT()
  const [openingSession, setOpeningSession] = React.useState<SessionOpening | null>(null)
  const openingRef = React.useRef<SessionOpeningHandle | null>(null)
  const [selectionRevision, advanceSelectionRevision] = React.useReducer((revision: number) => revision + 1, 0)
  const sequence = React.useRef(0)

  React.useEffect(() => () => {
    cancelPiGenerationHydrationWaiter(openingRef)
  }, [])

  const abandonSessionOpening = React.useCallback((preserveOperationId?: number) => {
    const opening = openingRef.current
    if (!opening) {
      setOpeningSession((current) => current?.error ? null : current)
      return
    }
    if (opening.operationId === preserveOperationId) return
    cancelPiGenerationHydrationWaiter(openingRef)
    setOpeningSession((current) => current?.operationId === opening.operationId ? null : current)
  }, [])

  const requestSwitch = React.useCallback((
    operation: () => Promise<void>,
    sessionOpeningOperationId?: number,
  ) => {
    advanceSelectionRevision()
    abandonSessionOpening(sessionOpeningOperationId)
    // Workspace owns the operation error; this owner handles exact activation loading.
    void operation().catch(() => undefined)
  }, [abandonSessionOpening])

  const settleSessionOpening = React.useCallback((
    operationId: number,
    outcome: { status: 'ready' } | { status: 'error'; error: string },
  ) => {
    const opening = openingRef.current
    if (!opening || opening.operationId !== operationId) return
    openingRef.current = null
    opening.resolveHydration(outcome.status === 'ready')
    setOpeningSession((current) => {
      if (current?.operationId !== operationId) return current
      return outcome.status === 'error' ? { ...current, error: outcome.error } : null
    })
  }, [])

  React.useEffect(() => {
    if (!openingSession || openingSession.error || !openingSession.activation) return
    const activation = openingSession.activation
    const outcome = piGenerationHydrationOutcome(
      {
        scopeKey: conversationScopeKey(activation.scope),
        generation: activation.generation,
        sessionId: activation.sessionId,
      },
      conversationScopeKey(workspace.activeScope),
      workspace.activeSessionId,
      pi.runtime,
      pi.session,
      pi.hydration,
      pi.loading,
      transcriptLoading,
    )
    if (outcome === 'ready') {
      settleSessionOpening(openingSession.operationId, { status: 'ready' })
    } else if (outcome === 'error') {
      settleSessionOpening(openingSession.operationId, {
        status: 'error',
        error: pi.hydration.error || pi.error || t('sidebar.session.openFailed'),
      })
    }
  }, [openingSession, pi.hydration, pi.loading, pi.runtime, pi.session, pi.error,
    settleSessionOpening, t, transcriptLoading, workspace.activeScope, workspace.activeSessionId])

  const requestSessionOpening = React.useCallback((
    item: SidebarConversationItem,
    afterHydration?: () => Promise<void>,
  ) => {
    abandonSessionOpening()
    let resolveHydration: (success: boolean) => void = () => undefined
    const hydration = new Promise<boolean>((resolve) => { resolveHydration = resolve })
    const opening: SessionOpeningHandle = {
      operationId: ++sequence.current,
      scope: item.summary.scope,
      scopeKey: conversationScopeKey(item.summary.scope),
      selectionToken: item.summary.selectionToken,
      activation: null,
      title: item.summary.name?.trim() || item.summary.preview.trim() || t('sidebar.session.untitled'),
      error: null,
      hydration,
      resolveHydration,
    }
    openingRef.current = opening
    setOpeningSession(opening)
    requestSwitch(async () => {
      try {
        const activation = await workspace.openSession(item.summary.scope, item.summary.selectionToken)
        if (openingRef.current !== opening) return
        if (conversationScopeKey(activation.scope) !== opening.scopeKey) {
          throw new Error(t('sidebar.session.openFailed'))
        }
        opening.activation = activation
        setOpeningSession((current) => current?.operationId === opening.operationId
          ? { ...current, activation } : current)
        if (await opening.hydration) await afterHydration?.()
      } catch (error) {
        settleSessionOpening(opening.operationId, {
          status: 'error',
          error: error instanceof Error && error.message.trim()
            ? error.message : t('sidebar.session.openFailed'),
        })
        throw error
      }
    }, opening.operationId)
  }, [abandonSessionOpening, requestSwitch, settleSessionOpening, t, workspace])

  return { openingSession, selectionRevision, abandonSessionOpening, requestSwitch, requestSessionOpening }
}
