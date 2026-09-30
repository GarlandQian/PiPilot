import * as React from 'react'
import { TbClock, TbLoader2, TbPlayerPause, TbPlayerPlay, TbPlus, TbRefresh, TbTrash } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { MarkdownContent } from '@/components/chat/markdown/MarkdownContent'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { useT } from '@/i18n'
import { useSettings } from '@/store/settings'
import { isScheduledRunActive, scheduledTaskInputSchema, type ScheduledTask, type ScheduledTaskInput, type ScheduledTasksSnapshot, type TaskSchedule, type ScheduledTarget } from '@/shared/scheduled-tasks'

const selectClass = 'h-9 w-full rounded-md border border-input bg-background px-3 text-sm'
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
  return <details onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer rounded-sm focus-visible:focus-ring">{label}</summary>
    {open ? <div className="mt-2 max-h-72 min-w-0 overflow-auto"><MarkdownContent markdown={text} /></div> : null}
  </details>
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

  return <div className="space-y-7" data-scheduled-tasks>
    <p className="rounded-lg border border-border bg-muted/25 p-4 text-caption text-muted-foreground">{t('scheduledTasks.policy')}</p>
    {snapshot?.storageError || error ? <p role="alert" className="text-caption text-destructive">{snapshot?.storageError ?? error}</p> : null}
    <div className="flex flex-wrap items-center gap-2">
      <Button disabled={disabled} onClick={() => { setEditor(blankTask()); setError(null) }}><TbPlus aria-hidden />{t('scheduledTasks.create')}</Button>
      <Button variant="outline" disabled={loadingTargets} onClick={() => void loadTargets()}><TbRefresh aria-hidden />{t('scheduledTasks.refreshTargets')}</Button>
    </div>
    {editor ? <form className="space-y-4 rounded-lg border border-border p-4" onSubmit={(event) => {
      event.preventDefault()
      const parsed = scheduledTaskInputSchema.safeParse(editor)
      if (!parsed.success) { setError(t('scheduledTasks.invalid')); return }
      if (api) void mutate(() => api.save(parsed.data), () => setEditor(null))
    }}>
      <h2 className="font-medium">{t(editor.id ? 'scheduledTasks.edit' : 'scheduledTasks.create')}</h2>
      <label className="block space-y-1 text-caption">{t('scheduledTasks.name')}<Input required maxLength={120} value={editor.name} onChange={(event) => setEditor({ ...editor, name: event.target.value })} /></label>
      <label className="block space-y-1 text-caption">{t('scheduledTasks.target')}
        <select required aria-label={t('scheduledTasks.target')} className={selectClass} value={editor.conversationId ? `${editor.conversationId}:${editor.targetIdentity}` : ''} onChange={(event) => {
          const target = targets.find((item) => `${item.conversationId}:${item.targetIdentity}` === event.target.value)
          setEditor({ ...editor, conversationId: target?.conversationId ?? '', targetIdentity: target?.targetIdentity ?? '' })
        }}>
          <option value="">{t('scheduledTasks.selectTarget')}</option>
          {editingTask && !targets.some((target) => target.conversationId === editor.conversationId && target.targetIdentity === editor.targetIdentity) ? <option value={`${editor.conversationId}:${editor.targetIdentity}`}>{editingTask.targetLabel}</option> : null}
          {targets.map((target) => <option key={target.conversationId} value={`${target.conversationId}:${target.targetIdentity}`}>{[target.project, target.name || t('scheduledTasks.unnamed'), date(Date.parse(target.createdAt))].filter(Boolean).join(' · ')}</option>)}
        </select>
      </label>
      {targetWarning ? <p className="text-caption text-muted-foreground">{t('scheduledTasks.targetWarning')}</p> : null}
      {cursor ? <Button type="button" variant="ghost" disabled={loadingTargets} onClick={() => void loadTargets(cursor)}>{t('scheduledTasks.moreTargets')}</Button> : null}
      <label className="block space-y-1 text-caption">{t('scheduledTasks.prompt')}<Textarea aria-label={t('scheduledTasks.prompt')} required rows={5} value={editor.prompt} onChange={(event) => setEditor({ ...editor, prompt: event.target.value })} /></label>
      <label className="block space-y-1 text-caption">{t('scheduledTasks.frequency')}
        <select aria-label={t('scheduledTasks.frequency')} className={selectClass} value={editor.schedule.kind} onChange={(event) => {
          const kind = event.target.value
          setEditor({ ...editor, schedule: kind === 'once' ? { kind, at: Date.now() + 3_600_000 } : kind === 'interval' ? { kind, startsAt: Date.now() + 60_000, minutes: 60 } : { kind: 'daily', hour: 9, minute: 0, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone } })
        }}>
          {(['once', 'daily', 'interval'] as const).map((kind) => <option key={kind} value={kind}>{t(`scheduledTasks.${kind}`)}</option>)}
        </select>
      </label>
      {editor.schedule.kind === 'daily' ? <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-caption">{t('scheduledTasks.time')}<Input type="time" required value={`${String(editor.schedule.hour).padStart(2, '0')}:${String(editor.schedule.minute).padStart(2, '0')}`} onChange={(event) => { const [hour, minute] = event.target.value.split(':').map(Number); if (editor.schedule.kind === 'daily') setEditor({ ...editor, schedule: { ...editor.schedule, hour, minute } }) }} /></label>
        <label className="space-y-1 text-caption">{t('scheduledTasks.timeZone')}<Input required value={editor.schedule.timeZone} onChange={(event) => { if (editor.schedule.kind === 'daily') setEditor({ ...editor, schedule: { ...editor.schedule, timeZone: event.target.value } }) }} /></label>
      </div> : <label className="block space-y-1 text-caption">{t('scheduledTasks.start')}
        <Input required type="datetime-local" value={dateInput(editor.schedule.kind === 'once' ? editor.schedule.at : editor.schedule.startsAt)} onChange={(event) => {
          const value = Date.parse(event.target.value)
          if (!Number.isFinite(value)) return
          if (editor.schedule.kind === 'once') setEditor({ ...editor, schedule: { kind: 'once', at: value } })
          else if (editor.schedule.kind === 'interval') setEditor({ ...editor, schedule: { ...editor.schedule, startsAt: value } })
        }} />
      </label>}
      {editor.schedule.kind === 'interval' ? <label className="block space-y-1 text-caption">{t('scheduledTasks.minutes')}<Input type="number" min={1} max={525600} required value={editor.schedule.minutes} onChange={(event) => { if (editor.schedule.kind === 'interval') setEditor({ ...editor, schedule: { ...editor.schedule, minutes: Number(event.target.value) } }) }} /></label> : null}
      <label className="block space-y-1 text-caption">{t('scheduledTasks.missed')}
        <select aria-label={t('scheduledTasks.missed')} className={selectClass} value={editor.missedPolicy} onChange={(event) => setEditor({ ...editor, missedPolicy: event.target.value as ScheduledTaskInput['missedPolicy'] })}>
          <option value="catch-up-once">{t('scheduledTasks.catchUp')}</option><option value="skip">{t('scheduledTasks.skip')}</option>
        </select>
      </label>
      <p className="text-caption text-muted-foreground">{t('scheduledTasks.timePolicy')}</p>
      {editingBusy ? <p role="status" className="text-caption">{t('scheduledTasks.busyHint')}</p> : null}
      <div className="flex gap-2"><Button type="submit" disabled={disabled || editingBusy}>{busy ? <TbLoader2 className="animate-spin" aria-hidden /> : null}{t('scheduledTasks.save')}</Button><Button type="button" variant="ghost" disabled={busy} onClick={() => setEditor(null)}>{t('scheduledTasks.cancel')}</Button></div>
    </form> : null}
    <div className="space-y-3">
      {snapshot?.tasks.length === 0 ? <p className="py-8 text-center text-caption text-muted-foreground">{t('scheduledTasks.empty')}</p> : null}
      {snapshot?.tasks.map((task) => {
        const running = snapshot.runs.some((run) => run.taskId === task.id && isScheduledRunActive(run))
        return <article key={task.id} className="space-y-2 rounded-lg border border-border p-4">
          <div className="flex items-center gap-2"><TbClock aria-hidden /><h2 className="min-w-0 flex-1 break-words font-medium">{task.name}</h2><span className="text-caption text-muted-foreground">{t(running ? 'scheduledTasks.running' : !task.enabled ? 'scheduledTasks.paused' : task.nextRunAt === null ? 'scheduledTasks.finished' : 'scheduledTasks.enabled')}</span></div>
          <p className="break-words text-caption text-muted-foreground">{task.targetLabel}</p>
          <p className="text-caption">{scheduleText(task.schedule)} · {task.nextRunAt === null ? t('scheduledTasks.noNext') : t('scheduledTasks.next', { time: date(task.nextRunAt) })}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={disabled || running} onClick={() => api && void mutate(() => api.runNow(task.id))}><TbPlayerPlay aria-hidden />{t('scheduledTasks.runNow')}</Button>
            <Button size="sm" variant="ghost" disabled={disabled} onClick={() => api && void mutate(() => api.setEnabled(task.id, !task.enabled))}>{task.enabled ? <TbPlayerPause aria-hidden /> : <TbPlayerPlay aria-hidden />}{t(task.enabled ? 'scheduledTasks.pause' : 'scheduledTasks.resume')}</Button>
            <Button size="sm" variant="ghost" disabled={disabled || running} onClick={() => { setEditor({ id: task.id, name: task.name, conversationId: task.conversationId, targetIdentity: task.targetIdentity, prompt: task.prompt, schedule: task.schedule, missedPolicy: task.missedPolicy, enabled: task.enabled }); setError(null) }}>{t('scheduledTasks.edit')}</Button>
            <Button size="sm" variant="ghost" disabled={disabled || running} aria-label={t('scheduledTasks.deleteNamed', { name: task.name })} onClick={() => setDeleting(task)}><TbTrash aria-hidden /></Button>
          </div>
          {running ? <p className="text-caption text-muted-foreground">{t('scheduledTasks.busyHint')}</p> : null}
        </article>
      })}
    </div>
    <section className="space-y-3" aria-label={t('scheduledTasks.history')}><h2 className="font-medium">{t('scheduledTasks.history')}</h2>
      <p className="text-caption text-muted-foreground">{t('scheduledTasks.historyHint')}</p>
      {snapshot?.runs.length === 0 ? <p className="text-caption text-muted-foreground">{t('scheduledTasks.noHistory')}</p> : null}
      {snapshot?.runs.slice(-historyLimit).reverse().map((run) => <article key={run.id} className="space-y-1 rounded-md border border-border p-3 text-caption">
        <div className="flex flex-wrap justify-between gap-2"><span className="font-medium">{run.taskName}</span><span>{t(`scheduledTasks.status.${run.status}`)}</span></div>
        <p className="text-muted-foreground">{date(run.startedAt)} · {t(run.trigger === 'manual' ? 'scheduledTasks.manual' : 'scheduledTasks.scheduled')}</p>
        {run.errorCode === 'previous_run_active' ? <p>{t('scheduledTasks.overlapSkipped')}</p> : run.errorCode === 'missed_schedule' ? <p>{t('scheduledTasks.missedSkipped')}</p> : null}
        {run.status === 'interrupted' ? <p className="text-warning">{t('scheduledTasks.interruptedHint')}</p> : run.error ? <p className="break-words text-destructive">{run.error}</p> : null}
        {run.finalResponse ? <ScheduledResponse text={run.finalResponse} label={t('scheduledTasks.result')} /> : null}
      </article>)}
      {snapshot && snapshot.runs.length > historyLimit ? <Button variant="ghost" onClick={() => setHistoryLimit((value) => value + 30)}>{t('scheduledTasks.moreHistory')}</Button> : null}
    </section>
    <AlertDialog open={Boolean(deleting)} onOpenChange={(open) => { if (!open) setDeleting(null) }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t('scheduledTasks.delete')}</AlertDialogTitle><AlertDialogDescription>{t('scheduledTasks.deleteHint')}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{t('scheduledTasks.cancel')}</AlertDialogCancel><AlertDialogAction onClick={() => { if (api && deleting) void mutate(() => api.remove(deleting.id), () => { if (editor?.id === deleting.id) setEditor(null); setDeleting(null) }) }}>{t('scheduledTasks.delete')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>
}
