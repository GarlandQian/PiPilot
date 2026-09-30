import { z } from 'zod'
import { defineIpcContract, requestContextSchema } from './contracts'
import { listConversationsInputSchema } from '../external-control'
import { scheduledTaskInputSchema, scheduledTasksSnapshotSchema, scheduledTargetsResultSchema } from '../scheduled-tasks'

export const scheduledTaskChannels = {
  get: 'pipilot:scheduled-tasks:get', save: 'pipilot:scheduled-tasks:save', remove: 'pipilot:scheduled-tasks:remove',
  setEnabled: 'pipilot:scheduled-tasks:set-enabled', run: 'pipilot:scheduled-tasks:run', targets: 'pipilot:scheduled-tasks:targets', changed: 'pipilot:scheduled-tasks:changed',
} as const
const context = { context: requestContextSchema }
const identity = z.object({ ...context, id: z.uuid() }).strict()
export const scheduledTasksGetContract = defineIpcContract(scheduledTaskChannels.get, z.object(context).strict(), scheduledTasksSnapshotSchema)
export const scheduledTasksSaveContract = defineIpcContract(scheduledTaskChannels.save, z.object({ ...context, task: scheduledTaskInputSchema }).strict(), scheduledTasksSnapshotSchema)
export const scheduledTasksRemoveContract = defineIpcContract(scheduledTaskChannels.remove, identity, scheduledTasksSnapshotSchema)
export const scheduledTasksRunContract = defineIpcContract(scheduledTaskChannels.run, identity, scheduledTasksSnapshotSchema)
export const scheduledTasksSetEnabledContract = defineIpcContract(scheduledTaskChannels.setEnabled, identity.extend({ enabled: z.boolean() }).strict(), scheduledTasksSnapshotSchema)
export const scheduledTasksTargetsContract = defineIpcContract(scheduledTaskChannels.targets, z.object({ ...context, input: listConversationsInputSchema }).strict(), scheduledTargetsResultSchema)
