import * as React from 'react'
import { createPortal } from 'react-dom'
import { TbArrowsMaximize, TbArrowsMinimize, TbChevronDown, TbClipboard, TbCopy, TbDots, TbEraser, TbPencil, TbPlayerStop, TbPlus, TbRefresh, TbSearch, TbTerminal2, TbX } from 'react-icons/tb'
import { useT } from '@/i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SettingsField, SettingsGroup, SettingsSheet } from '@/components/settings/kit'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { primaryShortcut } from '@/lib/keyboard-shortcuts'
import { cn } from '@/lib/utils'
import type { PiPilotApi } from '@/shared/pipilot-api'
import type { ConversationScope } from '@/shared/conversation-scope'
import type { TerminalSummary } from '@/shared/terminal'
import { useSettings } from '@/store/settings'
import { TerminalLoadingFallback } from './TerminalPanel'
import { TerminalShellMenu } from './TerminalShellMenu'
import type { RealTerminalPanelHandle } from './RealTerminalPanel'
import { TerminalExitLedger, TerminalOperationQueue } from './terminal-workspace-state'

const RealTerminalPanel = React.lazy(() => import('./RealTerminalPanel').then((module) => ({ default: module.RealTerminalPanel })))

export interface TerminalCreateRequest {
  id: number
  scope: ConversationScope
  relativeDirectory?: string
}

interface TerminalWorkspaceProps {
  terminalApi: PiPilotApi['terminal']
  scope: ConversationScope
  name: string
  visible: boolean
  maximized: boolean
  /** Absent inside a dock, which has its own maximize and hide. */
  onMaximize?: () => void
  onHide?: () => void
  onOpenTerminalSettings?(): void
  /**
   * Inside a dock (Codex), each terminal is a tab in the dock's own strip and
   * the terminal's tools sit in the dock header; there is no second header.
   */
  hosts?: {
    tabs: HTMLElement | null
    tools: HTMLElement | null
    /** The terminal tab is the one the dock shows. */
    active: boolean
    onActivate(): void
    /** The last terminal closed: the dock's terminal tab goes too. */
    onEmpty(): void
  }
  /** Bump to open another terminal (the strip's "+"). */
  newSessionRequest?: number
  createRequest?: TerminalCreateRequest
  onCreateRequestHandled?(id: number): void
}

function sameScope(left: ConversationScope, right: ConversationScope) {
  return left.kind === right.kind && (left.kind === 'projectless' || right.kind === 'project' && left.workspaceId === right.workspaceId)
}

function operationErrorKey(error: unknown) {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
  if (code === 'TERMINAL_SHELL_UNAVAILABLE') return 'terminal.drawer.shellUnavailable'
  if (code === 'TERMINAL_CWD_UNAVAILABLE' || code === 'TERMINAL_CWD_NOT_DIRECTORY') return 'terminal.drawer.directoryUnavailable'
  if (code === 'TERMINAL_EXTERNAL_APP_UNAVAILABLE') return 'terminal.drawer.externalUnavailable'
  if (code === 'TERMINAL_EXTERNAL_LAUNCH_FAILED') return 'terminal.drawer.externalLaunchFailed'
  return 'terminal.drawer.operationFailed'
}

