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

export function createReadOnlyDiffOptions(
  preferences: Pick<ReadOnlyDiffPreferences, 'themeType' | 'wordWrap' | 'showLineNumbers'>,
): NonNullable<PatchDiffProps<undefined>['options']> {
  return {
    diffStyle: 'unified',
    theme: {
      light: 'github-light',
      dark: 'github-dark',
    },
    themeType: preferences.themeType,
    overflow: preferences.wordWrap ? 'wrap' : 'scroll',
    disableLineNumbers: !preferences.showLineNumbers,
    disableFileHeader: true,
    stickyHeader: false,
    diffIndicators: 'classic',
    hunkSeparators: 'line-info-basic',
    lineDiffType: 'word',
    disableErrorHandling: true,
  }
}

export function createReadOnlyDiffStyle(
  preferences: Pick<ReadOnlyDiffPreferences, 'monoFontFamily' | 'codeFontSize' | 'codeLigatures'>,
  fontStack: string,
): ReadOnlyDiffStyle {
  return {
    '--diffs-font-family': fontStack,
    '--diffs-font-size': `${preferences.codeFontSize}px`,
    '--diffs-line-height': `${Math.max(18, Math.round(preferences.codeFontSize * 1.55))}px`,
    '--diffs-font-features': preferences.codeLigatures ? '"calt" 1, "liga" 1' : '"calt" 0, "liga" 0',
  }
}
