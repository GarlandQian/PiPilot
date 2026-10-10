import * as React from 'react'
import { TbLoader2, TbPlayerPlay, TbPlayerStop, TbRefresh } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { ShellLogViewer } from '@/components/chat/ShellLogViewer'
import { StatusText } from '@/components/settings/kit'
import { useLocale, useT, type MessageKey } from '@/i18n'
import type { ProjectActionRun } from '@/shared/project-workflows'
import { projectWorkflows, useProjectWorkflow, workflowErrorText } from '@/store/project-workflows'

export function runTone(run: ProjectActionRun) {
  return run.status === 'completed' ? 'success' as const
    : run.status === 'failed' || run.status === 'interrupted' ? 'danger' as const : 'neutral' as const
}

/** One action run, read-only: what ran, how it ended, and its output (live while it runs). */
export function ActionRunPanel({ workspaceId, runId, onSelectRun, onClose }: {
  workspaceId: string
  /** The run to show; without one, the project's latest. */
  runId: string | null
  onSelectRun(runId: string): void
  onClose(): void
}) {
  const t = useT()
  const locale = useLocale()
  const { snapshot } = useProjectWorkflow(workspaceId)
  const run = snapshot ? (runId ? snapshot.runs.find((candidate) => candidate.id === runId) : undefined) ?? snapshot.runs[0] ?? null : null
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const live = run?.status === 'running' || run?.status === 'stopping'
  const anotherRunning = snapshot?.runs.some((candidate) => candidate.id !== run?.id && (candidate.status === 'running' || candidate.status === 'stopping')) ?? false
  const action = snapshot?.actions.find((candidate) => candidate.id === run?.actionId)
  const perform = async (operation: () => Promise<void>) => {
    setBusy(true); setError(null)
    try { await operation() } catch (caught) { setError(workflowErrorText(caught)) } finally { setBusy(false) }
  }
  const time = run ? new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(run.startedAt)) : ''

  return <section className="flex h-full min-h-0 min-w-0 flex-col outline-none" tabIndex={-1} data-action-run-panel={run?.id ?? ''}
    aria-label={t('projectActions.output')}
    onKeyDown={(event) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      onClose()
    }}>
    {!run ? <p className="m-auto px-4 text-caption text-muted-foreground" role="status">{snapshot ? t('projectActions.noRuns') : t('worktree.loading')}</p> : <>
      <header className="flex min-h-11 shrink-0 flex-wrap items-center gap-x-2.5 gap-y-1 border-b border-border px-3 py-1.5">
        <TbPlayerPlay className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-baseline gap-2">
            <h2 className="truncate text-caption font-semibold">{run.name}</h2>
            <time dateTime={run.startedAt} className="shrink-0 text-micro tabular-nums text-muted-foreground">{time}</time>
          </div>
          <p className="truncate font-mono text-micro text-muted-foreground" title={run.command}>{run.command}</p>
        </div>
        <StatusText tone={runTone(run)} icon={live ? <TbLoader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> : undefined}>
          {t(`projectActions.status.${run.status}` as MessageKey)}{run.exitCode !== null ? ` · ${t('projectActions.exitCode', { code: run.exitCode })}` : ''}
        </StatusText>
        {live ? <Button variant="outline" size="sm" disabled={busy || run.status === 'stopping'} onClick={() => void perform(async () => { await projectWorkflows.stop(workspaceId, run.id) })}>
          <TbPlayerStop aria-hidden />{t('projectActions.stop')}
        </Button> : action ? <Button variant="ghost" size="sm" disabled={busy || anotherRunning} onClick={() => void perform(async () => {
          const next = await projectWorkflows.run(workspaceId, action.id)
          onSelectRun(next.id)
        })}>
          <TbRefresh aria-hidden />{t('projectActions.runAgain')}
        </Button> : null}
      </header>
      {error ? <p role="alert" className="shrink-0 border-b border-border px-3 py-1.5 text-caption text-destructive">{error}</p> : null}
      <div className="scroll-slim min-h-0 flex-1 overflow-auto p-3 [&_[data-shell-log-output]]:max-h-none">
        {run.output ? <ShellLogViewer key={run.id} label={run.name} source={run.output} live={live} tone={run.status === 'failed' ? 'error' : 'default'} />
          : <p className="text-caption text-muted-foreground">{t('projectActions.noOutput')}</p>}
      </div>
    </>}
  </section>
}
