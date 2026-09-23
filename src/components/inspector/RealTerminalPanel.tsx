import * as React from 'react'
import { createPortal } from 'react-dom'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import { TbArrowDown, TbArrowUp, TbCheck, TbChevronDown, TbCopy, TbEraser, TbSearch, TbX } from 'react-icons/tb'
import '@xterm/xterm/css/xterm.css'
import { useT } from '@/i18n'
import type { PiPilotApi } from '@/shared/pipilot-api'
import type { ConversationScope } from '@/shared/conversation-scope'
import type { TerminalEvent, TerminalSummary } from '@/shared/terminal'
import { useSettings } from '@/store/settings'
import { resolveTerminalFontStack } from '@/lib/terminal-fonts'
import { applyTerminalTypography } from './terminal-typography'
import { findTerminalMatches, splitTerminalInput, terminalBufferText, terminalShortcut, type TerminalSearchMatch } from './terminal-surface'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

type TerminalStatus = 'starting' | 'running' | 'exited' | 'error'

export interface RealTerminalPanelHandle {
  focus(): void
  find(): void
  copy(): Promise<void>
  paste(): Promise<void>
  clear(): Promise<void>
}

interface RealTerminalPanelProps {
  terminalApi: PiPilotApi['terminal']
  scope: ConversationScope
  terminalId: string
  visible?: boolean
  autoFocus?: boolean
  toolbarContainer?: HTMLElement | null
  onExit?: (event: { exitCode: number; signal?: number }) => void
  onError?: (message: string) => void
  onSessionChange?: (session: TerminalSummary) => void
}

function scopeKey(scope: ConversationScope) {
  return scope.kind === 'project' ? `project:${scope.workspaceId}` : 'projectless'
}

function terminalTheme() {
  const styles = getComputedStyle(document.documentElement)
  const token = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback
  const dark = document.documentElement.classList.contains('dark')
  return {
    background: token('--color-sidebar', dark ? '#111113' : '#fafafa'),
    foreground: token('--color-foreground', dark ? '#e3e3e5' : '#252529'),
    cursor: token('--color-sage', '#83b7ac'),
    cursorAccent: token('--color-sidebar', dark ? '#111113' : '#fafafa'),
    selectionBackground: dark ? '#465668' : '#c2d8ec',
    selectionInactiveBackground: dark ? '#353d49' : '#d8e2ec',
    // ANSI categories remain distinct from the app's semantic accent palette.
    black: dark ? '#34343b' : '#282c34',
    red: dark ? '#e88388' : '#ad2535',
    green: dark ? '#96c88d' : '#377331',
    yellow: dark ? '#dfbf7c' : '#8c660d',
    blue: dark ? '#83aff0' : '#285fab',
    magenta: dark ? '#c79be5' : '#8645a7',
    cyan: dark ? '#7dc9d0' : '#1b737c',
    white: dark ? '#d8d8df' : '#666974',
    brightBlack: dark ? '#9393a0' : '#737682',
    brightRed: dark ? '#f3a2a6' : '#c13748',
    brightGreen: dark ? '#b2dca7' : '#46843b',
    brightYellow: dark ? '#f0d59c' : '#9b7215',
    brightBlue: dark ? '#a4c7fb' : '#3975c6',
    brightMagenta: dark ? '#dcbaef' : '#a15bbd',
    brightCyan: dark ? '#a0dfe3' : '#238591',
    brightWhite: dark ? '#ffffff' : '#353941',
  }
}

