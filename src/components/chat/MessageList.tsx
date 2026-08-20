import * as React from 'react'
import {
  TbAlertTriangle,
  TbArrowDown,
  TbBrain,
  TbChevronRight,
  TbCheck,
  TbCopy,
  TbGitFork,
  TbInfoCircle,
  TbLoader2,
  TbDeviceFloppy,
  TbDownload,
  TbEye,
  TbFileDescription,
  TbFlag,
  TbLogout,
  TbPencil,
  TbPlayerPlay,
} from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ToolActivityRegion } from './ToolActivityRegion'
import { UserMessageContent } from './UserMessageContent'
import { ResponseActivityRow } from './ExtensionSurfaces'
import { MarkdownContent } from './markdown/MarkdownContent'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import {
  nextTypewriterText,
  shouldStartTypewriterFromEmpty,
} from '@/renderer/pi-rpc/live-typewriter'
import { groupConversationTurns } from '@/renderer/pi-rpc/presentation'
import { projectToolActivitySequence } from '@/renderer/pi-rpc/tool-activity'
import { useSettings } from '@/store/settings'
import type { PiConversationPresentation } from '@/store/pi-rpc'
import type {
  AgentStatus,
  SubagentInspectorFocusRequest,
  Turn,
} from '@/types/chat'

