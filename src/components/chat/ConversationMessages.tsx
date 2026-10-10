import * as React from 'react'
import { QuoteSelection } from '@/components/precision/PrecisionReferences'
import { TbAlertTriangle, TbBrain, TbChevronRight, TbCheck, TbClockPause, TbCopy, TbDots, TbDownload, TbFileDescription, TbFlag, TbGitFork, TbInfoCircle, TbLoader2, TbLogout, TbPencil, TbPlayerPlay } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { UserMessageContent } from './UserMessageContent'
import { MarkdownContent } from './markdown/MarkdownContent'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import { primaryShortcut } from '@/lib/keyboard-shortcuts'
import { nextTypewriterText, shouldStartTypewriterFromEmpty, thinkingDisclosureAfterPhaseChange, transientTurnAnimationKey } from '@/renderer/pi-rpc/live-typewriter'
import { parsePromptSkillEnvelope } from '@/renderer/pi-rpc/prompt-presentation'
import { useSettings } from '@/store/settings'
import type { Turn } from '@/types/chat'
import {
  menuPlanActions,
  PLAN_LIFECYCLE_KEYS,
  planActionIsDestructive,
  planActionLabelKey,
  planNeedsDecision,
  primaryPlanAction,
  type PlanAction,
} from './plan-presentation'

