import { z } from 'zod'
import { defineIpcContract, requestContextSchema } from './contracts'
import { createSideConversationSchema, sendSideConversationSchema, sideConversationSnapshotSchema } from '../side-conversations'
const sideRequest = z.object({ context: requestContextSchema, sideId: z.uuid() }).strict()
export const sideConversationCreateContract = defineIpcContract('pipilot:side-conversations:create', z.object({ context: requestContextSchema, input: createSideConversationSchema }).strict(), sideConversationSnapshotSchema)
export const sideConversationSendContract = defineIpcContract('pipilot:side-conversations:send', z.object({ context: requestContextSchema, input: sendSideConversationSchema }).strict(), sideConversationSnapshotSchema)
export const sideConversationGetContract = defineIpcContract('pipilot:side-conversations:get', sideRequest, sideConversationSnapshotSchema)
export const sideConversationAbortContract = defineIpcContract('pipilot:side-conversations:abort', sideRequest, sideConversationSnapshotSchema)
export const sideConversationReleaseContract = defineIpcContract('pipilot:side-conversations:release', sideRequest, z.void())
