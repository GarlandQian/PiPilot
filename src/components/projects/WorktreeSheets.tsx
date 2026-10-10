import * as React from 'react'
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useT } from '@/i18n'
import type { ManagedWorktree } from '@/shared/project-workflows'
import { FormActions, SettingsField, SettingsGroup, SettingsRow, SettingsSheet } from '@/components/settings/kit'
import { projectWorkflows, useProjectWorkflow, workflowErrorText } from '@/store/project-workflows'
import { useWorkspaceStore } from '@/store/workspace'

/** "Fix login crash" → "feature/fix-login-crash"; a name with nothing usable leaves the branch to the person. */
function branchFor(name: string) {
  const slug = name.normalize('NFKD').toLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 60)
  return slug ? `feature/${slug}` : ''
}

/** A new working copy of a project: a task name, its branch, where it starts and what runs once it exists. */
export function NewWorktreeSheet({ open, onOpenChange, workspaceId, projectName, onCreated }: {
  open: boolean
  onOpenChange(open: boolean): void
  /** The project it is made from (a working copy makes one from its source). */
  workspaceId: string
  projectName: string
  onCreated(worktree: ManagedWorktree, ranSetup: boolean): void
}) {
  const t = useT()
  const workspace = useWorkspaceStore()
  // The open project's checked-out branch is the natural start; another project starts from its first branch.
  const currentBranch = workspace.workspace?.id === workspaceId ? workspace.workspace.branch : undefined
  const { snapshot, error: loadError } = useProjectWorkflow(open ? workspaceId : null)
  const [name, setName] = React.useState('')
  const [branch, setBranch] = React.useState('')
  const [branchEdited, setBranchEdited] = React.useState(false)
  const [base, setBase] = React.useState('')
  const [setup, setSetup] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  React.useEffect(() => {
    if (!open) return
    setName(''); setBranch(''); setBranchEdited(false); setBase(''); setSetup(''); setError(null)
  }, [open])
  const branches = snapshot?.branches ?? []
  const baseBranch = base || (currentBranch && branches.includes(currentBranch) ? currentBranch : branches[0] ?? '')
  const setupAction = snapshot?.actions.find((action) => action.id === setup)
  const canCreate = Boolean(snapshot?.gitAvailable && name.trim() && branch.trim() && baseBranch) && !saving

  const create = async () => {
    if (!snapshot || !canCreate) return
    setSaving(true); setError(null)
    try {
      const worktree = await projectWorkflows.createWorktree({
        projectId: workspaceId, name: name.trim(), branch: branch.trim(), baseBranch,
        ...(setupAction ? { setupActionId: setupAction.id, expectedActionRevision: snapshot.revision } : {}),
      })
      onOpenChange(false)
      onCreated(worktree, Boolean(setupAction) && !worktree.error)
    } catch (caught) {
      setError(workflowErrorText(caught))
    } finally {
      setSaving(false)
    }
  }

  return <SettingsSheet open={open} onOpenChange={(next) => { if (!saving) onOpenChange(next) }} data-new-worktree-sheet
    title={t('worktree.newTitle', { name: projectName })} description={t('worktree.newDescription')}
    footer={<FormActions onCancel={() => onOpenChange(false)} onSave={() => void create()} saving={saving} canSave={canCreate}
      saveLabel={t('worktree.create')} error={error ?? (snapshot ? null : loadError)} />}>
    {!snapshot ? <p role="status" className="px-2.5 py-6 text-center text-caption text-muted-foreground">{t('worktree.loading')}</p>
      : !snapshot.gitAvailable ? <p className="px-2.5 py-6 text-center text-caption text-muted-foreground">{t('worktree.notGit')}</p>
        : <form className="space-y-5" onSubmit={(event) => { event.preventDefault(); void create() }}>
          <SettingsGroup>
            <SettingsField label={t('worktree.name')} htmlFor="new-worktree-name">
              <Input id="new-worktree-name" value={name} maxLength={80} autoFocus
                onChange={(event) => { setName(event.target.value); if (!branchEdited) setBranch(branchFor(event.target.value)) }} />
            </SettingsField>
            <SettingsField label={t('worktree.branch')} htmlFor="new-worktree-branch">
              <Input id="new-worktree-branch" value={branch} maxLength={256} spellCheck={false} placeholder="feature/my-task" className="font-mono"
                onChange={(event) => { setBranch(event.target.value); setBranchEdited(true) }} />
            </SettingsField>
            <SettingsRow label={t('worktree.base')} htmlFor="new-worktree-base">
              <select id="new-worktree-base" className="mac-select" value={baseBranch} onChange={(event) => setBase(event.target.value)}>
                {branches.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </SettingsRow>
            <SettingsRow label={t('worktree.setup')} htmlFor="new-worktree-setup" info={t('worktree.setupInfo')}>
              <select id="new-worktree-setup" className="mac-select" value={setup} onChange={(event) => setSetup(event.target.value)}>
                <option value="">{t('worktree.noSetup')}</option>
                {snapshot.actions.map((action) => <option key={action.id} value={action.id}>{action.name}</option>)}
              </select>
            </SettingsRow>
          </SettingsGroup>
          {setupAction ? <div className="rounded-[12px] bg-fill px-3.5 py-2.5">
            <p className="text-caption text-muted-foreground">{t('worktree.setupConfirm')}</p>
            <pre className="mt-1 whitespace-pre-wrap break-all font-mono text-micro text-foreground">{setupAction.platforms[snapshot.platform] || setupAction.command}</pre>
          </div> : null}
          <button type="submit" hidden aria-hidden tabIndex={-1} />
        </form>}
  </SettingsSheet>
}

/** Archiving keeps the whole checkout; it needs the working copy to be idle first. */
export function ArchiveWorktreeDialog({ worktree, onOpenChange }: { worktree: ManagedWorktree | null; onOpenChange(open: boolean): void }) {
  const t = useT()
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  React.useEffect(() => { setError(null) }, [worktree?.id])
  const archive = async () => {
    if (!worktree) return
    setBusy(true); setError(null)
    try {
      await projectWorkflows.archiveWorktree(worktree)
      onOpenChange(false)
    } catch (caught) {
      setError(workflowErrorText(caught))
    } finally {
      setBusy(false)
    }
  }
  return <AlertDialog open={worktree !== null} onOpenChange={(open) => { if (!busy) onOpenChange(open) }}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{t('worktree.archiveTitle', { name: worktree?.name ?? '' })}</AlertDialogTitle>
        <AlertDialogDescription>{t('worktree.archiveHint')}</AlertDialogDescription>
      </AlertDialogHeader>
      {error ? <p role="alert" className="text-caption whitespace-pre-wrap text-destructive">{error}</p> : null}
      <AlertDialogFooter>
        <AlertDialogCancel disabled={busy}>{t('common.cancel')}</AlertDialogCancel>
        <Button disabled={busy} onClick={() => void archive()}>{t('worktree.archive')}</Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
}
