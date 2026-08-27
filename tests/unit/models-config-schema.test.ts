import { describe, expect, it } from 'vitest'
import {
  structuredDocumentSupported,
  structuredModelSupported,
  structuredProviderSupported,
} from '../../src/shared/models-config'
import {
  parseModelsConfigDocument,
  rawModelsProviderDefinition,
  removeModelsProvider,
  renameModelsProvider,
  upsertModelsProvider,
} from '../../src/shared/models-config-schema'
import {
  costFieldValid,
  costGroupComplete,
  definitionFromFormValues,
  duplicateModelId,
  duplicateProviderId,
  tokenFieldValid,
  type ModelFormValue,
  type ProviderFormValue,
} from '../../src/components/settings/models-form-model'

const DOCUMENT = `{
  // Custom gateway provider.
  "providers": {
    "acme": {
      "name": "Acme Gateway",
      "baseUrl": "https://api.acme.example/v1",
      "api": "openai-completions",
      "apiKey": "sk-secret-1",
      "headers": { "X-Tenant": "blue" },
      "compat": { "supportsStore": false },
      "models": [
        {
          "id": "acme-pro",
          "name": "Acme Pro",
          "reasoning": true,
          "input": ["text", "image"],
          "contextWindow": 200000,
          "maxTokens": 8192,
          "cost": {
            "input": 2,
            "output": 6,
            "cacheRead": 0.3,
            "cacheWrite": 0,
            "tiers": [{ "inputTokensAbove": 128000, "input": 4 }]
          },
          "thinkingLevelMap": { "low": "low", "high": "high" }
        },
        { "id": "acme-mini", "contextWindow": 64000, "maxTokens": 4096 }
      ]
    },
    "plain": {
      "baseUrl": "https://plain.example/v1",
      "models": [{ "id": "plain-1" }]
    }
  }
}`

function providerForm(overrides: Partial<ProviderFormValue> = {}): ProviderFormValue {
  return {
    id: 'acme',
    name: 'Acme Gateway',
    baseUrl: 'https://api.acme.example/v1',
    api: 'openai-completions',
    apiKeyDraft: '',
    clearKey: false,
    headers: [{ key: 'X-Tenant', value: 'blue' }],
    ...overrides,
  }
}

function modelForm(overrides: Partial<ModelFormValue> = {}): ModelFormValue {
  return {
    id: 'acme-pro',
    name: 'Acme Pro',
    reasoning: true,
    inputText: true,
    inputImage: true,
    contextWindow: '200000',
    maxTokens: '8192',
    costInput: '2',
    costOutput: '6',
    costCacheRead: '0.3',
    costCacheWrite: '0',
    ...overrides,
  }
}

describe('parseModelsConfigDocument', () => {
  it('parses a documented JSONC fixture with comments into providers', () => {
    const document = parseModelsConfigDocument(DOCUMENT)

    expect(document.valid).toBe(true)
    expect(document.diagnostics).toEqual([])
    expect(document.providers.map((provider) => provider.id)).toEqual(['acme', 'plain'])

    const acme = document.providers[0]!
    expect(acme.hasApiKey).toBe(true)
    expect(acme).not.toHaveProperty('apiKey')
    expect(acme.models).toHaveLength(2)
    expect(acme.models[0]!.cost?.tiers).toBeDefined()
    expect(acme.models[0]!.thinkingLevelMap).toBeDefined()
    expect(acme.compat).toBeDefined()
  })

  it('flags providers without an apiKey with hasApiKey=false', () => {
    const document = parseModelsConfigDocument(DOCUMENT)
    expect(document.providers[1]!.hasApiKey).toBe(false)
  })

  it('reports invalid JSON with exact line and column diagnostics', () => {
    const text = '{\n  "providers": {\n    "a": {,}\n  }\n}'
    const document = parseModelsConfigDocument(text)

    expect(document.valid).toBe(false)
    expect(document.diagnostics.length).toBeGreaterThan(0)
    const first = document.diagnostics[0]!
    expect(first.line).toBe(3)
    expect(first.column).toBeGreaterThan(5)
    expect(first.offset).toBeGreaterThan(0)
  })

  it('reports duplicate object keys as diagnostics', () => {
    const text = '{ "providers": { "a": {}, "a": {} } }'
    const document = parseModelsConfigDocument(text)

    expect(document.valid).toBe(false)
    expect(document.diagnostics.some((entry) => entry.code === 'MODELS_DUPLICATE_KEY')).toBe(true)
  })

  it('rejects a non-object root', () => {
    const document = parseModelsConfigDocument('[1, 2]')
    expect(document.valid).toBe(false)
    expect(document.providers).toEqual([])
  })
})

