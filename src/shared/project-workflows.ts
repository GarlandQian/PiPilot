import { z } from 'zod'

const text = (max: number) => z.string().max(max).refine((value) => !value.includes('\0'))
export const projectActionSchema = z.object({
  id: z.uuid(), name: text(80).trim().min(1), command: text(8_000),
  cwd: text(1_024).default('.'),
  platforms: z.object({ darwin: text(8_000).optional(), linux: text(8_000).optional(), win32: text(8_000).optional() }).strict(),
}).strict()
export type ProjectAction = z.infer<typeof projectActionSchema>
export const projectActionRunSchema = z.object({
  id: z.uuid(), workspaceId: z.uuid(), actionId: z.uuid(), name: text(80), command: text(8_000),
  cwd: text(4_096), startedAt: z.string(), finishedAt: z.string().optional(),
  status: z.enum(['running', 'stopping', 'completed', 'failed', 'stopped', 'interrupted']),
  exitCode: z.number().int().nullable(), output: z.string().max(131_072),
}).strict()
export type ProjectActionRun = z.infer<typeof projectActionRunSchema>
export const worktreeSchema = z.object({
  id: z.uuid(), workspaceId: z.uuid().optional(), projectId: z.uuid(), projectName: text(256),
  repository: text(4_096), commonDirectory: text(4_096), path: text(4_096), archivePath: text(4_096),
  name: text(80), branch: text(256), baseBranch: text(256), createdAt: z.string(),
  state: z.enum(['creating', 'active', 'archiving', 'archived', 'restoring', 'error']),
  error: text(1_000).optional(),
}).strict()
export type ManagedWorktree = z.infer<typeof worktreeSchema>
export const workflowSnapshotSchema = z.object({
  revision: z.number().int().nonnegative(), workspaceId: z.uuid(),
  actions: z.array(projectActionSchema).max(30), runs: z.array(projectActionRunSchema).max(100),
  worktrees: z.array(worktreeSchema).max(500), branches: z.array(text(256)).max(2_000),
  gitAvailable: z.boolean(), platform: z.enum(['darwin', 'linux', 'win32']),
}).strict()
export type ProjectWorkflowSnapshot = z.infer<typeof workflowSnapshotSchema>
export const createWorktreeInputSchema = z.object({
  projectId: z.uuid(), name: text(80).trim().min(1), baseBranch: text(256).trim().min(1),
  branch: text(256).trim().min(1), setupActionId: z.uuid().optional(),
  expectedActionRevision: z.number().int().nonnegative().optional(),
}).strict()
export type CreateWorktreeInput = z.infer<typeof createWorktreeInputSchema>

export interface ProjectWorkflowsApi {
  get(workspaceId: string): Promise<ProjectWorkflowSnapshot>
  saveActions(workspaceId: string, actions: ProjectAction[], expectedRevision: number): Promise<ProjectWorkflowSnapshot>
  run(workspaceId: string, actionId: string, expectedRevision: number): Promise<ProjectActionRun>
  stop(runId: string): Promise<ProjectActionRun>
  createWorktree(input: CreateWorktreeInput): Promise<ManagedWorktree>
  archiveWorktree(id: string): Promise<ManagedWorktree>
  restoreWorktree(id: string): Promise<ManagedWorktree>
}
