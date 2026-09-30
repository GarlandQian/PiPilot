import * as React from 'react'
import { useSettings } from '@/store/settings'
import { resolveMonoFontStack, resolveUiFontStack } from '@/types/settings'
import { resolveLocale } from '@/i18n'

const UI_STACK = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI Variable Text', 'Segoe UI', Inter, 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif"
const MONO_STACK = "'SF Mono', SFMono-Regular, ui-monospace, Menlo, 'JetBrains Mono', 'Cascadia Code', Consolas, monospace"

/**
 * Applies persisted settings to the document:
 * theme class, CSS variables (font families, sizes, density metrics),
 * and data attributes consumed by styles (motion, ligatures).
 */
export function useApplySettings() {
  const settings = useSettings()
  const { appearance, locale } = settings

  React.useEffect(() => {
    const root = document.documentElement
    const mq = window.matchMedia('(prefers-color-scheme: dark)')

    const applyTheme = () => {
      const dark = appearance.theme === 'dark' || (appearance.theme === 'system' && mq.matches)
      root.classList.toggle('dark', dark)
    }
    applyTheme()
    mq.addEventListener('change', applyTheme)

    const comfortable = appearance.density === 'comfortable'
    root.style.setProperty('--app-font-size', `${appearance.uiFontSize}px`)
    root.style.setProperty('--app-caption-size', `${Math.max(11, appearance.uiFontSize - 1)}px`)
    root.style.setProperty('--app-title-size', `${appearance.uiFontSize + 2}px`)
    root.style.setProperty('--code-font-size', `${appearance.codeFontSize}px`)
    root.style.setProperty('--font-sans', resolveUiFontStack(appearance.uiFontFamily) || UI_STACK)
    root.style.setProperty('--font-mono', resolveMonoFontStack(appearance.monoFontFamily) || MONO_STACK)
    // macOS metrics: 28pt regular controls and sidebar rows, 24pt list rows.
    root.style.setProperty('--control-h', comfortable ? '32px' : '28px')
    root.style.setProperty('--row-h', comfortable ? '34px' : '28px')
    root.style.setProperty('--tool-row-h', comfortable ? '38px' : '32px')
    root.style.setProperty('--tree-row-h', comfortable ? '28px' : '24px')

    // macOS 27 Liquid Glass intensity drives every translucent material.
    root.style.setProperty('--glass-tint', String(appearance.glassTint / 100))

    root.dataset.reducedMotion = String(appearance.reducedMotion)
    root.dataset.ligatures = String(appearance.codeLigatures)
    root.dataset.wordWrap = String(appearance.wordWrap)
    root.dataset.lineNumbers = String(appearance.showLineNumbers)
    root.dataset.density = appearance.density
    root.lang = resolveLocale(locale)

    return () => mq.removeEventListener('change', applyTheme)
  }, [appearance, locale])

  return settings
}
