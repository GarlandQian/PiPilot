import { randomUUID } from 'node:crypto'
import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { z } from 'zod'
import { projectActionSchema, projectActionRunSchema, type ProjectAction, type ProjectActionRun } from '../../shared/project-workflows'
import { ProjectWorkflowError, readWorkflowFile, writeWorkflowFile } from './workflow-storage'

const documentSchema = z.object({ version: z.literal(1), revision: z.number().int().nonnegative(),
  projects: z.record(z.string(), z.array(projectActionSchema).max(30)), runs: z.array(projectActionRunSchema).max(100) }).strict()
interface RunningAction { child: ChildProcess; finished: Promise<void>; killTimer?: ReturnType<typeof setTimeout>; logTimer?: ReturnType<typeof setTimeout> }

function samePath(left: string, right: string) {
  const resolvedLeft = resolve(left)
  const resolvedRight = resolve(right)
  return process.platform === 'win32'
    ? resolvedLeft.toLowerCase() === resolvedRight.toLowerCase()
    : resolvedLeft === resolvedRight
}

export interface ProjectActionServiceOptions {
  filePath: string
  location(workspaceId: string): { path: string } | undefined
  assertAvailable(workspaceId: string): void
  platform?: 'darwin' | 'linux' | 'win32'
}

export class ProjectActionService {
  private document: z.infer<typeof documentSchema> = { version: 1, revision: 0, projects: {}, runs: [] }
  private readonly running = new Map<string, RunningAction>()
  private readonly pending = new Set<string>()
  private readonly removing = new Set<string>()
  private readonly pendingStarts = new Set<Promise<ProjectActionRun>>()
  private closing: Promise<void> | null = null
  private writeQueue = Promise.resolve()
  private operationQueue = Promise.resolve()
  private disposed = false
  readonly platform: 'darwin' | 'linux' | 'win32'
  constructor(private readonly options: ProjectActionServiceOptions) {
    this.platform = options.platform ?? (process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux')
  }
  async initialize() {
    this.document = await readWorkflowFile(this.options.filePath, documentSchema, this.document)
    for (const run of this.document.runs) if (run.status === 'running' || run.status === 'stopping') {
      run.status = 'interrupted'; run.finishedAt = new Date().toISOString()
    }
    await this.persist()
  }
  get revision() { return this.document.revision }
  actions(workspaceId: string) { return structuredClone(this.document.projects[workspaceId] ?? []) }
  runs(workspaceId: string) { return structuredClone(this.document.runs.filter((run) => run.workspaceId === workspaceId)) }
  hasActive(workspaceId?: string) {
    return [...this.pending].some((id) => !workspaceId || id === workspaceId) ||
      this.document.runs.some((run) => (!workspaceId || run.workspaceId === workspaceId) && this.running.has(run.id))
  }
  async withInactiveProject<T>(workspaceId: string, operation: () => Promise<T>): Promise<T> {
    if (this.hasActive(workspaceId) || this.removing.has(workspaceId)) throw new ProjectWorkflowError('Stop the project action before removing this project.')
    this.removing.add(workspaceId)
    try { return await operation() } finally { this.removing.delete(workspaceId) }
  }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.operationQueue.then(operation)
    this.operationQueue = next.then(() => undefined, () => undefined)
    return next
  }
  async save(workspaceId: string, raw: ProjectAction[], expectedRevision: number) {
    return this.serial(async () => {
      this.assertActive(workspaceId)
      if (expectedRevision !== this.revision) throw new ProjectWorkflowError('Project actions changed. Reload before saving.')
      const actions = z.array(projectActionSchema).max(30).parse(raw)
      if (new Set(actions.map((action) => action.id)).size !== actions.length) throw new ProjectWorkflowError('Action IDs must be unique.')
      for (const action of actions) this.relativeDirectory(action.cwd)
      const next = { ...this.document, revision: this.revision + 1, projects: { ...this.document.projects, [workspaceId]: actions } }
      await this.persist(next)
      this.document = next
    })
  }
  confirmedAction(workspaceId: string, actionId: string, expectedRevision: number) {
    if (expectedRevision !== this.revision) throw new ProjectWorkflowError('Project actions changed. Reload and confirm the command again.')
    const action = this.document.projects[workspaceId]?.find((entry) => entry.id === actionId)
    if (!action) throw new ProjectWorkflowError('The project action was not found.')
    return structuredClone(action)
  }
  async inherit(from: string, to: string) {
    return this.serial(async () => {
      const next = { ...this.document, revision: this.revision + 1, projects: { ...this.document.projects, [to]: this.actions(from) } }
      await this.persist(next); this.document = next
    })
  }
  async run(workspaceId: string, actionId: string, expectedRevision: number) {
    const action = this.confirmedAction(workspaceId, actionId, expectedRevision)
    return this.runConfirmed(workspaceId, action)
  }
  runConfirmed(workspaceId: string, action: ProjectAction): Promise<ProjectActionRun> {
    const operation = this.startConfirmed(workspaceId, action)
    this.pendingStarts.add(operation)
    const finish = () => { this.pendingStarts.delete(operation) }
    void operation.then(finish, finish)
    return operation
  }
  private async startConfirmed(workspaceId: string, action: ProjectAction): Promise<ProjectActionRun> {
    this.assertActive(workspaceId)
    if (this.hasActive(workspaceId)) throw new ProjectWorkflowError('Stop the current project action before starting another.')
    if (this.running.size + this.pending.size >= 100) throw new ProjectWorkflowError('The active project-action limit was reached.')
    this.pending.add(workspaceId)
    let reservedRun: ProjectActionRun | undefined
    try {
      const location = this.options.location(workspaceId)!
      const root = await realpath(location.path)
      if (!samePath(root, location.path)) throw new ProjectWorkflowError('The project directory changed identity. Reopen it before running commands.')
      const cwd = await realpath(resolve(root, this.relativeDirectory(action.cwd)))
      const distance = relative(root, cwd)
      if (distance === '..' || distance.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(distance) || !(await stat(cwd)).isDirectory()) {
        throw new ProjectWorkflowError('The action working directory must stay inside the project.')
      }
      this.assertActive(workspaceId)
      const command = (action.platforms[this.platform] || action.command).trim()
      if (!command) throw new ProjectWorkflowError('Set a command for this platform before running the action.')
      const run: ProjectActionRun = { id: randomUUID(), workspaceId, actionId: action.id, name: action.name, command, cwd,
        startedAt: new Date().toISOString(), status: 'running', exitCode: null, output: '' }
      reservedRun = run
      // Persist ownership before execution. A restart presents unfinished runs as interrupted.
      await this.serial(async () => {
        const active = this.document.runs.filter((entry) => entry.status === 'running' || entry.status === 'stopping')
        const finished = this.document.runs.filter((entry) => entry.status !== 'running' && entry.status !== 'stopping')
        this.document.runs = [run, ...active, ...finished].slice(0, 100)
        await this.persist()
      })
      this.assertActive(workspaceId)
      const child = this.platform === 'win32'
        ? spawn(command, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], shell: true })
        : spawn('/bin/sh', ['-c', command], { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
      let complete!: () => void
      const finished = new Promise<void>((resolve) => { complete = resolve })
      const record: RunningAction = { child, finished }
      this.running.set(run.id, record)
      const append = (data: string | Buffer) => {
        run.output = `${run.output}${data.toString()}`.slice(-131_072)
        if (!record.logTimer) {
          record.logTimer = setTimeout(() => {
            record.logTimer = undefined
            void this.serial(() => this.persist()).catch(() => undefined)
          }, 500)
          record.logTimer.unref()
        }
      }
      child.stdout?.setEncoding('utf8'); child.stderr?.setEncoding('utf8')
      child.stdout?.on('data', append); child.stderr?.on('data', append)
      child.once('error', (error) => { append(Buffer.from(`\n${error.message}\n`)); run.status = 'failed' })
      child.once('close', (code) => {
        clearTimeout(record.killTimer)
        clearTimeout(record.logTimer)
        run.exitCode = code
        run.status = run.status === 'stopping' ? 'stopped' : run.status === 'failed' || code !== 0 ? 'failed' : 'completed'
        run.finishedAt = new Date().toISOString()
        this.running.delete(run.id)
        void this.serial(() => this.persist()).finally(complete).catch(() => undefined)
      })
      return structuredClone(run)
    } catch (error) {
      if (reservedRun && !this.running.has(reservedRun.id)) {
        reservedRun.status = 'failed'; reservedRun.finishedAt = new Date().toISOString()
        reservedRun.output = error instanceof Error ? error.message.slice(0, 1_000) : 'The action could not start.'
        await this.serial(() => this.persist()).catch(() => undefined)
      }
      throw error
    } finally { this.pending.delete(workspaceId) }
  }
  async stop(id: string): Promise<ProjectActionRun> {
    const run = this.document.runs.find((entry) => entry.id === id)
    if (!run) throw new ProjectWorkflowError('The action run was not found.')
    const record = this.running.get(id)
    if (record && run.status !== 'stopping') {
      run.status = 'stopping'
      this.kill(record, false)
      record.killTimer = setTimeout(() => this.kill(record, true), 1_500)
      record.killTimer.unref()
    }
    return structuredClone(run)
  }
  private kill(record: RunningAction, force: boolean) {
    const pid = record.child.pid
    if (!pid) return
    if (this.platform === 'win32') execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => undefined)
    else { try { process.kill(-pid, force ? 'SIGKILL' : 'SIGTERM') } catch { /* already exited */ } }
  }
  closeAll(): Promise<void> {
    if (this.closing) return this.closing
    const closing = Promise.resolve().then(async () => {
      await Promise.allSettled([...this.pendingStarts])
      await this.operationQueue
      await Promise.all([...this.running].map(async ([id, record]) => { await this.stop(id); await record.finished }))
      await this.writeQueue
    })
    this.closing = closing
    void closing.finally(() => { if (this.closing === closing) this.closing = null }).catch(() => undefined)
    return closing
  }
  async dispose() { this.disposed = true; await this.closeAll() }
  private assertActive(workspaceId: string) {
    if (this.disposed || this.closing) throw new ProjectWorkflowError('Project actions are shutting down.')
    if (this.removing.has(workspaceId)) throw new ProjectWorkflowError('The project is being removed.')
    this.options.assertAvailable(workspaceId)
    if (!this.options.location(workspaceId)) throw new ProjectWorkflowError('The project is unavailable.')
  }
  private relativeDirectory(value: string) {
    if (isAbsolute(value) || value.split(/[\\/]/u).includes('..') || value.includes('\0')) throw new ProjectWorkflowError('Use a relative working directory inside the project.')
    return value || '.'
  }
  private persist(document = this.document) {
    const snapshot = structuredClone(document)
    const write = this.writeQueue.then(() => writeWorkflowFile(this.options.filePath, snapshot))
    this.writeQueue = write.catch(() => undefined)
    return write
  }
}
