import * as React from 'react'
import type { ReadOnlyDiffThemeType } from './read-only-diff-options'

function readThemeType(): ReadOnlyDiffThemeType {
  if (typeof document === 'undefined') return 'light'
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

/** Light or dark, following the app's theme (and the system when it follows it). */
export function useDiffThemeType(): ReadOnlyDiffThemeType {
  const [themeType, setThemeType] = React.useState<ReadOnlyDiffThemeType>(readThemeType)
  React.useEffect(() => {
    const root = document.documentElement
    const update = () => setThemeType(readThemeType())
    const observer = new MutationObserver(update)
    observer.observe(root, { attributes: true, attributeFilter: ['class'] })
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener('change', update)
    update()
    return () => {
      observer.disconnect()
      media.removeEventListener('change', update)
    }
  }, [])
  return themeType
}
