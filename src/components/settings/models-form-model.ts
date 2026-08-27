import type { KeyValueRow } from '@/components/ui/form'
import type {
  ModelsConfigDocument,
  ModelsConfigModel,
  ModelsConfigProvider,
} from '@/shared/models-config'
import { rowsToRecord } from './mcp-server-form-model'

/*
 * Pure form <-> JSONC-definition mapping helpers for the models Form|JSON
 * single-draft flow (design §2/§7), mirroring mcp-server-form-model.ts.
 *
 * Structured forms own only the common fields (decision X). Form writes start
 * from the provider's RAW definition record (via rawModelsProviderDefinition —
 * never the redacted DTO), delete exactly the form-owned keys, and rebuild
 * them from the form values. Everything else — oauth, compat, unknown fields,
 * per-model api/baseUrl/headers/thinkingLevelMap, cost.tiers, and the existing
 * apiKey value — survives the round-trip byte-for-byte.
 */

export interface ProviderFormValue {
  id: string
  name: string
  baseUrl: string
  api: string
  // Secret handling (PRD R1): the existing key is never rendered. An empty
  // draft keeps the stored key verbatim; a non-empty draft replaces it; the
  // explicit clear control removes the field.
  apiKeyDraft: string
  clearKey: boolean
  headers: KeyValueRow[]
}

