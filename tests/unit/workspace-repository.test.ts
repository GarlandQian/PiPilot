import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  WorkspaceRepository,
  WorkspaceRepositoryError,
} from '../../src/main/repositories/workspace-repository'

describe('WorkspaceRepository', () => {
  it('persists canonical paths privately while exposing only opaque summaries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pipilot-workspaces-'))
    const firstPath = join(root, 'first')
    const secondPath = join(root, 'second')
    const filePath = join(root, 'user-data', 'workspaces.json')
    await Promise.all([
      mkdir(firstPath, { recursive: true }),
      mkdir(secondPath, { recursive: true }),
    ])
    let now = Date.UTC(2026, 7, 7, 0, 0, 0)
    const repository = new WorkspaceRepository(filePath, {
      createId: randomUUID,
      now: () => now,
    })

    try {
      await repository.initialize()
      const first = await repository.activatePath(firstPath)
      now += 1_000
      const second = await repository.activatePath(secondPath)
      repository.setPinned(first.id, true)

      const snapshot = repository.get()
      expect(snapshot.currentId).toBe(second.id)
      expect(snapshot.recent.map((workspace) => workspace.id)).toEqual([
        first.id,
        second.id,
      ])
      expect(JSON.stringify(snapshot)).not.toContain(root)
      expect(snapshot.recent.every((workspace) => !('path' in workspace))).toBe(true)

      const persisted = await readFile(filePath, 'utf8')
      expect(persisted).toContain(firstPath)
      expect(persisted).toContain(secondPath)
      expect((await stat(filePath)).mode & 0o777).toBe(0o600)
      expect(JSON.parse(persisted)).not.toHaveProperty('currentId')
      expect(JSON.parse(persisted)).not.toHaveProperty('sessionPins')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('restores projects without persisting a duplicate active scope or session metadata', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pipilot-workspaces-'))
    const workspacePath = join(root, 'project')
    const filePath = join(root, 'workspaces.json')
    await mkdir(workspacePath)

    try {
      const firstRepository = new WorkspaceRepository(filePath)
      await firstRepository.initialize()
      const opened = await firstRepository.activatePath(workspacePath)
      firstRepository.flush()

      const restored = new WorkspaceRepository(filePath)
      const snapshot = await restored.initialize()
      expect(snapshot.currentId).toBeUndefined()
      expect(snapshot.recent).toContainEqual(expect.objectContaining({ id: opened.id }))
      expect(restored.getCurrentLocation()).toBeUndefined()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('removes registrations without deleting project directories', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pipilot-workspaces-'))
    const firstPath = join(root, 'first')
    const secondPath = join(root, 'second')
    const filePath = join(root, 'workspaces.json')
    await Promise.all([
      mkdir(firstPath),
      mkdir(secondPath),
    ])
    const repository = new WorkspaceRepository(filePath)

    try {
      await repository.initialize()
      const first = await repository.activatePath(firstPath)
      const second = await repository.activatePath(secondPath)

      const afterInactiveRemoval = repository.remove(first.id)
      expect(afterInactiveRemoval.currentId).toBe(second.id)
      expect(afterInactiveRemoval.recent.map(({ id }) => id)).toEqual([second.id])
      await expect(stat(firstPath)).resolves.toMatchObject({})

      const afterActiveRemoval = repository.remove(second.id)
      expect(afterActiveRemoval.currentId).toBeUndefined()
      expect(afterActiveRemoval.recent).toEqual([])
      await expect(stat(secondPath)).resolves.toMatchObject({})
      expect(JSON.parse(await readFile(filePath, 'utf8'))).toMatchObject({
        version: 1,
        recent: [],
      })
      expect(() => repository.remove(second.id)).toThrowError(expect.objectContaining({
        code: 'WORKSPACE_NOT_FOUND',
      }))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('marks missing workspaces unavailable without failing initialization', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pipilot-workspaces-'))
    const workspacePath = join(root, 'project')
    const filePath = join(root, 'workspaces.json')
    await mkdir(workspacePath)

    try {
      const firstRepository = new WorkspaceRepository(filePath)
      await firstRepository.initialize()
      const opened = await firstRepository.activatePath(workspacePath)
      await rm(workspacePath, { recursive: true, force: true })

      const restored = new WorkspaceRepository(filePath)
      const snapshot = await restored.initialize()
      expect(snapshot.recent).toContainEqual(expect.objectContaining({
        id: opened.id,
        available: false,
      }))
      expect(restored.getCurrentLocation()).toBeUndefined()
      await expect(restored.activate(opened.id)).rejects.toMatchObject({
        code: 'WORKSPACE_UNAVAILABLE',
      } satisfies Partial<WorkspaceRepositoryError>)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('backs up corrupt workspace metadata without exposing its contents', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pipilot-workspaces-'))
    const filePath = join(root, 'workspaces.json')
    const diagnostics: string[] = []
    await writeFile(filePath, '{"path":"/Users/private", broken', 'utf8')
    const repository = new WorkspaceRepository(filePath, {
      createId: () => '00000000-0000-4000-8000-000000000099',
      now: () => Date.UTC(2026, 7, 7, 0, 0, 0),
      onDiagnostic: (code) => diagnostics.push(code),
    })

    try {
      await expect(repository.initialize()).resolves.toMatchObject({ recent: [] })
      expect(diagnostics).toEqual(['recovered-corrupt'])
      expect(diagnostics.join(' ')).not.toContain('/Users/private')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
