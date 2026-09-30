import { z } from 'zod'
import { defineIpcContract, requestContextSchema } from './contracts'
import { createWorktreeInputSchema, projectActionRunSchema, projectActionSchema, workflowSnapshotSchema, worktreeSchema } from '../project-workflows'
const context = { context: requestContextSchema }
export const projectWorkflowsGetContract = defineIpcContract('pipilot:project-workflows:get', z.object({ ...context, workspaceId: z.uuid() }).strict(), workflowSnapshotSchema)
export const projectActionsSaveContract = defineIpcContract('pipilot:project-workflows:save-actions', z.object({ ...context, workspaceId: z.uuid(), actions: z.array(projectActionSchema).max(30), expectedRevision: z.number().int().nonnegative() }).strict(), workflowSnapshotSchema)
export const projectActionsRunContract = defineIpcContract('pipilot:project-workflows:run', z.object({ ...context, workspaceId: z.uuid(), actionId: z.uuid(), expectedRevision: z.number().int().nonnegative() }).strict(), projectActionRunSchema)
export const projectActionsStopContract = defineIpcContract('pipilot:project-workflows:stop', z.object({ ...context, runId: z.uuid() }).strict(), projectActionRunSchema)
export const worktreeCreateContract = defineIpcContract('pipilot:project-workflows:create', z.object({ ...context, input: createWorktreeInputSchema }).strict(), worktreeSchema)
export const worktreeArchiveContract = defineIpcContract('pipilot:project-workflows:archive', z.object({ ...context, id: z.uuid() }).strict(), worktreeSchema)
export const worktreeRestoreContract = defineIpcContract('pipilot:project-workflows:restore', z.object({ ...context, id: z.uuid() }).strict(), worktreeSchema)
