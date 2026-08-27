export type StatsLocale = 'zh-CN' | 'en-US'

function subCentFractionDigits(cost: number) {
  if (cost <= 0 || cost >= 0.01) return 2
  const leadingFractionZeros = Math.max(
    0,
    Math.ceil(-Math.log10(cost)) - 1,
  )
  return Math.min(12, Math.max(4, leadingFractionZeros + 2))
}

export function formatSessionCost(
  cost: number | null,
  locale: StatsLocale,
  full = false,
) {
  if (cost === null) return '—'
  if (full) {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 12,
    }).format(cost)
  }
  const maximumFractionDigits = subCentFractionDigits(cost)
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: cost > 0 && cost < 0.01 ? 4 : 2,
    maximumFractionDigits,
  }).format(cost)
}

export function formatTokenCount(tokens: number, locale: StatsLocale) {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(tokens)
}

export function formatTokenKilounits(tokens: number, locale: StatsLocale) {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: tokens < 10_000 ? 1 : 0,
    maximumFractionDigits: 1,
  }).format(tokens / 1_000)
}

export function formatContextPercent(percent: number, locale: StatsLocale) {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(percent)
}
