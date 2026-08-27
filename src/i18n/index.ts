import * as React from 'react'
import zhCN from './locales/zh-CN.json'
import enUS from './locales/en-US.json'
import type { Locale } from '@/types/settings'
import { useSettings } from '@/store/settings'

export type MessageKey = keyof typeof enUS
export type MessageParams = Record<string, string | number>

const catalogs: Record<'zh-CN' | 'en-US', Record<string, string>> = {
  'zh-CN': zhCN,
  'en-US': enUS,
}

const warned = new Set<string>()

export function systemLocale(): 'zh-CN' | 'en-US' {
  const nav = typeof navigator !== 'undefined' ? navigator.language : 'en-US'
  return nav.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US'
}

export function resolveLocale(locale: Locale): 'zh-CN' | 'en-US' {
  return locale === 'system' ? systemLocale() : locale
}

function interpolate(template: string, params?: MessageParams): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (m, name: string) =>
    params[name] !== undefined ? String(params[name]) : m,
  )
}

export function translate(locale: Locale, key: string, params?: MessageParams): string {
  const active = resolveLocale(locale)
  const hit = catalogs[active][key]
  if (hit !== undefined) return interpolate(hit, params)
  const fallback = catalogs['en-US'][key]
  if (fallback !== undefined) return interpolate(fallback, params)
  if (import.meta.env.DEV && !warned.has(key)) {
    warned.add(key)
    console.warn(`[i18n] missing translation key: ${key}`)
  }
  return key
}

export function useT() {
  const { locale } = useSettings()
  return React.useCallback(
    (key: MessageKey, params?: MessageParams) => translate(locale, key, params),
    [locale],
  )
}

export function useLocale(): 'zh-CN' | 'en-US' {
  const { locale } = useSettings()
  return resolveLocale(locale)
}

export function intlDateTime(locale: 'zh-CN' | 'en-US') {
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    day: 'numeric',
  })
}

export function formatRelative(fromMs: number, locale: 'zh-CN' | 'en-US'): string {
  const diff = Date.now() - fromMs
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  const minutes = Math.round(diff / 60_000)
  if (minutes < 1) return rtf.format(0, 'minute')
  if (minutes < 60) return rtf.format(-minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (hours < 24) return rtf.format(-hours, 'hour')
  return intlDateTime(locale).format(new Date(fromMs))
}

export function formatClock(locale: 'zh-CN' | 'en-US'): string {
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(new Date())
}
