import * as React from 'react'
import { TbArrowDown, TbArrowUp, TbCheck, TbCopy, TbSearch, TbTextWrap } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import { findShellLogMatches, MAX_LOG_MATCHES, projectShellLog, type ShellLogColor } from '@/renderer/pi-rpc/shell-log'
import { MarkdownContent } from './markdown/MarkdownContent'
import { useFollowingViewport } from './useFollowingViewport'

interface ShellLogViewerProps {
  label: string
  source: string
  sourceTruncated?: boolean
  tone?: 'default' | 'error'
  live?: boolean
  allowMarkdown?: boolean
}

const sgrColorClass: Record<ShellLogColor, string> = {
  black: 'text-muted-foreground', red: 'text-destructive', green: 'text-success', yellow: 'text-warning',
  blue: 'text-blue-600 dark:text-blue-400', magenta: 'text-fuchsia-600 dark:text-fuchsia-400',
  cyan: 'text-cyan-700 dark:text-cyan-400', white: 'text-foreground',
}

/** A bounded output viewport with explicit reading/following intent. */
export function ShellLogViewer({ label, source, sourceTruncated, tone, live = false, allowMarkdown = false }: ShellLogViewerProps) {
  const t = useT()
  const ownerKey = React.useId()
  const initiallyLive = React.useRef(live)
  const latestOutput = React.useMemo(() => projectShellLog(source), [source])
  const [output, setOutput] = React.useState(latestOutput)
  const [view, setView] = React.useState<'formatted' | 'raw'>(allowMarkdown ? 'formatted' : 'raw')
  const [wrap, setWrap] = React.useState(true)
  const [query, setQuery] = React.useState('')
  const [activeMatch, setActiveMatch] = React.useState(0)
  const [copyState, setCopyState] = React.useState<'idle' | 'copied' | 'failed'>('idle')
  const manualView = React.useRef(false)
  const copyTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const matchRef = React.useRef<HTMLElement>(null)
  const { scrollRef, contentRef, scrollProps, following, scrollToLatest, pauseFollowing } = useFollowingViewport({
    ownerKey, revision: output.text, smooth: false, ready: initiallyLive.current,
  })
  const matches = React.useMemo(() => findShellLogMatches(output.text, query), [output.text, query])
  const selectedMatch = matches.length ? Math.min(activeMatch, matches.length - 1) : 0
  const formatted = allowMarkdown && view === 'formatted' && !query
  const newOutputWaiting = !following && latestOutput.text !== output.text

  // Keep the visible snapshot still while reading. Otherwise a bounded tail
  // can remove the very lines the user scrolled up to inspect.
  React.useLayoutEffect(() => {
    if (following) setOutput(latestOutput)
  }, [following, latestOutput])
  React.useEffect(() => {
    if (!manualView.current) setView(allowMarkdown ? 'formatted' : 'raw')
  }, [allowMarkdown])
  React.useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current) }, [])
  React.useLayoutEffect(() => {
    const match = matchRef.current
    const viewport = scrollRef.current
    if (!query || !match || !viewport) return
    viewport.scrollTo({
      top: Math.max(0, viewport.scrollTop + match.getBoundingClientRect().top - viewport.getBoundingClientRect().top - viewport.clientHeight / 2),
      behavior: 'auto',
    })
  }, [query, selectedMatch, matches, scrollRef])

  const copy = async () => {
    if (copyTimer.current) clearTimeout(copyTimer.current)
    try {
      await navigator.clipboard.writeText(source)
      setCopyState('copied')
    } catch { setCopyState('failed') }
    copyTimer.current = setTimeout(() => setCopyState('idle'), 1_400)
  }
  const moveMatch = (direction: number) => {
    pauseFollowing()
    if (matches.length) setActiveMatch((selectedMatch + direction + matches.length) % matches.length)
  }
  const highlighted = React.useMemo(() => {
    if (!matches.length && !output.styles.length) return output.text
    const nodes: React.ReactNode[] = []
    let styleIndex = 0
    const styledRange = (start: number, end: number) => {
      const range: React.ReactNode[] = []
      let position = start
      while (position < end) {
        const span = output.styles[styleIndex]
        if (!span || span.start >= end) { range.push(output.text.slice(position, end)); break }
        if (span.end <= position) { styleIndex += 1; continue }
        if (span.start > position) { range.push(output.text.slice(position, span.start)); position = span.start }
        const next = Math.min(span.end, end)
        range.push(<span key={position} className={cn(span.style.color && sgrColorClass[span.style.color],
          span.style.bold && 'font-semibold', span.style.dim && 'opacity-60', span.style.italic && 'italic',
          span.style.underline && 'underline')}>{output.text.slice(position, next)}</span>)
        position = next
        if (position >= span.end) styleIndex += 1
      }
      return range
    }
    let previous = 0
    matches.forEach((match, index) => {
      nodes.push(...styledRange(previous, match.start))
      nodes.push(<mark key={match.start} ref={index === selectedMatch ? matchRef : undefined}
        className={cn('rounded-sm bg-warning/20 text-inherit', index === selectedMatch && 'bg-warning/40 outline outline-warning/50')}>
        {styledRange(match.start, match.end)}
      </mark>)
      previous = match.end
    })
    nodes.push(...styledRange(previous, output.text.length))
    return nodes
  }, [matches, output, selectedMatch])

  return <section className="shell-log-viewer min-w-0 overflow-hidden rounded-lg border border-border/70 bg-background" data-tool-evidence="auto" data-shell-log-viewer>
    <header className="flex min-h-8 flex-wrap items-center gap-1.5 border-b border-border/60 px-2.5 py-1">
      <h4 className="min-w-0 flex-1 text-micro font-medium text-muted-foreground">{label}</h4>
      {live ? <span className="text-micro text-muted-foreground" role="status">{t(following ? 'tool.redesign.live' : 'tool.redesign.paused')}</span> : null}
      {allowMarkdown ? <div className="flex items-center gap-0.5" aria-label={t('tool.outputView')}>
        {(['formatted', 'raw'] as const).map((candidate) => <Button key={candidate} variant="ghost" size="xs"
          className="h-6 px-1.5 text-micro" aria-pressed={!query && view === candidate}
          onClick={() => { manualView.current = true; setQuery(''); setView(candidate); pauseFollowing() }}>
          {t(candidate === 'formatted' ? 'tool.outputFormatted' : 'tool.outputRaw')}
        </Button>)}
      </div> : null}
      <Button variant="ghost" size="icon-xs" aria-label={t('tool.redesign.wrap')} aria-pressed={wrap}
        disabled={formatted} onClick={() => setWrap((value) => !value)}><TbTextWrap aria-hidden /></Button>
      <Button variant="ghost" size="icon-xs" aria-label={t(copyState === 'copied' ? 'tool.copied' : 'tool.copy')}
        onClick={() => void copy()}>{copyState === 'copied' ? <TbCheck aria-hidden /> : <TbCopy aria-hidden />}</Button>
    </header>
    <div className="flex min-w-0 items-center gap-1.5 border-b border-border/50 px-2.5 py-1">
      <TbSearch className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <input type="search" value={query} maxLength={256} placeholder={t('tool.redesign.search')}
        aria-label={t('tool.redesign.search')} className="h-6 min-w-0 flex-1 bg-transparent text-caption outline-none placeholder:text-muted-foreground/70"
        onChange={(event) => { setQuery(event.target.value); setActiveMatch(0); pauseFollowing() }}
        onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); moveMatch(event.shiftKey ? -1 : 1) } }} />
      {query ? <span className="shrink-0 text-micro tabular-nums text-muted-foreground" role="status">
        {matches.length ? `${selectedMatch + 1}/${matches.length}${matches.length === MAX_LOG_MATCHES ? '+' : ''}` : t('tool.redesign.noMatches')}
      </span> : null}
      <Button variant="ghost" size="icon-xs" disabled={!matches.length} aria-label={t('tool.redesign.previousMatch')} onClick={() => moveMatch(-1)}><TbArrowUp aria-hidden /></Button>
      <Button variant="ghost" size="icon-xs" disabled={!matches.length} aria-label={t('tool.redesign.nextMatch')} onClick={() => moveMatch(1)}><TbArrowDown aria-hidden /></Button>
    </div>
    <div ref={scrollRef} {...scrollProps} tabIndex={0} role="region" aria-label={label}
      onPointerDownCapture={() => pauseFollowing()}
      onPointerDown={(event) => { if (initiallyLive.current) scrollProps.onPointerDown?.(event) }}
      className="scroll-slim relative max-h-[min(20rem,42vh)] min-w-0 overflow-auto px-3 py-2 outline-none focus-visible:focus-ring" data-shell-log-output>
      <div ref={contentRef} className="min-w-0">
        {formatted ? <MarkdownContent markdown={output.text} streaming={live} /> : <pre className={cn(
          'm-0 min-w-0 font-mono text-caption leading-relaxed text-foreground/85',
          wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre', tone === 'error' && 'text-destructive',
        )}><code>{highlighted}</code></pre>}
      </div>
    </div>
    {(!following || output.truncated || sourceTruncated || copyState === 'failed') ? <footer className="flex min-w-0 items-center gap-2 border-t border-border/60 px-2.5 py-1">
      <span className="min-w-0 flex-1 text-micro text-muted-foreground" role="status">
        {copyState === 'failed' ? t('tool.redesign.copyFailed') : newOutputWaiting ? t('tool.redesign.newOutput') : output.truncated || sourceTruncated ? t('tool.outputTruncated') : t('tool.redesign.paused')}
      </span>
      {!following ? <Button variant="ghost" size="xs" className="h-6 text-micro" onClick={() => { setQuery(''); scrollToLatest(false) }}>
        <TbArrowDown aria-hidden />{t('tool.redesign.follow')}
      </Button> : null}
    </footer> : null}
  </section>
}
