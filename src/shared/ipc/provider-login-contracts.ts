import { z } from 'zod'
import { defineIpcContract, requestContextSchema } from './contracts'

export const providerLoginChannels = {
  start: 'pipilot:provider-login:start', respond: 'pipilot:provider-login:respond',
  cancel: 'pipilot:provider-login:cancel', event: 'pipilot:provider-login:event',
} as const
const context = { context: requestContextSchema }
export const providerLoginStartContract = defineIpcContract(providerLoginChannels.start,
  z.object({ ...context, providerId: z.string().min(1).max(128) }).strict(), z.object({ loginId: z.uuid() }).strict())
export const providerLoginRespondContract = defineIpcContract(providerLoginChannels.respond,
  z.object({ ...context, loginId: z.uuid(), promptId: z.uuid(), value: z.string().max(16_384) }).strict(), z.object({ ok: z.literal(true) }).strict())
export const providerLoginCancelContract = defineIpcContract(providerLoginChannels.cancel,
  z.object({ ...context, loginId: z.uuid() }).strict(), z.object({ ok: z.literal(true) }).strict())
