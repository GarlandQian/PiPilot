import {
  applyEdits,
  findNodeAtLocation,
  getNodeValue,
  modify,
  parseTree,
  printParseErrorCode,
  visit,
  type Node as JsonNode,
  type ParseError,
} from 'jsonc-parser'
import {
  MODELS_CONFIG_MODEL_LIMIT,
  MODELS_CONFIG_PROVIDER_LIMIT,
  MODELS_CONFIG_DIAGNOSTIC_LIMIT,
  modelsConfigDocumentSchema,
  type ModelsConfigCost,
  type ModelsConfigDiagnostic,
  type ModelsConfigDocument,
  type ModelsConfigModel,
  type ModelsConfigProvider,
} from './models-config'

const PARSE_OPTIONS = { allowTrailingComma: true, disallowComments: false }
const EDIT_OPTIONS = {
  formattingOptions: { insertSpaces: true, tabSize: 2, eol: '\n' },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function locationForOffset(text: string, offset: number) {
  const prefix = text.slice(0, offset)
  const lines = prefix.split('\n')
  return {
    line: lines.length,
    column: (lines[lines.length - 1]?.length ?? 0) + 1,
  }
}

function diagnostic(
  text: string,
  code: string,
  message: string,
  offset = 0,
  length = 0,
  path?: string,
): ModelsConfigDiagnostic {
  return {
    code,
    message,
    offset,
    length,
    ...locationForOffset(text, offset),
    ...(path ? { path } : {}),
  }
}

function diagnosticAtPath(
  text: string,
  root: JsonNode,
  path: (string | number)[],
  code: string,
  message: string,
) {
  const node = findNodeAtLocation(root, path)
  return diagnostic(
    text,
    code,
    message,
    node?.offset ?? 0,
    node?.length ?? 0,
    path.join('.'),
  )
}

function duplicateKeyDiagnostics(text: string) {
  const diagnostics: ModelsConfigDiagnostic[] = []
  const keysByObject = new Map<string, Set<string>>()
  visit(text, {
    onObjectProperty(property, offset, length, line, column, pathSupplier) {
      const objectPath = JSON.stringify(pathSupplier())
      const keys = keysByObject.get(objectPath) ?? new Set<string>()
      if (keys.has(property)) {
        diagnostics.push({
          code: 'MODELS_DUPLICATE_KEY',
          message: `Duplicate JSON object key: ${property}`,
          offset,
          length,
          line: line + 1,
          column: column + 1,
          path: [...pathSupplier(), property].join('.'),
        })
      }
      keys.add(property)
      keysByObject.set(objectPath, keys)
    },
  }, PARSE_OPTIONS)
  return diagnostics
}

function optionalString(
  text: string,
  root: JsonNode,
  path: (string | number)[],
  value: unknown,
  code: string,
  message: string,
  diagnostics: ModelsConfigDiagnostic[],
): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') {
    diagnostics.push(diagnosticAtPath(text, root, path, code, message))
    return undefined
  }
  return value
}

function costFromRaw(
  text: string,
  root: JsonNode,
  path: (string | number)[],
  value: unknown,
  diagnostics: ModelsConfigDiagnostic[],
): ModelsConfigCost | undefined {
  if (!isRecord(value)) {
    diagnostics.push(diagnosticAtPath(
      text,
      root,
      path,
      'MODELS_MODEL_COST_INVALID',
      'Model cost must be an object with numeric input, output, cacheRead, and cacheWrite.',
    ))
    return undefined
  }
  const { input, output, cacheRead, cacheWrite, tiers } = value
  if (
    typeof input !== 'number' ||
    typeof output !== 'number' ||
    typeof cacheRead !== 'number' ||
    typeof cacheWrite !== 'number'
  ) {
    diagnostics.push(diagnosticAtPath(
      text,
      root,
      path,
      'MODELS_MODEL_COST_INVALID',
      'Model cost must include numeric input, output, cacheRead, and cacheWrite.',
    ))
    return undefined
  }
  if (tiers !== undefined && !Array.isArray(tiers)) {
    diagnostics.push(diagnosticAtPath(
      text,
      root,
      [...path, 'tiers'],
      'MODELS_MODEL_COST_INVALID',
      'Model cost tiers must be an array when present.',
    ))
    return { input, output, cacheRead, cacheWrite }
  }
  return { input, output, cacheRead, cacheWrite, ...(tiers !== undefined ? { tiers } : {}) }
}

