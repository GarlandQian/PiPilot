import * as React from 'react'
import type { ProjectTrustChoice, ProjectTrustPolicy, ProjectTrustStatus } from '@/shared/project-trust'
import { workflowErrorText } from './project-workflows'

/*
 * Each project's Pi trust state, shared by the prompt shown when a project is
 * added, the banner of an undecided project and Settings. Statuses are read on
 * demand and re-read when Main reports a change or the window regains focus
 * (a `.pi` folder may have appeared meanwhile).
 */

interface Entry { status: ProjectTrustStatus | null; error: string | null }
const EMPTY: Entry = Object.freeze({ status: null, error: null })

class ProjectTrustStore {
  private entries = new Map<string, Entry>()
  private listeners = new Set<() => void>()
  private watched = new Map<string, number>()
  private detach: (() => void) | null = null
  private policy: ProjectTrustPolicy | null = null
  private version = 0

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  getVersion = () => this.version
  get(workspaceId: string | null) { return workspaceId ? this.entries.get(workspaceId) ?? EMPTY : EMPTY }
  getPolicy() { return this.policy }

  private emit() {
    this.version += 1
    for (const listener of this.listeners) listener()
  }

  private attach() {
    const api = window.pipilot?.projectTrust
    if (this.detach || !api) return
    const unsubscribe = api.subscribe((workspaceId) => {
      if (workspaceId) void this.refresh(workspaceId)
      else { void this.refreshPolicy(); for (const id of this.watched.keys()) void this.refresh(id) }
    })
    const focus = () => { for (const id of this.watched.keys()) void this.refresh(id) }
    window.addEventListener('focus', focus)
    this.detach = () => { unsubscribe(); window.removeEventListener('focus', focus) }
  }

  watch(workspaceId: string) {
    this.attach()
    this.watched.set(workspaceId, (this.watched.get(workspaceId) ?? 0) + 1)
    void this.refresh(workspaceId)
    return () => {
      const count = (this.watched.get(workspaceId) ?? 1) - 1
      if (count > 0) this.watched.set(workspaceId, count)
      else this.watched.delete(workspaceId)
    }
  }

  async refresh(workspaceId: string) {
    const api = window.pipilot?.projectTrust
    if (!api) return null
    try {
      const status = await api.get(workspaceId)
      this.entries.set(workspaceId, { status, error: null })
      this.emit()
      return status
    } catch (error) {
      this.entries.set(workspaceId, { status: this.get(workspaceId).status, error: workflowErrorText(error) })
      this.emit()
      return null
    }
  }

  async decide(workspaceId: string, choice: ProjectTrustChoice) {
    const api = window.pipilot?.projectTrust
    if (!api) throw new Error('Project trust is unavailable.')
    const status = await api.decide(workspaceId, choice)
    this.entries.set(workspaceId, { status, error: null })
    this.emit()
    return status
  }

  async refreshPolicy() {
    const api = window.pipilot?.projectTrust
    if (!api) return null
    this.attach()
    try { this.policy = await api.getPolicy(); this.emit() } catch { /* keep the last known policy */ }
    return this.policy
  }

  async setPolicy(policy: ProjectTrustPolicy) {
    const api = window.pipilot?.projectTrust
    if (!api) throw new Error('Project trust is unavailable.')
    this.policy = await api.setPolicy(policy)
    this.emit()
  }
}

export const projectTrust = new ProjectTrustStore()

export function useProjectTrust(workspaceId: string | null) {
  React.useSyncExternalStore(projectTrust.subscribe, projectTrust.getVersion)
  React.useEffect(() => workspaceId ? projectTrust.watch(workspaceId) : undefined, [workspaceId])
  return projectTrust.get(workspaceId)
}

export function useProjectTrustPolicy() {
  React.useSyncExternalStore(projectTrust.subscribe, projectTrust.getVersion)
  React.useEffect(() => { void projectTrust.refreshPolicy() }, [])
  return projectTrust.getPolicy()
}

/*
 * Adding a project asks once, as Pi's CLI does on first start in a folder;
 * the prompt lives at the app root so every "add project" entry point gets it.
 */
const promptListeners = new Set<(workspaceId: string) => void>()
export function requestProjectTrustPrompt(workspaceId: string) {
  for (const listener of promptListeners) listener(workspaceId)
}
export function subscribeProjectTrustPrompt(listener: (workspaceId: string) => void) {
  promptListeners.add(listener)
  return () => { promptListeners.delete(listener) }
}
