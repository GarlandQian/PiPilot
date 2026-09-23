import * as React from 'react'
import { TbChevronRight, TbMessage, TbPlayerPlay, TbRobot } from 'react-icons/tb'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import type { SubagentPresentation, SubagentRunPresentation, SubagentTaskPresentation, SubagentTimelineEvent, ToolCall } from '@/types/chat'
import { MarkdownContent } from './markdown/MarkdownContent'
import { ShellEvidence } from './ShellEvidence'
import { ToolCallStatus, toolStatusIcon } from './ToolCallStatus'

export interface SubagentConversationView {
  id: string
  agent?: string
  task?: SubagentTaskPresentation
  status?: ToolCall['status']
  awaitingCompletion?: boolean
  summary?: SubagentRunPresentation['summary']
  events: readonly SubagentTimelineEvent[]
}

function matchingTask(run: SubagentRunPresentation, presentation: SubagentPresentation) {
  const tasks = presentation.tasks
  if (run.taskId) {
    const sourceTask = tasks.find((task) => task.id === run.taskId)
    if (sourceTask && (!run.agent || sourceTask.agent === run.agent) &&
      (presentation.mode === 'chain' || !run.taskMarkdown || run.taskMarkdown === sourceTask.markdown)) return sourceTask
  }
  const named = tasks.filter((task) => !run.agent || task.agent === run.agent)
  const exact = run.taskMarkdown ? named.filter((task) => task.markdown === run.taskMarkdown) : []
  if (run.taskMarkdown) return exact.length === 1 ? exact[0] : undefined
  // A display name is insufficient when the same agent has multiple tasks.
  return named.length === 1 ? named[0] : undefined
}

/** Keep parallel results separate, including repeated agent names and unknown ownership. */
export function subagentConversationViews(presentation: SubagentPresentation): SubagentConversationView[] {
  const observable = (presentation.timeline ?? []).filter((event) => event.source !== 'summary' && !event.id.startsWith('fallback:'))
  const matchedTasks = new Set<string>()
  const assignedEvents = new Set<string>()
  const views: SubagentConversationView[] = (presentation.runs ?? []).map((run) => {
    const matched = matchingTask(run, presentation)
    if (matched) matchedTasks.add(matched.id)
    const task = run.taskMarkdown ? {
      ...matched,
      id: matched?.id ?? `run-task:${run.id}`,
      agent: run.agent ?? matched?.agent ?? '',
      markdown: run.taskMarkdown,
      truncated: run.taskTruncated ?? false,
    } : matched
    const events = observable.filter((event) => event.runId === run.id)
    for (const event of events) assignedEvents.add(event.id)
    return { id: run.id, agent: run.agent ?? task?.agent, task, status: run.status, awaitingCompletion: run.awaitingCompletion, summary: run.summary, events }
  })
  for (const task of presentation.tasks) {
    if (matchedTasks.has(task.id)) continue
    const uniqueAgent = presentation.tasks.filter((candidate) => candidate.agent === task.agent).length === 1
    const events = observable.filter((event) => !assignedEvents.has(event.id) && !event.runId && (
      event.agent ? uniqueAgent && event.agent === task.agent : presentation.tasks.length === 1
    ))
    for (const event of events) assignedEvents.add(event.id)
    views.push({ id: task.id, agent: task.agent, task, events })
  }
  const unassigned = observable.filter((event) => !assignedEvents.has(event.id))
  if (unassigned.length) views.push({ id: 'unassigned', events: unassigned })
  return views
}

