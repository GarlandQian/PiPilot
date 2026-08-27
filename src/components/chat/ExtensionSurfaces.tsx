import * as React from 'react'
import {
  TbActivity,
  TbAlertTriangle,
  TbChevronRight,
  TbCheck,
  TbClock,
  TbInfoCircle,
  TbLoader2,
  TbListDetails,
  TbNotes,
  TbDeviceFloppy,
  TbDownload,
  TbEye,
  TbFlag,
  TbLogout,
  TbPencil,
  TbPlayerStop,
  TbPlayerPlay,
  TbPlayerPause,
  TbRefresh,
  TbTargetArrow,
  TbTrash,
} from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import { projectStructuredValue } from '@/renderer/pi-rpc/structured-value'
import {
  isRetryStopAllowed,
  type RetryActivityProjection,
} from '@/renderer/pi-rpc/adapters'
import type {
  GoalActionId,
  GoalModeProjection,
} from '@/renderer/pi-rpc/adapters/goal'
import type {
  PlanActionId,
  PlanModeProjection,
} from '@/renderer/pi-rpc/adapters/plan-mode'
import type { ResponseActivity } from '@/types/chat'
import type { StructuredValueProjection } from '@/types/chat'
import { StructuredValueView } from './StructuredValueView'

const planActionIcons = {
  show: TbEye,
  finalize: TbFlag,
  implement: TbPlayerPlay,
  save: TbDeviceFloppy,
  export: TbDownload,
  revise: TbPencil,
  exit: TbLogout,
} as const

const goalActionIcons = {
  status: TbListDetails,
  pause: TbPlayerPause,
  resume: TbPlayerPlay,
  clear: TbTrash,
} as const

const goalActionKeys = {
  status: 'goal.action.status',
  pause: 'goal.action.pause',
  resume: 'goal.action.resume',
  clear: 'goal.action.clear',
} as const

