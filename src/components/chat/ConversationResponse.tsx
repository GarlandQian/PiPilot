import * as React from 'react'
import { TbAlertCircle, TbCheck, TbChevronRight, TbLoader2, TbPlayerStop, TbListDetails } from 'react-icons/tb'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import type { ResponsePresentation, ResponsePresentationSegment } from '@/renderer/pi-rpc/response-presentation'
import type { SubagentInspectorFocusRequest, Turn } from '@/types/chat'
import { PiLogo } from '@/components/PiLogo'
import { transientTurnAnimationKey } from './ConversationMessages'

/** Lazy on first reveal, then retained: hiding work must not reset file/tool disclosure or live text. */
function ResponseSegment({ item, hidden, id, render }: {
  item: ResponsePresentationSegment
  hidden: boolean
  id: string
  render(item: ResponsePresentationSegment, visible: boolean): React.ReactNode
}) {
  const revealed = React.useRef(!hidden)
  const liveText = item.kind === 'turn' && (item.turn.kind === 'thinking' || item.turn.kind === 'agent') && item.turn.state === 'streaming'
  if (!hidden || liveText) revealed.current = true
  return <div
    id={id}
    hidden={hidden}
    data-response-region={item.region}
    className={cn(
      'min-w-0',
      item.region === 'work' ? 'border-l border-border/70 pl-4 text-muted-foreground' : 'text-foreground',
      item.region === 'answer' && 'pt-2',
    )}
  >{revealed.current ? render(item, !hidden) : null}</div>
}

export function ConversationResponse({ response, highlighted, anchorRef, sessionKey, focusRequest, renderPrompt, renderSegment }: {
  response: ResponsePresentation
  highlighted: boolean
  anchorRef?: (node: HTMLDivElement | null) => void
  sessionKey: string | null
  focusRequest?: SubagentInspectorFocusRequest | null
  renderPrompt(turn: Extract<Turn, { kind: 'user' }>): React.ReactNode
  renderSegment(item: ResponsePresentationSegment, visible: boolean): React.ReactNode
}) {
  const t = useT()
  const id = React.useId()
  const [expanded, setExpanded] = React.useState(response.isActive || response.work.failedToolCount > 0)
  const previousActive = React.useRef(response.isActive)
  const previousFailures = React.useRef(response.work.failedToolCount)
  const lastFocusRequest = React.useRef<number | null>(null)
  // A new execution can reopen the process. Finishing one never retracts the
  // content a user is reading, and ordinary progress does not override a click.
  React.useEffect(() => {
    if (response.isActive && !previousActive.current) setExpanded(true)
    previousActive.current = response.isActive
  }, [response.isActive])
  React.useEffect(() => {
    if (response.work.failedToolCount > previousFailures.current) setExpanded(true)
    previousFailures.current = response.work.failedToolCount
  }, [response.work.failedToolCount])
  const restoreTool = focusRequest?.sessionKey === sessionKey &&
    response.segments.some((item) => item.kind === 'activity-run' &&
      item.run.sections.some((section) => section.items.some(({ call }) => call.id === focusRequest.toolCallId)))
  React.useLayoutEffect(() => {
    if (!restoreTool || !focusRequest || lastFocusRequest.current === focusRequest.sequence) return
    lastFocusRequest.current = focusRequest.sequence
    setExpanded(true)
  }, [focusRequest, restoreTool])
  const { work } = response
  const workLabel = response.isActive ? t('chat.work.running')
    : response.status === 'failed' ? t('chat.work.failed')
      : response.status === 'cancelled' ? t('chat.work.stopped')
        : response.status === 'completed' ? t('chat.work.complete') : t('chat.work.label')
  const workIds = response.segments.flatMap((item, index) => item.region === 'work' ? [`${id}-${index}`] : [])
  return <div
    ref={anchorRef}
    data-conversation-outline-entry={response.anchorEntryId}
    data-outline-highlighted={highlighted || undefined}
    data-conversation-response={response.id}
    className={cn('min-w-0 rounded-md pb-6 transition-colors duration-(--duration-base) motion-reduce:transition-none', highlighted && 'bg-accent/35 ring-2 ring-inset ring-ring/45')}
  >
    {response.prompt ? <div className="mb-6 min-w-0">{renderPrompt(response.prompt)}</div> : null}
    <div className="min-w-0 space-y-4">
      {response.segments.length > 0 || response.isActive ? <div className="flex items-center gap-2 text-micro font-medium text-muted-foreground"><PiLogo className="size-4 text-sage" /><span>{t('chat.response.label')}</span></div> : null}
      {work.count > 0 ? <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        aria-controls={workIds.join(' ')}
        aria-label={t(expanded ? 'chat.work.collapse' : 'chat.work.expand')}
        data-response-work-toggle
        className="flex min-h-9 max-w-full items-center gap-2 rounded-md px-1 text-left text-caption text-muted-foreground outline-none hover:text-foreground focus-visible:focus-ring"
      >
        {response.isActive ? <TbLoader2 className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
          : response.status === 'failed' ? <TbAlertCircle className="size-3.5 shrink-0 text-destructive" aria-hidden />
            : response.status === 'cancelled' ? <TbPlayerStop className="size-3.5 shrink-0" aria-hidden />
              : response.status === 'completed' ? <TbCheck className="size-3.5 shrink-0" aria-hidden /> : <TbListDetails className="size-3.5 shrink-0" aria-hidden />}
        <span className="font-medium">{workLabel}</span>
        <span className="min-w-0 truncate text-micro">{t(work.toolCount > 0 ? 'chat.work.tools' : 'chat.work.steps', { count: work.toolCount || work.count })}</span>
        {work.failedToolCount > 0 ? <span className="text-micro text-destructive">{t('chat.work.failedTools', { count: work.failedToolCount })}</span> : null}
        <TbChevronRight className={cn('size-3.5 shrink-0 transition-transform duration-(--duration-fast)', expanded && 'rotate-90')} aria-hidden />
      </button> : null}
      {response.segments.map((item, index) => <ResponseSegment
        key={item.kind === 'turn' && (item.turn.kind === 'agent' || item.turn.kind === 'thinking') ? transientTurnAnimationKey(item.turn.id) : item.id}
        id={`${id}-${index}`}
        item={item}
        hidden={item.region === 'work' && !expanded}
        render={renderSegment}
      />)}
      {response.isActive && !response.answerId && !work.hasActiveWork ? <p role="status" className="flex items-center gap-2 text-caption text-muted-foreground"><TbLoader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />{t('chat.work.waiting')}</p> : null}
    </div>
  </div>
}
