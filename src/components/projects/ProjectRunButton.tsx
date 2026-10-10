import * as React from 'react'
import { TbAlertTriangle, TbCheck, TbChevronDown, TbLoader2, TbPlayerPlay, TbPlayerStop, TbPlus, TbSettings, TbTerminal2, TbX } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useLocale, useT, type MessageKey } from '@/i18n'
import { cn } from '@/lib/utils'
import type { ProjectAction, ProjectActionRun } from '@/shared/project-workflows'
import { projectWorkflows, useProjectWorkflow, workflowErrorText } from '@/store/project-workflows'
import { runTone } from './ActionRunPanel'

const LAST_ACTION_KEY = 'pipilot.project-run.last.v1'

function readLast(workspaceId: string): string | null {
  try { return (JSON.parse(localStorage.getItem(LAST_ACTION_KEY) ?? '{}') as Record<string, string>)[workspaceId] ?? null } catch { return null }
}
function writeLast(workspaceId: string, actionId: string) {
  try {
    const value = JSON.parse(localStorage.getItem(LAST_ACTION_KEY) ?? '{}') as Record<string, string>
    localStorage.setItem(LAST_ACTION_KEY, JSON.stringify({ ...value, [workspaceId]: actionId }))
  } catch {
    // Remembering the last action is a convenience only.
  }
}

function RunStatusIcon({ run }: { run: ProjectActionRun }) {
  const tone = runTone(run)
  if (run.status === 'running' || run.status === 'stopping') return <TbLoader2 className="animate-spin motion-reduce:animate-none" aria-hidden />
  if (tone === 'success') return <TbCheck className="text-success" aria-hidden />
  if (tone === 'danger') return <TbAlertTriangle className="text-destructive" aria-hidden />
  return <TbX className="text-muted-foreground" aria-hidden />
}

/**
 * Codex's toolbar actions: ▶ runs the project's last action; the arrow lists
 * the others, the latest runs, and where to edit them.
 */
export function ProjectRunButton({ workspaceId, onOpenOutput, onEditActions }: {
  workspaceId: string
  onOpenOutput(runId: string): void
  onEditActions(): void
}) {
  const t = useT()
  const locale = useLocale()
  const { snapshot } = useProjectWorkflow(workspaceId)
  const [lastId, setLastId] = React.useState(() => readLast(workspaceId))
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  React.useEffect(() => { setLastId(readLast(workspaceId)); setError(null) }, [workspaceId])
  if (!snapshot) return null
  const actions = snapshot.actions
  const running = snapshot.runs.find((run) => run.status === 'running' || run.status === 'stopping') ?? null
  const primary = actions.find((action) => action.id === lastId) ?? actions[0] ?? null
  const commandOf = (action: ProjectAction) => (action.platforms[snapshot.platform] || action.command).trim()
  const time = (run: ProjectActionRun) => new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(new Date(run.startedAt))

  const run = async (action: ProjectAction) => {
    if (busy) return
    setBusy(true); setError(null)
    writeLast(workspaceId, action.id); setLastId(action.id)
    try {
      const started = await projectWorkflows.run(workspaceId, action.id)
      onOpenOutput(started.id)
    } catch (caught) {
      setError(workflowErrorText(caught))
    } finally {
      setBusy(false)
    }
  }
  const stop = async (target: ProjectActionRun) => {
    setError(null)
    try { await projectWorkflows.stop(workspaceId, target.id) } catch (caught) { setError(workflowErrorText(caught)) }
  }

  const menu = <DropdownMenuContent align="end" className="w-72" data-project-run-menu>
    {error ? <><div role="alert" className="px-2 py-1.5 text-caption whitespace-pre-wrap text-destructive">{error}</div><DropdownMenuSeparator /></> : null}
    {running ? <>
      <DropdownMenuItem disabled={running.status === 'stopping'} onSelect={() => void stop(running)}><TbPlayerStop aria-hidden />{t('projectRun.stopNamed', { name: running.name })}</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => onOpenOutput(running.id)}><TbTerminal2 aria-hidden />{t('projectRun.showOutput')}</DropdownMenuItem>
      <DropdownMenuSeparator />
    </> : null}
    {actions.length ? <>
      <DropdownMenuLabel>{t('localEnvironment.actions')}</DropdownMenuLabel>
      {actions.map((action) => <DropdownMenuItem key={action.id} disabled={Boolean(running) || busy || !commandOf(action)} onSelect={() => void run(action)} data-project-run-action={action.name}>
        <TbPlayerPlay aria-hidden /><span className="min-w-0 flex-1 truncate">{action.name}</span>
        {action.id === primary?.id ? <TbCheck className="text-muted-foreground" aria-hidden /> : null}
      </DropdownMenuItem>)}
    </> : <DropdownMenuItem onSelect={onEditActions}><TbPlus aria-hidden />{t('projectRun.addAction')}</DropdownMenuItem>}
    {snapshot.runs.length ? <>
      <DropdownMenuSeparator />
      <DropdownMenuLabel>{t('projectRun.recent')}</DropdownMenuLabel>
      {snapshot.runs.slice(0, 5).map((entry) => <DropdownMenuItem key={entry.id} onSelect={() => onOpenOutput(entry.id)} data-project-run-history={entry.status}>
        <RunStatusIcon run={entry} /><span className="min-w-0 flex-1 truncate">{entry.name}</span>
        <span className="shrink-0 text-micro tabular-nums text-muted-foreground">{t(`projectActions.status.${entry.status}` as MessageKey)} · {time(entry)}</span>
      </DropdownMenuItem>)}
    </> : null}
    {actions.length ? <>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={onEditActions}><TbSettings aria-hidden />{t('projectRun.editActions')}</DropdownMenuItem>
    </> : null}
  </DropdownMenuContent>

  // Without actions: one ▶ that offers to add them.
  if (!primary) {
    return <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={t('projectRun.label')} data-project-run><TbPlayerPlay aria-hidden /></Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t('projectRun.label')}</TooltipContent>
      </Tooltip>
      {menu}
    </DropdownMenu>
  }

  const label = running ? t('projectRun.running', { name: running.name }) : t('projectRun.runNamed', { name: primary.name })
  return <div className="flex items-center" data-project-run={running ? 'running' : 'idle'}>
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={label} disabled={busy || (!running && !commandOf(primary))}
          className={cn('max-w-40 gap-1.5 rounded-r-none pr-1.5 pl-2', error && 'text-destructive')}
          onClick={() => { if (running) onOpenOutput(running.id); else void run(primary) }}>
          {running || busy ? <TbLoader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : error ? <TbAlertTriangle aria-hidden /> : <TbPlayerPlay aria-hidden />}
          <span className="truncate">{running ? t('projectActions.status.running') : primary.name}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{error ?? label}</TooltipContent>
    </Tooltip>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="-ml-0.5 w-5 rounded-l-none text-muted-foreground" aria-label={t('projectRun.more')}><TbChevronDown className="size-3.5" aria-hidden /></Button>
      </DropdownMenuTrigger>
      {menu}
    </DropdownMenu>
  </div>
}
