import * as React from 'react'
import { TbAlertTriangle, TbBrain, TbChevronRight, TbCheck, TbCopy, TbGitFork, TbInfoCircle, TbLoader2, TbDeviceFloppy, TbDownload, TbEye, TbFileDescription, TbFlag, TbLogout, TbPencil, TbPlayerPlay } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { UserMessageContent } from './UserMessageContent'
import { MarkdownContent } from './markdown/MarkdownContent'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import { nextTypewriterText, shouldStartTypewriterFromEmpty, thinkingDisclosureAfterPhaseChange } from '@/renderer/pi-rpc/live-typewriter'
import { parsePromptSkillEnvelope } from '@/renderer/pi-rpc/prompt-presentation'
import { useSettings } from '@/store/settings'
import type { Turn } from '@/types/chat'

export const UserMessage = React.memo(function UserMessage({ turn }: { turn: Extract<Turn, { kind: 'user' }> }) {
  const t = useT()
  const { locale } = useSettings()
  const [copied, setCopied] = React.useState(false)
  const [copyFailed, setCopyFailed] = React.useState(false)
  const [expanded, setExpanded] = React.useState(false)
  const questionId = React.useId()
  const questionText = React.useMemo(() => parsePromptSkillEnvelope(turn.text)?.userMessage ?? turn.text, [turn.text])
  const longQuestion = questionText.length > 600 || questionText.split('\n').length > 7
  const copyTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  React.useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current) }, [])
  const time = turn.timestamp === undefined
    ? turn.time
    : new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' })
        .format(turn.timestamp)
  return (
    <div className="group/question ml-auto w-fit min-w-0 max-w-[88%]" data-conversation-question>
      <div className="min-w-0 rounded-lg bg-muted/75 px-4 py-3.5">
        <div id={questionId} className={cn('conversation-question-content min-w-0 text-foreground', longQuestion && !expanded && '[&_[data-prompt-message]]:max-h-40 [&_[data-prompt-message]]:overflow-hidden')}>
          <UserMessageContent text={turn.text} />
        </div>
        {longQuestion ? <Button variant="ghost" size="sm" className="mt-2 -ml-2 text-caption text-muted-foreground" aria-expanded={expanded} aria-controls={questionId} onClick={() => setExpanded((value) => !value)}>{t(expanded ? 'chat.question.collapse' : 'chat.question.expand')}</Button> : null}
        {turn.images?.length ? <div className="mt-3"><UserMessageContent text="" images={turn.images} /></div> : null}
      </div>
      <div className="mt-1 flex items-center justify-end gap-2 text-micro text-muted-foreground">
        <Button variant="ghost" size="icon-xs" className="ml-auto opacity-0 group-hover/question:opacity-100 focus-visible:opacity-100" aria-label={t(copied ? 'chat.messageCopied' : copyFailed ? 'chat.response.copyFailed' : 'chat.user.copy')} onClick={() => {
          void navigator.clipboard.writeText(turn.text).then(() => { setCopied(true); setCopyFailed(false) }).catch(() => setCopyFailed(true))
          if (copyTimer.current) clearTimeout(copyTimer.current)
          copyTimer.current = setTimeout(() => setCopied(false), 1400)
        }}>{copied ? <TbCheck aria-hidden /> : <TbCopy aria-hidden />}</Button>
        <time className="tabular-nums">{time}</time>
      </div>
      {copyFailed ? <p role="status" className="mt-2 text-caption text-destructive">{t('chat.response.copyFailed')}</p> : null}
    </div>
  )
})

