import * as React from 'react'
import { TbCheck, TbColumns3, TbFileDiff, TbLoader2, TbMessage, TbScale, TbTrash, TbX } from 'react-icons/tb'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { MarkdownContent } from '@/components/chat/markdown/MarkdownContent'
import { SettingsSheet } from '@/components/settings/kit'
import { useT, type MessageKey } from '@/i18n'
import { cn } from '@/lib/utils'
import type { Comparison, ComparisonRun } from '@/shared/comparisons'
import { selectComparison, useComparisons, useSelectedComparison } from '@/store/comparisons'

function errorText(error: unknown) {
  return error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error)
}

function PatchView({ patch }: { patch: string }) {
  return <pre className="scroll-slim max-h-[60vh] overflow-auto rounded-[8px] bg-surface-inset p-2 font-mono text-micro leading-relaxed">
    {patch.split('\n').map((line, index) => <span key={index} className={cn('block whitespace-pre',
      line.startsWith('+') && !line.startsWith('+++') ? 'bg-success/10 text-success' : line.startsWith('-') && !line.startsWith('---') ? 'bg-destructive/10 text-destructive'
        : line.startsWith('@@') ? 'text-primary' : line.startsWith('diff --git') ? 'mt-2 font-semibold text-foreground' : 'text-muted-foreground')}>{line || ' '}</span>)}
  </pre>
}

function RunColumn({ comparison, run, index, onDiff, onApply, onOpen }: {
  comparison: Comparison; run: ComparisonRun; index: number
  onDiff(): void; onApply(): void; onOpen(): void
}) {
  const t = useT()
  const applied = comparison.appliedIndex === index
  return <section className="flex min-h-0 min-w-0 flex-col rounded-[12px] border border-border/70 bg-surface" data-comparison-run={index} data-comparison-status={run.status}>
    <header className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2">
      {run.status === 'running' || run.status === 'preparing' ? <TbLoader2 className="size-3.5 shrink-0 animate-spin text-primary motion-reduce:animate-none" aria-hidden />
        : run.status === 'failed' ? <TbX className="size-3.5 shrink-0 text-destructive" aria-hidden /> : <TbCheck className="size-3.5 shrink-0 text-success" aria-hidden />}
      <span className="min-w-0 flex-1 truncate text-app font-semibold" title={`${run.model.provider} / ${run.model.modelId}`}>{run.model.name || run.model.modelId}</span>
      {applied ? <span className="shrink-0 rounded-full bg-success/15 px-2 py-px text-micro text-success">{t('compare.applied')}</span> : null}
    </header>
    <p className="shrink-0 px-3 pt-2 text-micro text-muted-foreground">
      {t(`compare.status.${run.status}` as MessageKey)}
      {run.files !== undefined ? ` · ${t('compare.changes', { files: run.files, added: run.additions ?? 0, deleted: run.deletions ?? 0 })}` : ''}
    </p>
    {run.error ? <p role="alert" className="mx-3 mt-2 rounded-[8px] bg-destructive/8 px-2 py-1.5 text-caption text-destructive">{run.error}</p> : null}
    <div className="scroll-slim min-h-24 flex-1 overflow-y-auto px-3 py-2 [&_.md-body]:text-caption">
      {run.answer ? <MarkdownContent markdown={run.answer} /> : <p className="text-caption text-muted-foreground">{t(run.status === 'done' ? 'compare.noAnswer' : 'compare.waiting')}</p>}
    </div>
    <footer className="flex shrink-0 flex-wrap gap-1.5 border-t border-border/60 px-3 py-2">
      <Button variant="ghost" size="sm" disabled={!run.sessionId || !run.workspaceId} onClick={onOpen}><TbMessage aria-hidden />{t('compare.openConversation')}</Button>
      <Button variant="ghost" size="sm" disabled={run.status !== 'done' || !run.files} onClick={onDiff} data-comparison-diff><TbFileDiff aria-hidden />{t('compare.viewChanges')}</Button>
      <Button size="sm" className="ml-auto" disabled={run.status !== 'done' || !run.files} onClick={onApply} data-comparison-apply>{t('compare.apply')}</Button>
    </footer>
  </section>
}

/**
 * The project's model comparisons; one is shown with its models side by side.
 * Applying copies a model's changes into the project's own working tree.
 */
