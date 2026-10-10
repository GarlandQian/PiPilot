import * as React from 'react'
import { TbClock, TbDots, TbLoader2, TbPencil, TbPlayerPause, TbPlayerPlay, TbPlus, TbRefresh, TbTrash } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { MarkdownContent } from '@/components/chat/markdown/MarkdownContent'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import { useSettings } from '@/store/settings'
import { isScheduledRunActive, scheduledTaskInputSchema, type ScheduledRun, type ScheduledTask, type ScheduledTaskInput, type ScheduledTasksSnapshot, type TaskSchedule, type ScheduledTarget } from '@/shared/scheduled-tasks'
import { DiscardChangesDialog } from './editor-page'
import { FormActions, SettingsBadge, SettingsField, SettingsGroup, SettingsIdentity, SettingsListRow, SettingsPage, SettingsRow, StatusText } from './kit'
import { useSettingsSubpage } from './settings-subpage'

function dateInput(value: number) {
  const date = new Date(value)
  return new Date(value - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}
function blankTask(): ScheduledTaskInput {
  return { name: '', conversationId: '', targetIdentity: '', prompt: '', enabled: true, missedPolicy: 'catch-up-once', schedule: { kind: 'daily', hour: 9, minute: 0, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone } }
}
function inputOf(task: ScheduledTask): ScheduledTaskInput {
  return { id: task.id, name: task.name, conversationId: task.conversationId, targetIdentity: task.targetIdentity, prompt: task.prompt, schedule: task.schedule, missedPolicy: task.missedPolicy, enabled: task.enabled }
}
function publicError(error: unknown) {
  return typeof error === 'object' && error && 'message' in error ? String(error.message) : String(error)
}

function TaskIcon({ enabled }: { enabled: boolean }) {
  return <span className={cn('grid size-8 shrink-0 place-items-center rounded-[9px] bg-[linear-gradient(to_bottom,rgb(255_255_255/0.2),transparent)] text-white shadow-[inset_0_0_0_0.5px_rgb(0_0_0/0.08)]', enabled ? 'bg-[#ff3b30]' : 'bg-[#8e8e93]')} aria-hidden>
    <TbClock className="size-[18px]" />
  </span>
}

function ScheduledResponse({ text, label }: { text: string; label: string }) {
  const [open, setOpen] = React.useState(false)
  return <details className="mt-1" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary className="w-fit cursor-default rounded-sm text-primary focus-visible:focus-ring">{label}</summary>
    {open ? <div className="mt-2 max-h-72 min-w-0 overflow-auto rounded-[10px] bg-surface-inset p-3 shadow-[inset_0_0_0_0.5px_var(--color-border)] dark:bg-black/20"><MarkdownContent markdown={text} /></div> : null}
  </details>
}

const RUN_TONE: Partial<Record<ScheduledRun['status'], 'success' | 'danger' | 'warning'>> = {
  completed: 'success',
  failed: 'danger',
  aborted: 'danger',
  runtime_replaced: 'danger',
  interrupted: 'warning',
}

const DOT = { success: 'bg-success', danger: 'bg-destructive', warning: 'bg-warning', neutral: 'bg-muted-foreground/50' }

type Route = { page: 'list' } | { page: 'edit'; input: ScheduledTaskInput; nonce: number }
let nonce = 0

export function ScheduledTasksSettings() {
  const t = useT()
  const { locale } = useSettings()
  const [snapshot, setSnapshot] = React.useState<ScheduledTasksSnapshot | null>(null)
  const [targets, setTargets] = React.useState<ScheduledTarget[]>([])
  const [cursor, setCursor] = React.useState<string | null>(null)
  const [targetWarning, setTargetWarning] = React.useState(false)
  const [route, setRoute] = React.useState<Route>({ page: 'list' })
  const [busy, setBusy] = React.useState(false)
  const [loadingTargets, setLoadingTargets] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [deleting, setDeleting] = React.useState<ScheduledTask | null>(null)
  const [historyLimit, setHistoryLimit] = React.useState(30)
  const [pendingBack, setPendingBack] = React.useState(false)
  const pageDirty = React.useRef(false)
  const rootRef = React.useRef<HTMLDivElement>(null)
  const listScroll = React.useRef(0)
  const api = window.pipilot?.scheduledTasks
  const accept = React.useCallback((value: ScheduledTasksSnapshot) => setSnapshot((current) => !current || value.revision >= current.revision ? value : current), [])
  const loadTargets = React.useCallback(async (next?: string) => {
    if (!api) return
    setLoadingTargets(true)
    try {
      const page = await api.listTargets(next)
      setTargets((current) => next ? [...new Map([...current, ...page.conversations].map((item) => [item.conversationId, item])).values()] : page.conversations)
      setCursor(page.nextCursor)
      setTargetWarning(page.diagnostics.length > 0)
    } catch (failure) { setError(publicError(failure)) }
    finally { setLoadingTargets(false) }
  }, [api])
  React.useEffect(() => {
    if (!api) return
    let current = true
    const detach = api.subscribe(accept)
    void api.get().then((value) => { if (current) accept(value) }).catch((failure) => { if (current) setError(publicError(failure)) })
    void loadTargets()
    return () => { current = false; detach() }
  }, [accept, api, loadTargets])
  const mutate = async (action: () => Promise<ScheduledTasksSnapshot>, after?: () => void) => {
    if (busy) return false
    setBusy(true); setError(null)
    try { accept(await action()); after?.(); return true } catch (failure) { setError(publicError(failure)); return false }
    finally { setBusy(false) }
  }
  const date = (value: number) => new Intl.DateTimeFormat(locale === 'system' ? undefined : locale, { dateStyle: 'medium', timeStyle: 'short' }).format(value)
  const scheduleText = (schedule: TaskSchedule) => schedule.kind === 'once' ? date(schedule.at) : schedule.kind === 'interval'
    ? t('scheduledTasks.everyMinutes', { minutes: schedule.minutes })
    : `${String(schedule.hour).padStart(2, '0')}:${String(schedule.minute).padStart(2, '0')} · ${schedule.timeZone}`
  const disabled = busy || !api || Boolean(snapshot?.storageError)
  const visibleError = snapshot?.storageError ?? error
  const runningIds = new Set((snapshot?.runs ?? []).filter(isScheduledRunActive).map((run) => run.taskId))

  const scroller = () => rootRef.current?.closest<HTMLElement>('[data-settings-section]') ?? null
  const show = (next: Route) => {
    const container = scroller()
    if (route.page === 'list' && container) listScroll.current = container.scrollTop
    pageDirty.current = false
    setError(null)
    setRoute(next)
    requestAnimationFrame(() => {
      const target = scroller()
      if (target) target.scrollTop = next.page === 'list' ? listScroll.current : 0
    })
  }
  const back = () => {
    if (route.page !== 'list' && pageDirty.current) setPendingBack(true)
    else show({ page: 'list' })
  }
  const editingTask = route.page === 'edit' ? snapshot?.tasks.find((task) => task.id === route.input.id) : undefined
  useSettingsSubpage('scheduled-tasks', route.page === 'edit'
    ? { title: editingTask?.name || t(route.input.id ? 'scheduledTasks.edit' : 'scheduledTasks.create'), back }
    : null)
  // A task deleted elsewhere closes its page.
  React.useEffect(() => {
    if (route.page === 'edit' && route.input.id && snapshot && !snapshot.tasks.some((task) => task.id === route.input.id)) show({ page: 'list' })
    // `show` only reads refs and state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, snapshot])

  const remove = (task: ScheduledTask) => {
    if (api) void mutate(() => api.remove(task.id), () => { setDeleting(null); if (route.page === 'edit' && route.input.id === task.id) show({ page: 'list' }) })
  }

  const taskMenu = (task: ScheduledTask) => {
    const running = runningIds.has(task.id)
    return <DropdownMenu>
      <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-xs" className="text-muted-foreground" disabled={!api} aria-label={t('scheduledTasks.actions', { name: task.name })}><TbDots aria-hidden /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem disabled={disabled || running} onSelect={() => api && void mutate(() => api.runNow(task.id))}><TbPlayerPlay aria-hidden />{t('scheduledTasks.runNow')}</DropdownMenuItem>
        <DropdownMenuItem disabled={disabled} onSelect={() => api && void mutate(() => api.setEnabled(task.id, !task.enabled))}>
          {task.enabled ? <TbPlayerPause aria-hidden /> : <TbPlayerPlay aria-hidden />}{t(task.enabled ? 'scheduledTasks.pause' : 'scheduledTasks.resume')}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={disabled || running} onSelect={() => show({ page: 'edit', input: inputOf(task), nonce: ++nonce })}><TbPencil aria-hidden />{t('scheduledTasks.edit')}</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" disabled={disabled || running} onSelect={() => setDeleting(task)}><TbTrash aria-hidden />{t('scheduledTasks.deleteNamed', { name: task.name })}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  }

  const deleteDialog = <AlertDialog open={Boolean(deleting)} onOpenChange={(open) => { if (!open) setDeleting(null) }}>
    <AlertDialogContent>
      <AlertDialogHeader><AlertDialogTitle>{t('scheduledTasks.delete')}</AlertDialogTitle><AlertDialogDescription>{t('scheduledTasks.deleteHint')}</AlertDialogDescription></AlertDialogHeader>
      <AlertDialogFooter><AlertDialogCancel>{t('scheduledTasks.cancel')}</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => { if (deleting) remove(deleting) }}>{t('scheduledTasks.delete')}</AlertDialogAction></AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>

  if (route.page === 'edit') {
    return <div ref={rootRef} className="min-w-0" data-scheduled-tasks data-scheduled-task-page>
      <TaskEditor key={route.nonce} initial={route.input} task={editingTask} running={Boolean(route.input.id && runningIds.has(route.input.id))}
        targets={targets} cursor={cursor} targetWarning={targetWarning} loadingTargets={loadingTargets} onLoadTargets={(next) => void loadTargets(next)}
        busy={busy} disabled={disabled} error={visibleError} date={date} scheduleText={scheduleText}
        onDirtyChange={(dirty) => { pageDirty.current = dirty }}
        onRunNow={(task) => api && void mutate(() => api.runNow(task.id))}
        onSetEnabled={(task, enabled) => api && void mutate(() => api.setEnabled(task.id, enabled))}
        onDelete={setDeleting}
        onCancel={back}
        onSave={(input) => {
          const parsed = scheduledTaskInputSchema.safeParse(input)
          if (!parsed.success) { setError(t('scheduledTasks.invalid')); return }
          if (api) void mutate(() => api.save(parsed.data), () => show({ page: 'list' }))
        }} />
      {deleteDialog}
      <DiscardChangesDialog open={pendingBack} onOpenChange={setPendingBack} onDiscard={() => { setPendingBack(false); show({ page: 'list' }) }} />
    </div>
  }

  const runs = snapshot?.runs.slice(-historyLimit).reverse() ?? []
  return <div ref={rootRef} className="min-w-0" data-scheduled-tasks>
    <SettingsPage>
      {visibleError ? <p role="alert" className="rounded-[12px] bg-destructive/8 px-3.5 py-2.5 text-caption text-destructive">{visibleError}</p> : null}

      <SettingsGroup title={t('scheduledTasks.title')} info={t('scheduledTasks.policy')} boxRole={snapshot?.tasks.length ? 'list' : undefined} data-scheduled-task-list
        actions={<>
          <Button variant="ghost" size="icon-sm" aria-label={t('scheduledTasks.refreshTargets')} title={t('scheduledTasks.refreshTargets')} disabled={loadingTargets} onClick={() => void loadTargets()}>
            <TbRefresh className={loadingTargets ? 'animate-spin motion-reduce:animate-none' : undefined} aria-hidden />
          </Button>
          <Button variant="outline" size="sm" disabled={disabled} onClick={() => show({ page: 'edit', input: blankTask(), nonce: ++nonce })}><TbPlus aria-hidden />{t('scheduledTasks.create')}</Button>
        </>}
        footer={t('scheduledTasks.description')}>
        {!snapshot ? <p className="flex items-center justify-center gap-2 px-3 py-8 text-caption text-muted-foreground" role="status"><TbLoader2 className="size-4 animate-spin" aria-hidden /></p>
          : snapshot.tasks.length === 0 ? <div className="flex flex-col items-center gap-2 px-3 py-10 text-center">
            <TbClock className="size-7 text-muted-foreground/60" aria-hidden />
            <p className="text-caption text-muted-foreground">{t('scheduledTasks.empty')}</p>
          </div>
            : snapshot.tasks.map((task) => {
              const running = runningIds.has(task.id)
              return <SettingsListRow key={task.id} data-scheduled-task={task.id} icon={<TaskIcon enabled={task.enabled} />} title={task.name}
                dimmed={!task.enabled}
                badges={running ? <SettingsBadge tone="accent"><TbLoader2 className="mr-0.5 size-3 animate-spin motion-reduce:animate-none" aria-hidden />{t('scheduledTasks.running')}</SettingsBadge>
                  : !task.enabled ? <SettingsBadge>{t('scheduledTasks.paused')}</SettingsBadge>
                    : task.nextRunAt === null ? <SettingsBadge>{t('scheduledTasks.finished')}</SettingsBadge> : null}
                subtitle={`${scheduleText(task.schedule)} · ${task.targetLabel}`}
                status={task.enabled && task.nextRunAt !== null ? <StatusText>{t('scheduledTasks.next', { time: date(task.nextRunAt) })}</StatusText> : undefined}
                onOpen={() => show({ page: 'edit', input: inputOf(task), nonce: ++nonce })} openLabel={t('scheduledTasks.editNamed', { name: task.name })}
                menu={taskMenu(task)} />
            })}
      </SettingsGroup>

      <SettingsGroup title={t('scheduledTasks.history')} info={t('scheduledTasks.historyHint')} data-scheduled-history>
        {snapshot?.runs.length === 0 ? <p className="px-3 py-6 text-center text-caption text-muted-foreground">{t('scheduledTasks.noHistory')}</p> : null}
        {runs.map((run) => <RunRow key={run.id} run={run} date={date} />)}
        {snapshot && snapshot.runs.length > historyLimit ? <div data-settings-row className="flex justify-center px-3 py-1.5">
          <Button variant="ghost" size="sm" className="text-primary" onClick={() => setHistoryLimit((value) => value + 30)}>{t('scheduledTasks.moreHistory')}</Button>
        </div> : null}
      </SettingsGroup>
    </SettingsPage>
    {deleteDialog}
  </div>
}

function RunRow({ run, date }: { run: ScheduledRun; date(value: number): string }) {
  const t = useT()
  const active = isScheduledRunActive(run)
  return <article data-settings-row data-scheduled-run={run.status} className="min-w-0 px-3 py-2 text-caption">
    <div className="flex min-w-0 items-center gap-2">
      <span className={cn('size-2 shrink-0 rounded-full', active ? 'animate-pulse bg-primary motion-reduce:animate-none' : DOT[RUN_TONE[run.status] ?? 'neutral'])} aria-hidden />
      <span className="min-w-0 flex-1 truncate text-app">{run.taskName}</span>
      <StatusText tone={RUN_TONE[run.status] ?? 'neutral'} className="shrink-0">{t(`scheduledTasks.status.${run.status}`)}</StatusText>
    </div>
    <div className="pl-4">
      <p className="text-muted-foreground">{date(run.startedAt)} · {t(run.trigger === 'manual' ? 'scheduledTasks.manual' : 'scheduledTasks.scheduled')}</p>
      {run.errorCode === 'previous_run_active' ? <p>{t('scheduledTasks.overlapSkipped')}</p> : run.errorCode === 'missed_schedule' ? <p>{t('scheduledTasks.missedSkipped')}</p> : null}
      {run.status === 'interrupted' ? <p className="text-warning">{t('scheduledTasks.interruptedHint')}</p> : run.error ? <p className="break-words text-destructive">{run.error}</p> : null}
      {run.finalResponse ? <ScheduledResponse text={run.finalResponse} label={t('scheduledTasks.result')} /> : null}
    </div>
  </article>
}

/** A task's own page: who it is and the main actions on top, then what it sends, where and when. */
function TaskEditor({ initial, task, running, targets, cursor, targetWarning, loadingTargets, onLoadTargets, busy, disabled, error, date, scheduleText, onDirtyChange, onRunNow, onSetEnabled, onDelete, onCancel, onSave }: {
  initial: ScheduledTaskInput
  task?: ScheduledTask
  running: boolean
  targets: readonly ScheduledTarget[]
  cursor: string | null
  targetWarning: boolean
  loadingTargets: boolean
  onLoadTargets(cursor?: string): void
  busy: boolean
  disabled: boolean
  error: string | null
  date(value: number): string
  scheduleText(schedule: TaskSchedule): string
  onDirtyChange(dirty: boolean): void
  onRunNow(task: ScheduledTask): void
  onSetEnabled(task: ScheduledTask, enabled: boolean): void
  onDelete(task: ScheduledTask): void
  onCancel(): void
  onSave(input: ScheduledTaskInput): void
}) {
  const t = useT()
  const [editor, setEditor] = React.useState(initial)
  const [baseline] = React.useState(() => JSON.stringify(initial))
  const dirty = JSON.stringify(editor) !== baseline
  React.useEffect(() => { onDirtyChange(dirty) }, [dirty, onDirtyChange])
  const id = React.useId()
  const field = (name: string) => `${id}-${name}`
  const schedule = editor.schedule

  return <SettingsPage>
    {task ? <SettingsIdentity icon={<TaskIcon enabled={task.enabled} />} title={task.name}
      subtitle={<>
        {scheduleText(task.schedule)} · {running ? <span className="inline-flex items-center gap-1 text-primary"><TbLoader2 className="size-3 animate-spin motion-reduce:animate-none" aria-hidden />{t('scheduledTasks.running')}</span>
          : !task.enabled ? t('scheduledTasks.paused')
            : task.nextRunAt === null ? t('scheduledTasks.noNext') : t('scheduledTasks.next', { time: date(task.nextRunAt) })}
      </>}
      actions={<>
        <Button variant="outline" size="sm" disabled={disabled || running} onClick={() => onRunNow(task)}><TbPlayerPlay aria-hidden />{t('scheduledTasks.runNow')}</Button>
        <Switch checked={task.enabled} disabled={disabled} aria-label={t('scheduledTasks.enabledLabel')} onCheckedChange={(enabled) => onSetEnabled(task, enabled)} />
      </>}>
    </SettingsIdentity> : null}

    <form className="min-w-0 space-y-6" onSubmit={(event) => { event.preventDefault(); onSave(editor) }}>
      <SettingsGroup>
        <SettingsField label={t('scheduledTasks.name')} htmlFor={field('name')}>
          <Input id={field('name')} required maxLength={120} value={editor.name} autoFocus={!initial.id} onChange={(event) => setEditor({ ...editor, name: event.target.value })} />
        </SettingsField>
        <SettingsField label={t('scheduledTasks.target')} htmlFor={field('target')}
          hint={targetWarning || cursor ? <span className="flex flex-wrap items-center gap-2">
            {targetWarning ? <span>{t('scheduledTasks.targetWarning')}</span> : null}
            {cursor ? <Button type="button" variant="ghost" size="xs" className="text-primary" disabled={loadingTargets} onClick={() => onLoadTargets(cursor)}>{t('scheduledTasks.moreTargets')}</Button> : null}
          </span> : undefined}>
          <select id={field('target')} required className="mac-select w-full" value={editor.conversationId ? `${editor.conversationId}:${editor.targetIdentity}` : ''} onChange={(event) => {
            const target = targets.find((item) => `${item.conversationId}:${item.targetIdentity}` === event.target.value)
            setEditor({ ...editor, conversationId: target?.conversationId ?? '', targetIdentity: target?.targetIdentity ?? '' })
          }}>
            <option value="">{t('scheduledTasks.selectTarget')}</option>
            {task && !targets.some((target) => target.conversationId === editor.conversationId && target.targetIdentity === editor.targetIdentity) ? <option value={`${editor.conversationId}:${editor.targetIdentity}`}>{task.targetLabel}</option> : null}
            {targets.map((target) => <option key={target.conversationId} value={`${target.conversationId}:${target.targetIdentity}`}>{[target.project, target.name || t('scheduledTasks.unnamed'), date(Date.parse(target.createdAt))].filter(Boolean).join(' · ')}</option>)}
          </select>
        </SettingsField>
        <SettingsField label={t('scheduledTasks.prompt')} htmlFor={field('prompt')}>
          <Textarea id={field('prompt')} required rows={5} value={editor.prompt} onChange={(event) => setEditor({ ...editor, prompt: event.target.value })} />
        </SettingsField>
      </SettingsGroup>

      <SettingsGroup title={t('scheduledTasks.schedule')} info={t('scheduledTasks.timePolicy')}>
        <SettingsRow label={t('scheduledTasks.frequency')} htmlFor={field('frequency')}>
          <select id={field('frequency')} className="mac-select" value={schedule.kind} onChange={(event) => {
            const kind = event.target.value
            setEditor({ ...editor, schedule: kind === 'once' ? { kind, at: Date.now() + 3_600_000 } : kind === 'interval' ? { kind, startsAt: Date.now() + 60_000, minutes: 60 } : { kind: 'daily', hour: 9, minute: 0, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone } })
          }}>
            {(['once', 'daily', 'interval'] as const).map((kind) => <option key={kind} value={kind}>{t(`scheduledTasks.${kind}`)}</option>)}
          </select>
        </SettingsRow>
        {schedule.kind === 'daily' ? <>
          <SettingsRow label={t('scheduledTasks.time')} htmlFor={field('time')}>
            <Input id={field('time')} className="w-fit" type="time" required value={`${String(schedule.hour).padStart(2, '0')}:${String(schedule.minute).padStart(2, '0')}`}
              onChange={(event) => { const [hour, minute] = event.target.value.split(':').map(Number); setEditor({ ...editor, schedule: { ...schedule, hour, minute } }) }} />
          </SettingsRow>
          <SettingsRow label={t('scheduledTasks.timeZone')} htmlFor={field('zone')}>
            <Input id={field('zone')} className="w-52 max-w-full" required value={schedule.timeZone} onChange={(event) => setEditor({ ...editor, schedule: { ...schedule, timeZone: event.target.value } })} />
          </SettingsRow>
        </> : <SettingsRow label={t('scheduledTasks.start')} htmlFor={field('start')}>
          <Input id={field('start')} className="w-fit" required type="datetime-local" value={dateInput(schedule.kind === 'once' ? schedule.at : schedule.startsAt)} onChange={(event) => {
            const value = Date.parse(event.target.value)
            if (!Number.isFinite(value)) return
            if (schedule.kind === 'once') setEditor({ ...editor, schedule: { kind: 'once', at: value } })
            else setEditor({ ...editor, schedule: { ...schedule, startsAt: value } })
          }} />
        </SettingsRow>}
        {schedule.kind === 'interval' ? <SettingsRow label={t('scheduledTasks.minutes')} htmlFor={field('minutes')}>
          <Input id={field('minutes')} className="w-28" type="number" min={1} max={525600} required value={schedule.minutes} onChange={(event) => setEditor({ ...editor, schedule: { ...schedule, minutes: Number(event.target.value) } })} />
        </SettingsRow> : null}
        <SettingsRow label={t('scheduledTasks.missed')} htmlFor={field('missed')}>
          <select id={field('missed')} className="mac-select" value={editor.missedPolicy} onChange={(event) => setEditor({ ...editor, missedPolicy: event.target.value as ScheduledTaskInput['missedPolicy'] })}>
            <option value="catch-up-once">{t('scheduledTasks.catchUp')}</option><option value="skip">{t('scheduledTasks.skip')}</option>
          </select>
        </SettingsRow>
      </SettingsGroup>

      <FormActions onCancel={onCancel} onSave={() => onSave(editor)} saving={busy} canSave={!disabled && !running} saveLabel={t('scheduledTasks.save')} cancelLabel={t('scheduledTasks.cancel')}
        error={error} status={running ? t('scheduledTasks.busyHint') : undefined}
        leading={task ? <Button type="button" variant="ghost" className="text-destructive hover:text-destructive" disabled={disabled || running} onClick={() => onDelete(task)}>
          <TbTrash aria-hidden />{t('scheduledTasks.delete')}
        </Button> : undefined} />
      <button type="submit" hidden aria-hidden tabIndex={-1} />
    </form>
  </SettingsPage>
}
