import { z } from 'zod'

export const configApplyStatusSchema = z.object({
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  state: z.enum(['applied', 'pending', 'unavailable', 'failed', 'superseded']),
  total: z.number().int().nonnegative(),
  applied: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  reason: z.literal('interaction-required').optional(),
}).strict()

export type ConfigApplyStatus = z.infer<typeof configApplyStatusSchema>
