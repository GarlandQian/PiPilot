import * as React from 'react'
import { TbAlertTriangle, TbArrowLeft, TbCheck, TbCircleDashed, TbExternalLink, TbGitPullRequest, TbLoader2, TbRefresh, TbTool, TbX } from 'react-icons/tb'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useT, type MessageKey } from '@/i18n'
import { cn } from '@/lib/utils'
import type { PullRequestCheck, PullRequestDetail, PullRequestFilter, PullRequestReviewAction, PullRequestStatus, PullRequestSummary } from '@/shared/pull-requests'

function errorText(error: unknown) {
  return error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error)
}

function CheckIcon({ state, className }: { state: PullRequestCheck['state'] | PullRequestSummary['checks']['state']; className?: string }) {
  if (state === 'passing') return <TbCheck className={cn('text-success', className)} aria-hidden />
  if (state === 'failing') return <TbX className={cn('text-destructive', className)} aria-hidden />
  if (state === 'pending') return <TbCircleDashed className={cn('text-warning', className)} aria-hidden />
  return <TbCircleDashed className={cn('text-muted-foreground', className)} aria-hidden />
}

const open = (url: string) => { void window.pipilot?.shell.openExternal(url).catch(() => undefined) }

/** gh is missing, signed out, or the folder is not a GitHub repository. */
function Setup({ status, onRetry }: { status: PullRequestStatus; onRetry(): void }) {
  const t = useT()
  return <div className="flex flex-col items-center gap-3 px-6 py-10 text-center" data-pull-requests-setup={status.state}>
    <TbGitPullRequest className="size-8 text-muted-foreground/60" aria-hidden />
    <p className="max-w-xs text-caption text-muted-foreground">{t(`pullRequests.setup.${status.state}` as MessageKey)}</p>
    {status.state === 'gh-missing' ? <Button size="sm" variant="outline" onClick={() => open('https://cli.github.com/')}><TbExternalLink aria-hidden />{t('pullRequests.installGh')}</Button> : null}
    {status.state === 'unauthenticated' ? <code className="rounded-[6px] bg-fill px-2 py-1 font-mono text-caption select-all">gh auth login</code> : null}
    {status.message ? <p className="max-w-xs text-micro text-muted-foreground">{status.message}</p> : null}
    <Button size="sm" variant="ghost" onClick={onRetry}><TbRefresh aria-hidden />{t('pullRequests.checkAgain')}</Button>
  </div>
}

/**
 * Codex's PR inbox for the open project's repository, through the user's own
 * `gh`: what involves you, its checks, and reviews. "Fix" opens the branch in
 * a working copy and starts a conversation with the failing checks' output.
 */
