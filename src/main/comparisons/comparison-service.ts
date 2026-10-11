import { execFile, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { promisify } from 'node:util'
import { comparisonSchema, startComparisonSchema, type Comparison, type ComparisonModel, type StartComparisonInput } from '../../shared/comparisons'
import type { LocalPiAgentMessage } from '../../shared/local-pi'
import type { ProjectWorkflowsApi } from '../../shared/project-workflows'
import type { PiRuntimeControlLease, PiRuntimeFrontend } from '../pi-host/pi-runtime-frontend'

const execute = promisify(execFile)

export class ComparisonError extends Error {
  readonly code = 'COMPARISON_FAILED'
}

type Runtime = Pick<PiRuntimeFrontend, 'acquireControlRuntime' | 'releaseControlRuntime' | 'submitControlPrompt' | 'subscribeControlRuntimes' |
  'listControlRuntimes' | 'getControlTranscript' | 'commandControlRuntime' | 'renameSession'>

interface Locations { getLocation(workspaceId: string): { path: string; name: string } | undefined }

function lastAnswer(messages: readonly LocalPiAgentMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!
    if (message.role !== 'assistant') continue
    const text = message.content.flatMap((part) => part.type === 'text' ? [part.text] : []).join('\n').trim()
    if (text) return text.slice(-40_000)
  }
  return undefined
}

/**
 * Cursor's best-of-n: the same prompt to 2–4 models, each in its own working
 * copy made from the project's current branch, compared side by side. One
 * result can be applied to the project; an optional judge model compares them.
 */
export class ComparisonService {
  private comparisons: Comparison[] = []
  private readonly listeners = new Set<(comparisons: Comparison[]) => void>()
  private readonly leases = new Map<string, PiRuntimeControlLease>()
  /** Leases whose run was seen working: idle after that means finished. */
  private readonly started = new Set<string>()
  private writes = Promise.resolve()
  private detach: (() => void) | null = null

  constructor(private readonly options: {
    file: string
    workspaces: Locations
    workflows: Pick<ProjectWorkflowsApi, 'createWorktree' | 'archiveWorktree' | 'get'>
    runtime: Runtime
    title(model: ComparisonModel, prompt: string): string
    judgeTitle(prompt: string): string
  }) {}

  async initialize() {
    try {
      const raw = JSON.parse(await readFile(this.options.file, 'utf8')) as unknown
      this.comparisons = Array.isArray(raw) ? raw.flatMap((item) => { const parsed = comparisonSchema.safeParse(item); return parsed.success ? [parsed.data] : [] }) : []
    } catch { this.comparisons = [] }
    // Work that was running when PiPilot quit finished (or stopped) in its saved conversation.
    for (const comparison of this.comparisons) {
      for (const run of comparison.runs) if (run.status === 'preparing' || run.status === 'running') { run.status = 'done'; void this.measure(comparison, run) }
      if (comparison.judge && comparison.judge.status !== 'done' && comparison.judge.status !== 'failed') comparison.judge = { ...comparison.judge, status: 'failed', error: 'PiPilot quit before the comparison finished.' }
    }
    this.detach = this.options.runtime.subscribeControlRuntimes((summaries) => {
      for (const [key, lease] of this.leases) {
        const summary = summaries.find((entry) => entry.runtimeId === lease.runtimeId)
        if (summary && summary.lifecycle !== 'idle') { this.started.add(key); continue }
        if (summary && !this.started.has(key)) continue
        this.leases.delete(key)
        this.started.delete(key)
        void this.settle(key, lease, summary?.outcome === 'failed')
      }
    })
  }

  dispose() {
    this.detach?.()
    for (const lease of this.leases.values()) this.options.runtime.releaseControlRuntime(lease)
    this.leases.clear()
    this.listeners.clear()
  }

