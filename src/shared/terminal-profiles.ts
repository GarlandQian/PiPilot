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
