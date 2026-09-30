import * as React from 'react'
import { TbClock, TbInfoCircle, TbLoader2, TbPencil, TbPlayerPause, TbPlayerPlay, TbPlus, TbRefresh, TbTrash } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { MarkdownContent } from '@/components/chat/markdown/MarkdownContent'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { SettingSection } from './common'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import { useSettings } from '@/store/settings'
import { isScheduledRunActive, scheduledTaskInputSchema, type ScheduledRun, type ScheduledTask, type ScheduledTaskInput, type ScheduledTasksSnapshot, type TaskSchedule, type ScheduledTarget } from '@/shared/scheduled-tasks'

function dateInput(value: number) {
  const date = new Date(value)
  return new Date(value - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}
function blankTask(): ScheduledTaskInput {
  return { name: '', conversationId: '', targetIdentity: '', prompt: '', enabled: true, missedPolicy: 'catch-up-once', schedule: { kind: 'daily', hour: 9, minute: 0, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone } }
}
function publicError(error: unknown) {
  return typeof error === 'object' && error && 'message' in error ? String(error.message) : String(error)
}

function ScheduledResponse({ text, label }: { text: string; label: string }) {
  const [open, setOpen] = React.useState(false)
  return <details className="mt-1" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary className="w-fit cursor-default rounded-sm text-primary focus-visible:focus-ring">{label}</summary>
    {open ? <div className="mt-2 max-h-72 min-w-0 overflow-auto rounded-lg bg-surface-raised p-3 shadow-[inset_0_0_0_0.5px_var(--color-border)]"><MarkdownContent markdown={text} /></div> : null}
  </details>
}

/** macOS sheet form row: trailing-aligned label, leading-aligned control. */
function FormRow({ label, children, stacked = false }: { label: string; children: React.ReactNode; stacked?: boolean }) {
  return <label className={cn('grid min-w-0 gap-x-3 gap-y-1.5', stacked ? 'grid-cols-1' : 'items-center sm:grid-cols-[9.5rem_minmax(0,1fr)]')}>
    <span className={cn('text-app text-foreground/85', !stacked && 'sm:text-right')}>{label}</span>
    {children}
  </label>
}

function RowAction({ label, disabled, onClick, children, destructive = false }: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
  destructive?: boolean
}) {
  return <Tooltip>
    <TooltipTrigger asChild>
      <Button variant="ghost" size="icon-sm" aria-label={label} disabled={disabled} onClick={onClick}
        className={cn('text-foreground/70', destructive && 'hover:text-destructive')}>{children}</Button>
    </TooltipTrigger>
    <TooltipContent>{label}</TooltipContent>
  </Tooltip>
}

const RUN_TONE: Partial<Record<ScheduledRun['status'], string>> = {
  completed: 'bg-success',
  failed: 'bg-destructive',
  aborted: 'bg-destructive',
  interrupted: 'bg-warning',
  skipped: 'bg-muted-foreground/50',
}

