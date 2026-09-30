import { join } from 'node:path'
import type { ProjectWorkflowsApi, ProjectWorkflowSnapshot } from '../../shared/project-workflows'
import type { WorkspaceRepository } from '../repositories/workspace-repository'
import type { PiRuntimeFrontend } from '../pi-host/pi-runtime-frontend'
import type { TerminalService } from '../terminal/terminal-service'
import { ProjectActionService } from '../project-actions/project-action-service'
import { ProjectWorkflowError } from '../project-actions/workflow-storage'
import { WorktreeService } from './worktree-service'

export function createProjectWorkflowsService(options: { directory: string; workspaces: WorkspaceRepository; runtime: PiRuntimeFrontend; terminals: TerminalService }) {
  const { directory, workspaces, runtime, terminals } = options
  let initialized = false
  let initializationError: Error | null = null
  const assertReady = () => {
    if (initializationError) throw initializationError
    if (!initialized) throw new ProjectWorkflowError('Project tools are still initializing.')
  }
  const worktrees = new WorktreeService({
    directory: join(directory, 'worktrees'), location: (id) => workspaces.getLocation(id),
    registeredWorkspaceIds: (path) => workspaces.get().recent.filter((entry) => workspaces.getLocation(entry.id)?.path === path).map((entry) => entry.id),
    register: async (path, name) => {
      const location = await workspaces.activatePath(path)
      workspaces.setDisplayName(location.id, name)
      return location
    }, unavailable: (id) => workspaces.markUnavailable(id),
    withInactiveProject: (ids, cwd, operation) => {
      if (ids.some((id) => actions.hasActive(id))) throw new ProjectWorkflowError('Stop the project action before archiving its working copy.')
      const guard = (index: number): ReturnType<typeof operation> => index >= ids.length
        ? runtime.withInactiveProject(cwd, operation)
        : terminals.withInactiveScope({ kind: 'project', workspaceId: ids[index]! }, () => guard(index + 1))
      return guard(0)
    },
  })
  const actions = new ProjectActionService({
    filePath: join(directory, 'project-actions.json'), location: (id) => workspaces.getLocation(id),
    assertAvailable: (id) => worktrees.assertAvailable(id),
  })
  const snapshot = async (workspaceId: string): Promise<ProjectWorkflowSnapshot> => {
    assertReady()
    const branches = await worktrees.branches(workspaceId)
    return { revision: actions.revision, workspaceId, actions: actions.actions(workspaceId), runs: actions.runs(workspaceId),
      worktrees: worktrees.list(workspaceId), branches, gitAvailable: branches.length > 0, platform: actions.platform }
  }
  const api: ProjectWorkflowsApi = {
    get: snapshot,
    async saveActions(id, value, revision) { assertReady(); await actions.save(id, value, revision); return snapshot(id) },
    run: (id, action, revision) => { assertReady(); return actions.run(id, action, revision) },
    stop: (id) => { assertReady(); return actions.stop(id) },
    async createWorktree(input) {
      assertReady()
      const setup = input.setupActionId
        ? actions.confirmedAction(input.projectId, input.setupActionId, input.expectedActionRevision ?? -1) : undefined
      const worktree = await worktrees.create(input)
      if (worktree.workspaceId) {
        // A setup/configuration failure never destroys the successfully created checkout.
        try {
          await actions.inherit(input.projectId, worktree.workspaceId)
          if (setup) await actions.runConfirmed(worktree.workspaceId, setup)
        } catch (error) { return { ...worktree, error: (error instanceof Error ? error.message : 'Setup could not start.').slice(0, 1_000) } }
      }
      return worktree
    },
    archiveWorktree: (id) => { assertReady(); return worktrees.archive(id) },
    restoreWorktree: (id) => { assertReady(); return worktrees.restore(id) },
  }
  return {
    api, assertAvailable: (id: string) => worktrees.assertAvailable(id),
    withRemovableProject: <T>(id: string, operation: () => Promise<T>) => actions.withInactiveProject(id, operation),
    async initialize() {
      try { await actions.initialize(); await worktrees.initialize(); initialized = true }
      catch { initializationError = new ProjectWorkflowError('Saved project tools could not be loaded safely. Your data was not replaced. Check the project-actions.json and worktrees/worktrees.json files in application storage.') }
    },
    hasActive: () => actions.hasActive(), closeAll: () => actions.closeAll(),
    async dispose() { await worktrees.dispose(); await actions.dispose() },
  }
}
