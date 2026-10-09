import { describe, expect, it } from 'vitest'
import { customEndpointApiOptions, providerApiProfile } from '../../src/components/settings/models/provider-api-profiles'
import { definitionFromEditor, editorFromDefinition, withField } from '../../src/components/settings/models/provider-editor-model'

describe('custom provider protocol capabilities', () => {
  it('offers standard Responses and key-capable cloud adapters without presenting legacy Codex as a new key endpoint', () => {
    expect(customEndpointApiOptions('')).toEqual(expect.arrayContaining([
      'openai-responses', 'google-vertex', 'azure-openai-responses', 'bedrock-converse-stream',
    ]))
    expect(customEndpointApiOptions('')).not.toContain('openai-codex-responses')
    expect(providerApiProfile('openai-responses')).toMatchObject({ credential: 'apiKey', listModels: true })
  })

  it.each(['openai-codex-responses', 'company-extension-api'])('keeps existing %s selectable and preserves its advanced configuration while editing', (api) => {
    const definition = {
      api, baseUrl: 'https://custom.example/backend', apiKey: '$CUSTOM_CREDENTIAL',
      oauth: { clientId: 'extension-client' }, headers: { 'X-Account': 'fixture' },
      models: [{ id: 'custom-model', api, extensionOption: true }],
    }
    const editor = editorFromDefinition('custom', definition)
    const changed = { ...editor, provider: withField(editor.provider, 'name', 'Renamed') }
    expect(customEndpointApiOptions(api).filter((option) => option === api)).toHaveLength(1)
    expect(definitionFromEditor(changed)).toEqual({ ...definition, name: 'Renamed' })
    expect(providerApiProfile(api)).toMatchObject({ listModels: false, localKey: false })
  })

  it('does not invent a local API key or a /models request for inherited or environment-authenticated adapters', () => {
    for (const api of ['google-vertex', 'bedrock-converse-stream', 'azure-openai-responses']) {
      expect(providerApiProfile(api)).toMatchObject({ listModels: false, localKey: false })
    }
    expect(providerApiProfile('', 'openai')).toMatchObject({ kind: 'inherited', listModels: false, localKey: false })
    expect(providerApiProfile('', 'openai-codex')).toMatchObject({ kind: 'codex', credential: 'oauthToken', listModels: false, localKey: false })
    expect(providerApiProfile('')).toMatchObject({ kind: 'openai', credential: 'apiKey', listModels: true, localKey: true })
  })
})