function TimelineEntry({ event }: { event: SubagentTimelineEvent }) {
  const t = useT()
  const status = event.state === 'active' ? 'running'
    : event.state === 'failed' ? 'failed'
      : event.state === 'cancelled' ? 'cancelled'
        : event.state === 'complete' ? 'success' : undefined
  const Icon = event.kind === 'tool' ? TbPlayerPlay
    : event.kind === 'error' ? toolStatusIcon.failed : TbMessage
  const label = event.kind === 'tool' ? event.toolName ?? t('inspector.subagent.redesign.tool')
    : event.source === 'tool' ? t(event.kind === 'error' ? 'tool.error' : 'inspector.subagent.redesign.toolOutput')
      : t(event.kind === 'error' ? 'tool.error' : event.kind === 'result' ? 'tool.result' : 'tool.progress')
  const literal = event.kind === 'tool' || (event.source === 'tool' && /^(bash|shell)$/iu.test(event.toolName ?? ''))
  return (
    <li className="min-w-0" data-subagent-event={event.id} data-subagent-event-kind={event.kind}>
      <article className="min-w-0 border-l-2 border-border pl-3">
        <header className="mb-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-micro text-muted-foreground">
          <Icon className="size-3.5 shrink-0" aria-hidden />
          <span className="font-medium">{label}</span>
          {event.toolName && event.kind !== 'tool' ? <span className="font-mono">{event.toolName}</span> : null}
          {event.agent ? <span className="truncate">{event.agent}</span> : null}
          {status && (event.kind === 'tool' || event.state === 'failed' || event.state === 'cancelled') ? <ToolCallStatus status={status} /> : null}
          {event.state === 'unknown' ? <span>{t('inspector.subagent.redesign.unreportedStatus')}</span> : null}
        </header>
        {literal ? (
          <ShellEvidence label={event.kind === 'tool' ? t('tool.command') : label} source={event.markdown} sourceTruncated={event.truncated} format="verbatim" tone={event.kind === 'error' ? 'error' : 'default'} followOutput={event.source === 'tool' && event.kind !== 'tool'} live={event.state === 'active'} />
        ) : (
          <div className={cn('min-w-0', event.kind === 'error' && 'text-destructive')}>
            <MarkdownContent markdown={event.markdown} />
            {event.truncated ? <p className="mt-2 text-micro text-muted-foreground">{t('tool.subagent.previewLimited')}</p> : null}
          </div>
        )}
      </article>
    </li>
  )
}