function modelFromRaw(
  text: string,
  root: JsonNode,
  path: (string | number)[],
  entry: unknown,
  diagnostics: ModelsConfigDiagnostic[],
): ModelsConfigModel | undefined {
  if (!isRecord(entry)) {
    diagnostics.push(diagnosticAtPath(
      text,
      root,
      path,
      'MODELS_MODEL_INVALID',
      'Each provider model must be an object.',
    ))
    return undefined
  }
  const id = entry.id
  if (typeof id !== 'string' || id.length === 0 || id.length > 256) {
    diagnostics.push(diagnosticAtPath(
      text,
      root,
      [...path, 'id'],
      'MODELS_MODEL_ID_INVALID',
      'Each model id must contain 1 to 256 characters.',
    ))
    return undefined
  }
  const name = optionalString(
    text, root, [...path, 'name'], entry.name,
    'MODELS_MODEL_FIELD_INVALID', 'Model name must be a string.', diagnostics,
  )
  const api = optionalString(
    text, root, [...path, 'api'], entry.api,
    'MODELS_MODEL_FIELD_INVALID', 'Model api must be a string.', diagnostics,
  )
  const baseUrl = optionalString(
    text, root, [...path, 'baseUrl'], entry.baseUrl,
    'MODELS_MODEL_FIELD_INVALID', 'Model baseUrl must be a string.', diagnostics,
  )
  let reasoning: boolean | undefined
  if (entry.reasoning !== undefined) {
    if (typeof entry.reasoning === 'boolean') {
      reasoning = entry.reasoning
    } else {
      diagnostics.push(diagnosticAtPath(
        text,
        root,
        [...path, 'reasoning'],
        'MODELS_MODEL_FIELD_INVALID',
        'Model reasoning must be a boolean.',
      ))
    }
  }
  let input: ('text' | 'image')[] | undefined
  if (entry.input !== undefined) {
    if (
      Array.isArray(entry.input) &&
      entry.input.every((value) => value === 'text' || value === 'image')
    ) {
      input = [...entry.input]
    } else {
      diagnostics.push(diagnosticAtPath(
        text,
        root,
        [...path, 'input'],
        'MODELS_MODEL_INPUT_INVALID',
        'Model input must be an array of "text" and/or "image".',
      ))
    }
  }
  const cost = entry.cost === undefined
    ? undefined
    : costFromRaw(text, root, [...path, 'cost'], entry.cost, diagnostics)
  let contextWindow: number | undefined
  if (entry.contextWindow !== undefined) {
    if (typeof entry.contextWindow === 'number') {
      contextWindow = entry.contextWindow
    } else {
      diagnostics.push(diagnosticAtPath(
        text,
        root,
        [...path, 'contextWindow'],
        'MODELS_MODEL_FIELD_INVALID',
        'Model contextWindow must be a number.',
      ))
    }
  }
  let maxTokens: number | undefined
  if (entry.maxTokens !== undefined) {
    if (typeof entry.maxTokens === 'number') {
      maxTokens = entry.maxTokens
    } else {
      diagnostics.push(diagnosticAtPath(
        text,
        root,
        [...path, 'maxTokens'],
        'MODELS_MODEL_FIELD_INVALID',
        'Model maxTokens must be a number.',
      ))
    }
  }
  let headers: Record<string, unknown> | undefined
  if (entry.headers !== undefined) {
    if (isRecord(entry.headers)) {
      headers = entry.headers
    } else {
      diagnostics.push(diagnosticAtPath(
        text,
        root,
        [...path, 'headers'],
        'MODELS_MODEL_HEADERS_INVALID',
        'Model headers must be an object.',
      ))
    }
  }
  return {
    id,
    name,
    api,
    baseUrl,
    reasoning,
    thinkingLevelMap: entry.thinkingLevelMap,
    input,
    cost,
    contextWindow,
    maxTokens,
    headers,
    compat: entry.compat,
  }
}