export const UserMessage = React.memo(function UserMessage({ turn, onExport }: {
  turn: Extract<Turn, { kind: 'user' }>
  onExport?: (entryId: string) => void
}) {
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
    <div className="group/question ml-auto w-fit min-w-0 max-w-[90%]" data-conversation-question>
      <div className="min-w-0 rounded-[18px] bg-[#e9e9eb] px-3.5 py-2 dark:bg-[#3a3a3c]">
        <div id={questionId} className={cn('conversation-question-content min-w-0 text-foreground', longQuestion && !expanded && '[&_[data-prompt-message]]:max-h-40 [&_[data-prompt-message]]:overflow-hidden')}>
          <QuoteSelection source={{ kind: 'message', sourceId: turn.anchorEntryId ?? turn.id, label: t('precision.userMessage') }}>
            <UserMessageContent text={turn.text} />
          </QuoteSelection>
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
        {onExport && turn.anchorEntryId ? <Button variant="ghost" size="icon-xs" className="opacity-0 group-hover/question:opacity-100 focus-visible:opacity-100"
          aria-label={t('export.message')} onClick={() => onExport(turn.anchorEntryId!)}><TbDownload aria-hidden /></Button> : null}
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
      <QuoteSelection source={{ kind: 'message', sourceId: `${turn.anchorEntryId ?? ''}/${turn.id}`, label: t('precision.assistantMessage') }}>
        <MarkdownContent markdown={markdown} streaming={!settled} />
      </QuoteSelection>
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

export { transientTurnAnimationKey, agentAnimationKey } from '@/renderer/pi-rpc/live-typewriter'

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
          className="flex w-fit min-w-0 items-center gap-1.5 rounded-full py-1 pr-2.5 pl-1.5 text-left text-caption outline-none transition-colors duration-(--duration-fast) hover:bg-fill focus-visible:focus-ring motion-reduce:transition-none"
        >
          <TbChevronRight
            className={cn(
              'size-3.5 shrink-0 text-muted-foreground transition-transform duration-(--duration-fast) motion-reduce:transition-none',
              open && 'rotate-90',
            )}
            aria-hidden
          />
          <TbBrain className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span className={cn('font-medium', streaming ? 'text-shimmer' : 'text-muted-foreground')}>
            {label}
          </span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent id={contentId}>
        {/* An aside, not a card: a thin rule and quieter text, as in Codex. */}
        <div className="mt-1 mb-2 ml-[11px] border-l-2 border-border py-0.5 pl-3.5 text-caption leading-relaxed text-muted-foreground" data-thinking-content>
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

const planActionIcons = {
  show: TbFileDescription,
  finalize: TbFlag,
  implement: TbPlayerPlay,
  save: TbClockPause,
  export: TbDownload,
  revise: TbPencil,
  exit: TbLogout,
}

/** Lines shown before "Show full plan"; longer plans fade out instead of nesting a scroller. */
const PLAN_PREVIEW_MAX_HEIGHT = '22rem'

interface PlanModeMessageProps {
  turn: Extract<Turn, { kind: 'plan' }>
  onAction?: (action: PlanAction, revision?: string) => Promise<void>
}

/**
 * The single home of a plan. Only the plugin's current plan is a full card with
 * actions; earlier versions collapse to one read-only line.
 */
export const PlanModeMessage = React.memo(function PlanModeMessage({ turn, onAction }: PlanModeMessageProps) {
  return turn.actions.length > 0
    ? <CurrentPlanCard turn={turn} onAction={onAction} />
    : <EarlierPlan turn={turn} />
})

function EarlierPlan({ turn }: { turn: Extract<Turn, { kind: 'plan' }> }) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  return (
    <section aria-label={t('plan.title')} data-plan-card data-plan-current="false">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full min-w-0 items-center gap-2 rounded-[12px] bg-fill/70 px-3 py-2 text-left text-caption outline-none hover:bg-fill focus-visible:focus-ring"
      >
        <TbFileDescription className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="font-medium text-foreground/85">{t('plan.title')}</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {t(turn.superseded ? 'plan.superseded' : 'plan.earlier')}
        </span>
        <TbChevronRight className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform duration-(--duration-fast)', open && 'rotate-90')} aria-hidden />
      </button>
      {open ? (
        <div className="mt-1.5 rounded-[12px] bg-surface-raised px-4 py-3 shadow-[inset_0_0_0_0.5px_var(--color-border)] dark:bg-white/[0.03]">
          <MarkdownContent markdown={turn.markdown} />
        </div>
      ) : null}
    </section>
  )
}

function CurrentPlanCard({ turn, onAction }: PlanModeMessageProps) {
  const t = useT()
  const [busy, setBusy] = React.useState<PlanAction | null>(null)
  const [error, setError] = React.useState(false)
  const [revisionOpen, setRevisionOpen] = React.useState(false)
  const [revision, setRevision] = React.useState('')
  const [revisionSent, setRevisionSent] = React.useState(false)
  const [expanded, setExpanded] = React.useState(false)
  const [overflows, setOverflows] = React.useState(false)
  const bodyRef = React.useRef<HTMLDivElement>(null)
  const revisionRef = React.useRef<HTMLTextAreaElement>(null)
  const lifecycle = revisionSent ? 'planning' : turn.lifecycle
  const primary = revisionSent ? null : primaryPlanAction(turn.lifecycle, turn.actions)
  const menu = revisionSent ? [] : menuPlanActions(turn.lifecycle, turn.actions)
  const disabled = !onAction || Boolean(busy) || revisionSent

  // A new plan version or state starts from the default reading position.
  React.useEffect(() => {
    setRevisionSent(false)
    setExpanded(false)
  }, [turn.markdown, turn.lifecycle])

  React.useLayoutEffect(() => {
    const body = bodyRef.current
    if (!body) return
    const measure = () => setOverflows(body.scrollHeight > body.clientHeight + 1)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(body)
    return () => observer.disconnect()
  }, [turn.markdown, expanded])

  React.useEffect(() => {
    if (revisionOpen) revisionRef.current?.focus()
  }, [revisionOpen])

  const runAction = React.useCallback(async (action: PlanAction, revisionText?: string) => {
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

  const sendRevision = () => {
    if (revision.trim()) void runAction('revise', revision.trim())
  }

  return (
    <section
      aria-label={t('plan.title')}
      data-plan-card
      data-plan-current="true"
      data-plan-lifecycle={lifecycle}
      className="overflow-hidden rounded-[16px] bg-surface-raised shadow-[var(--glass-shadow)] transition-shadow duration-300 data-[plan-flash]:shadow-[var(--glass-shadow),0_0_0_3px_color-mix(in_srgb,var(--color-primary)_45%,transparent)] dark:bg-white/[0.04]"
    >
      <header className="flex min-h-11 items-center gap-2.5 border-b border-border px-3.5 py-2">
        <span className="grid size-6 shrink-0 place-items-center rounded-[6px] bg-primary bg-[linear-gradient(to_bottom,rgb(255_255_255/0.2),transparent)] text-white" aria-hidden><TbFileDescription className="size-3.5" /></span>
        <h3 className="min-w-0 text-app font-semibold text-foreground">{t('plan.title')}</h3>
        <span role="status" className={cn(
          'shrink-0 rounded-full px-2 py-px text-micro font-medium',
          planNeedsDecision(lifecycle) && !revisionSent ? 'bg-primary/12 text-primary' : 'bg-fill-strong text-muted-foreground',
        )}>
          {lifecycle === 'planning' || lifecycle === 'implementing'
            ? <TbLoader2 className="mr-1 inline size-3 animate-spin align-[-2px] motion-reduce:animate-none" aria-hidden />
            : null}
          {t(PLAN_LIFECYCLE_KEYS[lifecycle])}
        </span>
        <span className="flex-1" />
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={0} className="shrink-0 cursor-default rounded-full bg-fill px-2 py-px text-micro text-muted-foreground outline-none focus-visible:focus-ring">
              {t('plan.badge.plugin')}
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-64">{t('plan.badge.tooltip')}</TooltipContent>
        </Tooltip>
      </header>

      <div className="relative">
        <div
          ref={bodyRef}
          className="overflow-hidden px-4 py-3"
          style={expanded ? undefined : { maxHeight: PLAN_PREVIEW_MAX_HEIGHT }}
        >
          {turn.markdown
            ? <MarkdownContent markdown={turn.markdown} />
            : <p className="text-caption text-muted-foreground">{t('plan.pending')}</p>}
        </div>
        {!expanded && overflows ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-surface-raised to-transparent dark:from-[#232325]" aria-hidden />
        ) : null}
      </div>
      {overflows || expanded ? (
        <div className="flex justify-center pb-2">
          <Button variant="ghost" size="xs" className="text-primary" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
            {t(expanded ? 'plan.collapse' : 'plan.expand')}
          </Button>
        </div>
      ) : null}

      {revisionOpen ? (
        <div className="border-t border-border bg-fill/40 px-3.5 py-3">
          <Textarea
            ref={revisionRef}
            value={revision}
            onChange={(event) => setRevision(event.target.value)}
            placeholder={t('plan.revise.placeholder')}
            aria-label={t('plan.revise.input')}
            className="min-h-20 resize-y"
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return
              if (event.key === 'Escape') { event.preventDefault(); setRevisionOpen(false) }
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); sendRevision() }
            }}
          />
          <div className="mt-2 flex items-center justify-end gap-2">
            <span className="mr-auto text-micro text-muted-foreground">{t('plan.revise.hint', { shortcut: primaryShortcut('↩') })}</span>
            <Button variant="outline" size="sm" onClick={() => setRevisionOpen(false)}>{t('common.cancel')}</Button>
            <Button size="sm" disabled={!revision.trim() || Boolean(busy)} aria-busy={busy === 'revise' || undefined} onClick={sendRevision}>
              {busy === 'revise' ? <TbLoader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : null}
              {t('plan.revise.send')}
            </Button>
          </div>
        </div>
      ) : null}

      {primary || menu.length || error ? (
        <footer className="flex min-h-11 items-center gap-2 border-t border-border bg-fill/50 px-3 py-2">
          {error ? <span className="min-w-0 truncate text-micro text-destructive" role="alert">{t('plan.action.failed')}</span> : null}
          <span className="flex-1" />
          {menu.length ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" disabled={disabled} aria-label={t('plan.more')} title={t('plan.more')}>
                  <TbDots aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                {menu.map((action) => {
                  const Icon = planActionIcons[action]
                  const destructive = planActionIsDestructive(action, turn.lifecycle)
                  return <React.Fragment key={action}>
                    {action === 'exit' && menu.length > 1 ? <DropdownMenuSeparator /> : null}
                    <DropdownMenuItem
                      variant={destructive ? 'destructive' : 'default'}
                      onSelect={() => {
                        if (action === 'revise') setRevisionOpen(true)
                        else void runAction(action)
                      }}
                    >
                      <Icon aria-hidden />
                      {t(planActionLabelKey(action, turn.lifecycle))}
                    </DropdownMenuItem>
                  </React.Fragment>
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          {primary ? (
            <Button size="sm" disabled={disabled} aria-busy={busy === primary || undefined} onClick={() => void runAction(primary)}>
              {busy === primary
                ? <TbLoader2 className="animate-spin motion-reduce:animate-none" aria-hidden />
                : <TbPlayerPlay aria-hidden />}
              {t(planActionLabelKey(primary, turn.lifecycle))}
            </Button>
          ) : null}
        </footer>
      ) : null}
    </section>
  )
}

interface ResponseActionsProps {
  turn: Extract<Turn, { kind: 'response-actions' }>
  forkBusy: boolean
  forking: boolean
  onFork: (turn: Extract<Turn, { kind: 'response-actions' }>) => void
  canFork: boolean
  onExportResponse?: (anchorEntryId: string) => void
  /** Shown only while the reply is hovered or focused (Codex); the newest reply keeps them. */
  hoverOnly?: boolean
}

export const ResponseActions = React.memo(function ResponseActions({
  hoverOnly = false,
  turn,
  forkBusy,
  forking,
  onFork,
  canFork,
  onExportResponse,
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
    <div className="flex min-h-9 items-center gap-1 text-muted-foreground" data-response-actions
      data-hover-only={hoverOnly && copyState === 'idle' && !forking ? true : undefined}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => void copy()}
            aria-label={copyLabel}
          >
            {copyState === 'copied'
              ? <TbCheck className="text-success" aria-hidden />
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
      {onExportResponse && turn.anchorEntryId ? <Tooltip>
        <TooltipTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={t('export.response')}
          onClick={() => onExportResponse(turn.anchorEntryId!)}><TbDownload aria-hidden /></Button></TooltipTrigger>
        <TooltipContent>{t('export.response')}</TooltipContent>
      </Tooltip> : null}
      {copyState === 'failed' ? (
        <span className="max-w-48 truncate pl-1 text-micro text-destructive" role="alert">
          {t('chat.response.copyFailed')}
        </span>
      ) : null}
    </div>
  )
})
