import { TERMINAL_FONT_FAMILY_LIMIT } from '@/shared/settings'

export const DEFAULT_TERMINAL_FONT_STACK = [
  '"JetBrains Mono"',
  '"SF Mono"',
  'SFMono-Regular',
  '"Cascadia Code"',
  '"Fira Code"',
  'Consolas',
  '"Sarasa Mono SC"',
  '"Noto Sans Mono CJK SC"',
  '"PingFang SC"',
  '"Microsoft YaHei"',
  '"WenQuanYi Micro Hei Mono"',
  'monospace',
].join(', ')

export const TERMINAL_FONT_OPTIONS = [
  '',
  'JetBrains Mono',
  'SF Mono',
  'Cascadia Code',
  'Fira Code',
  'Consolas',
  'Sarasa Mono SC',
  'Noto Sans Mono CJK SC',
] as const

export function sanitizeTerminalFontFamily(value: string): string {
  return value
    .slice(0, TERMINAL_FONT_FAMILY_LIMIT)
    .replace(/["'\\,;{}\u0000-\u001f\u007f]/g, '')
    .trim()
}

export function resolveTerminalFontStack(value: string): string {
  const family = sanitizeTerminalFontFamily(value)
  if (!family) return DEFAULT_TERMINAL_FONT_STACK
  return `"${family}", ${DEFAULT_TERMINAL_FONT_STACK}`
}