export interface ModelFormValue {
  id: string
  name: string
  reasoning: boolean
  inputText: boolean
  inputImage: boolean
  // Numeric fields stay strings in the form; empty means "field absent".
  contextWindow: string
  maxTokens: string
  costInput: string
  costOutput: string
  costCacheRead: string
  costCacheWrite: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function formValueFromProvider(provider: ModelsConfigProvider): ProviderFormValue {
  const headerRows = Object.entries(provider.headers)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .map(([key, value]) => ({ key, value }))
  return {
    id: provider.id,
    name: provider.name ?? '',
    baseUrl: provider.baseUrl ?? '',
    api: provider.api ?? '',
    apiKeyDraft: '',
    clearKey: false,
    headers: headerRows,
  }
}

export function formValueFromModel(model: ModelsConfigModel): ModelFormValue {
  return {
    id: model.id,
    name: model.name ?? '',
    reasoning: model.reasoning === true,
    // Pi defaults input to ["text"] when the field is absent.
    inputText: model.input ? model.input.includes('text') : true,
    inputImage: model.input?.includes('image') ?? false,
    contextWindow: model.contextWindow !== undefined ? String(model.contextWindow) : '',
    maxTokens: model.maxTokens !== undefined ? String(model.maxTokens) : '',
    costInput: model.cost ? String(model.cost.input) : '',
    costOutput: model.cost ? String(model.cost.output) : '',
    costCacheRead: model.cost ? String(model.cost.cacheRead) : '',
    costCacheWrite: model.cost ? String(model.cost.cacheWrite) : '',
  }
}

function costFromFormValue(
  value: ModelFormValue,
  existing: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const fields = [value.costInput, value.costOutput, value.costCacheRead, value.costCacheWrite]
    .map((field) => field.trim())
  if (fields.every((field) => field === '')) return undefined
  const cost: Record<string, unknown> = {
    input: Number(fields[0]),
    output: Number(fields[1]),
    cacheRead: Number(fields[2]),
    cacheWrite: Number(fields[3]),
  }
  // cost.tiers[] is JSON-only (decision X): splice the existing tiers back so
  // a cost edit through the form never drops them. Clearing every cost field
  // removes the whole cost object, tiers included — an explicit form edit.
  const existingTiers = isRecord(existing?.cost) ? existing.cost.tiers : undefined
  if (existingTiers !== undefined) cost.tiers = existingTiers
  return cost
}

function modelDefinitionFromFormValue(
  value: ModelFormValue,
  existing: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const definition: Record<string, unknown> = existing ? { ...existing } : {}
  for (const field of ['id', 'name', 'reasoning', 'input', 'cost', 'contextWindow', 'maxTokens']) {
    delete definition[field]
  }
  definition.id = value.id.trim()
  if (value.name.trim() !== '') definition.name = value.name.trim()
  if (value.reasoning) definition.reasoning = true
  const input: ('text' | 'image')[] = []
  if (value.inputText) input.push('text')
  if (value.inputImage) input.push('image')
  // An absent `input` means ["text"] to Pi; keep it absent instead of writing
  // the default back when the form holds exactly that default.
  if (input.length > 0 && !(existing?.input === undefined && !value.inputImage)) {
    definition.input = input
  }
  const cost = costFromFormValue(value, existing)
  if (cost) definition.cost = cost
  if (value.contextWindow.trim() !== '') {
    definition.contextWindow = Number.parseInt(value.contextWindow.trim(), 10)
  }
  if (value.maxTokens.trim() !== '') {
    definition.maxTokens = Number.parseInt(value.maxTokens.trim(), 10)
  }
  return definition
}

export function definitionFromFormValues(
  provider: ProviderFormValue,
  models: readonly ModelFormValue[],
  existingProviderDefinition?: Record<string, unknown>,
): Record<string, unknown> {
  const existing = existingProviderDefinition
  const definition: Record<string, unknown> = existing ? { ...existing } : {}
  for (const field of ['name', 'baseUrl', 'api', 'apiKey', 'headers', 'models']) {
    delete definition[field]
  }
  if (provider.name.trim() !== '') definition.name = provider.name.trim()
  if (provider.baseUrl.trim() !== '') definition.baseUrl = provider.baseUrl.trim()
  if (provider.api.trim() !== '') definition.api = provider.api.trim()
  if (!provider.clearKey) {
    if (provider.apiKeyDraft !== '') {
      definition.apiKey = provider.apiKeyDraft
    } else if (typeof existing?.apiKey === 'string' && existing.apiKey !== '') {
      // Blank draft keeps the stored key verbatim; the JSONC diff then leaves
      // the original line untouched, exact formatting included.
      definition.apiKey = existing.apiKey
    }
  }
  const rawHeaders = isRecord(existing?.headers) ? existing.headers : undefined
  const headers = rowsToRecord(provider.headers)
  if (rawHeaders) {
    // Header rows can only represent string values. Keep advanced raw values
    // in place and overlay the user's edited string rows on top. String keys
    // omitted from the form are intentionally removed.
    const advancedHeaders = Object.fromEntries(
      Object.entries(rawHeaders).filter(([, value]) => typeof value !== 'string'),
    )
    const mergedHeaders = { ...advancedHeaders, ...headers }
    if (Object.keys(mergedHeaders).length > 0) definition.headers = mergedHeaders
  } else if (Object.keys(headers).length > 0) {
    definition.headers = headers
  }
  if (models.length > 0 || Array.isArray(existing?.models)) {
    const existingModels = new Map<string, Record<string, unknown>>()
    if (Array.isArray(existing?.models)) {
      for (const candidate of existing.models) {
        if (isRecord(candidate) && typeof candidate.id === 'string') {
          existingModels.set(candidate.id, candidate)
        }
      }
    }
    definition.models = models.map((model) =>
      modelDefinitionFromFormValue(model, existingModels.get(model.id.trim())))
  }
  return definition
}

export function duplicateProviderId(
  id: string,
  document: ModelsConfigDocument,
  options: { caseInsensitive: boolean; excludeId?: string },
): boolean {
  const needle = options.caseInsensitive ? id.toLowerCase() : id
  return document.providers.some((provider) => {
    if (options.excludeId !== undefined && provider.id === options.excludeId) return false
    const candidate = options.caseInsensitive ? provider.id.toLowerCase() : provider.id
    return candidate === needle
  })
}

export function duplicateModelId(
  id: string,
  models: readonly { id: string }[],
  excludeId?: string,
): boolean {
  return models.some((model) => model.id !== excludeId && model.id === id)
}

/** Token fields accept "unset" (empty) or a positive integer. */
export function tokenFieldValid(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed === '') return true
  if (!/^\d+$/.test(trimmed)) return false
  return Number.parseInt(trimmed, 10) >= 1
}

/** Cost fields accept "unset" (empty) or a finite number ≥ 0. */
export function costFieldValid(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed === '') return true
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) && parsed >= 0
}

/** Cost is written all-or-nothing: either every field is set or none is. */
export function costGroupComplete(
  value: Pick<ModelFormValue, 'costInput' | 'costOutput' | 'costCacheRead' | 'costCacheWrite'>,
): boolean {
  const fields = [value.costInput, value.costOutput, value.costCacheRead, value.costCacheWrite]
    .map((field) => field.trim())
  return fields.every((field) => field !== '') || fields.every((field) => field === '')
}
