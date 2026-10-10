import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ModelsDevService } from '../../src/main/models-config/models-dev'
import { compactModelsDev, endpointKey, lookupCatalogModels, resolveModelDetails, thinkingLevelsFromModelsDev, type ModelCatalogEntry } from '../../src/shared/model-catalog'

const cost = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }
const catalog: ModelCatalogEntry[] = [
  { provider: 'openrouter', id: 'anthropic/claude-x', name: 'Anthropic: Claude X', baseUrl: 'https://openrouter.ai/api/v1', reasoning: true, input: ['text', 'image'], contextWindow: 200_000, maxTokens: 64_000, cost: { ...cost, input: 3.3 } },
  { provider: 'github-copilot', id: 'claude-x', name: 'Claude X (Copilot)', baseUrl: 'https://api.githubcopilot.com', reasoning: true, input: ['text'], contextWindow: 128_000, maxTokens: 16_000 },
  { provider: 'anthropic', id: 'claude-x', name: 'Claude X', baseUrl: 'https://api.anthropic.com', reasoning: true, input: ['text', 'image'], contextWindow: 200_000, maxTokens: 64_000, cost, thinkingLevelMap: { off: null, max: 'max' } },
  { provider: 'deepseek', id: 'deepseek-flash', name: 'DeepSeek Flash', baseUrl: 'https://api.deepseek.com', reasoning: true, input: ['text', 'image'], contextWindow: 1_000_000, maxTokens: 384_000, cost: { input: 0.3, output: 1.2, cacheRead: 0.006, cacheWrite: 0 } },
  { provider: 'together', id: 'shared-model', reasoning: false, input: ['text'], contextWindow: 32_000 },
  { provider: 'fireworks', id: 'shared-model', reasoning: false, input: ['text'], contextWindow: 32_000 },
  { provider: 'radius', id: 'shared-model', reasoning: false, input: ['text'], contextWindow: 16_000 },
]

describe('Pi\'s catalog, for models models.dev does not know', () => {
  it('uses the endpoint\'s own provider first, with its price', () => {
    expect(resolveModelDetails(catalog, null, 'https://api.deepseek.com/v1', 'deepseek-flash')).toMatchObject({
      name: 'DeepSeek Flash', cost: { input: 0.3 }, price: { by: 'provider', name: 'DeepSeek' }, source: { catalog: 'pi', basis: 'provider', name: 'DeepSeek' },
    })
    expect(resolveModelDetails(catalog, null, 'https://openrouter.ai/api/v1', 'anthropic/claude-x')).toMatchObject({ name: 'Anthropic: Claude X', cost: { input: 3.3 } })
  })

  it('takes the maker\'s entry on a relay, its price as the list price, and says which levels Pi offers', () => {
    expect(resolveModelDetails(catalog, null, 'https://relay.example/v1', 'claude-x')).toEqual({
      name: 'Claude X', reasoning: true, input: ['text', 'image'], contextWindow: 200_000, maxTokens: 64_000,
      cost, price: { by: 'maker', name: 'Anthropic' }, thinkingLevelMap: { off: null, xhigh: null, max: 'max' }, source: { catalog: 'pi', basis: 'maker', name: 'Anthropic' },
    })
    // A route names its maker: Anthropic's own entry, not the aggregator's copy.
    expect(resolveModelDetails(catalog, null, 'https://relay.example/v1', 'anthropic/claude-x')).toMatchObject({ name: 'Claude X', source: { basis: 'maker' } })
  })

  it('otherwise goes by what most entries say, without a price', () => {
    expect(resolveModelDetails(catalog, null, 'https://relay.example/v1', 'shared-model')).toEqual({
      reasoning: false, input: ['text'], contextWindow: 32_000, source: { catalog: 'pi', basis: 'consensus' },
    })
    expect(lookupCatalogModels(catalog, 'https://relay.example/v1', ['not-in-catalog', 'not-in-catalog']).models).toEqual([{ id: 'not-in-catalog', details: null }])
  })
})

