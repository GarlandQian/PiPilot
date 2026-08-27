import { z } from 'zod'
import {
  SETTINGS_SCHEMA_VERSION,
  TERMINAL_FONT_FAMILY_LIMIT,
  TERMINAL_FONT_SIZE_MAX,
  TERMINAL_FONT_SIZE_MIN,
} from '../settings'

export const themeModeSchema = z.enum(['system', 'light', 'dark'])
export const localeSchema = z.enum(['system', 'zh-CN', 'en-US'])
export const densitySchema = z.enum(['compact', 'comfortable'])
export const composerSendShortcutSchema = z.enum(['enter', 'mod-enter'])
export const appearanceSettingsSchema = z
  .object({
    theme: themeModeSchema,
    uiFontFamily: z.string().max(120),
    monoFontFamily: z.string().max(120),
    uiFontSize: z.number().int().min(12).max(18),
    codeFontSize: z.number().int().min(11).max(18),
    density: densitySchema,
    reducedMotion: z.boolean(),
    codeLigatures: z.boolean(),
    wordWrap: z.boolean(),
    showLineNumbers: z.boolean(),
    compactToolCards: z.boolean(),
  })
  .strict()

export const terminalSettingsSchema = z
  .object({
    fontFamily: z.string().max(TERMINAL_FONT_FAMILY_LIMIT),
    fontSize: z.number().int().min(TERMINAL_FONT_SIZE_MIN).max(TERMINAL_FONT_SIZE_MAX),
  })
  .strict()

export const composerSettingsSchema = z
  .object({
    sendShortcut: composerSendShortcutSchema,
  })
  .strict()

export const appSettingsSchema = z
  .object({
    locale: localeSchema,
    appearance: appearanceSettingsSchema,
    composer: composerSettingsSchema,
    terminal: terminalSettingsSchema,
  })
  .strict()

export const appearanceSettingsPatchSchema = appearanceSettingsSchema.partial().strict()
export const composerSettingsPatchSchema = composerSettingsSchema.partial().strict()
export const terminalSettingsPatchSchema = terminalSettingsSchema.partial().strict()
export const appSettingsPatchSchema = z
  .object({
    locale: localeSchema.optional(),
    appearance: appearanceSettingsPatchSchema.optional(),
    composer: composerSettingsPatchSchema.optional(),
    terminal: terminalSettingsPatchSchema.optional(),
  })
  .strict()

export const persistedSettingsDocumentSchema = z
  .object({
    version: z.literal(SETTINGS_SCHEMA_VERSION),
    settings: appSettingsSchema,
  })
  .strict()
