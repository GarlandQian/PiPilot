import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '../../src/components/ui/tooltip'
import {
  UserMessageContent,
  userMessageImageSource,
} from '../../src/components/chat/UserMessageContent'

vi.mock('@/i18n', () => ({
  useT: () => (key: string) => key,
}))
vi.mock('@/store/settings', () => ({
  useSettings: () => ({ appearance: { showLineNumbers: true, wordWrap: true } }),
}))

describe('UserMessageContent', () => {
  it('shows a skill badge and expandable Markdown instructions without losing the user message or image', () => {
    const text = '<skill name="review-helper" location="/fixture/skills/review-helper/SKILL.md">\n## Skill instructions\n\n- **Inspect** the files.\n</skill>\n\nPlease **review** [this change](https://example.test/change).'
    const markup = renderToStaticMarkup(createElement(TooltipProvider, null, createElement(UserMessageContent, {
      text,
      images: [{ id: 'skill-image', data: 'cGl4ZWw=', mimeType: 'image/png' }],
    })))
    const disclosure = markup.match(/<details\b[^>]*>([\s\S]*?)<\/details>/u)

    expect(markup).toContain('data-prompt-skill="review-helper"')
    expect(disclosure?.[1]).toContain('data-prompt-skill-content')
    expect(disclosure?.[1]).toContain('<h2>Skill instructions</h2>')
    expect(disclosure?.[1]).toContain('<strong>Inspect</strong>')
    expect(disclosure?.[0]).not.toMatch(/<details\b[^>]*\sopen(?:=|\s|>)/u)
    const afterDisclosure = markup.slice(markup.indexOf('</details>') + '</details>'.length)
    expect(afterDisclosure).toContain('<strong>review</strong>')
    expect(afterDisclosure).toContain('href="https://example.test/change"')
    expect(markup).toContain('src="data:image/png;base64,cGl4ZWw="')
    expect(markup).toContain('data-user-message-image="true"')
    expect(markup).not.toContain('<skill ')
    expect(markup).not.toContain('&lt;skill ')
  })

  it('keeps a fenced skill-envelope example as code without creating a skill badge', () => {
    const text = '```xml\n<skill name="example" location="/fixture/example/SKILL.md">\nExample instructions\n</skill>\n```'
    const markup = renderToStaticMarkup(createElement(TooltipProvider, null, createElement(UserMessageContent, { text })))

    expect(markup).toContain('<code')
    expect(markup).toContain('Example instructions')
    expect(markup).not.toContain('data-prompt-skill=')
    expect(markup).not.toContain('data-prompt-skill-content')
  })

  it('renders message Markdown as headings, lists, tables and code without enabling raw HTML', () => {
    const markup = renderToStaticMarkup(createElement(TooltipProvider, null, createElement(UserMessageContent, {
      text: '## A question\n\n- **Inspect** the input\n\n| Item | State |\n| --- | --- |\n| File | Ready |\n\n```ts\nconst value = 1\n```\n\n<script>alert(1)</script>',
    })))
    expect(markup).toContain('<h2>A question</h2>')
    expect(markup).toContain('<strong>Inspect</strong>')
    expect(markup).toContain('<table')
    expect(markup).toContain('<code')
    expect(markup).not.toContain('<script>')
  })
  it('renders persisted Pi image content without a remote URL', () => {
    const markup = renderToStaticMarkup(createElement(UserMessageContent, {
      text: 'Inspect this image',
      images: [{
        id: 'image-1',
        data: 'cGl4ZWw=',
        mimeType: 'image/png',
      }],
    }))

    expect(markup).toContain('Inspect this image')
    expect(markup).toContain('data-user-message-image="true"')
    expect(markup).toContain('src="data:image/png;base64,cGl4ZWw="')
    expect(markup).toContain('alt="md.image"')
  })

  it('shows a bounded placeholder for unsupported or malformed image data', () => {
    const markup = renderToStaticMarkup(createElement(UserMessageContent, {
      text: '',
      images: [
        { id: 'remote', data: 'cGl4ZWw=', mimeType: 'image/svg+xml' },
        { id: 'malformed', data: '<script>', mimeType: 'image/png' },
      ],
    }))

    expect(markup).not.toContain('<img')
    expect(markup.match(/\[md\.image\]/gu)).toHaveLength(2)
  })

  it('rejects invalid image sources before they reach the DOM', () => {
    expect(userMessageImageSource({
      id: 'valid',
      data: 'cGl4ZWw=',
      mimeType: 'image/jpeg',
    })).toBe('data:image/jpeg;base64,cGl4ZWw=')
    expect(userMessageImageSource({
      id: 'invalid',
      data: 'https://example.com/image.png',
      mimeType: 'image/png',
    })).toBeNull()
  })
})
