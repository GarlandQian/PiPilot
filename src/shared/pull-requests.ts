import { z } from 'zod'

export const pullRequestFilterSchema = z.enum(['mine', 'open'])
export type PullRequestFilter = z.infer<typeof pullRequestFilterSchema>

const text = (max: number) => z.string().max(max)

export const pullRequestCheckSchema = z.object({
  name: text(512),
  state: z.enum(['passing', 'failing', 'pending', 'skipped']),
  url: text(4_096).optional(),
}).strict()
export type PullRequestCheck = z.infer<typeof pullRequestCheckSchema>

export const pullRequestSummarySchema = z.object({
  number: z.number().int().positive(),
  title: text(1_024),
  author: text(256),
  branch: text(512),
  base: text(512),
  draft: z.boolean(),
  url: text(4_096),
  updatedAt: text(64),
  /** GitHub's review decision. */
  review: z.enum(['approved', 'changes_requested', 'review_required', 'none']),
  checks: z.object({ state: z.enum(['passing', 'failing', 'pending', 'none']), failed: z.number().int().nonnegative(), total: z.number().int().nonnegative() }).strict(),
  mine: z.boolean(),
  reviewRequested: z.boolean(),
  crossRepository: z.boolean(),
}).strict()
export type PullRequestSummary = z.infer<typeof pullRequestSummarySchema>

export const pullRequestDetailSchema = pullRequestSummarySchema.extend({
  body: text(20_000),
  checkRuns: z.array(pullRequestCheckSchema).max(200),
  reviews: z.array(z.object({ author: text(256), state: text(64) }).strict()).max(100),
}).strict()
export type PullRequestDetail = z.infer<typeof pullRequestDetailSchema>

/** Whether `gh` can answer for this project. */
export const pullRequestStatusSchema = z.object({
  state: z.enum(['ready', 'gh-missing', 'unauthenticated', 'not-github', 'not-git']),
  login: text(256).optional(),
  repository: text(512).optional(),
  message: text(1_000).optional(),
}).strict()
export type PullRequestStatus = z.infer<typeof pullRequestStatusSchema>

export const pullRequestReviewActionSchema = z.enum(['approve', 'request-changes', 'comment'])
export type PullRequestReviewAction = z.infer<typeof pullRequestReviewActionSchema>

export interface PullRequestsApi {
  status(workspaceId: string): Promise<PullRequestStatus>
  list(workspaceId: string, filter: PullRequestFilter): Promise<PullRequestSummary[]>
  detail(workspaceId: string, number: number): Promise<PullRequestDetail>
  review(workspaceId: string, number: number, action: PullRequestReviewAction, body: string): Promise<PullRequestDetail>
  /**
   * Opens a working copy on the pull request's branch and starts a conversation
   * there with the failing checks and their logs.
   */
  fix(workspaceId: string, number: number): Promise<{ workspaceId: string; sessionId: string }>
}
