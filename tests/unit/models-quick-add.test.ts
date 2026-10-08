import { describe, expect, it } from 'vitest'
import { applyQuickAdd, deriveProviderId, findProviderForEndpoint, normalizeEndpoint, splitModelIds } from '../../src/components/settings/models-quick-add'
import { parseModelsConfigDocument } from '../../src/shared/models-config-schema'

describe('adding an endpoint and its models in one step', () => {
  it('names the provider after the endpoint without taking a built-in Pi ID', () => {
    expect(deriveProviderId('https://dashscope.aliyuncs.com/compatible-mode/v1', [])).toBe('dashscope')
    expect(deriveProviderId('https://open.bigmodel.cn/api/paas/v4', [])).toBe('bigmodel')
    // "deepseek" and "openrouter" are Pi's own providers; reusing them would replace their catalogs.
    expect(deriveProviderId('https://api.deepseek.com/v1', [])).toBe('deepseek-api')
    expect(deriveProviderId('https://openrouter.ai/api/v1', [])).toBe('openrouter-api')
    expect(deriveProviderId('http://localhost:11434/v1', [])).toBe('local-11434')
    expect(deriveProviderId('http://192.168.1.5:8000/v1', [])).toBe('host-192-168-1-5-8000')
    expect(deriveProviderId('https://api.siliconflow.cn/v1', ['siliconflow', 'SiliconFlow-2'])).toBe('siliconflow-3')
  })

  it('reads several model IDs typed or pasted together', () => {
    expect(splitModelIds(' deepseek-chat, deepseek-reasoner\nqwen3-coder-plus，glm-4.6 ')).toEqual(['deepseek-chat', 'deepseek-reasoner', 'qwen3-coder-plus', 'glm-4.6'])
    expect(normalizeEndpoint('HTTPS://API.Example.com/v1/')).toBe(normalizeEndpoint('https://api.example.com/v1'))
    expect(normalizeEndpoint('not a url')).toBe('')
  })

  it('creates the provider and its models in one edit, with a placeholder key only for local servers', () => {
    const added = applyQuickAdd('{\n  "providers": {}\n}\n', [], {
      baseUrl: 'https://api.deepseek.com/v1/', apiKey: 'sk-test', modelIds: ['deepseek-chat', 'deepseek-reasoner', 'deepseek-chat'], api: '', name: '',
    })
    const provider = JSON.parse(added.text).providers['deepseek-api']
    expect(provider).toEqual({
      baseUrl: 'https://api.deepseek.com/v1', api: 'openai-completions', apiKey: 'sk-test',
      models: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }],
    })
    const local = applyQuickAdd(added.text, parseModelsConfigDocument(added.text).providers, {
      baseUrl: 'http://localhost:11434/v1', apiKey: '', modelIds: ['qwen2.5-coder:7b'], api: '', name: 'Ollama',
    })
    expect(JSON.parse(local.text).providers['local-11434']).toMatchObject({ name: 'Ollama', apiKey: 'local' })
    expect(JSON.parse(applyQuickAdd(added.text, [], {
      baseUrl: 'https://api.example.com/v1', apiKey: '', modelIds: ['m'], api: '', name: '',
    }).text).providers.example.apiKey).toBeUndefined()
  })

  it('adds new models to a provider already on the same endpoint and keeps what it had', () => {
    const text = JSON.stringify({ providers: { mine: {
      baseUrl: 'https://api.example.com/v1', api: 'openai-completions', apiKey: 'old-key',
      compat: { keep: true }, models: [{ id: 'one', contextWindow: 32000 }],
    } } }, null, 2)
    const providers = parseModelsConfigDocument(text).providers
    expect(findProviderForEndpoint(providers, 'https://API.example.com/v1/')?.id).toBe('mine')
    const result = applyQuickAdd(text, providers, { baseUrl: 'https://api.example.com/v1/', apiKey: '', modelIds: ['one', 'two'], api: '', name: '' })
    expect(result).toMatchObject({ providerId: 'mine', merged: true, added: ['two'] })
    expect(JSON.parse(result.text).providers.mine).toEqual({
      baseUrl: 'https://api.example.com/v1', api: 'openai-completions', apiKey: 'old-key',
      compat: { keep: true }, models: [{ id: 'one', contextWindow: 32000 }, { id: 'two' }],
    })
    // A key typed again replaces the stored one.
    expect(JSON.parse(applyQuickAdd(text, providers, { baseUrl: 'https://api.example.com/v1', apiKey: 'new-key', modelIds: ['two'], api: '', name: '' }).text).providers.mine.apiKey).toBe('new-key')
  })
})
