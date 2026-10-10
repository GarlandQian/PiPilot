import * as React from 'react'
import { TbArchive, TbArchiveOff, TbArrowRight, TbCopy, TbDots, TbFolderPlus, TbGitBranch, TbLoader2, TbPencil, TbPlayerPlay, TbPlayerStop, TbPlus, TbTrash } from 'react-icons/tb'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useT, type MessageKey } from '@/i18n'
import { cn } from '@/lib/utils'
import type { ManagedWorktree, ProjectAction } from '@/shared/project-workflows'
import { projectWorkflows, useProjectWorkflow, workflowErrorText } from '@/store/project-workflows'
import { useWorkspaceStore } from '@/store/workspace'
import { ActionSheet, blankAction } from '@/components/projects/ActionSheet'
import { ArchiveWorktreeDialog, NewWorktreeSheet } from '@/components/projects/WorktreeSheets'
import { subscribeLocalEnvironmentProject, takeLocalEnvironmentProject, useProjectWorkflowActions } from '@/components/projects/project-workflow-actions'
import { SettingsBadge, SettingsGroup, SettingsListRow, SettingsPage, SettingsRow, StatusText } from './kit'

const MAX_ACTIONS = 30

export function RowTile({ tint, children, dimmed = false }: { tint: string; children: React.ReactNode; dimmed?: boolean }) {
  return <span aria-hidden style={{ backgroundColor: dimmed ? '#8e8e93' : tint }}
    className="flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-[linear-gradient(to_bottom,rgb(255_255_255/0.2),transparent)] text-white shadow-[inset_0_0_0_0.5px_rgb(0_0_0/0.08)]">
    {children}
  </span>
}

const TRANSITIONAL = new Set<ManagedWorktree['state']>(['creating', 'archiving', 'restoring'])

/**
 * Codex's local environment, per project: the commands it keeps at hand
 * (run from the toolbar) and the working copies made from it.
 */
