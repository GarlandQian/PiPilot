import type { CSSProperties } from 'react'
import type { PatchDiffProps } from '@pierre/diffs/react'

export type ReadOnlyDiffThemeType = 'light' | 'dark'

export interface ReadOnlyDiffPreferences {
  themeType: ReadOnlyDiffThemeType
  monoFontFamily: string
  codeFontSize: number
  codeLigatures: boolean
  wordWrap: boolean
  showLineNumbers: boolean
}

export type ReadOnlyDiffStyle = CSSProperties & {
  '--diffs-font-family': string
  '--diffs-font-size': string
  '--diffs-line-height': string
  '--diffs-font-features': string
}

/**
 * One light and one dark syntax theme for files and diffs. One Light / One
 * Dark keep keywords purple, so red only ever means a removed line.
 */
export const CODE_THEMES = { light: 'one-light', dark: 'one-dark-pro' } as const

export function createReadOnlyDiffOptions<Annotation = undefined>(
  preferences: Pick<ReadOnlyDiffPreferences, 'themeType' | 'wordWrap' | 'showLineNumbers'> & { locale?: string; split?: boolean },
): NonNullable<PatchDiffProps<Annotation, undefined>['options']> {
  return {
    diffStyle: preferences.split ? 'split' : 'unified',
    theme: CODE_THEMES,
    themeType: preferences.themeType,
    overflow: preferences.wordWrap ? 'wrap' : 'scroll',
    disableLineNumbers: !preferences.showLineNumbers,
    disableFileHeader: true,
    stickyHeader: false,
    // A colored bar at the gutter marks added and removed lines, as on macOS.
    diffIndicators: 'bars',
    // "N unchanged lines" separators expand on click; their text is translated after render.
    hunkSeparators: 'line-info',
    lineDiffType: 'word',
    disableErrorHandling: true,
  }
}

/** The app's surface behind code, macOS green and red for changes. */
export function createReadOnlyDiffStyle(
  preferences: Pick<ReadOnlyDiffPreferences, 'monoFontFamily' | 'codeFontSize' | 'codeLigatures'>,
  fontStack: string,
): ReadOnlyDiffStyle {
  return {
    '--diffs-font-family': fontStack,
    '--diffs-font-size': `${preferences.codeFontSize}px`,
    '--diffs-line-height': `${Math.max(18, Math.round(preferences.codeFontSize * 1.6))}px`,
    '--diffs-font-features': preferences.codeLigatures ? '"calt" 1, "liga" 1' : '"calt" 0, "liga" 0',
    '--diffs-light-bg': 'var(--color-surface)',
    '--diffs-dark-bg': 'var(--color-surface)',
    '--diffs-light-addition-color': '#34c759',
    '--diffs-dark-addition-color': '#30d158',
    '--diffs-light-deletion-color': '#ff3b30',
    '--diffs-dark-deletion-color': '#ff453a',
  } as ReadOnlyDiffStyle
}

/**
 * "16 unmodified lines" and "More unchanged context may be available" are
 * English inside the renderer; say them in the app's language.
 */
export function localizeDiffSeparators(container: HTMLElement, label: (count: number) => string, expandAll: string, moreContext: string) {
  const root = container.shadowRoot ?? container
  for (const node of root.querySelectorAll<HTMLElement>('[data-unmodified-lines]')) {
    if (node.dataset.localized === node.textContent) continue
    const count = Number.parseInt(node.textContent ?? '', 10)
    node.textContent = Number.isFinite(count) ? label(count) : moreContext
    node.dataset.localized = node.textContent
  }
  for (const node of root.querySelectorAll<HTMLElement>('[data-expand-all-button]')) {
    if (node.textContent !== expandAll) node.textContent = expandAll
  }
}
