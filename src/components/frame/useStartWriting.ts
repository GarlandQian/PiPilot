import * as React from 'react'
import type { ComposerFocusRequest } from '@/components/chat/Composer'
import type { ConversationActivationResult } from '@/shared/conversation-scope'
import { conversationScopeKey, type WorkspaceStoreValue } from '@/store/workspace'

/** Keep the welcome action pending until its own conversation can accept input. */
export function useStartWriting({ workspace, ready, failed, generation, composerScopeKey,
  selectionRevision, requestSwitch }: {
  workspace: WorkspaceStoreValue
  ready: boolean
  failed: boolean
  generation: number | undefined
  composerScopeKey: string
  selectionRevision: number
  requestSwitch(operation: () => Promise<void>): void
}) {
  const sequence = React.useRef(0)
  const attempt = React.useRef<{
    controller: AbortController
    revision: number
    activation: ConversationActivationResult | null
  } | null>(null)
  const [starting, setStarting] = React.useState(false)
  const [focusRequest, setFocusRequest] = React.useState<ComposerFocusRequest | null>(null)
  const [activationRevision, activationArrived] = React.useReducer((value: number) => value + 1, 0)

  const cancelStartWriting = React.useCallback(() => {
    attempt.current?.controller.abort()
    attempt.current = null
    setStarting(false)
  }, [])

  React.useEffect(() => () => {
    attempt.current?.controller.abort()
    attempt.current = null
  }, [])

  React.useEffect(() => {
    const current = attempt.current
    if (!current) return
    if (current.revision !== selectionRevision || failed) {
      cancelStartWriting()
      return
    }
    const activation = current.activation
    if (!ready || !activation || generation !== activation.generation ||
      workspace.activeSessionId !== activation.sessionId ||
      conversationScopeKey(workspace.activeScope) !== conversationScopeKey(activation.scope)) return
    attempt.current = null
    setStarting(false)
    setFocusRequest({ scopeKey: composerScopeKey, sequence: ++sequence.current })
  }, [selectionRevision, failed, ready, generation, composerScopeKey,
    workspace.activeSessionId, workspace.activeScope, activationRevision, cancelStartWriting])

  const startWriting = React.useCallback(() => {
    if (attempt.current) return
    if (ready) {
      setFocusRequest({ scopeKey: composerScopeKey, sequence: ++sequence.current })
      return
    }
    const current = { controller: new AbortController(), revision: selectionRevision + 1,
      activation: null as ConversationActivationResult | null }
    attempt.current = current
    setStarting(true)
    requestSwitch(async () => {
      try {
        const activation = await workspace.ensureInputSession(current.controller.signal)
        if (attempt.current !== current) return
        if (activation) {
          current.activation = activation
          activationArrived()
        } else {
          attempt.current = null
          setStarting(false)
        }
      } catch (error) {
        if (attempt.current === current) {
          attempt.current = null
          setStarting(false)
        }
        throw error
      }
    })
  }, [ready, composerScopeKey, selectionRevision, requestSwitch, workspace])

  return { startWriting, cancelStartWriting, starting, focusRequest }
}
