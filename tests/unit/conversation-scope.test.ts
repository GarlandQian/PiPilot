import { randomUUID } from 'node:crypto'
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  conversationScopeSchema,
  conversationNavigationSnapshotSchema,
  sessionCatalogSelectionTokenSchema,
  type ConversationScope,
} from '../../src/shared/conversation-scope'
import {
  ConversationScopeError,
  ConversationScopeResolver,
} from '../../src/main/conversations/conversation-scope-resolver'
import { ObservedPiSessionDirectoryRepository } from '../../src/main/repositories/observed-pi-session-directory-repository'
import { WorkspaceRepository } from '../../src/main/repositories/workspace-repository'
import { ConversationNavigationRepository } from '../../src/main/repositories/conversation-navigation-repository'

describe('ConversationNavigationRepository', () => {
  it('persists only the current active scope and defaults fresh state to projectless', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pipilot-navigation-'))
    const filePath = join(root, 'user-data', 'conversation-navigation.json')
    const diagnostics: string[] = []
    const repository = new ConversationNavigationRepository(filePath, {
      onDiagnostic: (code) => diagnostics.push(code),
    })
    const workspaceId = randomUUID()

    try {
      expect(repository.initialize()).toEqual({
        revision: 1,
        activeScope: { kind: 'projectless' },
      })
      expect(diagnostics).toEqual(['created'])
      const updates: unknown[] = []
      const unsubscribe = repository.subscribe((snapshot) => updates.push(snapshot))
      const projectSnapshot = repository.setActiveScope({
        kind: 'project',
        workspaceId,
      })
      unsubscribe()
      expect(conversationNavigationSnapshotSchema.parse(projectSnapshot)).toEqual({
        revision: 2,
        activeScope: { kind: 'project', workspaceId },
      })
      expect(updates).toEqual([projectSnapshot])

      const document = JSON.parse(await readFile(filePath, 'utf8')) as Record<string, unknown>
      expect(document).toEqual({
        version: 1,
        activeScope: { kind: 'project', workspaceId },
      })
      expect(document).not.toHaveProperty('currentId')
      expect(document).not.toHaveProperty('path')

      const restored = new ConversationNavigationRepository(filePath)
      expect(restored.initialize().activeScope).toEqual({
        kind: 'project',
        workspaceId,
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('does not parse an earlier or widened navigation document', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pipilot-navigation-current-only-'))
    const filePath = join(root, 'conversation-navigation.json')
    await writeFile(filePath, JSON.stringify({
      version: 1,
      currentId: randomUUID(),
      activeScope: { kind: 'projectless' },
    }))
    const repository = new ConversationNavigationRepository(filePath, {
      createId: () => 'backup-id',
      now: () => Date.UTC(2026, 7, 8),
    })

    try {
      expect(repository.initialize().activeScope).toEqual({ kind: 'projectless' })
      const files = await readdir(root)
      expect(files.some((name) => name.includes('.corrupt-') && name.endsWith('.bak')))
        .toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('conversation scope', () => {
  it('resolves an explicit project by id without changing the active workspace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pipilot-scope-'))
    const firstPath = join(root, 'first')
    const secondPath = join(root, 'second')
    const projectlessPath = join(root, 'user-data', 'general-chat', 'workspace')
    await Promise.all([
      mkdir(firstPath, { recursive: true }),
      mkdir(secondPath, { recursive: true }),
    ])
    const workspaces = new WorkspaceRepository(join(root, 'workspaces.json'))

    try {
      await workspaces.initialize()
      const first = await workspaces.activatePath(firstPath)
      const second = await workspaces.activatePath(secondPath)
      const resolver = new ConversationScopeResolver(workspaces, projectlessPath)

      await expect(
        resolver.resolve({ kind: 'project', workspaceId: first.id }),
      ).resolves.toMatchObject({
        scope: { kind: 'project', workspaceId: first.id },
        cwd: first.path,
        label: 'first',
      })
      expect(workspaces.getCurrentLocation()?.id).toBe(second.id)
      expect(workspaces.getLocation(first.id)?.path).toBe(first.path)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('creates only the fixed projectless cwd when explicitly prepared', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pipilot-projectless-scope-'))
    const projectlessPath = join(root, 'general-chat', 'workspace')
    const resolver = new ConversationScopeResolver(
      { getLocation: () => undefined },
      projectlessPath,
    )

    try {
      await expect(resolver.resolve({ kind: 'projectless' })).rejects.toMatchObject({
        code: 'CONVERSATION_SCOPE_UNAVAILABLE',
      } satisfies Partial<ConversationScopeError>)
      const prepared = await resolver.prepare({ kind: 'projectless' })
      expect(prepared).toEqual({
        scope: { kind: 'projectless' },
        cwd: await realpath(projectlessPath),
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects a projectless cwd replaced by a symbolic link', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pipilot-projectless-link-'))
    const projectlessPath = join(root, 'general-chat', 'workspace')
    const outsidePath = join(root, 'outside')
    const resolver = new ConversationScopeResolver(
      { getLocation: () => undefined },
      projectlessPath,
    )

    try {
      await Promise.all([
        mkdir(join(root, 'general-chat'), { recursive: true }),
        mkdir(outsidePath),
      ])
      await symlink(outsidePath, projectlessPath, 'dir')

      await expect(
        resolver.prepare({ kind: 'projectless' }),
      ).rejects.toMatchObject({
        code: 'CONVERSATION_SCOPE_UNAVAILABLE',
      } satisfies Partial<ConversationScopeError>)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('keeps renderer scope and selection contracts path-free', () => {
    const workspaceId = randomUUID()
    expect(conversationScopeSchema.safeParse({
      kind: 'project',
      workspaceId,
      path: '/private/project',
    }).success).toBe(false)
    expect(conversationScopeSchema.safeParse({ kind: 'projectless' }).success).toBe(true)
    expect(sessionCatalogSelectionTokenSchema.safeParse('/tmp/session.jsonl').success)
      .toBe(false)
  })
})

describe('ObservedPiSessionDirectoryRepository', () => {
  it('persists only current-version bounded directory observations', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pipilot-observed-pi-'))
    const filePath = join(root, 'user-data', 'observed.json')
    const scope: ConversationScope = { kind: 'projectless' }
    let now = Date.UTC(2026, 7, 8, 0, 0, 0)
    const repository = new ObservedPiSessionDirectoryRepository(filePath, {
      now: () => now,
    })

    try {
      await repository.initialize()
      await expect(repository.observe(scope, undefined)).resolves.toEqual({
        status: 'activationUnavailable',
        reason: 'missingSessionFile',
      })
      expect(repository.get(scope)).toBeUndefined()
      expect(repository.getState(scope)).toEqual({
        status: 'activationUnavailable',
      })

      const pendingDirectory = join(root, 'pending-session')
      await mkdir(pendingDirectory)
      await expect(
        repository.observe(scope, join(pendingDirectory, 'not-written-yet.jsonl')),
      ).resolves.toMatchObject({
        status: 'observed',
        observation: { directory: await realpath(pendingDirectory) },
      })

      let latestDirectory = ''
      for (let index = 0; index < 9; index += 1) {
        latestDirectory = join(root, `sessions-${index}`)
        const sessionFile = join(latestDirectory, 'session.jsonl')
        await mkdir(latestDirectory)
        await writeFile(sessionFile, '{}\n', 'utf8')
        now += 1_000
        await expect(repository.observe(scope, sessionFile)).resolves.toMatchObject({
          status: 'observed',
          observation: { directory: await realpath(latestDirectory) },
        })
      }

      const persisted = JSON.parse(await readFile(filePath, 'utf8')) as {
        version: number
        scopes: Array<{ recent: unknown[] }>
      }
      expect(persisted.version).toBe(1)
      expect(persisted.scopes).toHaveLength(1)
      expect(persisted.scopes[0]?.recent).toHaveLength(8)

      const restored = new ObservedPiSessionDirectoryRepository(filePath)
      await restored.initialize()
      expect(restored.get(scope)?.directory).toBe(await realpath(latestDirectory))

      await restored.observe(scope, undefined)
      expect(restored.get(scope)).toBeUndefined()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('serializes concurrent observations into one recoverable current document', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pipilot-observed-concurrent-'))
    const filePath = join(root, 'user-data', 'observed.json')
    const projectDirectory = join(root, 'project-sessions')
    const projectlessDirectory = join(root, 'projectless-sessions')
    const projectScope: ConversationScope = {
      kind: 'project',
      workspaceId: randomUUID(),
    }
    const projectlessScope: ConversationScope = { kind: 'projectless' }
    const repository = new ObservedPiSessionDirectoryRepository(filePath)

    try {
      await Promise.all([
        mkdir(projectDirectory),
        mkdir(projectlessDirectory),
      ])
      await repository.initialize()
      await Promise.all([
        repository.observe(projectScope, join(projectDirectory, 'future.jsonl')),
        repository.observe(
          projectlessScope,
          join(projectlessDirectory, 'future.jsonl'),
        ),
      ])

      const restored = new ObservedPiSessionDirectoryRepository(filePath)
      await restored.initialize()
      expect(restored.get(projectScope)?.directory).toBe(
        await realpath(projectDirectory),
      )
      expect(restored.get(projectlessScope)?.directory).toBe(
        await realpath(projectlessDirectory),
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
