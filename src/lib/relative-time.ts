import * as React from 'react'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export type CompactRelativeTime =
  | { unit: 'now' }
  | { unit: 'minutes' | 'hours' | 'days' | 'weeks'; count: number }
  | { unit: 'date'; date: Date; sameYear: boolean }

/** Codex-style sidebar age: "now", "5m", "3h", "2d", "3w", then a date. */
export function compactRelativeTime(iso: string, now: number): CompactRelativeTime | null {
  const time = Date.parse(iso)
  if (!Number.isFinite(time)) return null
  const elapsed = Math.max(0, now - time)
  if (elapsed < MINUTE) return { unit: 'now' }
  if (elapsed < HOUR) return { unit: 'minutes', count: Math.floor(elapsed / MINUTE) }
  if (elapsed < DAY) return { unit: 'hours', count: Math.floor(elapsed / HOUR) }
  if (elapsed < 7 * DAY) return { unit: 'days', count: Math.floor(elapsed / DAY) }
  if (elapsed < 5 * 7 * DAY) return { unit: 'weeks', count: Math.floor(elapsed / (7 * DAY)) }
  const date = new Date(time)
  return { unit: 'date', date, sameYear: date.getFullYear() === new Date(now).getFullYear() }
}

/** A clock that ticks once a minute, so relative times stay current. */
export function useMinuteClock() {
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), MINUTE)
    return () => window.clearInterval(id)
  }, [])
  return now
}
