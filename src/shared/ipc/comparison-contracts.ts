import { z } from 'zod'
import { defineIpcContract, requestContextSchema } from './contracts'
import { comparisonSchema, startComparisonSchema } from '../comparisons'

export const comparisonChannels = {
  list: 'pipilot:comparisons:list', start: 'pipilot:comparisons:start', diff: 'pipilot:comparisons:diff',
  apply: 'pipilot:comparisons:apply', remove: 'pipilot:comparisons:remove', changed: 'pipilot:comparisons:changed',
} as const
const context = { context: requestContextSchema }
const run = { ...context, id: z.uuid(), index: z.number().int().min(0).max(3) }
export const comparisonListContract = defineIpcContract(comparisonChannels.list, z.object(context).strict(), z.array(comparisonSchema).max(100))
export const comparisonStartContract = defineIpcContract(comparisonChannels.start, z.object({ ...context, input: startComparisonSchema }).strict(), comparisonSchema)
export const comparisonDiffContract = defineIpcContract(comparisonChannels.diff, z.object(run).strict(), z.object({ patch: z.string().max(400_000), truncated: z.boolean() }).strict())
export const comparisonApplyContract = defineIpcContract(comparisonChannels.apply, z.object(run).strict(), comparisonSchema)
export const comparisonRemoveContract = defineIpcContract(comparisonChannels.remove, z.object({ ...context, id: z.uuid() }).strict(), z.object({ ok: z.literal(true) }).strict())
