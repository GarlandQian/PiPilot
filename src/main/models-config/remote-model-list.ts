import type { ModelsRemoteListResult } from '../../shared/models-config'

const LIST_TIMEOUT_MS = 10_000
const LIST_RESPONSE_LIMIT = 4 * 1024 * 1024
const LIST_MODEL_LIMIT = 2_000

export class RemoteModelListError extends Error {
  constructor(readonly code: 'MODELS_LIST_UNREACHABLE' | 'MODELS_LIST_HTTP' | 'MODELS_LIST_INVALID', message: string) {
    super(message)
    this.name = 'RemoteModelListError'
  }
}

export interface RemoteModelListRequest {
  baseUrl: string
  api: string
  apiKey?: string
}

/**
 * The key as Pi would send it: `$NAME` / `${NAME}` read the environment.
 * A `!command` key is never run here; listing then goes without a key.
 */
export function resolveListKey(value: string | undefined, env: NodeJS.ProcessEnv = process.env) {
  const key = value?.trim()
  if (!key || key.startsWith('!')) return undefined
  const reference = /^\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))$/u.exec(key)
  return reference ? env[reference[1] ?? reference[2] ?? '']?.trim() || undefined : key
}

/** Where each API family lists its models, and how it authenticates. */
export function remoteModelListRequest(request: RemoteModelListRequest, env?: NodeJS.ProcessEnv): { url: string; headers: Record<string, string> } {
  const url = new URL(request.baseUrl.trim())
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new RemoteModelListError('MODELS_LIST_UNREACHABLE', 'Only http and https endpoints can be listed.')
  }
  const base = url.href.replace(/\/+$/u, '')
  const key = resolveListKey(request.apiKey, env)
  if (request.api === 'anthropic-messages') {
    return {
      url: /\/v1$/u.test(base) ? `${base}/models?limit=1000` : `${base}/v1/models?limit=1000`,
      headers: { 'anthropic-version': '2023-06-01', ...(key ? { 'x-api-key': key } : {}) },
    }
  }
  if (request.api === 'google-generative-ai') {
    return { url: `${base}/models?pageSize=1000`, headers: key ? { 'x-goog-api-key': key } : {} }
  }
  return { url: `${base}/models`, headers: key ? { authorization: `Bearer ${key}` } : {} }
}

function text(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 256) : undefined
}

/** OpenAI (`data[].id`), Anthropic (`data[].display_name`), Gemini (`models[].name`) and bare arrays. */
export function parseRemoteModelList(payload: unknown): ModelsRemoteListResult {
  const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
  const entries = Array.isArray(payload) ? payload : Array.isArray(record.data) ? record.data : Array.isArray(record.models) ? record.models : null
  if (!entries) throw new RemoteModelListError('MODELS_LIST_INVALID', 'The endpoint did not return a model list.')
  const seen = new Set<string>()
  const models: ModelsRemoteListResult['models'] = []
  for (const entry of entries) {
    const item = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {}
    // Gemini lists every model; only those that can chat belong in Pi.
    const methods = item.supportedGenerationMethods
    if (Array.isArray(methods) && !methods.includes('generateContent')) continue
    const id = text(item.id) ?? text(item.name)?.replace(/^models\//u, '') ?? text(entry)
    if (!id || seen.has(id)) continue
    seen.add(id)
    const name = text(item.display_name) ?? text(item.displayName)
    models.push(name && name !== id ? { id, name } : { id })
    if (models.length >= LIST_MODEL_LIMIT) break
  }
  return { models }
}

export async function listRemoteModels(request: RemoteModelListRequest, fetchImpl: typeof fetch = fetch): Promise<ModelsRemoteListResult> {
  const target = remoteModelListRequest(request)
  let response: Response
  try {
    response = await fetchImpl(target.url, { headers: { accept: 'application/json', ...target.headers }, signal: AbortSignal.timeout(LIST_TIMEOUT_MS) })
  } catch (error) {
    throw new RemoteModelListError('MODELS_LIST_UNREACHABLE', error instanceof Error && error.name === 'TimeoutError'
      ? 'The endpoint did not answer in time.' : 'The endpoint could not be reached.')
  }
  if (!response.ok) throw new RemoteModelListError('MODELS_LIST_HTTP', `HTTP ${response.status}`)
  const body = await response.text()
  if (body.length > LIST_RESPONSE_LIMIT) throw new RemoteModelListError('MODELS_LIST_INVALID', 'The model list is too large.')
  try {
    return parseRemoteModelList(JSON.parse(body))
  } catch (error) {
    if (error instanceof RemoteModelListError) throw error
    throw new RemoteModelListError('MODELS_LIST_INVALID', 'The endpoint did not return JSON.')
  }
}
