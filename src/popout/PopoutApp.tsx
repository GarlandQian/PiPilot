import * as React from 'react'
import { TbAppWindow, TbArrowUp, TbLoader2, TbPin, TbPinFilled, TbPlayerStopFilled, TbTool } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { MarkdownContent } from '@/components/chat/markdown/MarkdownContent'
import { useT } from '@/i18n'
import { useApplySettings } from '@/lib/theme'
import { cn } from '@/lib/utils'
import { isComposerSendShortcut } from '@/renderer/composer/composer-submission'
import type { PopoutSnapshot } from '@/shared/popout'

function errorText(error: unknown) {
  return error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error)
}

/**
 * One conversation in its own window (Codex's pop-out chat): the transcript,
 * a composer and the window's pin. Everything else stays in the main window,
 * which also answers Pi's questions (dialogs) for this conversation.
 */
export function PopoutApp({ popoutId }: { popoutId: string }) {
  const settings = useApplySettings()
  const t = useT()
  const api = window.pipilot!.popout
  const [snapshot, setSnapshot] = React.useState<PopoutSnapshot | null>(null)
  const [draft, setDraft] = React.useState('')
  const [sending, setSending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const viewport = React.useRef<HTMLDivElement>(null)
  const following = React.useRef(true)

  React.useEffect(() => {
    const detach = api.subscribe((next) => { if (next.popoutId === popoutId) setSnapshot(next) })
    void api.get(popoutId).then(setSnapshot, (caught: unknown) => setError(errorText(caught)))
    return detach
  }, [api, popoutId])
  React.useEffect(() => { if (snapshot) document.title = snapshot.title }, [snapshot?.title])
  // Follow new text unless the reader scrolled up.
  React.useLayoutEffect(() => {
    const node = viewport.current
    if (node && following.current) node.scrollTop = node.scrollHeight
  }, [snapshot?.messages])

  const running = snapshot?.status === 'running'
  const send = () => {
    const text = draft.trim()
    if (!text || sending || !snapshot || snapshot.status === 'starting' || snapshot.status === 'closed') return
    setSending(true); setError(null)
    following.current = true
    void api.send(popoutId, text, crypto.randomUUID()).then((next) => { setSnapshot(next); setDraft('') }, (caught: unknown) => setError(errorText(caught)))
      .finally(() => setSending(false))
  }

  return <div className="flex h-screen min-h-0 flex-col bg-surface text-foreground" data-popout={popoutId}>
    <header className="toolbar-material flex h-11 shrink-0 items-center gap-2 border-b border-border/60 px-3">
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-app font-semibold">{snapshot?.title ?? '…'}</h1>
        {snapshot?.scopeLabel ? <p className="truncate text-micro text-muted-foreground">{snapshot.scopeLabel}</p> : null}
      </div>
      {running ? <span role="status" className="flex items-center gap-1 text-caption text-muted-foreground"><TbLoader2 className="size-3.5 animate-spin text-primary motion-reduce:animate-none" aria-hidden />{t('popout.running')}</span> : null}
      <Button variant="ghost" size="icon-sm" aria-pressed={snapshot?.pinned ?? false} aria-label={t(snapshot?.pinned ? 'popout.unpin' : 'popout.pin')} title={t(snapshot?.pinned ? 'popout.unpin' : 'popout.pin')}
        disabled={!snapshot} data-popout-pin onClick={() => snapshot && void api.setPinned(popoutId, !snapshot.pinned).then(setSnapshot, () => undefined)}>
        {snapshot?.pinned ? <TbPinFilled className="text-primary" aria-hidden /> : <TbPin aria-hidden />}
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label={t('popout.showMain')} title={t('popout.showMain')} onClick={() => void api.showMainWindow(popoutId).catch(() => undefined)}>
        <TbAppWindow aria-hidden />
      </Button>
    </header>

    <div ref={viewport} role="log" aria-label={t('chat.title')} data-popout-transcript className="scroll-slim min-h-0 flex-1 overflow-y-auto px-4 py-4"
      onScroll={(event) => { const node = event.currentTarget; following.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48 }}>
      {!snapshot || snapshot.status === 'starting' ? <p role="status" className="flex items-center justify-center gap-2 py-10 text-caption text-muted-foreground">
        <TbLoader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />{t('popout.opening')}
      </p> : snapshot.messages.length === 0 ? <p className="py-10 text-center text-caption text-muted-foreground">{t('popout.empty')}</p> : null}
      <div className="mx-auto flex max-w-[680px] flex-col gap-4">
        {snapshot?.messages.map((message, index) => message.role === 'user'
          ? <div key={index} className="ml-auto max-w-[88%] rounded-[18px] bg-[#e9e9eb] px-3.5 py-2 whitespace-pre-wrap break-words dark:bg-[#3a3a3c]" data-popout-message="user">{message.text}</div>
          : <div key={index} className="min-w-0 [&_.md-body]:text-app" data-popout-message="assistant">
            {message.tools ? <p className="mb-1 flex items-center gap-1 text-caption text-muted-foreground"><TbTool className="size-3.5" aria-hidden />{t('popout.tools', { count: message.tools })}</p> : null}
            {message.text ? <MarkdownContent markdown={message.text} /> : null}
            {message.partial ? <span className="mt-1 inline-block size-2 animate-pulse rounded-full bg-primary motion-reduce:animate-none" aria-hidden /> : null}
          </div>)}
      </div>
    </div>

    {snapshot?.needsMainWindow ? <div role="alert" className="mx-3 mb-2 flex items-center gap-2 rounded-[12px] bg-warning/12 px-3 py-2 text-caption">
      <span className="min-w-0 flex-1">{t('popout.needsMain')}</span>
      <Button size="sm" variant="outline" onClick={() => void api.showMainWindow(popoutId).catch(() => undefined)}>{t('popout.showMain')}</Button>
    </div> : null}
    {error || snapshot?.error ? <p role="alert" className="mx-3 mb-2 rounded-[12px] bg-destructive/8 px-3 py-2 text-caption text-destructive">{error ?? snapshot?.error}</p> : null}

    <form className="shrink-0 px-3 pb-3" onSubmit={(event) => { event.preventDefault(); send() }}>
      <div className="flex items-end gap-2 rounded-(--radius-composer) bg-composer p-2 shadow-[var(--glass-shadow),var(--shadow-composer)]">
        <Textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={1} data-popout-composer
          aria-label={t('composer.inputLabel')} placeholder={t(running ? 'popout.followUpPlaceholder' : 'popout.placeholder')}
          className="max-h-40 min-h-9 flex-1 resize-none border-0 bg-transparent px-2 py-1.5 shadow-none focus-visible:ring-0"
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return
            if (isComposerSendShortcut(event, settings.composer.sendShortcut)) { event.preventDefault(); send() }
          }} />
        {running && !draft.trim()
          ? <Button type="button" size="icon-sm" variant="secondary" className="rounded-full" aria-label={t('popout.stop')} title={t('popout.stop')}
            onClick={() => void api.abort(popoutId).then(setSnapshot, (caught: unknown) => setError(errorText(caught)))}><TbPlayerStopFilled aria-hidden /></Button>
          : <Button type="submit" size="icon-sm" className={cn('rounded-full', !draft.trim() && 'opacity-50')} disabled={!draft.trim() || sending || !snapshot || snapshot.status === 'starting'}
            aria-label={t(running ? 'popout.queue' : 'popout.send')} title={t(running ? 'popout.queue' : 'popout.send')}><TbArrowUp aria-hidden /></Button>}
      </div>
    </form>
  </div>
}