describe('structured gates', () => {
  it('marks a provider with JSON-only passthrough fields as unsupported', () => {
    const document = parseModelsConfigDocument(DOCUMENT)
    const acme = document.providers[0]!

    expect(structuredModelSupported(acme.models[0]!)).toBe(false) // thinkingLevelMap + tiers
    expect(structuredProviderSupported(acme)).toBe(false)
    expect(structuredDocumentSupported(document)).toBe(false)
  })

  it('marks a plain provider as supported', () => {
    const document = parseModelsConfigDocument(DOCUMENT)
    const plain = document.providers[1]!

    expect(structuredProviderSupported(plain)).toBe(true)
  })

  it('rejects providers with non-string header values', () => {
    const document = parseModelsConfigDocument(
      '{ "providers": { "a": { "headers": { "X": 1 }, "models": [] } } }',
    )
    expect(structuredProviderSupported(document.providers[0]!)).toBe(false)
  })
})

describe('upsertModelsProvider', () => {
  it('applies minimal edits: comments and untouched providers survive byte-for-byte', () => {
    const existing = rawModelsProviderDefinition(DOCUMENT, 'acme')!
    const definition = definitionFromFormValues(
      providerForm({ name: 'Acme Gateway v2' }),
      [
        modelForm(),
        modelForm({
          id: 'acme-mini',
          name: '',
          reasoning: false,
          inputText: true,
          inputImage: false,
          contextWindow: '64000',
          maxTokens: '4096',
          costInput: '',
          costOutput: '',
          costCacheRead: '',
          costCacheWrite: '',
        }),
      ],
      existing,
    )
    const next = upsertModelsProvider(DOCUMENT, 'acme', definition)

    expect(next).toContain('"Acme Gateway v2"')
    expect(next).toContain('// Custom gateway provider.')
    expect(next).toContain('"thinkingLevelMap"')
    expect(next).toContain('"tiers"')
    expect(next).toContain('"apiKey": "sk-secret-1"')
    expect(next).toContain('"plain"')

    const reparsed = parseModelsConfigDocument(next)
    expect(reparsed.valid).toBe(true)
    expect(reparsed.providers).toHaveLength(2)
    expect(reparsed.providers[0]!.models[0]!.thinkingLevelMap).toBeDefined()
    expect(reparsed.providers[0]!.models[0]!.cost?.tiers).toBeDefined()
  })

  it('adds a new provider without disturbing existing content', () => {
    const definition = definitionFromFormValues(
      providerForm({
        id: 'newco',
        name: 'New Co',
        baseUrl: 'https://newco.example/v1',
        apiKeyDraft: 'sk-new',
        headers: [],
      }),
      [modelForm({ id: 'newco-1', costInput: '', costOutput: '', costCacheRead: '', costCacheWrite: '' })],
      undefined,
    )
    const next = upsertModelsProvider(DOCUMENT, 'newco', definition)
    const reparsed = parseModelsConfigDocument(next)

    expect(reparsed.valid).toBe(true)
    expect(reparsed.providers.map((provider) => provider.id)).toEqual(['acme', 'plain', 'newco'])
    expect(next).toContain('// Custom gateway provider.')
    expect(next).toContain('"sk-new"')
  })

  it('throws on invalid JSON instead of editing', () => {
    expect(() => upsertModelsProvider('{ "providers": {,} }', 'x', {})).toThrow()
  })

  it('round-trips CRLF files without line-ending corruption', () => {
    const crlf = DOCUMENT.replace(/\n/g, '\r\n')
    const existing = rawModelsProviderDefinition(crlf, 'plain')!
    const definition = definitionFromFormValues(
      providerForm({ id: 'plain', name: '', baseUrl: 'https://plain.example/v1', api: '', headers: [] }),
      [modelForm({
        id: 'plain-1', name: '', reasoning: false, inputText: true, inputImage: false,
        contextWindow: '', maxTokens: '', costInput: '', costOutput: '', costCacheRead: '', costCacheWrite: '',
      })],
      existing,
    )
    const next = upsertModelsProvider(crlf, 'plain', definition)
    const reparsed = parseModelsConfigDocument(next)

    expect(reparsed.valid).toBe(true)
    expect(next).not.toContain('\r\n\n')
    expect(next).toContain('"plain"')
  })
})

