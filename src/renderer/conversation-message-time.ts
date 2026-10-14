const clocks = new Map<'zh-CN' | 'en-US', Intl.DateTimeFormat>()

/** Reuse the locale clock across every row in a long conversation. */
export function formatConversationMessageTime(locale: 'zh-CN' | 'en-US', timestamp: number): string {
  let clock = clocks.get(locale)
  if (!clock) {
    clock = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' })
    clocks.set(locale, clock)
  }
  return clock.format(timestamp)
}
