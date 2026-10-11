import { z } from 'zod'

const text = (max: number) => z.string().max(max)
export const comparisonModelSchema = z.object({ provider: text(256).min(1), modelId: text(256).min(1), name: text(256) }).strict()
export type ComparisonModel = z.infer<typeof comparisonModelSchema>

export const comparisonRunSchema = z.object({
  model: comparisonModelSchema,
  worktreeId: z.uuid().optional(),
  workspaceId: z.uuid().optional(),
  sessionId: text(256).optional(),
  status: z.enum(['preparing', 'running', 'done', 'failed']),
  error: text(1_000).optional(),
  files: z.number().int().nonnegative().optional(),
  additions: z.number().int().nonnegative().optional(),
  deletions: z.number().int().nonnegative().optional(),
  /** The model's final answer. */
  answer: text(40_000).optional(),
}).strict()
export type ComparisonRun = z.infer<typeof comparisonRunSchema>

export const comparisonSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  prompt: text(20_000),
  createdAt: text(64),
  baseBranch: text(256),
  baseCommit: text(64),
  runs: z.array(comparisonRunSchema).min(2).max(4),
  judge: z.object({
    model: comparisonModelSchema,
    status: z.enum(['waiting', 'running', 'done', 'failed']),
    sessionId: text(256).optional(),
    text: text(40_000).optional(),
    error: text(1_000).optional(),
  }).strict().optional(),
  appliedIndex: z.number().int().nonnegative().optional(),
}).strict()
export type Comparison = z.infer<typeof comparisonSchema>

export const startComparisonSchema = z.object({
  projectId: z.uuid(),
  prompt: text(20_000).trim().min(1),
  models: z.array(comparisonModelSchema).min(2).max(4),
  judge: comparisonModelSchema.optional(),
}).strict()
export type StartComparisonInput = z.infer<typeof startComparisonSchema>

export const comparisonsChangedEventSchema = z.object({ eventId: z.uuid(), comparisons: z.array(comparisonSchema).max(100) }).strict()

export interface ComparisonsApi {
  list(): Promise<Comparison[]>
  /** One working copy and conversation per model, all from the project's current branch. */
  start(input: StartComparisonInput): Promise<Comparison>
  /** A run's changes against where it started, for review. */
  diff(id: string, index: number): Promise<{ patch: string; truncated: boolean }>
  /** Applies a run's changes to the project's own working tree. */
  apply(id: string, index: number): Promise<Comparison>
  /** Archives the working copies; their conversations stay saved. */
  remove(id: string): Promise<void>
  subscribe(listener: (comparisons: Comparison[]) => void): () => void
}
