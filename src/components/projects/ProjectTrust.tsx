import * as React from 'react'
import { TbLoader2, TbShieldCheck, TbShieldQuestion } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { SettingsRow, SettingsSheet, StatusText } from '@/components/settings/kit'
import { useT, type MessageKey } from '@/i18n'
import type { ProjectTrustChoice, ProjectTrustPolicy, ProjectTrustStatus } from '@/shared/project-trust'
import { projectTrust, subscribeProjectTrustPrompt, useProjectTrust, useProjectTrustPolicy } from '@/store/project-trust'
import { workflowErrorText } from '@/store/project-workflows'
import { useWorkspaceStore } from '@/store/workspace'

type TrustScope = 'trust' | 'trust-parent' | 'session'

/**
 * Pi's first-start question for a folder with `.pi` resources: trust it (or
 * its parent folder, or for this run only), or keep them unloaded.
 */
export function ProjectTrustSheet({ workspaceId, projectName, open, onOpenChange }: {
  workspaceId: string
  projectName: string
  open: boolean
  onOpenChange(open: boolean): void
}) {
  const t = useT()
  const { status } = useProjectTrust(open ? workspaceId : null)
  const [scope, setScope] = React.useState<TrustScope>('trust')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  React.useEffect(() => { if (open) { setScope('trust'); setError(null) } }, [open])
  const decide = async (choice: ProjectTrustChoice) => {
    setBusy(true); setError(null)
    try { await projectTrust.decide(workspaceId, choice); onOpenChange(false) }
    catch (caught) { setError(workflowErrorText(caught)) }
    finally { setBusy(false) }
  }
  return <SettingsSheet open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next) }} data-project-trust-sheet
    title={t('projectTrust.sheet.title', { name: projectName })}
    description={t('projectTrust.sheet.description')}
    footer={<div className="flex flex-wrap items-center gap-2">
      {error ? <p role="alert" className="mr-auto text-caption text-destructive">{error}</p> : <span className="mr-auto" />}
      <Button variant="ghost" size="sm" disabled={busy} onClick={() => onOpenChange(false)}>{t('projectTrust.later')}</Button>
      <Button variant="outline" size="sm" disabled={busy} onClick={() => void decide('distrust')}>{t('projectTrust.distrust')}</Button>
      <Button size="sm" disabled={busy} onClick={() => void decide(scope)}>
        {busy ? <TbLoader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : null}{t('projectTrust.trust')}
      </Button>
    </div>}>
    <RadioGroup value={scope} onValueChange={(value) => setScope(value as TrustScope)} aria-label={t('projectTrust.scope')} className="settings-group min-w-0 grid-cols-[minmax(0,1fr)] gap-0 overflow-hidden">
      {([
        ['trust', 'projectTrust.scope.folder', status?.path],
        ...(status?.parentPath ? [['trust-parent', 'projectTrust.scope.parent', status.parentPath] as const] : []),
        ['session', 'projectTrust.scope.session', undefined],
      ] as const).map(([value, label, path]) => <label key={value} data-settings-row className="flex min-h-11 min-w-0 cursor-default items-start gap-3 px-3 py-2.5">
        <RadioGroupItem value={value} className="mt-0.5" disabled={busy} />
        <span className="min-w-0 flex-1">
          <span className="block text-app">{t(label as MessageKey)}</span>
          {path ? <span className="block truncate font-mono text-caption text-muted-foreground" title={path}>{path}</span> : null}
        </span>
      </label>)}
    </RadioGroup>
  </SettingsSheet>
}

/** Opens the trust question once for a project that was just added and is undecided. */
export function ProjectTrustPrompt() {
  const workspace = useWorkspaceStore()
  const [target, setTarget] = React.useState<{ id: string; name: string } | null>(null)
  const projects = workspace.recentProjects
  React.useEffect(() => subscribeProjectTrustPrompt((workspaceId) => {
    void projectTrust.refresh(workspaceId).then((status) => {
      if (status?.state !== 'undecided') return
      const name = projects.find((project) => project.id === workspaceId)?.name ?? status.path.split(/[\\/]/u).filter(Boolean).pop() ?? status.path
      setTarget({ id: workspaceId, name })
    })
  }), [projects])
  if (!target) return null
  return <ProjectTrustSheet open workspaceId={target.id} projectName={target.name} onOpenChange={(open) => { if (!open) setTarget(null) }} />
}

/**
 * A composer-tray row while the active project is undecided (its resources are
 * not loaded) or while a decision waits for open work to finish.
 */
