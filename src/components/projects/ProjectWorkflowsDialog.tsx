import * as React from 'react'
import { TbGitBranch, TbPlayerPlay, TbPlayerStop, TbArchive, TbArchiveOff, TbPlus, TbTrash } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useT } from '@/i18n'
import type { ProjectAction, ProjectWorkflowSnapshot } from '@/shared/project-workflows'

function errorText(error: unknown) { return typeof error === 'object' && error && 'message' in error ? String(error.message) : String(error) }

export function ProjectWorkflowsDialog({ workspaceId, projectName, open, onOpenChange, onOpenProject }: {
  workspaceId: string; projectName: string; open: boolean; onOpenChange(open: boolean): void; onOpenProject(id: string): void
}) {
  const t = useT()
  const [snapshot, setSnapshot] = React.useState<ProjectWorkflowSnapshot | null>(null)
  const [actions, setActions] = React.useState<ProjectAction[]>([])
  const [savedActions, setSavedActions] = React.useState('[]')
  const [editRevision, setEditRevision] = React.useState(0)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [tab, setTab] = React.useState<'worktrees' | 'actions'>('worktrees')
  const [name, setName] = React.useState('')
  const [branch, setBranch] = React.useState('')
  const [baseBranch, setBaseBranch] = React.useState('')
  const [setup, setSetup] = React.useState('')
  const [selectedRun, setSelectedRun] = React.useState('')
  const dirty = JSON.stringify(actions) !== savedActions
  const dirtyRef = React.useRef(dirty)
  dirtyRef.current = dirty
  const acceptedRevision = React.useRef(-1)
  const identity = React.useRef(workspaceId)
  identity.current = workspaceId
  const resetActions = React.useCallback((value: ProjectWorkflowSnapshot) => {
    acceptedRevision.current = Math.max(acceptedRevision.current, value.revision)
    setActions(value.actions); setSavedActions(JSON.stringify(value.actions)); setEditRevision(value.revision)
  }, [])
  React.useEffect(() => {
    if (!open || !window.pipilot?.projectWorkflows) return
    let current = true
    let timer: ReturnType<typeof setTimeout>
    setSnapshot(null); setError(null); setSetup(''); setName(''); setBranch(''); setBaseBranch('')
    acceptedRevision.current = -1
    const refresh = async (first = false) => {
      try {
        const value = await window.pipilot!.projectWorkflows.get(workspaceId)
        if (!current) return
        if (value.revision >= acceptedRevision.current) {
          acceptedRevision.current = value.revision
          setSnapshot(value)
          if (first || !dirtyRef.current) resetActions(value)
          setBaseBranch((previous) => previous || value.branches[0] || '')
        }
      } catch (caught) { if (current) setError(errorText(caught)) }
      if (current) timer = setTimeout(() => void refresh(), 1_500)
    }
    void refresh(true)
    return () => { current = false; clearTimeout(timer) }
  }, [open, workspaceId, resetActions])

  async function perform(operation: () => Promise<unknown>) {
    if (busy) return
    const owner = workspaceId
    setBusy(true); setError(null)
    try {
      await operation()
      if (identity.current === owner) setSnapshot(await window.pipilot!.projectWorkflows.get(owner))
    } catch (caught) { if (identity.current === owner) setError(errorText(caught)) }
    finally { if (identity.current === owner) setBusy(false) }
  }
  function edit(id: string, patch: Partial<ProjectAction>) { setActions((current) => current.map((action) => action.id === id ? { ...action, ...patch } : action)) }
  const run = snapshot?.runs.find((entry) => entry.id === selectedRun) ?? snapshot?.runs[0]
  const hasRunning = snapshot?.runs.some((entry) => entry.status === 'running' || entry.status === 'stopping') ?? false
  const fieldClass = 'grid gap-1.5 text-caption font-medium text-foreground/85'
  return <Dialog open={open} onOpenChange={(next) => {
    if (!next && (dirty || busy)) { setError(t('projectActions.finishEditing')); return }
    onOpenChange(next)
  }}>
    <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
      <DialogHeader><DialogTitle>{projectName}</DialogTitle><DialogDescription>{t('worktree.description')}</DialogDescription></DialogHeader>
      <div className="mac-segmented mx-auto" role="tablist" aria-label={t('worktree.tools')}>
        <button type="button" role="tab" aria-selected={tab === 'worktrees'} className="outline-none focus-visible:focus-ring" onClick={() => setTab('worktrees')}><TbGitBranch className="size-3.5" aria-hidden />{t('worktree.title')}</button>
        <button type="button" role="tab" aria-selected={tab === 'actions'} className="outline-none focus-visible:focus-ring" onClick={() => setTab('actions')}><TbPlayerPlay className="size-3.5" aria-hidden />{t('projectActions.title')}</button>
      </div>
      {error && <p role="alert" className="text-caption text-destructive whitespace-pre-wrap">{error}</p>}
      {!snapshot ? <p role="status">{t('worktree.loading')}</p> : tab === 'worktrees' ? <div className="grid gap-4">
        <p className="text-caption text-muted-foreground">{t('worktree.archiveHint')}</p>
        {snapshot.gitAvailable ? <fieldset disabled={busy} className="mac-box grid gap-3 p-4">
          <div className="text-app font-semibold">{t('worktree.create')}</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={fieldClass}>{t('worktree.name')}<Input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} /></label>
            <label className={fieldClass}>{t('worktree.branch')}<Input value={branch} onChange={(event) => setBranch(event.target.value)} placeholder="feature/my-task" maxLength={256} /></label>
          </div>
          <label className={fieldClass}>{t('worktree.base')}<select className="mac-select w-fit" value={baseBranch} onChange={(event) => setBaseBranch(event.target.value)}>
            {snapshot.branches.map((value) => <option key={value}>{value}</option>)}
          </select></label>
          <label className={fieldClass}>{t('worktree.setup')}<select className="mac-select w-fit" value={setup} onChange={(event) => setSetup(event.target.value)}>
            <option value="">{t('worktree.noSetup')}</option>
            {snapshot.actions.map((action) => <option key={action.id} value={action.id}>{action.name}</option>)}
          </select></label>
          {setup && <div className="rounded-lg bg-fill p-3"><p className="text-caption">{t('worktree.setupConfirm')}</p><pre className="mt-1 whitespace-pre-wrap break-all font-mono text-micro">{snapshot.actions.find((action) => action.id === setup)?.platforms[snapshot.platform] || snapshot.actions.find((action) => action.id === setup)?.command}</pre></div>}
          <Button className="justify-self-end" disabled={!name.trim() || !branch.trim() || !baseBranch || dirty} onClick={() => void perform(async () => {
            const result = await window.pipilot!.projectWorkflows.createWorktree({ projectId: workspaceId, name: name.trim(), branch: branch.trim(), baseBranch,
              ...(setup ? { setupActionId: setup, expectedActionRevision: snapshot.revision } : {}) })
            setName(''); setBranch('')
            if (result.error) setError(result.error)
          })}><TbPlus aria-hidden />{t('worktree.create')}</Button>
        </fieldset> : <p className="text-caption text-muted-foreground">{t('worktree.notGit')}</p>}
        {snapshot.worktrees.length === 0 && <p className="text-caption text-muted-foreground">{t('worktree.empty')}</p>}
        {snapshot.worktrees.map((worktree) => <div key={worktree.id} className="mac-box grid gap-2 p-3.5">
          <div className="flex flex-wrap items-center gap-2"><TbGitBranch className="text-primary" aria-hidden /><strong className="text-app font-semibold">{worktree.name}</strong><span className="text-micro text-muted-foreground">{worktree.projectName} / {worktree.branch}</span><span className="ml-auto rounded-full bg-fill-strong px-2 py-px text-micro font-medium">{t(`worktree.state.${worktree.state}`)}</span></div>
          <p className="break-all font-mono text-micro text-muted-foreground">{worktree.state === 'archived' ? worktree.archivePath : worktree.path}</p>
          {worktree.error && <p className="text-caption text-destructive">{worktree.error}</p>}
          <div className="flex gap-2">
            {worktree.state === 'active' && <><Button size="sm" variant="outline" disabled={busy || dirty} onClick={() => {
              if (worktree.workspaceId) { onOpenChange(false); onOpenProject(worktree.workspaceId) }
            }}>{t('worktree.open')}</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => void perform(() => window.pipilot!.projectWorkflows.archiveWorktree(worktree.id))}><TbArchive aria-hidden />{t('worktree.archive')}</Button></>}
            {worktree.state === 'archived' && <Button size="sm" variant="outline" disabled={busy} onClick={() => void perform(() => window.pipilot!.projectWorkflows.restoreWorktree(worktree.id))}><TbArchiveOff aria-hidden />{t('worktree.restore')}</Button>}
          </div>
        </div>)}
      </div> : <div className="grid gap-4">
        <p className="text-caption text-muted-foreground">{t('projectActions.description')}</p>
        {actions.map((action) => <fieldset key={action.id} disabled={busy} className="mac-box grid gap-2.5 p-4">
          <div className="flex items-end gap-2"><label className={`${fieldClass} flex-1`}>{t('projectActions.name')}<Input value={action.name} maxLength={80} onChange={(event) => edit(action.id, { name: event.target.value })} /></label>
            <Button size="icon" variant="ghost" className="text-muted-foreground hover:text-destructive" aria-label={t('projectActions.remove')} onClick={() => setActions((current) => current.filter((entry) => entry.id !== action.id))}><TbTrash aria-hidden /></Button></div>
          <label className={fieldClass}>{t('projectActions.command')}<textarea className="min-h-16 rounded-md bg-control p-2 font-mono text-caption shadow-[0_0_0_0.5px_var(--color-input),inset_0_0.5px_1px_rgb(0_0_0/0.06)] outline-none focus-visible:shadow-[0_0_0_0.5px_var(--color-ring),0_0_0_3.5px_color-mix(in_srgb,var(--color-ring)_45%,transparent)] dark:bg-white/5" value={action.command} maxLength={8_000} onChange={(event) => edit(action.id, { command: event.target.value })} /></label>
          <label className={fieldClass}>{t('projectActions.cwd')}<Input value={action.cwd} onChange={(event) => edit(action.id, { cwd: event.target.value })} placeholder="." /></label>
          <details><summary className="w-fit text-caption text-primary">{t('projectActions.platforms')}</summary><div className="mt-2 grid gap-2">{(['darwin', 'linux', 'win32'] as const).map((platform) => <label key={platform} className={fieldClass}>{platform === 'darwin' ? 'macOS' : platform === 'win32' ? 'Windows' : 'Linux'}<Input value={action.platforms[platform] ?? ''} onChange={(event) => edit(action.id, { platforms: { ...action.platforms, [platform]: event.target.value } })} /></label>)}</div></details>
          <Button size="sm" variant="outline" disabled={dirty || hasRunning || !(action.platforms[snapshot.platform] || action.command).trim()} onClick={() => void perform(async () => {
            const result = await window.pipilot!.projectWorkflows.run(workspaceId, action.id, snapshot.revision); setSelectedRun(result.id)
          })} className="justify-self-start"><TbPlayerPlay aria-hidden />{t('projectActions.run')}</Button>
        </fieldset>)}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={busy || actions.length >= 30} onClick={() => setActions((current) => [...current, { id: crypto.randomUUID(), name: ['Install', 'Test', 'Dev'][current.length] ?? 'Action', command: '', cwd: '.', platforms: {} }])}><TbPlus aria-hidden />{t('projectActions.add')}</Button>
          <Button disabled={busy || !dirty || actions.some((action) => !action.name.trim())} onClick={() => void perform(async () => {
            const value = await window.pipilot!.projectWorkflows.saveActions(workspaceId, actions, editRevision); resetActions(value)
          })}>{t('projectActions.save')}</Button>
          {dirty && <Button variant="ghost" disabled={busy} onClick={() => resetActions(snapshot)}>{t('projectActions.discard')}</Button>}
        </div>
        <div className="grid gap-2 border-t border-border pt-4"><h3 className="text-app font-semibold">{t('projectActions.runs')}</h3>
          {snapshot.runs.length === 0 ? <p className="text-caption text-muted-foreground">{t('projectActions.noRuns')}</p> : <>
            <select className="mac-select w-full text-caption" value={run?.id ?? ''} onChange={(event) => setSelectedRun(event.target.value)}>{snapshot.runs.map((entry) => <option key={entry.id} value={entry.id}>{entry.name} · {t(`projectActions.status.${entry.status}`)} · {new Date(entry.startedAt).toLocaleString()}</option>)}</select>
            {run && <><div className="flex items-center justify-between gap-2 text-caption"><span>{t(`projectActions.status.${run.status}`)}{run.exitCode !== null ? ` · ${t('projectActions.exitCode', { code: run.exitCode })}` : ''}</span>{['running', 'stopping'].includes(run.status) && <Button size="sm" variant="outline" disabled={busy || run.status === 'stopping'} onClick={() => void perform(() => window.pipilot!.projectWorkflows.stop(run.id))}><TbPlayerStop aria-hidden />{t('projectActions.stop')}</Button>}</div>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-surface-inset p-3 font-mono text-micro shadow-[inset_0_0_0_0.5px_var(--color-border)]" aria-label={t('projectActions.output')}>{run.output || t('projectActions.noOutput')}</pre></>}
          </>}
        </div>
      </div>}
    </DialogContent>
  </Dialog>
}