describe('models.dev first', () => {
  const flash = { reasoning: true, modalities: { input: ['text', 'image'] }, canonical_model_id: 'deepseek/deepseek-v4.1-flash', last_updated: '2026-09-10' }
  const modelsDev = compactModelsDev({
    deepseek: { name: 'DeepSeek', api: 'https://api.deepseek.com', models: {
      'deepseek-v4-flash': { ...flash, name: 'DeepSeek V4 Flash', status: 'deprecated', limit: { context: 1_000_000, output: 393_216 } },
      'deepseek-flash': { ...flash, name: 'DeepSeek V4.1 Flash', limit: { context: 1_000_000, output: 393_216 },
        reasoning_options: [{ type: 'toggle' }, { type: 'effort', values: ['low', 'high', 'max'] }], cost: { input: 0.15, output: 0.6, cache_read: 0.003 } },
    } },
    opencode: { name: 'OpenCode Zen', api: 'https://opencode.ai/zen/v1', models: {
      'deepseek-v4.1-flash': { ...flash, name: 'DeepSeek V4.1 Flash', limit: { context: 1_000_000, output: 384_000 },
        reasoning_options: [{ type: 'effort', values: ['low', 'high', 'max'] }], cost: { input: 0.3, output: 1.2, cache_read: 0.006 } },
    } },
    radius: { api: 'https://api.radius.example/v1', models: { 'deepseek-v4.1-flash': { ...flash, limit: { context: 1_000_000, output: 32_768 } } } },
    openrouter: { name: 'OpenRouter', api: 'https://openrouter.ai/api/v1', models: {
      'deepseek/deepseek-v4.1-flash': { ...flash, limit: { context: 1_048_576, output: 943_718 }, cost: { input: 0.3, output: 1.2 } },
      'acme/glm-x': { name: 'GLM X', reasoning: true, limit: { context: 200_000, output: 32_000 }, cost: { input: 1, output: 2 } },
    } },
    siliconflow: { api: 'https://api.siliconflow.cn/v1', models: {
      'glm-x': { name: 'GLM X', reasoning: true, limit: { context: 200_000, output: 16_000 } },
      'Qwen/Qwen3-Coder': { name: 'Qwen3 Coder (SiliconFlow)', reasoning: false, modalities: { input: ['text'] }, limit: { context: 262144, output: 65536 }, cost: { input: 0.5, output: 2 }, canonical_model_id: 'alibaba/qwen3-coder' },
    } },
    novita: { api: 'https://api.novita.ai/openai', models: { 'glm-x': { name: 'GLM X', reasoning: true, limit: { context: 200_000, output: 32_000 } } } },
  })

  it('normalises endpoints, keeping the path that tells plans apart', () => {
    expect(endpointKey('https://api.siliconflow.cn/v1/chat/completions')).toBe(endpointKey('https://API.siliconflow.cn'))
    expect(endpointKey('https://api.z.ai/api/coding/paas/v4')).not.toBe(endpointKey('https://api.z.ai/api/paas/v4'))
  })

  it('finds the maker\'s own entry under its own name on a relay, with its list price and thinking levels', () => {
    expect(resolveModelDetails(catalog, modelsDev, 'https://relay.example/v1', 'deepseek-v4.1-flash')).toEqual({
      name: 'DeepSeek V4.1 Flash', reasoning: true, input: ['text', 'image'], contextWindow: 1_000_000, maxTokens: 393_216,
      cost: { input: 0.15, output: 0.6, cacheRead: 0.003, cacheWrite: 0 }, price: { by: 'maker', name: 'DeepSeek' },
      // A toggle turns thinking off Pi's way; the efforts it lists are sent as themselves.
      thinkingLevelMap: { minimal: null, low: 'low', medium: null, high: 'high', xhigh: null, max: 'max' },
      source: { catalog: 'models.dev', basis: 'maker', name: 'DeepSeek' },
    })
  })

  it('prefers the endpoint\'s own provider, priced as it charges', () => {
    expect(resolveModelDetails(catalog, modelsDev, 'https://opencode.ai/zen/v1', 'deepseek-v4.1-flash')).toMatchObject({
      maxTokens: 384_000, cost: { input: 0.3, output: 1.2 }, price: { by: 'provider', name: 'OpenCode Zen' },
      thinkingLevelMap: { off: null, low: 'low', max: 'max' }, source: { basis: 'provider', name: 'OpenCode Zen' },
    })
    expect(resolveModelDetails(catalog, modelsDev, 'https://api.siliconflow.cn/v1', 'Qwen/Qwen3-Coder')).toMatchObject({
      name: 'Qwen3 Coder (SiliconFlow)', cost: { input: 0.5, output: 2, cacheRead: 0, cacheWrite: 0 }, price: { by: 'provider' },
    })
  })

  it('goes by what most entries say when the maker has none, and leaves the price unset', () => {
    expect(resolveModelDetails(catalog, modelsDev, 'https://relay.example/v1', 'glm-x')).toEqual({
      name: 'GLM X', reasoning: true, input: ['text'], contextWindow: 200_000, maxTokens: 32_000, source: { catalog: 'models.dev', basis: 'consensus' },
    })
  })

  it('leaves models it does not know to Pi', () => {
    expect(resolveModelDetails(catalog, modelsDev, 'https://relay.example/v1', 'claude-x')).toMatchObject({ name: 'Claude X', source: { catalog: 'pi' } })
    expect(resolveModelDetails(catalog, modelsDev, 'https://relay.example/v1', 'made-up')).toBeNull()
  })

  it('reads thinking levels from models.dev\'s reasoning options', () => {
    expect(thinkingLevelsFromModelsDev([{ type: 'effort', values: ['none', 'low', 'medium', 'high', 'xhigh'] }])).toEqual({
      off: 'none', minimal: null, low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: null,
    })
    expect(thinkingLevelsFromModelsDev([{ type: 'effort', values: ['low', 'high', 'max'] }])).toMatchObject({ off: null })
    expect(thinkingLevelsFromModelsDev([{ type: 'budget_tokens', min: 1024 }])).toBeUndefined()
    expect(thinkingLevelsFromModelsDev(undefined)).toBeUndefined()
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
