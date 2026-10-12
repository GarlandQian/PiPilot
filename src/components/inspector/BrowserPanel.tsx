import * as React from 'react'
import { TbArrowLeft, TbArrowRight, TbClick, TbDots, TbExternalLink, TbLoader2, TbMarquee2, TbPlus, TbRefresh, TbWorld, TbX } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import type { BrowserAnnotation, BrowserCommand, BrowserSnapshot } from '@/shared/browser-pane'
import { usePrecisionReferences } from '@/components/precision/PrecisionReferences'

/** Any open menu, popover or dialog: the page (a native layer) would cover it. */
const OVERLAY = '[data-radix-popper-content-wrapper], [role="dialog"], [role="alertdialog"]'

function useOverlayOpen(viewport: React.RefObject<HTMLDivElement | null>) {
  const [open, setOpen] = React.useState(false)
  React.useEffect(() => {
    const check = () => {
      const hostDialog = viewport.current?.closest('[role="dialog"]')
      setOpen([...document.querySelectorAll(OVERLAY)].some((overlay) => overlay !== hostDialog))
    }
    check()
    const observer = new MutationObserver(check)
    observer.observe(document.body, { childList: true, subtree: false })
    return () => observer.disconnect()
  }, [])
  return open
}

function errorText(error: unknown) {
  return error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error)
}

function dataUrlFile(dataUrl: string, name: string) {
  const [header, data = ''] = dataUrl.split(',')
  const mime = /data:([^;]+)/u.exec(header ?? '')?.[1] ?? 'image/png'
  const bytes = Uint8Array.from(atob(data), (character) => character.charCodeAt(0))
  return new File([bytes], name, { type: mime })
}

/** The annotation as a quoted reference: what Pi needs to find and change the element. */
export function annotationText(annotation: BrowserAnnotation, includeConsole: boolean) {
  const lines = [`Page: ${annotation.url}`, annotation.title ? `Title: ${annotation.title}` : '']
  if (annotation.kind === 'element') {
    if (annotation.selector) lines.push(`Element: ${annotation.selector}`)
    if (annotation.text) lines.push(`Text: ${annotation.text.slice(0, 500)}`)
    if (annotation.styles && Object.keys(annotation.styles).length) lines.push(`Styles: ${Object.entries(annotation.styles).map(([key, value]) => `${key}: ${value}`).join('; ')}`)
    if (annotation.html) lines.push('', 'HTML:', annotation.html.slice(0, 4_000))
  } else {
    const { x, y, width, height } = annotation.rect
    lines.push(`Area: ${Math.round(width)}×${Math.round(height)} at (${Math.round(x)}, ${Math.round(y)}) in the viewport; see the attached screenshot.`)
  }
  if (includeConsole && annotation.consoleErrors.length) lines.push('', 'Console errors:', ...annotation.consoleErrors.map((error) => `- ${error}`))
  return lines.filter((line, index) => line || index > 1).join('\n')
}

/**
 * The project's built-in browser (Codex's in-app browser): pages render in an
 * isolated native view that Main lays over this tab. Annotate an element or
 * an area to hand Pi its screenshot, selector, HTML and styles with a note.
 */
