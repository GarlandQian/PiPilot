import { z } from 'zod'

/*
 * Pi's built-in model catalog (the models it knows for each provider), used to
 * fill in what a model can do when the user adds it by ID to their own
 * endpoint: name, reasoning, image input, context and output limits, and —
 * only from the model's own provider — price.
 */

export const MODEL_CATALOG_LIMIT = 5_000
export const MODEL_CATALOG_LOOKUP_LIMIT = 500

const identifierSchema = z.string().min(1).max(256)
const tokenCountSchema = z.number().int().positive().max(1_000_000_000)
const priceSchema = z.number().nonnegative().max(1_000_000)

export const modelCatalogCostSchema = z.object({
  input: priceSchema,
  output: priceSchema,
  cacheRead: priceSchema,
  cacheWrite: priceSchema,
}).strict()

export const modelCatalogEntrySchema = z.object({
  provider: identifierSchema,
  id: identifierSchema,
  name: z.string().min(1).max(256).optional(),
  baseUrl: z.string().max(2_048).optional(),
  reasoning: z.boolean(),
  input: z.array(z.enum(['text', 'image'])).max(2),
  contextWindow: tokenCountSchema.optional(),
  maxTokens: tokenCountSchema.optional(),
  cost: modelCatalogCostSchema.optional(),
}).strict()

export type ModelCatalogEntry = z.infer<typeof modelCatalogEntrySchema>

export const modelCatalogDetailsSchema = z.object({
  name: z.string().min(1).max(256).optional(),
  reasoning: z.boolean(),
  input: z.array(z.enum(['text', 'image'])).max(2),
  contextWindow: tokenCountSchema.optional(),
  maxTokens: tokenCountSchema.optional(),
  cost: modelCatalogCostSchema.optional(),
}).strict()

export type ModelCatalogDetails = z.infer<typeof modelCatalogDetailsSchema>

export const modelCatalogLookupResultSchema = z.object({
  models: z.array(z.object({
    id: identifierSchema,
    details: modelCatalogDetailsSchema.nullable(),
  }).strict()).max(MODEL_CATALOG_LOOKUP_LIMIT),
}).strict()

export type ModelCatalogLookupResult = z.infer<typeof modelCatalogLookupResultSchema>

/** The models of one of Pi's own providers. */
export const providerCatalogResultSchema = z.object({
  models: z.array(modelCatalogEntrySchema).max(2_000),
}).strict()

export type ProviderCatalogResult = z.infer<typeof providerCatalogResultSchema>

function hostOf(url: string | undefined) {
  if (!url) return ''
  try {
    return new URL(url.trim()).hostname.toLowerCase().replace(/^www\./u, '')
  } catch {
    return ''
  }
}

/** "anthropic/claude-x" (an aggregator's route) → vendor "anthropic", model "claude-x". */
function splitRoute(modelId: string) {
  const id = modelId.replace(/^~/u, '')
  const slash = id.lastIndexOf('/')
  return slash < 0 ? { vendor: undefined, model: id } : { vendor: id.slice(0, slash).split('/')[0]!.toLowerCase(), model: id.slice(slash + 1) }
}

/** The company that makes a model, recognised by how its IDs start. */
const VENDOR_PREFIXES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^claude/iu, 'anthropic'],
  [/^(gpt|o\d|chatgpt|codex)/iu, 'openai'],
  [/^(gemini|gemma)/iu, 'google'],
  [/^deepseek/iu, 'deepseek'],
  [/^grok/iu, 'xai'],
  [/^(mistral|codestral|magistral|devstral|ministral|pixtral)/iu, 'mistral'],
  [/^(kimi|moonshot)/iu, 'moonshotai'],
  [/^glm/iu, 'zai'],
  [/^minimax/iu, 'minimax'],
  [/^(mimo|xiaomi)/iu, 'xiaomi'],
  [/^llama/iu, 'meta'],
  [/^(qwen|qwq)/iu, 'alibaba'],
  [/^(doubao|seed)/iu, 'volcengine'],
  [/^step/iu, 'stepfun'],
]

function vendorOf(model: string) {
  return VENDOR_PREFIXES.find(([pattern]) => pattern.test(model))?.[1]
}

export interface ModelCatalogMatch {
  entry: ModelCatalogEntry
  /** The endpoint is this model's own provider, so its price applies. */
  official: boolean
}

/**
 * The catalog entry for a model added to an endpoint: the endpoint's own
 * provider first (same host and ID), then the model's maker, then any entry
 * with that ID. Only the first is "official".
 */