export const RealTerminalPanel = React.forwardRef<RealTerminalPanelHandle, RealTerminalPanelProps>(function RealTerminalPanel({
  terminalApi, scope, terminalId, visible = true, autoFocus = true, toolbarContainer, onExit, onError, onSessionChange,
}, ref) {
  const t = useT()
  const { appearance, terminal: terminalSettings } = useSettings()
  const containerRef = React.useRef<HTMLDivElement>(null)
  const searchInputRef = React.useRef<HTMLInputElement>(null)
  const terminalRef = React.useRef<Terminal | undefined>(undefined)
  const fitAddonRef = React.useRef<FitAddon | undefined>(undefined)
  const scopeRef = React.useRef(scope)
  const visibleRef = React.useRef(visible)
  const autoFocusRef = React.useRef(autoFocus)
  const translateRef = React.useRef(t)
  const callbacksRef = React.useRef({ onExit, onError, onSessionChange })
  const searchQueryRef = React.useRef('')
  const searchOpenRef = React.useRef(false)
  const searchTimerRef = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const matchesRef = React.useRef<TerminalSearchMatch[]>([])
  const selectedMatchRef = React.useRef(-1)
  const [initialized, setInitialized] = React.useState(visible)
  const [status, setStatus] = React.useState<TerminalStatus>('starting')
  const [dimensions, setDimensions] = React.useState({ cols: 80, rows: 24 })
  const [generation, setGeneration] = React.useState(0)
  const [hasSelection, setHasSelection] = React.useState(false)
  const [copyState, setCopyState] = React.useState<'idle' | 'copied'>('idle')
  const [error, setError] = React.useState<string | undefined>()
  const [searchOpen, setSearchOpen] = React.useState(false)
  const [searchQuery, setSearchQuery] = React.useState('')
  const [searchResult, setSearchResult] = React.useState({ index: -1, total: 0 })
  const [hasNewOutput, setHasNewOutput] = React.useState(false)
  const [scrolledBack, setScrolledBack] = React.useState(false)
  const activeScopeKey = scopeKey(scope)
  const terminalFontStack = resolveTerminalFontStack(terminalSettings.fontFamily)
  const typographyRef = React.useRef({ fontFamily: terminalFontStack, fontSize: terminalSettings.fontSize })

  scopeRef.current = scope
  visibleRef.current = visible
  autoFocusRef.current = autoFocus
  translateRef.current = t
  callbacksRef.current = { onExit, onError, onSessionChange }
  searchQueryRef.current = searchQuery
  searchOpenRef.current = searchOpen
  typographyRef.current = { fontFamily: terminalFontStack, fontSize: terminalSettings.fontSize }

  const reportError = React.useCallback((message: string) => {
    setError(message)
    callbacksRef.current.onError?.(message)
  }, [])

  const focus = React.useCallback(() => {
    if (visibleRef.current) terminalRef.current?.focus()
  }, [])

  const find = React.useCallback(() => {
    if (!visibleRef.current) return
    setSearchOpen(true)
    requestAnimationFrame(() => {
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
    })
  }, [])

  const copy = React.useCallback(async (all = false) => {
    const terminal = terminalRef.current
    if (!terminal) return
    const text = all ? terminalBufferText(terminal.buffer.active, terminal.cols) : terminal.getSelection()
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      if (terminalRef.current !== terminal) return
      setCopyState('copied')
      setError(undefined)
    } catch {
      if (terminalRef.current === terminal) reportError(translateRef.current('md.copyFailed'))
    }
  }, [reportError])

  const paste = React.useCallback(async () => {
    const terminal = terminalRef.current
    if (!terminal || terminal.options.disableStdin || !visibleRef.current) return
    try {
      const text = await navigator.clipboard.readText()
      if (terminalRef.current !== terminal || terminal.options.disableStdin || !visibleRef.current) return
      // xterm handles bracketed paste and newline normalization for the shell.
      terminal.paste(text)
      terminal.focus()
      setError(undefined)
    } catch {
      if (terminalRef.current === terminal) reportError(translateRef.current('terminal.surface.pasteFailed'))
    }
  }, [reportError])

  const clear = React.useCallback(async () => {
    const terminal = terminalRef.current
    const capturedScope = scopeRef.current
    if (!terminal || !visibleRef.current) return
    try {
      await terminalApi.clear(capturedScope, terminalId)
      if (terminalRef.current !== terminal) return
      await new Promise<void>((resolve) => {
        terminal.write('', () => {
          if (terminalRef.current === terminal) {
            terminal.clear()
            setHasNewOutput(false)
            setError(undefined)
            focus()
          }
          resolve()
        })
      })
    } catch {
      if (terminalRef.current === terminal) reportError(translateRef.current('terminal.surface.clearFailed'))
    }
  }, [terminalApi, terminalId, focus, reportError])

  React.useImperativeHandle(ref, () => ({
    focus, find, copy: () => copy(!terminalRef.current?.hasSelection()), paste, clear,
  }), [focus, find, copy, paste, clear])

  const selectMatch = React.useCallback((index: number) => {
    const terminal = terminalRef.current
    const matches = matchesRef.current
    if (!terminal || !matches.length) return
    const next = (index + matches.length) % matches.length
    const match = matches[next]
    selectedMatchRef.current = next
    setSearchResult({ index: next, total: matches.length })
    terminal.select(match.column, match.row, match.length)
    terminal.scrollToLine(Math.max(0, match.row - Math.floor(terminal.rows / 2)))
  }, [])

  const refreshSearch = React.useCallback((select: boolean) => {
    const terminal = terminalRef.current
    if (!terminal || !searchOpenRef.current) return
    const previous = matchesRef.current[selectedMatchRef.current]
    const matches = findTerminalMatches(terminal.buffer.active, terminal.cols, searchQueryRef.current)
    matchesRef.current = matches
    let index = previous ? matches.findIndex((match) => match.row === previous.row && match.column === previous.column) : -1
    if (select && matches.length) {
      index = matches.findIndex((match) => match.row >= terminal.buffer.active.viewportY)
      if (index < 0) index = 0
      selectMatch(index)
    } else {
      selectedMatchRef.current = index
      setSearchResult({ index, total: matches.length })
    }
    if (!matches.length && select) terminal.clearSelection()
  }, [selectMatch])
  const refreshSearchRef = React.useRef(refreshSearch)
  refreshSearchRef.current = refreshSearch

  React.useEffect(() => {
    if (!searchOpen) return
    clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => refreshSearch(true), 120)
    return () => clearTimeout(searchTimerRef.current)
  }, [searchOpen, searchQuery, refreshSearch])

  React.useLayoutEffect(() => {
    if (visible) setInitialized(true)
  }, [visible])

  React.useLayoutEffect(() => {
    const container = containerRef.current
    // Unopened background tabs must not resize a PTY to hidden fallback sizes.
    if (!container || !initialized) return
    let disposed = false
    let attached = false
    let running = false
    let lastSequence = 0
    let resizeFrame = 0
    let inputChain = Promise.resolve()
    const capturedScope = scopeRef.current
    const activationFocus = document.activeElement
    const pendingEvents: TerminalEvent[] = []
    setHasSelection(false)
    setCopyState('idle')
    setError(undefined)
    setHasNewOutput(false)
    setScrolledBack(false)
    setStatus('starting')

    const terminal = new Terminal({
      allowTransparency: false,
      convertEol: false,
      cursorBlink: true,
      cursorStyle: 'block',
      disableStdin: true,
      fontFamily: typographyRef.current.fontFamily,
      fontSize: typographyRef.current.fontSize,
      lineHeight: 1.4,
      macOptionIsMeta: true,
      rightClickSelectsWord: true,
      screenReaderMode: true,
      scrollback: 5_000,
      scrollOnUserInput: true,
      theme: terminalTheme(),
    })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(container)
    terminal.textarea?.setAttribute('aria-label', translateRef.current('inspector.terminal.interactiveInput'))
    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    const fit = () => {
      if (disposed || !visibleRef.current || container.clientHeight === 0 || container.clientWidth === 0) return
      const proposed = fitAddon.proposeDimensions()
      if (!proposed || proposed.cols < 2 || proposed.rows < 1) return
      terminal.resize(proposed.cols, proposed.rows)
      setDimensions({ cols: terminal.cols, rows: terminal.rows })
    }
    const scheduleFit = () => {
      cancelAnimationFrame(resizeFrame)
      resizeFrame = requestAnimationFrame(fit)
    }
    const themeObserver = new MutationObserver(() => { terminal.options.theme = terminalTheme() })
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    const observer = new ResizeObserver(scheduleFit)
    observer.observe(container)

    const processEvent = (event: TerminalEvent) => {
      if (disposed || event.terminalId !== terminalId || event.sequence <= lastSequence) return
      lastSequence = event.sequence
      if (event.type === 'data') {
        if (terminal.buffer.active.viewportY < terminal.buffer.active.baseY) setHasNewOutput(true)
        if (event.truncated) terminal.write(`\r\n${translateRef.current('inspector.terminal.outputTruncated')}\r\n`)
        // xterm keeps its viewport and selection when the reader is in scrollback.
        terminal.write(event.data)
      } else {
        running = false
        terminal.options.disableStdin = true
        setStatus('exited')
        callbacksRef.current.onExit?.({ exitCode: event.exitCode, signal: event.signal })
      }
    }
    const unsubscribe = terminalApi.subscribe((event) => {
      if (scopeKey(event.scope) !== activeScopeKey || event.terminalId !== terminalId) return
      if (!attached) pendingEvents.push(event)
      else processEvent(event)
    })
    const dataDisposable = terminal.onData((data) => {
      if (!running || !visibleRef.current) return
      for (const chunk of splitTerminalInput(data)) {
        inputChain = inputChain.then(async () => {
          // Queued paste chunks belong only to this exact mounted PTY session.
          if (disposed || !running) return
          await terminalApi.input(capturedScope, terminalId, chunk)
        }).catch(() => {
          if (!disposed) reportError(translateRef.current('inspector.terminal.error'))
        })
      }
    })
    const selectionDisposable = terminal.onSelectionChange(() => {
      setHasSelection(terminal.hasSelection())
      setCopyState('idle')
    })
    const scrollDisposable = terminal.onScroll(() => {
      const back = terminal.buffer.active.viewportY < terminal.buffer.active.baseY
      setScrolledBack(back)
      if (!back) setHasNewOutput(false)
    })
    const parsedDisposable = terminal.onWriteParsed(() => {
      if (!searchOpenRef.current || !searchQueryRef.current) return
      clearTimeout(searchTimerRef.current)
      searchTimerRef.current = setTimeout(() => refreshSearchRef.current(false), 150)
    })
    const resizeDisposable = terminal.onResize(({ cols, rows }) => {
      setDimensions({ cols, rows })
      if (!attached || !running || !visibleRef.current) return
      void terminalApi.resize(capturedScope, terminalId, cols, rows).catch(() => {
        if (!disposed) reportError(translateRef.current('inspector.terminal.error'))
      })
    })
    terminal.attachCustomKeyEventHandler((event) => {
      // Keep the drawer toggle available without sending a control byte.
      if (!event.isComposing && event.keyCode !== 229 && event.key === '`' && !event.altKey && (event.ctrlKey || event.metaKey)) return false
      const action = terminalShortcut(event)
      if (!action) return true
      if (event.type === 'keydown') {
        event.preventDefault()
        event.stopPropagation()
        if (action === 'find') find()
        else if (action === 'copy') void copy()
        else void paste()
      }
      return false
    })

    fit()
    void terminalApi.attach(capturedScope, terminalId, terminal.cols, terminal.rows)
      .then((session) => {
        if (disposed) return
        lastSequence = session.sequence
        // Replay is parsed at the PTY's columns; later visible fits can reflow it.
        terminal.resize(session.cols, session.rows)
        terminal.write(session.replay)
        running = session.status === 'running'
        attached = true
        terminal.options.disableStdin = !running
        setStatus(session.status)
        callbacksRef.current.onSessionChange?.(session)
        if (session.status === 'exited') callbacksRef.current.onExit?.({ exitCode: session.exitCode ?? -1, signal: session.signal })
        for (const event of pendingEvents.sort((left, right) => left.sequence - right.sequence)) processEvent(event)
        pendingEvents.length = 0
        scheduleFit()
        const activeElement = document.activeElement
        const ownsFocus = !activeElement || activeElement === document.body || activeElement === activationFocus || container.contains(activeElement)
        const dialogFocused = activeElement instanceof Element && Boolean(activeElement.closest('[role="dialog"], [role="alertdialog"]'))
        if (visibleRef.current && autoFocusRef.current && !searchOpenRef.current && ownsFocus && !dialogFocused) terminal.focus()
      })
      .catch(() => {
        if (disposed) return
        setStatus('error')
        reportError(translateRef.current('inspector.terminal.error'))
      })

    return () => {
      disposed = true
      running = false
      cancelAnimationFrame(resizeFrame)
      clearTimeout(searchTimerRef.current)
      observer.disconnect()
      themeObserver.disconnect()
      unsubscribe()
      dataDisposable.dispose()
      selectionDisposable.dispose()
      scrollDisposable.dispose()
      parsedDisposable.dispose()
      resizeDisposable.dispose()
      terminal.dispose()
      if (terminalRef.current === terminal) {
        terminalRef.current = undefined
        fitAddonRef.current = undefined
      }
    }
  }, [activeScopeKey, terminalId, initialized, generation, terminalApi, copy, find, paste, reportError])

  React.useLayoutEffect(() => {
    const terminal = terminalRef.current
    const container = containerRef.current
    if (!terminal || !container || !visible) return
    return applyTerminalTypography({
      terminal, fitAddon: fitAddonRef.current, container,
      fontFamily: terminalFontStack, fontSize: terminalSettings.fontSize,
      onDimensions: setDimensions,
    })
  }, [terminalFontStack, terminalSettings.fontSize, visible, initialized, generation])

  React.useEffect(() => {
    if (!visible) terminalRef.current?.blur()
    else if (autoFocus && !searchOpenRef.current) focus()
  }, [visible, autoFocus, focus])

  React.useLayoutEffect(() => {
    const terminal = terminalRef.current
    const container = containerRef.current
    if (!terminal || !container) return
    terminal.textarea?.setAttribute('aria-label', t('inspector.terminal.interactiveInput'))
    container.style.fontVariantLigatures = appearance.codeLigatures ? 'normal' : 'none'
    container.style.fontFeatureSettings = appearance.codeLigatures ? 'normal' : "'liga' off, 'calt' off"
    terminal.options.theme = terminalTheme()
  }, [appearance.codeLigatures, appearance.theme, t, initialized, generation])

  const closeSearch = () => {
    setSearchOpen(false)
    clearTimeout(searchTimerRef.current)
    focus()
  }

  const toolbarControls = <>
    <Button variant="ghost" size="icon-xs" aria-label={t('terminal.surface.search')} title={t('terminal.surface.search')} aria-expanded={searchOpen} onClick={find}><TbSearch aria-hidden /></Button>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="xs" className="gap-0.5 px-1" aria-label={t('terminal.surface.copy')} title={t('terminal.surface.copy')}>
          {copyState === 'copied' ? <TbCheck aria-hidden /> : <TbCopy aria-hidden />}<TbChevronDown aria-hidden className="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onCloseAutoFocus={(event) => { event.preventDefault(); focus() }}>
        <DropdownMenuLabel className="text-micro font-normal tabular-nums text-muted-foreground">{dimensions.cols} × {dimensions.rows}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!hasSelection} onSelect={() => void copy()}>{t('terminal.surface.copySelection')}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void copy(true)}>{t('terminal.surface.copyAll')}</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={status !== 'running'} onSelect={() => void paste()}>{t('terminal.surface.paste')}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <Button variant="ghost" size="icon-xs" disabled={status === 'starting' || status === 'error'} aria-label={t('workbenchReview.terminal.clear')} title={t('workbenchReview.terminal.clear')} onClick={() => void clear()}><TbEraser aria-hidden /></Button>
  </>

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      data-terminal-id={terminalId}
      data-terminal-status={status}
      data-terminal-cols={dimensions.cols}
      data-terminal-rows={dimensions.rows}
      data-terminal-font-family={terminalSettings.fontFamily || 'system'}
      data-terminal-effective-font-family={terminalFontStack}
      data-terminal-font-size={terminalSettings.fontSize}
      data-terminal-ligatures={appearance.codeLigatures}
      data-terminal-word-wrap="true"
      onKeyDownCapture={(event) => {
        if (terminalShortcut(event.nativeEvent) === 'find') {
          event.preventDefault()
          event.stopPropagation()
          find()
        }
      }}
    >
      {toolbarContainer === undefined
        ? <div className="flex h-8 shrink-0 items-center justify-end gap-1 border-b border-border/60 px-2">{toolbarControls}</div>
        : visible && toolbarContainer ? createPortal(toolbarControls, toolbarContainer) : null}
      {searchOpen ? (
        <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1" role="search" aria-label={t('terminal.surface.search')}>
          <TbSearch aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            ref={searchInputRef}
            aria-label={t('terminal.surface.search')}
            placeholder={t('terminal.surface.searchPlaceholder')}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.keyCode === 229) return
              if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeSearch() }
              if (event.key === 'Enter') { event.preventDefault(); selectMatch(selectedMatchRef.current + (event.shiftKey ? -1 : 1)) }
            }}
            className="min-w-0 flex-1 bg-transparent px-1 py-0.5 text-caption outline-none"
            autoComplete="off"
            spellCheck={false}
          />
          <span className="shrink-0 text-micro tabular-nums text-muted-foreground" role="status">{searchQuery ? searchResult.total ? t('terminal.surface.matches', { current: searchResult.index + 1, total: searchResult.total }) : t('terminal.surface.noMatches') : ''}</span>
          <Button variant="ghost" size="icon-xs" disabled={!searchResult.total} aria-label={t('terminal.surface.previousMatch')} onClick={() => selectMatch(selectedMatchRef.current - 1)}><TbArrowUp aria-hidden /></Button>
          <Button variant="ghost" size="icon-xs" disabled={!searchResult.total} aria-label={t('terminal.surface.nextMatch')} onClick={() => selectMatch(selectedMatchRef.current + 1)}><TbArrowDown aria-hidden /></Button>
          <Button variant="ghost" size="icon-xs" aria-label={t('terminal.surface.closeSearch')} onClick={closeSearch}><TbX aria-hidden /></Button>
        </div>
      ) : null}
      {error ? <div role="alert" className="flex shrink-0 items-center gap-2 px-3 py-1 text-caption text-destructive"><span className="min-w-0 flex-1">{error}</span>{status === 'error' ? <Button variant="ghost" size="xs" onClick={() => setGeneration((value) => value + 1)}>{t('terminal.surface.retry')}</Button> : <Button variant="ghost" size="icon-xs" aria-label={t('common.close')} onClick={() => setError(undefined)}><TbX aria-hidden /></Button>}</div> : null}
      <div className="relative min-h-0 flex-1 overflow-hidden p-2">
        <div ref={containerRef} className="h-full min-h-0 w-full" role="application" aria-label={t('inspector.terminal.output')} />
        {scrolledBack ? (
          <Button variant="secondary" size="xs" className="absolute right-4 bottom-3 gap-1 shadow-sm" onClick={() => { terminalRef.current?.scrollToBottom(); setHasNewOutput(false); focus() }}>
            <TbArrowDown aria-hidden />{t(hasNewOutput ? 'terminal.surface.newOutput' : 'workbenchReview.terminal.latest')}
          </Button>
        ) : null}
      </div>
    </div>
  )
})
