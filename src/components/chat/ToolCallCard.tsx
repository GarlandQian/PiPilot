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
import { classifyWorkspaceFile } from '@/components/inspector/workspace-file-kind'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import { projectPlainText } from '@/renderer/pi-rpc/structured-value'
import { toolCallCopyText } from '@/renderer/pi-rpc/tool-presenters'
import { useSettings } from '@/store/settings'
import type {
  StructuredValueNode,
  StructuredValueProjection,
  SubagentPresentation,
  SubagentTimelineEvent,
  ToolCall,
} from '@/types/chat'
import { MarkdownContent } from './markdown/MarkdownContent'
import { isVerbatimToolEvidence, ShellEvidence } from './ShellEvidence'
import { ToolCallStatus, toolStatusIcon } from './ToolCallStatus'

const kindIcon = {
  read: TbFileText,
  shell: TbTerminal2,
  edit: TbFileDiff,
  generic: TbTool,
} as const

const detailLabelKey = {
  arguments: 'tool.arguments',
  progress: 'tool.progress',
  result: 'tool.result',
  error: 'tool.error',
  patch: 'tool.patch',
} as const

function ValueFields({ nodes, verbatim = false }: {
  nodes: readonly StructuredValueNode[]
  verbatim?: boolean
}) {
  const t = useT()
  return (
    <div className="min-w-0 space-y-2">
      {nodes.map((node, index) => {
        const literalField = verbatim || /^(?:commands?|paths?|files?|file_?path|file_?name|cwd|code|source|patch|diff|old_?text|new_?text|old_string|new_string)$/iu.test(node.label ?? '')
        return (
          <div key={`${node.label ?? node.kind}:${index}`} className="min-w-0">
            {node.label ? (
              <p className="mb-0.5 break-words text-micro text-muted-foreground">{node.label}</p>
            ) : null}
            <div className={cn('min-w-0', node.label && 'pl-2')}>
              {node.kind === 'object' || node.kind === 'array' ? (
                node.children.length > 0 ? (
                  <ValueFields nodes={node.children} verbatim={literalField} />
                ) : (
                  <span className="font-mono text-caption text-muted-foreground">
                    {node.kind === 'object' ? '{}' : '[]'}
                  </span>
                )
              ) : node.kind === 'scalar' ? (
                literalField || isVerbatimToolEvidence(node.value) ? (
                  <pre className="whitespace-pre-wrap break-words font-mono text-caption leading-relaxed text-foreground/85">
                    {node.value}
                  </pre>
                ) : <MarkdownContent markdown={node.value} />
              ) : (
                <p className={cn('text-micro', node.kind === 'unsupported' ? 'text-destructive' : 'text-muted-foreground')}>
                  {t(node.kind === 'unsupported' ? 'tool.valueUnsupported' : 'tool.valueTruncated')}
                </p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ToolValueEvidence({
  label,
  projection,
  source,
  format = 'markdown',
  tone = 'default',
}: {
  label: string
  projection?: StructuredValueProjection
  source?: string
  format?: 'auto' | 'markdown' | 'verbatim'
  tone?: 'default' | 'error'
}) {
  const t = useT()
  if (!projection && !source) return null
  const text = source ?? projection?.copyText ?? ''
  const fields = format !== 'verbatim' && projection &&
    !projection.malformed && !projection.unsupported &&
    (projection.valueKind === 'object' || projection.valueKind === 'array')

  return (
    <div className="min-w-0 space-y-1">
      {projection?.malformed ? (
        <p className="text-micro text-warning" role="status">{t('tool.valueMalformed')}</p>
      ) : null}
      {projection?.unsupported ? (
        <p className="text-micro text-destructive" role="status">{t('tool.valueUnsupported')}</p>
      ) : null}
      {fields ? (
        <section className="min-w-0 space-y-1.5">
          <h4 className={cn('text-micro font-medium text-muted-foreground', tone === 'error' && 'text-destructive')}>
            {label}
          </h4>
          <div className="scroll-slim max-h-[min(28rem,55vh)] min-w-0 overflow-auto pr-1">
            <ValueFields nodes={projection.nodes} />
          </div>
          {projection.truncated ? (
            <p className="text-micro text-muted-foreground">{t('tool.valueTruncated')}</p>
          ) : null}
        </section>
      ) : (
        <ShellEvidence
          label={label}
          source={text}
          sourceTruncated={projection?.truncated}
          tone={tone}
          format={source === undefined && (projection?.malformed || projection?.unsupported) ? 'verbatim' : format}
        />
      )}
    </div>
  )
}

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
  const [sourceOpen, setSourceOpen] = React.useState(false)
  const [copied, setCopied] = React.useState(false)
  const previousFailedRef = React.useRef(call.status === 'failed')
  const copyFeedbackTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const contentId = React.useId()
  const sourceContentId = React.useId()
  const Icon = kindIcon[call.kind]
  const details = {
    arguments: call.kind === 'shell'
      ? undefined
      : call.details?.arguments ?? (call.body ? projectPlainText(call.body) : undefined),
    progress: call.details?.progress ?? (call.progress ? projectPlainText(call.progress) : undefined),
    result: call.details?.result ?? (call.output ? projectPlainText(call.output) : undefined),
    error: call.details?.error ?? (call.error ? projectPlainText(call.error) : undefined),
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
  const argumentRoot = argumentProjection?.nodes[0]
  const argumentFields = argumentRoot?.kind === 'object' ? argumentRoot.children : []
  const contentFields = call.kind === 'edit' && !details.patch
    ? argumentFields.filter((node) => node.kind === 'scalar' && ['content', 'oldText', 'newText'].includes(node.label ?? ''))
    : []
  const readFileKind = call.kind === 'read' ? classifyWorkspaceFile(call.body.trim()).kind : null
  const resultFormat = readFileKind === 'source' || ['grep', 'find', 'ls'].includes(call.title.toLowerCase())
    ? 'verbatim' : readFileKind === 'plain' ? 'auto' : 'markdown'
  const sourceEntries = Object.entries(details).filter(
    (entry): entry is [keyof typeof detailLabelKey, StructuredValueProjection] => entry[1] !== undefined,
  )

  React.useEffect(() => () => {
    if (copyFeedbackTimer.current) clearTimeout(copyFeedbackTimer.current)
  }, [])

  React.useEffect(() => {
    const failed = call.status === 'failed'
    if (!previousFailedRef.current && failed) setOpen(true)
    previousFailedRef.current = failed
  }, [call.status])

  const copy = async () => {
    const value = toolCallCopyText(call)
    if (copyFeedbackTimer.current) clearTimeout(copyFeedbackTimer.current)
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      copyFeedbackTimer.current = setTimeout(() => {
        setCopied(false)
        copyFeedbackTimer.current = null
      }, 1_200)
    } catch {
      setCopied(false)
    }
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="group/tool min-w-0" data-tool-kind={call.kind} data-tool-id={call.id}>
        <div className="flex min-w-0 items-center gap-0.5 rounded-sm hover:bg-accent/35">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex min-h-[var(--tool-row-h)] min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-sm px-1.5 py-1 text-left outline-none transition-colors duration-(--duration-fast) focus-visible:focus-ring motion-reduce:transition-none"
              aria-expanded={open}
              aria-controls={contentId}
            >
              <TbChevronRight className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform duration-(--duration-fast) motion-reduce:transition-none', open && 'rotate-90')} aria-hidden />
              <span className="flex w-4 shrink-0 justify-center"><Icon className="size-3.5 text-muted-foreground" aria-hidden /></span>
              <span className="shrink-0 text-caption font-medium text-muted-foreground">{call.title}</span>
              {summary ? (
                <span className={cn(
                  'min-w-0 flex-1 truncate text-caption text-muted-foreground',
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
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                className={cn(
                  'mr-1 shrink-0 opacity-0 group-hover/tool:opacity-100 focus-visible:opacity-100',
                  (open || copied) && 'opacity-100',
                )}
                onClick={() => void copy()}
                aria-label={copied ? t('tool.copied') : t('tool.copy')}
              >
                {copied ? <TbCheck className="text-sage" aria-hidden /> : <TbCopy aria-hidden />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{copied ? t('tool.copied') : t('tool.copy')}</TooltipContent>
          </Tooltip>
        </div>
        <CollapsibleContent id={contentId}>
          <div className="ml-7 min-w-0 space-y-3 pb-3 pl-1 pt-1">
            {call.subagent ? (
              <SubagentDetails presentation={call.subagent} />
            ) : call.kind === 'shell' ? (
              <div className="min-w-0 space-y-2">
                {call.body ? (
                  <ShellEvidence label={t('tool.command')} source={call.body} format="verbatim" />
                ) : null}
                {call.progress || details.progress?.copyText ? (
                  <ShellEvidence
                    label={t('tool.progress')}
                    source={call.progress ?? details.progress?.copyText ?? ''}
                    sourceTruncated={details.progress?.truncated}
                  />
                ) : null}
                {call.output || details.result?.copyText ? (
                  <ShellEvidence
                    label={t('tool.result')}
                    source={call.output ?? details.result?.copyText ?? ''}
                    sourceTruncated={details.result?.truncated}
                  />
                ) : null}
                {call.error || details.error?.copyText ? (
                  <ShellEvidence
                    label={t('tool.error')}
                    source={call.error ?? details.error?.copyText ?? ''}
                    sourceTruncated={details.error?.truncated}
                    tone="error"
                  />
                ) : null}
                {call.patch || details.patch?.copyText ? (
                  <ShellEvidence label={t('tool.patch')} source={call.patch ?? details.patch?.copyText ?? ''} format="verbatim" />
                ) : null}
              </div>
            ) : (
              <>
                {call.kind === 'generic' ? (
                  <ToolValueEvidence label={t('tool.arguments')} projection={details.arguments} />
                ) : argumentProjection?.malformed || argumentProjection?.unsupported ? (
                  <p className="text-micro text-destructive" role="status">
                    {t(argumentProjection.malformed ? 'tool.valueMalformed' : 'tool.valueUnsupported')}
                  </p>
                ) : null}
                {contentFields.map((field) => field.kind === 'scalar' ? (
                  <ShellEvidence
                    key={field.label}
                    label={t(field.label === 'oldText'
                      ? 'tool.previousContent'
                      : field.label === 'newText'
                        ? 'tool.newContent'
                        : 'tool.content')}
                    source={field.value}
                    sourceTruncated={argumentProjection?.truncated}
                    format="verbatim"
                  />
                ) : null)}
                <ToolValueEvidence label={t('tool.progress')} projection={details.progress} source={call.progress} format={resultFormat} />
                <ToolValueEvidence label={t('tool.result')} projection={details.result} source={call.output} format={resultFormat} />
                <ToolValueEvidence label={t('tool.error')} projection={details.error} source={call.error} tone="error" />
                <ToolValueEvidence label={t('tool.patch')} projection={details.patch} source={call.patch} format="verbatim" />
                {sourceEntries.length > 0 ? (
                  <Collapsible open={sourceOpen} onOpenChange={setSourceOpen}>
                    <CollapsibleTrigger asChild>
                      <button
                        type="button"
                        className="flex min-h-6 items-center gap-1.5 rounded-sm text-micro text-muted-foreground outline-none hover:text-foreground focus-visible:focus-ring"
                        aria-expanded={sourceOpen}
                        aria-controls={sourceContentId}
                      >
                        <TbChevronRight className={cn('size-3 transition-transform duration-(--duration-fast) motion-reduce:transition-none', sourceOpen && 'rotate-90')} aria-hidden />
                        {t('tool.source')}
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent id={sourceContentId}>
                      <div className="min-w-0 space-y-3 pt-2">
                        {sourceEntries.map(([key, projection]) => (
                          <ShellEvidence
                            key={key}
                            label={t(detailLabelKey[key])}
                            source={projection.copyText}
                            sourceTruncated={projection.truncated}
                            tone={key === 'error' ? 'error' : 'default'}
                            format="verbatim"
                          />
                        ))}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                ) : null}
              </>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}
