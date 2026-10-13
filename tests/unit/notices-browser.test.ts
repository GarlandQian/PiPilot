import { afterEach, describe, expect, it, vi } from 'vitest'
import { filterNotices, noticeKey, noticeProjectUrl, parseNotices } from '../../src/components/settings/about/notices'

const packages = [
  { name: 'zeta', version: '2.0.0', license: 'Apache-2.0' },
  { name: 'alpha', version: '1.0.0', license: 'MIT', textId: 'mit' },
  { name: 'alpha', version: '2.0.0', license: 'MIT', textId: 'mit' },
]

afterEach(() => { vi.unstubAllGlobals() })

describe('license browser data', () => {
  it('sorts packages, keeps versions distinct and preserves license text exactly', () => {
    const text = `MIT License\n\n  Copyright © Example\n${'full text\n'.repeat(1000)}`
    const parsed = parseNotices({ packages, texts: { mit: text } })
    expect(parsed.packages.map(noticeKey)).toEqual(['alpha@1.0.0', 'alpha@2.0.0', 'zeta@2.0.0'])
    expect(parsed.texts.mit).toBe(text)
    expect(packages[0].name).toBe('zeta')
  })

  it.each([null, [], {}, { packages: [], texts: [] }, { packages: [null], texts: {} },
    { packages: [{ name: 'broken' }], texts: {} }, { packages, texts: { mit: 42 } },
    { packages: [{ ...packages[0], url: 42 }], texts: {} },
  ])('rejects malformed manifests instead of passing them to rendering', (value) => {
    expect(() => parseNotices(value)).toThrow(/Invalid third-party notice/)
  })

  it('allows packages without bundled license text', () => {
    expect(parseNotices({ packages: [packages[0]], texts: {} }).packages).toHaveLength(1)
  })

  it('combines trimmed case-insensitive search with exact license filtering', () => {
    expect(filterNotices(packages, '  ALPHA  ', 'MIT')).toHaveLength(2)
    expect(filterNotices(packages, '2.0.0', 'MIT').map(noticeKey)).toEqual(['alpha@2.0.0'])
    expect(filterNotices(packages, 'apache', '').map(noticeKey)).toEqual(['zeta@2.0.0'])
    expect(filterNotices(packages, 'zeta', 'MIT')).toEqual([])
  })

  it('allows web project links but not executable or file schemes', () => {
    expect(noticeProjectUrl('https://example.com/project')).toBe('https://example.com/project')
    for (const url of ['javascript:alert(1)', 'file:///private/config', 'data:text/html,test', 'not a url', undefined]) {
      expect(noticeProjectUrl(url)).toBeUndefined()
    }
  })

  it('clears failed loads for retry, then caches the validated manifest', async () => {
    vi.resetModules()
    const { loadNotices } = await import('../../src/components/settings/about/notices')
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ packages: null }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ packages, texts: {} }) })
    vi.stubGlobal('fetch', fetchMock)
    await expect(loadNotices()).rejects.toThrow('HTTP 503')
    await expect(loadNotices()).rejects.toThrow('Invalid third-party notices')
    const result = await loadNotices()
    expect(await loadNotices()).toBe(result)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})
