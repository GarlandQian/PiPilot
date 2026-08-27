import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConversationContextService } from '../../src/main/conversations/conversation-context-service'
import { ConversationScopeResolver } from '../../src/main/conversations/conversation-scope-resolver'
import { ConversationNavigationRepository } from '../../src/main/repositories/conversation-navigation-repository'
import type { ConversationScope } from '../../src/shared/conversation-scope'
import type {
  LocalPiRuntimeSnapshot,
  LocalPiSessionState,
} from '../../src/shared/local-pi'

const workspaceId = '00000000-0000-4000-8000-000000000201'
const projectScope = { kind: 'project', workspaceId } as const
const projectlessScope = { kind: 'projectless' } as const
const temporaryDirectories: string[] = []

function sessionState(overrides: Partial<LocalPiSessionState> = {}): LocalPiSessionState {
  return {
    thinkingLevel: 'medium',
    isStreaming: false,
    isCompacting: false,
    steeringMode: 'one-at-a-time',
    followUpMode: 'one-at-a-time',
    sessionId: 'session-current',
    autoCompactionEnabled: true,
    messageCount: 0,
    pendingMessageCount: 0,
    ...overrides,
  }
}

function runtimeSnapshot(
  generation: number,
  state: LocalPiSessionState,
): LocalPiRuntimeSnapshot {
  return {
    state: 'ready',
    generation,
    cwd: '/private/runtime',
    sessionFile: state.sessionFile ?? null,
    sessionState: state,
    commands: [],
    stderr: '',
    diagnostics: [],
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'pipilot-conversation-context-'))
  temporaryDirectories.push(root)
  const projectPath = join(root, 'project')
  const projectlessPath = join(root, 'user-data', 'general-chat', 'workspace')
  await mkdir(projectPath)
  const canonicalProjectPath = await realpath(projectPath)
  const scopeResolver = new ConversationScopeResolver(
    {
      getLocation: (candidateId) => candidateId === workspaceId
        ? { id: workspaceId, name: 'project', path: canonicalProjectPath }
        : undefined,
    },
    projectlessPath,
  )
  const navigation = new ConversationNavigationRepository(
    join(root, 'user-data', 'conversation-navigation.json'),
  )
  navigation.initialize()
  let currentState = sessionState()
  let snapshot = runtimeSnapshot(1, currentState)
  const start = vi.fn(async (scope: ConversationScope) => {
    await scopeResolver.prepare(scope)
    currentState = sessionState({
      sessionId: `session-${snapshot.generation + 1}`,
    })
    snapshot = runtimeSnapshot(snapshot.generation + 1, currentState)
    return snapshot
  })
  const open = vi.fn(async (scope: ConversationScope) => {
    snapshot = runtimeSnapshot(snapshot.generation + 1, currentState)
    return {
      scope,
      sessionId: currentState.sessionId,
      generation: snapshot.generation,
    }
  })
  const disposeScope = vi.fn(async () => undefined)
  const rename = vi.fn(async (
    scope: ConversationScope,
    _selectionToken: string,
    name: string,
  ) => ({
    scope,
    sessionId: currentState.sessionId,
    name,
  }))
  const deleteSession = vi.fn(async (scope: ConversationScope) => ({
    scope,
    sessionId: 'session-deleted',
    activeDeleted: false,
    disposition: 'trash' as const,
  }))
  const service = new ConversationContextService({
    activationService: {
      open,
      rename,
      start,
    },
    deletionService: { delete: deleteSession },
    navigationRepository: navigation,
    runtimeHost: {
      getState: async () => structuredClone(currentState),
    },
    scopeResolver,
    disposeScope,
  })
  return {
    deleteSession,
    disposeScope,
    navigation,
    open,
    projectlessPath,
    rename,
    service,
    setRuntimeState(state: LocalPiSessionState) {
      currentState = state
      snapshot = runtimeSnapshot(snapshot.generation, currentState)
    },
    start,
  }
}

describe('ConversationContextService', () => {
  it('starts fresh in the fixed projectless scope and creates no project record', async () => {
    const context = await fixture()
    const result = await context.service.start()

    expect(result.state).toBe('ready')
    expect(context.start).toHaveBeenCalledWith(projectlessScope)
    expect(context.navigation.get().activeScope).toEqual(projectlessScope)
    await expect(realpath(context.projectlessPath)).resolves.toBeTruthy()
  })

  it('creates an independent Runtime for every new conversation', async () => {
    const context = await fixture()
    const first = await context.service.newConversation(projectScope)

    expect(context.disposeScope).toHaveBeenCalledWith(projectlessScope)
    expect(context.start).toHaveBeenCalledWith(projectScope)
    expect(context.start.mock.invocationCallOrder[0]).toBeLessThan(
      context.disposeScope.mock.invocationCallOrder[0]!,
    )
    expect(context.navigation.get().activeScope).toEqual(projectScope)

    const second = await context.service.newConversation(projectScope)
    expect(context.start).toHaveBeenCalledTimes(2)
    expect(first.sessionId).not.toBe(second.sessionId)
    expect(context.disposeScope).toHaveBeenCalledTimes(1)
  })

  it('keeps the previous scope terminal alive when cross-scope activation fails', async () => {
    const context = await fixture()
    context.start.mockRejectedValueOnce(new Error('Pi failed to start.'))

    await expect(
      context.service.newConversation(projectScope),
    ).rejects.toThrow('Pi failed to start.')

    expect(context.disposeScope).not.toHaveBeenCalled()
    expect(context.navigation.get().activeScope).toEqual(projectlessScope)
  })

  it('does not stop or reject a running conversation when another one is opened', async () => {
    const context = await fixture()
    context.setRuntimeState(sessionState({ isStreaming: true }))

    await expect(
      context.service.newConversation(projectScope),
    ).resolves.toMatchObject({ scope: projectScope })
    expect(context.start).toHaveBeenCalledWith(projectScope)
  })

  it('publishes a resumed scope only after official activation succeeds', async () => {
    const context = await fixture()
    const token = `sel_${'a'.repeat(32)}`

    await context.service.openConversation(
      projectScope,
      token,
    )
    expect(context.open).toHaveBeenCalledWith(
      projectScope,
      token,
    )
    expect(context.navigation.get().activeScope).toEqual(projectScope)
  })

  it('serializes deletion without changing the owning navigation scope', async () => {
    const context = await fixture()
    const token = `sel_${'d'.repeat(32)}`

    await expect(context.service.deleteConversation(projectlessScope, token))
      .resolves.toEqual({
        scope: projectlessScope,
        sessionId: 'session-deleted',
        activeDeleted: false,
        disposition: 'trash',
      })
    expect(context.deleteSession).toHaveBeenCalledWith(projectlessScope, token)
    expect(context.navigation.get().activeScope).toEqual(projectlessScope)
  })

  it('renames the selected catalog row without activating it', async () => {
    const context = await fixture()
    const token = `sel_${'r'.repeat(32)}`

    await expect(
      context.service.renameConversation(projectScope, token, 'Renamed'),
    ).resolves.toEqual({
      scope: projectScope,
      sessionId: 'session-current',
      name: 'Renamed',
    })
    expect(context.rename).toHaveBeenCalledWith(projectScope, token, 'Renamed')
    expect(context.open).not.toHaveBeenCalled()
  })
})
