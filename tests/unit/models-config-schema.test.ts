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
  definitionFromEditor,
  editorFromDefinition,
  editorIssues,
  fillFromDetails,
  maskSecrets,
  MASKED_SECRET,
  restoreSecrets,
  rowsFromModels,
  uniqueProviderId,
  withField,
} from '../../src/components/settings/models/provider-editor-model'

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
    const editor = editorFromDefinition('acme', rawModelsProviderDefinition(DOCUMENT, 'acme')!)
    const renamed = { ...editor, provider: withField(editor.provider, 'name', 'Acme Gateway v2') }
    const next = upsertModelsProvider(DOCUMENT, 'acme', definitionFromEditor(renamed))

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
    const editor = editorFromDefinition('newco', { name: 'New Co', baseUrl: 'https://newco.example/v1', api: 'openai-completions', apiKey: 'sk-new', models: [] })
    editor.models = rowsFromModels([{ id: 'newco-1' }])
    const next = upsertModelsProvider(DOCUMENT, 'newco', definitionFromEditor(editor))
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
    const editor = editorFromDefinition('plain', rawModelsProviderDefinition(crlf, 'plain')!)
    editor.models = editor.models.map((row) => ({ ...row, raw: withField(row.raw, 'contextWindow', 32000) }))
    const next = upsertModelsProvider(crlf, 'plain', definitionFromEditor(editor))
    const reparsed = parseModelsConfigDocument(next)

    expect(reparsed.valid).toBe(true)
    expect(next).not.toContain('\r\n\n')
    expect(reparsed.providers[1]!.models[0]!.contextWindow).toBe(32000)
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

describe('provider editor model', () => {
  it('keeps every field it does not show, and a definition without models stays without', () => {
    const raw = rawModelsProviderDefinition(DOCUMENT, 'acme')!
    expect(definitionFromEditor(editorFromDefinition('acme', raw))).toEqual(raw)
    expect(definitionFromEditor(editorFromDefinition('override', { baseUrl: 'https://proxy.example' }))).toEqual({ baseUrl: 'https://proxy.example' })
  })

  it('marks the default model row and keeps row keys across JSON edits', () => {
    const editor = editorFromDefinition('acme', rawModelsProviderDefinition(DOCUMENT, 'acme')!, 'acme-mini')
    expect(editor.models.find((row) => row.key === editor.defaultKey)?.raw.id).toBe('acme-mini')
    const rows = rowsFromModels([{ id: 'acme-mini' }, { id: 'acme-new' }], editor.models)
    expect(rows[0]!.key).toBe(editor.models[1]!.key)
    expect(rows[0]!.originalId).toBe('acme-mini')
    expect(rows[1]!.originalId).toBeNull()
  })

  it('masks literal keys and secret headers in the JSON view, and restores them when left masked', () => {
    const definition = {
      apiKey: 'sk-live', headers: { Authorization: 'Bearer abc', 'X-Tenant': 'blue', 'X-Api-Key': '$TENANT_KEY' },
      models: [{ id: 'm', headers: { 'x-token': 'tok' } }],
    }
    const masked = maskSecrets(definition)
    expect(JSON.stringify(masked)).not.toMatch(/sk-live|Bearer abc|"tok"/u)
    expect(masked.headers).toEqual({ Authorization: MASKED_SECRET, 'X-Tenant': 'blue', 'X-Api-Key': '$TENANT_KEY' })
    expect(maskSecrets({ apiKey: '!security find-generic-password -w' }).apiKey).toBe('!security find-generic-password -w')

    expect(restoreSecrets(masked, definition)).toEqual(definition)
    expect(restoreSecrets({ ...masked, apiKey: 'sk-new' }, definition).apiKey).toBe('sk-new')
  })

  it('reports a missing address, a taken ID and duplicate model IDs', () => {
    const editor = editorFromDefinition('Acme', { models: [{ id: 'a' }, { id: 'a' }, { id: ' ' }] })
    const issues = editorIssues(editor, ['acme'])
    expect(issues.id).toBe('taken')
    expect(issues.baseUrl).toBe('required')
    expect(Object.values(issues.models)).toEqual(['duplicate', 'required'])
    expect(editorIssues({ ...editor, provider: { baseUrl: 'not a url' } }, []).baseUrl).toBe('invalid')
  })

  it('fills only what a model does not say yet', () => {
    const details = { name: 'Big Model', reasoning: true, input: ['text', 'image'] as ('text' | 'image')[], contextWindow: 200000, maxTokens: 8192, cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 } }
    expect(fillFromDetails({ id: 'big', contextWindow: 1000 }, details)).toEqual({
      id: 'big', name: 'Big Model', reasoning: true, input: ['text', 'image'], contextWindow: 1000, maxTokens: 8192, cost: details.cost,
    })
    expect(fillFromDetails({ id: 'big' }, null, 'Remote Name')).toEqual({ id: 'big', name: 'Remote Name' })
  })

  it('suggests provider IDs nobody uses', () => {
    expect(uniqueProviderId('SiliconFlow', ['siliconflow', 'siliconflow-2'])).toBe('siliconflow-3')
    expect(uniqueProviderId('  ', [])).toBe('custom')
  })
})
