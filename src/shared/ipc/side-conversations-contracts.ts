import { z } from 'zod'
import { defineIpcContract, requestContextSchema } from './contracts'
import { configureSideConversationSchema, createSideConversationSchema, listSideConversationsSchema, respondSideConversationSchema, sendSideConversationSchema, sideConversationSnapshotSchema } from '../side-conversations'
const sideRequest = z.object({ context: requestContextSchema, sideId: z.uuid() }).strict()
export const sideConversationCreateContract = defineIpcContract('pipilot:side-conversations:create', z.object({ context: requestContextSchema, input: createSideConversationSchema }).strict(), sideConversationSnapshotSchema)
export const sideConversationSendContract = defineIpcContract('pipilot:side-conversations:send', z.object({ context: requestContextSchema, input: sendSideConversationSchema }).strict(), sideConversationSnapshotSchema)
export const sideConversationGetContract = defineIpcContract('pipilot:side-conversations:get', sideRequest, sideConversationSnapshotSchema)
export const sideConversationListContract = defineIpcContract('pipilot:side-conversations:list', z.object({ context: requestContextSchema, input: listSideConversationsSchema }).strict(), z.array(sideConversationSnapshotSchema).max(64))
export const sideConversationConfigureContract = defineIpcContract('pipilot:side-conversations:configure', z.object({ context: requestContextSchema, input: configureSideConversationSchema }).strict(), sideConversationSnapshotSchema)
export const sideConversationRespondContract = defineIpcContract('pipilot:side-conversations:respond', z.object({ context: requestContextSchema, input: respondSideConversationSchema }).strict(), sideConversationSnapshotSchema)
export const sideConversationAbortContract = defineIpcContract('pipilot:side-conversations:abort', sideRequest, sideConversationSnapshotSchema)
export const sideConversationReleaseContract = defineIpcContract('pipilot:side-conversations:release', sideRequest, z.void())
