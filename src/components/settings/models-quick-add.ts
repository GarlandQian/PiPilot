import type { ModelsConfigProvider } from '@/shared/models-config'
import { rawModelsProviderDefinition, upsertModelsProvider } from '@/shared/models-config-schema'
import { definitionFromFormValues, formValueFromModel, formValueFromProvider, type ModelFormValue } from './models-form-model'

/*
 * "Add model" in one step: an endpoint, its key and the model IDs together.
 * The provider entry is derived from the endpoint; nothing else is asked.
 */

/** Pi's built-in providers (pi-ai `KnownProvider`). A models.json entry with
 * one of these IDs would merge into the built-in provider and replace its
 * catalog metadata, so generated IDs avoid them. */
const BUILT_IN_PROVIDER_IDS = new Set([
  'amazon-bedrock', 'ant-ling', 'anthropic', 'google', 'google-vertex', 'openai', 'azure-openai-responses',
  'openai-codex', 'radius', 'typesafe', 'nvidia', 'deepseek', 'github-copilot', 'xai', 'groq', 'cerebras',
  'openrouter', 'vercel-ai-gateway', 'zai', 'zai-coding-cn', 'mistral', 'minimax', 'minimax-cn', 'moonshotai',
  'moonshotai-cn', 'huggingface', 'fireworks', 'together', 'baseten', 'opencode', 'opencode-go', 'kimi-coding',
  'meta', 'cloudflare-workers-ai', 'cloudflare-ai-gateway', 'qwen-token-plan', 'qwen-token-plan-cn',
  'qwen-token-plan-individual', 'xiaomi', 'xiaomi-token-plan-cn', 'xiaomi-token-plan-ams', 'xiaomi-token-plan-sgp',
])

/** Host labels that say nothing about who runs the endpoint. */
const GENERIC_HOST_LABELS = new Set(['api', 'www', 'open', 'openai', 'gateway', 'llm', 'inference', 'v1'])

/** Local servers (Ollama, LM Studio) ignore the key, but Pi lists a model only when its provider has one. */
export const LOCAL_ENDPOINT_KEY = 'local'

export const QUICK_ADD_API_TYPES = ['openai-completions', 'openai-responses', 'anthropic-messages', 'google-generative-ai'] as const

export interface QuickAddValue {
  baseUrl: string
  apiKey: string
  modelIds: readonly string[]
  api: string
  name: string
}

function parseEndpoint(value: string) {
  try {
    const url = new URL(value.trim())
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
  } catch { return null }
}

export function isValidEndpoint(value: string) {
  return parseEndpoint(value) !== null
}

/** Endpoints compare without case in the host, a trailing slash, or a default port. */
export function normalizeEndpoint(value: string | undefined) {
  const url = value ? parseEndpoint(value) : null
  if (!url) return ''
  return `${url.protocol}//${url.host.toLowerCase()}${url.pathname.replace(/\/+$/u, '')}`
}

export function isLocalEndpoint(value: string) {
  const host = parseEndpoint(value)?.hostname.toLowerCase() ?? ''
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1' || host.endsWith('.local')
}

/** An already-added provider on the same endpoint receives the new models. */
export function findProviderForEndpoint(providers: readonly ModelsConfigProvider[], baseUrl: string) {
  const endpoint = normalizeEndpoint(baseUrl)
  return endpoint ? providers.find((provider) => normalizeEndpoint(provider.baseUrl) === endpoint) : undefined
}

/** "api.deepseek.com" → "deepseek-api", "dashscope.aliyuncs.com" → "dashscope", localhost:11434 → "local-11434". */
export function deriveProviderId(baseUrl: string, takenIds: readonly string[]) {
  const url = parseEndpoint(baseUrl)
  let base = 'custom'
  if (url) {
    if (isLocalEndpoint(baseUrl)) base = `local${url.port ? `-${url.port}` : ''}`
    else if (/^\d+(?:\.\d+){3}$/u.test(url.hostname)) base = `host-${url.hostname.replace(/\./gu, '-')}${url.port ? `-${url.port}` : ''}`
    else {
      const labels = url.hostname.toLowerCase().split('.').filter(Boolean)
      const meaningful = labels.slice(0, Math.max(1, labels.length - 1)).filter((label) => !GENERIC_HOST_LABELS.has(label))
      base = (meaningful[0] ?? labels[0] ?? base).replace(/[^a-z0-9-]+/gu, '-').replace(/^-+|-+$/gu, '') || 'custom'
    }
  }
  if (BUILT_IN_PROVIDER_IDS.has(base)) base = `${base}-api`
  const taken = new Set(takenIds.map((id) => id.toLowerCase()))
  let candidate = base
  for (let suffix = 2; taken.has(candidate) || BUILT_IN_PROVIDER_IDS.has(candidate); suffix += 1) candidate = `${base}-${suffix}`
  return candidate
}

/** Model IDs typed or pasted together, separated by spaces, commas or lines. */
export function splitModelIds(text: string) {
  return text.split(/[\s,，、]+/u).map((id) => id.trim()).filter(Boolean)
}

function blankModel(id: string): ModelFormValue {
  return {
    id, name: '', reasoning: false, inputText: true, inputImage: false,
    contextWindow: '', maxTokens: '', costInput: '', costOutput: '', costCacheRead: '', costCacheWrite: '',
  }
}

/** Writes the endpoint and its models into the draft in one edit. */
export function applyQuickAdd(draftText: string, providers: readonly ModelsConfigProvider[], value: QuickAddValue) {
  const ids = [...new Set(value.modelIds.map((id) => id.trim()).filter(Boolean))]
  const existing = findProviderForEndpoint(providers, value.baseUrl)
  if (existing) {
    const known = new Set(existing.models.map((model) => model.id))
    const added = ids.filter((id) => !known.has(id))
    const provider = { ...formValueFromProvider(existing), apiKeyDraft: value.apiKey }
    const models = [...existing.models.map((model) => formValueFromModel(model)), ...added.map(blankModel)]
    const definition = definitionFromFormValues(provider, models, rawModelsProviderDefinition(draftText, existing.id))
    return { text: upsertModelsProvider(draftText, existing.id, definition), providerId: existing.id, merged: true, added }
  }
  const id = deriveProviderId(value.baseUrl, providers.map((provider) => provider.id))
  const apiKey = value.apiKey || (isLocalEndpoint(value.baseUrl) ? LOCAL_ENDPOINT_KEY : '')
  const definition = definitionFromFormValues({
    id, name: value.name.trim(), baseUrl: value.baseUrl.trim().replace(/\/+$/u, ''), api: value.api || QUICK_ADD_API_TYPES[0],
    apiKeyDraft: apiKey, clearKey: false, headers: [],
  }, ids.map(blankModel))
  return { text: upsertModelsProvider(draftText, id, definition), providerId: id, merged: false, added: ids }
}