export function TerminalWorkspace({ terminalApi, scope, name, visible, maximized, onMaximize, onHide, onOpenTerminalSettings, hosts, newSessionRequest = 0, createRequest, onCreateRequestHandled }: TerminalWorkspaceProps) {
  const t = useT()
  const { terminal: terminalSettings } = useSettings()
  const [sessions, setSessions] = React.useState<TerminalSummary[]>([])
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<ReturnType<typeof operationErrorKey> | null>(null)
  const [shellMenuOpen, setShellMenuOpen] = React.useState(false)
  const [failedProfileName, setFailedProfileName] = React.useState<string | null>(null)
  const [renaming, setRenaming] = React.useState<TerminalSummary | null>(null)
  const [title, setTitle] = React.useState('')
  const [renameError, setRenameError] = React.useState<string | null>(null)
  const [autoFocusTerminal, setAutoFocusTerminal] = React.useState(true)
  const initialized = React.useRef(false)
  const mounted = React.useRef(true)
  const busyRef = React.useRef(false)
  const visibleRef = React.useRef(visible)
  const loadRef = React.useRef<Promise<void> | null>(null)
  const retryRef = React.useRef<(() => void) | null>(null)
  const failedCreateDirectory = React.useRef<string | undefined>(undefined)
  const handledCreateRequest = React.useRef<number | undefined>(undefined)
  const createRequestRef = React.useRef(createRequest)
  const operationQueue = React.useRef(new TerminalOperationQueue())
  const exitLedger = React.useRef(new TerminalExitLedger())
  const terminalHandles = React.useRef(new Map<string, RealTerminalPanelHandle>())
  const [selectionInMenu, setSelectionInMenu] = React.useState(false)
  const selectionRevision = React.useRef(0)
  const selectionRef = React.useRef(selectedId)
  const sessionsRef = React.useRef(sessions)
  const tabsRef = React.useRef<HTMLDivElement>(null)
  const titleInputId = React.useId()
  const idPrefix = React.useId()
  const selected = sessions.find((item) => item.terminalId === selectedId)
  const externalError = error === 'terminal.drawer.externalUnavailable' || error === 'terminal.drawer.externalLaunchFailed'
  const hostsRef = React.useRef(hosts)
  hostsRef.current = hosts
  visibleRef.current = visible
  selectionRef.current = selectedId
  sessionsRef.current = sessions
  createRequestRef.current = createRequest

  React.useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const loadSessions = React.useCallback(async () => {
      try {
        if (!mounted.current || !visibleRef.current) return
        let list = await terminalApi.list(scope)
        if (!mounted.current) return
        const explicitRequest = createRequestRef.current
        const awaitingExplicitCreate = explicitRequest && explicitRequest.id !== handledCreateRequest.current
        if (!initialized.current && list.length === 0 && visibleRef.current && !awaitingExplicitCreate) {
          failedCreateDirectory.current = undefined
          const created = await terminalApi.create(scope, 80, 24)
          list = [created]
        }
        initialized.current = true
        if (!mounted.current) return
        setSessions(list.map((session) => exitLedger.current.apply(session)))
        setSelectedId((current) => list.some((item) => item.terminalId === current) ? current : list[list.length - 1]?.terminalId ?? null)
        setError(null)
      } catch (error) {
        if (mounted.current) {
          retryRef.current = () => void refresh()
          setError(operationErrorKey(error))
        }
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

  const run = async (operation: () => Promise<void>, retry?: () => void) => {
    if (busyRef.current || !visibleRef.current) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    retryRef.current = null
    try {
      await operationQueue.current.run(async () => {
        if (mounted.current && visibleRef.current) await operation()
      })
    } catch (error) {
      if (mounted.current) {
        retryRef.current = retry ?? null
        setError(operationErrorKey(error))
      }
    } finally {
      busyRef.current = false
      if (mounted.current) setBusy(false)
    }
  }

  const create = (profileId?: string, relativeDirectory?: string, profileName?: string) => {
    const revision = selectionRevision.current
    failedCreateDirectory.current = relativeDirectory
    setFailedProfileName(profileName ?? terminalSettings.defaultProfileSnapshot?.label ?? null)
    void run(async () => {
      const created = await terminalApi.create(scope, 80, 24, profileId, relativeDirectory)
      if (!mounted.current) return
      initialized.current = true
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
    }, () => create(profileId, relativeDirectory, profileName))
  }

  const handledNewSession = React.useRef(newSessionRequest)
  React.useEffect(() => {
    if (newSessionRequest === handledNewSession.current || !visible || loading || busy || busyRef.current) return
    handledNewSession.current = newSessionRequest
    create()
  // `create` is recreated every render; the request number decides.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newSessionRequest, visible, loading, busy])

  React.useEffect(() => {
    if (!createRequest || createRequest.id === handledCreateRequest.current || !visible || loading || busy || busyRef.current) return
    handledCreateRequest.current = createRequest.id
    onCreateRequestHandled?.(createRequest.id)
    create(undefined, createRequest.relativeDirectory)
  // The request id, visibility and operation queue determine when to create.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createRequest, visible, loading, busy, onCreateRequestHandled])

  const openExternal = (appId?: string, appName?: string) => {
    setFailedProfileName(appName ?? terminalSettings.defaultExternalAppSnapshot?.label ?? null)
    void run(async () => { await terminalApi.openExternal(scope, appId) }, () => openExternal(appId, appName))
  }

  const restart = () => {
    if (!selected || selected.status !== 'exited') return
    const target = selected
    setFailedProfileName(target.shell)
    failedCreateDirectory.current = undefined
    const revision = selectionRevision.current
    void run(async () => {
      const replacement = await terminalApi.restart(scope, target.terminalId, target.cols, target.rows)
      if (!mounted.current) return
      exitLedger.current.forget(target.terminalId)
      setSessions((current) => current.map((item) => item.terminalId === target.terminalId
        ? exitLedger.current.apply(replacement)
        : item))
      if (revision === selectionRevision.current) setAutoFocusTerminal(true)
      setSelectedId((current) => current === target.terminalId ? replacement.terminalId : current)
    }, restart)
  }

  const end = () => {
    if (!selected) return
    const target = selected.terminalId
    void run(async () => {
      await terminalApi.kill(scope, target)
      // Already inside the operation queue: refresh directly, without nesting it.
      await loadSessions()
    }, end)
  }

  const close = (target: string) => {
    void run(async () => {
      await terminalApi.close(scope, target)
      if (!mounted.current) return
      exitLedger.current.forget(target)
      const index = sessionsRef.current.findIndex((item) => item.terminalId === target)
      const remaining = sessionsRef.current.filter((item) => item.terminalId !== target)
      setSessions((current) => current.filter((item) => item.terminalId !== target))
      if (selectionRef.current === target) setSelectedId(remaining[Math.min(index, remaining.length - 1)]?.terminalId ?? null)
      if (!remaining.length && hostsRef.current) {
        // Reopening the terminal tab starts a fresh terminal, as the first time did.
        initialized.current = false
        hostsRef.current.onEmpty()
      }
    }, () => close(target))
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

  /** Show a terminal and move focus to it, to its tab, or (already on its tab in a dock's strip) nowhere. */
  const select = (terminalId: string, focus: 'terminal' | 'tab' | 'stay' = 'terminal') => {
    selectionRevision.current += 1
    setAutoFocusTerminal(focus === 'terminal')
    setSelectedId(terminalId)
    if (focus === 'stay') return
    requestAnimationFrame(() => {
      if (!visibleRef.current) return
      if (focus === 'tab') tabsRef.current?.querySelector<HTMLElement>(`[data-tab-terminal-id="${terminalId}"]`)?.focus()
      else terminalHandles.current.get(terminalId)?.focus()
    })
  }

  const moveBetweenTabs = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!(event.target instanceof HTMLElement) || event.target.getAttribute('role') !== 'tab' || !event.target.dataset.tabTerminalId) return
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || !sessions.length) return
    // In a dock's strip the strip moves focus across all its tabs.
    if (hosts) return
    event.preventDefault()
    const current = sessions.findIndex((item) => item.terminalId === selectedId)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? sessions.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + sessions.length) % sessions.length
    select(sessions[next].terminalId, 'tab')
  }
  /** Each terminal is a tab: in a dock's strip (Codex), or in this header. */
  const sessionTabs = (place: 'strip' | 'header') => sessions.map((item) => {
    const active = selectedId === item.terminalId && (place === 'header' || Boolean(hosts?.active))
    return <div
      key={item.terminalId}
      role="presentation"
      className={cn('group/terminal-tab flex max-w-48 shrink-0 items-center text-caption',
        place === 'strip' ? 'h-7 rounded-[8px]' : 'my-1.5 rounded-full pr-1',
        active ? 'bg-control text-foreground shadow-[inset_0_1px_0.5px_rgb(255_255_255/0.9),0_0_0_0.5px_rgb(0_0_0/0.08),0_1px_2px_rgb(0_0_0/0.08)] dark:bg-white/14 dark:shadow-none'
          : place === 'strip' ? 'text-foreground/70 hover:bg-fill hover:text-foreground' : 'text-muted-foreground hover:bg-fill')}
    >
      <button
        id={`${idPrefix}-tab-${item.terminalId}`}
        type="button"
        role="tab"
        aria-label={item.title}
        aria-selected={active}
        aria-controls={`${idPrefix}-panel-${item.terminalId}`}
        tabIndex={active ? 0 : -1}
        data-tab-terminal-id={item.terminalId}
        title={`${item.title} · ${t(item.status === 'running' ? 'workbenchReview.terminal.running' : 'workbenchReview.terminal.exited')}`}
        className={cn('flex min-w-0 flex-1 items-center gap-1.5 self-stretch outline-none focus-visible:focus-ring', place === 'strip' ? 'rounded-[8px] pr-1 pl-2' : 'rounded-full px-2.5')}
        // From the keyboard (no pointer), the strip has already moved focus to this tab.
        onClick={(event) => { hosts?.onActivate(); select(item.terminalId, event.detail === 0 ? 'stay' : 'terminal') }}
        onDoubleClick={() => beginRename(item)}
      >
        <TbTerminal2 aria-hidden className="size-3.5 shrink-0" />
        <span className="truncate font-medium">{item.title}</span>
        {item.status === 'exited' ? <span className={cn('shrink-0 text-micro tabular-nums', item.exitCode ? 'text-destructive' : 'text-muted-foreground')} aria-label={t('inspector.terminal.exited', { code: item.exitCode ?? 0 })}>{item.exitCode ?? 0}</span> : null}
      </button>
      <Button variant="ghost" size="icon-xs" className={cn('mr-0.5 size-[18px] shrink-0 rounded-[5px]', place === 'strip' && !active && 'opacity-0 group-hover/terminal-tab:opacity-100 focus-visible:opacity-100')}
        disabled={busy} data-close-terminal-id={item.terminalId} aria-label={t(item.status === 'running' ? 'terminal.drawer.endAndCloseNamed' : 'terminal.drawer.closeNamed', { name: item.title })} title={t(item.status === 'running' ? 'terminal.drawer.endAndCloseNamed' : 'terminal.drawer.closeNamed', { name: item.title })}
        onClick={() => close(item.terminalId)}><TbX className="size-3" aria-hidden /></Button>
    </div>
  })
  const tools = <>
    <Button variant="ghost" size="icon-xs" disabled={busy || loading} aria-label={t('terminal.drawer.new')} title={t('terminal.drawer.new')} onClick={() => create()}><TbPlus aria-hidden /></Button>
    <TerminalShellMenu terminalApi={terminalApi} open={shellMenuOpen} onOpenChange={setShellMenuOpen} disabled={busy || loading}
      focusExternal={externalError}
      onCreate={(profileId, profileName) => create(profileId, error === 'terminal.drawer.shellUnavailable' ? failedCreateDirectory.current : undefined, profileName)}
      onOpenExternal={openExternal} onOpenSettings={onOpenTerminalSettings} />
    <DropdownMenu onOpenChange={(open) => { if (open) setSelectionInMenu(Boolean(selected && terminalHandles.current.get(selected.terminalId)?.hasSelection())) }}>
      <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-xs" aria-label={t('terminal.drawer.more')} title={t('terminal.drawer.more')} disabled={!selected || busy}><TbDots aria-hidden /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end" onCloseAutoFocus={(event) => { if (selected) { event.preventDefault(); terminalHandles.current.get(selected.terminalId)?.focus() } }}>
        {/* What used to be separate toolbar buttons: find, copy, paste and clear. */}
        <DropdownMenuItem onSelect={() => { if (selected) terminalHandles.current.get(selected.terminalId)?.find() }}>
          <TbSearch aria-hidden />{t('terminal.surface.search')}<DropdownMenuShortcut>{primaryShortcut('F')}</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!selectionInMenu} onSelect={() => { if (selected) void terminalHandles.current.get(selected.terminalId)?.copy() }}><TbCopy aria-hidden />{t('terminal.surface.copySelection')}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => { if (selected) void terminalHandles.current.get(selected.terminalId)?.copyAll() }}><TbCopy aria-hidden />{t('terminal.surface.copyAll')}</DropdownMenuItem>
        <DropdownMenuItem disabled={selected?.status !== 'running'} onSelect={() => { if (selected) void terminalHandles.current.get(selected.terminalId)?.paste() }}><TbClipboard aria-hidden />{t('terminal.surface.paste')}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => { if (selected) void terminalHandles.current.get(selected.terminalId)?.clear() }}><TbEraser aria-hidden />{t('workbenchReview.terminal.clear')}</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => { if (selected) beginRename(selected) }}><TbPencil aria-hidden />{t('terminal.drawer.rename')}</DropdownMenuItem>
        <DropdownMenuSeparator />
        {selected?.status === 'running'
          ? <DropdownMenuItem variant="destructive" onSelect={end}><TbPlayerStop aria-hidden />{t('terminal.drawer.end')}</DropdownMenuItem>
          : <DropdownMenuItem onSelect={restart}><TbRefresh aria-hidden />{t('terminal.drawer.restart')}</DropdownMenuItem>}
        <DropdownMenuItem variant={selected?.status === 'running' ? 'destructive' : 'default'} onSelect={() => { if (selected) close(selected.terminalId) }}><TbX aria-hidden />{t(selected?.status === 'running' ? 'terminal.drawer.endAndClose' : 'terminal.drawer.close')}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </>

  return <div hidden={!visible} className="flex h-full min-h-0 min-w-0 flex-col" data-terminal-workspace>
    {hosts ? <>
      {hosts.tabs ? createPortal(<div ref={tabsRef} role="presentation" className="flex min-w-0 items-center gap-0.5" data-terminal-session-tabs onKeyDown={moveBetweenTabs}>
        {sessionTabs('strip')}
      </div>, hosts.tabs) : null}
      {hosts.tools && visible ? createPortal(<div className="flex shrink-0 items-center gap-0.5" data-terminal-tools>{tools}</div>, hosts.tools) : null}
    </> : <div className="flex min-h-10 shrink-0 items-center gap-1 border-b border-border px-2">
      <span className="min-w-0 max-w-32 shrink truncate px-1 text-caption text-muted-foreground" title={name}>{name}</span>
      <div ref={tabsRef} role="tablist" aria-label={t('terminal.drawer.tabs')} className="scroll-slim flex min-w-0 flex-1 gap-1 self-stretch overflow-x-auto" onKeyDown={moveBetweenTabs}>
        {sessionTabs('header')}
      </div>
      {tools}
      {onMaximize ? <Button variant="ghost" size="icon-xs" aria-label={t(maximized ? 'terminal.drawer.restore' : 'terminal.drawer.maximize')} title={t(maximized ? 'terminal.drawer.restore' : 'terminal.drawer.maximize')} onClick={onMaximize}>{maximized ? <TbArrowsMinimize aria-hidden /> : <TbArrowsMaximize aria-hidden />}</Button> : null}
      {onHide ? <Button variant="ghost" size="icon-xs" aria-label={t('terminal.drawer.hide')} title={t('terminal.drawer.hide')} onClick={onHide}><TbChevronDown aria-hidden /></Button> : null}
    </div>}
    {error ? <div role="alert" className="flex shrink-0 flex-wrap items-center gap-2 px-3 py-2 text-caption text-destructive">
      <p className="min-w-0 flex-1">{error === 'terminal.drawer.shellUnavailable' ? `${failedProfileName ?? terminalSettings.defaultProfileSnapshot?.label ?? t('settings.terminal.profiles.savedDefault')}: ` : externalError && failedProfileName ? `${failedProfileName}: ` : ''}{t(error)}</p>
      {error === 'terminal.drawer.shellUnavailable' || externalError ? <>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => setShellMenuOpen(true)}>{t(externalError ? 'terminal.drawer.chooseExternalOnce' : 'terminal.drawer.chooseOnce')}</Button>
        {onOpenTerminalSettings ? <Button variant="ghost" size="sm" onClick={onOpenTerminalSettings}>{t('terminal.drawer.openSettings')}</Button> : null}
      </> : null}
      <Button variant="ghost" size="sm" disabled={busy} onClick={() => retryRef.current ? retryRef.current() : void refresh()}>{t('terminal.drawer.retry')}</Button>
    </div> : null}
    {loading ? <TerminalLoadingFallback /> : null}
    {!loading && sessions.length === 0 ? <div className="grid min-h-0 flex-1 place-items-center p-4"><div className="text-center"><p className="mb-3 text-caption text-muted-foreground">{t('terminal.drawer.empty')}</p><Button variant="outline" size="sm" disabled={busy} onClick={() => create()}><TbPlus aria-hidden />{t('terminal.drawer.new')}</Button></div></div> : null}
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
          toolbarContainer={null}
          onExit={(exit) => recordExit(item.terminalId, exit)}
          onSessionChange={(session) => setSessions((current) => current.map((value) => value.terminalId === session.terminalId ? exitLedger.current.apply({ ...value, status: session.status, exitCode: session.exitCode, signal: session.signal }) : value))}
        />
      </React.Suspense>
    </div>)}
    {selected?.status === 'exited' ? <div role="status" className="flex shrink-0 items-center gap-2 border-t border-border px-3 py-1 text-caption text-muted-foreground"><span className="min-w-0 flex-1 truncate">{t('inspector.terminal.exited', { code: selected.exitCode ?? -1 })}</span><Button variant="ghost" size="xs" disabled={busy} onClick={restart}><TbRefresh aria-hidden />{t('terminal.drawer.restart')}</Button></div> : null}
    <SettingsSheet open={Boolean(renaming)} onOpenChange={(next) => { if (!next && !busy) setRenaming(null) }} title={t('terminal.drawer.rename')} description={t('terminal.drawer.renameDescription')}
      onOpenAutoFocus={(event) => { event.preventDefault(); requestAnimationFrame(() => { const input = document.getElementById(titleInputId) as HTMLInputElement | null; input?.focus(); input?.select() }) }}
      footer={<div className="flex justify-end gap-2"><Button type="button" variant="outline" className="min-w-[76px]" disabled={busy} onClick={() => setRenaming(null)}>{t('common.cancel')}</Button>
        <Button type="submit" form={`${titleInputId}-form`} className="min-w-[76px]" disabled={busy || !title.trim()}>{t('common.save')}</Button></div>}>
      <form id={`${titleInputId}-form`} onSubmit={(event) => void rename(event)}>
        <SettingsGroup>
          <SettingsField label={t('terminal.drawer.name')} htmlFor={titleInputId} error={renameError ? <span id={`${titleInputId}-error`}>{renameError}</span> : undefined}>
            <Input id={titleInputId} value={title} maxLength={128} autoComplete="off" onChange={(event) => setTitle(event.target.value)} aria-invalid={Boolean(renameError)} aria-describedby={renameError ? `${titleInputId}-error` : undefined} />
          </SettingsField>
        </SettingsGroup>
      </form>
    </SettingsSheet>
  </div>
}