const goalLifecycleKeys = {
  active: 'goal.lifecycle.active',
  queued: 'goal.lifecycle.queued',
  waiting: 'goal.lifecycle.waiting',
  paused: 'goal.lifecycle.paused',
  blocked: 'goal.lifecycle.blocked',
  'usage-limited': 'goal.lifecycle.usageLimited',
  'budget-limited': 'goal.lifecycle.budgetLimited',
  complete: 'goal.lifecycle.complete',
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

const PLAN_LIFECYCLE_KEYS = {
  planning: 'plan.lifecycle.planning',
  ready: 'plan.lifecycle.ready',
  saved: 'plan.lifecycle.saved',
  implementing: 'plan.lifecycle.implementing',
} as const

export function ResponseActivityRow({ activity }: { activity: ResponseActivity }) {
  const t = useT()
  const retry = activity.kind === 'retry' ? activity : null
  const error = activity.kind === 'extension-error' ||
    (activity.kind === 'notification' && activity.tone === 'error') ||
    (retry?.phase === 'error')
  const warning = activity.kind === 'notification' && activity.tone === 'warning'
  const active = activity.state === 'active'
  const [open, setOpen] = React.useState(error)
  const previousErrorRef = React.useRef(error)
  const previousActiveRef = React.useRef(active)

  React.useEffect(() => {
    if (!previousErrorRef.current && error) setOpen(true)
    previousErrorRef.current = error
  }, [error])

  React.useEffect(() => {
    if (previousActiveRef.current && !active && !error) setOpen(false)
    previousActiveRef.current = active
  }, [active, error])

  let label = t('extension.activity.title')
  let summary = ''
  let details: readonly string[] = []
  let Icon = active ? TbLoader2 : TbCheck

  if (activity.kind === 'working') {
    label = t('extension.working.title')
    summary = activity.message || t('extension.working.default')
  } else if (activity.kind === 'status') {
    label = activity.label
    summary = activity.message
    Icon = active ? TbLoader2 : TbCheck
  } else if (activity.kind === 'widget') {
    label = activity.label
    summary = activity.summary
    details = activity.details ?? []
    Icon = TbNotes
  } else if (activity.kind === 'notification') {
    summary = activity.message
    Icon = activity.tone === 'info' ? TbInfoCircle : TbAlertTriangle
  } else if (activity.kind === 'extension-error') {
    summary = activity.message
    Icon = TbAlertTriangle
  } else if (retry) {
    label = retry.retryKind === 'provider'
      ? t('retry.provider.title')
      : t('retry.summary.title')
    if (retry.retryKind === 'provider') {
      summary = retry.phase === 'waiting'
        ? t('retry.provider.waiting', {
            seconds: Math.max(0, Math.ceil((retry.delayMs ?? 0) / 1_000)),
          })
        : retry.phase === 'success'
          ? t('retry.provider.recovered')
          : retry.phase === 'error'
            ? t('retry.provider.failed')
            : t('retry.provider.running')
    } else {
      summary = retry.phase === 'waiting'
        ? t('retry.summary.waiting')
        : retry.phase === 'attempting'
          ? t('retry.summary.attempting')
          : t('retry.summary.finished')
    }
    if (retry.attempt !== undefined) {
      const attempt = retry.maxAttempts === undefined
        ? t('retry.attemptSingle', { attempt: retry.attempt })
        : t('retry.attempt', { attempt: retry.attempt, max: retry.maxAttempts })
      summary = `${summary} · ${attempt}`
    }
    details = retry.message ? [retry.message] : []
    Icon = active ? TbRefresh : error ? TbAlertTriangle : TbCheck
  }

  const summaryProjection = projectStructuredValue(summary)
  const structuredSummary = summaryProjection.kind === 'json' ||
    summaryProjection.kind === 'malformed' ||
    summaryProjection.kind === 'truncated' ||
    summaryProjection.kind === 'unsupported'
  const detailProjection: StructuredValueProjection | null = details.length > 0
    ? projectStructuredValue(details.length === 1 ? details[0] : details)
    : structuredSummary
      ? summaryProjection
      : null
  if (structuredSummary) {
    summary = summaryProjection.kind === 'malformed'
      ? t('tool.valueMalformed')
      : summaryProjection.kind === 'unsupported'
        ? t('tool.valueUnsupported')
        : summaryProjection.kind === 'truncated'
          ? t('tool.valueTruncated')
          : summaryProjection.summary
  }

  const spinning = active && (
    activity.kind === 'working' ||
    activity.kind === 'status' ||
    activity.kind === 'retry'
  )

  const content = (
    <>
      <Icon
        className={cn(
          'size-3.5 shrink-0',
          spinning && 'animate-spin text-muted-foreground motion-reduce:animate-none',
          error && 'text-destructive',
          warning && 'text-warning',
          !spinning && !error && !warning && 'text-muted-foreground',
        )}
        aria-hidden
      />
      <span className="shrink-0 font-mono text-micro font-medium text-foreground">
        {label}
      </span>
      <span className={cn(
        'min-w-0 flex-1 truncate text-caption',
        error ? 'text-destructive' : 'text-muted-foreground',
      )} title={summary}>
        {summary}
      </span>
      {detailProjection ? (
        <TbChevronRight
          className={cn(
            'size-3.5 shrink-0 text-muted-foreground transition-transform duration-(--duration-fast) motion-reduce:transition-none',
            open && 'rotate-90',
          )}
          aria-hidden
        />
      ) : null}
    </>
  )

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      role={error ? 'alert' : 'status'}
      aria-label={`${label}: ${summary}`}
    >
      {detailProjection ? (
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex min-h-7 w-full items-center gap-2 rounded-sm px-1.5 text-left outline-none transition-colors duration-(--duration-fast) hover:bg-accent/30 focus-visible:focus-ring motion-reduce:transition-none"
          >
            {content}
          </button>
        </CollapsibleTrigger>
      ) : (
        <div
          className="flex min-h-7 items-center gap-2 px-1.5"
        >
          {content}
        </div>
      )}
      {detailProjection ? (
        <CollapsibleContent>
          <div className="ml-3.5 min-w-0 border-l border-border/70 py-1 pl-3" role={error ? 'alert' : undefined}>
            <StructuredValueView
              label={t('extension.activity.details')}
              projection={detailProjection}
              tone={error ? 'error' : 'default'}
            />
          </div>
        </CollapsibleContent>
      ) : null}
    </Collapsible>
  )
}

