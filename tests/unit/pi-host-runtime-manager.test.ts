import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  RuntimeManager,
} from '../../src/main/pi-host/runtime-manager'

const managers = new Set<RuntimeManager>()
const roots = new Set<string>()

afterEach(async () => {
  await Promise.allSettled([...managers].map((manager) => manager.dispose()))
  managers.clear()
  await Promise.all([...roots].map((root) => rm(root, {
    recursive: true,
    force: true,
  })))
  roots.clear()
})

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'pipilot-sdk-runtime-'))
  roots.add(root)
  const cwd = join(root, 'project')
  const agentDir = join(root, 'agent')
  const sessionDir = join(root, 'sessions')
  await Promise.all([
    mkdir(cwd, { recursive: true }),
    mkdir(agentDir, { recursive: true }),
    mkdir(sessionDir, { recursive: true }),
  ])
  const manager = new RuntimeManager({
    cwd,
    agentDir,
    operationTimeoutMs: 10_000,
    resourceLoaderOptions: {
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
    },
  })
  managers.add(manager)
  return { root, cwd, agentDir, sessionDir, manager }
}

describe('Pi Host RuntimeManager', () => {
  it('creates an isolated public-SDK runtime and projects the proof commands', async () => {
    const { manager, cwd, sessionDir } = await createFixture()
    const created = await manager.create({
      runtimeId: 'rt_primary',
      sessionDir,
    })

    expect(created).toMatchObject({
      runtimeId: 'rt_primary',
      generation: 1,
      cwd,
    })
    expect(created.sessionFile).toContain(sessionDir)
    await expect(manager.command('rt_primary', { type: 'get_state' }))
      .rejects.toMatchObject({ code: 'RUNTIME_NOT_BOUND' })
    await manager.bindRuntime(created.runtimeId, created.generation)

    const state = await manager.command('rt_primary', { type: 'get_state' })
    expect(state.response).toMatchObject({
      type: 'response',
      command: 'get_state',
      success: true,
      data: {
        sessionId: created.sessionId,
        messageCount: 0,
        pendingMessageCount: 0,
      },
    })
    const messages = await manager.command('rt_primary', {
      type: 'get_messages',
    })
    expect(messages.response).toMatchObject({
      command: 'get_messages',
      success: true,
      data: { messages: [] },
    })
    const commands = await manager.command('rt_primary', {
      type: 'get_commands',
    })
    expect(commands.response).toMatchObject({
      command: 'get_commands',
      success: true,
      data: { commands: [] },
    })
  })

  it('increments generation after new and switch while keeping the Host cwd', async () => {
    const { manager, cwd, sessionDir } = await createFixture()
    const created = await manager.create({
      runtimeId: 'rt_replace',
      sessionDir,
    })
    await manager.bindRuntime(created.runtimeId, created.generation)
    const next = await manager.command('rt_replace', { type: 'new_session' })

    expect(next.runtime).toMatchObject({
      runtimeId: 'rt_replace',
      generation: 2,
      cwd,
    })
    expect(next.runtime.sessionId).not.toBe(created.sessionId)

    const sessionFile = join(sessionDir, 'fixture-session.jsonl')
    await writeFile(sessionFile, `${JSON.stringify({
      type: 'session',
      version: 3,
      id: 'fixture-session',
      timestamp: '2026-08-14T00:00:00.000Z',
      cwd,
    })}\n`, 'utf8')
    const switched = await manager.command('rt_replace', {
      type: 'switch_session',
      sessionPath: sessionFile,
    })

    expect(switched.response).toMatchObject({
      command: 'switch_session',
      success: true,
      data: { cancelled: false },
    })
    expect(switched.runtime).toMatchObject({
      generation: 3,
      sessionId: 'fixture-session',
      sessionFile,
      cwd,
    })
  })

  it('reloads SDK resources in place and advances the Runtime generation', async () => {
    const { manager, sessionDir } = await createFixture()
    const created = await manager.create({ runtimeId: 'rt_reload', sessionDir })
    await manager.bindRuntime(created.runtimeId, created.generation)

    const reloaded = await manager.reloadRuntime(
      created.runtimeId,
      created.generation,
    )

    expect(reloaded).toMatchObject({
      runtimeId: created.runtimeId,
      generation: created.generation + 1,
      sessionId: created.sessionId,
      sessionFile: created.sessionFile,
    })
    await expect(manager.command(
      created.runtimeId,
      { type: 'get_state' },
      created.generation,
    )).rejects.toMatchObject({ code: 'RUNTIME_STALE_GENERATION' })
    await expect(manager.command(
      created.runtimeId,
      { type: 'get_state' },
      reloaded.generation,
    )).resolves.toMatchObject({ runtime: { generation: reloaded.generation } })
  })

  it('keeps more than the former default Runtime count until explicit disposal', async () => {
    const { manager, sessionDir } = await createFixture()
    const created = await Promise.all(Array.from({ length: 5 }, (_, index) =>
      manager.create({
        runtimeId: `rt_retained_${index}`,
        sessionDir,
      }),
    ))

    expect(manager.size).toBe(5)
    expect(manager.list()).toHaveLength(5)

    await manager.dispose()
    expect(manager.size).toBe(0)
    await expect(manager.command('rt_retained_0', { type: 'get_state' }))
      .rejects.toMatchObject({ code: 'RUNTIME_MANAGER_DISPOSED' })
    expect(created.every((runtime) => runtime.sessionFile?.startsWith(sessionDir))).toBe(true)
  })

  it('disposes SDK Runtime memory without deleting its persisted Session file', async () => {
    const { manager, cwd, sessionDir } = await createFixture()
    const sessionFile = join(sessionDir, 'persisted.jsonl')
    const content = `${JSON.stringify({
      type: 'session',
      version: 3,
      id: 'persisted-session',
      timestamp: '2026-08-16T00:00:00.000Z',
      cwd,
    })}\n`
    await writeFile(sessionFile, content, 'utf8')
    const created = await manager.create({
      runtimeId: 'rt_persisted',
      sessionDir,
      sessionFile,
    })
    await manager.bindRuntime(created.runtimeId, created.generation)

    await manager.disposeRuntime(created.runtimeId, created.generation)

    const persisted = await readFile(sessionFile, 'utf8')
    expect(persisted.startsWith(content)).toBe(true)
    expect(manager.size).toBe(0)
  })

  it('rejects a Session whose header cwd belongs to another Host', async () => {
    const { manager, sessionDir } = await createFixture()
    const sessionFile = join(sessionDir, 'wrong-scope.jsonl')
    await writeFile(sessionFile, `${JSON.stringify({
      type: 'session',
      version: 3,
      id: 'wrong-scope',
      timestamp: '2026-08-14T00:00:00.000Z',
      cwd: '/tmp/another-pipilot-project',
    })}\n`, 'utf8')

    await expect(manager.create({
      runtimeId: 'rt_wrong_scope',
      sessionDir,
      sessionFile,
    })).rejects.toMatchObject({ code: 'RUNTIME_SCOPE_MISMATCH' })

    await expect(manager.create({
      runtimeId: 'rt_wrong_scope',
      sessionDir,
    })).resolves.toMatchObject({ generation: 1 })
  })

  it('recovers a moved Session by forking it into the current Host cwd', async () => {
    const { manager, cwd, root, sessionDir } = await createFixture()
    const sourceFile = join(sessionDir, 'moved-source.jsonl')
    const missingCwd = join(root, 'moved-away-project')
    await writeFile(sourceFile, `${JSON.stringify({
      type: 'session',
      version: 3,
      id: 'moved-source',
      timestamp: '2026-08-14T00:00:00.000Z',
      cwd: missingCwd,
    })}\n`, 'utf8')

    const recovered = await manager.create({
      runtimeId: 'rt_recovered',
      sessionDir,
      forkSessionFile: sourceFile,
    })
    await manager.bindRuntime(recovered.runtimeId, recovered.generation)

    expect(recovered).toMatchObject({
      runtimeId: 'rt_recovered',
      generation: 1,
      cwd,
    })
    expect(recovered.sessionFile).not.toBe(sourceFile)
    const state = await manager.command('rt_recovered', { type: 'get_state' })
    expect(state.response).toMatchObject({
      command: 'get_state',
      success: true,
      data: { sessionId: recovered.sessionId },
    })
  })

  it('checks expected generation inside the serialized Runtime lifecycle', async () => {
    const { manager, sessionDir } = await createFixture()
    const created = await manager.create({ runtimeId: 'rt_generation', sessionDir })
    await manager.bindRuntime(created.runtimeId, created.generation)

    const replaced = await manager.command(
      'rt_generation',
      { type: 'new_session' },
      1,
    )
    expect(replaced.runtime.generation).toBe(2)
    await expect(manager.command(
      'rt_generation',
      { type: 'get_state' },
      1,
    )).rejects.toMatchObject({ code: 'RUNTIME_STALE_GENERATION' })
    await expect(manager.disposeRuntime('rt_generation', 1))
      .rejects.toMatchObject({ code: 'RUNTIME_STALE_GENERATION' })
    await expect(manager.command(
      'rt_generation',
      { type: 'get_state' },
      2,
    )).resolves.toMatchObject({ runtime: { generation: 2 } })
  })
})