function TaskInstructions({ task, disclosure }: { task: SubagentTaskPresentation; disclosure: boolean }) {
  const t = useT()
  const [open, setOpen] = React.useState(!disclosure)
  const contentId = React.useId()
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="min-w-0 rounded-lg border border-border bg-background/40">
      <CollapsibleTrigger asChild>
        <button type="button" className="flex min-h-10 w-full items-center gap-2 px-3 text-left text-caption outline-none focus-visible:focus-ring" aria-controls={contentId}>
          <TbChevronRight className={cn('size-3.5 shrink-0 transition-transform motion-reduce:transition-none', open && 'rotate-90')} aria-hidden />
          <span className="font-medium">{t('tool.subagent.task')}</span>
          <span className="truncate text-muted-foreground">{task.summary ?? task.agent}</span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent id={contentId}>
        <div className="min-w-0 border-t border-border px-3 py-3">
          <MarkdownContent markdown={task.markdown} />
          {task.truncated ? <p className="mt-2 text-micro text-muted-foreground">{t('tool.subagent.previewLimited')}</p> : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function DispatchSummary({ output, disclosure, missingConversation }: {
  output: { markdown: string; truncated: boolean }
  disclosure: boolean
  missingConversation: boolean
}) {
  const t = useT()
  const [open, setOpen] = React.useState(!disclosure)
  return <Collapsible open={open} onOpenChange={setOpen} className="min-w-0 border-t border-border pt-3">
    <CollapsibleTrigger asChild>
      <button type="button" className="flex min-h-8 w-full items-center gap-2 text-left text-micro font-medium text-muted-foreground outline-none focus-visible:focus-ring">
        <TbChevronRight className={cn('size-3.5 shrink-0 transition-transform motion-reduce:transition-none', open && 'rotate-90')} aria-hidden />
        {t('inspector.subagent.redesign.runSummary')}
      </button>
    </CollapsibleTrigger>
    <CollapsibleContent>
      <section className="min-w-0 space-y-2 pt-2" aria-label={t('inspector.subagent.redesign.runSummary')}>
        {missingConversation ? <p className="text-caption text-muted-foreground">{t('inspector.subagent.redesign.summaryOnly')}</p> : null}
        <MarkdownContent markdown={output.markdown} />
        {output.truncated ? <p className="text-micro text-muted-foreground">{t('tool.subagent.previewLimited')}</p> : null}
      </section>
    </CollapsibleContent>
  </Collapsible>
}

export interface SubagentConversationProps {
  presentation: SubagentPresentation
  status?: ToolCall['status']
  scrollable?: boolean
  taskDisclosure?: boolean
  selectedViewId?: string
  onSelectedViewChange?: (id: string) => void
}

export function SubagentConversation({ presentation, status, scrollable = true, taskDisclosure = false, selectedViewId, onSelectedViewChange }: SubagentConversationProps) {
  const t = useT()
  const [internalSelection, setInternalSelection] = React.useState<string>()
  const views = React.useMemo(() => subagentConversationViews(presentation), [presentation])
  const active = views.find((view) => view.id === (selectedViewId ?? internalSelection)) ?? views[0]
  const labelFor = (view: SubagentConversationView, index: number) => `${view.agent ?? t('inspector.subagent.redesign.runActivity')} · ${view.task?.summary ?? t('inspector.subagent.redesign.runNumber', { number: index + 1 })}`
  const select = (id: string) => { setInternalSelection(id); onSelectedViewChange?.(id) }
  const timeline = presentation.timeline ?? []
  const summaries = presentation.output ? [presentation.output] : timeline.filter((event) => event.source === 'summary' || event.id.startsWith('fallback:'))
  const uniqueSummaries = summaries.filter((output, index) => !timeline.some((event) => event.source !== 'summary' && !event.id.startsWith('fallback:') && event.markdown === output.markdown) && summaries.findIndex((candidate) => candidate.markdown === output.markdown) === index)
  // A successful dispatch is not evidence that every child completed successfully.
  const activeStatus = active?.status ?? (!active?.awaitingCompletion && views.length <= 1 && (status === 'detached' || status === 'cancelled' || status === 'queued' || status === 'running') ? status : undefined)
  return (
    <div className={cn('min-w-0 space-y-5', scrollable && 'scroll-slim max-h-[min(36rem,65vh)] overflow-y-auto pr-2')} data-subagent-conversation>
      {presentation.malformed ? <p className="text-caption text-destructive" role="alert">{t('tool.subagent.invalidRequest')}</p> : null}
      {views.length > 1 ? (
        <label className="flex min-w-0 flex-col gap-1.5 text-micro text-muted-foreground">
          {t('inspector.subagent.redesign.selectAgent')}
          <select aria-label={t('inspector.subagent.redesign.selectAgent')} value={active?.id} onChange={(event) => select(event.target.value)} className="min-h-9 w-full min-w-0 rounded-md border border-input bg-background px-2 text-caption text-foreground outline-none focus-visible:focus-ring">
            {views.map((view, index) => <option key={view.id} value={view.id}>{labelFor(view, index)}</option>)}
          </select>
        </label>
      ) : null}
      {active ? (
        <section className="min-w-0 space-y-4" aria-label={active.agent ?? t('inspector.subagent.redesign.runActivity')} data-subagent-run={active.id}>
          <header className="flex min-w-0 flex-wrap items-center gap-2">
            <TbRobot className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-caption font-medium">{active.agent ?? t('inspector.subagent.redesign.runActivity')}</span>
            {activeStatus ? <ToolCallStatus status={activeStatus} live /> : <span className="text-micro text-muted-foreground">{t(active.awaitingCompletion ? 'inspector.subagent.redesign.awaitingCompletion' : 'inspector.subagent.redesign.unreportedStatus')}</span>}
          </header>
          {active.task ? <TaskInstructions key={active.task.id} task={active.task} disclosure={taskDisclosure} /> : <p className="text-micro text-muted-foreground">{t('inspector.subagent.redesign.unmatchedTask')}</p>}
          <section aria-label={t('tool.subagent.execution')} className="min-w-0 space-y-3">
            <h3 className="text-micro font-medium text-muted-foreground">{t('inspector.subagent.redesign.reportedActivity')}</h3>
            {active.events.length ? <ol className="min-w-0 space-y-5" aria-label={t('tool.subagent.execution')}>{active.events.map((event) => <TimelineEntry key={event.id} event={event} />)}</ol> : <p className="rounded-md bg-muted/40 px-3 py-3 text-caption leading-relaxed text-muted-foreground">{t(active.summary || uniqueSummaries.length ? 'inspector.subagent.redesign.summaryOnly' : 'inspector.subagent.redesign.noMessages')}</p>}
            {active.summary && !active.events.some((event) => event.markdown === active.summary?.markdown) ? <section className="min-w-0 space-y-2" aria-label={t('tool.result')}><h4 className="text-micro font-medium text-muted-foreground">{t(active.summary.kind === 'error' ? 'tool.error' : active.summary.kind === 'progress' ? 'tool.progress' : 'tool.result')}</h4><MarkdownContent markdown={active.summary.markdown} />{active.summary.truncated ? <p className="text-micro text-muted-foreground">{t('tool.subagent.previewLimited')}</p> : null}</section> : null}
          </section>
        </section>
      ) : null}
      {uniqueSummaries.map((output, index) => <DispatchSummary key={index} output={output} disclosure={views.length > 1 || Boolean(active?.summary)} missingConversation={!active} />)}
      {(presentation.timelineOmittedCount ?? 0) > 0 ? <p className="text-micro text-muted-foreground">{t('tool.subagent.timelineOmitted', { count: presentation.timelineOmittedCount! })}</p> : null}
      {presentation.omittedTaskCount > 0 ? <p className="text-micro text-muted-foreground">{t('tool.subagent.tasksOmitted', { count: presentation.omittedTaskCount })}</p> : null}
    </div>
  )
}

/** Compatibility for inline tool cards; the inspector owns its outer viewport. */
export const SubagentDetails = SubagentConversation
