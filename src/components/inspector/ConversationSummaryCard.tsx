import * as React from 'react'
import { TbArrowDown, TbArrowUp, TbChevronRight, TbGitBranch, TbX } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { useT } from '@/i18n'
import type { WorkspaceGitStatus } from '@/shared/workspace-content'
import type { WorkspaceChangeTotals } from './WorkspacePanel'

/** Upstream, ahead and behind, read when the card opens. */
function useGitStatus(workspaceId: string | undefined, open: boolean, revision: unknown) {
  const [status, setStatus] = React.useState<WorkspaceGitStatus | null>(null)
  React.useEffect(() => {
    if (!open || !workspaceId) return
    let current = true
    void window.pipilot?.changes.status(workspaceId).then((value) => { if (current) setStatus(value) }, () => { if (current) setStatus(null) })
    return () => { current = false }
  }, [open, revision, workspaceId])
  return status?.workspaceId === workspaceId ? status : null
}

/**
 * Codex's thread summary: a card over the trailing edge with the branch,
 * the uncommitted changes and Git actions, then the conversation's plan,
 * outputs and sources. It opens from the toolbar only (no edge hover).
 */
export function ConversationSummaryCard({ open, onOpenChange, context, branch, changeTotals, onOpenReview, gitActions, workspaceId }: {
  workspaceId?: string
  open: boolean
  onOpenChange(open: boolean): void
  context: React.ReactNode
  branch: string
  changeTotals: WorkspaceChangeTotals | null
  onOpenReview?: () => void
  gitActions?: React.ReactNode
}) {
  const t = useT()
  const changes = changeTotals?.gitAvailable && changeTotals.loaded ? changeTotals : null
  const status = useGitStatus(workspaceId, open, changeTotals)
  return <Popover open={open} onOpenChange={onOpenChange}>
    <PopoverAnchor asChild>
      <div aria-hidden className="pointer-events-none fixed top-[calc(var(--frame-header-h)-6px)] right-3 size-0" />
    </PopoverAnchor>
    <PopoverContent side="bottom" align="end" sideOffset={0} data-conversation-summary aria-label={t('summary.title')}
      onInteractOutside={(event) => {
        // The toolbar button toggles the card itself.
        if (event.target instanceof Element && event.target.closest('[data-summary-trigger]')) event.preventDefault()
      }}
      className="flex max-h-[calc(100vh-var(--frame-header-h)-24px)] w-[380px] max-w-[calc(100vw-24px)] flex-col gap-0 p-0">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border/70 pr-2 pl-4">
        <h2 className="min-w-0 flex-1 truncate text-body font-semibold">{t('summary.title')}</h2>
        <Button variant="ghost" size="icon-xs" onClick={() => onOpenChange(false)} aria-label={t('common.close')} title={t('common.close')}><TbX aria-hidden /></Button>
      </header>
      <div className="scroll-slim min-h-0 flex-1 overflow-y-auto">
        {branch || changes || gitActions ? <section className="space-y-1 border-b border-border/70 px-2 py-2" aria-label={t('summary.branch')}>
          {branch ? <div className="flex min-w-0 items-center gap-2 px-2 py-1 text-caption">
            <TbGitBranch className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1 truncate font-mono" title={branch}>{branch}</span>
            {status?.gitAvailable && status.upstream ? <span className="flex shrink-0 items-center gap-1.5 text-micro text-muted-foreground tabular-nums" title={t('summary.upstream', { name: status.upstream })}>
              {status.ahead ? <span className="flex items-center" aria-label={t('summary.ahead', { count: status.ahead })}><TbArrowUp className="size-3" aria-hidden />{status.ahead}</span> : null}
              {status.behind ? <span className="flex items-center" aria-label={t('summary.behind', { count: status.behind })}><TbArrowDown className="size-3" aria-hidden />{status.behind}</span> : null}
              {!status.ahead && !status.behind ? <span>{t('summary.upToDate')}</span> : null}
            </span> : status?.gitAvailable && status.hasCommits ? <span className="shrink-0 text-micro text-muted-foreground">{t('summary.noUpstream')}</span> : null}
          </div> : null}
          {status?.base && !status.onDefaultBranch ? <p className="px-2 pb-0.5 pl-8 text-micro text-muted-foreground">{t('summary.base', { base: status.base })}</p> : null}
          {changes ? <button type="button" onClick={onOpenReview} disabled={!onOpenReview}
            className="group flex w-full min-w-0 items-center gap-2 rounded-[8px] px-2 py-1.5 text-left text-caption hover:bg-fill focus-visible:focus-ring disabled:pointer-events-none">
            <span className="min-w-0 flex-1 truncate">{changes.files ? t('summary.changes', { count: changes.files }) : t('summary.noChanges')}</span>
            {changes.files ? <span className="shrink-0 font-mono tabular-nums"><span className="text-success">+{changes.added}</span> <span className="text-destructive">−{changes.deleted}</span></span> : null}
            {onOpenReview ? <TbChevronRight className="size-3 shrink-0 stroke-[2.6] text-muted-foreground" aria-hidden /> : null}
          </button> : null}
          {gitActions ? <div className="px-2 pt-1 pb-0.5">{gitActions}</div> : null}
        </section> : null}
        <div className="[&>*]:h-auto [&>[role=status]]:py-8" data-summary-context>{context}</div>
      </div>
    </PopoverContent>
  </Popover>
}
