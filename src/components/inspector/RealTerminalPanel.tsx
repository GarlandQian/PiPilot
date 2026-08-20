import * as React from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { useT } from '@/i18n'
import type { PiPilotApi } from '@/shared/pipilot-api'
import type { ConversationScope } from '@/shared/conversation-scope'
import {
  TERMINAL_INPUT_LIMIT,
  type TerminalEvent,
} from '@/shared/terminal'
import { useSettings } from '@/store/settings'
import { resolveTerminalFontStack } from '@/lib/terminal-fonts'
import { applyTerminalTypography } from './terminal-typography'

type TerminalStatus = 'starting' | 'running' | 'exited' | 'error'

interface RealTerminalPanelProps {
  terminalApi: PiPilotApi['terminal']
  scope: ConversationScope
}

function scopeKey(scope: ConversationScope) {
  return scope.kind === 'project'
    ? `project:${scope.workspaceId}`
    : 'projectless'
}

function terminalTheme() {
  const styles = getComputedStyle(document.documentElement)
  const token = (name: string, fallback: string) =>
    styles.getPropertyValue(name).trim() || fallback
  return {
    background: token('--color-sidebar', 'hsl(240 6% 7%)'),
    foreground: token('--color-foreground', 'hsl(240 6% 89%)'),
    cursor: token('--color-sage', 'hsl(172 26% 62%)'),
    cursorAccent: token('--color-sidebar', 'hsl(240 6% 7%)'),
    selectionBackground: token('--color-accent', 'hsl(240 5% 18%)'),
    black: token('--color-background', 'hsl(240 6% 8.5%)'),
    red: token('--color-destructive', 'hsl(0 50% 62%)'),
    green: token('--color-sage', 'hsl(172 26% 62%)'),
    yellow: token('--color-warning', 'hsl(38 55% 62%)'),
    blue: token('--color-ring', 'hsl(172 26% 62%)'),
    magenta: token('--color-destructive', 'hsl(0 50% 62%)'),
    cyan: token('--color-sage', 'hsl(172 26% 62%)'),
    white: token('--color-foreground', 'hsl(240 6% 89%)'),
    brightBlack: token('--color-muted-foreground', 'hsl(240 6% 70%)'),
    brightRed: token('--color-destructive', 'hsl(0 50% 62%)'),
    brightGreen: token('--color-sage', 'hsl(172 26% 62%)'),
    brightYellow: token('--color-warning', 'hsl(38 55% 62%)'),
    brightBlue: token('--color-ring', 'hsl(172 26% 62%)'),
    brightMagenta: token('--color-destructive', 'hsl(0 50% 62%)'),
    brightCyan: token('--color-sage', 'hsl(172 26% 62%)'),
    brightWhite: token('--color-foreground', 'hsl(240 6% 89%)'),
  }
}

function splitInput(value: string) {
  const chunks: string[] = []
  let remaining = value
  while (remaining.length > 0) {
    let end = Math.min(TERMINAL_INPUT_LIMIT, remaining.length)
    const last = remaining.charCodeAt(end - 1)
    if (last >= 0xd800 && last <= 0xdbff) end -= 1
    chunks.push(remaining.slice(0, end))
    remaining = remaining.slice(end)
  }
  return chunks
}