export function matchCatalogModel(catalog: readonly ModelCatalogEntry[], baseUrl: string, modelId: string): ModelCatalogMatch | null {
  const host = hostOf(baseUrl)
  const exact = catalog.filter((entry) => entry.id === modelId)
  const own = host ? exact.find((entry) => hostOf(entry.baseUrl) === host) : undefined
  if (own) return { entry: own, official: true }
  const { vendor, model } = splitRoute(modelId)
  const candidates = model === modelId ? exact : [...exact, ...catalog.filter((entry) => entry.id === model)]
  if (!candidates.length) return null
  const maker = vendor ?? vendorOf(model)
  return { entry: (maker ? candidates.find((entry) => entry.provider === maker) : undefined) ?? candidates[0]!, official: false }
}

export function catalogModelDetails({ entry, official }: ModelCatalogMatch): ModelCatalogDetails {
  return {
    ...(entry.name ? { name: entry.name } : {}),
    reasoning: entry.reasoning,
    input: entry.input.length ? entry.input : ['text'],
    ...(entry.contextWindow ? { contextWindow: entry.contextWindow } : {}),
    ...(entry.maxTokens ? { maxTokens: entry.maxTokens } : {}),
    ...(official && entry.cost ? { cost: entry.cost } : {}),
  }
}

/*
 * models.dev (https://models.dev/api.json): an open database of far more
 * providers and models than Pi ships, compacted to what adding a model uses.
 */

export interface ModelsDevEntry {
  name?: string
  reasoning?: boolean
  input?: ('text' | 'image')[]
  contextWindow?: number
  maxTokens?: number
  cost?: ModelCatalogDetails['cost']
  /** "maker/model": the maker's own entry for a resold model. */
  canonical?: string
}

export interface ModelsDevProvider {
  id: string
  /** The provider's API base URL, by which an endpoint is recognised. */
  api?: string
  models: Record<string, ModelsDevEntry>
}

export interface ModelsDevIndex {
  providers: ModelsDevProvider[]
}

const positive = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : undefined
const price = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined

