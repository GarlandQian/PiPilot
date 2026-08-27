export { DEFAULT_SETTINGS } from '@/shared/settings'
export type {
  AppSettings,
  AppearanceSettings,
  ComposerSendShortcut,
  ComposerSettings,
  Density,
  Locale,
  TerminalSettings,
  ThemeMode,
} from '@/shared/settings'

export const DEFAULT_UI_FONT_STACK = [
  'Inter',
  '"SF Pro Text"',
  '"SF Pro Display"',
  '"Segoe UI"',
  '"PingFang SC"',
  '"Microsoft YaHei"',
  'system-ui',
  'sans-serif',
].join(', ')

export const DEFAULT_MONO_FONT_STACK = [
  '"JetBrains Mono"',
  'SFMono-Regular',
  '"Cascadia Code"',
  '"Fira Code"',
  'Consolas',
  'monospace',
].join(', ')

/** value '' (default) means "use built-in recommended stack" */
export const UI_FONT_OPTIONS: { value: string; labelKey: string; stack?: string }[] = [
  { value: '', labelKey: 'settings.appearance.font.option.systemDefault' },
  { value: 'Inter', labelKey: 'Inter', stack: 'Inter' },
  { value: 'Segoe UI', labelKey: 'Segoe UI', stack: '"Segoe UI"' },
  { value: 'SF Pro', labelKey: 'SF Pro', stack: '"SF Pro Text", "SF Pro Display"' },
  { value: 'PingFang SC', labelKey: 'PingFang SC', stack: '"PingFang SC"' },
  { value: 'Microsoft YaHei', labelKey: 'Microsoft YaHei', stack: '"Microsoft YaHei"' },
]

export const MONO_FONT_OPTIONS: { value: string; labelKey: string; stack?: string }[] = [
  { value: '', labelKey: 'settings.appearance.font.option.systemMono' },
  { value: 'JetBrains Mono', labelKey: 'JetBrains Mono', stack: '"JetBrains Mono"' },
  { value: 'SF Mono', labelKey: 'SF Mono', stack: '"SF Mono", SFMono-Regular' },
  { value: 'Cascadia Code', labelKey: 'Cascadia Code', stack: '"Cascadia Code"' },
  { value: 'Fira Code', labelKey: 'Fira Code', stack: '"Fira Code"' },
  { value: 'Consolas', labelKey: 'Consolas', stack: 'Consolas' },
]

export const UI_FONT_SIZES = [12, 13, 14, 15, 16, 17, 18]
export const CODE_FONT_SIZES = [11, 12, 13, 14, 15, 16, 17, 18]

/** Compose final CSS font stacks; a missing custom font falls back naturally. */
export function resolveUiFontStack(value: string): string {
  if (!value) return DEFAULT_UI_FONT_STACK
  const option = UI_FONT_OPTIONS.find((o) => o.value === value)
  const head = option?.stack ?? `"${value.replace(/"/g, '')}"`
  return `${head}, ${DEFAULT_UI_FONT_STACK}`
}

export function resolveMonoFontStack(value: string): string {
  if (!value) return DEFAULT_MONO_FONT_STACK
  const option = MONO_FONT_OPTIONS.find((o) => o.value === value)
  const head = option?.stack ?? `"${value.replace(/"/g, '')}"`
  return `${head}, ${DEFAULT_MONO_FONT_STACK}`
}