export function PullRequestsPanel({ workspaceId, visible, onOpenConversation }: {
  workspaceId: string
  visible: boolean
  onOpenConversation(workspaceId: string, sessionId: string): void
}) {
  const t = useT()
  const api = window.pipilot!.pullRequests
  const [status, setStatus] = React.useState<PullRequestStatus | null>(null)
  const [filter, setFilter] = React.useState<PullRequestFilter>('mine')
  const [items, setItems] = React.useState<PullRequestSummary[] | null>(null)
  const [selected, setSelected] = React.useState<PullRequestDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = React.useState<number | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState<string | null>(null)
  const [reviewing, setReviewing] = React.useState<PullRequestReviewAction | null>(null)
  const [reviewBody, setReviewBody] = React.useState('')
  const [confirming, setConfirming] = React.useState(false)

  const load = React.useCallback(async () => {
    setError(null)
    try {
      const next = await api.status(workspaceId)
      setStatus(next)
      if (next.state === 'ready') setItems(await api.list(workspaceId, filter))
    } catch (caught) { setError(errorText(caught)) }
  }, [api, filter, workspaceId])
  React.useEffect(() => { setItems(null); setSelected(null); setStatus(null) }, [workspaceId])
  React.useEffect(() => { if (visible) void load() }, [load, visible])

  const show = (number: number) => {
    setLoadingDetail(number); setError(null)
    void api.detail(workspaceId, number).then(setSelected, (caught: unknown) => setError(errorText(caught))).finally(() => setLoadingDetail(null))
  }
  const fix = () => {
    if (!selected) return
    setBusy('fix'); setError(null)
    void api.fix(workspaceId, selected.number).then((result) => onOpenConversation(result.workspaceId, result.sessionId), (caught: unknown) => setError(errorText(caught)))
      .finally(() => setBusy(null))
  }
  const submitReview = () => {
    if (!selected || !reviewing) return
    setBusy('review'); setError(null); setConfirming(false)
    void api.review(workspaceId, selected.number, reviewing, reviewBody).then((next) => { setSelected(next); setReviewing(null); setReviewBody('') }, (caught: unknown) => setError(errorText(caught)))
      .finally(() => setBusy(null))
  }

  if (!status) return <p role="status" className="flex items-center justify-center gap-2 py-10 text-caption text-muted-foreground"><TbLoader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />{t('pullRequests.loading')}</p>
  if (status.state !== 'ready') return <Setup status={status} onRetry={() => void load()} />

  return <div className="flex h-full min-h-0 flex-col" data-pull-requests>
    <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2">
      {selected ? <Button variant="ghost" size="icon-xs" aria-label={t('pullRequests.back')} onClick={() => setSelected(null)}><TbArrowLeft aria-hidden /></Button> : null}
      <span className="min-w-0 flex-1 truncate text-caption text-muted-foreground" title={status.repository}>{selected ? `#${selected.number}` : status.repository}</span>
      {!selected ? <select className="mac-select" value={filter} aria-label={t('pullRequests.filter')} onChange={(event) => setFilter(event.target.value as PullRequestFilter)}>
        <option value="mine">{t('pullRequests.filter.mine')}</option>
        <option value="open">{t('pullRequests.filter.open')}</option>
      </select> : null}
      <Button variant="ghost" size="icon-xs" aria-label={t('pullRequests.refresh')} title={t('pullRequests.refresh')} onClick={() => selected ? show(selected.number) : void load()}><TbRefresh aria-hidden /></Button>
    </div>
    {error ? <p role="alert" className="shrink-0 border-b border-border/60 bg-destructive/8 px-3 py-2 text-caption whitespace-pre-wrap text-destructive">{error}</p> : null}

    {!selected ? <ul className="scroll-slim min-h-0 flex-1 overflow-y-auto px-2 py-2" aria-label={t('pullRequests.title')}>
      {items === null ? <li className="flex items-center justify-center gap-2 py-8 text-caption text-muted-foreground"><TbLoader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />{t('pullRequests.loading')}</li>
        : items.length === 0 ? <li className="px-3 py-8 text-center text-caption text-muted-foreground">{t(filter === 'mine' ? 'pullRequests.emptyMine' : 'pullRequests.empty')}</li>
          : items.map((item) => <li key={item.number}>
            <button type="button" data-pull-request={item.number} onClick={() => show(item.number)}
              className="flex w-full min-w-0 items-start gap-2 rounded-[8px] px-2 py-2 text-left outline-none hover:bg-fill focus-visible:focus-ring">
              <TbGitPullRequest className={cn('mt-0.5 size-4 shrink-0', item.draft ? 'text-muted-foreground' : 'text-success')} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-app">{item.title}</span>
                <span className="block truncate text-micro text-muted-foreground">#{item.number} · {item.author} · {item.branch} → {item.base}{item.reviewRequested ? ` · ${t('pullRequests.reviewRequested')}` : ''}</span>
              </span>
              {loadingDetail === item.number ? <TbLoader2 className="mt-0.5 size-3.5 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden />
                : <span className="mt-0.5 flex shrink-0 items-center gap-1 text-micro text-muted-foreground" data-pull-request-checks={item.checks.state} title={t(`pullRequests.checks.${item.checks.state}` as MessageKey, { failed: item.checks.failed, total: item.checks.total })}>
                  <CheckIcon state={item.checks.state} className="size-3.5" />{item.checks.failed ? item.checks.failed : null}
                </span>}
            </button>
          </li>)}
    </ul> : <div className="scroll-slim min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3" data-pull-request-detail={selected.number}>
      <div>
        <h3 className="text-app font-semibold">{selected.title}</h3>
        <p className="mt-0.5 text-micro text-muted-foreground">{selected.author} · {selected.branch} → {selected.base}{selected.draft ? ` · ${t('pullRequests.draft')}` : ''} · {t(`pullRequests.review.${selected.review}` as MessageKey)}</p>
        <Button variant="link" size="sm" className="mt-1 h-auto px-0" onClick={() => open(selected.url)}><TbExternalLink aria-hidden />{t('pullRequests.openOnGitHub')}</Button>
      </div>
      <section>
        <h4 className="mb-1 text-caption font-medium">{t('pullRequests.checksTitle')}</h4>
        {selected.checkRuns.length === 0 ? <p className="text-caption text-muted-foreground">{t('pullRequests.noChecks')}</p>
          : <ul className="space-y-0.5">{selected.checkRuns.map((check, index) => <li key={`${check.name}:${index}`} className="flex min-w-0 items-center gap-2 text-caption" data-check-state={check.state}>
            <CheckIcon state={check.state} className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{check.name}</span>
            {check.url ? <Button variant="ghost" size="icon-xs" aria-label={t('pullRequests.openCheck', { name: check.name })} onClick={() => open(check.url!)}><TbExternalLink aria-hidden /></Button> : null}
          </li>)}</ul>}
        {selected.checks.failed > 0 ? <Button size="sm" className="mt-2" disabled={busy !== null} onClick={fix} data-pull-request-fix>
          {busy === 'fix' ? <TbLoader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : <TbTool aria-hidden />}{t('pullRequests.fix')}
        </Button> : null}
        {selected.checks.failed > 0 ? <p className="mt-1 text-micro text-muted-foreground">{t('pullRequests.fixHint')}</p> : null}
      </section>
      <section>
        <h4 className="mb-1 text-caption font-medium">{t('pullRequests.reviewTitle')}</h4>
        {selected.reviews.length ? <ul className="mb-2 space-y-0.5 text-micro text-muted-foreground">{selected.reviews.slice(-6).map((review, index) => <li key={index}>{review.author} · {review.state.toLowerCase().replace(/_/gu, ' ')}</li>)}</ul> : null}
        {reviewing ? <div className="space-y-2" data-pull-request-review-form={reviewing}>
          <Textarea value={reviewBody} onChange={(event) => setReviewBody(event.target.value)} rows={4} autoFocus aria-label={t('pullRequests.reviewBody')}
            placeholder={t(reviewing === 'approve' ? 'pullRequests.reviewBodyOptional' : 'pullRequests.reviewBodyRequired')} />
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => { setReviewing(null); setReviewBody('') }}>{t('common.cancel')}</Button>
            <Button size="sm" disabled={busy !== null || (reviewing !== 'approve' && !reviewBody.trim())} onClick={() => setConfirming(true)}>{t(`pullRequests.submit.${reviewing}` as MessageKey)}</Button>
          </div>
        </div> : <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={busy !== null || selected.mine} onClick={() => setReviewing('approve')}>{t('pullRequests.approve')}</Button>
          <Button variant="outline" size="sm" disabled={busy !== null || selected.mine} onClick={() => setReviewing('request-changes')}>{t('pullRequests.requestChanges')}</Button>
          <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => setReviewing('comment')}>{t('pullRequests.comment')}</Button>
        </div>}
        {selected.mine ? <p className="mt-1 text-micro text-muted-foreground">{t('pullRequests.ownPullRequest')}</p> : null}
      </section>
      {selected.body ? <section>
        <h4 className="mb-1 text-caption font-medium">{t('pullRequests.description')}</h4>
        <p className="text-caption whitespace-pre-wrap break-words text-muted-foreground">{selected.body.slice(0, 4_000)}</p>
      </section> : null}
    </div>}

    <AlertDialog open={confirming} onOpenChange={setConfirming}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('pullRequests.confirmTitle', { number: selected?.number ?? 0 })}</AlertDialogTitle>
          <AlertDialogDescription>{t('pullRequests.confirmDescription', { login: status.login ?? '' })}</AlertDialogDescription>
        </AlertDialogHeader>
        {reviewing === 'request-changes' ? <p className="flex items-start gap-2 text-caption text-muted-foreground"><TbAlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />{t('pullRequests.confirmChanges')}</p> : null}
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction onClick={submitReview}>{reviewing ? t(`pullRequests.submit.${reviewing}` as MessageKey) : ''}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
}
