import { z } from 'zod'

/*
 * What is known about a model added by ID to the user's own endpoint: name,
 * reasoning, image input, context and output limits, thinking levels and
 * price. models.dev (https://models.dev/api.json) answers first; Pi's built-in
 * catalog answers only for models models.dev does not know, or when it cannot
 * be reached.
 */

export const MODEL_CATALOG_LIMIT = 5_000
export const MODEL_CATALOG_LOOKUP_LIMIT = 500

const identifierSchema = z.string().min(1).max(256)
const tokenCountSchema = z.number().int().positive().max(1_000_000_000)
const priceSchema = z.number().nonnegative().max(1_000_000)

export const CATALOG_THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
export type CatalogThinkingLevel = typeof CATALOG_THINKING_LEVELS[number]
/** Pi's `thinkingLevelMap`: a level's value to send, or null when the model does not offer it. */
export const catalogThinkingLevelMapSchema = z.partialRecord(z.enum(CATALOG_THINKING_LEVELS), z.string().min(1).max(64).nullable())
export type CatalogThinkingLevelMap = z.infer<typeof catalogThinkingLevelMapSchema>

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
  thinkingLevelMap: catalogThinkingLevelMapSchema.optional(),
}).strict()

export type ModelCatalogEntry = z.infer<typeof modelCatalogEntrySchema>

