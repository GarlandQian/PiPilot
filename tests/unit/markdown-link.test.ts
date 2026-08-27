import { describe, expect, it } from 'vitest'
import { sanitizeHref } from '../../src/components/chat/markdown/MarkdownLink'
import { createApplicationUrlPolicy } from '../../src/main/security/url-policy'

describe('markdown external links', () => {
  const policy = createApplicationUrlPolicy()

  it.each([
    'https://example.com/docs?section=security#links',
    'http://localhost:4173/',
  ])('allows a credential-free absolute HTTP(S) URL: %s', (href) => {
    expect(sanitizeHref(href)).toBe(href)
    expect(policy.isSafeExternalUrl(href)).toBe(true)
  })

  it.each([
    '../README.md',
    '/docs/security',
    '#security',
    'mailto:security@example.com',
    'javascript:alert(1)',
    'file:///tmp/secret',
    'https://user:password@example.com/private',
    `https://example.com/${'a'.repeat(2_048)}`,
  ])('rejects a URL Main will not open: %s', (href) => {
    expect(sanitizeHref(href)).toBeUndefined()
    expect(policy.isSafeExternalUrl(href)).toBe(false)
  })
})
