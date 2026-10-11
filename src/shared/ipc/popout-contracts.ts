import { z } from 'zod'
import { defineIpcContract, requestContextSchema } from './contracts'
import { popoutSnapshotSchema, popoutTargetSchema } from '../popout'

export const popoutChannels = {
  open: 'pipilot:popout:open', get: 'pipilot:popout:get', send: 'pipilot:popout:send', abort: 'pipilot:popout:abort',
  pin: 'pipilot:popout:pin', showMain: 'pipilot:popout:show-main', changed: 'pipilot:popout:changed',
} as const
const context = { context: requestContextSchema }
const id = { popoutId: z.uuid() }
export const popoutOpenContract = defineIpcContract(popoutChannels.open, z.object({ ...context, target: popoutTargetSchema }).strict(), z.object(id).strict())
export const popoutGetContract = defineIpcContract(popoutChannels.get, z.object({ ...context, ...id }).strict(), popoutSnapshotSchema)
export const popoutSendContract = defineIpcContract(popoutChannels.send, z.object({ ...context, ...id, text: z.string().trim().min(1).max(20_000), requestId: z.uuid() }).strict(), popoutSnapshotSchema)
export const popoutAbortContract = defineIpcContract(popoutChannels.abort, z.object({ ...context, ...id }).strict(), popoutSnapshotSchema)
export const popoutPinContract = defineIpcContract(popoutChannels.pin, z.object({ ...context, ...id, pinned: z.boolean() }).strict(), popoutSnapshotSchema)
export const popoutShowMainContract = defineIpcContract(popoutChannels.showMain, z.object({ ...context, ...id }).strict(), z.object({ ok: z.literal(true) }).strict())
