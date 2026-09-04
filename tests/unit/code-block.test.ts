import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { CodeBlock } from '../../src/components/chat/markdown/CodeBlock'
import { TooltipProvider } from '../../src/components/ui/tooltip'

vi.mock('@/i18n', () => ({
  useT: () => (key: string) => key,
}))

vi.mock('@/store/settings', () => ({
  useSettings: () => ({
    appearance: { showLineNumbers: true, wordWrap: true },
  }),
}))

function renderLines(lineCount: number) {
  const code = Array.from({ length: lineCount }, (_, index) => `line ${index + 1}`).join('\n')
  return renderToStaticMarkup(createElement(
    TooltipProvider,
    null,
    createElement(CodeBlock, { code, allowCollapse: false }),
  ))
}

function gutterAttributes(markup: string) {
  const match = markup.match(
    /<span aria-hidden="true" class="([^"]*\bcode-line-no\b[^"]*)" style="([^"]*)">/,
  )

  expect(match).not.toBeNull()
  return { className: match![1], style: match![2] }
}

describe('CodeBlock line-number gutter', () => {
  it.each([
    [9, '2ch'],
    [10, '3ch'],
    [99, '3ch'],
    [100, '4ch'],
  ])('keeps the gutter stable for %i lines', (lineCount, expectedWidth) => {
    const markup = renderLines(lineCount)

    const gutter = gutterAttributes(markup)

    expect(gutter.style).toBe(`min-width:${expectedWidth};width:${expectedWidth}`)
    expect(gutter.className).toContain('shrink-0')
    expect(gutter.className).toContain('whitespace-nowrap')
    expect(gutter.className).not.toMatch(/(?:^|\s)p(?:[trblxy])?-(?:\S+)/)
    expect(gutter.style).not.toMatch(/(?:^|;)padding(?:-[a-z]+)?:/)
    expect(markup).toContain(`class="block">${lineCount}</span>`)
  })
})