export function RealTerminalPanel({
  terminalApi,
  scope,
}: RealTerminalPanelProps) {
  const t = useT()
  const { appearance, terminal: terminalSettings } = useSettings()
  const containerRef = React.useRef<HTMLDivElement>(null)
  const terminalRef = React.useRef<Terminal | undefined>(undefined)
  const fitAddonRef = React.useRef<FitAddon | undefined>(undefined)
  const terminalIdRef = React.useRef<string | undefined>(undefined)
  const scopeRef = React.useRef(scope)
  const translateRef = React.useRef(t)
  const wordWrapRef = React.useRef(appearance.wordWrap)
  const fontSizeRef = React.useRef(terminalSettings.fontSize)
  const inputChainRef = React.useRef(Promise.resolve())
  const pendingCommandRef = React.useRef<string | undefined>(undefined)
  const [command, setCommand] = React.useState('')
  const [status, setStatus] = React.useState<TerminalStatus>('starting')
  const [dimensions, setDimensions] = React.useState({ cols: 80, rows: 24 })
  const [generation, setGeneration] = React.useState(0)
  const activeScopeKey = scopeKey(scope)
  const terminalFontStack = resolveTerminalFontStack(terminalSettings.fontFamily)

  scopeRef.current = scope
  translateRef.current = t
  wordWrapRef.current = appearance.wordWrap
  fontSizeRef.current = terminalSettings.fontSize

  const sendInput = React.useCallback((data: string) => {
    const terminalId = terminalIdRef.current
    if (!terminalId || data.length === 0) return
    for (const chunk of splitInput(data)) {
      inputChainRef.current = inputChainRef.current
        .then(() => terminalApi.input(scopeRef.current, terminalId, chunk))
        .then(() => undefined)
        .catch(() => {
          setStatus('error')
        })
    }
  }, [activeScopeKey, terminalApi])

  React.useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let disposed = false
    let lastSequence = 0
    let activeTerminalId: string | undefined
    let resizeFrame = 0
    const pendingEvents: TerminalEvent[] = []
    inputChainRef.current = Promise.resolve()

    const terminal = new Terminal({
      allowTransparency: false,
      convertEol: false,
      cursorBlink: true,
      cursorStyle: 'block',
      fontFamily: terminalFontStack,
      fontSize: terminalSettings.fontSize,
      lineHeight: 1.5,
      macOptionIsMeta: true,
      rightClickSelectsWord: true,
      screenReaderMode: true,
      scrollback: 5_000,
      theme: terminalTheme(),
    })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(container)
    terminal.textarea?.setAttribute(
      'aria-label',
      translateRef.current('inspector.terminal.interactiveInput'),
    )
    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    const fit = () => {
      if (disposed) return
      const proposed = fitAddon.proposeDimensions()
      if (!proposed) return
      const cols = wordWrapRef.current
        ? proposed.cols
        : Math.max(120, proposed.cols)
      const rows = proposed.rows
      if (cols < 2 || rows < 1) return
      terminal.resize(cols, rows)
      setDimensions({ cols, rows })
      if (terminal.element) {
        terminal.element.style.minWidth = wordWrapRef.current
          ? '0'
          : `${Math.ceil(cols * fontSizeRef.current * 0.62)}px`
      }
    }
    const scheduleFit = () => {
      cancelAnimationFrame(resizeFrame)
      resizeFrame = requestAnimationFrame(fit)
    }
    const cancelInitialTypographyFit = applyTerminalTypography({
      terminal,
      fitAddon,
      container,
      fontFamily: terminalFontStack,
      fontSize: terminalSettings.fontSize,
      wordWrap: wordWrapRef.current,
      onDimensions: setDimensions,
    })

    const processEvent = (event: TerminalEvent) => {
      if (
        scopeKey(event.scope) !== activeScopeKey ||
        event.terminalId !== activeTerminalId ||
        event.sequence <= lastSequence
      ) return
      lastSequence = event.sequence
      if (event.type === 'data') {
        if (event.truncated) {
          terminal.write(
            `\r\n${translateRef.current('inspector.terminal.outputTruncated')}\r\n`,
          )
        }
        terminal.write(event.data)
      } else {
        terminal.write(
          `\r\n${translateRef.current('inspector.terminal.exited', {
            code: event.exitCode,
          })}\r\n`,
        )
        setStatus('exited')
        terminalIdRef.current = undefined
      }
    }

    const unsubscribe = terminalApi.subscribe((event) => {
      if (scopeKey(event.scope) !== activeScopeKey) return
      if (!activeTerminalId) pendingEvents.push(event)
      else processEvent(event)
    })
    const dataDisposable = terminal.onData(sendInput)
    const resizeDisposable = terminal.onResize(({ cols, rows }) => {
      setDimensions({ cols, rows })
      const terminalId = terminalIdRef.current
      if (!terminalId) return
      void terminalApi.resize(scopeRef.current, terminalId, cols, rows).catch(() => {
        setStatus('error')
      })
    })
    const observer = new ResizeObserver(scheduleFit)
    observer.observe(container)

    const proposed = fitAddon.proposeDimensions()
    const initialCols = wordWrapRef.current
      ? proposed?.cols ?? 80
      : Math.max(120, proposed?.cols ?? 80)
    const initialRows = proposed?.rows ?? 24
    void terminalApi.create(scopeRef.current, initialCols, initialRows)
      .then((session) => {
        if (disposed) return
        activeTerminalId = session.terminalId
        terminalIdRef.current = session.terminalId
        lastSequence = session.sequence
        terminal.write(session.replay)
        terminal.resize(session.cols, session.rows)
        setDimensions({ cols: session.cols, rows: session.rows })
        setStatus('running')
        for (const event of pendingEvents.sort(
          (left, right) => left.sequence - right.sequence,
        )) processEvent(event)
        pendingEvents.length = 0
        const pendingCommand = pendingCommandRef.current
        pendingCommandRef.current = undefined
        if (pendingCommand) sendInput(`${pendingCommand}\r`)
        scheduleFit()
        terminal.focus()
      })
      .catch(() => {
        if (!disposed) setStatus('error')
      })

    return () => {
      disposed = true
      cancelAnimationFrame(resizeFrame)
      cancelInitialTypographyFit()
      observer.disconnect()
      unsubscribe()
      dataDisposable.dispose()
      resizeDisposable.dispose()
      terminal.dispose()
      terminalRef.current = undefined
      fitAddonRef.current = undefined
      terminalIdRef.current = undefined
    }
  // The PTY remains owned by Main across tab remounts; settings update below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeScopeKey, generation, sendInput, terminalApi])

  React.useLayoutEffect(() => {
    const terminal = terminalRef.current
    const container = containerRef.current
    if (!terminal || !container) return
    return applyTerminalTypography({
      terminal,
      fitAddon: fitAddonRef.current,
      container,
      fontFamily: terminalFontStack,
      fontSize: terminalSettings.fontSize,
      wordWrap: wordWrapRef.current,
      onDimensions: setDimensions,
    })
  }, [terminalFontStack, terminalSettings.fontSize])

  React.useLayoutEffect(() => {
    const terminal = terminalRef.current
    const container = containerRef.current
    if (!terminal || !container) return
    terminal.textarea?.setAttribute(
      'aria-label',
      t('inspector.terminal.interactiveInput'),
    )
    container.style.fontVariantLigatures = appearance.codeLigatures ? 'normal' : 'none'
    container.style.fontFeatureSettings = appearance.codeLigatures
      ? 'normal'
      : "'liga' off, 'calt' off"
    const frame = requestAnimationFrame(() => {
      terminal.options.theme = terminalTheme()
      const proposed = fitAddonRef.current?.proposeDimensions()
      if (!proposed) return
      const cols = appearance.wordWrap ? proposed.cols : Math.max(120, proposed.cols)
      if (terminal.element) {
        terminal.element.style.minWidth = appearance.wordWrap
          ? '0'
          : `${Math.ceil(cols * fontSizeRef.current * 0.62)}px`
      }
      terminal.resize(cols, proposed.rows)
      setDimensions({ cols, rows: proposed.rows })
    })
    return () => cancelAnimationFrame(frame)
  }, [appearance.codeLigatures, appearance.theme, appearance.wordWrap, t])

  const submitCommand = (event: React.FormEvent) => {
    event.preventDefault()
    if (command.length === 0 || status === 'starting') return
    if (status === 'running') sendInput(`${command}\r`)
    else {
      pendingCommandRef.current = command
      setStatus('starting')
      setGeneration((value) => value + 1)
    }
    setCommand('')
    terminalRef.current?.focus()
  }

  return (
    <div
      className="flex h-full flex-col"
      data-terminal-status={status}
      data-terminal-cols={dimensions.cols}
      data-terminal-rows={dimensions.rows}
      data-terminal-font-family={terminalSettings.fontFamily || 'system'}
      data-terminal-effective-font-family={terminalFontStack}
      data-terminal-font-size={terminalSettings.fontSize}
      data-terminal-ligatures={appearance.codeLigatures}
      data-terminal-word-wrap={appearance.wordWrap}
    >
      <div className="scroll-slim terminal-body relative min-h-0 flex-1 overflow-auto p-2">
        <div
          ref={containerRef}
          className="h-full min-h-0 w-full"
          role="application"
          aria-label={t('inspector.terminal.output')}
          onClick={() => terminalRef.current?.focus()}
        />
        {status === 'starting' && (
          <p className="pointer-events-none absolute inset-x-2 top-2 text-muted-foreground">
            {t('inspector.terminal.starting')}
          </p>
        )}
        {status === 'error' && (
          <p className="pointer-events-none absolute inset-x-2 top-2 text-destructive">
            {t('inspector.terminal.error')}
          </p>
        )}
      </div>
      <form className="border-t border-border p-1.5" onSubmit={submitCommand}>
        <label htmlFor="terminal-input" className="sr-only">
          {t('inspector.terminal.input')}
        </label>
        <input
          id="terminal-input"
          name="terminal-command"
          autoComplete="off"
          spellCheck={false}
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          placeholder={status === 'running'
            ? t('inspector.terminal.placeholder')
            : t('inspector.terminal.restartPlaceholder')}
          disabled={status === 'starting'}
          className="terminal-body w-full rounded border border-input bg-input px-2 py-1 text-foreground outline-none placeholder:text-muted-foreground/50 focus:border-ring/60 disabled:opacity-60"
          style={{ fontFamily: terminalFontStack, fontSize: terminalSettings.fontSize }}
        />
      </form>
    </div>
  )
}
