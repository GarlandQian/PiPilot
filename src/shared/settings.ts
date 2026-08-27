export const SETTINGS_SCHEMA_VERSION = 1 as const

export type ThemeMode = 'system' | 'light' | 'dark'
export type Locale = 'system' | 'zh-CN' | 'en-US'
export type Density = 'compact' | 'comfortable'
export type ComposerSendShortcut = 'enter' | 'mod-enter'

export const TERMINAL_FONT_FAMILY_LIMIT = 120
export const TERMINAL_FONT_SIZE_MIN = 11
export const TERMINAL_FONT_SIZE_MAX = 18

export interface AppearanceSettings {
  theme: ThemeMode
  uiFontFamily: string
  monoFontFamily: string
  uiFontSize: number
  codeFontSize: number
  density: Density
  reducedMotion: boolean
  codeLigatures: boolean
  wordWrap: boolean
  showLineNumbers: boolean
  compactToolCards: boolean
}

export interface TerminalSettings {
  fontFamily: string
  fontSize: number
}

export interface ComposerSettings {
  sendShortcut: ComposerSendShortcut
}

export interface AppSettings {
  locale: Locale
  appearance: AppearanceSettings
  composer: ComposerSettings
  terminal: TerminalSettings
}

export interface AppSettingsPatch {
  locale?: Locale
  appearance?: Partial<AppearanceSettings>
  composer?: Partial<ComposerSettings>
  terminal?: Partial<TerminalSettings>
}

export interface PersistedSettingsDocument {
  version: typeof SETTINGS_SCHEMA_VERSION
  settings: AppSettings
}

export const DEFAULT_SETTINGS: AppSettings = {
  locale: 'system',
  appearance: {
    theme: 'system',
    uiFontFamily: '',
    monoFontFamily: '',
    uiFontSize: 14,
    codeFontSize: 13,
    density: 'compact',
    reducedMotion: false,
    codeLigatures: false,
    wordWrap: true,
    showLineNumbers: true,
    compactToolCards: true,
  },
  composer: {
    sendShortcut: 'enter',
  },
  terminal: {
    fontFamily: '',
    fontSize: 13,
  },
}

const LOCALES: readonly Locale[] = ['system', 'zh-CN', 'en-US']
const THEMES: readonly ThemeMode[] = ['system', 'light', 'dark']
const DENSITIES: readonly Density[] = ['compact', 'comfortable']
const COMPOSER_SEND_SHORTCUTS: readonly ComposerSendShortcut[] = ['enter', 'mod-enter']
const APP_KEYS = ['locale', 'appearance', 'composer', 'terminal'] as const
const APPEARANCE_KEYS = [
  'theme',
  'uiFontFamily',
  'monoFontFamily',
  'uiFontSize',
  'codeFontSize',
  'density',
  'reducedMotion',
  'codeLigatures',
  'wordWrap',
  'showLineNumbers',
  'compactToolCards',
] as const
const TERMINAL_KEYS = ['fontFamily', 'fontSize'] as const
const COMPOSER_KEYS = ['sendShortcut'] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(record: Record<string, unknown>, allowed: readonly string[]) {
  const keys = Object.keys(record)
  return keys.length === allowed.length && keys.every((key) => allowed.includes(key))
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

function boundedInteger(value: unknown, minimum: number, maximum: number, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, Math.round(value)))
    : fallback
}

function booleanOr(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback
}

function fontNameOr(value: unknown, fallback: string) {
  return typeof value === 'string' ? value.slice(0, 120) : fallback
}

function terminalFontNameOr(value: unknown, fallback: string) {
  return typeof value === 'string' && value.length <= TERMINAL_FONT_FAMILY_LIMIT
    ? value
    : fallback
}

function terminalFontSizeOr(value: unknown, fallback: number) {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= TERMINAL_FONT_SIZE_MIN &&
    value <= TERMINAL_FONT_SIZE_MAX
    ? value
    : fallback
}

function isExactAppearance(value: unknown): value is AppearanceSettings {
  if (!isRecord(value) || !hasExactKeys(value, APPEARANCE_KEYS)) return false
  return (
    THEMES.includes(value.theme as ThemeMode) &&
    typeof value.uiFontFamily === 'string' &&
    value.uiFontFamily.length <= 120 &&
    typeof value.monoFontFamily === 'string' &&
    value.monoFontFamily.length <= 120 &&
    typeof value.uiFontSize === 'number' &&
    Number.isInteger(value.uiFontSize) &&
    value.uiFontSize >= 12 &&
    value.uiFontSize <= 18 &&
    typeof value.codeFontSize === 'number' &&
    Number.isInteger(value.codeFontSize) &&
    value.codeFontSize >= 11 &&
    value.codeFontSize <= 18 &&
    DENSITIES.includes(value.density as Density) &&
    typeof value.reducedMotion === 'boolean' &&
    typeof value.codeLigatures === 'boolean' &&
    typeof value.wordWrap === 'boolean' &&
    typeof value.showLineNumbers === 'boolean' &&
    typeof value.compactToolCards === 'boolean'
  )
}

