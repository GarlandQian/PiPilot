export interface TerminalTypographyStyle {
  fontFamily?: string
  fontSize?: string
  minWidth?: string
}

interface StyledTarget {
  style: TerminalTypographyStyle
}

export interface TerminalTypographyTarget {
  options: {
    fontFamily?: string
    fontSize?: number
  }
  element?: StyledTarget | null
  textarea?: StyledTarget | null
  resize(cols: number, rows: number): void
}

export interface TerminalDimensionProposer {
  proposeDimensions(): { cols: number; rows: number } | undefined
}

export interface TerminalFrameScheduler {
  request(callback: FrameRequestCallback): number
  cancel(handle: number): void
}

export const browserTerminalFrameScheduler: TerminalFrameScheduler = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle),
}

interface ApplyTerminalTypographyOptions {
  terminal: TerminalTypographyTarget
  fitAddon: TerminalDimensionProposer | undefined
  container: StyledTarget
  fontFamily: string
  fontSize: number
  wordWrap: boolean
  scheduler?: TerminalFrameScheduler
  onDimensions(dimensions: { cols: number; rows: number }): void
}

export function applyTerminalTypography({
  terminal,
  fitAddon,
  container,
  fontFamily,
  fontSize,
  wordWrap,
  scheduler = browserTerminalFrameScheduler,
  onDimensions,
}: ApplyTerminalTypographyOptions): () => void {
  terminal.options.fontFamily = fontFamily
  terminal.options.fontSize = fontSize

  const pixelSize = `${fontSize}px`
  for (const target of [container, terminal.element, terminal.textarea]) {
    if (!target) continue
    target.style.fontFamily = fontFamily
    target.style.fontSize = pixelSize
  }

  const frame = scheduler.request(() => {
    const proposed = fitAddon?.proposeDimensions()
    if (!proposed || proposed.cols < 2 || proposed.rows < 1) return
    const cols = wordWrap ? proposed.cols : Math.max(120, proposed.cols)
    if (terminal.element) {
      terminal.element.style.minWidth = wordWrap
        ? '0'
        : `${Math.ceil(cols * fontSize * 0.62)}px`
    }
    terminal.resize(cols, proposed.rows)
    onDimensions({ cols, rows: proposed.rows })
  })

  return () => scheduler.cancel(frame)
}