function providerFromRaw(
  text: string,
  root: JsonNode,
  id: string,
  value: Record<string, unknown>,
  diagnostics: ModelsConfigDiagnostic[],
): ModelsConfigProvider {
  const path = ['providers', id]
  const name = optionalString(
    text, root, [...path, 'name'], value.name,
    'MODELS_PROVIDER_FIELD_INVALID', 'Provider name must be a string.', diagnostics,
  )
  const baseUrl = optionalString(
    text, root, [...path, 'baseUrl'], value.baseUrl,
    'MODELS_PROVIDER_FIELD_INVALID', 'Provider baseUrl must be a string.', diagnostics,
  )
  const api = optionalString(
    text, root, [...path, 'api'], value.api,
    'MODELS_PROVIDER_FIELD_INVALID', 'Provider api must be a string.', diagnostics,
  )
  // apiKey is redacted to a presence flag here — the only place the raw value
  // is read on the structured path. The value itself never enters the DTO.
  let hasApiKey = false
  if (value.apiKey !== undefined) {
    if (typeof value.apiKey === 'string') {
      hasApiKey = value.apiKey.length > 0
    } else {
      diagnostics.push(diagnosticAtPath(
        text,
        root,
        [...path, 'apiKey'],
        'MODELS_API_KEY_INVALID',
        'Provider apiKey must be a string when present.',
      ))
    }
  }
  let headers: Record<string, unknown> = {}
  if (value.headers !== undefined) {
    if (isRecord(value.headers)) {
      headers = value.headers
    } else {
      diagnostics.push(diagnosticAtPath(
        text,
        root,
        [...path, 'headers'],
        'MODELS_PROVIDER_HEADERS_INVALID',
        'Provider headers must be an object.',
      ))
    }
  }
  const models: ModelsConfigModel[] = []
  if (value.models !== undefined) {
    if (!Array.isArray(value.models)) {
      diagnostics.push(diagnosticAtPath(
        text,
        root,
        [...path, 'models'],
        'MODELS_PROVIDER_MODELS_INVALID',
        'Provider models must be an array.',
      ))
    } else {
      for (const [index, entry] of value.models.entries()) {
        if (models.length >= MODELS_CONFIG_MODEL_LIMIT) {
          diagnostics.push(diagnostic(
            text,
            'MODELS_MODEL_LIMIT',
            `At most ${MODELS_CONFIG_MODEL_LIMIT} models per provider are supported.`,
          ))
          break
        }
        const model = modelFromRaw(text, root, [...path, 'models', index], entry, diagnostics)
        if (model) models.push(model)
      }
    }
  }
  return {
    id,
    name,
    baseUrl,
    api,
    hasApiKey,
    oauth: value.oauth,
    headers,
    compat: value.compat,
    models,
    source: 'custom',
  }
}

export function parseModelsConfigDocument(text: string): ModelsConfigDocument {
  const parseErrors: ParseError[] = []
  const root = parseTree(text, parseErrors, PARSE_OPTIONS)
  const diagnostics = parseErrors.map((error) => diagnostic(
    text,
    `MODELS_JSON_${printParseErrorCode(error.error).toUpperCase()}`,
    printParseErrorCode(error.error),
    error.offset,
    error.length,
  ))
  diagnostics.push(...duplicateKeyDiagnostics(text))
  const providers: ModelsConfigProvider[] = []

  if (!root || root.type !== 'object') {
    if (parseErrors.length === 0) {
      diagnostics.push(diagnostic(
        text,
        'MODELS_ROOT_INVALID',
        'The models configuration root must be an object.',
      ))
    }
  } else {
    const document = getNodeValue(root) as unknown
    if (!isRecord(document)) {
      diagnostics.push(diagnostic(text, 'MODELS_ROOT_INVALID', 'The models configuration root must be an object.'))
    } else if (document.providers !== undefined && !isRecord(document.providers)) {
      diagnostics.push(diagnostic(
        text,
        'MODELS_PROVIDERS_INVALID',
        'providers must be an object.',
        0,
        0,
        'providers',
      ))
    } else if (isRecord(document.providers)) {
      for (const [id, value] of Object.entries(document.providers)) {
        if (providers.length >= MODELS_CONFIG_PROVIDER_LIMIT) {
          diagnostics.push(diagnostic(
            text,
            'MODELS_PROVIDER_LIMIT',
            `At most ${MODELS_CONFIG_PROVIDER_LIMIT} custom providers are supported.`,
          ))
          break
        }
        if (id.length === 0 || id.length > 128) {
          diagnostics.push(diagnostic(
            text,
            'MODELS_PROVIDER_ID_INVALID',
            'Provider ids must contain 1 to 128 characters.',
            0,
            0,
            `providers.${id}`,
          ))
          continue
        }
        if (!isRecord(value)) {
          diagnostics.push(diagnostic(
            text,
            'MODELS_PROVIDER_INVALID',
            'Each provider must be an object.',
            0,
            0,
            `providers.${id}`,
          ))
          continue
        }
        providers.push(providerFromRaw(text, root, id, value, diagnostics))
      }
    }
  }

  return modelsConfigDocumentSchema.parse({
    providers,
    diagnostics: diagnostics.slice(0, MODELS_CONFIG_DIAGNOSTIC_LIMIT),
    valid: diagnostics.length === 0,
  })
}

