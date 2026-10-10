import * as React from 'react'
import type { CreateWorktreeInput, ManagedWorktree, ProjectAction, ProjectActionRun, ProjectWorkflowSnapshot } from '@/shared/project-workflows'

/*
 * Each project's actions, runs and working copies, shared by everything that
 * shows them: Settings › Local environment, the toolbar's Run button, the
 * output tab and the sidebar. A snapshot is read on demand and kept fresh
 * while something watches it (quickly while an action runs or a working copy
 * moves, slowly otherwise).
 */

export interface ProjectWorkflowEntry {
  snapshot: ProjectWorkflowSnapshot | null
  error: string | null
}

const EMPTY: ProjectWorkflowEntry = Object.freeze({ snapshot: null, error: null })
const BUSY_INTERVAL = 1_000
const IDLE_INTERVAL = 15_000

export function workflowErrorText(error: unknown) {
  return typeof error === 'object' && error && 'message' in error ? String(error.message) : String(error)
}

function busy(snapshot: ProjectWorkflowSnapshot | null) {
  return Boolean(snapshot && (snapshot.runs.some((run) => run.status === 'running' || run.status === 'stopping') ||
    snapshot.worktrees.some((worktree) => worktree.state === 'creating' || worktree.state === 'archiving' || worktree.state === 'restoring')))
}

class ProjectWorkflowsStore {
  private entries = new Map<string, ProjectWorkflowEntry>()
  private listeners = new Set<() => void>()
  private watchers = new Map<string, number>()
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  private inflight = new Map<string, Promise<ProjectWorkflowSnapshot | null>>()
  private retries = new Map<string, number>()
  private version = 0

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  getVersion = () => this.version
  get(workspaceId: string | null): ProjectWorkflowEntry {
    return workspaceId ? this.entries.get(workspaceId) ?? EMPTY : EMPTY
  }
  /** Every working copy known from any snapshot read so far, by the project it opens as. */
  worktreesByWorkspace(): ReadonlyMap<string, ManagedWorktree> {
    const result = new Map<string, ManagedWorktree>()
    for (const entry of this.entries.values()) {
      for (const worktree of entry.snapshot?.worktrees ?? []) if (worktree.workspaceId) result.set(worktree.workspaceId, worktree)
    }
    return result
  }

  private emit() {
    this.version += 1
    for (const listener of this.listeners) listener()
  }
  private accept(workspaceId: string, snapshot: ProjectWorkflowSnapshot) {
    const current = this.entries.get(workspaceId)?.snapshot
    if (current && snapshot.revision < current.revision) return
    this.entries.set(workspaceId, { snapshot, error: null })
    this.emit()
  }

  refresh(workspaceId: string): Promise<ProjectWorkflowSnapshot | null> {
    const api = window.pipilot?.projectWorkflows
    if (!api) return Promise.resolve(null)
    const pending = this.inflight.get(workspaceId)
    if (pending) return pending
    const request = api.get(workspaceId).then((snapshot) => {
      this.retries.delete(workspaceId)
      this.accept(workspaceId, snapshot)
      return snapshot
    }, (error: unknown) => {
      const previous = this.entries.get(workspaceId)?.snapshot ?? null
      this.entries.set(workspaceId, { snapshot: previous, error: workflowErrorText(error) })
      this.emit()
      // Project tools may still be starting: try a few more times before giving up.
      const attempts = this.retries.get(workspaceId) ?? 0
      if (!previous && attempts < 5) {
        this.retries.set(workspaceId, attempts + 1)
        setTimeout(() => { if (!this.entries.get(workspaceId)?.snapshot) void this.refresh(workspaceId) }, 2_000)
      }
      return null
    }).finally(() => {
      this.inflight.delete(workspaceId)
      this.schedule(workspaceId)
    })
    this.inflight.set(workspaceId, request)
    return request
  }
  /** Refresh a project and every project of its family (its source and working copies). */
  async refreshFamily(workspaceId: string) {
    const snapshot = await this.refresh(workspaceId)
    const related = new Set<string>()
    for (const worktree of snapshot?.worktrees ?? []) {
      related.add(worktree.projectId)
      if (worktree.workspaceId) related.add(worktree.workspaceId)
    }
    related.delete(workspaceId)
    await Promise.all([...related].filter((id) => this.entries.has(id) || this.watchers.has(id)).map((id) => this.refresh(id)))
  }