interface MessageListProps {
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

const UserMessage = React.memo(function UserMessage({ turn }: { turn: Extract<Turn, { kind: 'user' }> }) {
  const { locale } = useSettings()
  const time = turn.timestamp === undefined
    ? turn.time
    : new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' })
        .format(turn.timestamp)
  return (
    <div className="ml-auto w-fit max-w-[75%]">
      <div className="rounded-lg border border-sage/25 bg-sage/10 px-3 py-2">
        <UserMessageContent text={turn.text} images={turn.images} />
      </div>
      <div className="mt-0.5 flex justify-end pr-0.5">
        <time className="text-micro tabular-nums text-muted-foreground/70">{time}</time>
      </div>
    </div>
  )
})

const AgentMessage = React.memo(function AgentMessage({
  turn,
  streaming,
  animateOnMount,
  motionEnabled,
  onTypingChange,
}: {
  turn: Extract<Turn, { kind: 'agent' }>
  streaming?: boolean
  animateOnMount: boolean
  motionEnabled: boolean
  onTypingChange: (turnId: string, typing: boolean) => void
}) {
  const t = useT()
  const startFromEmpty = shouldStartTypewriterFromEmpty(
    motionEnabled,
    animateOnMount,
    Boolean(streaming),
  )
  const enabledRef = React.useRef(
    motionEnabled && (animateOnMount || Boolean(streaming)),
  )
  const targetRef = React.useRef(turn.markdown)
  const streamingRef = React.useRef(Boolean(streaming))
  const frameRef = React.useRef<number | null>(null)
  const lastTickRef = React.useRef(0)
  const tickRef = React.useRef<(timestamp: number) => void>(() => undefined)
  const [displayedMarkdown, setDisplayedMarkdown] = React.useState(() =>
    startFromEmpty ? '' : turn.markdown)
  const [typing, setTyping] = React.useState(startFromEmpty)
  const displayedRef = React.useRef(displayedMarkdown)
  targetRef.current = turn.markdown
  streamingRef.current = Boolean(streaming)

  const cancelFrame = React.useCallback(() => {
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
  }, [])
  const scheduleTick = React.useCallback(() => {
    if (frameRef.current !== null) return
    frameRef.current = window.requestAnimationFrame((timestamp) => {
      frameRef.current = null
      tickRef.current(timestamp)
    })
  }, [])
  tickRef.current = (timestamp) => {
    if (!enabledRef.current) return
    if (timestamp - lastTickRef.current < 28) {
      scheduleTick()
      return
    }
    lastTickRef.current = timestamp
    const target = targetRef.current
    const next = nextTypewriterText(
      displayedRef.current,
      target,
      !streamingRef.current,
    )
    if (next !== displayedRef.current) {
      displayedRef.current = next
      setDisplayedMarkdown(next)
    }
    const hasBacklog = next !== target
    setTyping(streamingRef.current || hasBacklog)
    if (hasBacklog) scheduleTick()
    else if (!streamingRef.current) enabledRef.current = false
  }

  React.useEffect(() => {
    if (!motionEnabled) {
      enabledRef.current = false
      cancelFrame()
      displayedRef.current = turn.markdown
      setDisplayedMarkdown(turn.markdown)
      setTyping(false)
      return
    }

    if (!enabledRef.current && streaming) enabledRef.current = true
    if (!enabledRef.current) {
      displayedRef.current = turn.markdown
      setDisplayedMarkdown(turn.markdown)
      setTyping(false)
      return
    }

    const hasBacklog = displayedRef.current !== turn.markdown
    setTyping(Boolean(streaming) || hasBacklog)
    if (hasBacklog) scheduleTick()
    else if (!streaming) enabledRef.current = false
  }, [cancelFrame, motionEnabled, scheduleTick, streaming, turn.markdown])

  React.useEffect(() => {
    onTypingChange(turn.id, typing)
  }, [onTypingChange, turn.id, typing])

  React.useEffect(() => () => onTypingChange(turn.id, false), [onTypingChange, turn.id])
  React.useEffect(() => () => cancelFrame(), [cancelFrame])

  return (
    <div>
      <MarkdownContent markdown={displayedMarkdown} streaming={typing || Boolean(streaming)} />
      {!typing && (turn.state === 'aborted' || turn.state === 'error') ? (
        <div className="mt-1 flex items-center gap-1.5 text-caption text-muted-foreground" role="status">
          <TbAlertTriangle className="size-3.5" aria-hidden />
          {t(turn.state === 'aborted' ? 'chat.responseAborted' : 'chat.responseError')}
        </div>
      ) : null}
    </div>
  )
})

const ThinkingMessage = React.memo(function ThinkingMessage({ turn }: { turn: Extract<Turn, { kind: 'thinking' }> }) {
  const t = useT()
  const streaming = turn.state === 'streaming'
  const [open, setOpen] = React.useState(streaming)
  const previousStreamingRef = React.useRef(streaming)
  const contentId = React.useId()

  React.useEffect(() => {
    if (previousStreamingRef.current === streaming) return
    previousStreamingRef.current = streaming
    setOpen(streaming)
  }, [streaming])

  return (
    <div className="text-caption text-muted-foreground">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((value) => !value)}
        className="flex cursor-pointer items-center gap-1.5 font-medium outline-none transition-colors duration-(--duration-fast) hover:text-foreground focus-visible:focus-ring motion-reduce:transition-none"
      >
        <TbChevronRight
          className={cn(
            'size-3.5 shrink-0 transition-transform duration-(--duration-fast) motion-reduce:transition-none',
            open && 'rotate-90',
          )}
          aria-hidden
        />
        {streaming ? (
          <TbLoader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
        ) : (
          <TbBrain className="size-3.5" aria-hidden />
        )}
        {t('chat.thinking')}
      </button>
      {open && turn.text ? (
        <div id={contentId} className="mt-1 border-l-2 border-border/60 pl-3 opacity-90">
          <MarkdownContent markdown={turn.text} streaming={streaming} />
        </div>
      ) : null}
    </div>
  )
})

const noticeKeys = {
  compacting: 'chat.compacting',
  compacted: 'chat.compacted',
  'compaction-failed': 'chat.compactionFailed',
  'response-aborted': 'chat.responseAborted',
  'response-error': 'chat.responseError',
} as const

const NoticeMessage = React.memo(function NoticeMessage({ turn }: { turn: Extract<Turn, { kind: 'notice' }> }) {
  const t = useT()
  const failed = turn.notice === 'compaction-failed' || turn.notice === 'response-error'
  return (
    <div className={cn('flex items-center gap-1.5 text-caption text-muted-foreground', failed && 'text-destructive')} role="status">
      {failed ? <TbAlertTriangle className="size-3.5" aria-hidden /> : <TbInfoCircle className="size-3.5" aria-hidden />}
      {t(noticeKeys[turn.notice])}
    </div>
  )
})