/*
 * Return the raw, unredacted provider definition from the JSONC text. The
 * structured parse above redacts apiKey into `hasApiKey`; form writes instead
 * start from this raw record so passthrough fields (oauth, compat, unknown
 * fields, per-model advanced fields) and the existing apiKey value survive
 * the round-trip byte-for-byte. Soft by contract: any parse problem yields
 * `undefined` and the caller falls back to a fresh definition.
 */
export function rawModelsProviderDefinition(
  text: string,
  providerId: string,
): Record<string, unknown> | undefined {
  const errors: ParseError[] = []
  const root = parseTree(text, errors, PARSE_OPTIONS)
  if (errors.length > 0 || !root) return undefined
  const node = findNodeAtLocation(root, ['providers', providerId])
  const value = node ? getNodeValue(node) : undefined
  return isRecord(value) ? value : undefined
}

/*
 * Presentation view over a raw provider definition for the structured surface.
 * The raw record itself is never rewritten here — field values and unknown
 * keys pass through definitionFromFormValues untouched; this helper only
 * derives the redacted pieces (model ids/flags, apiKey presence) the form
 * cards need for display, validation, and delete flows.
 */
export function structuredProviderPayload(definition: Record<string, unknown>): {
  models: ModelsConfigModel[]
  hasApiKey: boolean
} {
  const models: ModelsConfigModel[] = []
  if (Array.isArray(definition.models)) {
    for (const entry of definition.models) {
      if (!isRecord(entry)) continue
      if (typeof entry.id !== 'string' || entry.id.length === 0 || entry.id.length > 256) continue
      const model: ModelsConfigModel = { id: entry.id }
      if (typeof entry.name === 'string') model.name = entry.name
      if (entry.reasoning === true) model.reasoning = true
      if (Array.isArray(entry.input)) {
        model.input = entry.input.filter((value): value is 'text' | 'image' =>
          value === 'text' || value === 'image')
      }
      if (typeof entry.contextWindow === 'number') model.contextWindow = entry.contextWindow
      if (typeof entry.maxTokens === 'number') model.maxTokens = entry.maxTokens
      if (
        isRecord(entry.cost) &&
        typeof entry.cost.input === 'number' &&
        typeof entry.cost.output === 'number' &&
        typeof entry.cost.cacheRead === 'number' &&
        typeof entry.cost.cacheWrite === 'number'
      ) {
        model.cost = {
          input: entry.cost.input,
          output: entry.cost.output,
          cacheRead: entry.cost.cacheRead,
          cacheWrite: entry.cost.cacheWrite,
        }
      }
      models.push(model)
    }
  }
  return {
    models,
    hasApiKey: typeof definition.apiKey === 'string' && definition.apiKey.length > 0,
  }
}

function requireEditableDocument(text: string) {
  const errors: ParseError[] = []
  const root = parseTree(text, errors, PARSE_OPTIONS)
  if (
    errors.length > 0 ||
    root?.type !== 'object' ||
    duplicateKeyDiagnostics(text).length > 0
  ) {
    throw new Error('Fix the JSONC syntax before using structured edits.')
  }
  const parsed = parseModelsConfigDocument(text)
  return { parsed, root }
}

