import * as React from 'react'
import { TbArrowUpRight, TbChevronRight, TbFile, TbFileDescription, TbLoader2, TbTarget } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { MarkdownContent } from '@/components/chat/markdown/MarkdownContent'
import { InlineMarkdown } from '@/components/chat/markdown/InlineMarkdown'
import { useLocale, useT, type MessageKey } from '@/i18n'
import { usePiRuntime, usePiSessionEntries, type PiConversationPresentation } from '@/store/pi-rpc'
import { projectConversationContext, type ConversationResource } from '@/renderer/pi-rpc/conversation-context'
import { PLAN_LIFECYCLE_KEYS, planNeedsDecision } from '@/components/chat/plan-presentation'
import { cn } from '@/lib/utils'
import type { GoalActionId, GoalModeProjection, PlanModeProjection } from '@/renderer/pi-rpc/adapters'

const goalLifecycleKeys = {
  active: 'goal.lifecycle.active', queued: 'goal.lifecycle.queued', waiting: 'goal.lifecycle.waiting',
  paused: 'goal.lifecycle.paused', blocked: 'goal.lifecycle.blocked',
  'usage-limited': 'goal.lifecycle.usageLimited', 'budget-limited': 'goal.lifecycle.budgetLimited',
  complete: 'goal.lifecycle.complete',
} as const

function Section({ title, count, children, initiallyOpen = false }: { title: string; count: number; children: React.ReactNode; initiallyOpen?: boolean }) {
  return <Collapsible defaultOpen={initiallyOpen} className="pt-3">
    <CollapsibleTrigger className="group flex w-full min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-left text-micro font-semibold text-muted-foreground hover:text-foreground focus-visible:focus-ring">
      <span className="min-w-0 flex-1">{title}</span>
      <span className="tabular-nums font-normal">{count}</span>
      <TbChevronRight aria-hidden className="size-3 shrink-0 stroke-[2.6] transition-transform duration-150 group-data-[state=open]:rotate-90 motion-reduce:transition-none" />
    </CollapsibleTrigger>
    <CollapsibleContent className="pt-1">{children}</CollapsibleContent>
  </Collapsible>
}

function ResourceList({ items, onNavigate }: { items: readonly ConversationResource[]; onNavigate: (entryId: string) => void }) {
  const t = useT()
  const [limit, setLimit] = React.useState(12)
  return <ul className="space-y-px">
    {items.slice(0, limit).map((item) => <li key={item.path}>
      <button className="group flex w-full min-w-0 items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-fill focus-visible:focus-ring" onClick={() => onNavigate(item.entryId)} title={`${item.path} · ${t('taskContext.viewRecord')}`}>
        <TbFile className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <span className="min-w-0 flex-1"><span className="block break-words text-caption [overflow-wrap:anywhere]">{item.path}</span><span className="text-micro text-muted-foreground">{t(`taskContext.file.${item.action}`)}</span></span>
        <TbArrowUpRight className="mt-0.5 size-3 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden />
      </button>
    </li>)}
    {items.length > limit ? <li><Button size="xs" variant="ghost" onClick={() => setLimit((value) => value + 24)}>{t('taskContext.more')}</Button></li> : null}
  </ul>
}

