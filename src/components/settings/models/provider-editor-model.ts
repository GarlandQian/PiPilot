import type { ModelCatalogDetails } from '@/shared/model-catalog'

/*
 * The provider editor works on the provider's raw models.json definition, so
 * every field it does not show (oauth, modelOverrides, per-model api or
 * headers, cost tiers, unknown keys) survives an edit unchanged. Models are
 * kept as rows with stable keys, so a row keeps its place and test result
 * while its ID is being typed.
 */

export type JsonRecord = Record<string, unknown>

export interface ModelRow {
  key: string
  /** The ID it was loaded with; null for a row added in this editor. */
  originalId: string | null
  raw: JsonRecord
}

export interface ProviderEditorState {
  id: string
  /** The definition without `models`. */
  provider: JsonRecord
  models: ModelRow[]
  /** The definition had a `models` array, even an empty one. */
  hadModels: boolean
  /** The row to make the default model when saved. */
  defaultKey: string | null
}

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

let nextRowKey = 0
export const newRowKey = () => `row-${++nextRowKey}`

export function cloneJson<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value)) as T
}

/** Rows for a models array; rows already shown keep their key when their ID is unchanged. */
export function rowsFromModels(models: unknown, previous: readonly ModelRow[] = [], loaded = false): ModelRow[] {
  if (!Array.isArray(models)) return []
  const reusable = new Map(previous.map((row) => [typeof row.raw.id === 'string' ? row.raw.id : '', row]))
  return models.filter(isRecord).map((raw) => {
    const id = typeof raw.id === 'string' ? raw.id : ''
    const match = reusable.get(id)
    if (match) reusable.delete(id)
    return { key: match?.key ?? newRowKey(), originalId: match ? match.originalId : loaded && id ? id : null, raw: cloneJson(raw) }
  })
}

export function editorFromDefinition(id: string, definition: JsonRecord, defaultModelId?: string): ProviderEditorState {
  const { models, ...provider } = cloneJson(definition)
  const rows = rowsFromModels(models, [], true)
  return {
    id,
    provider,
    models: rows,
    hadModels: Array.isArray(models),
    defaultKey: defaultModelId === undefined ? null : rows.find((row) => row.raw.id === defaultModelId)?.key ?? null,
  }
}

export function definitionFromEditor(state: ProviderEditorState): JsonRecord {
  return state.models.length || state.hadModels
    ? { ...state.provider, models: state.models.map((row) => row.raw) }
    : { ...state.provider }
}

/** Set or (with undefined) remove one field, without touching the rest. */
export function withField(record: JsonRecord, key: string, value: unknown): JsonRecord {
  const next = { ...record }
  if (value === undefined) delete next[key]
  else next[key] = value
  return next
}

export const stringField = (record: JsonRecord, key: string) => typeof record[key] === 'string' ? record[key] as string : ''
export const numberField = (record: JsonRecord, key: string) => typeof record[key] === 'number' ? record[key] as number : undefined

/* ------------------------------ secrets ------------------------------ */

/** Shown in place of a key in the JSON view; left as is, the saved key stays. */
export const MASKED_SECRET = '••••••••'

/** `$NAME`, `${NAME}` and `!command` say where the key comes from, not what it is. */
export function isLiteralSecret(value: string) {
  return value !== '' && !value.startsWith('!') && !/^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?$/u.test(value)
}

const SECRET_HEADER = /auth|key|token|secret|password|cookie/iu

/** Paths to every literal key or secret header value in a definition. */
function secretPaths(definition: JsonRecord): (string | number)[][] {
  const paths: (string | number)[][] = []
  const visit = (record: JsonRecord, path: (string | number)[]) => {
    if (typeof record.apiKey === 'string' && isLiteralSecret(record.apiKey)) paths.push([...path, 'apiKey'])
    if (isRecord(record.headers)) {
      for (const [name, value] of Object.entries(record.headers)) {
        if (typeof value === 'string' && SECRET_HEADER.test(name) && isLiteralSecret(value)) paths.push([...path, 'headers', name])
      }
    }
  }
  visit(definition, [])
  if (Array.isArray(definition.models)) definition.models.forEach((model, index) => { if (isRecord(model)) visit(model, ['models', index]) })
  return paths
}

function readPath(value: unknown, path: readonly (string | number)[]) {
  let current: unknown = value
  for (const part of path) {
    if (typeof part === 'number' ? !Array.isArray(current) : !isRecord(current)) return undefined
    current = (current as Record<string | number, unknown>)[part]
  }
  return current
}

