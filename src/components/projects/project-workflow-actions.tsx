import * as React from 'react'

/** What project tools ask of the app shell: switching project, showing a run, opening Settings. */
export interface ProjectWorkflowActions {
  /** Switch to a project and start a new task there. */
  startProjectTask(workspaceId: string): void
  /** Show a run's output in the bottom panel; without a run, the project's latest one. */
  openActionRun(workspaceId: string, runId?: string): void
  /** Settings › Local environment, showing this project. */
  openLocalEnvironment(workspaceId?: string): void
}

const ProjectWorkflowActionsContext = React.createContext<ProjectWorkflowActions | null>(null)

export const ProjectWorkflowActionsProvider = ProjectWorkflowActionsContext.Provider

export function useProjectWorkflowActions() {
  return React.useContext(ProjectWorkflowActionsContext)
}

/* The project Settings › Local environment should show next (from the toolbar or the sidebar). */
let requestedProject: string | null = null
const listeners = new Set<() => void>()

export function requestLocalEnvironmentProject(workspaceId: string) {
  requestedProject = workspaceId
  for (const listener of listeners) listener()
}

export function takeLocalEnvironmentProject() {
  const value = requestedProject
  requestedProject = null
  return value
}

export function subscribeLocalEnvironmentProject(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
