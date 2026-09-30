import * as React from 'react'
import { TbArrowDown, TbArrowUp, TbLoader2 } from 'react-icons/tb'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n'
import { usePiTranscript } from '@/store/pi-rpc'
import { useWorkspaceStore, conversationScopeKey } from '@/store/workspace'
import { searchTranscript } from '@/renderer/conversation-text-search'
import type { ConversationSearchHit, ConversationSearchMatch } from '@/shared/conversation-search'
import type { OfficialPiSessionSummary } from '@/shared/conversation-scope'

interface SearchProps {
  initialScope?: 'current' | 'all'
  onNavigate(entryId: string, query: string, match: ConversationSearchMatch): void
  onOpenResult(session: OfficialPiSessionSummary, entryId: string, query: string, match: ConversationSearchMatch): void
}

export function ConversationSearchDialog({ open, onOpenChange, ...props }: SearchProps & {
  open: boolean; onOpenChange(open: boolean): void
}) {
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="flex max-h-[80vh] flex-col sm:max-w-2xl">
      {open ? <SearchContent {...props} onClose={() => onOpenChange(false)} /> : null}
    </DialogContent>
  </Dialog>
}

function SearchContent({ initialScope = 'current', onClose, onNavigate, onOpenResult }: SearchProps & { onClose(): void }) {
  const t = useT()
  const workspace = useWorkspaceStore()
  const transcript = usePiTranscript()
  const [query, setQuery] = React.useState('')
  const deferred = React.useDeferredValue(query.trim())
  const [scope, setScope] = React.useState<'current' | 'project' | 'all'>(initialScope)
  const [remote, setRemote] = React.useState<ConversationSearchHit[]>([])
  const [remoteOwner, setRemoteOwner] = React.useState('')
  const [progress, setProgress] = React.useState<{ scanned: number; total: number; skipped: number; limited: boolean } | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState(false)
  const [retry, setRetry] = React.useState(0)
  const [selected, setSelected] = React.useState(0)
  const [pageRequest, setPageRequest] = React.useState<{ fingerprint: string; cursor: string } | null>(null)
  const [nextPage, setNextPage] = React.useState<{ fingerprint: string; cursor: string } | null>(null)
  const resultNodes = React.useRef(new Map<number, HTMLButtonElement>())
  const current = React.useMemo(() => searchTranscript(transcript.turns, deferred), [transcript.turns, deferred])
  const scopesKey = JSON.stringify(scope === 'all'
    ? [{ kind: 'projectless' }, ...workspace.recentProjects.filter((project) => project.available).map((project) => ({ kind: 'project', workspaceId: project.id }))]
    : [workspace.activeScope])
  const owner = `${conversationScopeKey(workspace.activeScope)}:${workspace.activeSessionId}`
  const fingerprint = `${scope}:${scopesKey}:${deferred}:${retry}`
  const requestedCursor = pageRequest?.fingerprint === fingerprint ? pageRequest.cursor : undefined

  React.useEffect(() => {
    let cancelled = false
    setRemote([]); setProgress(null); setNextPage(null); setError(false); setLoading(false); setSelected(0)
    if (scope === 'current' || !deferred) return
    const timer = setTimeout(() => {
      setLoading(true)
      void (async () => {
        try {
          if (!window.pipilot) throw new Error('Search unavailable')
          let cursor = requestedCursor
          let count = 0
          do {
            const page = await window.pipilot.conversationSearch.find({ query: deferred, scopes: JSON.parse(scopesKey), ...(cursor ? { cursor } : {}) })
            if (cancelled) return
            setRemoteOwner(fingerprint)
            setRemote((previous) => [...previous, ...page.hits])
            setProgress(page)
            count += page.hits.length
            cursor = page.nextCursor ?? undefined
          } while (cursor && !cancelled && count < 300)
          if (cursor && !cancelled) setNextPage({ fingerprint, cursor })
        } catch { if (!cancelled) setError(true) }
        finally { if (!cancelled) setLoading(false) }
      })()
    }, 250)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [deferred, scope, scopesKey, fingerprint, requestedCursor])
  React.useEffect(() => setSelected(0), [deferred, scope, owner])

  const hits = query.trim() !== deferred ? [] : scope === 'current' ? current.hits : remoteOwner === fingerprint ? remote : []
  const active = Math.min(selected, Math.max(0, hits.length - 1))
  const choose = (index: number) => {
    const hit = hits[index]
    if (!hit) return
    const match: ConversationSearchMatch = { role: 'session' in hit ? hit.role : hit.kind, toolCallId: hit.toolCallId, snippet: hit.snippet, matchStart: hit.matchStart, matchLength: hit.matchLength }
    if ('session' in hit) onOpenResult(hit.session, hit.anchorEntryId, deferred, match)
    else onNavigate(hit.anchorEntryId, deferred, match)
    onClose()
  }
  const move = (delta: number) => {
    const next = Math.max(0, Math.min(hits.length - 1, active + delta))
    setSelected(next)
    resultNodes.current.get(next)?.scrollIntoView({ block: 'nearest' })
  }
  return <>
    <DialogHeader><DialogTitle>{t('conversationSearch.title')}</DialogTitle><DialogDescription>{t('conversationSearch.description')}</DialogDescription></DialogHeader>
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label={t('conversationSearch.scope')}>
      {(['current', 'project', 'all'] as const).map((value) => <Button key={value} variant={scope === value ? 'secondary' : 'ghost'} size="xs" aria-pressed={scope === value} onClick={() => setScope(value)}>{t(`conversationSearch.${value}`)}</Button>)}
    </div>
    <div className="flex items-center gap-1">
      <Input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} aria-label={t('conversationSearch.query')} placeholder={t('conversationSearch.query')} maxLength={256}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); move(event.key === 'ArrowDown' ? 1 : -1) }
          if (event.key === 'Enter') { event.preventDefault(); choose(active) }
        }} />
      <Button variant="ghost" size="icon-sm" disabled={!hits.length} onClick={() => move(-1)} aria-label={t('conversationSearch.previous')}><TbArrowUp aria-hidden /></Button>
      <Button variant="ghost" size="icon-sm" disabled={!hits.length} onClick={() => move(1)} aria-label={t('conversationSearch.next')}><TbArrowDown aria-hidden /></Button>
    </div>
    <div role="status" className="flex items-center gap-2 text-caption text-muted-foreground">
      {loading ? <TbLoader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> : null}
      {t('conversationSearch.count', { count: hits.length })}
      {progress ? <span>{t('conversationSearch.progress', { scanned: progress.scanned, total: progress.total })}</span> : null}
    </div>
    {error ? <div role="alert" className="flex items-center gap-2 text-caption text-destructive">{t('conversationSearch.error')}<Button size="xs" variant="ghost" onClick={() => setRetry((value) => value + 1)}>{t('common.retry')}</Button></div> : null}
    {(scope === 'current' ? current.limited : progress?.limited || progress?.skipped) ? <p className="text-caption text-muted-foreground">{t('conversationSearch.limited')}</p> : null}
    <div className="scroll-slim min-h-0 space-y-1 overflow-auto" aria-label={t('conversationSearch.results')}>
      {hits.map((hit, index) => <button key={'session' in hit ? `${hit.session.catalogId ?? hit.session.selectionToken}:${hit.entryId}:${index}` : hit.id}
        ref={(node) => { if (node) resultNodes.current.set(index, node); else resultNodes.current.delete(index) }}
        className={`block w-full rounded-md border px-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-ring ${index === active ? 'border-border bg-accent' : 'border-transparent hover:bg-accent/50'}`}
        aria-current={index === active || undefined} onFocus={() => setSelected(index)} onClick={() => choose(index)}>
        <span className="mb-1 block truncate text-micro text-muted-foreground">{'session' in hit ? hit.session.name || hit.session.preview || t('sidebar.session.untitled') : t(`conversationSearch.role.${hit.kind}`)}</span>
        <span className="whitespace-pre-wrap break-words text-caption">{hit.snippet.slice(0, hit.matchStart)}<mark className="rounded-sm bg-primary/20 text-foreground">{hit.snippet.slice(hit.matchStart, hit.matchStart + hit.matchLength)}</mark>{hit.snippet.slice(hit.matchStart + hit.matchLength)}</span>
      </button>)}
      {deferred && !loading && !error && !hits.length ? <p className="py-8 text-center text-caption text-muted-foreground">{t('conversationSearch.empty')}</p> : null}
    </div>
    {scope !== 'current' && nextPage ? <Button variant="secondary" size="sm" onClick={() => setPageRequest(nextPage)}>{t('conversationSearch.nextPage')}</Button> : null}
  </>
}
