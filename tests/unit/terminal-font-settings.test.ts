import { describe, expect, it, vi } from 'vitest'
import {
  applyTerminalTypography,
  type TerminalTypographyStyle,
} from '../../src/components/inspector/terminal-typography'
import {
  DEFAULT_TERMINAL_FONT_STACK,
  resolveTerminalFontStack,
  sanitizeTerminalFontFamily,
} from '../../src/lib/terminal-fonts'

describe('terminal font resolution', () => {
  it('uses an explicit cross-platform stack with CJK fallbacks', () => {
    expect(resolveTerminalFontStack('')).toBe(DEFAULT_TERMINAL_FONT_STACK)
    expect(DEFAULT_TERMINAL_FONT_STACK).toContain('"Sarasa Mono SC"')
    expect(DEFAULT_TERMINAL_FONT_STACK).toContain('"Noto Sans Mono CJK SC"')
    expect(DEFAULT_TERMINAL_FONT_STACK).toContain('"PingFang SC"')
    expect(DEFAULT_TERMINAL_FONT_STACK).toContain('"Microsoft YaHei"')
    expect(DEFAULT_TERMINAL_FONT_STACK).toContain('"WenQuanYi Micro Hei Mono"')
    expect(DEFAULT_TERMINAL_FONT_STACK.endsWith('monospace')).toBe(true)
  })

  it('quotes one local family and strips CSS fragments before falling back', () => {
    expect(sanitizeTerminalFontFamily('  "Maple Mono"; serif  ')).toBe('Maple Mono serif')
    expect(resolveTerminalFontStack('"Maple Mono"; serif')).toBe(
      `"Maple Mono serif", ${DEFAULT_TERMINAL_FONT_STACK}`,
    )
    expect(resolveTerminalFontStack('Font That Is Not Installed')).toContain(
      `"Font That Is Not Installed", ${DEFAULT_TERMINAL_FONT_STACK}`,
    )
  })
})

describe('live terminal typography', () => {
  it('updates the same terminal and schedules one bounded refit', () => {
    const resize = vi.fn()
    const elementStyle: TerminalTypographyStyle = {}
    const textareaStyle: TerminalTypographyStyle = {}
    const terminal = {
      options: {},
      element: { style: elementStyle },
      textarea: { style: textareaStyle },
      resize,
    }
    const identity = terminal
    const callbacks: FrameRequestCallback[] = []
    const scheduler = {
      request: vi.fn((callback: FrameRequestCallback) => {
        callbacks.push(callback)
        return 7
      }),
      cancel: vi.fn(),
    }
    const onDimensions = vi.fn()
    const stack = resolveTerminalFontStack('Maple Mono')

    const dispose = applyTerminalTypography({
      terminal,
      fitAddon: { proposeDimensions: () => ({ cols: 80, rows: 24 }) },
      container: { style: {} },
      fontFamily: stack,
      fontSize: 16,
      wordWrap: false,
      scheduler,
      onDimensions,
    })

    expect(terminal).toBe(identity)
    expect(terminal.options).toEqual({ fontFamily: stack, fontSize: 16 })
    expect(terminal.textarea.style).toMatchObject({ fontFamily: stack, fontSize: '16px' })
    expect(scheduler.request).toHaveBeenCalledTimes(1)
    expect(resize).not.toHaveBeenCalled()

    callbacks[0](0)
    expect(resize).toHaveBeenCalledOnce()
    expect(resize).toHaveBeenCalledWith(120, 24)
    expect(elementStyle.minWidth).toBe('1191px')
    expect(onDimensions).toHaveBeenCalledWith({ cols: 120, rows: 24 })

    dispose()
    expect(scheduler.cancel).toHaveBeenCalledWith(7)
  })
})