export function ScheduledTasksSettings() {
  const t = useT()
  const { locale } = useSettings()
  const [snapshot, setSnapshot] = React.useState<ScheduledTasksSnapshot | null>(null)
  const [targets, setTargets] = React.useState<ScheduledTarget[]>([])
  const [cursor, setCursor] = React.useState<string | null>(null)
  const [targetWarning, setTargetWarning] = React.useState(false)
  const [editor, setEditor] = React.useState<ScheduledTaskInput | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [loadingTargets, setLoadingTargets] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [deleting, setDeleting] = React.useState<ScheduledTask | null>(null)
  const [historyLimit, setHistoryLimit] = React.useState(30)
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
    if (busy) return
    setBusy(true); setError(null)
    try { accept(await action()); after?.() } catch (failure) { setError(publicError(failure)) }
    finally { setBusy(false) }
  }
  const date = (value: number) => new Intl.DateTimeFormat(locale === 'system' ? undefined : locale, { dateStyle: 'medium', timeStyle: 'short' }).format(value)
  const scheduleText = (schedule: TaskSchedule) => schedule.kind === 'once' ? date(schedule.at) : schedule.kind === 'interval'
    ? t('scheduledTasks.everyMinutes', { minutes: schedule.minutes })
    : `${String(schedule.hour).padStart(2, '0')}:${String(schedule.minute).padStart(2, '0')} · ${schedule.timeZone}`
  const editingTask = snapshot?.tasks.find((task) => task.id === editor?.id)
  const editingBusy = Boolean(editor?.id && snapshot?.runs.some((run) => run.taskId === editor.id && isScheduledRunActive(run)))
  const disabled = busy || !api || Boolean(snapshot?.storageError)
  const visibleError = snapshot?.storageError ?? error

  return <div className="space-y-6" data-scheduled-tasks>
    <p className="mac-box flex items-start gap-2.5 px-3.5 py-3 text-caption text-muted-foreground">
      <TbInfoCircle className="mt-px size-4 shrink-0 text-primary" aria-hidden />
      <span>{t('scheduledTasks.policy')}</span>
    </p>
    {visibleError && !editor ? <p role="alert" className="rounded-lg bg-destructive/8 px-3.5 py-2.5 text-caption text-destructive">{visibleError}</p> : null}

    <section className="min-w-0" aria-label={t('scheduledTasks.title')}>
      <header className="mb-2 flex items-center gap-2 px-1">
        <h2 className="min-w-0 flex-1 text-app font-semibold">{t('scheduledTasks.title')}</h2>
        <Button variant="ghost" size="sm" className="text-foreground/75" disabled={loadingTargets} onClick={() => void loadTargets()}>
          <TbRefresh className={loadingTargets ? 'animate-spin' : undefined} aria-hidden />{t('scheduledTasks.refreshTargets')}
        </Button>
        <Button size="sm" disabled={disabled} onClick={() => { setEditor(blankTask()); setError(null) }}><TbPlus aria-hidden />{t('scheduledTasks.create')}</Button>
      </header>
      <div className="mac-group">
        {snapshot?.tasks.length === 0 ? <div className="flex flex-col items-center gap-2 py-10! text-center">
          <TbClock className="size-8 text-muted-foreground/60" aria-hidden />
          <p className="text-caption text-muted-foreground">{t('scheduledTasks.empty')}</p>
        </div> : null}
        {snapshot?.tasks.map((task) => {
          const running = snapshot.runs.some((run) => run.taskId === task.id && isScheduledRunActive(run))
          const state = running ? 'scheduledTasks.running' : !task.enabled ? 'scheduledTasks.paused' : task.nextRunAt === null ? 'scheduledTasks.finished' : 'scheduledTasks.enabled'
          return <article key={task.id} className="flex min-w-0 items-start gap-3 py-3!" data-setting-row>
            <span className={cn('mt-0.5 grid size-8 shrink-0 place-items-center rounded-[8px] bg-[linear-gradient(to_bottom,rgb(255_255_255/0.2),transparent)] text-white shadow-[0_0.5px_1px_rgb(0_0_0/0.15)]', task.enabled ? 'bg-[#ff3b30]' : 'bg-[#8e8e93]')} aria-hidden>
              <TbClock className="size-[18px]" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                <h3 className="min-w-0 break-words text-app font-semibold">{task.name}</h3>
                <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-px text-micro font-medium', running ? 'bg-primary/12 text-primary' : task.enabled && task.nextRunAt !== null ? 'bg-success/12 text-success' : 'bg-fill-strong text-muted-foreground')}>
                  {running ? <TbLoader2 className="size-3 animate-spin motion-reduce:animate-none" aria-hidden /> : null}{t(state)}
                </span>
              </div>
              <p className="mt-0.5 break-words text-caption text-muted-foreground">{task.targetLabel}</p>
              <p className="mt-0.5 text-caption text-foreground/85">{scheduleText(task.schedule)} · {task.nextRunAt === null ? t('scheduledTasks.noNext') : t('scheduledTasks.next', { time: date(task.nextRunAt) })}</p>
              {running ? <p className="mt-1 text-micro text-muted-foreground">{t('scheduledTasks.busyHint')}</p> : null}
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              <RowAction label={t('scheduledTasks.runNow')} disabled={disabled || running} onClick={() => api && void mutate(() => api.runNow(task.id))}><TbPlayerPlay aria-hidden /></RowAction>
              <RowAction label={t(task.enabled ? 'scheduledTasks.pause' : 'scheduledTasks.resume')} disabled={disabled} onClick={() => api && void mutate(() => api.setEnabled(task.id, !task.enabled))}>
                {task.enabled ? <TbPlayerPause aria-hidden /> : <TbPlayerPlay aria-hidden />}
              </RowAction>
              <RowAction label={t('scheduledTasks.edit')} disabled={disabled || running} onClick={() => { setEditor({ id: task.id, name: task.name, conversationId: task.conversationId, targetIdentity: task.targetIdentity, prompt: task.prompt, schedule: task.schedule, missedPolicy: task.missedPolicy, enabled: task.enabled }); setError(null) }}><TbPencil aria-hidden /></RowAction>
              <RowAction destructive label={t('scheduledTasks.deleteNamed', { name: task.name })} disabled={disabled || running} onClick={() => setDeleting(task)}><TbTrash aria-hidden /></RowAction>
            </div>
          </article>
        })}
        {!snapshot ? <p className="flex items-center justify-center gap-2 py-8! text-caption text-muted-foreground" role="status"><TbLoader2 className="size-4 animate-spin" aria-hidden /></p> : null}
      </div>
    </section>

    <SettingSection title={t('scheduledTasks.history')} desc={t('scheduledTasks.historyHint')}>
      {snapshot?.runs.length === 0 ? <p className="py-6! text-center text-caption text-muted-foreground">{t('scheduledTasks.noHistory')}</p> : null}
      {snapshot?.runs.slice(-historyLimit).reverse().map((run) => <article key={run.id} className="min-w-0 py-2.5! text-caption">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn('size-2 shrink-0 rounded-full', isScheduledRunActive(run) ? 'animate-pulse bg-primary' : RUN_TONE[run.status] ?? 'bg-muted-foreground/50')} aria-hidden />
          <span className="min-w-0 flex-1 truncate text-app font-medium">{run.taskName}</span>
          <span className="shrink-0 text-muted-foreground">{t(`scheduledTasks.status.${run.status}`)}</span>
        </div>
        <div className="pl-4">
          <p className="text-muted-foreground">{date(run.startedAt)} · {t(run.trigger === 'manual' ? 'scheduledTasks.manual' : 'scheduledTasks.scheduled')}</p>
          {run.errorCode === 'previous_run_active' ? <p>{t('scheduledTasks.overlapSkipped')}</p> : run.errorCode === 'missed_schedule' ? <p>{t('scheduledTasks.missedSkipped')}</p> : null}
          {run.status === 'interrupted' ? <p className="text-warning">{t('scheduledTasks.interruptedHint')}</p> : run.error ? <p className="break-words text-destructive">{run.error}</p> : null}
          {run.finalResponse ? <ScheduledResponse text={run.finalResponse} label={t('scheduledTasks.result')} /> : null}
        </div>
      </article>)}
      {snapshot && snapshot.runs.length > historyLimit ? <div className="flex justify-center py-2!"><Button variant="ghost" size="sm" className="text-primary" onClick={() => setHistoryLimit((value) => value + 30)}>{t('scheduledTasks.moreHistory')}</Button></div> : null}
    </SettingSection>

    {/* Editor sheet */}
    <Dialog open={Boolean(editor)} onOpenChange={(open) => { if (!open && !busy) setEditor(null) }}>
      <DialogContent className="max-h-[calc(100vh-4rem)] overflow-y-auto sm:max-w-[560px]">
        {editor ? <form className="grid gap-4" onSubmit={(event) => {
          event.preventDefault()
          const parsed = scheduledTaskInputSchema.safeParse(editor)
          if (!parsed.success) { setError(t('scheduledTasks.invalid')); return }
          if (api) void mutate(() => api.save(parsed.data), () => setEditor(null))
        }}>
          <DialogHeader>
            <DialogTitle>{t(editor.id ? 'scheduledTasks.edit' : 'scheduledTasks.create')}</DialogTitle>
            <DialogDescription>{t('scheduledTasks.description')}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <FormRow label={t('scheduledTasks.name')}><Input required maxLength={120} value={editor.name} onChange={(event) => setEditor({ ...editor, name: event.target.value })} /></FormRow>
            <FormRow label={t('scheduledTasks.target')}>
              <select required aria-label={t('scheduledTasks.target')} className="mac-select" value={editor.conversationId ? `${editor.conversationId}:${editor.targetIdentity}` : ''} onChange={(event) => {
                const target = targets.find((item) => `${item.conversationId}:${item.targetIdentity}` === event.target.value)
                setEditor({ ...editor, conversationId: target?.conversationId ?? '', targetIdentity: target?.targetIdentity ?? '' })
              }}>
                <option value="">{t('scheduledTasks.selectTarget')}</option>
                {editingTask && !targets.some((target) => target.conversationId === editor.conversationId && target.targetIdentity === editor.targetIdentity) ? <option value={`${editor.conversationId}:${editor.targetIdentity}`}>{editingTask.targetLabel}</option> : null}
                {targets.map((target) => <option key={target.conversationId} value={`${target.conversationId}:${target.targetIdentity}`}>{[target.project, target.name || t('scheduledTasks.unnamed'), date(Date.parse(target.createdAt))].filter(Boolean).join(' · ')}</option>)}
              </select>
            </FormRow>
            {targetWarning || cursor ? <div className="flex flex-wrap items-center gap-2 sm:pl-[calc(9.5rem+0.75rem)]">
              {targetWarning ? <p className="text-caption text-muted-foreground">{t('scheduledTasks.targetWarning')}</p> : null}
              {cursor ? <Button type="button" variant="ghost" size="xs" className="text-primary" disabled={loadingTargets} onClick={() => void loadTargets(cursor)}>{t('scheduledTasks.moreTargets')}</Button> : null}
            </div> : null}
            <FormRow stacked label={t('scheduledTasks.prompt')}><Textarea aria-label={t('scheduledTasks.prompt')} required rows={5} value={editor.prompt} onChange={(event) => setEditor({ ...editor, prompt: event.target.value })} /></FormRow>
            <FormRow label={t('scheduledTasks.frequency')}>
              <select aria-label={t('scheduledTasks.frequency')} className="mac-select w-fit" value={editor.schedule.kind} onChange={(event) => {
                const kind = event.target.value
                setEditor({ ...editor, schedule: kind === 'once' ? { kind, at: Date.now() + 3_600_000 } : kind === 'interval' ? { kind, startsAt: Date.now() + 60_000, minutes: 60 } : { kind: 'daily', hour: 9, minute: 0, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone } })
              }}>
                {(['once', 'daily', 'interval'] as const).map((kind) => <option key={kind} value={kind}>{t(`scheduledTasks.${kind}`)}</option>)}
              </select>
            </FormRow>
            {editor.schedule.kind === 'daily' ? <>
              <FormRow label={t('scheduledTasks.time')}><Input className="w-fit" type="time" required value={`${String(editor.schedule.hour).padStart(2, '0')}:${String(editor.schedule.minute).padStart(2, '0')}`} onChange={(event) => { const [hour, minute] = event.target.value.split(':').map(Number); if (editor.schedule.kind === 'daily') setEditor({ ...editor, schedule: { ...editor.schedule, hour, minute } }) }} /></FormRow>
              <FormRow label={t('scheduledTasks.timeZone')}><Input required value={editor.schedule.timeZone} onChange={(event) => { if (editor.schedule.kind === 'daily') setEditor({ ...editor, schedule: { ...editor.schedule, timeZone: event.target.value } }) }} /></FormRow>
            </> : <FormRow label={t('scheduledTasks.start')}>
              <Input className="w-fit" required type="datetime-local" value={dateInput(editor.schedule.kind === 'once' ? editor.schedule.at : editor.schedule.startsAt)} onChange={(event) => {
                const value = Date.parse(event.target.value)
                if (!Number.isFinite(value)) return
                if (editor.schedule.kind === 'once') setEditor({ ...editor, schedule: { kind: 'once', at: value } })
                else if (editor.schedule.kind === 'interval') setEditor({ ...editor, schedule: { ...editor.schedule, startsAt: value } })
              }} />
            </FormRow>}
            {editor.schedule.kind === 'interval' ? <FormRow label={t('scheduledTasks.minutes')}><Input className="w-28" type="number" min={1} max={525600} required value={editor.schedule.minutes} onChange={(event) => { if (editor.schedule.kind === 'interval') setEditor({ ...editor, schedule: { ...editor.schedule, minutes: Number(event.target.value) } }) }} /></FormRow> : null}
            <FormRow label={t('scheduledTasks.missed')}>
              <select aria-label={t('scheduledTasks.missed')} className="mac-select w-fit" value={editor.missedPolicy} onChange={(event) => setEditor({ ...editor, missedPolicy: event.target.value as ScheduledTaskInput['missedPolicy'] })}>
                <option value="catch-up-once">{t('scheduledTasks.catchUp')}</option><option value="skip">{t('scheduledTasks.skip')}</option>
              </select>
            </FormRow>
          </div>
          <p className="text-micro text-muted-foreground">{t('scheduledTasks.timePolicy')}</p>
          {editingBusy ? <p role="status" className="text-caption">{t('scheduledTasks.busyHint')}</p> : null}
          {visibleError ? <p role="alert" className="text-caption text-destructive">{visibleError}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setEditor(null)}>{t('scheduledTasks.cancel')}</Button>
            <Button type="submit" disabled={disabled || editingBusy}>{busy ? <TbLoader2 className="animate-spin" aria-hidden /> : null}{t('scheduledTasks.save')}</Button>
          </DialogFooter>
        </form> : null}
      </DialogContent>
    </Dialog>

    <AlertDialog open={Boolean(deleting)} onOpenChange={(open) => { if (!open) setDeleting(null) }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t('scheduledTasks.delete')}</AlertDialogTitle><AlertDialogDescription>{t('scheduledTasks.deleteHint')}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{t('scheduledTasks.cancel')}</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => { if (api && deleting) void mutate(() => api.remove(deleting.id), () => { if (editor?.id === deleting.id) setEditor(null); setDeleting(null) }) }}>{t('scheduledTasks.delete')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>
}