const planLifecycleKeys = {
  planning: 'plan.lifecycle.planning',
  ready: 'plan.lifecycle.ready',
  saved: 'plan.lifecycle.saved',
  implementing: 'plan.lifecycle.implementing',
} as const

const planActionKeys = {
  show: 'plan.action.show',
  finalize: 'plan.action.finalize',
  implement: 'plan.action.implement',
  save: 'plan.action.save',
  export: 'plan.action.export',
  revise: 'plan.action.revise',
  exit: 'plan.action.exit',
} as const

const planActionIcons = {
  show: TbEye,
  finalize: TbFlag,
  implement: TbPlayerPlay,
  save: TbDeviceFloppy,
  export: TbDownload,
  revise: TbPencil,
  exit: TbLogout,
}

interface PlanModeMessageProps {
  turn: Extract<Turn, { kind: 'plan' }>
  onAction?: MessageListProps['onPlanAction']
}

const PlanModeMessage = React.memo(function PlanModeMessage({
  turn,
  onAction,
}: PlanModeMessageProps) {
  const t = useT()
  const [busy, setBusy] = React.useState<string | null>(null)
  const [error, setError] = React.useState(false)
  const [revisionOpen, setRevisionOpen] = React.useState(false)
  const [revision, setRevision] = React.useState('')
  const [revisionSent, setRevisionSent] = React.useState(false)

  const runAction = React.useCallback(async (
    action: Extract<Turn, { kind: 'plan' }>['actions'][number],
    revisionText?: string,
  ) => {
    if (!onAction || busy || revisionSent) return
    setBusy(action)
    setError(false)
    try {
      await onAction(action, revisionText)
      if (action === 'revise') {
        setRevisionSent(true)
        setRevisionOpen(false)
        setRevision('')
      }
    } catch {
      setError(true)
    } finally {
      setBusy(null)
    }
  }, [busy, onAction, revisionSent])

  return (
    <section
      aria-label={t('plan.title')}
      className="overflow-hidden rounded-md border border-border bg-card"
    >
      <header className="flex min-h-9 items-center gap-2 border-b border-border bg-muted/35 px-3 py-1.5">
        <TbFileDescription className="size-4 shrink-0 text-sage" aria-hidden />
        <h3 className="min-w-0 flex-1 text-caption font-medium text-foreground">
          {t('plan.title')}
        </h3>
        <span className="shrink-0 text-micro text-muted-foreground">
          {t(planLifecycleKeys[revisionSent ? 'planning' : turn.lifecycle])}
        </span>
      </header>
      <div className="max-h-[50vh] overflow-y-auto px-3 py-2.5">
        <MarkdownContent markdown={turn.markdown} />
      </div>
      <footer className="flex min-h-10 flex-wrap items-center gap-1 border-t border-border px-2 py-1.5">
        {turn.actions.map((action) => {
          const Icon = planActionIcons[action]
          return (
            <Button
              key={action}
              variant="ghost"
              size="sm"
              disabled={!onAction || Boolean(busy) || revisionSent}
              aria-busy={busy === action || undefined}
              onClick={() => {
                if (action === 'revise') setRevisionOpen(true)
                else void runAction(action)
              }}
            >
              {busy === action
                ? <TbLoader2 className="animate-spin motion-reduce:animate-none" aria-hidden />
                : <Icon aria-hidden />}
              {t(planActionKeys[action])}
            </Button>
          )
        })}
        {error ? (
          <span className="ml-auto text-micro text-destructive" role="alert">
            {t('plan.action.failed')}
          </span>
        ) : null}
      </footer>

      <Dialog open={revisionOpen} onOpenChange={setRevisionOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t('plan.revise.title')}</DialogTitle>
            <DialogDescription>{t('plan.revise.description')}</DialogDescription>
          </DialogHeader>
          <Textarea
            value={revision}
            onChange={(event) => setRevision(event.target.value)}
            placeholder={t('plan.revise.placeholder')}
            aria-label={t('plan.revise.input')}
            className="min-h-28 resize-y"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevisionOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              disabled={!revision.trim() || Boolean(busy)}
              onClick={() => void runAction('revise', revision.trim())}
            >
              {busy === 'revise' && (
                <TbLoader2 className="animate-spin motion-reduce:animate-none" aria-hidden />
              )}
              {t('plan.action.revise')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
})

interface ResponseActionsProps {
  turn: Extract<Turn, { kind: 'response-actions' }>
  forkBusy: boolean
  forking: boolean
  onFork: (turn: Extract<Turn, { kind: 'response-actions' }>) => void
  canFork: boolean
}

const ResponseActions = React.memo(function ResponseActions({
  turn,
  forkBusy,
  forking,
  onFork,
  canFork,
}: ResponseActionsProps) {
  const t = useT()
  const [copyState, setCopyState] = React.useState<'idle' | 'copied' | 'failed'>('idle')
  const feedbackTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  React.useEffect(() => () => {
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current)
  }, [])

  const copy = async () => {
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current)
    try {
      await navigator.clipboard.writeText(turn.copyMarkdown)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
    feedbackTimer.current = setTimeout(() => setCopyState('idle'), 1_400)
  }

  const copyLabel = copyState === 'failed'
    ? t('chat.response.copyFailed')
    : copyState === 'copied'
      ? t('chat.response.copied')
      : t('chat.response.copy')
  const forkLabel = canFork
    ? t('chat.response.fork')
    : t('chat.response.forkUnavailable')

  return (
    <div className="flex h-6 items-center gap-0.5 text-muted-foreground">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => void copy()}
            aria-label={copyLabel}
          >
            {copyState === 'copied'
              ? <TbCheck className="text-sage" aria-hidden />
              : <TbCopy aria-hidden />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{copyLabel}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">
            <Button
              variant="ghost"
              size="icon-xs"
              disabled={forkBusy || !canFork}
              onClick={() => onFork(turn)}
              aria-label={forkLabel}
              aria-busy={forking || undefined}
            >
              {forking
                ? <TbLoader2 className="animate-spin motion-reduce:animate-none" aria-hidden />
                : <TbGitFork aria-hidden />}
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>{forkLabel}</TooltipContent>
      </Tooltip>
      {copyState === 'failed' ? (
        <span className="max-w-48 truncate pl-1 text-micro text-destructive" role="alert">
          {t('chat.response.copyFailed')}
        </span>
      ) : null}
    </div>
  )
})

export function MessageList({
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
  const smooth = motionEnabled
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const contentRef = React.useRef<HTMLDivElement>(null)
  const anchorNodes = React.useMemo(
    () => new Map<string, HTMLDivElement>(),
    [sessionKey],
  )
  const highlightTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const followingRef = React.useRef(true)
  const forkingRef = React.useRef<string | null>(null)
  const knownTurnsRef = React.useRef<{
    sessionKey: string | null
    ids: Set<string>
  }>({
    sessionKey,
    ids: new Set(turns.map((turn) => turn.id)),
  })
  const [atBottom, setAtBottom] = React.useState(true)
  const [forkingTurnId, setForkingTurnId] = React.useState<string | null>(null)
  const [highlightedEntryId, setHighlightedEntryId] = React.useState<string | null>(null)
  const [typingAgentIds, setTypingAgentIds] = React.useState<ReadonlySet<string>>(
    () => new Set(),
  )
  const ready = presentation.status === 'ready'
  if (knownTurnsRef.current.sessionKey !== sessionKey) {
    knownTurnsRef.current = {
      sessionKey,
      ids: new Set(turns.map((turn) => turn.id)),
    }
  }
  const animateAgentIds = new Set(
    motionEnabled && ready
      ? turns
          .filter((turn) => turn.kind === 'agent' && !knownTurnsRef.current.ids.has(turn.id))
          .map((turn) => turn.id)
      : [],
  )
  const latestAgentId = [...turns].reverse().find((turn) => turn.kind === 'agent')?.id
  const streamingAgentIds = new Set(turns.flatMap((turn) => (
    turn.kind === 'agent' && (
      turn.state === 'streaming' || (
        turn.state === undefined &&
        status === 'running' &&
        turn.id === latestAgentId
      )
    )
      ? [turn.id]
      : []
  )))

  React.useEffect(() => {
    if (knownTurnsRef.current.sessionKey !== sessionKey) return
    knownTurnsRef.current.ids = new Set(turns.map((turn) => turn.id))
  }, [sessionKey, turns])

  React.useEffect(() => {
    setTypingAgentIds(new Set())
  }, [sessionKey])

  const handleTypingChange = React.useCallback((turnId: string, typing: boolean) => {
    setTypingAgentIds((current) => {
      const hasTurn = current.has(turnId)
      if (hasTurn === typing) return current
      const next = new Set(current)
      if (typing) next.add(turnId)
      else next.delete(turnId)
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
          typingAgentIds.has(turn.id) ||
          animateAgentIds.has(turn.id) ||
          streamingAgentIds.has(turn.id)
        )
      ) typingResponse = true
      else if (turn.kind === 'response-actions' && typingResponse) {
        hidden.add(turn.id)
        typingResponse = false
      }
    }
    return hidden
  }, [animateAgentIds, streamingAgentIds, turns, typingAgentIds])

  React.useEffect(() => {
    setHighlightedEntryId(null)
    followingRef.current = true
    setAtBottom(true)
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

    followingRef.current = false
    setAtBottom(false)
    setHighlightedEntryId(jumpRequest.entryId)
    target.scrollIntoView({
      block: 'start',
      behavior: smooth ? 'smooth' : 'auto',
    })
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current)
    highlightTimerRef.current = setTimeout(() => {
      setHighlightedEntryId((current) =>
        current === jumpRequest.entryId ? null : current)
      highlightTimerRef.current = null
    }, 1_600)
  }, [anchorNodes, jumpRequest, ready, sessionKey, smooth])

  const scrollToBottom = React.useCallback((useSmooth = true) => {
    const el = scrollRef.current
    if (!el) return
    followingRef.current = true
    setAtBottom(true)
    el.scrollTo({ top: el.scrollHeight, behavior: smooth && useSmooth ? 'smooth' : 'auto' })
  }, [smooth])

  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 48
    followingRef.current = near
    setAtBottom((previous) => previous === near ? previous : near)
  }

  React.useEffect(() => {
    if (ready && followingRef.current) scrollToBottom(false)
  }, [ready, revision, scrollToBottom])

  React.useEffect(() => {
    const content = contentRef.current
    if (!content || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      if (followingRef.current) scrollToBottom(false)
    })
    observer.observe(content)
    return () => observer.disconnect()
  }, [ready, scrollToBottom])

  const fork = React.useCallback(async (
    turn: Extract<Turn, { kind: 'response-actions' }>,
  ) => {
    if (!turn.forkEntryId || !onFork || forkingRef.current) return
    forkingRef.current = turn.id
    setForkingTurnId(turn.id)
    try {
      await onFork(turn.forkEntryId)
    } catch {
      // The Pi provider owns the typed operation error presentation.
    } finally {
      if (forkingRef.current === turn.id) {
        forkingRef.current = null
        setForkingTurnId(null)
      }
    }
  }, [onFork])

  const responseGroups = React.useMemo(() => groupConversationTurns(turns), [turns])
  const projectedResponseGroups = React.useMemo(() => responseGroups.map((group) => ({
    ...group,
    displaySequence: projectToolActivitySequence(group.turns),
  })), [responseGroups])
  const transcriptTyping = typingAgentIds.size > 0 ||
    animateAgentIds.size > 0 ||
    streamingAgentIds.size > 0

  return (
    <div
      className="relative min-h-0 min-w-0 flex-1 overflow-x-hidden"
      role="log"
      aria-label={t('chat.title')}
      aria-busy={presentation.status === 'loading' || transcriptTyping || undefined}
      data-transcript-typing={transcriptTyping || undefined}
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
              <span>{presentation.error}</span>
            </div>
          ) : (
            <p>{t('chat.noSession')}</p>
          )}
        </div>
      ) : (
        <div ref={scrollRef} onScroll={handleScroll} className="scroll-slim h-full min-w-0 overflow-x-hidden overflow-y-auto">
          <div ref={contentRef} className="mx-auto flex w-full min-w-0 max-w-[920px] flex-col gap-6 px-4 py-5">
            {historyTruncated && (
              <div className="flex items-center gap-1.5 text-caption text-muted-foreground" role="status">
                <TbInfoCircle className="size-3.5 shrink-0" aria-hidden />
                {t('chat.historyTruncated')}
              </div>
            )}
            {projectedResponseGroups.map((group, groupIndex) => {
              const groupContent = group.displaySequence.map((item) => {
                if (item.kind === 'activity-run') {
                  return (
                    <ToolActivityRegion
                      key={item.id}
                      run={item.run}
                      sessionKey={sessionKey}
                      selectedSubagentId={selectedSubagentId}
                      focusRequest={subagentFocusRequest}
                      onOpenSubagent={onOpenSubagent}
                    />
                  )
                }
                const turn = item.turn
                if (turn.kind === 'response-actions' && hiddenResponseActionIds.has(turn.id)) {
                  return null
                }
                let content: React.ReactNode
                switch (turn.kind) {
                  case 'user':
                    content = <UserMessage turn={turn} />
                    break
                  case 'agent':
                    content = (
                      <AgentMessage
                        turn={turn}
                        animateOnMount={animateAgentIds.has(turn.id)}
                        motionEnabled={motionEnabled}
                        onTypingChange={handleTypingChange}
                        streaming={streamingAgentIds.has(turn.id)}
                      />
                    )
                    break
                  case 'thinking':
                    content = <ThinkingMessage turn={turn} />
                    break
                  case 'notice':
                    content = <NoticeMessage turn={turn} />
                    break
                  case 'plan':
                    content = (
                      <PlanModeMessage
                        turn={turn}
                        onAction={onPlanAction}
                      />
                    )
                    break
                  case 'activity':
                    content = <ResponseActivityRow activity={turn.activity} />
                    break
                  case 'response-actions':
                    content = (
                      <ResponseActions
                        turn={turn}
                        forkBusy={forkingTurnId !== null}
                        forking={forkingTurnId === turn.id}
                        onFork={(selected) => void fork(selected)}
                        canFork={Boolean(turn.forkEntryId && onFork)}
                      />
                    )
                    break
                  default:
                    return null
                }
                return <React.Fragment key={turn.id}>{content}</React.Fragment>
              })

              const entryId = group.anchorEntryId
              return (
                <div
                  key={group.id}
                  ref={entryId ? (node) => {
                    if (node) anchorNodes.set(entryId, node)
                    else anchorNodes.delete(entryId)
                  } : undefined}
                  data-conversation-outline-entry={entryId}
                  data-outline-highlighted={entryId && highlightedEntryId === entryId || undefined}
                  className={cn(
                    'min-w-0 space-y-3 rounded-md transition-[box-shadow,background-color] duration-(--duration-base) motion-reduce:transition-none',
                    entryId && highlightedEntryId === entryId &&
                      'bg-accent/50 ring-2 ring-inset ring-ring/60',
                  )}
                >
                  {groupContent}
                  {groupIndex === projectedResponseGroups.length - 1 &&
                  (status === 'running' || status === 'planning') ? (
                    <div className="flex items-center gap-2 text-caption text-muted-foreground" role="status">
                      <TbLoader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
                      {t('chat.runningFollowup')}
                    </div>
                  ) : null}
                </div>
              )
            })}
            {projectedResponseGroups.length === 0 && (status === 'running' || status === 'planning') ? (
              <div className="flex items-center gap-2 text-caption text-muted-foreground" role="status">
                <TbLoader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
                {t('chat.runningFollowup')}
              </div>
            ) : null}
            <div className="h-2 shrink-0" />
          </div>
        </div>
      )}

      {ready && !atBottom && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => scrollToBottom()}
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
