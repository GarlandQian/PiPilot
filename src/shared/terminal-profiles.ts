import { z } from 'zod'

export const terminalShellProfileIdSchema = z.string().trim().min(1).max(160)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9:._-]*$/)
export type TerminalShellProfileId = z.infer<typeof terminalShellProfileIdSchema>

const terminalArgumentSchema = z.string().max(4_096).refine((value) => !value.includes('\0'))
export const terminalCustomProfileSchema = z.object({
  id: terminalShellProfileIdSchema.regex(/^custom:[a-zA-Z0-9_-]+$/),
  name: z.string().trim().min(1).max(128),
  executable: z.string().trim().min(1).max(4_096).refine((value) => !/[\0\r\n]/.test(value)),
  args: z.array(terminalArgumentSchema).max(64),
  env: z.record(z.string().min(1).max(256).regex(/^[^=\0]+$/), terminalArgumentSchema.nullable())
    .refine((value) => Object.keys(value).length <= 64),
}).strict()
export type TerminalCustomProfile = z.infer<typeof terminalCustomProfileSchema>

export const terminalCustomProfilesSchema = z.array(terminalCustomProfileSchema).max(64)
  .refine((profiles) => new Set(profiles.map(({ id }) => id)).size === profiles.length)

export const terminalShellProfileSchema = z.object({
  id: terminalShellProfileIdSchema,
  label: z.string().min(1).max(128),
  isDefault: z.boolean(),
  source: z.enum(['detected', 'custom', 'wsl']),
  executable: z.string().max(4_096),
  args: z.array(terminalArgumentSchema).max(64),
  available: z.boolean(),
  unavailableReason: z.enum(['executable-not-found', 'distribution-unavailable']).optional(),
}).strict()
export type TerminalShellProfile = z.infer<typeof terminalShellProfileSchema>

export const terminalDefaultProfileSnapshotSchema = z.object({
  id: terminalShellProfileIdSchema,
  label: z.string().min(1).max(128),
  executable: z.string().max(4_096),
}).strict()
export type TerminalDefaultProfileSnapshot = z.infer<typeof terminalDefaultProfileSnapshotSchema>

export const terminalExternalAdapterSchema = z.enum([
  'mac-terminal', 'mac-iterm', 'ghostty', 'windows-terminal', 'windows-powershell', 'windows-cmd',
  'gnome-terminal', 'konsole', 'xfce4-terminal', 'kitty', 'alacritty',
])
export type TerminalExternalAdapter = z.infer<typeof terminalExternalAdapterSchema>
export const terminalExternalAppIdSchema = z.string().min(1).max(160).regex(/^external:[a-zA-Z0-9:._-]+$/)
export const terminalCustomExternalAppSchema = z.object({
  id: terminalExternalAppIdSchema.regex(/^external:custom:[a-zA-Z0-9_-]+$/),
  name: z.string().trim().min(1).max(128),
  executable: z.string().trim().min(1).max(4_096).refine((value) => !/[\0\r\n]/.test(value)),
  adapter: terminalExternalAdapterSchema,
}).strict()
export type TerminalCustomExternalApp = z.infer<typeof terminalCustomExternalAppSchema>
export const terminalCustomExternalAppsSchema = z.array(terminalCustomExternalAppSchema).max(64)
  .refine((apps) => new Set(apps.map(({ id }) => id)).size === apps.length)
export const terminalExternalAppSchema = z.object({
  id: terminalExternalAppIdSchema,
  label: z.string().min(1).max(128),
  source: z.enum(['detected', 'custom']),
  adapter: terminalExternalAdapterSchema,
  executable: z.string().max(4_096),
  available: z.boolean(),
  unavailableReason: z.enum(['executable-not-found', 'unsupported-platform']).optional(),
}).strict()
export type TerminalExternalApp = z.infer<typeof terminalExternalAppSchema>
export const terminalDefaultExternalAppSnapshotSchema = terminalExternalAppSchema.pick({ id: true, label: true, executable: true, adapter: true })
export type TerminalDefaultExternalAppSnapshot = z.infer<typeof terminalDefaultExternalAppSnapshotSchema>
