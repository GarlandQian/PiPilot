import { z } from 'zod'
import { builtinProviderSchema } from './models-config'

const text = (max = 4_000) => z.string().max(max)

/** A question Pi's login asks; a select answers with an option id. */
export const providerLoginPromptSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), message: text(), placeholder: text(256).optional() }).strict(),
  z.object({ type: z.literal('secret'), message: text(), placeholder: text(256).optional() }).strict(),
  z.object({ type: z.literal('manual_code'), message: text(), placeholder: text(256).optional() }).strict(),
  z.object({
    type: z.literal('select'), message: text(),
    options: z.array(z.object({ id: text(256), label: text(512), description: text(1_000).optional() }).strict()).min(1).max(20),
  }).strict(),
])
export type ProviderLoginPrompt = z.infer<typeof providerLoginPromptSchema>

const base = { loginId: z.uuid() }
export const providerLoginEventSchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('auth_url'), url: text(4_096), instructions: text().optional() }).strict(),
  z.object({ ...base, type: z.literal('device_code'), userCode: text(64), verificationUri: text(4_096), expiresInSeconds: z.number().int().positive().optional() }).strict(),
  z.object({ ...base, type: z.literal('info'), message: text(), links: z.array(z.object({ url: text(4_096), label: text(256).optional() }).strict()).max(5).optional() }).strict(),
  z.object({ ...base, type: z.literal('progress'), message: text() }).strict(),
  z.object({ ...base, type: z.literal('prompt'), promptId: z.uuid(), prompt: providerLoginPromptSchema }).strict(),
  z.object({ ...base, type: z.literal('prompt_closed'), promptId: z.uuid() }).strict(),
  z.object({ ...base, type: z.literal('finished'), providers: z.array(builtinProviderSchema).max(200), apply: z.enum(['saved', 'applied', 'restarted', 'pending', 'unavailable', 'failed']) }).strict(),
  z.object({ ...base, type: z.literal('failed'), code: z.enum(['PORT_IN_USE', 'FAILED']), message: text(1_000) }).strict(),
  z.object({ ...base, type: z.literal('cancelled') }).strict(),
])
export type ProviderLoginEvent = z.infer<typeof providerLoginEventSchema>

export interface ProviderLoginApi {
  /** Starts Pi's subscription sign-in for a built-in provider; progress arrives as events. */
  start(providerId: string): Promise<{ loginId: string }>
  respond(loginId: string, promptId: string, value: string): Promise<void>
  cancel(loginId: string): Promise<void>
  subscribe(listener: (event: ProviderLoginEvent) => void): () => void
}
