import { z } from 'zod'
import { defineIpcContract, requestContextSchema } from './contracts'
import { pullRequestDetailSchema, pullRequestFilterSchema, pullRequestReviewActionSchema, pullRequestStatusSchema, pullRequestSummarySchema } from '../pull-requests'

const context = { context: requestContextSchema, workspaceId: z.uuid() }
const number = { number: z.number().int().positive() }
export const pullRequestStatusContract = defineIpcContract('pipilot:pull-requests:status', z.object(context).strict(), pullRequestStatusSchema)
export const pullRequestListContract = defineIpcContract('pipilot:pull-requests:list', z.object({ ...context, filter: pullRequestFilterSchema }).strict(), z.array(pullRequestSummarySchema).max(100))
export const pullRequestDetailContract = defineIpcContract('pipilot:pull-requests:detail', z.object({ ...context, ...number }).strict(), pullRequestDetailSchema)
export const pullRequestReviewContract = defineIpcContract('pipilot:pull-requests:review', z.object({ ...context, ...number, action: pullRequestReviewActionSchema, body: z.string().max(20_000) }).strict(), pullRequestDetailSchema)
export const pullRequestFixContract = defineIpcContract('pipilot:pull-requests:fix', z.object({ ...context, ...number }).strict(), z.object({ workspaceId: z.uuid(), sessionId: z.string().min(1).max(256) }).strict())
