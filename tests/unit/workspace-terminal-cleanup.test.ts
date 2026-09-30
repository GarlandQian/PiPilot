import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConversationScope } from '../../src/shared/conversation-scope'

const mocks = vi.hoisted(() => ({ handlers: new Map<string, (request: { workspaceId: string }) => Promise<unknown>>() }))
vi.mock('electron', () => ({ dialog: {} }))
vi.mock('../../src/main/ipc/validated-handler', () => ({
  createTrustedSenderValidator: vi.fn(() => () => true),
  MainProcessError: class MainProcessError extends Error {
    constructor(readonly code: string, message: string) { super(message) }
  },
  registerValidatedHandler: (contract: { channel: string }, _validator: unknown, handler: (request: { workspaceId: string }) => Promise<unknown>) => {
    mocks.handlers.set(contract.channel, handler)
  },
}))

import { registerWorkspaceIpc } from '../../src/main/ipc/register-workspace-ipc'
import { workspaceRemoveContract } from '../../src/shared/ipc/contracts'
import { ProjectWorkflowError } from '../../src/main/project-actions/workflow-storage'

const workspaceId = '00000000-0000-4000-8000-000000000101'
const projectScope = { kind: 'project', workspaceId } as const
const projectlessScope = { kind: 'projectless' } as const

function fixture(activeScope: ConversationScope, withRemovableProject?: Parameters<typeof registerWorkspaceIpc>[0]['withRemovableProject']) {
  const order: string[] = []
  const remove = vi.fn(() => { order.push('remove'); return { recent: [] } })
  const activate = vi.fn(async () => { order.push('activate'); return { scope: projectlessScope, sessionId: 'new', generation: 1 } })
  const disposeScope = vi.fn(async () => { order.push('dispose') })
  registerWorkspaceIpc({
    getMainWindow: () => null,
    policy: {} as never,
    repository: {
      get: () => ({ recent: [{ id: workspaceId }] }),
      remove,
      subscribe: () => () => undefined,
    } as never,
    contentService: {} as never,
    contextService: { getSnapshot: () => ({ activeScope }), newConversation: activate } as never,
    terminalService: { disposeScope },
    withRemovableProject,
  })
  return { activate, disposeScope, remove, order, removeProject: () => mocks.handlers.get(workspaceRemoveContract.channel)!({ workspaceId }) }
}

beforeEach(() => mocks.handlers.clear())

describe('project terminal cleanup', () => {
  it('ends the background project terminal before removing its project record', async () => {
    const context = fixture(projectlessScope)
    await expect(context.removeProject()).resolves.toMatchObject({ activeRemoved: false, workspaceId })
    expect(context.activate).not.toHaveBeenCalled()
    expect(context.disposeScope).toHaveBeenCalledWith(projectScope)
    expect(context.order).toEqual(['dispose', 'remove'])
  })

  it('activates the replacement conversation before ending the removed active project terminal', async () => {
    const context = fixture(projectScope)
    await expect(context.removeProject()).resolves.toMatchObject({ activeRemoved: true, workspaceId })
    expect(context.disposeScope).toHaveBeenCalledWith(projectScope)
    expect(context.order).toEqual(['activate', 'dispose', 'remove'])
  })

  it('preserves a project and its terminal when replacement activation fails', async () => {
    const context = fixture(projectScope)
    context.activate.mockRejectedValueOnce(new Error('Could not activate replacement.'))
    await expect(context.removeProject()).rejects.toThrow('Could not activate replacement.')
    expect(context.disposeScope).not.toHaveBeenCalled()
    expect(context.remove).not.toHaveBeenCalled()
  })

  it('keeps the project reachable for retry if its terminal cannot be cleaned up', async () => {
    const context = fixture(projectlessScope)
    context.disposeScope.mockRejectedValueOnce(new Error('Cleanup failed.'))
    await expect(context.removeProject()).rejects.toThrow('Cleanup failed.')
    expect(context.remove).not.toHaveBeenCalled()
  })

  it('rejects removal before changing selection or terminals when a project action is running', async () => {
    const context = fixture(projectScope, async () => { throw new ProjectWorkflowError('Stop the project action before removing this project.') })
    await expect(context.removeProject()).rejects.toMatchObject({ code: 'PROJECT_WORKFLOW_FAILED', message: 'Stop the project action before removing this project.' })
    expect(context.activate).not.toHaveBeenCalled()
    expect(context.disposeScope).not.toHaveBeenCalled()
    expect(context.remove).not.toHaveBeenCalled()
  })

  it('holds the removal guard across delayed activation, terminal cleanup and the final repository mutation', async () => {
    let locked = false
    const context = fixture(projectScope, async (id, operation) => {
      expect(id).toBe(workspaceId)
      locked = true
      try { return await operation() } finally { locked = false }
    })
    let releaseActivation!: () => void, releaseTerminal!: () => void
    context.activate.mockImplementation(async () => {
      expect(locked).toBe(true)
      await new Promise<void>((resolve) => { releaseActivation = resolve })
      return { scope: projectlessScope, sessionId: 'new', generation: 1 }
    })
    context.disposeScope.mockImplementation(async () => {
      expect(locked).toBe(true)
      await new Promise<void>((resolve) => { releaseTerminal = resolve })
    })
    context.remove.mockImplementation(() => { expect(locked).toBe(true); return { recent: [] } })
    const removal = context.removeProject()
    await vi.waitFor(() => expect(releaseActivation).toBeTypeOf('function'))
    expect(locked).toBe(true)
    releaseActivation()
    await vi.waitFor(() => expect(releaseTerminal).toBeTypeOf('function'))
    expect(locked).toBe(true)
    expect(context.remove).not.toHaveBeenCalled()
    releaseTerminal()
    await removal
    expect(context.remove).toHaveBeenCalledOnce()
    expect(locked).toBe(false)
  })

  it('releases removal admission after replacement activation fails without removing the project', async () => {
    let locked = false
    const context = fixture(projectScope, async (_id, operation) => {
      locked = true
      try { return await operation() } finally { locked = false }
    })
    context.activate.mockRejectedValue(new Error('Activation failed'))
    await expect(context.removeProject()).rejects.toThrow('Activation failed')
    expect(locked).toBe(false)
    expect(context.remove).not.toHaveBeenCalled()
  })
})
