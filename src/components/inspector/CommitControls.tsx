import * as React from 'react'
import { TbArrowUp, TbCheck, TbChevronDown, TbExternalLink, TbGitBranch, TbGitCommit, TbGitPullRequest, TbLoader2, TbRefresh, TbSparkles } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useLocale, useT, type MessageKey } from '@/i18n'
import { cn } from '@/lib/utils'
import type { WorkspaceCommitRequest, WorkspaceCommitResult, WorkspaceGitStatus } from '@/shared/workspace-content'

type NextStep = WorkspaceCommitRequest['next']

export interface CommitModel { providerId: string; modelId: string }

const NEXT_STEPS: readonly { next: NextStep; label: MessageKey; icon: React.ReactNode }[] = [
  { next: 'commit', label: 'commit.next.commit', icon: <TbGitCommit aria-hidden /> },
  { next: 'push', label: 'commit.next.push', icon: <TbArrowUp aria-hidden /> },
  { next: 'pull-request', label: 'commit.next.pullRequest', icon: <TbGitPullRequest aria-hidden /> },
]

/** A branch name for a pull request from the default branch: `pipilot/<summary>`. */
export function suggestedBranchName(message: string, now = new Date()) {
  const slug = (message.split('\n')[0] ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 48).replace(/-+$/u, '')
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`
  return `pipilot/${slug || `changes-${stamp}`}`
}

function errorText(error: unknown) {
  const value = error as { code?: unknown; message?: unknown } | null
  return { code: typeof value?.code === 'string' ? value.code : '', message: typeof value?.message === 'string' ? value.message : '' }
}

/**
 * Codex's commit flow: a message (written by the conversation's model, then
 * yours to edit), whether unstaged changes go in, and what happens next —
 * commit, commit and push, or commit and open a pull request.
 */
function CommitPanel({ workspaceId, model, initialNext, onDone, onClose }: {
  workspaceId: string
  model: CommitModel | null
  initialNext: NextStep
  onDone(result: WorkspaceCommitResult): void
  onClose(): void
}) {
  const t = useT()
  const locale = useLocale()
  const [status, setStatus] = React.useState<WorkspaceGitStatus | null>(null)
  const [message, setMessage] = React.useState('')
  const [generating, setGenerating] = React.useState(false)
  const [generateFailed, setGenerateFailed] = React.useState(false)
  const [includeUnstaged, setIncludeUnstaged] = React.useState(true)
  const [next, setNext] = React.useState<NextStep>(initialNext)
  const [branch, setBranch] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [result, setResult] = React.useState<WorkspaceCommitResult | null>(null)
  const alive = React.useRef(true)
  const generation = React.useRef(0)
  const edited = React.useRef(false)
  React.useEffect(() => () => { alive.current = false }, [])

  const forcedUnstaged = Boolean(status && status.staged === 0 && status.unstaged > 0)
  const include = forcedUnstaged || includeUnstaged
  const generate = React.useCallback(async (includeAll: boolean) => {
    if (!model) return
    const attempt = ++generation.current
    setGenerating(true)
    setGenerateFailed(false)
    try {
      const suggested = await window.pipilot!.changes.suggestMessage(workspaceId, { ...model, includeUnstaged: includeAll, locale: locale.startsWith('zh') ? 'zh-CN' : 'en-US' })
      if (alive.current && attempt === generation.current && !edited.current) setMessage(suggested)
    } catch {
      if (alive.current && attempt === generation.current) setGenerateFailed(true)
    } finally {
      if (alive.current && attempt === generation.current) setGenerating(false)
    }
  }, [locale, model, workspaceId])

  React.useEffect(() => {
    let current = true
    void window.pipilot!.changes.status(workspaceId).then((value) => {
      if (!current) return
      setStatus(value)
      const all = (value.staged === 0 && value.unstaged > 0) || includeUnstaged
      if (value.staged + (all ? value.unstaged : 0) > 0) void generate(all)
    }, () => { if (current) setStatus(null) })
    return () => { current = false }
  // Read once when the panel opens.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId])
  React.useEffect(() => {
    if (status?.onDefaultBranch && next === 'pull-request' && !branch) setBranch(suggestedBranchName(message))
  }, [branch, message, next, status?.onDefaultBranch])

  const nothing = status ? status.staged + (include ? status.unstaged : 0) === 0 : false
  const remoteMissing = status ? !status.hasRemote : false
  const unavailable = (step: NextStep): MessageKey | null => step === 'commit' ? null
    : remoteMissing ? 'commit.noRemote'
      : step === 'pull-request' && !status?.ghAvailable ? 'commit.noGh' : null
  const newBranch = next === 'pull-request' && status?.onDefaultBranch ? branch.trim() : ''

  const submit = async (step: NextStep) => {
    if (!message.trim() || busy || !status) return
    setBusy(true)
    setError(null)
    try {
      const done = await window.pipilot!.changes.commit(workspaceId, {
        message: message.trim(), includeUnstaged: include, next: step, ...(step === 'pull-request' && newBranch ? { branch: newBranch } : {}),
      })
      if (!alive.current) return
      setResult(done)
      onDone(done)
    } catch (reason) {
      const { code, message: detail } = errorText(reason)
      if (alive.current) setError(code === 'WORKSPACE_NOTHING_TO_COMMIT' ? t('commit.nothing')
        : code === 'WORKSPACE_BRANCH_EXISTS' ? t('commit.branchExists', { branch: newBranch })
          : `${t('commit.failed')}${detail ? `\n${detail}` : ''}`)
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  if (result) {
    return <div className="space-y-3 p-4" data-commit-result>
      <p className="flex items-center gap-2 text-body font-medium"><TbCheck className="size-4 text-success" aria-hidden />{t('commit.done', { sha: result.sha.slice(0, 7) })}</p>
      <ul className="space-y-1.5 text-caption text-muted-foreground">
        {result.branch ? <li className="flex items-center gap-1.5"><TbGitBranch className="size-3.5" aria-hidden /><span className="font-mono">{result.branch}</span></li> : null}
        {result.pushed ? <li>{t('commit.pushed')}</li> : null}
        {result.pushError ? <li className="text-destructive"><p>{t('commit.pushFailed')}</p><pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono text-micro">{result.pushError}</pre></li> : null}
        {result.pullRequestError ? <li className="text-destructive"><p>{t('commit.prFailed')}</p><pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono text-micro">{result.pullRequestError}</pre></li> : null}
      </ul>
      <div className="flex justify-end gap-2">
        {result.pullRequestUrl ? <Button size="sm" variant="secondary" onClick={() => void window.pipilot?.shell.openExternal(result.pullRequestUrl!)}><TbExternalLink aria-hidden />{t('commit.openPr')}</Button> : null}
        <Button size="sm" onClick={onClose}>{t('common.done')}</Button>
      </div>
    </div>
  }

  const stepInfo = NEXT_STEPS.find((item) => item.next === next)!
  const blocked = unavailable(next)
  return <form className="space-y-3 p-4" data-commit-panel onSubmit={(event) => { event.preventDefault(); void submit(next) }}>
    <header className="flex items-center gap-2">
      <h2 className="min-w-0 flex-1 text-body font-semibold">{t('commit.title')}</h2>
      {status?.branch ? <span className="flex min-w-0 items-center gap-1 rounded-full bg-fill px-2 py-0.5 text-micro text-muted-foreground"><TbGitBranch className="size-3 shrink-0" aria-hidden /><span className="truncate font-mono">{status.branch}</span></span> : null}
    </header>
    {status?.detached ? <p role="alert" className="text-caption text-warning">{t('commit.detached')}</p> : null}
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <label htmlFor={`commit-message-${workspaceId}`} className="min-w-0 flex-1 text-caption font-medium">{t('commit.message')}</label>
        {model ? <Tooltip>
          <TooltipTrigger asChild>
            <Button type="button" variant="ghost" size="icon-xs" disabled={generating || nothing} aria-label={t('commit.regenerate')}
              onClick={() => { edited.current = false; void generate(include) }}>
              {generating ? <TbLoader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : message ? <TbRefresh aria-hidden /> : <TbSparkles aria-hidden />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('commit.regenerate')}</TooltipContent>
        </Tooltip> : null}
      </div>
      <Textarea id={`commit-message-${workspaceId}`} value={message} maxLength={20_000} disabled={busy} autoFocus
        placeholder={generating ? t('commit.generating') : t('commit.messagePlaceholder')}
        onChange={(event) => { edited.current = true; setMessage(event.target.value) }}
        onKeyDown={(event) => { if (!event.nativeEvent.isComposing && event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void submit(next) } }}
        className="max-h-60 min-h-24 resize-y rounded-[10px] font-mono text-caption" />
      {generateFailed ? <p className="text-micro text-muted-foreground">{t('commit.generateFailed')}</p> : !model ? <p className="text-micro text-muted-foreground">{t('commit.noModel')}</p> : null}
    </div>
    {status && status.unstaged > 0 ? <label className="flex items-start gap-2.5 text-caption">
      <Switch checked={include} disabled={forcedUnstaged || busy} onCheckedChange={setIncludeUnstaged} className="mt-px" />
      <span className="min-w-0 flex-1">
        <span className="block">{t('commit.includeUnstaged')}</span>
        <span className="block text-micro text-muted-foreground">{forcedUnstaged ? t('commit.includeUnstagedForced') : t('commit.counts', { staged: status.staged, unstaged: status.unstaged })}</span>
      </span>
    </label> : status ? <p className="text-micro text-muted-foreground">{t('commit.counts', { staged: status.staged, unstaged: status.unstaged })}</p> : null}
    {next === 'pull-request' && status?.onDefaultBranch ? <div className="space-y-1">
      <label htmlFor={`commit-branch-${workspaceId}`} className="text-caption font-medium">{t('commit.newBranch')}</label>
      <Input id={`commit-branch-${workspaceId}`} value={branch} onChange={(event) => setBranch(event.target.value)} className="h-7 font-mono text-caption" spellCheck={false} />
      <p className="text-micro text-muted-foreground">{t('commit.newBranchHint', { branch: status.branch })}</p>
    </div> : null}
    {nothing && status ? <p role="status" className="text-caption text-muted-foreground">{t('commit.nothing')}</p> : null}
    {blocked ? <p role="status" className="text-micro text-muted-foreground">{t(blocked)}</p> : null}
    {error ? <pre role="alert" className="max-h-36 overflow-auto whitespace-pre-wrap break-words rounded-[8px] bg-destructive/8 p-2 font-sans text-caption text-destructive">{error}</pre> : null}
    <footer className="flex items-center justify-end gap-2 pt-1">
      <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
      <div className="flex">
        <Button type="submit" size="sm" className="rounded-r-none" disabled={busy || !status || nothing || !message.trim() || Boolean(blocked) || status.detached || (next === 'pull-request' && status.onDefaultBranch && !newBranch)}>
          {busy ? <TbLoader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : stepInfo.icon}
          {t(stepInfo.label)}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" size="sm" className="w-7 rounded-l-none border-l border-white/25 px-0" disabled={busy} aria-label={t('commit.chooseNext')}><TbChevronDown aria-hidden /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-52">
            {NEXT_STEPS.map((item) => {
              const reason = unavailable(item.next)
              return <DropdownMenuItem key={item.next} disabled={Boolean(reason)} title={reason ? t(reason) : undefined} onSelect={() => setNext(item.next)}>
                {item.icon}<span className="flex-1">{t(item.label)}</span>{item.next === next ? <TbCheck className="text-muted-foreground" aria-hidden /> : null}
              </DropdownMenuItem>
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </footer>
  </form>
}

/** The toolbar's (or summary's) Commit button and its panel. */
export function CommitButton({ workspaceId, model, variant = 'toolbar', disabled, onCommitted }: {
  workspaceId: string
  model: CommitModel | null
  variant?: 'toolbar' | 'summary'
  disabled?: boolean
  onCommitted?: (result: WorkspaceCommitResult) => void
}) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const [next, setNext] = React.useState<NextStep>('commit')
  const [session, setSession] = React.useState(0)
  const show = (step: NextStep) => { setNext(step); setSession((value) => value + 1); setOpen(true) }
  return <Popover open={open} onOpenChange={setOpen}>
    <div className={cn('flex shrink-0 items-center', variant === 'summary' && 'w-full')} data-commit-button>
      <PopoverTrigger asChild>
        <Button variant={variant === 'summary' ? 'secondary' : 'ghost'} size={variant === 'summary' ? 'sm' : 'xs'} disabled={disabled}
          onClick={(event) => { event.preventDefault(); if (open) setOpen(false); else show('commit') }}
          className={cn(variant === 'toolbar' ? 'h-7 gap-1.5 rounded-r-none px-2 text-caption' : 'flex-1 rounded-r-none')}>
          <TbGitCommit aria-hidden />{t('commit.button')}
        </Button>
      </PopoverTrigger>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant={variant === 'summary' ? 'secondary' : 'ghost'} size={variant === 'summary' ? 'sm' : 'xs'} disabled={disabled} aria-label={t('commit.chooseNext')}
            className={cn('rounded-l-none', variant === 'toolbar' ? 'h-7 w-5 px-0 text-muted-foreground' : 'w-8 border-l border-border px-0')}>
            <TbChevronDown className="size-3" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52">
          {NEXT_STEPS.map((item) => <DropdownMenuItem key={item.next} onSelect={() => show(item.next)}>{item.icon}{t(item.label)}</DropdownMenuItem>)}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
    <PopoverContent align="end" sideOffset={8} className="w-[400px] max-w-[calc(100vw-24px)] p-0" onOpenAutoFocus={(event) => event.preventDefault()}>
      <CommitPanel key={session} workspaceId={workspaceId} model={model} initialNext={next} onDone={(result) => onCommitted?.(result)} onClose={() => setOpen(false)} />
    </PopoverContent>
  </Popover>
}
