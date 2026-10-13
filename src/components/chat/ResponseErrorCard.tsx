import * as React from 'react'
import { TbAlertTriangle, TbCheck, TbChevronRight, TbCopy, TbLoader2, TbPlayerStop, TbRefresh, TbSettings } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { useT } from '@/i18n'
import { useConversationOperationFeedback } from '@/renderer/composer/use-operation-feedback'
import { classifyConversationError } from '@/shared/conversation-errors'
import { isRetryStopAllowed, type RetryActivityProjection } from '@/renderer/pi-rpc/adapters/retry'
import type { Turn } from '@/types/chat'

type ErrorTurn = Extract<Turn, { kind: 'response-error' }>

export interface ResponseRetryPolicy {
  enabled: boolean
  maxRetries: number
}

/** Provider failures stay attached to their response, independently of its text. */
export const ResponseErrorCard = React.memo(function ResponseErrorCard({
  turn, sessionKey, current, disabled, retryPolicy, retryActivity, onRetry, onConfigureModel, onStopRetry,
}: {
  turn: ErrorTurn
  sessionKey: string | null
  current: boolean
  disabled: boolean
  retryPolicy?: ResponseRetryPolicy
  retryActivity?: RetryActivityProjection
  onRetry?: (expectedTimestamp: number) => Promise<void>
  onConfigureModel?: () => void
  onStopRetry?: () => Promise<void>
}) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const [copied, setCopied] = React.useState(false)
  const [now, setNow] = React.useState(Date.now)
  const feedback = useConversationOperationFeedback(`${sessionKey ?? 'unavailable'}:${turn.id}`)
  const detailId = React.useId()
  const copyTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelled = turn.state === 'aborted'
  const activeRetry = current && retryActivity?.kind === 'provider' ? retryActivity : null
  const retryResult = current && retryActivity?.kind === 'provider-result' ? retryActivity : null
  const retryStopped = retryResult && classifyConversationError(retryResult.message ?? undefined).category === 'cancelled'
  const waiting = activeRetry?.phase === 'waiting'
  const seconds = Math.max(0, Math.ceil(((activeRetry?.deadline ?? now) - now) / 1_000))

  React.useEffect(() => {
    if (!waiting) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(timer)
  }, [waiting, activeRetry?.deadline])
  React.useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current) }, [])

  const category = cancelled ? 'cancelled' : turn.error.category
  const explanation = cancelled
    ? t('chat.failure.noRetry.cancelled')
    : activeRetry
      ? t('chat.failure.retryInProgress')
      : retryStopped
        ? t('chat.failure.retryStopped')
      : retryResult && !retryResult.success
        ? t('chat.failure.retryEnded', { count: retryResult.attempt })
        : !turn.error.retryable
          ? t(`chat.failure.noRetry.${turn.error.category}`)
          : !current
            ? t('chat.failure.historical')
            : retryPolicy && (!retryPolicy.enabled || retryPolicy.maxRetries === 0)
              ? t('chat.failure.retryDisabled')
            : t('chat.failure.retryAvailable')
  const source = [turn.provider, turn.model].filter(Boolean).join(' / ')

  return <section className="min-w-0 rounded-lg border border-destructive/20 bg-destructive/[0.035] px-3.5 py-3" data-response-error={turn.state} aria-labelledby={`${detailId}-title`}>
    <div className="flex min-w-0 items-start gap-2">
      <TbAlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
      <div className="min-w-0 flex-1 space-y-1">
        <p id={`${detailId}-title`} className="text-caption font-medium text-foreground" role="status">{t(cancelled ? 'chat.responseAborted' : 'chat.failure.title')}</p>
        {source ? <p className="break-words text-micro text-muted-foreground">{t('chat.failure.source', { source })}</p> : null}
        <p className="break-words text-caption text-foreground">{t(`chat.failure.summary.${category}`)}</p>
        <p className="text-caption text-muted-foreground">{explanation}</p>
        {!current && !cancelled && !turn.error.retryable ? <p className="text-caption text-muted-foreground">{t('chat.failure.historical')}</p> : null}
      </div>
    </div>
    {activeRetry ? <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted-foreground" role="status">
      <TbLoader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
      <span>{t('retry.attempt', { attempt: activeRetry.attempt, max: activeRetry.maxAttempts })}</span>
      <span>{t(activeRetry.cancelling ? 'retry.provider.cancelling' : waiting && seconds > 0 ? 'retry.provider.waiting' : 'retry.provider.running', { seconds })}</span>
      {onStopRetry && isRetryStopAllowed(activeRetry, now) ? <Button variant="ghost" size="xs" disabled={feedback.pending !== null} onClick={() => void feedback.run('stop', onStopRetry, t('chat.failure.actionFailed'))}><TbPlayerStop aria-hidden />{t('chat.failure.stopRetry')}</Button> : null}
    </div> : null}
    <div className="mt-2 flex flex-wrap items-center gap-1">
      {!cancelled ? <Button variant="outline" size="xs" disabled={!current || disabled || Boolean(activeRetry) || !onRetry || feedback.pending !== null}
        title={!current ? t('chat.failure.historical') : undefined}
        onClick={() => onRetry && void feedback.run('retry', () => onRetry(turn.timestamp), t('chat.failure.actionFailed'))}>
        {feedback.pending?.action === 'retry' ? <TbLoader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : <TbRefresh aria-hidden />}
        {t('chat.failure.retryResponse')}
      </Button> : null}
      {onConfigureModel ? <Button variant="ghost" size="xs" disabled={feedback.pending !== null} onClick={onConfigureModel}><TbSettings aria-hidden />{t('chat.failure.configure')}</Button> : null}
    </div>
    {turn.error.sanitizedDetails ? <Collapsible open={open} onOpenChange={setOpen} className="mt-2">
      <CollapsibleTrigger asChild><Button variant="ghost" size="xs" className="-ml-1.5 text-muted-foreground" aria-controls={detailId}>
        <TbChevronRight className={open ? 'rotate-90' : undefined} aria-hidden />{t('chat.failure.details')}
      </Button></CollapsibleTrigger>
      <CollapsibleContent id={detailId} className="mt-1 min-w-0">
        <div className="relative rounded-md border border-border bg-background/60 p-2.5">
          <div className="mb-1 flex justify-end"><Button variant="ghost" size="icon-xs" aria-label={t(copied ? 'chat.messageCopied' : 'chat.failure.copyDetails')}
            disabled={feedback.pending !== null}
            onClick={() => void feedback.run('copy', async (isCurrent) => {
              await navigator.clipboard.writeText(turn.error.sanitizedDetails)
              if (!isCurrent()) return
              setCopied(true)
              if (copyTimer.current) clearTimeout(copyTimer.current)
              copyTimer.current = setTimeout(() => setCopied(false), 1_400)
            }, t('chat.response.copyFailed'))}>
            {copied ? <TbCheck aria-hidden /> : <TbCopy aria-hidden />}
          </Button></div>
          <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap break-words font-mono text-micro text-muted-foreground">{turn.error.sanitizedDetails}</pre>
        </div>
      </CollapsibleContent>
    </Collapsible> : null}
    {feedback.error ? <p className="mt-2 break-words text-caption text-destructive" role="alert">{classifyConversationError(feedback.error).sanitizedDetails || t('chat.failure.actionFailed')}</p> : null}
  </section>
})
