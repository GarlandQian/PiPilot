import { describe, expect, it, vi } from 'vitest'
import { listRemoteModels, parseRemoteModelList, remoteModelListRequest, resolveListKey } from '../../src/main/models-config/remote-model-list'

describe('listing an endpoint’s models', () => {
  it('asks each API family where and how it expects', () => {
    expect(remoteModelListRequest({ baseUrl: 'https://api.deepseek.com/v1/', api: 'openai-completions', apiKey: 'sk-1' }))
      .toEqual({ url: 'https://api.deepseek.com/v1/models', headers: { authorization: 'Bearer sk-1' } })
    expect(remoteModelListRequest({ baseUrl: 'https://api.openai.com/v1/', api: 'openai-responses', apiKey: 'fixture-responses-key' }))
      .toEqual({ url: 'https://api.openai.com/v1/models', headers: { authorization: 'Bearer fixture-responses-key' } })
    expect(remoteModelListRequest({ baseUrl: 'https://api.anthropic.com', api: 'anthropic-messages', apiKey: 'k' }).url).toBe('https://api.anthropic.com/v1/models?limit=1000')
    expect(remoteModelListRequest({ baseUrl: 'https://generativelanguage.googleapis.com/v1beta', api: 'google-generative-ai', apiKey: 'g' }).headers).toEqual({ 'x-goog-api-key': 'g' })
    // Local servers need no key.
    expect(remoteModelListRequest({ baseUrl: 'http://localhost:11434/v1', api: 'openai-completions' }).headers).toEqual({})
    expect(() => remoteModelListRequest({ baseUrl: 'file:///etc/passwd', api: 'openai-completions' })).toThrow()
  })

  it.each([
    'google-vertex',
    'bedrock-converse-stream',
    'openai-codex-responses',
    'azure-openai-responses',
    'mistral-conversations',
    'extension-custom-api',
  ])('rejects unsupported %s listing before making a network request', async (api) => {
    const fetchImpl = vi.fn(async () => new Response('{"data":[]}'))
    await expect(listRemoteModels({ baseUrl: 'https://api.example.test', api, apiKey: 'fixture-key' }, fetchImpl))
      .rejects.toMatchObject({
        code: 'MODELS_LIST_UNSUPPORTED_API',
        message: 'Model listing is not supported for this API protocol. Enter model IDs manually.',
      })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('reads keys the way Pi does, without running key commands', () => {
    expect(resolveListKey('$MY_KEY', { MY_KEY: 'from-env' })).toBe('from-env')
    expect(resolveListKey('${MY_KEY}', { MY_KEY: 'braced' })).toBe('braced')
    expect(resolveListKey('!security find-generic-password -w x', {})).toBeUndefined()
    expect(resolveListKey(' literal ', {})).toBe('literal')
  })

  it('understands OpenAI, Anthropic and Gemini list shapes', () => {
    expect(parseRemoteModelList({ object: 'list', data: [{ id: 'deepseek-chat' }, { id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }] }).models)
      .toEqual([{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }])
    expect(parseRemoteModelList({ data: [{ id: 'claude-sonnet-5', display_name: 'Claude Sonnet 5' }] }).models).toEqual([{ id: 'claude-sonnet-5', name: 'Claude Sonnet 5' }])
    expect(parseRemoteModelList({ models: [
      { name: 'models/gemini-3-pro', displayName: 'Gemini 3 Pro', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/text-embedding-005', supportedGenerationMethods: ['embedContent'] },
    ] }).models).toEqual([{ id: 'gemini-3-pro', name: 'Gemini 3 Pro' }])
    expect(() => parseRemoteModelList({ error: 'nope' })).toThrow('did not return a model list')
  })

  it('reports HTTP failures by status so a wrong key is recognizable', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"error":"bad key"}', { status: 401 }))
    await expect(listRemoteModels({ baseUrl: 'https://api.example.com/v1', api: 'openai-completions', apiKey: 'x' }, fetchImpl))
      .rejects.toMatchObject({ code: 'MODELS_LIST_HTTP', message: 'HTTP 401' })
    const ok = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'm1' }] })))
    await expect(listRemoteModels({ baseUrl: 'https://api.example.com/v1', api: 'openai-completions' }, ok)).resolves.toEqual({ models: [{ id: 'm1' }] })
  })
})
