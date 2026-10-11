import { z } from 'zod'
import { defineIpcContract, requestContextSchema } from './contracts'
import { projectTrustChoiceSchema, projectTrustPolicySchema, projectTrustStatusSchema } from '../project-trust'

export const projectTrustChannels = {
  get: 'pipilot:project-trust:get', decide: 'pipilot:project-trust:decide',
  getPolicy: 'pipilot:project-trust:get-policy', setPolicy: 'pipilot:project-trust:set-policy',
  changed: 'pipilot:project-trust:changed',
} as const
const context = { context: requestContextSchema }
export const projectTrustGetContract = defineIpcContract(projectTrustChannels.get, z.object({ ...context, workspaceId: z.uuid() }).strict(), projectTrustStatusSchema)
export const projectTrustDecideContract = defineIpcContract(projectTrustChannels.decide, z.object({ ...context, workspaceId: z.uuid(), choice: projectTrustChoiceSchema }).strict(), projectTrustStatusSchema)
export const projectTrustGetPolicyContract = defineIpcContract(projectTrustChannels.getPolicy, z.object(context).strict(), projectTrustPolicySchema)
export const projectTrustSetPolicyContract = defineIpcContract(projectTrustChannels.setPolicy, z.object({ ...context, policy: projectTrustPolicySchema }).strict(), projectTrustPolicySchema)
