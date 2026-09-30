import type { TaskSchedule } from '../../shared/scheduled-tasks'

function localParts(format: Intl.DateTimeFormat, value: number) {
  const parts = Object.fromEntries(format.formatToParts(value).map((part) => [part.type, part.value]))
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour), minute: Number(parts.minute) }
}

/** Strictly later occurrence. A daily DST gap is skipped; a repeated wall time runs once. */
export function nextScheduledAt(schedule: TaskSchedule, after: number): number | null {
  if (schedule.kind === 'once') return schedule.at > after ? schedule.at : null
  if (schedule.kind === 'interval') {
    const interval = schedule.minutes * 60_000
    return schedule.startsAt > after ? schedule.startsAt : schedule.startsAt + (Math.floor((after - schedule.startsAt) / interval) + 1) * interval
  }
  const format = new Intl.DateTimeFormat('en-CA', { timeZone: schedule.timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const today = localParts(format, after)
  for (let day = 0; day < 4; day += 1) {
    const date = new Date(Date.UTC(today.year, today.month - 1, today.day + day))
    const wall = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), schedule.hour, schedule.minute)
    // Sample the zone offsets around this date, then verify their exact wall
    // times. This handles DST and date-line gaps without scanning every minute.
    const offsets = new Set<number>()
    for (let hours = -48; hours <= 48; hours += 6) {
      const sample = wall + hours * 3_600_000
      const local = localParts(format, sample)
      offsets.add(Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute) - sample)
    }
    // Select the earliest matching instant even if the second repeated wall
    // time would still be later than `after`.
    let first: number | undefined
    for (const offset of offsets) {
      const candidate = wall - offset
      const local = localParts(format, candidate)
      if (local.year === date.getUTCFullYear() && local.month === date.getUTCMonth() + 1 && local.day === date.getUTCDate() && local.hour === schedule.hour && local.minute === schedule.minute) first = first === undefined ? candidate : Math.min(first, candidate)
    }
    if (first !== undefined && first > after) return first
  }
  throw new Error('Could not calculate the next daily occurrence.')
}

export function initialScheduledAt(schedule: TaskSchedule, now: number) {
  return schedule.kind === 'once' ? schedule.at : schedule.kind === 'interval' ? schedule.startsAt : nextScheduledAt(schedule, now)
}