/** The parts of models.dev's api.json that filling in a model needs. */
export function compactModelsDev(raw: unknown): ModelsDevIndex {
  const providers: ModelsDevProvider[] = []
  if (!raw || typeof raw !== 'object') return { providers }
  for (const [providerId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue
    const provider = value as { api?: unknown; models?: unknown }
    const models: Record<string, ModelsDevEntry> = {}
    for (const [modelId, model] of Object.entries((provider.models && typeof provider.models === 'object' ? provider.models : {}) as Record<string, unknown>)) {
      if (!model || typeof model !== 'object') continue
      const entry = model as { name?: unknown; reasoning?: unknown; modalities?: { input?: unknown }; limit?: { context?: unknown; output?: unknown }; cost?: Record<string, unknown>; canonical_model_id?: unknown }
      const input = Array.isArray(entry.modalities?.input) ? entry.modalities.input : undefined
      const costInput = price(entry.cost?.input), costOutput = price(entry.cost?.output)
      models[modelId] = {
        ...(typeof entry.name === 'string' && entry.name ? { name: entry.name.slice(0, 256) } : {}),
        ...(typeof entry.reasoning === 'boolean' ? { reasoning: entry.reasoning } : {}),
        ...(input ? { input: input.includes('image') ? ['text', 'image'] : ['text'] } : {}),
        ...(positive(entry.limit?.context) ? { contextWindow: positive(entry.limit?.context) } : {}),
        ...(positive(entry.limit?.output) ? { maxTokens: positive(entry.limit?.output) } : {}),
        ...(costInput !== undefined && costOutput !== undefined ? { cost: {
          input: costInput, output: costOutput, cacheRead: price(entry.cost?.cache_read) ?? 0, cacheWrite: price(entry.cost?.cache_write) ?? 0,
        } } : {}),
        ...(typeof entry.canonical_model_id === 'string' && entry.canonical_model_id.includes('/') ? { canonical: entry.canonical_model_id } : {}),
      }
    }
    providers.push({ id: providerId, ...(typeof provider.api === 'string' ? { api: provider.api } : {}), models })
  }
  return { providers }
}

/**
 * One endpoint, however it is written: host and path without a trailing
 * version ("v1", "v4", "v1beta") or request path ("chat/completions",
 * "responses", "messages"). Other path segments matter: different plans of one
 * company share a host (api.z.ai/api/paas/v4 vs /api/coding/paas/v4).
 */
export function endpointKey(url: string | undefined) {
  if (!url?.trim()) return ''
  let parsed: URL
  try {
    parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//iu.test(url.trim()) ? url.trim() : `https://${url.trim()}`)
  } catch {
    return ''
  }
  const segments = parsed.pathname.split('/').filter(Boolean).map((segment) => segment.toLowerCase())
  for (;;) {
    const last = segments[segments.length - 1]
    if (last === 'completions' && segments[segments.length - 2] === 'chat') segments.splice(-2, 2)
    else if (last === 'responses' || last === 'messages') segments.pop()
    else if (last && /^v\d+(?:(?:alpha|beta)\d*)?$/u.test(last)) segments.pop()
    else break
  }
  return [parsed.host.toLowerCase().replace(/^www\./u, ''), ...segments].join('/')
}

function devEntry(provider: ModelsDevProvider | undefined, modelId: string) {
  if (!provider) return undefined
  if (provider.models[modelId]) return provider.models[modelId]
  const lowered = modelId.toLowerCase()
  const key = Object.keys(provider.models).find((candidate) => candidate.toLowerCase() === lowered)
  return key ? provider.models[key] : undefined
}

/** models.dev's provider IDs for the makers recognised by model ID. */
const DEV_MAKERS: Readonly<Record<string, string>> = { zai: 'zhipuai', moonshotai: 'moonshotai', xiaomi: 'xiaomi' }

/**
 * What a model can do, field by field from four sources (the first that
 * knows wins): Pi's entry for the endpoint's own provider, models.dev's
 * provider recognised by the endpoint, Pi's entry for the model's maker, and
 * models.dev's maker entry. A price comes only from the first two: a resale
 * price is not the maker's.
 */
export function resolveModelDetails(catalog: readonly ModelCatalogEntry[], modelsDev: ModelsDevIndex | null, baseUrl: string, modelId: string): ModelCatalogDetails | null {
  const pi = matchCatalogModel(catalog, baseUrl, modelId)
  const key = endpointKey(baseUrl)
  const devProvider = key ? modelsDev?.providers.find((provider) => endpointKey(provider.api) === key) : undefined
  const { vendor, model } = splitRoute(modelId)
  const devOwn = devEntry(devProvider, modelId) ?? (model !== modelId ? devEntry(devProvider, model) : undefined)
  let devMaker: ModelsDevEntry | undefined
  if (modelsDev) {
    const canonical = devOwn?.canonical?.split('/')
    const maker = canonical?.[0] ?? vendor ?? vendorOf(model)
    const makerModel = canonical ? canonical.slice(1).join('/') : model
    if (maker) devMaker = devEntry(modelsDev.providers.find((provider) => provider.id === (DEV_MAKERS[maker] ?? maker)), makerModel)
  }
  const sources: Array<{ entry: ModelCatalogEntry | ModelsDevEntry; priced: boolean }> = []
  if (pi?.official) sources.push({ entry: pi.entry, priced: true })
  if (devOwn) sources.push({ entry: devOwn, priced: true })
  if (pi && !pi.official) sources.push({ entry: pi.entry, priced: false })
  if (devMaker && devMaker !== devOwn) sources.push({ entry: devMaker, priced: false })
  if (!sources.length) return null
  const first = <T>(read: (entry: ModelCatalogEntry | ModelsDevEntry, priced: boolean) => T | undefined) => {
    for (const { entry, priced } of sources) {
      const value = read(entry, priced)
      if (value !== undefined) return value
    }
    return undefined
  }
  const name = first((entry) => entry.name)
  const contextWindow = first((entry) => entry.contextWindow)
  const maxTokens = first((entry) => entry.maxTokens)
  const input = first((entry) => entry.input?.length ? entry.input : undefined)
  const cost = first((entry, priced) => priced ? entry.cost : undefined)
  return {
    ...(name ? { name } : {}),
    reasoning: first((entry) => entry.reasoning) ?? false,
    input: input ?? ['text'],
    ...(contextWindow ? { contextWindow } : {}),
    ...(maxTokens ? { maxTokens } : {}),
    ...(cost ? { cost } : {}),
  }
}

export function lookupCatalogModels(catalog: readonly ModelCatalogEntry[], baseUrl: string, ids: readonly string[], modelsDev: ModelsDevIndex | null = null): ModelCatalogLookupResult {
  return {
    models: [...new Set(ids)].slice(0, MODEL_CATALOG_LOOKUP_LIMIT).map((id) => ({ id, details: resolveModelDetails(catalog, modelsDev, baseUrl, id) })),
  }
}
