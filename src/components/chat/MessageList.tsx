import * as React from 'react'
import { TbAlertTriangle, TbArrowDown, TbInfoCircle, TbLoader2 } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { ToolActivityRegion } from './ToolActivityRegion'
import { ResponseActivityRow } from './ExtensionSurfaces'
import { useFollowingViewport } from './useFollowingViewport'
import { UserMessage, AgentMessage, ThinkingMessage, NoticeMessage, PlanModeMessage, ResponseActions, agentAnimationKey, type ThinkingDurationRegistry } from './ConversationMessages'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import { groupConversationTurns } from '@/renderer/pi-rpc/presentation'
import { projectResponsePresentation, type ResponsePresentationSegment } from '@/renderer/pi-rpc/response-presentation'
import { ConversationResponse } from './ConversationResponse'
import { MarkdownContent } from './markdown/MarkdownContent'
import { useConversationOperationFeedback } from '@/renderer/composer/use-operation-feedback'
import { useSettings } from '@/store/settings'
import type { PiConversationPresentation } from '@/store/pi-rpc'
import type { AgentStatus, SubagentInspectorFocusRequest, Turn } from '@/types/chat'

interface MessageListProps {
  emptyState?: React.ReactNode
  turns: readonly Turn[]
  revision?: number
  historyTruncated?: boolean
  presentation: PiConversationPresentation
  sessionKey: string | null
  jumpRequest: ConversationJumpRequest | null
  status: AgentStatus
  onFork?: (entryId: string) => Promise<void>
  onPlanAction?: (
    action: Extract<Turn, { kind: 'plan' }>['actions'][number],
    revision?: string,
  ) => Promise<void>
  selectedSubagentId?: string | null
  subagentFocusRequest?: SubagentInspectorFocusRequest | null
  onOpenSubagent?: (toolCallId: string) => void
}

export interface ConversationJumpRequest {
  sessionKey: string
  entryId: string
  sequence: number
}