export function BrowserPanel({ scopeKey, visible, onAttachImage }: {
  scopeKey: string
  visible: boolean
  /** Adds the annotation's screenshot to the composer's draft. */
  onAttachImage(file: File): void
}) {
  const t = useT()
  const precision = usePrecisionReferences()
  const api = window.pipilot!.browserPane
  const [snapshot, setSnapshot] = React.useState<BrowserSnapshot | null>(null)
  const [address, setAddress] = React.useState('')
  const [editing, setEditing] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [placeholder, setPlaceholder] = React.useState<string | null>(null)
  const [annotating, setAnnotating] = React.useState<'element' | 'area' | null>(null)
  const [annotation, setAnnotation] = React.useState<BrowserAnnotation | null>(null)
  const [comment, setComment] = React.useState('')
  const [includeConsole, setIncludeConsole] = React.useState(false)
  const viewport = React.useRef<HTMLDivElement>(null)
  const overlay = useOverlayOpen(viewport)
  const active = snapshot?.tabs.find((tab) => tab.id === snapshot.activeId) ?? null

  React.useEffect(() => {
    let current = true
    setSnapshot(null)
    void api.get(scopeKey).then((next) => { if (current) setSnapshot(next) }, (caught: unknown) => { if (current) setError(errorText(caught)) })
    const detach = api.subscribe((next) => { if (next.scopeKey === scopeKey) setSnapshot(next) })
    return () => { current = false; detach() }
  }, [api, scopeKey])
  React.useEffect(() => { if (!editing) setAddress(active?.url && active.url !== 'about:blank' ? active.url : '') }, [active?.url, editing])

  // Lay the page over the viewport while it shows; take it down under menus and dialogs.
  const shown = visible && Boolean(active) && !overlay && !annotation
  React.useEffect(() => {
    if (!shown) {
      void api.setViewport(scopeKey, null).then((result) => { if (result.placeholder) setPlaceholder(result.placeholder) }, () => undefined)
      return
    }
    setPlaceholder(null)
    let last = ''
    let frame = 0
    const sync = () => {
      const node = viewport.current
      if (node) {
        const rect = node.getBoundingClientRect()
        const key = `${rect.x},${rect.y},${rect.width},${rect.height}`
        if (key !== last) {
          last = key
          void api.setViewport(scopeKey, { x: rect.x, y: rect.y, width: rect.width, height: rect.height }).catch(() => undefined)
        }
      }
      frame = window.setTimeout(sync, 200)
    }
    sync()
    return () => { window.clearTimeout(frame) }
  }, [api, scopeKey, shown, active?.id])
  React.useEffect(() => () => { void api.setViewport(scopeKey, null).catch(() => undefined) }, [api, scopeKey])

  const run = (operation: () => Promise<BrowserSnapshot>) => {
    setError(null)
    void operation().then(setSnapshot, (caught: unknown) => setError(errorText(caught)))
  }
  const command = (name: BrowserCommand, tabId = active?.id) => { if (tabId) run(() => api.command(scopeKey, tabId, name)) }
  const annotate = (mode: 'element' | 'area') => {
    if (!active) return
    setError(null); setAnnotating(mode)
    void api.annotate(scopeKey, active.id, mode).then((result) => {
      if (result) { setAnnotation(result); setComment(''); setIncludeConsole(false) }
    }, (caught: unknown) => setError(errorText(caught))).finally(() => setAnnotating(null))
  }
  const addToMessage = () => {
    if (!annotation) return
    let host = annotation.url
    try { host = new URL(annotation.url).host } catch { /* keep the address */ }
    const inserted = Boolean(precision?.available) && precision!.insert([{
      id: crypto.randomUUID(), ownerKey: precision!.ownerKey, kind: 'browser', sourceId: annotation.url.slice(0, 2_048),
      label: t(annotation.kind === 'element' ? 'browser.referenceElement' : 'browser.referenceArea', { page: (annotation.title || host).slice(0, 80) }),
      text: annotationText(annotation, includeConsole).slice(0, 20_000),
      ...(comment.trim() ? { comment: comment.trim().slice(0, 4_000) } : {}),
    }])
    if (!inserted) { setError(t('browser.noComposer')); return }
    onAttachImage(dataUrlFile(annotation.screenshot, `annotation-${Date.now()}.png`))
    setAnnotation(null)
  }

  return <div className="flex h-full min-h-0 flex-col" data-browser-panel={scopeKey}>
    {snapshot && snapshot.tabs.length > 0 ? <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border/60 px-2 pt-1.5 pb-1" role="tablist" aria-label={t('browser.tabs')}>
      {snapshot.tabs.map((tab) => <div key={tab.id} role="tab" aria-selected={tab.id === snapshot.activeId} data-browser-tab={tab.id}
        className={cn('group/tab flex h-7 max-w-44 min-w-0 shrink-0 items-center gap-1 rounded-[7px] pr-1 pl-2 text-caption', tab.id === snapshot.activeId ? 'bg-fill-strong text-foreground' : 'text-muted-foreground hover:bg-fill')}>
        <button type="button" className="flex min-w-0 flex-1 items-center gap-1.5 outline-none focus-visible:focus-ring" onClick={() => command('select', tab.id)} title={tab.url}>
          {tab.loading ? <TbLoader2 className="size-3 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden /> : <TbWorld className="size-3 shrink-0" aria-hidden />}
          <span className="truncate">{tab.title || tab.url || t('browser.newTab')}</span>
        </button>
        <Button variant="ghost" size="icon-xs" className="size-5 shrink-0 opacity-60 hover:opacity-100" aria-label={t('browser.closeTab')} onClick={() => command('close', tab.id)}><TbX className="size-3" aria-hidden /></Button>
      </div>)}
      <Button variant="ghost" size="icon-xs" className="shrink-0" aria-label={t('browser.newTab')} title={t('browser.newTab')} onClick={() => run(() => api.open(scopeKey))}><TbPlus aria-hidden /></Button>
    </div> : null}

    {active ? <div className="flex shrink-0 items-center gap-1 border-b border-border/60 px-2 py-1.5">
      <Button variant="ghost" size="icon-xs" disabled={!active.canGoBack} aria-label={t('browser.back')} onClick={() => command('back')}><TbArrowLeft aria-hidden /></Button>
      <Button variant="ghost" size="icon-xs" disabled={!active.canGoForward} aria-label={t('browser.forward')} onClick={() => command('forward')}><TbArrowRight aria-hidden /></Button>
      <Button variant="ghost" size="icon-xs" aria-label={t(active.loading ? 'browser.stop' : 'browser.reload')} onClick={() => command(active.loading ? 'stop' : 'reload')}>
        {active.loading ? <TbX aria-hidden /> : <TbRefresh aria-hidden />}
      </Button>
      <form className="min-w-0 flex-1" onSubmit={(event) => { event.preventDefault(); setEditing(false); if (address.trim()) run(() => api.navigate(scopeKey, active.id, address)) }}>
        <Input value={address} onChange={(event) => setAddress(event.target.value)} onFocus={(event) => { setEditing(true); event.currentTarget.select() }} onBlur={() => setEditing(false)}
          aria-label={t('browser.address')} placeholder={t('browser.addressPlaceholder')} spellCheck={false} data-browser-address
          className="h-7 rounded-full bg-fill px-3 font-mono text-caption shadow-none" />
      </form>
      <Button variant={annotating === 'element' ? 'secondary' : 'ghost'} size="icon-xs" disabled={Boolean(annotating) || !/^https?:/u.test(active.url)}
        aria-label={t('browser.annotateElement')} title={t('browser.annotateElement')} data-browser-annotate="element" onClick={() => annotate('element')}><TbClick aria-hidden /></Button>
      <Button variant={annotating === 'area' ? 'secondary' : 'ghost'} size="icon-xs" disabled={Boolean(annotating) || !/^https?:/u.test(active.url)}
        aria-label={t('browser.annotateArea')} title={t('browser.annotateArea')} data-browser-annotate="area" onClick={() => annotate('area')}><TbMarquee2 aria-hidden /></Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-xs" aria-label={t('browser.more')}><TbDots aria-hidden /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={!/^https?:/u.test(active.url)} onSelect={() => command('external')}><TbExternalLink aria-hidden />{t('browser.openExternal')}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => command('devtools')}>{t('browser.devtools')}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div> : null}

    {annotating ? <p role="status" className="flex shrink-0 items-center gap-2 border-b border-border/60 bg-primary/8 px-3 py-1.5 text-caption">
      <span className="min-w-0 flex-1">{t(annotating === 'element' ? 'browser.pickElement' : 'browser.pickArea')}</span>
      <Button variant="ghost" size="sm" onClick={() => active && void api.cancelAnnotation(scopeKey, active.id)}>{t('common.cancel')}</Button>
    </p> : null}
    {active && (active.consoleErrors > 0 || active.networkErrors > 0) && !annotation ? <p className="shrink-0 border-b border-border/60 px-3 py-1 text-micro text-muted-foreground" data-browser-errors>
      {t('browser.errors', { console: active.consoleErrors, network: active.networkErrors })}
    </p> : null}
    {error ? <p role="alert" className="shrink-0 border-b border-border/60 bg-destructive/8 px-3 py-1.5 text-caption text-destructive">{error}</p> : null}

    {annotation ? <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3" data-browser-annotation={annotation.kind}>
      <img src={annotation.screenshot} alt={t('browser.screenshot')} className="max-h-48 w-auto self-start rounded-[8px] border border-border/60 object-contain" />
      <p className="truncate font-mono text-micro text-muted-foreground" title={annotation.selector ?? annotation.url}>{annotation.selector ?? t('browser.areaOf', { url: annotation.url })}</p>
      <Textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={3} autoFocus placeholder={t('browser.commentPlaceholder')} aria-label={t('browser.comment')} data-browser-comment
        onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); addToMessage() } }} />
      <label className="flex items-center gap-2 text-caption">
        <Checkbox checked={includeConsole} disabled={annotation.consoleErrors.length === 0} onCheckedChange={(checked) => setIncludeConsole(checked === true)} />
        {t('browser.includeConsole', { count: annotation.consoleErrors.length })}
      </label>
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => setAnnotation(null)}>{t('common.cancel')}</Button>
        <Button size="sm" onClick={addToMessage} data-browser-add>{t('browser.addToMessage')}</Button>
      </div>
    </div> : <div ref={viewport} className="relative min-h-0 flex-1 bg-white dark:bg-[#1e1e1f]" data-browser-viewport>
      {!active ? <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
        <TbWorld className="size-8 text-muted-foreground/60" aria-hidden />
        <p className="max-w-xs text-caption text-muted-foreground">{t('browser.empty')}</p>
        {snapshot?.suggestedUrl ? <Button size="sm" onClick={() => run(() => api.open(scopeKey, snapshot.suggestedUrl))}>{t('browser.openDevServer', { url: snapshot.suggestedUrl })}</Button> : null}
        <form className="flex w-full max-w-sm gap-2" onSubmit={(event) => { event.preventDefault(); if (address.trim()) run(() => api.open(scopeKey, address)) }}>
          <Input value={address} onChange={(event) => setAddress(event.target.value)} placeholder={t('browser.addressPlaceholder')} aria-label={t('browser.address')} spellCheck={false} className="h-8 font-mono text-caption" />
          <Button type="submit" size="sm" variant="outline" disabled={!address.trim()}>{t('browser.go')}</Button>
        </form>
      </div> : !shown && placeholder ? <img src={placeholder} alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover object-top opacity-80" /> : null}
    </div>}
  </div>
}

