import * as React from 'react'
import { TbArrowsMaximize, TbArrowsMinimize, TbChevronDown, TbDots, TbPencil, TbPlayerStop, TbPlus, TbRefresh, TbTerminal2, TbX } from 'react-icons/tb'
import { useT } from '@/i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import type { PiPilotApi } from '@/shared/pipilot-api'
import type { ConversationScope } from '@/shared/conversation-scope'
import type { TerminalSummary } from '@/shared/terminal'
import { TerminalLoadingFallback } from './TerminalPanel'
import type { RealTerminalPanelHandle } from './RealTerminalPanel'
import { TerminalExitLedger, TerminalOperationQueue } from './terminal-workspace-state'

const RealTerminalPanel = React.lazy(() => import('./RealTerminalPanel').then((module) => ({ default: module.RealTerminalPanel })))

interface TerminalWorkspaceProps {
  terminalApi: PiPilotApi['terminal']
  scope: ConversationScope
  name: string
  visible: boolean
  maximized: boolean
  onMaximize(): void
  onHide(): void
}

function sameScope(left: ConversationScope, right: ConversationScope) {
  return left.kind === right.kind && (left.kind === 'projectless' || right.kind === 'project' && left.workspaceId === right.workspaceId)
}

export function TerminalWorkspace({ terminalApi, scope, name, visible, maximized, onMaximize, onHide }: TerminalWorkspaceProps) {
  const t = useT()
  const [sessions, setSessions] = React.useState<TerminalSummary[]>([])
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [renaming, setRenaming] = React.useState<TerminalSummary | null>(null)
  const [title, setTitle] = React.useState('')
  const [renameError, setRenameError] = React.useState<string | null>(null)
  const [autoFocusTerminal, setAutoFocusTerminal] = React.useState(true)
  const [toolbarContainer, setToolbarContainer] = React.useState<HTMLDivElement | null>(null)
  const initialized = React.useRef(false)
  const mounted = React.useRef(true)
  const busyRef = React.useRef(false)
  const visibleRef = React.useRef(visible)
  const loadRef = React.useRef<Promise<void> | null>(null)
  const operationQueue = React.useRef(new TerminalOperationQueue())
  const exitLedger = React.useRef(new TerminalExitLedger())
  const terminalHandles = React.useRef(new Map<string, RealTerminalPanelHandle>())
  const selectionRevision = React.useRef(0)
  const selectionRef = React.useRef(selectedId)
  const sessionsRef = React.useRef(sessions)
  const tabsRef = React.useRef<HTMLDivElement>(null)
  const titleInputId = React.useId()
  const idPrefix = React.useId()
  const translateRef = React.useRef(t)
  const selected = sessions.find((item) => item.terminalId === selectedId)
  visibleRef.current = visible
  selectionRef.current = selectedId
  sessionsRef.current = sessions
  translateRef.current = t

  React.useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const loadSessions = React.useCallback(async () => {
      try {
        if (!mounted.current || !visibleRef.current) return
        let list = await terminalApi.list(scope)
        if (!mounted.current) return
        if (!initialized.current && list.length === 0 && visibleRef.current) {
          initialized.current = true
          const created = await terminalApi.create(scope, 80, 24)
          list = [created]
        }
        initialized.current = true
        if (!mounted.current) return
        setSessions(list.map((session) => exitLedger.current.apply(session)))
        setSelectedId((current) => list.some((item) => item.terminalId === current) ? current : list[list.length - 1]?.terminalId ?? null)
        setError(null)
      } catch {
        if (mounted.current) setError(translateRef.current('terminal.drawer.operationFailed'))
      } finally {
        if (mounted.current) setLoading(false)
      }
  // A workspace component has a stable scope for its entire lifetime.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, terminalApi])

  const refresh = React.useCallback(() => {
    if (loadRef.current) return loadRef.current
    const operation = operationQueue.current.run(loadSessions).finally(() => {
      if (loadRef.current === operation) loadRef.current = null
    })
    loadRef.current = operation
    return operation
  }, [loadSessions])

  React.useEffect(() => {
    if (visible) {
      setAutoFocusTerminal(true)
      void refresh()
    }
  }, [refresh, visible])

  const recordExit = React.useCallback((terminalId: string, exit: { exitCode: number; signal?: number }) => {
    if (!mounted.current) return
    exitLedger.current.record(terminalId, exit)
    setSessions((current) => current.map((item) => item.terminalId === terminalId
      ? exitLedger.current.apply(item)
      : item))
  }, [])

  React.useEffect(() => terminalApi.subscribe((event) => {
    if (event.type !== 'exit' || !sameScope(event.scope, scope)) return
    recordExit(event.terminalId, event)
  }), [scope, terminalApi, recordExit])

  React.useEffect(() => { if (!visible) setRenaming(null) }, [visible])

  const run = async (operation: () => Promise<void>) => {
    if (busyRef.current || !visibleRef.current) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      await operationQueue.current.run(async () => {
        if (mounted.current && visibleRef.current) await operation()
      })
    } catch {
      if (mounted.current) setError(translateRef.current('terminal.drawer.operationFailed'))
    } finally {
      busyRef.current = false
      if (mounted.current) setBusy(false)
    }
  }

  const create = () => {
    const revision = selectionRevision.current
    void run(async () => {
      const created = await terminalApi.create(scope, 80, 24)
      if (!mounted.current) return
      setSessions((current) => {
        const session = exitLedger.current.apply(created)
        return current.some((item) => item.terminalId === session.terminalId)
          ? current.map((item) => item.terminalId === session.terminalId ? session : item)
          : [...current, session]
      })
      if (revision === selectionRevision.current) {
        setAutoFocusTerminal(true)
        setSelectedId(created.terminalId)
      }
    })
  }

  const end = () => {
    if (!selected) return
    const target = selected.terminalId
    void run(async () => {
      await terminalApi.kill(scope, target)
      // Already inside the operation queue: refresh directly, without nesting it.
      await loadSessions()
    })
  }

  const close = () => {
    if (!selected || selected.status !== 'exited') return
    const target = selected.terminalId
    void run(async () => {
      await terminalApi.close(scope, target)
      if (!mounted.current) return
      exitLedger.current.forget(target)
      const index = sessionsRef.current.findIndex((item) => item.terminalId === target)
      const remaining = sessionsRef.current.filter((item) => item.terminalId !== target)
      setSessions((current) => current.filter((item) => item.terminalId !== target))
      if (selectionRef.current === target) setSelectedId(remaining[Math.min(index, remaining.length - 1)]?.terminalId ?? null)
    })
  }

  const rename = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!renaming || !title.trim() || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setRenameError(null)
    try {
      await operationQueue.current.run(async () => {
        if (!mounted.current || !visibleRef.current) return
        const updated = await terminalApi.rename(scope, renaming.terminalId, title.trim())
        if (!mounted.current) return
        setSessions((current) => current.map((item) => item.terminalId === updated.terminalId ? exitLedger.current.apply(updated) : item))
        setRenaming(null)
      })
    } catch {
      if (mounted.current) setRenameError(t('terminal.drawer.renameFailed'))
    } finally {
      busyRef.current = false
      if (mounted.current) setBusy(false)
    }
  }

  const beginRename = (item: TerminalSummary) => {
    setRenaming(item)
    setTitle(item.title)
    setRenameError(null)
  }

  const select = (terminalId: string, focusTab = false) => {
    selectionRevision.current += 1
    setAutoFocusTerminal(!focusTab)
    setSelectedId(terminalId)
    requestAnimationFrame(() => {
      if (!visibleRef.current) return
      if (focusTab) tabsRef.current?.querySelector<HTMLElement>(`[data-tab-terminal-id="${terminalId}"]`)?.focus()
      else terminalHandles.current.get(terminalId)?.focus()
    })
  }

  return <div hidden={!visible} className="flex h-full min-h-0 min-w-0 flex-col" data-terminal-workspace>
    <div className="flex min-h-10 shrink-0 items-center gap-1 border-b border-border px-2">
      <span className="max-w-32 shrink truncate px-1 text-caption text-muted-foreground" title={name}>{name}</span>
      <div ref={tabsRef} role="tablist" aria-label={t('terminal.drawer.tabs')} className="scroll-slim flex min-w-0 flex-1 self-stretch overflow-x-auto" onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || !sessions.length) return
        event.preventDefault()
        const current = sessions.findIndex((item) => item.terminalId === selectedId)
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? sessions.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + sessions.length) % sessions.length
        select(sessions[next].terminalId, true)
      }}>
        {sessions.map((item) => <button
          key={item.terminalId}
          id={`${idPrefix}-tab-${item.terminalId}`}
          type="button"
          role="tab"
          aria-label={item.title}
          aria-selected={selectedId === item.terminalId}
          aria-controls={`${idPrefix}-panel-${item.terminalId}`}
          tabIndex={selectedId === item.terminalId ? 0 : -1}
          data-tab-terminal-id={item.terminalId}
          title={`${item.title} · ${t(item.status === 'running' ? 'workbenchReview.terminal.running' : 'workbenchReview.terminal.exited')}`}
          className={cn('flex max-w-48 shrink-0 items-center gap-1.5 border-b-2 px-3 text-caption outline-none focus-visible:focus-ring', selectedId === item.terminalId ? 'border-foreground bg-surface text-foreground' : 'border-transparent text-muted-foreground hover:bg-accent')}
          onClick={() => select(item.terminalId)}
          onDoubleClick={() => beginRename(item)}
        >
          <TbTerminal2 aria-hidden className="size-3.5 shrink-0" />
          <span className="truncate">{item.title}</span>
          {item.status === 'exited' ? <span className={cn('shrink-0 text-micro tabular-nums', item.exitCode ? 'text-destructive' : 'text-muted-foreground')} aria-label={t('inspector.terminal.exited', { code: item.exitCode ?? 0 })}>{item.exitCode ?? 0}</span> : <span aria-hidden className="size-1 shrink-0 rounded-full bg-sage" />}
        </button>)}
      </div>
      <div ref={setToolbarContainer} className="flex shrink-0 items-center gap-1" data-terminal-toolbar-controls />
      <Button variant="ghost" size="icon-xs" disabled={busy || loading} aria-label={t('terminal.drawer.new')} title={t('terminal.drawer.new')} onClick={create}><TbPlus aria-hidden /></Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-xs" aria-label={t('terminal.drawer.more')} title={t('terminal.drawer.more')} disabled={!selected || busy}><TbDots aria-hidden /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => { if (selected) beginRename(selected) }}><TbPencil aria-hidden />{t('terminal.drawer.rename')}</DropdownMenuItem>
          <DropdownMenuSeparator />
          {selected?.status === 'running'
            ? <DropdownMenuItem variant="destructive" onSelect={end}><TbPlayerStop aria-hidden />{t('terminal.drawer.end')}</DropdownMenuItem>
            : <DropdownMenuItem onSelect={create}><TbRefresh aria-hidden />{t('terminal.drawer.restart')}</DropdownMenuItem>}
          <DropdownMenuItem disabled={selected?.status !== 'exited'} onSelect={close}><TbX aria-hidden />{t('terminal.drawer.close')}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button variant="ghost" size="icon-xs" aria-label={t(maximized ? 'terminal.drawer.restore' : 'terminal.drawer.maximize')} title={t(maximized ? 'terminal.drawer.restore' : 'terminal.drawer.maximize')} onClick={onMaximize}>{maximized ? <TbArrowsMinimize aria-hidden /> : <TbArrowsMaximize aria-hidden />}</Button>
      <Button variant="ghost" size="icon-xs" aria-label={t('terminal.drawer.hide')} title={t('terminal.drawer.hide')} onClick={onHide}><TbChevronDown aria-hidden /></Button>
    </div>
    {error ? <div role="alert" className="flex shrink-0 items-center gap-2 px-3 py-2 text-caption text-destructive"><p className="flex-1">{error}</p><Button variant="ghost" size="sm" disabled={busy} onClick={() => void refresh()}>{t('terminal.surface.retry')}</Button></div> : null}
    {loading ? <TerminalLoadingFallback /> : null}
    {!loading && sessions.length === 0 ? <div className="grid min-h-0 flex-1 place-items-center p-4"><div className="text-center"><p className="mb-3 text-caption text-muted-foreground">{t('terminal.drawer.empty')}</p><Button variant="outline" size="sm" disabled={busy} onClick={create}><TbPlus aria-hidden />{t('terminal.drawer.new')}</Button></div></div> : null}
    {sessions.map((item) => <div
      key={item.terminalId}
      id={`${idPrefix}-panel-${item.terminalId}`}
      role="tabpanel"
      aria-labelledby={`${idPrefix}-tab-${item.terminalId}`}
      hidden={selectedId !== item.terminalId}
      className="min-h-0 flex-1"
    >
      <React.Suspense fallback={<TerminalLoadingFallback />}>
        <RealTerminalPanel
          ref={(handle) => { if (handle) terminalHandles.current.set(item.terminalId, handle); else terminalHandles.current.delete(item.terminalId) }}
          terminalApi={terminalApi}
          scope={scope}
          terminalId={item.terminalId}
          visible={visible && selectedId === item.terminalId}
          autoFocus={autoFocusTerminal}
          toolbarContainer={toolbarContainer}
          onExit={(exit) => recordExit(item.terminalId, exit)}
          onSessionChange={(session) => setSessions((current) => current.map((value) => value.terminalId === session.terminalId ? exitLedger.current.apply({ ...value, status: session.status, exitCode: session.exitCode, signal: session.signal }) : value))}
        />
      </React.Suspense>
    </div>)}
    {selected?.status === 'exited' ? <div role="status" className="flex shrink-0 items-center gap-2 border-t border-border px-3 py-1 text-caption text-muted-foreground"><span className="min-w-0 flex-1 truncate">{t('inspector.terminal.exited', { code: selected.exitCode ?? -1 })}</span><Button variant="ghost" size="xs" disabled={busy} onClick={create}><TbRefresh aria-hidden />{t('terminal.drawer.restart')}</Button></div> : null}
    <Dialog open={Boolean(renaming)} onOpenChange={(next) => { if (!next && !busy) setRenaming(null) }}>
      <DialogContent onOpenAutoFocus={(event) => { event.preventDefault(); requestAnimationFrame(() => { const input = document.getElementById(titleInputId) as HTMLInputElement | null; input?.focus(); input?.select() }) }}>
        <form onSubmit={(event) => void rename(event)} className="space-y-4">
          <DialogHeader><DialogTitle>{t('terminal.drawer.rename')}</DialogTitle><DialogDescription>{t('terminal.drawer.renameDescription')}</DialogDescription></DialogHeader>
          <div className="space-y-1.5"><label htmlFor={titleInputId} className="text-caption">{t('terminal.drawer.name')}</label><Input id={titleInputId} value={title} maxLength={128} autoComplete="off" onChange={(event) => setTitle(event.target.value)} aria-invalid={Boolean(renameError)} aria-describedby={renameError ? `${titleInputId}-error` : undefined} />{renameError ? <p id={`${titleInputId}-error`} role="alert" className="text-caption text-destructive">{renameError}</p> : null}</div>
          <DialogFooter><Button type="button" variant="ghost" disabled={busy} onClick={() => setRenaming(null)}>{t('common.cancel')}</Button><Button type="submit" disabled={busy || !title.trim()}>{t('common.save')}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </div>
}