/** The plan itself lives in the transcript; Overview only says where it stands and links to it. */
function PluginPlan({ plan, onReveal }: { plan: PlanModeProjection; onReveal: () => void }) {
  const t = useT()
  const state = t(PLAN_LIFECYCLE_KEYS[plan.lifecycle])
  const waiting = planNeedsDecision(plan.lifecycle)
  return <button data-plan-summary onClick={onReveal} aria-label={t('plan.overview.open', { state })}
    className="mac-box group flex w-full min-w-0 items-center gap-2.5 px-3 py-2.5 text-left focus-visible:focus-ring">
    <span className="grid size-5 shrink-0 place-items-center rounded-[5px] bg-primary bg-[linear-gradient(to_bottom,rgb(255_255_255/0.2),transparent)] text-white" aria-hidden><TbFileDescription className="size-3" /></span>
    <span className="min-w-0 flex-1 text-caption font-medium">{t('taskContext.plan')}</span>
    <span className={cn('inline-flex min-w-0 items-center gap-1.5 truncate text-micro', waiting ? 'font-medium text-primary' : 'text-muted-foreground')}>
      {plan.lifecycle === 'planning' || plan.lifecycle === 'implementing' ? <TbLoader2 className="size-3 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden /> : null}
      {state}
    </span>
    <TbChevronRight className="size-3 shrink-0 stroke-[2.6] text-muted-foreground" aria-hidden />
  </button>
}

function PluginGoal({ goal, onAction }: {
  goal: GoalModeProjection
  onAction?: (action: GoalActionId) => Promise<void>
}) {
  const t = useT()
  const [busy, setBusy] = React.useState<GoalActionId | null>(null)
  const [failed, setFailed] = React.useState(false)
  const mounted = React.useRef(true)
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const invoke = async (action: GoalActionId) => {
    if (!onAction || busy || !goal.actions.includes(action)) return
    setBusy(action); setFailed(false)
    try { await onAction(action) }
    catch { if (mounted.current) setFailed(true) }
    finally { if (mounted.current) setBusy(null) }
  }
  return <Collapsible className="mac-box" aria-label={t('goal.title')}>
    <CollapsibleTrigger className="group flex w-full min-w-0 items-center gap-2.5 rounded-[inherit] px-3 py-2.5 text-left hover:bg-fill focus-visible:focus-ring" data-goal-summary>
      <span className="grid size-5 shrink-0 place-items-center rounded-[5px] bg-[#34c759] bg-[linear-gradient(to_bottom,rgb(255_255_255/0.2),transparent)] text-white" aria-hidden><TbTarget className="size-3" /></span>
      <span className="min-w-0 flex-1 text-caption font-medium">{t('goal.title')}</span>
      <span className="truncate text-micro text-muted-foreground">{t(goalLifecycleKeys[goal.lifecycle])}</span>
      <TbChevronRight aria-hidden className="size-3 shrink-0 stroke-[2.6] text-muted-foreground transition-transform duration-150 group-data-[state=open]:rotate-90 motion-reduce:transition-none" />
    </CollapsibleTrigger>
    <CollapsibleContent className="px-3 pt-1 pb-3">
      {goal.goal?.text ? <div className="mb-3 [&_.md-body]:text-caption"><MarkdownContent markdown={goal.goal.text} /></div> : null}
      {goal.goal?.waiting?.reason ? <p className="mb-3 text-caption text-muted-foreground">{t('goal.waitingReason', { reason: goal.goal.waiting.reason })}</p> : null}
      <div className="flex flex-wrap gap-1.5">{goal.actions.map((action) => <Button key={action} size="sm" variant="outline" disabled={!onAction || Boolean(busy)} aria-busy={busy === action || undefined} onClick={() => void invoke(action)}>
        {busy === action ? <TbLoader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : null}{t(`goal.action.${action}`)}
      </Button>)}</div>
      {failed ? <p role="alert" className="mt-2 text-caption text-destructive">{t('goal.action.failed')}</p> : null}
    </CollapsibleContent>
  </Collapsible>
}

export function ConversationContextPanel({ presentation, planMode, goalMode, onRevealPlan, onGoalAction, onNavigate, onSuggest }: {
  presentation: PiConversationPresentation
  planMode: PlanModeProjection | null
  goalMode: GoalModeProjection | null
  onRevealPlan: () => void
  onGoalAction?: (action: GoalActionId) => Promise<void>
  onNavigate: (entryId: string) => void
  onSuggest: (text: string) => void
}) {
  const t = useT()
  const locale = useLocale()
  const pi = usePiRuntime()
  const entries = usePiSessionEntries()
  const context = React.useMemo(() => entries ? projectConversationContext(entries.entries, entries.leafId, pi.commands) : null, [entries, pi.commands])
  const [linksLimit, setLinksLimit] = React.useState(12)
  const [capabilityLimit, setCapabilityLimit] = React.useState(12)
  const [summaryExpanded, setSummaryExpanded] = React.useState(false)
  const identityMatches = presentation.status === 'ready' && entries?.sessionId === presentation.sessionId && entries.generation === pi.runtime?.generation
  const task = identityMatches ? context?.task : null
  const plan = identityMatches && planMode && planMode.sessionId === entries?.sessionId && planMode.generation === entries?.generation ? planMode : null
  const goal = identityMatches && goalMode && goalMode.sessionId === entries?.sessionId && goalMode.generation === entries?.generation ? goalMode : null
  if (presentation.status !== 'ready' || !identityMatches || !context) {
    const loading = presentation.status === 'loading' || (presentation.status === 'ready' && !identityMatches)
    return <div role={presentation.status === 'error' ? 'alert' : 'status'} className="flex h-full items-center justify-center gap-2 px-5 text-center text-caption text-muted-foreground">
      {loading ? <TbLoader2 className="size-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden /> : null}
      {t(loading ? 'taskContext.loading' : presentation.status === 'error' ? 'taskContext.failed' : 'taskContext.unselected')}
    </div>
  }
  if (!context.valid) return <p role="alert" className="p-5 text-caption text-destructive">{t('taskContext.failed')}</p>
  const running = pi.session?.isStreaming || pi.session?.isCompacting || pi.retryActivity.kind === 'provider'
    || (pi.retryActivity.kind === 'summarization' && pi.retryActivity.phase !== 'finished')
  const usedCapabilities = context.capabilities.filter((capability) => capability.entryId !== undefined)
  const needsAttention = Boolean(task?.blockers.length) || Boolean(goal && ['blocked', 'waiting', 'usage-limited', 'budget-limited'].includes(goal.lifecycle))
  const statusKey: MessageKey = running ? 'taskContext.status.responding' : needsAttention ? 'taskContext.status.blocked' : 'taskContext.status.ready'
  const hasSuggestions = !running && context.suggestionsCurrent && !['active', 'queued'].includes(goal?.lifecycle ?? '') && Boolean(task?.nextActions.length)
  const blockers = task?.blockers.length ? <section className="rounded-lg bg-warning/10 px-3 py-2.5 shadow-[inset_0_0_0_0.5px_color-mix(in_srgb,var(--color-warning)_35%,transparent)]" aria-label={t('taskContext.blockers')}>
    <h3 className="text-caption font-semibold">{t('taskContext.blockers')}</h3>
    {task.blockers.map((blocker, index) => <div key={index} className="mt-1.5 [&_.md-body]:text-caption"><MarkdownContent markdown={blocker} /></div>)}
  </section> : null
  return <div className="scroll-slim h-full min-w-0 overflow-x-hidden overflow-y-auto p-4" data-conversation-context>
    <section className="pb-4" aria-label={t('taskContext.summary')}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-micro text-muted-foreground">
        <span role="status" className="inline-flex min-w-0 items-center gap-1.5">
          {running ? <TbLoader2 className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden /> : <span className={`size-1.5 shrink-0 rounded-full ${needsAttention ? 'bg-warning' : 'bg-muted-foreground/50'}`} aria-hidden />}
          {t(statusKey)}
        </span>
        {task ? <span>{t('taskContext.updated', { time: new Date(task.updatedAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) })}</span> : null}
      </div>
      {task?.summary ? <>
        {task.summary.length > 240 && !summaryExpanded
          ? <p className="line-clamp-5 text-caption leading-relaxed"><InlineMarkdown markdown={task.summary} /></p>
          : <div className="text-caption [&_.md-body]:text-caption"><MarkdownContent markdown={task.summary} /></div>}
        {task.summary.length > 240 ? <Button variant="ghost" size="xs" className="mt-1 -ml-2" aria-expanded={summaryExpanded} onClick={() => setSummaryExpanded((value) => !value)}>{t(summaryExpanded ? 'taskContext.summaryLess' : 'taskContext.summaryMore')}</Button> : null}
      </> : <p className="text-caption leading-relaxed text-muted-foreground">{t('taskContext.noSummary')}</p>}
      {hasSuggestions ? <section className="mt-3" aria-label={t('taskContext.next')}>
        <p className="sr-only">{t('taskContext.draftHint')}</p>
        {task!.nextActions.slice(0, 3).map((action) => <button key={action.id} onClick={() => onSuggest(action.prompt)} title={t('taskContext.draftHint')} className="group -mx-2 flex w-[calc(100%+1rem)] items-start gap-2 rounded-md px-2 py-1.5 text-left text-caption text-foreground/85 hover:bg-fill hover:text-foreground focus-visible:focus-ring">
          <TbArrowUpRight className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
          <span className="min-w-0 flex-1 break-words"><InlineMarkdown markdown={action.label} /></span>
        </button>)}
      </section> : null}
    </section>
    {blockers ? <div className="pb-4">{blockers}</div> : null}
    {plan || goal ? <div className="space-y-2 pb-1">
      {plan ? <PluginPlan plan={plan} onReveal={onRevealPlan} /> : null}
      {goal ? <PluginGoal key={`${goal.scopeKey}:${goal.sessionId}:${goal.generation}:${goal.goal?.id ?? ''}`} goal={goal} onAction={onGoalAction} /> : null}
    </div> : null}
    {context.outputs.length ? <Section title={t('taskContext.outputs')} count={context.outputs.length} initiallyOpen><ResourceList items={context.outputs} onNavigate={onNavigate} /></Section> : null}
    {context.sources.length ? <Section title={t('taskContext.sources')} count={context.sources.length}><ResourceList items={context.sources} onNavigate={onNavigate} /></Section> : null}
    {usedCapabilities.length ? <Section title={t('taskContext.capabilities')} count={usedCapabilities.length}>
      <ul className="space-y-1">{usedCapabilities.slice(0, capabilityLimit).map((item) => <li key={`${item.kind}:${item.name}`} className="min-w-0">
        <button className="w-full rounded-md px-2 py-1.5 text-left hover:bg-fill focus-visible:focus-ring" onClick={() => onNavigate(item.entryId!)}><span className="block break-words text-caption">{item.name}</span><span className="text-micro text-muted-foreground">{t(item.kind === 'skill' ? 'taskContext.skillInvoked' : 'taskContext.mcpUsed')}</span></button>
      </li>)}</ul>
      {usedCapabilities.length > capabilityLimit ? <Button size="xs" variant="ghost" onClick={() => setCapabilityLimit((value) => value + 24)}>{t('taskContext.more')}</Button> : null}
    </Section> : null}
    {context.links.length ? <Section title={t('taskContext.web')} count={context.links.length}>
      <p className="mb-2 px-2 text-micro text-muted-foreground">{t('taskContext.mentionedOnly')}</p>
      <ul>{context.links.slice(0, linksLimit).map((link) => <li key={link.url}><button onClick={() => onNavigate(link.entryId)} className="w-full rounded-md px-2 py-1.5 text-left text-caption text-primary break-words [overflow-wrap:anywhere] hover:bg-fill focus-visible:focus-ring" title={t('taskContext.viewRecord')}>{link.url}</button></li>)}</ul>
      {context.links.length > linksLimit ? <Button size="xs" variant="ghost" onClick={() => setLinksLimit((value) => value + 24)}>{t('taskContext.more')}</Button> : null}
    </Section> : null}
  </div>
}
