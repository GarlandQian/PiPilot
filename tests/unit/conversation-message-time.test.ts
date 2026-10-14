import { expect, it, vi } from 'vitest'

it('formats a thousand conversation timestamps without rebuilding a locale clock per row or render', async () => {
  vi.resetModules()
  const expected = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit' })
  const constructor = vi.spyOn(Intl, 'DateTimeFormat')
  const { formatConversationMessageTime } = await import('../../src/renderer/conversation-message-time')
  const start = Date.parse('2026-10-14T03:00:00Z')
  for (let render = 0; render < 3; render += 1) {
    for (let row = 0; row < 1_000; row += 1) {
      const timestamp = start + row * 60_000
      expect(formatConversationMessageTime('en-US', timestamp)).toBe(expected.format(timestamp))
    }
  }
  expect(constructor).toHaveBeenCalledTimes(1)
})

it('uses the selected locale after switching languages and reuses its existing clock when switching back', async () => {
  vi.resetModules()
  const timestamp = Date.parse('2026-10-14T03:00:00Z')
  const expected = new Map((['en-US', 'zh-CN'] as const).map((locale) => [locale,
    new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(timestamp)]))
  const constructor = vi.spyOn(Intl, 'DateTimeFormat')
  const { formatConversationMessageTime } = await import('../../src/renderer/conversation-message-time')
  for (const locale of ['en-US', 'zh-CN', 'en-US', 'zh-CN'] as const) {
    expect(formatConversationMessageTime(locale, timestamp)).toBe(expected.get(locale))
  }
  expect(constructor).toHaveBeenCalledTimes(2)
})
