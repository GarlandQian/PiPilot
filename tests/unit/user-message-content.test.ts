import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  UserMessageContent,
  userMessageImageSource,
} from '../../src/components/chat/UserMessageContent'

vi.mock('@/i18n', () => ({
  useT: () => (key: string) => key,
}))

describe('UserMessageContent', () => {
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
