import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ModelsConfigController,
  ModelsConfigError,
  ModelsConfigService,
} from '../../src/main/models-config/models-config-service'
import type {
  LocalPiRpcEvent,
  LocalPiRuntimeSnapshot,
} from '../../src/shared/local-pi'
import type { PiManagementModelsPayload } from '../../src/shared/pi-integrations'

const roots: string[] = []

function readyRuntime(generation: number): LocalPiRuntimeSnapshot {
  return {
    state: 'ready',
    generation,
    cwd: '/private/project',
    sessionFile: null,
    sessionState: {
      thinkingLevel: 'medium',
      isStreaming: true,
      isCompacting: false,
      steeringMode: 'one-at-a-time',
      followUpMode: 'one-at-a-time',
      sessionId: `session-${generation}`,
      autoCompactionEnabled: true,
      messageCount: 0,
      pendingMessageCount: 0,
    },
    commands: [],
    stderr: '',
    diagnostics: [],
  }
}

class FakeRuntimeHost {
  private snapshotListeners = new Set<(snapshot: LocalPiRuntimeSnapshot) => void>()
  private eventListeners = new Set<(event: LocalPiRpcEvent, generation: number) => void>()
  private snapshot: LocalPiRuntimeSnapshot
  readonly restart = vi.fn(async () => this.getSnapshot())

  constructor(snapshot: LocalPiRuntimeSnapshot) {
    this.snapshot = snapshot
  }

  getSnapshot() {
    return structuredClone(this.snapshot)
  }

  subscribe(listener: (snapshot: LocalPiRuntimeSnapshot) => void) {
    this.snapshotListeners.add(listener)
    return () => this.snapshotListeners.delete(listener)
  }

  subscribeEvents(listener: (event: LocalPiRpcEvent, generation: number) => void) {
    this.eventListeners.add(listener)
    return () => this.eventListeners.delete(listener)
  }

  publish(snapshot: LocalPiRuntimeSnapshot) {
    this.snapshot = snapshot
    for (const listener of this.snapshotListeners) listener(this.getSnapshot())
  }

  emit(event: LocalPiRpcEvent, generation: number) {
    for (const listener of this.eventListeners) listener(event, generation)
  }
}

function managementPayload(overrides?: Partial<PiManagementModelsPayload>): PiManagementModelsPayload {
  return {
    modelsPath: '/helper-home/.pi/agent/models.json',
    settingsPath: '/helper-home/.pi/agent/settings.json',
    defaultProvider: 'anthropic',
    defaultModel: 'claude-opus-4-5',
    ...overrides,
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })))
})

async function fixture({ helperAvailable = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'pipilot-models-config-'))
  roots.push(root)
  const home = join(root, 'home')
  await mkdir(home, { recursive: true })
  const modelsDefaults = vi.fn(async (): Promise<PiManagementModelsPayload> => {
    if (!helperAvailable) throw new Error('The Pi management helper is unavailable.')
    return managementPayload()
  })
  const setDefaultModel = vi.fn(async (): Promise<PiManagementModelsPayload> => {
    if (!helperAvailable) throw new Error('The Pi management helper is unavailable.')
    return managementPayload({ settingsUpdated: true })
  })
  const testModel = vi.fn(async (content: string, providerId: string, modelId: string) => {
    if (!helperAvailable) throw new Error('The Pi management helper is unavailable.')
    expect(content).toContain(providerId)
    return {
      providerId,
      modelId,
      latencyMs: 42,
      responsePreview: 'OK',
    }
  })
  const service = new ModelsConfigService({
    homeDirectory: home,
    management: { modelsDefaults, setDefaultModel, testModel },
  })
  return { home, service, modelsDefaults, setDefaultModel, testModel }
}

