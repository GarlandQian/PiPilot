import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ModelsFormField } from '../../src/components/settings/ModelsFormFields'
import { searchModelProviders } from '../../src/components/settings/models-catalog-model'
import { currentModelTest, modelTestSuccess, settleModelTest, type ModelTestStates } from '../../src/components/settings/models-test-state'
import { parseModelsConfigDocument } from '../../src/shared/models-config-schema'

const providers = parseModelsConfigDocument(JSON.stringify({ providers: {
  acme: {
    name: 'Acme Gateway', api: 'openai-completions', baseUrl: 'https://acme.example/v1',
    apiKey: 'never-search-this-key', headers: { Authorization: 'never-search-this-header' },
    compat: { futureField: 'never-search-raw-config' },
    models: [{ id: 'fast', name: 'Quick Model' }, { id: 'reasoning', name: 'Research Model' }],
  },
  studio: { models: [{ id: 'vision', name: 'Image Model' }] },
} })).providers

describe('models provider workspace search', () => {
  it.each([
    ['', [['acme', ['fast', 'reasoning']], ['studio', ['vision']]]],
    [' ACME ', [['acme', ['fast', 'reasoning']]]],
    ['ACME QUICK', [['acme', ['fast']]]],
    ['openai research', [['acme', ['reasoning']]]],
    ['example/v1', [['acme', ['fast', 'reasoning']]]],
    ['image', [['studio', ['vision']]]],
    ['missing', []],
    ['never-search-this-key', []],
    ['never-search-this-header', []],
    ['never-search-raw-config', []],
  ])('filters only public identities for %j', (query, expected) => {
    expect(searchModelProviders(providers, query).map(({ provider, models }) =>
      [provider.id, models.map((model) => model.id)])).toEqual(expected)
  })

  it('keeps provider and model identities intact', () => {
    const [match] = searchModelProviders(providers, 'acme quick')
    expect(match?.provider).toBe(providers[0])
    expect(match?.models[0]).toBe(providers[0]?.models[0])
    expect(providers[0]?.models).toHaveLength(2)
    expect(providers[0]?.compat).toEqual({ futureField: 'never-search-raw-config' })
  })
})

describe('model test ownership', () => {
  const key = '["acme","fast"]'
  const otherKey = '["studio","vision"]'
  const identity = { requestId: 1, revision: 3 }
  const initial: ModelTestStates = {
    [key]: { state: 'testing', ...identity },
    [otherKey]: { state: 'testing', requestId: 2, revision: 3 },
  }
  const success = modelTestSuccess({ providerId: 'acme', modelId: 'fast', latencyMs: 16, responsePreview: '**Ready**' })

  it('shows a completed result only for the draft that was tested', () => {
    const settled = settleModelTest(initial, key, identity, 3, success)
    expect(currentModelTest(settled, key, 3)).toEqual({ ...identity, ...success })
    expect(currentModelTest(settled, key, 4)).toBeUndefined()
    expect(settled[otherKey]).toBe(initial[otherKey])
  })

  it('clears an outdated completion without affecting another model', () => {
    const settled = settleModelTest(initial, key, identity, 4, success)
    expect(settled[key]).toBeUndefined()
    expect(settled[otherKey]).toBe(initial[otherKey])
  })

  it('does not let an old request remove or overwrite a newer test of the same model', () => {
    const newer: ModelTestStates = { ...initial, [key]: { state: 'testing', requestId: 3, revision: 4 } }
    expect(settleModelTest(newer, key, identity, 4, success)).toBe(newer)
    expect(settleModelTest(newer, key, identity, 3, { state: 'error', message: 'Old error' })).toBe(newer)
  })

  it('preserves an authoritative error for its own request', () => {
    const failure = { state: 'error' as const, message: 'Connection refused' }
    expect(settleModelTest(initial, key, identity, 3, failure)[key]).toEqual({ ...identity, ...failure })
  })
})

describe('model form feedback', () => {
  it('gives single-field errors a stable element for aria-describedby', () => {
    const markup = renderToStaticMarkup(createElement(ModelsFormField, {
      label: 'Provider ID', htmlFor: 'provider-id', error: 'Required',
      children: createElement('input', { id: 'provider-id', 'aria-describedby': 'provider-id-feedback' }),
    }))
    expect(markup).toContain('for="provider-id"')
    expect(markup).toContain('id="provider-id-feedback"')
    expect(markup).toContain('role="alert"')
  })

  it('supports shared feedback for a field group without a fake label association', () => {
    const markup = renderToStaticMarkup(createElement(ModelsFormField, {
      label: 'Pricing', feedbackId: 'cost-error', error: 'Complete every price',
      children: createElement('input', { 'aria-label': 'Input price', 'aria-describedby': 'cost-error' }),
    }))
    expect(markup).toContain('id="cost-error"')
    expect(markup).toContain('aria-describedby="cost-error"')
  })
})
