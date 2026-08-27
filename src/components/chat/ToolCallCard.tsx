import * as React from 'react'
import {
  TbCheck,
  TbChevronRight,
  TbCopy,
  TbFileDiff,
  TbFileText,
  TbPlayerPlay,
  TbTerminal2,
  TbTool,
} from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import { projectPlainText, projectStructuredValue } from '@/renderer/pi-rpc/structured-value'
import { toolCallCopyText } from '@/renderer/pi-rpc/tool-presenters'
import { useSettings } from '@/store/settings'
import type { SubagentPresentation, SubagentTimelineEvent, ToolCall } from '@/types/chat'
import { MarkdownContent } from './markdown/MarkdownContent'
import { ShellEvidence } from './ShellEvidence'
import { StructuredValueView } from './StructuredValueView'
import { ToolCallStatus, toolStatusIcon } from './ToolCallStatus'

const kindIcon = {
  read: TbFileText,
  shell: TbTerminal2,
  edit: TbFileDiff,
  generic: TbTool,
} as const

export function SubagentDetails({
  presentation,
  scrollable = true,
  taskDisclosure = false,
}: {
  presentation: SubagentPresentation
  scrollable?: boolean
  taskDisclosure?: boolean
}) {
  const t = useT()
  const [tasksOpen, setTasksOpen] = React.useState(!taskDisclosure)
  const taskContentId = React.useId()
  const outputLabel = presentation.output?.kind === 'progress'
    ? t('tool.progress')
    : presentation.output?.kind === 'error'
      ? t('tool.error')
      : t('tool.result')
  const timeline = presentation.timeline ?? []
  const timelineOutput = new Set(
    timeline
      .filter((event) => event.kind === 'result' || event.kind === 'error')
      .map((event) => event.markdown),
  )
  const eventIcon = (event: SubagentTimelineEvent) => {
    if (event.kind === 'tool') return TbPlayerPlay
    if (event.kind === 'error' || event.state === 'failed') return toolStatusIcon.failed
    if (event.state === 'active') return toolStatusIcon.running
    return TbCheck
  }
  const eventLabel = (event: SubagentTimelineEvent) => {
    if (event.kind === 'tool') return event.toolName ?? t('tool.progress')
    if (event.kind === 'error') return t('tool.error')
    if (event.kind === 'result') return t('tool.result')
    return t('tool.progress')
  }
  const eventStateLabel = (event: SubagentTimelineEvent) => event.state === 'active'
    ? t('tool.status.running')
    : event.state === 'failed'
      ? t('tool.status.failed')
      : t('tool.status.success')

  const taskContent = (
    <>
      {presentation.tasks.map((task, index) => (
        <section
          key={task.id}
          className={cn('min-w-0 space-y-1.5', index > 0 && 'border-t border-border/70 pt-3')}
        >
          <header className="flex min-w-0 items-center gap-2">
            <span className="text-micro font-medium text-muted-foreground">
              {presentation.tasks.length > 1
                ? t('tool.subagent.taskNumber', { number: index + 1 })
                : t('tool.subagent.task')}
            </span>
            <span className="min-w-0 truncate font-mono text-micro text-foreground" title={task.agent}>
              {task.agent}
            </span>
          </header>
          <MarkdownContent markdown={task.markdown} />
          {task.truncated ? (
            <p className="text-micro text-muted-foreground">
              {t('tool.subagent.previewLimited')}
            </p>
          ) : null}
        </section>
      ))}
      {presentation.omittedTaskCount > 0 ? (
        <p className="text-micro text-muted-foreground">
          {t('tool.subagent.tasksOmitted', { count: presentation.omittedTaskCount })}
        </p>
      ) : null}
    </>
  )

  return (
    <div className={cn(
      'min-w-0 space-y-3',
      scrollable && 'scroll-slim max-h-[min(32rem,60vh)] overflow-y-auto pr-2',
    )}>
      {presentation.malformed ? (
        <p className="text-caption text-destructive" role="alert">
          {t('tool.subagent.invalidRequest')}
        </p>
      ) : null}
      {taskDisclosure && presentation.tasks.length > 0 ? (
        <Collapsible open={tasksOpen} onOpenChange={setTasksOpen}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex min-h-7 w-full min-w-0 items-center gap-2 rounded-sm px-1.5 text-left outline-none transition-colors duration-(--duration-fast) hover:bg-accent/30 focus-visible:focus-ring motion-reduce:transition-none"
              aria-expanded={tasksOpen}
              aria-controls={taskContentId}
            >
              <TbChevronRight
                className={cn(
                  'size-3.5 shrink-0 text-muted-foreground transition-transform duration-(--duration-fast) motion-reduce:transition-none',
                  tasksOpen && 'rotate-90',
                )}
                aria-hidden
              />
              <span className="shrink-0 text-micro font-medium text-muted-foreground">
                {presentation.tasks.length === 1
                  ? t('tool.subagent.task')
                  : t('tool.subagent.tasks', { count: presentation.tasks.length })}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-micro text-foreground">
                {presentation.tasks[0]?.agent}
              </span>
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent id={taskContentId}>
            <div className="ml-3.5 min-w-0 space-y-3 border-l border-border/70 py-2 pl-3">
              {taskContent}
            </div>
          </CollapsibleContent>
        </Collapsible>
      ) : taskContent}
      {timeline.length > 0 ? (
        <section className="min-w-0 space-y-2 border-t border-border/70 pt-3" aria-label={t('tool.subagent.execution')}>
          <h4 className="text-micro font-medium text-muted-foreground">
            {t('tool.subagent.execution')}
          </h4>
          <ol className="min-w-0 space-y-2" aria-label={t('tool.subagent.execution')}>
            {timeline.map((event) => {
              const EventIcon = eventIcon(event)
              return (
                <li
                  key={event.id}
                  className="min-w-0 border-l border-border/70 pl-2.5"
                  aria-label={`${eventLabel(event)} · ${eventStateLabel(event)}`}
                >
                  <div className="flex min-w-0 items-center gap-1.5 text-micro">
                    <EventIcon
                      className={cn(
                        'size-3.5 shrink-0 text-muted-foreground',
                        event.state === 'active' && 'animate-pulse motion-reduce:animate-none',
                        event.state === 'failed' && 'text-destructive',
                        event.state === 'complete' && event.kind !== 'progress' && 'text-sage',
                      )}
                      aria-hidden
                    />
                    <span className="shrink-0 font-medium text-muted-foreground">
                      {eventLabel(event)}
                    </span>
                    {event.agent ? (
                      <span className="min-w-0 truncate font-mono text-muted-foreground/80" title={event.agent}>
                        {event.agent}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1 min-w-0">
                    {event.kind === 'tool' ? (
                      event.markdown !== event.toolName ? (
                        <p className="whitespace-pre-wrap break-words font-mono text-micro text-foreground/90">
                          {event.markdown}
                        </p>
                      ) : null
                    ) : (
                      <MarkdownContent markdown={event.markdown} />
                    )}
                    {event.truncated ? (
                      <p className="text-micro text-muted-foreground">
                        {t('tool.subagent.previewLimited')}
                      </p>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ol>
          {presentation.timelineOmittedCount && presentation.timelineOmittedCount > 0 ? (
            <p className="text-micro text-muted-foreground">
              {t('tool.subagent.timelineOmitted', { count: presentation.timelineOmittedCount })}
            </p>
          ) : null}
        </section>
      ) : null}
      {presentation.output && !timelineOutput.has(presentation.output.markdown) ? (
        <section className="min-w-0 space-y-1.5 border-t border-border/70 pt-3">
          <h4 className={cn(
            'text-micro font-medium text-muted-foreground',
            presentation.output.kind === 'error' && 'text-destructive',
          )}>
            {outputLabel}
          </h4>
          <MarkdownContent markdown={presentation.output.markdown} />
          {presentation.output.truncated ? (
            <p className="text-micro text-muted-foreground">
              {t('tool.subagent.previewLimited')}
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}

export function ToolCallCard({ call }: { call: ToolCall }) {
  const t = useT()
  const { appearance } = useSettings()
  const [open, setOpen] = React.useState(!appearance.compactToolCards || call.status === 'failed')
  const [copied, setCopied] = React.useState(false)
  const previousFailedRef = React.useRef(call.status === 'failed')
  const Icon = kindIcon[call.kind]
  const details = {
    arguments: call.kind === 'shell'
      ? undefined
      : call.details?.arguments ?? (call.body ? projectPlainText(call.body) : undefined),
    progress: call.details?.progress ?? (call.progress ? projectStructuredValue(call.progress) : undefined),
    result: call.details?.result ?? (call.output ? projectStructuredValue(call.output) : undefined),
    error: call.details?.error ?? (call.error ? projectStructuredValue(call.error) : undefined),
    patch: call.details?.patch ?? (call.patch ? projectPlainText(call.patch) : undefined),
  }
  const argumentProjection = call.kind === 'shell' ? undefined : call.details?.arguments
  const summary = call.malformed || argumentProjection?.kind === 'malformed'
    ? t('tool.valueMalformed')
    : argumentProjection?.kind === 'unsupported'
      ? t('tool.valueUnsupported')
      : argumentProjection?.kind === 'truncated'
        ? t('tool.valueTruncated')
        : call.summary ?? call.body

  React.useEffect(() => {
    const failed = call.status === 'failed'
    if (!previousFailedRef.current && failed) setOpen(true)
    previousFailedRef.current = failed
  }, [call.status])

  const copy = async () => {
    const value = toolCallCopyText(call)
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      setCopied(false)
    }
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="min-w-0" data-tool-kind={call.kind} data-tool-id={call.id}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex h-[var(--tool-row-h)] w-full cursor-pointer items-center gap-2 rounded-md border border-border/50 bg-card/70 px-2 text-left outline-none transition-colors duration-(--duration-fast) hover:border-border hover:bg-accent/40 focus-visible:focus-ring motion-reduce:transition-none"
            aria-expanded={open}
          >
            <TbChevronRight className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform duration-(--duration-fast) motion-reduce:transition-none', open && 'rotate-90')} aria-hidden />
            <span className="flex w-4 shrink-0 justify-center"><Icon className="size-3.5 text-muted-foreground" aria-hidden /></span>
            <span className="shrink-0 text-caption font-medium text-foreground">{call.title}</span>
            {summary ? (
              <span className={cn(
                'min-w-0 flex-1 truncate text-micro text-muted-foreground',
                !call.subagent && 'font-mono',
              )} title={summary}>
                {summary}
              </span>
            ) : <span className="min-w-0 flex-1" />}
            {call.diff && (
              <span className="shrink-0 text-micro tabular-nums">
                <span className="text-sage">+{call.diff.added}</span>
                {' / '}
                <span className="text-destructive">-{call.diff.deleted}</span>
              </span>
            )}
            {call.duration && <span className="shrink-0 text-micro tabular-nums text-muted-foreground/70">{call.duration}</span>}
            <ToolCallStatus status={call.status} />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="ml-3.5 space-y-2 border-l border-border/70 py-2 pl-3">
            <div className="flex justify-end">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="xs" onClick={() => void copy()} aria-label={t('tool.copy')}>
                    {copied ? <TbCheck aria-hidden /> : <TbCopy aria-hidden />}
                    {copied ? t('tool.copied') : t('tool.copy')}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('tool.copy')}</TooltipContent>
              </Tooltip>
            </div>
            {call.subagent ? (
              <SubagentDetails presentation={call.subagent} />
            ) : call.kind === 'shell' ? (
              <div className="min-w-0 space-y-2">
                {call.body ? (
                  <pre className="scroll-slim max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-2.5 font-mono text-micro text-foreground/90">
                    <code>{call.body}</code>
                  </pre>
                ) : null}
                {call.progress || details.progress?.copyText ? (
                  <ShellEvidence label={t('tool.progress')} source={call.progress ?? details.progress?.copyText ?? ''} />
                ) : null}
                {call.output || details.result?.copyText ? (
                  <ShellEvidence label={t('tool.result')} source={call.output ?? details.result?.copyText ?? ''} />
                ) : null}
                {call.error || details.error?.copyText ? (
                  <ShellEvidence label={t('tool.error')} source={call.error ?? details.error?.copyText ?? ''} tone="error" />
                ) : null}
                {call.patch || details.patch?.copyText ? (
                  <ShellEvidence label={t('tool.patch')} source={call.patch ?? details.patch?.copyText ?? ''} />
                ) : null}
              </div>
            ) : (
              <>
                {details.arguments ? <StructuredValueView label={t('tool.arguments')} projection={details.arguments} /> : null}
                {details.progress ? <StructuredValueView label={t('tool.progress')} projection={details.progress} /> : null}
                {details.result ? <StructuredValueView label={t('tool.result')} projection={details.result} /> : null}
                {details.error ? <StructuredValueView label={t('tool.error')} projection={details.error} tone="error" /> : null}
                {details.patch ? <StructuredValueView label={t('tool.patch')} projection={details.patch} /> : null}
              </>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}