function isExactTerminal(value: unknown): value is TerminalSettings {
  if (!isRecord(value) || !hasExactKeys(value, TERMINAL_KEYS)) return false
  return (
    typeof value.fontFamily === 'string' &&
    value.fontFamily.length <= TERMINAL_FONT_FAMILY_LIMIT &&
    typeof value.fontSize === 'number' &&
    Number.isInteger(value.fontSize) &&
    value.fontSize >= TERMINAL_FONT_SIZE_MIN &&
    value.fontSize <= TERMINAL_FONT_SIZE_MAX
  )
}

function isExactComposer(value: unknown): value is ComposerSettings {
  return isRecord(value) &&
    hasExactKeys(value, COMPOSER_KEYS) &&
    COMPOSER_SEND_SHORTCUTS.includes(value.sendShortcut as ComposerSendShortcut)
}

function isExactSettings(value: unknown): value is AppSettings {
  return (
    isRecord(value) &&
    hasExactKeys(value, APP_KEYS) &&
    LOCALES.includes(value.locale as Locale) &&
    isExactAppearance(value.appearance) &&
    isExactComposer(value.composer) &&
    isExactTerminal(value.terminal)
  )
}

export function cloneSettings(settings: AppSettings = DEFAULT_SETTINGS): AppSettings {
  return structuredClone(settings)
}

/** Deeply fills known fields and drops unknown data. */
export function sanitizeSettings(
  raw: unknown,
  fallback: AppSettings = DEFAULT_SETTINGS,
): AppSettings {
  const source = isRecord(raw) ? raw : {}
  const appearance = isRecord(source.appearance) ? source.appearance : {}
  const composer = isRecord(source.composer) ? source.composer : {}
  const terminal = isRecord(source.terminal) ? source.terminal : {}

  return {
    locale: oneOf(source.locale, LOCALES, fallback.locale),
    appearance: {
      theme: oneOf(appearance.theme, THEMES, fallback.appearance.theme),
      uiFontFamily: fontNameOr(appearance.uiFontFamily, fallback.appearance.uiFontFamily),
      monoFontFamily: fontNameOr(appearance.monoFontFamily, fallback.appearance.monoFontFamily),
      uiFontSize: boundedInteger(
        appearance.uiFontSize,
        12,
        18,
        fallback.appearance.uiFontSize,
      ),
      codeFontSize: boundedInteger(
        appearance.codeFontSize,
        11,
        18,
        fallback.appearance.codeFontSize,
      ),
      density: oneOf(appearance.density, DENSITIES, fallback.appearance.density),
      reducedMotion: booleanOr(
        appearance.reducedMotion,
        fallback.appearance.reducedMotion,
      ),
      codeLigatures: booleanOr(
        appearance.codeLigatures,
        fallback.appearance.codeLigatures,
      ),
      wordWrap: booleanOr(appearance.wordWrap, fallback.appearance.wordWrap),
      showLineNumbers: booleanOr(
        appearance.showLineNumbers,
        fallback.appearance.showLineNumbers,
      ),
      compactToolCards: booleanOr(
        appearance.compactToolCards,
        fallback.appearance.compactToolCards,
      ),
    },
    composer: {
      sendShortcut: oneOf(
        composer.sendShortcut,
        COMPOSER_SEND_SHORTCUTS,
        fallback.composer.sendShortcut,
      ),
    },
    terminal: {
      fontFamily: terminalFontNameOr(
        terminal.fontFamily,
        fallback.terminal.fontFamily,
      ),
      fontSize: terminalFontSizeOr(terminal.fontSize, fallback.terminal.fontSize),
    },
  }
}

export function mergeSettings(base: AppSettings, patch: AppSettingsPatch): AppSettings {
  return sanitizeSettings(
    {
      ...base,
      ...patch,
      appearance: {
        ...base.appearance,
        ...patch.appearance,
      },
      composer: {
        ...base.composer,
        ...patch.composer,
      },
      terminal: {
        ...base.terminal,
        ...patch.terminal,
      },
    },
    base,
  )
}

export class InvalidSettingsDocumentError extends Error {
  constructor(message = 'Settings document is not recognized.') {
    super(message)
    this.name = 'InvalidSettingsDocumentError'
  }
}

export function parseSettingsDocument(raw: unknown): PersistedSettingsDocument {
  if (!isRecord(raw) || !hasExactKeys(raw, ['version', 'settings'])) {
    throw new InvalidSettingsDocumentError()
  }
  if (raw.version === SETTINGS_SCHEMA_VERSION && isExactSettings(raw.settings)) {
    return {
      version: SETTINGS_SCHEMA_VERSION,
      settings: cloneSettings(raw.settings),
    }
  }
  throw new InvalidSettingsDocumentError()
}