function useRetryCountdown(activity: RetryActivityProjection) {
  const deadline = activity.kind === 'provider' ? activity.deadline : null
  const active = activity.kind === 'provider' && activity.phase === 'waiting'
  const [now, setNow] = React.useState(Date.now)
  React.useEffect(() => {
    setNow(Date.now())
    if (!active || deadline === null || deadline <= Date.now()) return
    const timer = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(timer)
  }, [active, deadline])
  return deadline === null ? null : Math.max(0, Math.ceil((deadline - now) / 1_000))
}

export interface ActiveControlBarProps {
  planMode: PlanModeProjection | null
  goalMode: GoalModeProjection | null
  retryActivity: RetryActivityProjection
  working: { message: string | null; visible: boolean }
  onPlanAction(action: PlanActionId): Promise<void>
  onGoalAction(action: GoalActionId): Promise<void>
  onStopRetry(): Promise<void>
  onRevealActivity?(): void
}

const PLAN_PRIMARY_ACTIONS: readonly PlanActionId[] = [
  'implement',
  'finalize',
  'show',
  'revise',
  'save',
  'export',
  'exit',
]

const GOAL_PRIMARY_ACTIONS: readonly GoalActionId[] = [
  'resume',
  'pause',
  'status',
  'clear',
]

/**
 * A single transient control immediately above Composer. Historical extension
 * output belongs in the response group; this surface only keeps the most
 * urgent still-actionable state reachable.
 */