export function MessageList({
  emptyState,
  turns,
  revision = turns.length,
  historyTruncated = false,
  presentation,
  sessionKey,
  jumpRequest,
  status,
  onFork,
  onPlanAction,
  selectedSubagentId,
  subagentFocusRequest,
  onOpenSubagent,
}: MessageListProps) {
  const t = useT()
  const { appearance } = useSettings()
  const motionEnabled = !appearance.reducedMotion &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const ready = presentation.status === 'ready'
  const { scrollRef, contentRef, scrollProps, canJumpToLatest, scrollToLatest, pauseFollowing } =
    useFollowingViewport({ ownerKey: sessionKey, ready, revision, smooth: motionEnabled })
  const anchorNodes = React.useMemo(
    () => new Map<string, HTMLDivElement>(),
    [sessionKey],
  )
  const thinkingDurations = React.useMemo<ThinkingDurationRegistry>(() => ({
    started: new Map(),
    completed: new Map(),
  }), [sessionKey])
  const highlightTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const forkFeedback = useConversationOperationFeedback(sessionKey ?? 'unavailable')
  const knownAgentTurnsRef = React.useRef<{
    sessionKey: string | null
    ready: boolean
    keys: Set<string>
  }>({
    sessionKey,
    ready: presentation.status === 'ready',
    keys: new Set(turns.flatMap((turn) =>
      turn.kind === 'agent' ? [agentAnimationKey(turn)] : [])),
  })
  const [highlightedEntryId, setHighlightedEntryId] = React.useState<string | null>(null)
  const [typingAgentKeys, setTypingAgentKeys] = React.useState<ReadonlySet<string>>(
    () => new Set(),
  )
  if (
    knownAgentTurnsRef.current.sessionKey !== sessionKey ||
    (!knownAgentTurnsRef.current.ready && ready)
  ) {
    knownAgentTurnsRef.current = {
      sessionKey,
      ready,
      keys: new Set(turns.flatMap((turn) =>
        turn.kind === 'agent' ? [agentAnimationKey(turn)] : [])),
    }
  } else {
    knownAgentTurnsRef.current.ready = ready
  }
  const latestAgentId = [...turns].reverse().find((turn) => turn.kind === 'agent')?.id
  const streamingAgentKeys = new Set(turns.flatMap((turn) => (
    turn.kind === 'agent' && (
      turn.state === 'streaming' || (
        turn.state === undefined &&
        status === 'running' &&
        turn.id === latestAgentId
      )
    )
      ? [agentAnimationKey(turn)]
      : []
  )))
  const animateAgentKeys = new Set(
    motionEnabled && ready
      ? turns.flatMap((turn) => {
          if (turn.kind !== 'agent') return []
          const key = agentAnimationKey(turn)
          return streamingAgentKeys.has(key) &&
            !knownAgentTurnsRef.current.keys.has(key)
            ? [key]
            : []
        })
      : [],
  )

  React.useEffect(() => {
    if (knownAgentTurnsRef.current.sessionKey !== sessionKey || !ready) return
    knownAgentTurnsRef.current.keys = new Set(turns.flatMap((turn) =>
      turn.kind === 'agent' ? [agentAnimationKey(turn)] : []))
  }, [ready, sessionKey, turns])

  React.useEffect(() => {
    setTypingAgentKeys(new Set())
  }, [sessionKey])

  const handleTypingChange = React.useCallback((turnKey: string, typing: boolean) => {
    setTypingAgentKeys((current) => {
      if (current.has(turnKey) === typing) return current
      const next = new Set(current)
      if (typing) next.add(turnKey)
      else next.delete(turnKey)
      return next
    })
  }, [])

  const hiddenResponseActionIds = React.useMemo(() => {
    const hidden = new Set<string>()
    let typingResponse = false
    for (const turn of turns) {
      if (turn.kind === 'user') typingResponse = false
      else if (
        turn.kind === 'agent' &&
        (
          animateAgentKeys.has(agentAnimationKey(turn)) ||
          streamingAgentKeys.has(agentAnimationKey(turn)) ||
          typingAgentKeys.has(agentAnimationKey(turn))
        )
      ) typingResponse = true
      else if (turn.kind === 'response-actions' && typingResponse) {
        hidden.add(turn.id)
        typingResponse = false
      }
    }
    return hidden
  }, [animateAgentKeys, streamingAgentKeys, turns, typingAgentKeys])

  React.useEffect(() => {
    setHighlightedEntryId(null)
    if (highlightTimerRef.current) {
      clearTimeout(highlightTimerRef.current)
      highlightTimerRef.current = null
    }
  }, [ready, sessionKey])

  React.useEffect(() => () => {
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current)
  }, [])

  React.useEffect(() => {
    if (
      !ready ||
      !sessionKey ||
      !jumpRequest ||
      jumpRequest.sessionKey !== sessionKey
    ) return
    const target = anchorNodes.get(jumpRequest.entryId)
    if (!target) return

    pauseFollowing()
    setHighlightedEntryId(jumpRequest.entryId)
    target.scrollIntoView({
      block: 'start',
      behavior: motionEnabled ? 'smooth' : 'auto',
    })
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current)
    highlightTimerRef.current = setTimeout(() => {
      setHighlightedEntryId((current) =>
        current === jumpRequest.entryId ? null : current)
      highlightTimerRef.current = null
    }, 1_600)
  }, [anchorNodes, jumpRequest, ready, sessionKey, motionEnabled, pauseFollowing])

  const fork = (
    turn: Extract<Turn, { kind: 'response-actions' }>,
  ) => {
    const entryId = turn.forkEntryId
    if (!entryId || !onFork) return
    void forkFeedback.run(turn.id, () => onFork(entryId), t('sidebar.operationError.title'))
  }

  const responseGroups = React.useMemo(() => groupConversationTurns(turns), [turns])
  const projectedResponseGroups = React.useMemo(() => responseGroups.map((group, index) =>
    projectResponsePresentation(group, { active: index === responseGroups.length - 1, status }),
  ), [responseGroups, status])
  const renderSegment = (item: ResponsePresentationSegment, visible: boolean): React.ReactNode => {
    if (item.kind === 'activity-run') return <ToolActivityRegion
      run={item.run}
      visible={visible}
      sessionKey={sessionKey}
      selectedSubagentId={selectedSubagentId}
      focusRequest={subagentFocusRequest}
      onOpenSubagent={onOpenSubagent}
    />
    const turn = item.turn
    switch (turn.kind) {
      case 'user': return <UserMessage turn={turn} />
      case 'agent': {
        const animationKey = agentAnimationKey(turn)
        return <AgentMessage turn={turn} animationKey={animationKey}
          animateOnMount={animateAgentKeys.has(animationKey)} motionEnabled={motionEnabled}
          onTypingChange={handleTypingChange} streaming={streamingAgentKeys.has(animationKey)} />
      }
      case 'thinking': return <ThinkingMessage turn={turn} thinkingDurations={thinkingDurations} />
      case 'notice': return <NoticeMessage turn={turn} />
      case 'plan': return <PlanModeMessage turn={turn} onAction={onPlanAction} />
      case 'activity': return <ResponseActivityRow activity={turn.activity} />
      case 'response-actions':
        return hiddenResponseActionIds.has(turn.id) ? null : <ResponseActions
          turn={turn} forkBusy={forkFeedback.pending !== null} forking={forkFeedback.pending?.action === turn.id}
          onFork={fork} canFork={Boolean(turn.forkEntryId && onFork)} />
      default: return null
    }
  }
  const transcriptTyping = animateAgentKeys.size > 0 ||
    streamingAgentKeys.size > 0 ||
    typingAgentKeys.size > 0

  return (
    <div
      className="relative min-h-0 min-w-0 flex-1 overflow-x-hidden"
      role="log"
      aria-label={t('chat.title')}
      aria-busy={presentation.status === 'loading' || transcriptTyping || undefined}
      data-transcript-typing={transcriptTyping || undefined}
      onClickCapture={(event) => {
        if (event.target instanceof Element && event.target.closest('button[aria-expanded], summary')) pauseFollowing()
      }}
    >
      {!ready ? (
        <div className="flex h-full w-full items-center justify-center px-4 text-caption text-muted-foreground">
          {presentation.status === 'loading' ? (
            <div className="flex items-center gap-2" role="status">
              <TbLoader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
              {t('chat.loadingSession')}
            </div>
          ) : presentation.status === 'error' ? (
            <div className="flex max-w-lg items-center gap-2 text-destructive" role="alert">
              <TbAlertTriangle className="size-4 shrink-0" aria-hidden />
              <MarkdownContent markdown={presentation.error} />
            </div>
          ) : (
            emptyState ?? <p>{t('chat.noSession')}</p>
          )}
        </div>
      ) : (
        <div ref={scrollRef} {...scrollProps} tabIndex={0} className="scroll-slim h-full min-w-0 overflow-x-hidden overflow-y-auto outline-none focus-visible:focus-ring">
          <div ref={contentRef} className={cn('mx-auto flex w-full min-w-0 max-w-(--conversation-width) flex-col gap-10 px-6 py-8', turns.length === 0 && 'min-h-full justify-center')}>
            {turns.length === 0 && status !== 'running' && status !== 'planning' ? emptyState : null}
            {historyTruncated && (
              <div className="flex items-center gap-1.5 text-caption text-muted-foreground" role="status">
                <TbInfoCircle className="size-3.5 shrink-0" aria-hidden />
                {t('chat.historyTruncated')}
              </div>
            )}
            {projectedResponseGroups.map((response) => <ConversationResponse
              key={`${sessionKey}:${response.id}`}
              response={response}
              sessionKey={sessionKey}
              focusRequest={subagentFocusRequest}
              highlighted={Boolean(response.anchorEntryId && highlightedEntryId === response.anchorEntryId)}
              anchorRef={response.anchorEntryId ? (node) => {
                if (node) anchorNodes.set(response.anchorEntryId!, node)
                else anchorNodes.delete(response.anchorEntryId!)
              } : undefined}
              renderPrompt={(turn) => <UserMessage turn={turn} />}
              renderSegment={renderSegment}
            />)}
            {projectedResponseGroups.length === 0 && (status === 'running' || status === 'planning') ? (
              <div className="flex items-center gap-2 text-caption text-muted-foreground" role="status">
                <TbLoader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
                {t('chat.runningFollowup')}
              </div>
            ) : null}
            {forkFeedback.error ? (
              <div role="alert" className="break-words text-caption text-destructive [&_.md-body]:text-caption [&_.md-body]:text-destructive">
                <MarkdownContent markdown={forkFeedback.error} />
              </div>
            ) : null}
            <div className="h-2 shrink-0" />
          </div>
        </div>
      )}

      {ready && canJumpToLatest && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => scrollToLatest()}
          className={cn('absolute bottom-3 left-1/2 -translate-x-1/2 border border-border')}
          aria-label={t('chat.jumpToLatest')}
        >
          <TbArrowDown aria-hidden />
          {t('chat.jumpToLatest')}
        </Button>
      )}
    </div>
  )
}