  subscribe(listener: (comparisons: Comparison[]) => void) {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  list() { return structuredClone(this.comparisons) }

  async start(raw: StartComparisonInput) {
    const input = startComparisonSchema.parse(raw)
    const project = this.path(input.projectId)
    const git = (args: string[]) => execute('git', args, { cwd: project, timeout: 30_000, windowsHide: true }).then(({ stdout }) => stdout.trim())
    const baseBranch = await git(['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => '')
    if (!baseBranch || baseBranch === 'HEAD') throw new ComparisonError('Check out a branch in the project first; the working copies start from it.')
    const baseCommit = await git(['rev-parse', 'HEAD'])
    const id = randomUUID()
    const comparison: Comparison = {
      id, projectId: input.projectId, prompt: input.prompt, createdAt: new Date().toISOString(), baseBranch, baseCommit,
      runs: input.models.map((model) => ({ model, status: 'preparing' as const })),
      ...(input.judge ? { judge: { model: input.judge, status: 'waiting' as const } } : {}),
    }
    this.comparisons.unshift(comparison)
    this.comparisons = this.comparisons.slice(0, 50)
    await this.save()
    void this.launch(comparison)
    return structuredClone(comparison)
  }

  async diff(id: string, index: number) {
    const { comparison, run } = this.run(id, index)
    const patch = await this.patch(comparison, run, false)
    return patch.length > 400_000 ? { patch: patch.slice(0, 400_000), truncated: true } : { patch, truncated: false }
  }

  async apply(id: string, index: number) {
    const { comparison, run } = this.run(id, index)
    if (run.status !== 'done') throw new ComparisonError('Wait for this model to finish.')
    const patch = await this.patch(comparison, run, true)
    if (!patch.trim()) throw new ComparisonError('This model changed no files.')
    await new Promise<void>((resolve, reject) => {
      const child = spawn('git', ['apply', '--3way', '--whitespace=nowarn', '-'], { cwd: this.path(comparison.projectId), windowsHide: true })
      let stderr = ''
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
      child.on('error', reject)
      child.on('close', (code) => code === 0 ? resolve() : reject(new ComparisonError(`The changes could not be applied: ${stderr.trim().slice(0, 900) || `git exited with ${code}`}`)))
      child.stdin.end(patch)
    })
    comparison.appliedIndex = index
    await this.save()
    return structuredClone(comparison)
  }

  async remove(id: string) {
    const comparison = this.comparisons.find((candidate) => candidate.id === id)
    if (!comparison) return
    for (const [key, lease] of this.leases) if (key.startsWith(`${id}:`)) { this.options.runtime.releaseControlRuntime(lease); this.leases.delete(key) }
    for (const run of comparison.runs) if (run.worktreeId) await this.options.workflows.archiveWorktree(run.worktreeId).catch(() => undefined)
    this.comparisons = this.comparisons.filter((candidate) => candidate !== comparison)
    await this.save()
  }

  private async launch(comparison: Comparison) {
    // Working copies are made one at a time (Git serializes them anyway).
    for (const [index, run] of comparison.runs.entries()) {
      try {
        const worktree = await this.options.workflows.createWorktree({
          projectId: comparison.projectId, name: run.model.name.slice(0, 80) || run.model.modelId.slice(0, 80),
          branch: `pipilot/compare-${comparison.id.slice(0, 8)}-${index + 1}`, baseBranch: comparison.baseBranch,
        })
        if (!worktree.workspaceId) throw new Error('The working copy could not be opened.')
        run.worktreeId = worktree.id
        run.workspaceId = worktree.workspaceId
      } catch (error) {
        run.status = 'failed'; run.error = this.message(error)
      }
      await this.save()
    }
    await Promise.all(comparison.runs.map(async (run, index) => {
      if (run.status === 'failed' || !run.workspaceId) return
      try {
        const lease = await this.options.runtime.acquireControlRuntime({ scope: { kind: 'project', workspaceId: run.workspaceId } })
        await this.options.runtime.commandControlRuntime(lease, { type: 'set_model', provider: run.model.provider, modelId: run.model.modelId })
        const accepted = await this.options.runtime.submitControlPrompt(lease, comparison.prompt, 'prompt')
        run.sessionId = accepted.handle.sessionId
        run.status = 'running'
        // Accepted means running: the next idle summary is its end.
        this.watch(`${comparison.id}:${index}`, lease)
        if (accepted.handle.sessionFile) {
          await this.options.runtime.renameSession({ kind: 'project', workspaceId: run.workspaceId }, accepted.handle.sessionFile, this.options.title(run.model, comparison.prompt)).catch(() => undefined)
        }
      } catch (error) {
        run.status = 'failed'; run.error = this.message(error)
      }
      await this.save()
    }))
    await this.judgeIfReady(comparison)
  }

  /** Waits for the run to end; a fast one may already have. */
  private watch(key: string, lease: PiRuntimeControlLease) {
    this.leases.set(key, lease)
    this.started.add(key)
    const summary = this.options.runtime.listControlRuntimes().find((entry) => entry.runtimeId === lease.runtimeId)
    if (summary?.lifecycle === 'idle' && summary.outcome) {
      this.leases.delete(key)
      this.started.delete(key)
      void this.settle(key, lease, summary.outcome === 'failed')
    }
  }

  /** A run's conversation went idle: keep its answer and what it changed. */
  private async settle(key: string, lease: PiRuntimeControlLease, failed: boolean) {
    const [id, rawIndex] = key.split(':')
    const comparison = this.comparisons.find((candidate) => candidate.id === id)
    try {
      if (!comparison) return
      if (rawIndex === 'judge') {
        const transcript = await this.options.runtime.getControlTranscript(lease).catch(() => null)
        if (comparison.judge) comparison.judge = { ...comparison.judge, status: failed ? 'failed' : 'done', ...(transcript ? { text: lastAnswer(transcript.messages) } : {}) }
        return
      }
      const run = comparison.runs[Number(rawIndex)]
      if (!run) return
      const transcript = await this.options.runtime.getControlTranscript(lease).catch(() => null)
      const answer = transcript ? lastAnswer(transcript.messages) : undefined
      run.status = failed ? 'failed' : 'done'
      if (answer) run.answer = answer
      if (failed && !run.error) run.error = 'The model stopped with an error. Open its conversation for details.'
      await this.measure(comparison, run)
      await this.judgeIfReady(comparison)
    } finally {
      this.options.runtime.releaseControlRuntime(lease)
      await this.save()
    }
  }

  private async judgeIfReady(comparison: Comparison) {
    const judge = comparison.judge
    if (!judge || judge.status !== 'waiting' || comparison.runs.some((run) => run.status === 'preparing' || run.status === 'running')) return
    comparison.judge = { ...judge, status: 'running' }
    await this.save()
    try {
      const sections = await Promise.all(comparison.runs.map(async (run, index) => {
        const patch = run.status === 'done' ? (await this.patch(comparison, run, false).catch(() => '')).slice(0, 8_000) : ''
        return [`## Candidate ${index + 1}: ${run.model.name || run.model.modelId}`, run.status === 'failed' ? `It failed: ${run.error ?? ''}` : '',
          `Answer:\n${(run.answer ?? '(no answer)').slice(0, 6_000)}`, patch ? `Changes:\n\`\`\`diff\n${patch}\n\`\`\`` : 'No file changes.'].filter(Boolean).join('\n\n')
      }))
      const prompt = [
        'Several models answered the same task, each in its own copy of the project. Compare them: correctness, completeness, code quality, and risk.',
        'Recommend one candidate and say why in a few sentences. Do not change any files.', '', `Task:\n${comparison.prompt}`, '', ...sections,
      ].join('\n').slice(0, 60_000)
      const lease = await this.options.runtime.acquireControlRuntime({ scope: { kind: 'project', workspaceId: comparison.projectId } })
      await this.options.runtime.commandControlRuntime(lease, { type: 'set_model', provider: judge.model.provider, modelId: judge.model.modelId })
      const accepted = await this.options.runtime.submitControlPrompt(lease, prompt, 'prompt')
      comparison.judge = { ...comparison.judge!, sessionId: accepted.handle.sessionId }
      this.watch(`${comparison.id}:judge`, lease)
      if (accepted.handle.sessionFile) {
        await this.options.runtime.renameSession({ kind: 'project', workspaceId: comparison.projectId }, accepted.handle.sessionFile, this.options.judgeTitle(comparison.prompt)).catch(() => undefined)
      }
    } catch (error) {
      comparison.judge = { ...comparison.judge!, status: 'failed', error: this.message(error) }
    }
    await this.save()
  }

  private async measure(comparison: Comparison, run: Comparison['runs'][number]) {
    if (!run.workspaceId) return
    const cwd = this.options.workspaces.getLocation(run.workspaceId)?.path
    if (!cwd) return
    try {
      await execute('git', ['add', '--intent-to-add', '--all'], { cwd, timeout: 30_000, windowsHide: true })
      const { stdout } = await execute('git', ['diff', '--numstat', comparison.baseCommit], { cwd, timeout: 30_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true })
      let files = 0, additions = 0, deletions = 0
      for (const line of stdout.split('\n')) {
        const [added, removed] = line.split('\t')
        if (added === undefined || removed === undefined) continue
        files += 1
        additions += Number(added) || 0
        deletions += Number(removed) || 0
      }
      Object.assign(run, { files, additions, deletions })
    } catch { /* The counts stay unknown. */ }
  }

  private async patch(comparison: Comparison, run: Comparison['runs'][number], binary: boolean) {
    const cwd = run.workspaceId ? this.options.workspaces.getLocation(run.workspaceId)?.path : undefined
    if (!cwd) throw new ComparisonError('This working copy is no longer available.')
    await execute('git', ['add', '--intent-to-add', '--all'], { cwd, timeout: 30_000, windowsHide: true })
    const { stdout } = await execute('git', ['diff', ...(binary ? ['--binary'] : []), comparison.baseCommit], { cwd, timeout: 60_000, maxBuffer: 64 * 1024 * 1024, windowsHide: true })
    return stdout
  }

  private run(id: string, index: number) {
    const comparison = this.comparisons.find((candidate) => candidate.id === id)
    const run = comparison?.runs[index]
    if (!comparison || !run) throw new ComparisonError('This comparison is no longer available.')
    return { comparison, run }
  }

  private path(workspaceId: string) {
    const location = this.options.workspaces.getLocation(workspaceId)
    if (!location) throw new ComparisonError('The project is unavailable.')
    return location.path
  }

  private message(error: unknown) {
    const stderr = (error as { stderr?: unknown }).stderr
    return (typeof stderr === 'string' && stderr.trim() ? stderr.trim() : error instanceof Error ? error.message : 'The comparison failed.').slice(0, 1_000)
  }

  private save() {
    const snapshot = structuredClone(this.comparisons)
    for (const listener of this.listeners) {
      try { listener(structuredClone(snapshot)) } catch { /* isolate observers */ }
    }
    this.writes = this.writes.then(async () => {
      await mkdir(dirname(this.options.file), { recursive: true })
      const temporary = `${this.options.file}.${process.pid}.tmp`
      await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 })
      await rename(temporary, this.options.file)
    }).catch(() => undefined)
    return this.writes
  }
}
