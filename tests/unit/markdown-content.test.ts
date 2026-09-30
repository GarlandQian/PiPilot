import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { MarkdownContent } from '../../src/components/chat/markdown/MarkdownContent'
import { TooltipProvider } from '../../src/components/ui/tooltip'

vi.mock('@/i18n', () => ({ useT: () => (key: string) => key }))
vi.mock('@/store/settings', () => ({ useSettings: () => ({ appearance: { showLineNumbers: false, wordWrap: true } }) }))

function render(markdown: string, streaming = false) {
  return renderToStaticMarkup(createElement(TooltipProvider, null, createElement(MarkdownContent, { markdown, streaming })))
}

describe('whole-document Markdown rendering', () => {
  it('resolves late references across tables, nested lists and fenced code after streaming settles', () => {
    const body = '[Earlier reference][source]\n\n| Column | Value |\n| --- | --- |\n| example | **kept** |\n\n- Parent\n  - Child\n\n```typescript\nconst value = "<safe>";\n```\n\n'
    expect(render(body, true)).not.toContain('href="https://example.com/source"')
    const settled = render(`${body}[source]: https://example.com/source\n`)
    expect(settled).toContain('href="https://example.com/source"')
    expect(settled).toContain('<table')
    expect(settled).toContain('<strong>kept</strong>')
    expect(settled).toContain('<ul>')
    expect(settled).toContain('hljs-keyword')
    expect(settled).toContain('&lt;safe&gt;')
  })

  it('shares grammar registration without leaking content or failing unknown languages', () => {
    const first = render('```typescript\nconst firstOnly = 1;\n```')
    const second = render('```unknown-fixture-language\nsecondOnly\n```')
    expect(first).toContain('firstOnly')
    expect(second).toContain('secondOnly')
    expect(second).not.toContain('firstOnly')
    expect(render('[Unsafe](javascript:alert(1))')).not.toContain('href="javascript:')
  })
})