function writePath(value: unknown, path: readonly (string | number)[], replacement: unknown) {
  let current: unknown = value
  for (const part of path.slice(0, -1)) current = (current as Record<string | number, unknown>)[part]
  ;(current as Record<string | number, unknown>)[path[path.length - 1]!] = replacement
}

export function maskSecrets(definition: JsonRecord): JsonRecord {
  const masked = cloneJson(definition)
  for (const path of secretPaths(definition)) writePath(masked, path, MASKED_SECRET)
  return masked
}

/** Puts back each secret the JSON view still shows masked; a new value replaces it. */
export function restoreSecrets(edited: JsonRecord, original: JsonRecord): JsonRecord {
  const restored = cloneJson(edited)
  const walk = (value: unknown, path: (string | number)[]) => {
    if (value === MASKED_SECRET) {
      const previous = readPath(original, path)
      writePath(restored, path, typeof previous === 'string' ? previous : '')
    } else if (Array.isArray(value)) value.forEach((entry, index) => walk(entry, [...path, index]))
    else if (isRecord(value)) for (const [key, entry] of Object.entries(value)) walk(entry, [...path, key])
  }
  walk(edited, [])
  return restored
}

/* --------------------------- capabilities --------------------------- */

export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
export type ThinkingLevel = typeof THINKING_LEVELS[number]

/** Nothing says what the model can do: Pi uses its defaults. */
export function capabilitiesUnknown(raw: JsonRecord) {
  return raw.reasoning === undefined && raw.input === undefined && raw.contextWindow === undefined && raw.maxTokens === undefined
}

/** Fill only what the row does not say yet; returns the row unchanged when nothing is known. */
export function fillFromDetails(raw: JsonRecord, details: ModelCatalogDetails | null | undefined, remoteName?: string): JsonRecord {
  const next = { ...raw }
  const id = typeof raw.id === 'string' ? raw.id : ''
  const name = remoteName?.trim() || details?.name
  if (next.name === undefined && name && name !== id) next.name = name
  if (!details) return next
  if (next.reasoning === undefined && details.reasoning) next.reasoning = true
  if (next.input === undefined && details.input.includes('image')) next.input = ['text', 'image']
  if (next.contextWindow === undefined && details.contextWindow) next.contextWindow = details.contextWindow
  if (next.maxTokens === undefined && details.maxTokens) next.maxTokens = details.maxTokens
  if (next.cost === undefined && details.cost) next.cost = { ...details.cost }
  return next
}

/* ----------------------------- validation ---------------------------- */

export interface EditorIssues {
  id?: 'required' | 'taken' | 'invalid'
  baseUrl?: 'required' | 'invalid'
  models: Record<string, 'required' | 'duplicate'>
  json?: string
}

export function validEndpoint(value: string) {
  try {
    const url = new URL(value.trim())
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function editorIssues(state: ProviderEditorState, takenIds: readonly string[], json?: string): EditorIssues {
  const issues: EditorIssues = { models: {} }
  const id = state.id.trim()
  if (!id) issues.id = 'required'
  else if (id.length > 128 || /\s/u.test(id)) issues.id = 'invalid'
  else if (takenIds.some((taken) => taken.toLowerCase() === id.toLowerCase())) issues.id = 'taken'
  const baseUrl = stringField(state.provider, 'baseUrl').trim()
  if (!baseUrl) issues.baseUrl = 'required'
  else if (!validEndpoint(baseUrl)) issues.baseUrl = 'invalid'
  const seen = new Set<string>()
  for (const row of state.models) {
    const modelId = stringField(row.raw, 'id').trim()
    if (!modelId) issues.models[row.key] = 'required'
    else if (seen.has(modelId)) issues.models[row.key] = 'duplicate'
    seen.add(modelId)
  }
  if (json) issues.json = json
  return issues
}

export const hasIssues = (issues: EditorIssues) =>
  Boolean(issues.id || issues.baseUrl || issues.json || Object.keys(issues.models).length)

/** A provider ID nobody uses yet: "siliconflow", then "siliconflow-2"… */
export function uniqueProviderId(base: string, takenIds: readonly string[]) {
  const taken = new Set(takenIds.map((id) => id.toLowerCase()))
  const root = base.trim().toLowerCase().replace(/[^a-z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '') || 'custom'
  let candidate = root
  for (let suffix = 2; taken.has(candidate); suffix += 1) candidate = `${root}-${suffix}`
  return candidate
}