export function LocalEnvironmentSettings({ active = true }: { active?: boolean }) {
  const t = useT()
  const workspace = useWorkspaceStore()
  const shell = useProjectWorkflowActions()
  const projects = workspace.recentProjects
  const activeProjectId = workspace.activeScope.kind === 'project' ? workspace.activeScope.workspaceId : null
  const [chosen, setChosen] = React.useState<string | null>(null)
  React.useEffect(() => {
    if (!active) return
    const take = () => { const next = takeLocalEnvironmentProject(); if (next) setChosen(next) }
    take()
    return subscribeLocalEnvironmentProject(take)
  }, [active])
  const projectId = chosen && projects.some((project) => project.id === chosen) ? chosen : activeProjectId ?? projects[0]?.id ?? null
  const project = projects.find((candidate) => candidate.id === projectId) ?? null
  const { snapshot, error: loadError } = useProjectWorkflow(active ? projectId : null)
  const self = snapshot?.worktrees.find((worktree) => worktree.workspaceId === projectId) ?? null
  const running = snapshot?.runs.find((run) => run.status === 'running' || run.status === 'stopping') ?? null
  const [editing, setEditing] = React.useState<{ action: ProjectAction; isNew: boolean } | null>(null)
  const [removing, setRemoving] = React.useState<ProjectAction | null>(null)
  const [copying, setCopying] = React.useState(false)
  const [creating, setCreating] = React.useState(false)
  const [archiving, setArchiving] = React.useState<ManagedWorktree | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  React.useEffect(() => { setError(null) }, [projectId])
  React.useEffect(() => { if (!active) { setEditing(null); setRemoving(null); setCreating(false); setArchiving(null) } }, [active])

  const perform = async (operation: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true); setError(null)
    try { await operation() } catch (caught) { setError(workflowErrorText(caught)) } finally { setBusy(false) }
  }
  const actions = snapshot?.actions ?? []
  const saveAction = async (action: ProjectAction) => {
    if (!projectId) return
    const next = actions.some((candidate) => candidate.id === action.id)
      ? actions.map((candidate) => candidate.id === action.id ? action : candidate)
      : [...actions, action]
    await projectWorkflows.saveActions(projectId, next)
  }
  const runAction = (action: ProjectAction) => projectId && void perform(async () => {
    const run = await projectWorkflows.run(projectId, action.id)
    if (projectId === activeProjectId) shell?.openActionRun(projectId, run.id)
  })
  const copyFromSource = () => self && projectId && void perform(async () => {
    const source = await window.pipilot!.projectWorkflows.get(self.projectId)
    await projectWorkflows.saveActions(projectId, source.actions.map((action) => ({ ...action, platforms: { ...action.platforms } })))
    setCopying(false)
  })

  if (!project || !projectId) {
    return <SettingsPage data-local-environment>
      <div className="settings-group flex flex-col items-center gap-3 px-4 py-10 text-center">
        <TbFolderPlus className="size-7 text-muted-foreground/60" aria-hidden />
        <p className="max-w-sm text-caption text-muted-foreground">{t('localEnvironment.noProject')}</p>
        <Button variant="outline" size="sm" onClick={() => void workspace.chooseWorkspace()}>{t('localEnvironment.openProject')}</Button>
      </div>
    </SettingsPage>
  }

  const worktrees = [...(snapshot?.worktrees ?? [])].sort((left, right) => (left.state === 'archived' ? 1 : 0) - (right.state === 'archived' ? 1 : 0) || right.createdAt.localeCompare(left.createdAt))
  return <SettingsPage data-local-environment={projectId}>
    {error || (loadError && !snapshot) ? <p role="alert" className="rounded-[12px] bg-destructive/8 px-3.5 py-2.5 text-caption whitespace-pre-wrap text-destructive">{error ?? loadError}</p> : null}

    <SettingsGroup footer={t('localEnvironment.storedLocally')}>
      <SettingsRow label={t('localEnvironment.project')} htmlFor="local-environment-project">
        <select id="local-environment-project" className="mac-select max-w-64" value={projectId} onChange={(event) => setChosen(event.target.value)}>
          {projects.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
        </select>
      </SettingsRow>
      {self ? <SettingsRow label={t('localEnvironment.worktreeOf', { name: self.projectName })} icon={<RowTile tint="#5856d6"><TbGitBranch className="size-4" /></RowTile>}
        description={t('localEnvironment.worktreeNote', { name: self.projectName })}>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => setCopying(true)}><TbCopy aria-hidden />{t('localEnvironment.copyFrom', { name: self.projectName })}</Button>
      </SettingsRow> : null}
    </SettingsGroup>

    {!snapshot ? <div className="settings-group flex items-center justify-center gap-2 px-3 py-10 text-caption text-muted-foreground" role="status">
      <TbLoader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />{t('worktree.loading')}
    </div> : <>
      <SettingsGroup title={t('localEnvironment.actions')} info={t('projectActions.description')} boxRole={actions.length ? 'list' : undefined} data-project-actions
        actions={<Button variant="outline" size="sm" disabled={busy || actions.length >= MAX_ACTIONS} onClick={() => setEditing({ action: blankAction(actions.length), isNew: true })}>
          <TbPlus aria-hidden />{t('localEnvironment.addAction')}
        </Button>}
        footer={actions.length >= MAX_ACTIONS ? t('localEnvironment.actionLimit') : t('localEnvironment.actionsFooter')}>
        {actions.length === 0 ? <p data-settings-row className="px-3 py-6 text-center text-caption text-muted-foreground">{t('localEnvironment.noActions')}</p> : null}
        {actions.map((action) => {
          const command = (action.platforms[snapshot.platform] || action.command).trim()
          const isRunning = running?.actionId === action.id
          const last = snapshot.runs.find((run) => run.actionId === action.id)
          return <SettingsListRow key={action.id} data-project-action={action.name}
            icon={<RowTile tint="#34c759"><TbPlayerPlay className="size-4" /></RowTile>}
            title={action.name} subtitle={<span className="font-mono">{command.split('\n')[0] || t('localEnvironment.noCommand')}</span>}
            status={isRunning ? <StatusText icon={<TbLoader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />}>{t(`projectActions.status.${running!.status}` as MessageKey)}</StatusText>
              : last ? <StatusText tone={last.status === 'completed' ? 'success' : last.status === 'failed' || last.status === 'interrupted' ? 'danger' : 'neutral'}>
                {t(`projectActions.status.${last.status}` as MessageKey)}
              </StatusText> : undefined}
            onOpen={() => setEditing({ action, isNew: false })} openLabel={t('localEnvironment.editNamed', { name: action.name })} disabled={busy}
            menu={<DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-xs" className="text-muted-foreground" aria-label={t('localEnvironment.actionsFor', { name: action.name })}><TbDots aria-hidden /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {isRunning ? <DropdownMenuItem disabled={busy || running!.status === 'stopping'} onSelect={() => void perform(() => projectWorkflows.stop(projectId, running!.id))}>
                  <TbPlayerStop aria-hidden />{t('projectActions.stop')}
                </DropdownMenuItem> : <DropdownMenuItem disabled={busy || Boolean(running) || !command} onSelect={() => runAction(action)}><TbPlayerPlay aria-hidden />{t('projectActions.run')}</DropdownMenuItem>}
                <DropdownMenuItem onSelect={() => setEditing({ action, isNew: false })}><TbPencil aria-hidden />{t('localEnvironment.editAction')}</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" disabled={isRunning} onSelect={() => setRemoving(action)}><TbTrash aria-hidden />{t('projectActions.remove')}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>} />
        })}
      </SettingsGroup>

      <SettingsGroup title={t('worktree.title')} info={t('worktree.archiveHint')} boxRole={worktrees.length ? 'list' : undefined} data-project-worktrees
        actions={<Button variant="outline" size="sm" disabled={!snapshot.gitAvailable} onClick={() => setCreating(true)}><TbPlus aria-hidden />{t('worktree.new')}</Button>}>
        {!snapshot.gitAvailable ? <p data-settings-row className="px-3 py-6 text-center text-caption text-muted-foreground">{t('worktree.notGit')}</p>
          : worktrees.length === 0 ? <p data-settings-row className="px-3 py-6 text-center text-caption text-muted-foreground">{t('worktree.empty')}</p> : null}
        {worktrees.map((worktree) => {
          const transitional = TRANSITIONAL.has(worktree.state)
          const current = worktree.workspaceId === activeProjectId
          return <SettingsListRow key={worktree.id} data-worktree={worktree.name} data-worktree-state={worktree.state}
            icon={<RowTile tint="#5856d6" dimmed={worktree.state === 'archived'}><TbGitBranch className="size-4" /></RowTile>}
            title={worktree.name} dimmed={worktree.state === 'archived'}
            badges={<>
              {current ? <SettingsBadge tone="accent">{t('localEnvironment.current')}</SettingsBadge> : null}
              {worktree.state !== 'active' && worktree.state !== 'error' ? <SettingsBadge>{t(`worktree.state.${worktree.state}` as MessageKey)}</SettingsBadge> : null}
            </>}
            subtitle={<span className="font-mono">{worktree.branch} <span className="font-sans">· {t('worktree.fromBase', { base: worktree.baseBranch })}</span></span>}
            status={worktree.error ? <StatusText tone="danger" title={worktree.error}>{t('worktree.state.error')}</StatusText>
              : transitional ? <TbLoader2 className="size-3.5 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden /> : undefined}
            onOpen={worktree.state === 'active' && worktree.workspaceId && !current ? () => shell?.startProjectTask(worktree.workspaceId!) : undefined}
            openLabel={t('worktree.openNamed', { name: worktree.name })}
            menu={<DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-xs" className="text-muted-foreground" disabled={transitional} aria-label={t('localEnvironment.actionsFor', { name: worktree.name })}><TbDots aria-hidden /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {worktree.state === 'active' && worktree.workspaceId ? <>
                  <DropdownMenuItem disabled={current} onSelect={() => shell?.startProjectTask(worktree.workspaceId!)}><TbArrowRight aria-hidden />{t('worktree.open')}</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setArchiving(worktree)}><TbArchive aria-hidden />{t('worktree.archiveAction')}</DropdownMenuItem>
                </> : worktree.state === 'archived' ? <DropdownMenuItem onSelect={() => void perform(() => projectWorkflows.restoreWorktree(worktree))}>
                  <TbArchiveOff aria-hidden />{t('worktree.restore')}
                </DropdownMenuItem> : <DropdownMenuItem disabled>{t(`worktree.state.${worktree.state}` as MessageKey)}</DropdownMenuItem>}
              </DropdownMenuContent>
            </DropdownMenu>} />
        })}
      </SettingsGroup>
    </>}

    {editing ? <ActionSheet open onOpenChange={(open) => { if (!open) setEditing(null) }} initial={editing.action} isNew={editing.isNew} onSave={saveAction}
      onDelete={editing.isNew ? undefined : () => { setRemoving(editing.action); setEditing(null) }} /> : null}
    <NewWorktreeSheet open={creating} onOpenChange={setCreating} workspaceId={projectId} projectName={self?.projectName ?? project.name}
      onCreated={(worktree, ranSetup) => {
        if (!worktree.workspaceId) return
        shell?.startProjectTask(worktree.workspaceId)
        if (ranSetup) shell?.openActionRun(worktree.workspaceId)
      }} />
    <ArchiveWorktreeDialog worktree={archiving} onOpenChange={(open) => { if (!open) setArchiving(null) }} />
    <AlertDialog open={removing !== null} onOpenChange={(open) => { if (!open) setRemoving(null) }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('localEnvironment.removeTitle', { name: removing?.name ?? '' })}</AlertDialogTitle>
          <AlertDialogDescription>{t('localEnvironment.removeDescription')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => {
            const target = removing
            setRemoving(null)
            if (target && projectId) void perform(() => projectWorkflows.saveActions(projectId, actions.filter((action) => action.id !== target.id)))
          }}>{t('projectActions.remove')}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <AlertDialog open={copying} onOpenChange={(open) => { if (!busy) setCopying(open) }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('localEnvironment.copyTitle', { name: self?.projectName ?? '' })}</AlertDialogTitle>
          <AlertDialogDescription>{t('localEnvironment.copyDescription', { count: actions.length })}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{t('common.cancel')}</AlertDialogCancel>
          <Button disabled={busy} className={cn(busy && 'opacity-70')} onClick={copyFromSource}>{t('localEnvironment.copyConfirm')}</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </SettingsPage>
}
