import * as React from 'react'
import { TbAlertTriangle, TbArrowDown, TbInfoCircle, TbLoader2 } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { ToolActivityRegion } from './ToolActivityRegion'
import { ResponseActivityRow } from './ExtensionSurfaces'
import { useFollowingViewport } from './useFollowingViewport'
import { UserMessage, AgentMessage, ThinkingMessage, NoticeMessage, PlanModeMessage, ResponseActions, agentAnimationKey, type ThinkingDurationRegistry } from './ConversationMessages'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import { createConversationResponseProjector, type ResponsePresentation, type ResponsePresentationSegment } from '@/renderer/pi-rpc/response-presentation'
import { ConversationResponse } from './ConversationResponse'
import { MarkdownContent } from './markdown/MarkdownContent'
import { useConversationOperationFeedback } from '@/renderer/composer/use-operation-feedback'
import { createTranscriptActivityProjector } from '@/renderer/pi-rpc/transcript-activity'
import { highlightSearchText, type ToolSearchRequest } from '@/renderer/conversation-text-search'
import type { ConversationSearchMatch } from '@/shared/conversation-search'
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
  onOpenCommand?: (toolCallId: string) => void
}

export interface ConversationJumpRequest {
  sessionKey: string
  entryId: string
  sequence: number
  query?: string
  match?: ConversationSearchMatch
}

const NO_TURN_KEYS: ReadonlySet<string> = new Set()
const renderPrompt = (turn: Extract<Turn, { kind: 'user' }>) => <UserMessage turn={turn} />