/** Smooth bursty live chunks without replaying hydrated history. */
function useSmoothedStreamingText({
  target,
  animateOnMount,
  motionEnabled,
  streaming,
  onTypingChange,
}: {
  target: string
  animateOnMount: boolean
  motionEnabled: boolean
  streaming: boolean
  onTypingChange(typing: boolean): void
}): string {
  const enabledRef = React.useRef(shouldStartTypewriterFromEmpty(
    motionEnabled,
    animateOnMount,
    streaming,
  ))
  const initialText = enabledRef.current ? '' : target
  const [displayed, setDisplayed] = React.useState(initialText)
  const displayedRef = React.useRef(initialText)
  const targetRef = React.useRef(target)
  const streamingRef = React.useRef(streaming)
  const frameRef = React.useRef<number | null>(null)
  const lastTickRef = React.useRef(0)
  targetRef.current = target
  streamingRef.current = streaming

  React.useEffect(() => {
    if (!motionEnabled || !streaming) {
      enabledRef.current = false
      displayedRef.current = target
      setDisplayed(target)
      onTypingChange(false)
      return
    }

    if (streaming) enabledRef.current = true
    if (!enabledRef.current) {
      displayedRef.current = target
      setDisplayed(target)
      onTypingChange(false)
      return
    }

    onTypingChange(streaming || displayedRef.current !== target)
    if (displayedRef.current === target) {
      if (!streaming) enabledRef.current = false
      return
    }

    if (frameRef.current !== null) return
    const tick = (timestamp: number) => {
      frameRef.current = null
      if (timestamp - lastTickRef.current < 28) {
        frameRef.current = window.requestAnimationFrame(tick)
        return
      }
      lastTickRef.current = timestamp
      const current = displayedRef.current
      const goal = targetRef.current
      const next = nextTypewriterText(current, goal, !streamingRef.current)
      if (next === current) {
        onTypingChange(streamingRef.current)
        if (!streamingRef.current) enabledRef.current = false
        return
      }
      displayedRef.current = next
      setDisplayed(next)
      const typing = streamingRef.current || next !== goal
      onTypingChange(typing)
      if (next !== goal) frameRef.current = window.requestAnimationFrame(tick)
      else if (!streamingRef.current) enabledRef.current = false
    }
    frameRef.current = window.requestAnimationFrame(tick)
    return () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
    }
  }, [motionEnabled, onTypingChange, streaming, target])

  React.useEffect(() => () => onTypingChange(false), [onTypingChange])

  return streaming && motionEnabled ? displayed : target
}

export const AgentMessage = React.memo(function AgentMessage({
  turn,
  animationKey,
  animateOnMount,
  streaming,
  motionEnabled,
  onTypingChange,
}: {
  turn: Extract<Turn, { kind: 'agent' }>
  animationKey: string
  animateOnMount: boolean
  streaming?: boolean
  motionEnabled: boolean
  onTypingChange(turnKey: string, typing: boolean): void
}) {
  const t = useT()
  const handleTypingChange = React.useCallback((typing: boolean) => {
    onTypingChange(animationKey, typing)
  }, [animationKey, onTypingChange])
  const markdown = useSmoothedStreamingText({
    target: turn.markdown,
    animateOnMount,
    motionEnabled,
    streaming: Boolean(streaming),
    onTypingChange: handleTypingChange,
  })
  const settled = !streaming && markdown === turn.markdown

  return (
    <div className="conversation-answer-content min-w-0">
      <MarkdownContent markdown={markdown} streaming={!settled} />
      {settled && (turn.state === 'aborted' || turn.state === 'error') ? (
        <div className="mt-1 flex items-center gap-1.5 text-caption text-muted-foreground" role="status">
          <TbAlertTriangle className="size-3.5" aria-hidden />
          {t(turn.state === 'aborted' ? 'chat.responseAborted' : 'chat.responseError')}
        </div>
      ) : null}
    </div>
  )
})

export interface ThinkingDurationRegistry {
  started: Map<string, number>
  completed: Map<string, number>
}

export function transientTurnAnimationKey(turnId: string) {
  return turnId.replace(
    /:(?:stream|message):(\d+):[^:]+:/,
    ':message:$1:',
  )
}

export function agentAnimationKey(turn: Extract<Turn, { kind: 'agent' }>) {
  return transientTurnAnimationKey(turn.id)
}

