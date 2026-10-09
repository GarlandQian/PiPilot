import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ModelsDevService } from '../../src/main/models-config/models-dev'
import { compactModelsDev, endpointKey, lookupCatalogModels, matchCatalogModel, resolveModelDetails, type ModelCatalogEntry } from '../../src/shared/model-catalog'

const cost = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }
const catalog: ModelCatalogEntry[] = [
  { provider: 'openrouter', id: 'anthropic/claude-x', name: 'Anthropic: Claude X', baseUrl: 'https://openrouter.ai/api/v1', reasoning: true, input: ['text', 'image'], contextWindow: 200_000, maxTokens: 64_000, cost: { ...cost, input: 3.3 } },
  { provider: 'github-copilot', id: 'claude-x', name: 'Claude X (Copilot)', baseUrl: 'https://api.githubcopilot.com', reasoning: true, input: ['text'], contextWindow: 128_000, maxTokens: 16_000 },
  { provider: 'anthropic', id: 'claude-x', name: 'Claude X', baseUrl: 'https://api.anthropic.com', reasoning: true, input: ['text', 'image'], contextWindow: 200_000, maxTokens: 64_000, cost },
  { provider: 'deepseek', id: 'deepseek-flash', name: 'DeepSeek Flash', baseUrl: 'https://api.deepseek.com', reasoning: true, input: ['text', 'image'], contextWindow: 1_000_000, maxTokens: 384_000, cost: { input: 0.3, output: 1.2, cacheRead: 0.006, cacheWrite: 0 } },
  { provider: 'together', id: 'shared-model', reasoning: false, input: ['text'], contextWindow: 32_000 },
]

describe('matching models added by ID to Pi\'s catalog', () => {
  it('uses the endpoint\'s own provider first, with its price', () => {
    expect(matchCatalogModel(catalog, 'https://api.deepseek.com/v1', 'deepseek-flash')).toMatchObject({ entry: { provider: 'deepseek' }, official: true })
    expect(matchCatalogModel(catalog, 'https://openrouter.ai/api/v1', 'anthropic/claude-x')).toMatchObject({ entry: { provider: 'openrouter' }, official: true })
  })

  it('falls back to the model\'s maker, then to any entry, without its price', () => {
    expect(matchCatalogModel(catalog, 'https://relay.example/v1', 'claude-x')).toMatchObject({ entry: { provider: 'anthropic' }, official: false })
    // A route names its maker: Anthropic's own entry, not the aggregator's copy.
    expect(matchCatalogModel(catalog, 'https://relay.example/v1', 'anthropic/claude-x')).toMatchObject({ entry: { provider: 'anthropic' }, official: false })
    expect(matchCatalogModel(catalog, 'https://relay.example/v1', 'vendor/deepseek-flash')).toMatchObject({ entry: { provider: 'deepseek' }, official: false })
    expect(matchCatalogModel(catalog, 'https://relay.example/v1', 'shared-model')).toMatchObject({ entry: { provider: 'together' } })
    expect(matchCatalogModel(catalog, 'https://relay.example/v1', 'not-in-catalog')).toBeNull()
  })

  it('reports details, with a price only from the model\'s own provider', () => {
    const relay = lookupCatalogModels(catalog, 'https://relay.example/v1', ['deepseek-flash', 'missing', 'deepseek-flash'])
    expect(relay.models).toEqual([
      { id: 'deepseek-flash', details: { name: 'DeepSeek Flash', reasoning: true, input: ['text', 'image'], contextWindow: 1_000_000, maxTokens: 384_000 } },
      { id: 'missing', details: null },
    ])
    const official = lookupCatalogModels(catalog, 'https://api.deepseek.com', ['deepseek-flash'])
    expect(official.models[0]!.details?.cost).toEqual({ input: 0.3, output: 1.2, cacheRead: 0.006, cacheWrite: 0 })
  })
})

