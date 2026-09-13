import { z } from 'zod'

export const applicationShutdownIntentSchema = z.enum(['quit', 'install-update'])
export type ApplicationShutdownIntent = z.infer<typeof applicationShutdownIntentSchema>

/** Only control messages cross this boundary; configuration drafts stay in Renderer memory. */
export const applicationShutdownEventSchema = z.object({
  shutdownId: z.uuid(),
  intent: applicationShutdownIntentSchema,
  phase: z.enum(['check', 'cancel']),
}).strict()
export type ApplicationShutdownEvent = z.infer<typeof applicationShutdownEventSchema>

export const applicationShutdownDecisionSchema = z.enum(['pending', 'ready', 'cancel'])
export type ApplicationShutdownDecision = z.infer<typeof applicationShutdownDecisionSchema>