describe('removeModelsProvider and renameModelsProvider', () => {
  it('removes only the targeted provider', () => {
    const next = removeModelsProvider(DOCUMENT, 'plain')
    const reparsed = parseModelsConfigDocument(next)

    expect(reparsed.valid).toBe(true)
    expect(reparsed.providers.map((provider) => provider.id)).toEqual(['acme'])
    expect(next).toContain('// Custom gateway provider.')
  })

  it('renames the provider key without touching its body', () => {
    const next = renameModelsProvider(DOCUMENT, 'plain', 'plain-v2')
    const reparsed = parseModelsConfigDocument(next)

    expect(reparsed.valid).toBe(true)
    expect(reparsed.providers.map((provider) => provider.id)).toEqual(['acme', 'plain-v2'])
    expect(next).toContain('"baseUrl": "https://plain.example/v1"')
  })

  it('rejects a provider rename that collides case-insensitively', () => {
    expect(() => renameModelsProvider(DOCUMENT, 'plain', 'ACME')).toThrow(
      'A provider already uses that id.',
    )
  })
})

describe('definitionFromFormValues apiKey semantics', () => {
  it('keeps the stored key when the draft is blank', () => {
    const existing = rawModelsProviderDefinition(DOCUMENT, 'acme')!
    const definition = definitionFromFormValues(providerForm(), [modelForm()], existing)
    expect(definition.apiKey).toBe('sk-secret-1')
  })

  it('replaces the key when the draft is non-empty', () => {
    const existing = rawModelsProviderDefinition(DOCUMENT, 'acme')!
    const definition = definitionFromFormValues(
      providerForm({ apiKeyDraft: 'sk-replaced' }),
      [modelForm()],
      existing,
    )
    expect(definition.apiKey).toBe('sk-replaced')
  })

  it('removes the key when clearKey is set', () => {
    const existing = rawModelsProviderDefinition(DOCUMENT, 'acme')!
    const definition = definitionFromFormValues(
      providerForm({ clearKey: true }),
      [modelForm()],
      existing,
    )
    expect(definition).not.toHaveProperty('apiKey')
  })

  it('preserves passthrough fields (oauth, compat, unknown) verbatim', () => {
    const existing = rawModelsProviderDefinition(DOCUMENT, 'acme')!
    const definition = definitionFromFormValues(providerForm(), [modelForm()], existing)

    expect(definition.compat).toEqual(existing.compat)
    expect(definition.apiKey).toBe(existing.apiKey)
    const model = (definition.models as Record<string, unknown>[])[0]!
    expect(model.thinkingLevelMap).toBeDefined()
    expect((model.cost as Record<string, unknown>).tiers).toBeDefined()
  })

  it('preserves non-string provider headers while honoring string-row edits', () => {
    const existing = rawModelsProviderDefinition(
      '{ "providers": { "rich": { "headers": { "X-Count": 3, "X-Tenant": "blue" }, "models": [] } } }',
      'rich',
    )!
    const definition = definitionFromFormValues(
      providerForm({ id: 'rich', headers: [{ key: 'X-Tenant', value: 'green' }] }),
      [],
      existing,
    )

    expect(definition.headers).toEqual({ 'X-Count': 3, 'X-Tenant': 'green' })

    const removedStringHeader = definitionFromFormValues(
      providerForm({ id: 'rich', headers: [] }),
      [],
      existing,
    )
    expect(removedStringHeader.headers).toEqual({ 'X-Count': 3 })
  })
})

describe('validation helpers', () => {
  it('detects duplicate provider ids case-insensitively with an exclude option', () => {
    const document = parseModelsConfigDocument(DOCUMENT)

    expect(duplicateProviderId('ACME', document, { caseInsensitive: true })).toBe(true)
    expect(duplicateProviderId('acme', document, { caseInsensitive: true, excludeId: 'acme' })).toBe(false)
    expect(duplicateProviderId('other', document, { caseInsensitive: true })).toBe(false)
  })

  it('detects duplicate model ids within a provider', () => {
    const models = [{ id: 'a' }, { id: 'b' }]
    expect(duplicateModelId('a', models)).toBe(true)
    expect(duplicateModelId('a', models, 'a')).toBe(false)
    expect(duplicateModelId('c', models)).toBe(false)
  })

  it('validates token and cost fields', () => {
    expect(tokenFieldValid('')).toBe(true)
    expect(tokenFieldValid('8192')).toBe(true)
    expect(tokenFieldValid('0')).toBe(false)
    expect(tokenFieldValid('1.5')).toBe(false)
    expect(tokenFieldValid('abc')).toBe(false)

    expect(costFieldValid('')).toBe(true)
    expect(costFieldValid('0')).toBe(true)
    expect(costFieldValid('0.3')).toBe(true)
    expect(costFieldValid('-1')).toBe(false)

    expect(costGroupComplete({ costInput: '1', costOutput: '2', costCacheRead: '0', costCacheWrite: '0' })).toBe(true)
    expect(costGroupComplete({ costInput: '', costOutput: '', costCacheRead: '', costCacheWrite: '' })).toBe(true)
    expect(costGroupComplete({ costInput: '1', costOutput: '', costCacheRead: '', costCacheWrite: '' })).toBe(false)
  })
})