  watch(workspaceId: string) {
    this.watchers.set(workspaceId, (this.watchers.get(workspaceId) ?? 0) + 1)
    if (!this.entries.get(workspaceId)?.snapshot) void this.refresh(workspaceId)
    else this.schedule(workspaceId)
    return () => {
      const count = (this.watchers.get(workspaceId) ?? 1) - 1
      if (count > 0) { this.watchers.set(workspaceId, count); return }
      this.watchers.delete(workspaceId)
      clearTimeout(this.timers.get(workspaceId))
      this.timers.delete(workspaceId)
    }
  }
  private schedule(workspaceId: string) {
    clearTimeout(this.timers.get(workspaceId))
    this.timers.delete(workspaceId)
    if (!this.watchers.has(workspaceId)) return
    const interval = busy(this.entries.get(workspaceId)?.snapshot ?? null) ? BUSY_INTERVAL : IDLE_INTERVAL
    this.timers.set(workspaceId, setTimeout(() => void this.refresh(workspaceId), interval))
  }

  async saveActions(workspaceId: string, actions: ProjectAction[]) {
    const api = window.pipilot!.projectWorkflows
    const current = this.entries.get(workspaceId)?.snapshot ?? await api.get(workspaceId)
    const snapshot = await api.saveActions(workspaceId, actions, current.revision)
    this.accept(workspaceId, snapshot)
    return snapshot
  }
  async run(workspaceId: string, actionId: string): Promise<ProjectActionRun> {
    const api = window.pipilot!.projectWorkflows
    const current = this.entries.get(workspaceId)?.snapshot ?? await api.get(workspaceId)
    const run = await api.run(workspaceId, actionId, current.revision)
    await this.refresh(workspaceId)
    return run
  }
  async stop(workspaceId: string, runId: string) {
    const run = await window.pipilot!.projectWorkflows.stop(runId)
    await this.refresh(workspaceId)
    return run
  }
  async createWorktree(input: CreateWorktreeInput) {
    const worktree = await window.pipilot!.projectWorkflows.createWorktree(input)
    await this.refreshFamily(input.projectId)
    if (worktree.workspaceId) await this.refresh(worktree.workspaceId)
    return worktree
  }
  async archiveWorktree(worktree: ManagedWorktree) {
    const result = await window.pipilot!.projectWorkflows.archiveWorktree(worktree.id)
    await this.refreshFamily(worktree.projectId)
    return result
  }
  async restoreWorktree(worktree: ManagedWorktree) {
    const result = await window.pipilot!.projectWorkflows.restoreWorktree(worktree.id)
    await this.refreshFamily(worktree.projectId)
    return result
  }
}

export const projectWorkflows = new ProjectWorkflowsStore()

/** One project's actions, runs and working copies, kept fresh while shown. */
export function useProjectWorkflow(workspaceId: string | null, watch = true): ProjectWorkflowEntry {
  React.useSyncExternalStore(projectWorkflows.subscribe, projectWorkflows.getVersion, projectWorkflows.getVersion)
  React.useEffect(() => {
    if (!workspaceId || !watch) return
    return projectWorkflows.watch(workspaceId)
  }, [watch, workspaceId])
  return projectWorkflows.get(workspaceId)
}

/** Which of these projects are working copies; each project is read once (and again after a change). */
export function useWorktreeIndex(projectIds: readonly string[]): ReadonlyMap<string, ManagedWorktree> {
  React.useSyncExternalStore(projectWorkflows.subscribe, projectWorkflows.getVersion, projectWorkflows.getVersion)
  const key = projectIds.join('\n')
  React.useEffect(() => {
    for (const id of key ? key.split('\n') : []) {
      if (!projectWorkflows.get(id).snapshot) void projectWorkflows.refresh(id)
    }
  }, [key])
  return projectWorkflows.worktreesByWorkspace()
}