describe('ModelsConfigService', () => {
  it('reads only the exact Pi Agent global models file and attaches defaults', async () => {
    const { home, service } = await fixture()

    const missing = await service.load({ kind: 'global' })
    expect(missing).toMatchObject({
      exists: false,
      path: join(home, '.pi', 'agent', 'models.json'),
      valid: true,
      providers: [],
      defaultProvider: 'anthropic',
      defaultModel: 'claude-opus-4-5',
    })

    const legacyPath = join(home, '.config', 'pi', 'models.json')
    await mkdir(join(home, '.config', 'pi'), { recursive: true })
    await writeFile(legacyPath, '{ "providers": { "legacy": {} } }', 'utf8')
    const stillMissing = await service.load({ kind: 'global' })
    expect(stillMissing.exists).toBe(false)

    const content = '{\n  "providers": { "acme": { "baseUrl": "https://api.example.test" } }\n}\n'
    const saved = await service.save(
      { kind: 'global' },
      content,
      missing.fingerprint,
    )
    expect(saved.exists).toBe(true)
    await expect(
      readFile(join(home, '.pi', 'agent', 'models.json'), 'utf8'),
    ).resolves.toBe(content)
    await expect(readFile(legacyPath, 'utf8'))
      .resolves.toBe('{ "providers": { "legacy": {} } }')
  })

  it('falls back to a read-only settings.json parse when the helper is unavailable', async () => {
    const { home, service } = await fixture({ helperAvailable: false })
    const settingsDirectory = join(home, '.pi', 'agent')
    await mkdir(settingsDirectory, { recursive: true })
    await writeFile(
      join(settingsDirectory, 'settings.json'),
      '{\n  // keep the heavy model\n  "defaultProvider": "openai",\r\n  "defaultModel": "gpt-5.2",\n}\n',
      'utf8',
    )

    const snapshot = await service.load({ kind: 'global' })
    expect(snapshot).toMatchObject({
      exists: false,
      defaultProvider: 'openai',
      defaultModel: 'gpt-5.2',
    })
    await expect(service.defaults()).resolves.toEqual({
      defaultProvider: 'openai',
      defaultModel: 'gpt-5.2',
    })

    await writeFile(join(settingsDirectory, 'settings.json'), '{ broken', 'utf8')
    await expect(service.defaults()).resolves.toEqual({})
  })

  it('rejects apiKey values and external edits without overwriting them', async () => {
    const { home, service } = await fixture()
    const initial = await service.load({ kind: 'global' })
    const external = '{\n  "providers": {\n    "acme": { "apiKey": "sk-secret", "baseUrl": "https://api.example.test" }\n  }\n}\n'
    const modelsPath = join(home, '.pi', 'agent', 'models.json')
    await mkdir(join(home, '.pi', 'agent'), { recursive: true })
    await writeFile(modelsPath, external, 'utf8')

    await expect(service.save(
      { kind: 'global' },
      '{\n  "providers": {}\n}\n',
      initial.fingerprint,
    )).rejects.toMatchObject({
      code: 'MODELS_CONFIG_CONFLICT',
    } satisfies Partial<ModelsConfigError>)
    await expect(readFile(modelsPath, 'utf8')).resolves.toBe(external)

    const loaded = await service.load({ kind: 'global' })
    expect(loaded.providers[0]).toMatchObject({ id: 'acme', hasApiKey: true })
    expect(JSON.stringify(loaded.providers)).not.toContain('sk-secret')
  })

  it('leaves disk unchanged for invalid JSONC', async () => {
    const { home, service } = await fixture()
    const initial = await service.load({ kind: 'global' })
    await expect(service.save(
      { kind: 'global' },
      '{\n  "providers": { "broken": }\n}\n',
      initial.fingerprint,
    )).rejects.toMatchObject({
      code: 'MODELS_CONFIG_INVALID',
    } satisfies Partial<ModelsConfigError>)
    await expect(readFile(join(home, '.pi', 'agent', 'models.json'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('updates the default model only through the management helper', async () => {
    const { service, setDefaultModel } = await fixture()
    await expect(service.setDefault('acme', 'acme-large')).resolves.toEqual({
      settingsUpdated: true,
      defaultProvider: 'anthropic',
      defaultModel: 'claude-opus-4-5',
    })
    expect(setDefaultModel).toHaveBeenCalledWith('acme', 'acme-large')
  })

  it('fails honestly when the default cannot be persisted', async () => {
    const { service } = await fixture({ helperAvailable: false })
    await expect(service.setDefault('acme', 'acme-large')).rejects.toMatchObject({
      code: 'MODELS_CONFIG_DEFAULTS_UNAVAILABLE',
    } satisfies Partial<ModelsConfigError>)
  })

  it('tests an unsaved valid draft through the isolated management helper', async () => {
    const { service, testModel } = await fixture()
    const content = JSON.stringify({
      providers: {
        google: {
          api: 'google-generative-ai',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
          models: [{ id: 'gemini-fixture' }],
        },
      },
    })

    await expect(service.test(content, 'google', 'gemini-fixture')).resolves.toEqual({
      providerId: 'google',
      modelId: 'gemini-fixture',
      latencyMs: 42,
      responsePreview: 'OK',
    })
    expect(testModel).toHaveBeenCalledWith(content, 'google', 'gemini-fixture')
  })

  it('rejects a model test when the draft or model identity is invalid', async () => {
    const { service, testModel } = await fixture()
    await expect(service.test('{ broken', 'google', 'gemini-fixture'))
      .rejects.toMatchObject({ code: 'MODELS_CONFIG_INVALID' })
    await expect(service.test(
      '{"providers":{"google":{"models":[{"id":"other"}]}}}',
      'google',
      'gemini-fixture',
    )).rejects.toMatchObject({ code: 'MODELS_CONFIG_INVALID' })
    expect(testModel).not.toHaveBeenCalled()
  })

  it('applies a queued restart only to the runtime generation that requested it', async () => {
    const { service } = await fixture()
    const initial = await service.load({ kind: 'global' })
    const runtime = new FakeRuntimeHost(readyRuntime(7))
    const controller = new ModelsConfigController(service, runtime)

    try {
      await expect(controller.save(
        { kind: 'global' },
        '{ "providers": { "first": { "baseUrl": "https://a.example.test" } } }',
        initial.fingerprint,
      )).resolves.toMatchObject({ apply: 'pending' })

      runtime.publish(readyRuntime(8))
      runtime.emit({ type: 'agent_settled' }, 8)
      expect(runtime.restart).not.toHaveBeenCalled()

      const current = await service.load({ kind: 'global' })
      await expect(controller.save(
        { kind: 'global' },
        '{ "providers": { "second": { "baseUrl": "https://b.example.test" } } }',
        current.fingerprint,
      )).resolves.toMatchObject({ apply: 'pending' })
      runtime.emit({ type: 'agent_settled' }, 8)
      await vi.waitFor(() => expect(runtime.restart).toHaveBeenCalledTimes(1))
    } finally {
      controller.dispose()
    }
  })
})
