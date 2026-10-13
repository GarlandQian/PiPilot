import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { ProjectTrustStore, SettingsManager, hasTrustRequiringProjectResources, type ProjectTrustUpdate } from '@earendil-works/pi-coding-agent'
import type { ProjectTrustChoice, ProjectTrustPolicy, ProjectTrustStatus } from '../../shared/project-trust'
import { RuntimeMaintenanceBusyError } from '../pi-host/runtime-maintenance-gate'
import { canonicalProjectPath, parentProjectPath, readProjectTrustPolicy, readSessionTrust, resolveProjectTrust } from './project-trust-resolution'

export class ProjectTrustError extends Error {
  readonly code = 'PROJECT_TRUST_FAILED'
}

interface WorkspaceLocations {
  getLocation(workspaceId: string): { path: string } | undefined
  get(): { recent: ReadonlyArray<{ id: string }> }
}

interface RuntimeReloader {
  /** Reloads every conversation in cwd once all of them are idle. */
  reloadRuntimes(cwd?: string): Promise<void>
  subscribeControlRuntimes(listener: () => void): () => void
}

type Application = ProjectTrustStatus['apply']

/**
 * PiPilot's side of Pi project trust. Saved decisions go to Pi's own
 * trust.json, so the CLI honours them; "this session only" decisions live in
 * a file the Project Hosts read and Main clears at startup.
 */
export class ProjectTrustService {
  private readonly listeners = new Set<(workspaceId: string | undefined) => void>()
  private readonly application = new Map<string, Application>()
  private readonly pending = new Set<string>()
  private detachRuntimes: (() => void) | null = null
  private retrying = false
  private writes = Promise.resolve()

  constructor(private readonly options: {
    agentDir: string
    sessionFile: string
    migrationFile: string
    workspaces: WorkspaceLocations
    runtime: RuntimeReloader
  }) {}

  async initialize() {
    // Session decisions end with the previous run of PiPilot.
    await this.writeSession(new Map())
    await this.migrate()
    this.detachRuntimes = this.options.runtime.subscribeControlRuntimes(() => this.retryPending())
  }

  dispose() {
    this.detachRuntimes?.()
    this.detachRuntimes = null
    this.listeners.clear()
  }

