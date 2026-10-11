import { z } from 'zod'

/** Pi's `defaultProjectTrust`: what an undecided project gets. */
export const projectTrustPolicySchema = z.enum(['ask', 'always', 'never'])
export type ProjectTrustPolicy = z.infer<typeof projectTrustPolicySchema>

/** The choices of Pi's trust prompt, plus clearing a saved decision. */
export const projectTrustChoiceSchema = z.enum(['trust', 'trust-parent', 'session', 'distrust', 'reset'])
export type ProjectTrustChoice = z.infer<typeof projectTrustChoiceSchema>

/**
 * - `not-required`: the project has no `.pi` resources Pi gates by trust.
 * - `undecided`: it has them, nothing is saved and the policy is "ask"; Pi
 *   runs without them until the user decides.
 */
export const projectTrustStateSchema = z.enum(['not-required', 'trusted', 'untrusted', 'undecided'])
export type ProjectTrustState = z.infer<typeof projectTrustStateSchema>

const pathSchema = z.string().min(1).max(4_096)

export const projectTrustStatusSchema = z.object({
  workspaceId: z.uuid(),
  path: pathSchema,
  state: projectTrustStateSchema,
  trusted: z.boolean(),
  /** Where the saved decision lives: the project itself or an ancestor. */
  savedPath: pathSchema.optional(),
  /** True when the decision lasts only until PiPilot quits. */
  sessionOnly: z.boolean(),
  parentPath: pathSchema.optional(),
  policy: projectTrustPolicySchema,
  /** Whether open conversations already run with this decision. */
  apply: z.enum(['applied', 'pending', 'failed']),
}).strict()
export type ProjectTrustStatus = z.infer<typeof projectTrustStatusSchema>

export const projectTrustChangedEventSchema = z.object({
  eventId: z.uuid(),
  workspaceId: z.uuid().optional(),
}).strict()

export interface ProjectTrustApi {
  get(workspaceId: string): Promise<ProjectTrustStatus>
  decide(workspaceId: string, choice: ProjectTrustChoice): Promise<ProjectTrustStatus>
  getPolicy(): Promise<ProjectTrustPolicy>
  setPolicy(policy: ProjectTrustPolicy): Promise<ProjectTrustPolicy>
  /** Fires when a decision, the policy or its application changes; `workspaceId` is absent for global changes. */
  subscribe(listener: (workspaceId: string | undefined) => void): () => void
}