function edit(text: string, path: (string | number)[], value: unknown) {
  return applyEdits(text, modify(text, path, value, EDIT_OPTIONS))
}

function deeplyEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false
    }
    return left.every((value, index) => deeplyEqual(value, right[index]))
  }
  if (isRecord(left) || isRecord(right)) {
    if (!isRecord(left) || !isRecord(right)) return false
    const leftKeys = Object.keys(left)
    const rightKeys = Object.keys(right)
    if (leftKeys.length !== rightKeys.length) return false
    return leftKeys.every((key) => (
      Object.prototype.hasOwnProperty.call(right, key) &&
      deeplyEqual(left[key], right[key])
    ))
  }
  return false
}

/**
 * Apply the smallest possible JSONC edits. Replacing a whole provider object
 * would discard comments attached to unchanged fields, so recurse through
 * objects/arrays and only rewrite values that actually changed.
 */
function applyValueDiff(
  text: string,
  path: (string | number)[],
  previous: unknown,
  next: unknown,
): string {
  if (deeplyEqual(previous, next)) return text

  if (isRecord(previous) && isRecord(next)) {
    for (const key of Object.keys(previous)) {
      if (!Object.prototype.hasOwnProperty.call(next, key)) {
        text = edit(text, [...path, key], undefined)
      }
    }
    for (const [key, value] of Object.entries(next)) {
      if (!Object.prototype.hasOwnProperty.call(previous, key)) {
        text = edit(text, [...path, key], value)
      } else {
        text = applyValueDiff(text, [...path, key], previous[key], value)
      }
    }
    return text
  }

  if (Array.isArray(previous) && Array.isArray(next)) {
    for (let index = previous.length - 1; index >= next.length; index -= 1) {
      text = edit(text, [...path, index], undefined)
    }
    const commonLength = Math.min(previous.length, next.length)
    for (let index = 0; index < commonLength; index += 1) {
      text = applyValueDiff(text, [...path, index], previous[index], next[index])
    }
    for (let index = commonLength; index < next.length; index += 1) {
      text = edit(text, [...path, index], next[index])
    }
    return text
  }

  return edit(text, path, next)
}

export function upsertModelsProvider(
  text: string,
  providerId: string,
  definition: Record<string, unknown>,
) {
  if (providerId.length === 0 || providerId.length > 128) {
    throw new Error('The provider id must contain 1 to 128 characters.')
  }
  const { root } = requireEditableDocument(text)
  const node = findNodeAtLocation(root, ['providers', providerId])
  const existing = node ? getNodeValue(node) : undefined
  if (!isRecord(existing)) return edit(text, ['providers', providerId], definition)
  return applyValueDiff(text, ['providers', providerId], existing, definition)
}

export function removeModelsProvider(text: string, providerId: string) {
  requireEditableDocument(text)
  return edit(text, ['providers', providerId], undefined)
}

export function renameModelsProvider(text: string, previousId: string, nextId: string) {
  if (nextId.length === 0 || nextId.length > 128) {
    throw new Error('The provider id must contain 1 to 128 characters.')
  }
  const { parsed, root } = requireEditableDocument(text)
  const provider = parsed.providers.find((candidate) => candidate.id === previousId)
  if (!provider) throw new Error('The provider no longer exists.')
  if (
    previousId !== nextId &&
    parsed.providers.some((candidate) =>
      candidate.id !== previousId &&
      candidate.id.toLowerCase() === nextId.toLowerCase())
  ) {
    throw new Error('A provider already uses that id.')
  }
  if (previousId === nextId) return text
  const providersNode = findNodeAtLocation(root, ['providers'])
  const propertyNode = providersNode?.children?.find((candidate) => {
    if (candidate.type !== 'property') return false
    const keyNode = candidate.children?.[0]
    return keyNode !== undefined && getNodeValue(keyNode) === previousId
  })
  const keyNode = propertyNode?.children?.[0]
  if (!keyNode) throw new Error('The provider id could not be located.')
  return `${text.slice(0, keyNode.offset)}${JSON.stringify(nextId)}${text.slice(keyNode.offset + keyNode.length)}`
}