export function ActiveControlBar({
  planMode,
  goalMode,
  retryActivity,
  working,
  onPlanAction,
  onGoalAction,
  onStopRetry,
  onRevealActivity,
}: ActiveControlBarProps) {
  const t = useT()
  const countdown = useRetryCountdown(retryActivity)
  const [busy, setBusy] = React.useState(false)
  const [actionError, setActionError] = React.useState<string | null>(null)

  const retryActive = retryActivity.kind === 'provider' ||
    (retryActivity.kind === 'summarization' && retryActivity.phase !== 'finished')
  const planAction = planMode
    ? PLAN_PRIMARY_ACTIONS.find((action) => planMode.actions.includes(action)) ?? null
    : null
  const goalAction = goalMode
    ? GOAL_PRIMARY_ACTIONS.find((action) => goalMode.actions.includes(action)) ?? null
    : null

  let identity = 'none'
  let title = ''
  let summary = ''
  let Icon = TbActivity
  let actionLabel: string | null = null
  let ActionIcon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }> | null = null
  let invokeAction: (() => Promise<void>) | null = null
  let actionFailureMessage: string | null = null

  if (retryActive) {
    identity = retryActivity.kind === 'provider'
      ? `retry\0${retryActivity.attempt}\0${retryActivity.deadline}\0${retryActivity.cancelling}`
      : `summary\0${retryActivity.phase}\0${retryActivity.attempt ?? ''}`
    title = retryActivity.kind === 'provider'
      ? t('retry.provider.title')
      : t('retry.summary.title')
    if (retryActivity.kind === 'provider') {
      summary = retryActivity.cancelling
        ? t('retry.provider.cancelling')
        : countdown !== null && countdown > 0
          ? t('retry.provider.waiting', { seconds: countdown })
          : t('retry.provider.running')
      Icon = retryActivity.cancelling || countdown === null || countdown === 0
        ? TbRefresh
        : TbClock
      if (isRetryStopAllowed(retryActivity)) {
        actionLabel = t('retry.stop')
        ActionIcon = TbPlayerStop
        invokeAction = onStopRetry
        actionFailureMessage = t('retry.stopFailed')
      }
    } else {
      summary = retryActivity.phase === 'waiting'
        ? t('retry.summary.waiting')
        : t('retry.summary.attempting')
      Icon = TbNotes
    }
  } else if (planMode && planAction) {
    identity = `plan\0${planMode.scopeKey}\0${planMode.sessionId}\0${planMode.generation}\0${planMode.lifecycle}`
    title = t('plan.title')
    summary = t(PLAN_LIFECYCLE_KEYS[planMode.lifecycle])
    Icon = TbNotes
    actionLabel = t(planActionKeys[planAction])
    ActionIcon = planActionIcons[planAction]
    invokeAction = () => onPlanAction(planAction)
    actionFailureMessage = t('plan.action.failed')
  } else if (goalMode && goalAction) {
    identity = `goal\0${goalMode.scopeKey}\0${goalMode.sessionId}\0${goalMode.generation}\0${goalMode.goal?.id ?? goalMode.lifecycle}`
    title = t('goal.title')
    summary = goalMode.goal?.waiting?.reason
      ? t('goal.waitingReason', { reason: goalMode.goal.waiting.reason })
      : t(goalLifecycleKeys[goalMode.lifecycle])
    Icon = TbTargetArrow
    actionLabel = t(goalActionKeys[goalAction])
    ActionIcon = goalActionIcons[goalAction]
    invokeAction = () => onGoalAction(goalAction)
    actionFailureMessage = t('goal.action.failed')
  } else if (working.visible) {
    identity = `working\0${working.message ?? ''}`
    title = t('extension.working.title')
    summary = working.message ?? t('extension.working.default')
    Icon = TbLoader2
  }

  const identityRef = React.useRef(identity)
  identityRef.current = identity
  React.useEffect(() => {
    setBusy(false)
    setActionError(null)
  }, [identity])

  if (identity === 'none') return null
  const CurrentIcon = Icon
  const CurrentActionIcon = ActionIcon

  return (
    <section
      className="shrink-0 bg-surface px-3"
      aria-label={title}
      role={actionError ? 'alert' : 'status'}
    >
      <div className="mx-auto flex min-h-8 w-full max-w-[920px] items-center gap-2 border-t border-border/60 px-1.5 py-1">
        <CurrentIcon
          className={cn(
            'size-3.5 shrink-0 text-muted-foreground',
            (identity.startsWith('working') ||
              (retryActivity.kind === 'provider' &&
                (retryActivity.cancelling || countdown === null || countdown === 0))) &&
              'animate-spin motion-reduce:animate-none',
          )}
          aria-hidden
        />
        <span className="shrink-0 text-caption font-medium text-foreground">{title}</span>
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-caption text-muted-foreground',
            actionError && 'text-destructive',
          )}
          title={actionError ?? summary}
        >
          {actionError ?? summary}
        </span>
        {invokeAction && actionLabel && CurrentActionIcon ? (
          <Button
            variant="ghost"
            size="xs"
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={() => {
              const requestIdentity = identity
              setBusy(true)
              setActionError(null)
              void invokeAction()
                .catch(() => {
                  if (identityRef.current === requestIdentity && actionFailureMessage) {
                    setActionError(actionFailureMessage)
                  }
                })
                .finally(() => {
                  if (identityRef.current === requestIdentity) setBusy(false)
                })
            }}
          >
            {busy
              ? <TbLoader2 className="animate-spin motion-reduce:animate-none" aria-hidden />
              : <CurrentActionIcon aria-hidden />}
            {actionLabel}
          </Button>
        ) : null}
        {onRevealActivity ? (
          <Button
            variant="ghost"
            size="xs"
            onClick={onRevealActivity}
          >
            <TbChevronRight aria-hidden />
            {t('extension.activity.expand')}
          </Button>
        ) : null}
      </div>
    </section>
  )
}