/** Completed rows receive stable data and flags while the live row advances. */
const ConversationRow = React.memo(function ConversationRow({ response, anchorNodes, highlighted,
  sessionKey, selectedSubagentId, subagentFocusRequest, onOpenSubagent, onOpenCommand, onPlanAction,
  animateAgentKeys, streamingAgentKeys, hiddenResponseActionIds, motionEnabled,
  onTypingChange, thinkingDurations, forkBusy, forkingId, onFork, canFork, searchRequest,
}: Pick<MessageListProps, 'sessionKey' | 'selectedSubagentId' | 'subagentFocusRequest' | 'onOpenSubagent' | 'onOpenCommand' | 'onPlanAction'> & {
  response: ResponsePresentation
  anchorNodes: Map<string, HTMLDivElement>
  highlighted: boolean
  searchRequest?: ConversationJumpRequest
  animateAgentKeys: ReadonlySet<string>
  streamingAgentKeys: ReadonlySet<string>
  hiddenResponseActionIds: ReadonlySet<string>
  motionEnabled: boolean
  onTypingChange(key: string, typing: boolean): void
  thinkingDurations: ThinkingDurationRegistry
  forkBusy: boolean
  forkingId: string | undefined
  onFork(turn: Extract<Turn, { kind: 'response-actions' }>): void
  canFork: boolean
}) {
  const t = useT()
  const toolSearch = React.useMemo<ToolSearchRequest | undefined>(() => searchRequest?.query && searchRequest.match?.role === 'toolResult'
    ? { sequence: searchRequest.sequence, query: searchRequest.query, toolCallId: searchRequest.match.toolCallId } : undefined, [searchRequest])
  const anchorRef = React.useCallback((node: HTMLDivElement | null) => {
    if (!response.anchorEntryId) return
    if (node) anchorNodes.set(response.anchorEntryId, node)
    else anchorNodes.delete(response.anchorEntryId)
  }, [anchorNodes, response.anchorEntryId])
  const renderSegment = (item: ResponsePresentationSegment, visible: boolean): React.ReactNode => {
    if (item.kind === 'activity-run') return <ToolActivityRegion run={item.run} visible={visible}
      sessionKey={sessionKey} selectedSubagentId={selectedSubagentId} focusRequest={subagentFocusRequest} searchRequest={toolSearch} onOpenSubagent={onOpenSubagent} onOpenCommand={onOpenCommand} />
    const turn = item.turn
    switch (turn.kind) {
      case 'user': return <UserMessage turn={turn} />
      case 'agent': {
        const key = agentAnimationKey(turn)
        return <AgentMessage turn={turn} animationKey={key} animateOnMount={animateAgentKeys.has(key)}
          motionEnabled={motionEnabled} onTypingChange={onTypingChange} streaming={streamingAgentKeys.has(key)} />
      }
      case 'thinking': return <ThinkingMessage turn={turn} thinkingDurations={thinkingDurations} />
      case 'notice': return <NoticeMessage turn={turn} />
      case 'plan': return <PlanModeMessage turn={turn} onAction={onPlanAction} />
      case 'activity': return <ResponseActivityRow activity={turn.activity} />
      case 'response-actions': return hiddenResponseActionIds.has(turn.id) ? null : <ResponseActions
        turn={turn} forkBusy={forkBusy} forking={forkingId === turn.id} onFork={onFork} canFork={Boolean(turn.forkEntryId && canFork)} />
      default: return null
    }
  }
  const match = toolSearch ? searchRequest?.match : undefined
  return <ConversationResponse response={response} sessionKey={sessionKey} focusRequest={subagentFocusRequest}
    highlighted={highlighted} anchorRef={anchorRef} renderPrompt={renderPrompt} renderSegment={renderSegment}
    searchPreview={match ? <aside data-conversation-search-result className="mac-box mb-4 space-y-1 p-3 text-caption">
      <p className="text-muted-foreground">{t('conversationSearch.toolContext')}</p>
      <pre className="whitespace-pre-wrap break-words font-mono">{match.snippet.slice(0, match.matchStart)}<mark className="rounded-sm bg-primary/20 text-foreground">{match.snippet.slice(match.matchStart, match.matchStart + match.matchLength)}</mark>{match.snippet.slice(match.matchStart + match.matchLength)}</pre>
    </aside> : undefined} />
})

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
  onOpenCommand,
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
  const activityProjector = React.useMemo(createTranscriptActivityProjector, [sessionKey])
  const activity = React.useMemo(() => activityProjector(turns, status), [activityProjector, turns, status])
  const knownAgentTurnsRef = React.useRef<{
    sessionKey: string | null
    ready: boolean
    keys: ReadonlySet<string>
  }>({
    sessionKey,
    ready: presentation.status === 'ready',
    keys: activity.agentKeys,
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
      keys: activity.agentKeys,
    }
  } else {
    knownAgentTurnsRef.current.ready = ready
  }
  const streamingAgentKeys = activity.streamingKeys
  const animateAgentKeys = React.useMemo(() => new Set(
    motionEnabled && ready
      ? [...streamingAgentKeys].filter((key) => !knownAgentTurnsRef.current.keys.has(key))
      : [],
  ), [motionEnabled, ready, streamingAgentKeys])

  React.useEffect(() => {
    if (knownAgentTurnsRef.current.sessionKey !== sessionKey || !ready) return
    knownAgentTurnsRef.current.keys = activity.agentKeys
  }, [activity.agentKeys, ready, sessionKey])

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
    for (const [id, keys] of activity.responseAgents) {
      if (keys.some((key) => animateAgentKeys.has(key) || streamingAgentKeys.has(key) || typingAgentKeys.has(key))) hidden.add(id)
    }
    return hidden
  }, [activity.responseAgents, animateAgentKeys, streamingAgentKeys, typingAgentKeys])

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
    return jumpRequest.query ? highlightSearchText(target, jumpRequest.query) : undefined
  }, [anchorNodes, jumpRequest, ready, sessionKey, motionEnabled, pauseFollowing])

  const fork = React.useCallback((
    turn: Extract<Turn, { kind: 'response-actions' }>,
  ) => {
    const entryId = turn.forkEntryId
    if (!entryId || !onFork) return
    void forkFeedback.run(turn.id, () => onFork(entryId), t('sidebar.operationError.title'))
  }, [forkFeedback.run, onFork, t])

  const responseProjector = React.useMemo(() => createConversationResponseProjector(), [sessionKey])
  const projectedResponseGroups = React.useMemo(() => responseProjector.project(turns, status), [responseProjector, turns, status])
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
        <div className="flex h-full w-full items-center justify-center px-4 pt-[var(--toolbar-inset,0px)] text-caption text-muted-foreground">
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
        <div ref={scrollRef} {...scrollProps} tabIndex={0} className="scroll-slim h-full min-w-0 scroll-pt-[calc(var(--toolbar-inset,0px)+12px)] overflow-x-hidden overflow-y-auto outline-none focus-visible:focus-ring">
          <div ref={contentRef} className={cn('mx-auto flex w-full min-w-0 max-w-(--conversation-width) flex-col gap-10 px-6 pt-[calc(var(--toolbar-inset,0px)+2rem)] pb-8', turns.length === 0 && 'min-h-full justify-center')}>
            {turns.length === 0 && status !== 'running' && status !== 'planning' ? emptyState : null}
            {historyTruncated && (
              <div className="flex items-center gap-1.5 text-caption text-muted-foreground" role="status">
                <TbInfoCircle className="size-3.5 shrink-0" aria-hidden />
                {t('chat.historyTruncated')}
              </div>
            )}
            {projectedResponseGroups.map((response) => <ConversationRow
              key={`${sessionKey}:${response.id}`}
              response={response}
              sessionKey={sessionKey}
              subagentFocusRequest={subagentFocusRequest}
              highlighted={Boolean(response.anchorEntryId && highlightedEntryId === response.anchorEntryId)}
              searchRequest={jumpRequest?.sessionKey === sessionKey && jumpRequest.entryId === response.anchorEntryId ? jumpRequest : undefined}
              anchorNodes={anchorNodes}
              selectedSubagentId={selectedSubagentId}
              onOpenSubagent={onOpenSubagent}
              onOpenCommand={onOpenCommand}
              onPlanAction={onPlanAction}
              animateAgentKeys={response.segments.some((item) => item.kind === 'turn' && item.turn.kind === 'agent' && animateAgentKeys.has(agentAnimationKey(item.turn))) ? animateAgentKeys : NO_TURN_KEYS}
              streamingAgentKeys={response.segments.some((item) => item.kind === 'turn' && item.turn.kind === 'agent' && streamingAgentKeys.has(agentAnimationKey(item.turn))) ? streamingAgentKeys : NO_TURN_KEYS}
              hiddenResponseActionIds={response.segments.some((item) => item.kind === 'turn' && hiddenResponseActionIds.has(item.turn.id)) ? hiddenResponseActionIds : NO_TURN_KEYS}
              motionEnabled={motionEnabled}
              onTypingChange={handleTypingChange}
              thinkingDurations={thinkingDurations}
              forkBusy={forkFeedback.pending !== null}
              forkingId={forkFeedback.pending?.action}
              onFork={fork}
              canFork={Boolean(onFork)}
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
          className={cn('glass absolute bottom-3 left-1/2 -translate-x-1/2 text-foreground hover:bg-(--glass-fill) hover:brightness-[0.97]')}
          aria-label={t('chat.jumpToLatest')}
        >
          <TbArrowDown aria-hidden />
          {t('chat.jumpToLatest')}
        </Button>
      )}
    </div>
  )
}