  subscribe(listener: (workspaceId: string | undefined) => void) {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  status(workspaceId: string): ProjectTrustStatus {
    const path = this.path(workspaceId)
    const resolved = resolveProjectTrust(path, this.options.agentDir, this.options.sessionFile)
    const parentPath = parentProjectPath(path)
    return {
      workspaceId, path, state: resolved.state, trusted: resolved.trusted, sessionOnly: resolved.sessionOnly, policy: resolved.policy,
      ...(resolved.savedPath ? { savedPath: resolved.savedPath } : {}),
      ...(parentPath ? { parentPath } : {}),
      apply: this.application.get(path) ?? 'applied',
    }
  }

  async decide(workspaceId: string, choice: ProjectTrustChoice): Promise<ProjectTrustStatus> {
    const path = this.path(workspaceId)
    const canonical = canonicalProjectPath(path)
    await this.serialize(async () => {
      const session = readSessionTrust(this.options.sessionFile)
      session.delete(canonical)
      const updates: ProjectTrustUpdate[] = []
      if (choice === 'trust') updates.push({ path: canonical, decision: true })
      else if (choice === 'distrust') updates.push({ path: canonical, decision: false })
      else if (choice === 'reset') updates.push({ path: canonical, decision: null })
      else if (choice === 'trust-parent') {
        const parent = parentProjectPath(path)
        if (!parent) throw new ProjectTrustError('This folder has no parent folder to trust.')
        updates.push({ path: parent, decision: true }, { path: canonical, decision: null })
      } else session.set(canonical, true)
      if (updates.length > 0) new ProjectTrustStore(this.options.agentDir).setMany(updates)
      await this.writeSession(session)
    })
    // A parent folder's decision covers every project below it.
    const affected = choice === 'trust-parent' ? this.projectPathsBelow(parentProjectPath(path)!) : [path]
    await Promise.all(affected.map((cwd) => this.apply(cwd)))
    this.emit(workspaceId)
    return this.status(workspaceId)
  }

  policy(): ProjectTrustPolicy {
    return readProjectTrustPolicy(this.options.agentDir)
  }

  async setPolicy(policy: ProjectTrustPolicy): Promise<ProjectTrustPolicy> {
    await this.serialize(async () => {
      const settings = SettingsManager.create(this.options.agentDir, this.options.agentDir, { projectTrusted: false })
      settings.setDefaultProjectTrust(policy)
      await settings.flush()
      // The SDK records read/write failures instead of rejecting flush(). A
      // failed preference change must not look successful or reload runtimes.
      const errors = settings.drainErrors()
      if (errors.length > 0) throw errors[0]!.error
    })
    // Undecided projects follow the policy; reload the ones that change.
    await Promise.all(this.projectPaths().map((cwd) => this.apply(cwd)))
    this.emit(undefined)
    return this.policy()
  }

  /** A working copy made by PiPilot starts with its source project's decision. */
  async inherit(sourceWorkspaceId: string, targetWorkspaceId: string) {
    const source = this.status(sourceWorkspaceId)
    if (source.state !== 'trusted' && source.state !== 'untrusted') return
    const target = canonicalProjectPath(this.path(targetWorkspaceId))
    await this.serialize(async () => {
      if (source.sessionOnly) {
        const session = readSessionTrust(this.options.sessionFile)
        session.set(target, source.trusted)
        await this.writeSession(session)
      } else new ProjectTrustStore(this.options.agentDir).set(target, source.trusted)
    })
    this.emit(targetWorkspaceId)
  }

  private path(workspaceId: string) {
    const location = this.options.workspaces.getLocation(workspaceId)
    if (!location) throw new ProjectTrustError('The project is unavailable.')
    return location.path
  }

  private projectPaths() {
    return [...new Set(this.options.workspaces.get().recent
      .map(({ id }) => this.options.workspaces.getLocation(id)?.path)
      .filter((path): path is string => Boolean(path)))]
  }

  private projectPathsBelow(parent: string) {
    return this.projectPaths().filter((path) => {
      const canonical = canonicalProjectPath(path)
      return canonical === parent || canonical.startsWith(parent.endsWith('/') || parent.endsWith('\\') ? parent : `${parent}${process.platform === 'win32' ? '\\' : '/'}`)
    })
  }

  private async apply(cwd: string) {
    this.pending.delete(cwd)
    try {
      await this.options.runtime.reloadRuntimes(cwd)
      this.application.delete(cwd)
    } catch (error) {
      if (error instanceof RuntimeMaintenanceBusyError) {
        // Open work is never interrupted: retry when the project goes idle.
        this.application.set(cwd, 'pending')
        this.pending.add(cwd)
      } else this.application.set(cwd, 'failed')
    }
  }

  private retryPending() {
    if (this.retrying || this.pending.size === 0) return
    this.retrying = true
    setTimeout(() => {
      const targets = [...this.pending]
      void Promise.all(targets.map((cwd) => this.apply(cwd))).finally(() => {
        this.retrying = false
        if (targets.some((cwd) => !this.pending.has(cwd))) this.emit(undefined)
      })
    }, 250).unref?.()
  }

  /** Projects added before trust prompts existed were already trusted by being added. */
  private async migrate() {
    if (existsSync(this.options.migrationFile)) return
    const store = new ProjectTrustStore(this.options.agentDir)
    const updates: ProjectTrustUpdate[] = []
    for (const path of this.projectPaths()) {
      try {
        if (hasTrustRequiringProjectResources(path) && store.getEntry(path) === null) updates.push({ path: canonicalProjectPath(path), decision: true })
      } catch {
        // Leave a project whose state cannot be read to the normal prompt.
      }
    }
    if (updates.length > 0) store.setMany(updates)
    await mkdir(dirname(this.options.migrationFile), { recursive: true })
    await writeFile(this.options.migrationFile, `${JSON.stringify({ version: 1, migrated: updates.length })}\n`, { mode: 0o600 })
  }

  private async writeSession(decisions: Map<string, boolean>) {
    const file = this.options.sessionFile
    await mkdir(dirname(file), { recursive: true })
    const temporary = `${file}.${process.pid}.tmp`
    await writeFile(temporary, `${JSON.stringify(Object.fromEntries(decisions), null, 2)}\n`, { mode: 0o600 })
    await rename(temporary, file)
    // Validate what the hosts will read.
    JSON.parse(await readFile(file, 'utf8'))
  }

  private serialize(operation: () => Promise<void>) {
    const next = this.writes.then(operation, operation)
    this.writes = next.catch(() => undefined)
    return next.catch((error: unknown) => {
      throw error instanceof ProjectTrustError ? error : new ProjectTrustError(error instanceof Error ? error.message : 'Project trust could not be saved.')
    })
  }

  private emit(workspaceId: string | undefined) {
    for (const listener of this.listeners) {
      try { listener(workspaceId) } catch { /* isolate observers */ }
    }
  }
}