export function ProjectTrustNotice({ workspaceId, projectName }: { workspaceId: string; projectName: string }) {
  const t = useT()
  const { status } = useProjectTrust(workspaceId)
  const [open, setOpen] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  if (!status) return null
  const pending = status.apply === 'pending'
  if (status.state !== 'undecided' && !pending) return null
  return <div role="status" data-project-trust-notice={status.state} className="flex min-h-10 min-w-0 items-center gap-2 py-1 pr-2 pl-4">
    {pending ? <TbLoader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden />
      : <TbShieldQuestion className="size-3.5 shrink-0 text-warning" aria-hidden />}
    <span className="min-w-0 flex-1 text-caption text-muted-foreground">
      {pending ? t('projectTrust.notice.pending') : t('projectTrust.notice.undecided')}
    </span>
    {pending ? null : <>
      <Button variant="ghost" size="sm" className="shrink-0" disabled={busy} onClick={() => {
        setBusy(true)
        void projectTrust.decide(workspaceId, 'distrust').catch(() => undefined).finally(() => setBusy(false))
      }}>{t('projectTrust.distrust')}</Button>
      <Button variant="outline" size="sm" className="shrink-0" disabled={busy} onClick={() => setOpen(true)}>{t('projectTrust.review')}</Button>
    </>}
    <ProjectTrustSheet open={open} onOpenChange={setOpen} workspaceId={workspaceId} projectName={projectName} />
  </div>
}

export function projectTrustStateText(t: ReturnType<typeof useT>, status: ProjectTrustStatus) {
  if (status.state === 'not-required') return t('projectTrust.state.notRequired')
  if (status.state === 'undecided') return t('projectTrust.state.undecided')
  const base = t(status.trusted ? 'projectTrust.state.trusted' : 'projectTrust.state.untrusted')
  if (status.sessionOnly) return t('projectTrust.state.sessionOnly', { state: base })
  if (status.savedPath && status.savedPath !== status.path) return t('projectTrust.state.byParent', { state: base, path: status.savedPath })
  if (!status.savedPath) return t('projectTrust.state.byPolicy', { state: base })
  return base
}

/** Settings › Local environment: the selected project's decision. */
export function ProjectTrustSettingsRow({ workspaceId, projectName }: { workspaceId: string; projectName: string }) {
  const t = useT()
  const { status, error } = useProjectTrust(workspaceId)
  const [open, setOpen] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [failure, setFailure] = React.useState<string | null>(null)
  React.useEffect(() => { setFailure(null) }, [workspaceId])
  const run = (choice: ProjectTrustChoice) => {
    setBusy(true); setFailure(null)
    void projectTrust.decide(workspaceId, choice).catch((caught: unknown) => setFailure(workflowErrorText(caught))).finally(() => setBusy(false))
  }
  const description = failure ?? error ?? (status?.apply === 'pending' ? t('projectTrust.notice.pending')
    : status?.apply === 'failed' ? t('projectTrust.applyFailed') : status ? projectTrustStateText(t, status) : undefined)
  const decided = status && (status.state === 'trusted' || status.state === 'untrusted') && (status.sessionOnly || status.savedPath === status.path)
  return <SettingsRow data-project-trust-row={status?.state ?? 'loading'} label={t('projectTrust.title')} info={t('projectTrust.info')}
    icon={<TbShieldCheck className="size-4 text-muted-foreground" aria-hidden />}
    description={failure || error || status?.apply === 'failed' ? <StatusText tone="danger">{description}</StatusText> : description}>
    {!status ? <TbLoader2 className="size-4 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden />
      : status.state === 'not-required' ? null
        : <div className="flex shrink-0 gap-2">
          {decided ? <Button variant="outline" size="sm" disabled={busy} onClick={() => run('reset')}>{t('projectTrust.reset')}</Button> : null}
          {status.trusted ? <Button variant="outline" size="sm" disabled={busy} onClick={() => run('distrust')}>{t('projectTrust.distrust')}</Button>
            : <Button variant="outline" size="sm" disabled={busy} onClick={() => setOpen(true)}>{t('projectTrust.trustEllipsis')}</Button>}
        </div>}
    <ProjectTrustSheet open={open} onOpenChange={setOpen} workspaceId={workspaceId} projectName={projectName} />
  </SettingsRow>
}

/** Settings › General: Pi's `defaultProjectTrust`, shared with the CLI. */
export function ProjectTrustPolicyRow() {
  const t = useT()
  const policy = useProjectTrustPolicy()
  const [failed, setFailed] = React.useState(false)
  return <SettingsRow label={t('projectTrust.policy')} info={t('projectTrust.policyInfo')} htmlFor="project-trust-policy"
    description={failed ? <StatusText tone="danger">{t('projectTrust.policyFailed')}</StatusText> : undefined}>
    <select id="project-trust-policy" className="mac-select" value={policy ?? 'ask'} disabled={!policy}
      onChange={(event) => {
        setFailed(false)
        void projectTrust.setPolicy(event.target.value as ProjectTrustPolicy).catch(() => setFailed(true))
      }}>
      <option value="ask">{t('projectTrust.policy.ask')}</option>
      <option value="always">{t('projectTrust.policy.always')}</option>
      <option value="never">{t('projectTrust.policy.never')}</option>
    </select>
  </SettingsRow>
}