export function ComparisonPanel({ projectId, onOpenConversation }: {
  projectId: string
  onOpenConversation(workspaceId: string, sessionId: string): void
}) {
  const t = useT()
  const comparisons = useComparisons(projectId)
  const selectedId = useSelectedComparison()
  const comparison = comparisons.find((candidate) => candidate.id === selectedId) ?? comparisons[0] ?? null
  const [diff, setDiff] = React.useState<{ index: number; patch: string; truncated: boolean } | null>(null)
  const [applying, setApplying] = React.useState<number | null>(null)
  const [removing, setRemoving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const api = window.pipilot!.comparisons

  if (!comparison) return <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
    <TbColumns3 className="size-8 text-muted-foreground/60" aria-hidden />
    <p className="max-w-xs text-caption text-muted-foreground">{t('compare.empty')}</p>
  </div>

  const runningCount = comparison.runs.filter((run) => run.status === 'running' || run.status === 'preparing').length
  return <div className="flex h-full min-h-0 flex-col" data-comparison={comparison.id}>
    <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2">
      <select className="mac-select min-w-0 flex-1" value={comparison.id} aria-label={t('compare.choose')} onChange={(event) => selectComparison(event.target.value)}>
        {comparisons.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.prompt.replace(/\s+/gu, ' ').slice(0, 80)}</option>)}
      </select>
      <Button variant="ghost" size="icon-xs" aria-label={t('compare.remove')} title={t('compare.remove')} onClick={() => setRemoving(true)}><TbTrash aria-hidden /></Button>
    </div>
    <div className="shrink-0 px-3 pt-2">
      <p className="line-clamp-2 text-caption" title={comparison.prompt}>{comparison.prompt}</p>
      <p className="mt-0.5 text-micro text-muted-foreground">{t('compare.from', { branch: comparison.baseBranch })}{runningCount ? ` · ${t('compare.running', { count: runningCount })}` : ''}</p>
    </div>
    {error ? <p role="alert" className="mx-3 mt-2 rounded-[8px] bg-destructive/8 px-3 py-2 text-caption whitespace-pre-wrap text-destructive">{error}</p> : null}
    {comparison.judge ? <section className="mx-3 mt-2 rounded-[12px] bg-primary/6 px-3 py-2" data-comparison-judge={comparison.judge.status}>
      <p className="flex items-center gap-1.5 text-caption font-medium"><TbScale className="size-3.5" aria-hidden />{t('compare.judgeSays', { model: comparison.judge.model.name })}
        {comparison.judge.status === 'running' || comparison.judge.status === 'waiting' ? <TbLoader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> : null}</p>
      {comparison.judge.text ? <div className="scroll-slim mt-1 max-h-40 overflow-y-auto [&_.md-body]:text-caption"><MarkdownContent markdown={comparison.judge.text} /></div>
        : <p className="mt-1 text-caption text-muted-foreground">{comparison.judge.error ?? t(`compare.judge.${comparison.judge.status}` as MessageKey)}</p>}
    </section> : null}
    <div className="grid min-h-0 flex-1 auto-rows-[minmax(280px,1fr)] gap-3 overflow-y-auto p-3 [grid-template-columns:repeat(auto-fit,minmax(240px,1fr))]">
      {comparison.runs.map((run, index) => <RunColumn key={index} comparison={comparison} run={run} index={index}
        onOpen={() => run.workspaceId && run.sessionId && onOpenConversation(run.workspaceId, run.sessionId)}
        onDiff={() => { setError(null); void api.diff(comparison.id, index).then((result) => setDiff({ index, ...result }), (caught: unknown) => setError(errorText(caught))) }}
        onApply={() => setApplying(index)} />)}
    </div>

    <SettingsSheet open={diff !== null} onOpenChange={(open) => { if (!open) setDiff(null) }} wide
      title={t('compare.changesOf', { model: diff ? comparison.runs[diff.index]?.model.name ?? '' : '' })} description={diff?.truncated ? t('compare.truncated') : undefined}>
      {diff ? <PatchView patch={diff.patch} /> : null}
    </SettingsSheet>
    <AlertDialog open={applying !== null} onOpenChange={(open) => { if (!open) setApplying(null) }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('compare.applyTitle', { model: applying !== null ? comparison.runs[applying]?.model.name ?? '' : '' })}</AlertDialogTitle>
          <AlertDialogDescription>{t('compare.applyDescription')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction onClick={() => {
            const index = applying
            setApplying(null)
            if (index !== null) void api.apply(comparison.id, index).then(() => setError(null), (caught: unknown) => setError(errorText(caught)))
          }}>{t('compare.apply')}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <AlertDialog open={removing} onOpenChange={setRemoving}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('compare.removeTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('compare.removeDescription')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => { void api.remove(comparison.id).then(() => selectComparison(null), (caught: unknown) => setError(errorText(caught))) }}>{t('compare.remove')}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
}

/** The sidebar's comparisons of the open project: each opens the Compare tab. */
export function ComparisonSidebarSection({ projectId, onOpen }: { projectId: string | null; onOpen(id: string): void }) {
  const t = useT()
  const comparisons = useComparisons(projectId)
  if (!projectId || comparisons.length === 0) return null
  return <section aria-labelledby="sidebar-comparisons-heading" className="mb-3" data-sidebar-comparisons>
    <div className="mb-px flex h-[26px] items-center pr-1 pl-2.5"><h2 id="sidebar-comparisons-heading" className="text-micro font-semibold text-muted-foreground">{t('compare.sidebar')}</h2></div>
    <ul>
      {comparisons.slice(0, 5).map((comparison) => {
        const running = comparison.runs.some((run) => run.status === 'running' || run.status === 'preparing')
        return <li key={comparison.id}>
          <button type="button" onClick={() => onOpen(comparison.id)} data-sidebar-comparison={comparison.id}
            className="flex h-(--row-h) w-full min-w-0 items-center gap-2 rounded-[8px] px-2.5 text-left text-app outline-none hover:bg-fill focus-visible:focus-ring">
            {running ? <TbLoader2 className="size-3.5 shrink-0 animate-spin text-primary motion-reduce:animate-none" aria-hidden /> : <TbColumns3 className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
            <span className="min-w-0 flex-1 truncate">{comparison.prompt.replace(/\s+/gu, ' ')}</span>
            <span className="shrink-0 text-micro text-muted-foreground">{comparison.runs.length}</span>
          </button>
        </li>
      })}
    </ul>
  </section>
}