export const ThinkingMessage = React.memo(function ThinkingMessage({
  turn,
  thinkingDurations,
}: {
  turn: Extract<Turn, { kind: 'thinking' }>
  thinkingDurations: ThinkingDurationRegistry
}) {
  const t = useT()
  const streaming = turn.state === 'streaming'
  const [open, setOpen] = React.useState(streaming)
  const previousStreamingRef = React.useRef(streaming)
  const manualOpenRef = React.useRef<boolean | null>(null)
  const contentId = React.useId()
  const durationKey = React.useMemo(
    () => transientTurnAnimationKey(turn.id),
    [turn.id],
  )
  const [elapsedSeconds, setElapsedSeconds] = React.useState<number | null>(
    () => thinkingDurations.completed.get(durationKey) ?? null,
  )

  React.useEffect(() => {
    const nextOpen = thinkingDisclosureAfterPhaseChange(
      previousStreamingRef.current,
      streaming,
      manualOpenRef.current,
    )
    if (nextOpen === null) return
    previousStreamingRef.current = streaming
    if (streaming) manualOpenRef.current = null
    setOpen(nextOpen)
  }, [streaming])

  React.useEffect(() => {
    if (!streaming) {
      const startedAt = thinkingDurations.started.get(durationKey)
      if (startedAt !== undefined && !thinkingDurations.completed.has(durationKey)) {
        const elapsed = Math.max(1, Math.round((Date.now() - startedAt) / 1000))
        thinkingDurations.completed.set(durationKey, elapsed)
        setElapsedSeconds(elapsed)
      }
      return
    }
    if (!thinkingDurations.started.has(durationKey)) {
      thinkingDurations.started.set(durationKey, Date.now())
    }
    const startedAt = thinkingDurations.started.get(durationKey) ?? Date.now()
    const tick = () => setElapsedSeconds(Math.max(0, Math.round((Date.now() - startedAt) / 1000)))
    tick()
    const interval = window.setInterval(tick, 1000)
    return () => window.clearInterval(interval)
  }, [streaming, durationKey, thinkingDurations])

  const label = streaming
    ? t('chat.thinkingElapsed', { seconds: elapsedSeconds ?? 0 })
    : elapsedSeconds !== null
      ? t('chat.thoughtFor', { seconds: elapsedSeconds })
      : t('chat.thought')

  return (
    <Collapsible
      open={open}
      onOpenChange={(nextOpen) => {
        manualOpenRef.current = nextOpen
        setOpen(nextOpen)
      }}
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={contentId}
          className="flex w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-sm px-0.5 py-1 text-left text-caption outline-none transition-colors duration-(--duration-fast) hover:bg-accent/20 focus-visible:focus-ring motion-reduce:transition-none"
        >
          <TbChevronRight
            className={cn(
              'size-3.5 shrink-0 text-muted-foreground transition-transform duration-(--duration-fast) motion-reduce:transition-none',
              open && 'rotate-90',
            )}
            aria-hidden
          />
          <TbBrain className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span className={cn('font-medium italic', streaming ? 'text-shimmer' : 'text-muted-foreground')}>
            {label}
          </span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent id={contentId}>
        <div className="mb-2 mt-2 text-caption leading-relaxed text-muted-foreground">
          <MarkdownContent markdown={turn.text} streaming={streaming} />
        </div>
      </CollapsibleContent>
      {turn.state === 'error' || turn.state === 'aborted' ? <p role="status" className={cn('mt-1 text-caption', turn.state === 'error' ? 'text-destructive' : 'text-muted-foreground')}>
        {t(turn.state === 'error' ? 'chat.thinking.failed' : 'chat.thinking.stopped')}
      </p> : null}
    </Collapsible>
  )
})

const noticeKeys = {
  compacting: 'chat.compacting',
  compacted: 'chat.compacted',
  'compaction-failed': 'chat.compactionFailed',
  'response-aborted': 'chat.responseAborted',
  'response-error': 'chat.responseError',
} as const

export const NoticeMessage = React.memo(function NoticeMessage({ turn }: { turn: Extract<Turn, { kind: 'notice' }> }) {
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
  onAction?: (action: Extract<Turn, { kind: 'plan' }>['actions'][number], revision?: string) => Promise<void>
}

export const PlanModeMessage = React.memo(function PlanModeMessage({
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

export const ResponseActions = React.memo(function ResponseActions({
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
    <div className="flex min-h-9 items-center gap-1 text-muted-foreground">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
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
              size="icon-sm"
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