export const modelCatalogDetailsSchema = z.object({
  name: z.string().min(1).max(256).optional(),
  reasoning: z.boolean(),
  input: z.array(z.enum(['text', 'image'])).max(2),
  contextWindow: tokenCountSchema.optional(),
  maxTokens: tokenCountSchema.optional(),
  cost: modelCatalogCostSchema.optional(),
  /**
   * Whose price `cost` is: the endpoint's own provider ("provider"), or the
   * model's maker, listed as a reference for an endpoint that resells it ("maker").
   */
  price: z.object({ by: z.enum(['provider', 'maker']), name: z.string().min(1).max(256).optional() }).strict().optional(),
  thinkingLevelMap: catalogThinkingLevelMapSchema.optional(),
  /** Where the details came from, to say so: the catalog, and whose entry (or the sources' consensus). */
  source: z.object({
    catalog: z.enum(['models.dev', 'pi']),
    basis: z.enum(['provider', 'maker', 'consensus']),
    name: z.string().min(1).max(256).optional(),
  }).strict().optional(),
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

/** How the makers above are written, for saying whose entry or price a model has. */
const MAKER_NAMES: Readonly<Record<string, string>> = {
  anthropic: 'Anthropic', openai: 'OpenAI', google: 'Google', deepseek: 'DeepSeek', xai: 'xAI', mistral: 'Mistral', moonshotai: 'Moonshot AI',
  zai: 'Z.ai', minimax: 'MiniMax', xiaomi: 'Xiaomi', meta: 'Meta', alibaba: 'Alibaba', volcengine: 'Volcengine', stepfun: 'StepFun',
}

function vendorOf(model: string) {
  return VENDOR_PREFIXES.find(([pattern]) => pattern.test(model))?.[1]
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
  thinkingLevelMap?: CatalogThinkingLevelMap
  /** "maker/model": the model this entry is, whoever serves it. */
  canonical?: string
  deprecated?: true
  /** models.dev's `last_updated` (YYYY-MM-DD). */
  updated?: string
}

export interface ModelsDevProvider {
  id: string
  name?: string
  /** The provider's API base URL, by which an endpoint is recognised. */
  api?: string
  models: Record<string, ModelsDevEntry>
}

export interface ModelsDevIndex {
  providers: ModelsDevProvider[]
}

const positive = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : undefined
const price = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined

/**
 * models.dev's `reasoning_options` as Pi's thinking levels: each effort it
 * lists is sent as itself, the others are unavailable. "none" among the
 * efforts turns thinking off; a toggle (or a token budget) lets Pi turn it off
 * its own way; otherwise it cannot be turned off. Without efforts it says
 * nothing about levels, and Pi's defaults stand.
 */
export function thinkingLevelsFromModelsDev(options: unknown): CatalogThinkingLevelMap | undefined {
  if (!Array.isArray(options)) return undefined
  const efforts = new Set<string>()
  let canTurnOff = false
  for (const option of options) {
    if (!option || typeof option !== 'object') continue
    const { type, values } = option as { type?: unknown; values?: unknown }
    if (type === 'toggle' || type === 'budget_tokens') canTurnOff = true
    else if (type === 'effort' && Array.isArray(values)) for (const value of values) if (typeof value === 'string') efforts.add(value)
  }
  const levels = CATALOG_THINKING_LEVELS.filter((level) => level !== 'off')
  if (!levels.some((level) => efforts.has(level))) return undefined
  const map: CatalogThinkingLevelMap = {}
  if (efforts.has('none')) map.off = 'none'
  else if (!canTurnOff) map.off = null
  for (const level of levels) map[level] = efforts.has(level) ? level : null
  return map
}

/** The parts of models.dev's api.json that filling in a model needs. */
export function compactModelsDev(raw: unknown): ModelsDevIndex {
  const providers: ModelsDevProvider[] = []
  if (!raw || typeof raw !== 'object') return { providers }
  for (const [providerId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue
    const provider = value as { name?: unknown; api?: unknown; models?: unknown }
    const models: Record<string, ModelsDevEntry> = {}
    for (const [modelId, model] of Object.entries((provider.models && typeof provider.models === 'object' ? provider.models : {}) as Record<string, unknown>)) {
      if (!model || typeof model !== 'object') continue
      const entry = model as {
        name?: unknown; reasoning?: unknown; reasoning_options?: unknown; modalities?: { input?: unknown }; limit?: { context?: unknown; output?: unknown }
        cost?: Record<string, unknown>; canonical_model_id?: unknown; status?: unknown; last_updated?: unknown
      }
      const input = Array.isArray(entry.modalities?.input) ? entry.modalities.input : undefined
      const costInput = price(entry.cost?.input), costOutput = price(entry.cost?.output)
      const thinkingLevelMap = entry.reasoning === false ? undefined : thinkingLevelsFromModelsDev(entry.reasoning_options)
      models[modelId] = {
        ...(typeof entry.name === 'string' && entry.name ? { name: entry.name.slice(0, 256) } : {}),
        ...(typeof entry.reasoning === 'boolean' ? { reasoning: entry.reasoning } : {}),
        ...(input ? { input: input.includes('image') ? ['text', 'image'] : ['text'] } : {}),
        ...(positive(entry.limit?.context) ? { contextWindow: positive(entry.limit?.context) } : {}),
        ...(positive(entry.limit?.output) ? { maxTokens: positive(entry.limit?.output) } : {}),
        ...(costInput !== undefined && costOutput !== undefined ? { cost: {
          input: costInput, output: costOutput, cacheRead: price(entry.cost?.cache_read) ?? 0, cacheWrite: price(entry.cost?.cache_write) ?? 0,
        } } : {}),
        ...(thinkingLevelMap ? { thinkingLevelMap } : {}),
        ...(typeof entry.canonical_model_id === 'string' && entry.canonical_model_id.includes('/') ? { canonical: entry.canonical_model_id.toLowerCase() } : {}),
        ...(entry.status === 'deprecated' ? { deprecated: true as const } : {}),
        ...(typeof entry.last_updated === 'string' ? { updated: entry.last_updated.slice(0, 32) } : {}),
      }
    }
    providers.push({
      id: providerId,
      ...(typeof provider.name === 'string' && provider.name ? { name: provider.name.slice(0, 256) } : {}),
      ...(typeof provider.api === 'string' ? { api: provider.api } : {}),
      models,
    })
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

/** models.dev's provider IDs for the makers recognised by model ID. */
const DEV_MAKERS: Readonly<Record<string, string>> = { zai: 'zhipuai', moonshotai: 'moonshotai', xiaomi: 'xiaomi' }

/** What one source says about a model, in the terms filling in uses. */
interface Candidate {
  provider: string
  providerName?: string
  id: string
  name?: string
  reasoning?: boolean
  input?: ('text' | 'image')[]
  contextWindow?: number
  maxTokens?: number
  cost?: ModelCatalogDetails['cost']
  thinkingLevelMap?: CatalogThinkingLevelMap
  canonical?: string
  deprecated?: boolean
  updated?: string
}

/** The value most sources agree on (the first seen among equals). */
function consensus<T>(values: readonly (T | undefined)[]): T | undefined {
  const counts = new Map<string, { value: T; count: number }>()
  for (const value of values) {
    if (value === undefined) continue
    const key = JSON.stringify(value)
    const current = counts.get(key)
    if (current) current.count += 1
    else counts.set(key, { value, count: 1 })
  }
  let best: { value: T; count: number } | undefined
  for (const candidate of counts.values()) if (!best || candidate.count > best.count) best = candidate
  return best?.value
}

/** The maker's entry for the model among several: the same ID, then current over deprecated, then the latest. */
function preferred(entries: readonly Candidate[], ids: readonly string[]) {
  const wanted = new Set(ids.map((id) => id.toLowerCase()))
  return [...entries].sort((left, right) =>
    Number(wanted.has(right.id.toLowerCase())) - Number(wanted.has(left.id.toLowerCase()))
    || Number(Boolean(left.deprecated)) - Number(Boolean(right.deprecated))
    || (right.updated ?? '').localeCompare(left.updated ?? ''))[0]
}

/**
 * One model's details from a set of candidates: field by field, the
 * endpoint's own provider first, then the model's maker, then what most
 * sources agree on. A price comes only from the first two: the provider's own,
 * or the maker's list price as a reference on an endpoint that resells it.
 */
function compose(catalog: 'models.dev' | 'pi', own: Candidate | undefined, maker: Candidate | undefined, family: readonly Candidate[]): ModelCatalogDetails | null {
  if (!own && !maker && !family.length) return null
  const pick = <T>(read: (candidate: Candidate) => T | undefined) => (own ? read(own) : undefined) ?? (maker ? read(maker) : undefined) ?? consensus(family.map(read))
  const name = pick((candidate) => candidate.name)
  const reasoning = pick((candidate) => candidate.reasoning) ?? false
  const input = pick((candidate) => candidate.input?.length ? candidate.input : undefined)
  const contextWindow = pick((candidate) => candidate.contextWindow)
  const maxTokens = pick((candidate) => candidate.maxTokens)
  const thinkingLevelMap = reasoning ? pick((candidate) => candidate.thinkingLevelMap) : undefined
  const priced = own?.cost ? own : maker?.cost ? maker : undefined
  const cost = priced?.cost
  const basis = own ? 'provider' as const : maker ? 'maker' as const : 'consensus' as const
  const named = (own ?? maker)?.providerName
  return {
    ...(name ? { name } : {}),
    reasoning,
    input: input ?? ['text'],
    ...(contextWindow ? { contextWindow } : {}),
    ...(maxTokens ? { maxTokens } : {}),
    ...(cost ? { cost: { ...cost }, price: { by: priced === own ? 'provider' as const : 'maker' as const, ...(priced!.providerName ? { name: priced!.providerName } : {}) } } : {}),
    ...(thinkingLevelMap ? { thinkingLevelMap: { ...thinkingLevelMap } } : {}),
    source: { catalog, basis, ...(named ? { name: named } : {}) },
  }
}

interface DevLookup {
  byId: Map<string, Candidate[]>
  byCanonical: Map<string, Candidate[]>
}

const devLookups = new WeakMap<ModelsDevIndex, DevLookup>()

/** models.dev's entries by ID (and an aggregator route's last part) and by the model they are. */
function devLookup(index: ModelsDevIndex): DevLookup {
  const known = devLookups.get(index)
  if (known) return known
  const lookup: DevLookup = { byId: new Map(), byCanonical: new Map() }
  const add = (map: Map<string, Candidate[]>, key: string, candidate: Candidate) => {
    const list = map.get(key)
    if (list) list.push(candidate)
    else map.set(key, [candidate])
  }
  for (const provider of index.providers) {
    for (const [id, entry] of Object.entries(provider.models)) {
      const candidate: Candidate = { provider: provider.id, ...(provider.name ? { providerName: provider.name } : {}), id, ...entry }
      const lowered = id.toLowerCase()
      add(lookup.byId, lowered, candidate)
      const last = lowered.slice(lowered.lastIndexOf('/') + 1)
      if (last !== lowered) add(lookup.byId, last, candidate)
      if (entry.canonical) add(lookup.byCanonical, entry.canonical, candidate)
    }
  }
  devLookups.set(index, lookup)
  return lookup
}

/**
 * models.dev's answer: the entry of the provider the endpoint is, the
 * maker's own entry for the same model (found by models.dev's canonical ID,
 * as makers name models their own way: DeepSeek serves deepseek-v4.1-flash
 * as "deepseek-flash"), and every entry for that model.
 */
function fromModelsDev(index: ModelsDevIndex, baseUrl: string, modelId: string) {
  const key = endpointKey(baseUrl)
  const endpointProvider = key ? index.providers.find((provider) => endpointKey(provider.api) === key) : undefined
  const lookup = devLookup(index)
  const { vendor, model } = splitRoute(modelId)
  const sameId = [...new Set([...(lookup.byId.get(modelId.toLowerCase()) ?? []), ...(lookup.byId.get(model.toLowerCase()) ?? [])])]
  const own = endpointProvider ? preferred(sameId.filter((candidate) => candidate.provider === endpointProvider.id), [modelId, model]) : undefined
  const guessedMaker = vendor ?? vendorOf(model)
  const canonical = own?.canonical ?? consensus(sameId.map((candidate) => candidate.canonical))
    ?? (guessedMaker ? `${DEV_MAKERS[guessedMaker] ?? guessedMaker}/${model.toLowerCase()}` : undefined)
  const family = [...new Set([...sameId, ...(canonical ? lookup.byCanonical.get(canonical) ?? [] : [])])]
  const makerId = canonical?.split('/')[0] ?? (guessedMaker ? DEV_MAKERS[guessedMaker] ?? guessedMaker : undefined)
  const maker = makerId ? preferred(family.filter((candidate) => candidate.provider === makerId), [modelId, model]) : undefined
  return compose('models.dev', own, maker && maker !== own ? maker : undefined, family)
}

/** Pi offers extra-high and max only when a map names them: say so, rather than leave them looking like defaults. */
function piThinkingLevels(map: CatalogThinkingLevelMap | undefined): CatalogThinkingLevelMap | undefined {
  if (!map) return undefined
  return { ...map, xhigh: map.xhigh ?? null, max: map.max ?? null }
}

/** Pi's answer, for models models.dev does not know: the endpoint's own provider, the maker, then the others with that ID. */
function fromPi(catalog: readonly ModelCatalogEntry[], baseUrl: string, modelId: string) {
  const host = hostOf(baseUrl)
  const { vendor, model } = splitRoute(modelId)
  const entries = catalog.filter((entry) => entry.id === modelId || (model !== modelId && entry.id === model))
  const candidate = ({ baseUrl: _url, thinkingLevelMap, ...entry }: ModelCatalogEntry): Candidate => {
    const levels = piThinkingLevels(thinkingLevelMap)
    return { ...entry, providerName: MAKER_NAMES[entry.provider] ?? entry.provider, ...(levels ? { thinkingLevelMap: levels } : {}) }
  }
  const ownEntry = host ? entries.find((entry) => entry.id === modelId && hostOf(entry.baseUrl) === host) : undefined
  const makerId = vendor ?? vendorOf(model)
  const makerEntry = makerId ? entries.find((entry) => entry.provider === makerId && entry !== ownEntry) : undefined
  return compose('pi', ownEntry && candidate(ownEntry), makerEntry && candidate(makerEntry), entries.map(candidate))
}

/**
 * What a model added by ID to an endpoint can do: models.dev's answer, or,
 * when it does not know the model (or is off or unreachable), Pi's.
 */
export function resolveModelDetails(catalog: readonly ModelCatalogEntry[], modelsDev: ModelsDevIndex | null, baseUrl: string, modelId: string): ModelCatalogDetails | null {
  return (modelsDev ? fromModelsDev(modelsDev, baseUrl, modelId) : null) ?? fromPi(catalog, baseUrl, modelId)
}

export function lookupCatalogModels(catalog: readonly ModelCatalogEntry[], baseUrl: string, ids: readonly string[], modelsDev: ModelsDevIndex | null = null): ModelCatalogLookupResult {
  return {
    models: [...new Set(ids)].slice(0, MODEL_CATALOG_LOOKUP_LIMIT).map((id) => ({ id, details: resolveModelDetails(catalog, modelsDev, baseUrl, id) })),
  }
}
