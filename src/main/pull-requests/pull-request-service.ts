import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { realpath } from 'node:fs/promises'
import type { PullRequestCheck, PullRequestDetail, PullRequestFilter, PullRequestReviewAction, PullRequestStatus, PullRequestSummary } from '../../shared/pull-requests'
import type { ProjectWorkflowsApi } from '../../shared/project-workflows'
import type { PiRuntimeFrontend } from '../pi-host/pi-runtime-frontend'

const run = promisify(execFile)

export class PullRequestError extends Error {
  readonly code = 'PULL_REQUEST_FAILED'
}

interface Locations {
  getLocation(workspaceId: string): { path: string; name: string } | undefined
  get(): { recent: ReadonlyArray<{ id: string }> }
}

type RawCheck = { __typename?: string; name?: string; context?: string; status?: string; conclusion?: string | null; state?: string; detailsUrl?: string; targetUrl?: string }
interface RawPullRequest {
  number: number; title: string; url: string; author?: { login?: string }; headRefName: string; baseRefName: string
  isDraft: boolean; updatedAt: string; reviewDecision?: string | null; statusCheckRollup?: RawCheck[] | null; isCrossRepository?: boolean
  body?: string; reviews?: Array<{ author?: { login?: string }; state?: string }>
}

const LIST_FIELDS = 'number,title,url,author,headRefName,baseRefName,isDraft,updatedAt,reviewDecision,statusCheckRollup,isCrossRepository'
const FAILED = new Set(['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'ERROR'])

export function checkState(check: RawCheck): PullRequestCheck['state'] {
  const conclusion = (check.conclusion ?? check.state ?? '').toUpperCase()
  if (FAILED.has(conclusion)) return 'failing'
  if (conclusion === 'SUCCESS' || conclusion === 'NEUTRAL') return 'passing'
  if (conclusion === 'SKIPPED') return 'skipped'
  return 'pending'
}

function summarize(raw: RawPullRequest, login: string | undefined, requested: ReadonlySet<number>): PullRequestSummary {
  const checks = (raw.statusCheckRollup ?? []).map(checkState)
  const failed = checks.filter((state) => state === 'failing').length
  const review = raw.reviewDecision === 'APPROVED' ? 'approved' : raw.reviewDecision === 'CHANGES_REQUESTED' ? 'changes_requested'
    : raw.reviewDecision === 'REVIEW_REQUIRED' ? 'review_required' : 'none'
  return {
    number: raw.number, title: raw.title.slice(0, 1_024), author: (raw.author?.login ?? '').slice(0, 256),
    branch: raw.headRefName.slice(0, 512), base: raw.baseRefName.slice(0, 512), draft: raw.isDraft, url: raw.url.slice(0, 4_096),
    updatedAt: raw.updatedAt.slice(0, 64), review,
    checks: { state: checks.length === 0 ? 'none' : failed ? 'failing' : checks.includes('pending') ? 'pending' : 'passing', failed, total: checks.length },
    mine: Boolean(login && raw.author?.login === login), reviewRequested: requested.has(raw.number), crossRepository: raw.isCrossRepository === true,
  }
}

/**
 * Pull requests of a project's GitHub repository through the user's own `gh`
 * (its login and permissions). Reviews are submitted only when asked; a fix
 * runs in a working copy of the pull request's branch and is never pushed.
 */
export class PullRequestService {
  private login: { value?: string; at: number } | null = null

  constructor(private readonly options: {
    workspaces: Locations
    workflows: Pick<ProjectWorkflowsApi, 'createWorktree'>
    runtime: Pick<PiRuntimeFrontend, 'acquireControlRuntime' | 'submitControlPrompt' | 'releaseControlRuntime' | 'subscribeControlRuntimes' | 'renameSession'>
    /** The conversation's name, in the app's language. */
    fixTitle(number: number): string
  }) {}

  async status(workspaceId: string): Promise<PullRequestStatus> {
    const cwd = this.path(workspaceId)
    try { await this.gh(cwd, ['--version']) } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'ENOENT' ? { state: 'gh-missing' } : { state: 'gh-missing', message: this.message(error) }
    }
    try { await run('git', ['rev-parse', '--show-toplevel'], { cwd, timeout: 10_000, windowsHide: true }) } catch { return { state: 'not-git' } }
    const login = await this.currentLogin(cwd)
    if (!login) return { state: 'unauthenticated' }
    try {
      const repository = JSON.parse(await this.gh(cwd, ['repo', 'view', '--json', 'nameWithOwner'])) as { nameWithOwner?: string }
      return { state: 'ready', login, ...(repository.nameWithOwner ? { repository: repository.nameWithOwner.slice(0, 512) } : {}) }
    } catch (error) {
      return { state: 'not-github', login, message: this.message(error) }
    }
  }

  async list(workspaceId: string, filter: PullRequestFilter): Promise<PullRequestSummary[]> {
    const cwd = this.path(workspaceId)
    const login = await this.currentLogin(cwd)
    const query = async (extra: string[]) => JSON.parse(await this.gh(cwd, ['pr', 'list', '--state', 'open', '--limit', '50', '--json', LIST_FIELDS, ...extra])) as RawPullRequest[]
    if (filter === 'open') {
      const requested = new Set((await query(['--search', 'review-requested:@me']).catch(() => [])).map((pr) => pr.number))
      return (await query([])).map((pr) => summarize(pr, login, requested))
    }
    const [authored, requested] = await Promise.all([query(['--author', '@me']), query(['--search', 'review-requested:@me'])])
    const requestedNumbers = new Set(requested.map((pr) => pr.number))
    const merged = new Map<number, RawPullRequest>()
    for (const pr of [...authored, ...requested]) merged.set(pr.number, pr)
    return [...merged.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).map((pr) => summarize(pr, login, requestedNumbers))
  }

  async detail(workspaceId: string, number: number): Promise<PullRequestDetail> {
    const cwd = this.path(workspaceId)
    const login = await this.currentLogin(cwd)
    const raw = JSON.parse(await this.gh(cwd, ['pr', 'view', String(number), '--json', `${LIST_FIELDS},body,reviews,reviewRequests`])) as RawPullRequest & { reviewRequests?: Array<{ login?: string }> }
    const requested = new Set(raw.reviewRequests?.some((request) => request.login === login) ? [raw.number] : [])
    return {
      ...summarize(raw, login, requested),
      body: (raw.body ?? '').slice(0, 20_000),
      checkRuns: (raw.statusCheckRollup ?? []).slice(0, 200).map((check) => ({
        name: (check.name ?? check.context ?? 'Check').slice(0, 512), state: checkState(check),
        ...(check.detailsUrl ?? check.targetUrl ? { url: (check.detailsUrl ?? check.targetUrl)!.slice(0, 4_096) } : {}),
      })),
      reviews: (raw.reviews ?? []).slice(-100).map((review) => ({ author: (review.author?.login ?? '').slice(0, 256), state: (review.state ?? '').slice(0, 64) })),
    }
  }

  async review(workspaceId: string, number: number, action: PullRequestReviewAction, body: string) {
    const cwd = this.path(workspaceId)
    if (action !== 'approve' && !body.trim()) throw new PullRequestError('Write what should change.')
    const flag = action === 'approve' ? '--approve' : action === 'request-changes' ? '--request-changes' : '--comment'
    await this.gh(cwd, ['pr', 'review', String(number), flag, ...(body.trim() ? ['--body', body.trim()] : [])])
    return this.detail(workspaceId, number)
  }

  async fix(workspaceId: string, number: number) {
    const cwd = this.path(workspaceId)
    const detail = await this.detail(workspaceId, number)
    const failing = detail.checkRuns.filter((check) => check.state === 'failing')
    if (!failing.length) throw new PullRequestError('This pull request has no failing checks.')
    const target = await this.workingCopy(workspaceId, cwd, detail)
    const logs = await this.failedLogs(cwd, failing)
    const prompt = [
      `Pull request #${detail.number} "${detail.title}" (${detail.url}) has failing checks on branch ${detail.branch}.`,
      'Find the cause in the check output below, fix it in this working copy, and run the relevant checks locally. Do not push or comment on the pull request; I will review the changes first.',
      '', 'Failing checks:', ...failing.map((check) => `- ${check.name}${check.url ? `: ${check.url}` : ''}`),
      ...logs.flatMap(([name, log]) => ['', `Output of ${name}:`, '```text', log, '```']),
    ].join('\n')
    const lease = await this.options.runtime.acquireControlRuntime({ scope: { kind: 'project', workspaceId: target } })
    try {
      const accepted = await this.options.runtime.submitControlPrompt(lease, prompt.slice(0, 60_000), 'prompt')
      if (accepted.handle.sessionFile) {
        await this.options.runtime.renameSession({ kind: 'project', workspaceId: target }, accepted.handle.sessionFile, this.options.fixTitle(detail.number)).catch(() => undefined)
      }
      // Hold the conversation until its run settles; then it is an ordinary saved conversation.
      const stop = this.options.runtime.subscribeControlRuntimes((summaries) => {
        const summary = summaries.find((entry) => entry.runtimeId === lease.runtimeId)
        if (!summary || summary.lifecycle === 'idle') { stop(); this.options.runtime.releaseControlRuntime(lease) }
      })
      return { workspaceId: target, sessionId: accepted.handle.sessionId }
    } catch (error) {
      this.options.runtime.releaseControlRuntime(lease)
      throw new PullRequestError(this.message(error))
    }
  }

  /** The project's checkout of the pull request's branch: an existing one, or a new working copy. */
  private async workingCopy(workspaceId: string, cwd: string, detail: PullRequestDetail) {
    const git = (args: string[]) => run('git', args, { cwd, timeout: 120_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true }).then(({ stdout }) => stdout)
    const local = detail.crossRepository ? `pr-${detail.number}-${detail.branch}`.replace(/[^\w./-]+/gu, '-').slice(0, 200) : detail.branch
    const exists = await git(['show-ref', '--verify', '--quiet', `refs/heads/${local}`]).then(() => true, () => false)
    if (!exists) {
      try {
        if (detail.crossRepository) await git(['fetch', 'origin', `pull/${detail.number}/head:refs/heads/${local}`])
        else {
          await git(['fetch', 'origin', `+refs/heads/${detail.branch}:refs/remotes/origin/${detail.branch}`])
          await git(['branch', '--track', local, `origin/${detail.branch}`])
        }
      } catch (error) {
        throw new PullRequestError(`The pull request's branch could not be fetched: ${this.message(error)}`)
      }
    }
    // A branch is checked out once; reuse wherever it already is.
    const listing = await git(['worktree', 'list', '--porcelain'])
    const entries = listing.split(/\n\n/u).map((block) => ({ path: /^worktree (.+)$/mu.exec(block)?.[1], branch: /^branch refs\/heads\/(.+)$/mu.exec(block)?.[1] }))
    const checkedOut = entries.find((entry) => entry.branch === local)?.path
    if (checkedOut) {
      const canonical = await realpath(checkedOut).catch(() => checkedOut)
      const owner = this.options.workspaces.get().recent.find(({ id }) => this.options.workspaces.getLocation(id)?.path === canonical)
      if (owner) return owner.id
      throw new PullRequestError(`The branch ${local} is checked out at ${checkedOut}, outside PiPilot. Add that folder as a project, or switch it to another branch.`)
    }
    const worktree = await this.options.workflows.createWorktree({ projectId: workspaceId, name: `PR #${detail.number}`.slice(0, 80), branch: local, baseBranch: local, checkoutExisting: true })
    if (!worktree.workspaceId) throw new PullRequestError('The working copy could not be opened.')
    return worktree.workspaceId
  }

  /** The failed steps' output of GitHub Actions jobs; other checks link out. */
  private async failedLogs(cwd: string, failing: readonly PullRequestCheck[]) {
    const logs: Array<[string, string]> = []
    let budget = 30_000
    for (const check of failing.slice(0, 4)) {
      const match = /\/actions\/runs\/(\d+)(?:\/job\/(\d+))?/u.exec(check.url ?? '')
      if (!match || budget <= 0) continue
      try {
        const output = await this.gh(cwd, ['run', 'view', match[1]!, ...(match[2] ? ['--job', match[2]] : []), '--log-failed'], 60_000)
        // eslint-disable-next-line no-control-regex
        const clean = output.replace(/\u001b\[[0-9;]*m/gu, '').trim()
        const tail = clean.slice(-Math.min(12_000, budget))
        budget -= tail.length
        if (tail) logs.push([check.name, tail])
      } catch { /* The check is still listed with its link. */ }
    }
    return logs
  }

  private async currentLogin(cwd: string) {
    if (this.login && Date.now() - this.login.at < 5 * 60_000) return this.login.value
    try {
      const value = (await this.gh(cwd, ['api', 'user', '--jq', '.login'])).trim().slice(0, 256) || undefined
      this.login = { value, at: Date.now() }
      return value
    } catch {
      this.login = null
      return undefined
    }
  }

  private async gh(cwd: string, args: string[], timeout = 30_000) {
    try {
      const { stdout } = await run('gh', args, { cwd, timeout, maxBuffer: 16 * 1024 * 1024, windowsHide: true, env: { ...process.env, GH_PROMPT_DISABLED: '1', NO_COLOR: '1', GH_NO_UPDATE_NOTIFIER: '1' } })
      return stdout
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw error
      throw new PullRequestError(this.message(error))
    }
  }

  private path(workspaceId: string) {
    const location = this.options.workspaces.getLocation(workspaceId)
    if (!location) throw new PullRequestError('The project is unavailable.')
    return location.path
  }

  private message(error: unknown) {
    const stderr = (error as { stderr?: unknown }).stderr
    return (typeof stderr === 'string' && stderr.trim() ? stderr.trim() : error instanceof Error ? error.message : 'gh failed.').slice(0, 1_000)
  }
}