describe('filling in from models.dev as well as Pi', () => {
  const modelsDev = compactModelsDev({
    siliconflow: { api: 'https://api.siliconflow.cn/v1', models: {
      'Qwen/Qwen3-Coder': { name: 'Qwen3 Coder (SiliconFlow)', reasoning: false, modalities: { input: ['text'] }, limit: { context: 262144, output: 65536 }, cost: { input: 0.5, output: 2 }, canonical_model_id: 'alibaba/qwen3-coder' },
    } },
    alibaba: { api: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', models: {
      'qwen3-coder': { name: 'Qwen3 Coder', reasoning: true, modalities: { input: ['text', 'image'] }, limit: { context: 1048576, output: 65536 }, cost: { input: 1, output: 5 } },
      'qwen3-coder-plus': { name: 'Qwen3 Coder Plus', limit: { context: 1048576, output: 65536 }, cost: { input: 1, output: 5 } },
    } },
    deepseek: { api: 'https://api.deepseek.com', models: { 'deepseek-flash': { name: 'From models.dev', limit: { context: 64000, output: 8000 } } } },
  })

  it('normalises endpoints, keeping the path that tells plans apart', () => {
    expect(endpointKey('https://api.siliconflow.cn/v1/chat/completions')).toBe(endpointKey('https://API.siliconflow.cn'))
    expect(endpointKey('https://api.z.ai/api/coding/paas/v4')).not.toBe(endpointKey('https://api.z.ai/api/paas/v4'))
  })

  it('prefers Pi for the endpoint\'s own provider, then models.dev for it, with its price', () => {
    // Pi knows DeepSeek on its own endpoint: its numbers win over models.dev.
    expect(resolveModelDetails(catalog, modelsDev, 'https://api.deepseek.com/v1', 'deepseek-flash')).toMatchObject({ name: 'DeepSeek Flash', contextWindow: 1_000_000, cost: { input: 0.3 } })
    // Pi has no SiliconFlow: models.dev's SiliconFlow entry, priced for SiliconFlow.
    expect(resolveModelDetails(catalog, modelsDev, 'https://api.siliconflow.cn/v1', 'Qwen/Qwen3-Coder')).toEqual({
      name: 'Qwen3 Coder (SiliconFlow)', reasoning: false, input: ['text'], contextWindow: 262144, maxTokens: 65536,
      cost: { input: 0.5, output: 2, cacheRead: 0, cacheWrite: 0 },
    })
  })

  it('falls back to the maker\'s entry without its price on a relay', () => {
    expect(resolveModelDetails(catalog, modelsDev, 'https://relay.example/v1', 'qwen3-coder-plus')).toEqual({
      name: 'Qwen3 Coder Plus', reasoning: false, input: ['text'], contextWindow: 1048576, maxTokens: 65536,
    })
    expect(resolveModelDetails(catalog, modelsDev, 'https://relay.example/v1', 'made-up')).toBeNull()
    expect(resolveModelDetails(catalog, modelsDev, 'https://relay.example/v1', 'alibaba/qwen3-coder')).toEqual({
      name: 'Qwen3 Coder', reasoning: true, input: ['text', 'image'], contextWindow: 1048576, maxTokens: 65536,
    })
    // Without models.dev, Pi alone answers.
    expect(resolveModelDetails(catalog, null, 'https://relay.example/v1', 'claude-x')).toMatchObject({ name: 'Claude X' })
    expect(resolveModelDetails(catalog, null, 'https://relay.example/v1', 'claude-x')?.cost).toBeUndefined()
  })
})

describe('the models.dev copy on disk', () => {
  it('fetches once a day, falls back to the last copy offline, and can be switched off', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pipilot-models-dev-'))
    try {
      let now = 1_000, enabled = true, calls = 0, online = true
      const fetchImpl = (async () => {
        calls += 1
        if (!online) throw new Error('offline')
        return new Response(JSON.stringify({ deepseek: { api: 'https://api.deepseek.com', models: { 'deepseek-flash': { name: 'DS' } } } }), { status: 200 })
      }) as typeof fetch
      const service = () => new ModelsDevService({ cachePath: join(directory, 'models-dev.json'), enabled: () => enabled, fetchImpl, now: () => now })
      const first = service()
      expect((await first.index())?.providers[0]?.id).toBe('deepseek')
      expect(calls).toBe(1)
      expect((await service().index())?.providers).toHaveLength(1)
      expect(calls).toBe(1)
      now += 25 * 60 * 60 * 1_000
      online = false
      expect((await service().index())?.providers[0]?.models['deepseek-flash']?.name).toBe('DS')
      expect(calls).toBe(2)
      enabled = false
      expect(await service().index()).toBeNull()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
