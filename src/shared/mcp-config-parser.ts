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
  MCP_CONFIG_SERVER_LIMIT,
  MCP_CONFIG_DIAGNOSTIC_LIMIT,
  MCP_EXPOSURES,
  mcpConfigDocumentSchema,
  type McpConfigDiagnostic,
  type McpConfigDocument,
  type McpConfigServer,
  type McpConfigTarget,
} from './mcp-config'

const PARSE_OPTIONS = { allowTrailingComma: true, disallowComments: false }
const NATIVE_PARSE_OPTIONS = { allowTrailingComma: false, disallowComments: true }
const LEGACY_SERVER_FIELDS = [
  'inheritEnv', 'caFile', 'requestHeadersCommand', 'bearerToken', 'bearerTokenEnv',
  'bearerTokenStore', 'lifecycle', 'idleTimeout', 'requestTimeoutMs', 'exposeResources',
  'directTools', 'toolPrefix', 'includeTools', 'excludeTools', 'searchKeywords', 'approveTools',
  'debug', 'trace', 'httpTransport', 'pluginDataDir', 'literalEnv', 'protocolVersion', 'tasks',
] as const
const EDIT_OPTIONS = {
  formattingOptions: { insertSpaces: true, tabSize: 2, eol: '\n' },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Native project overrides change global-server settings without copying credentials. */
export function isMcpServerOverride(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && value.command === undefined && value.url === undefined && value.type === undefined
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
): McpConfigDiagnostic {
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

function transportFor(
  text: string,
  root: JsonNode,
  name: string,
  definition: Record<string, unknown>,
  diagnostics: McpConfigDiagnostic[],
  scope: McpConfigTarget['kind'],
): McpConfigServer['transport'] {
  const override = scope === 'project' && isMcpServerOverride(definition)
  const selectors = [
    ['command', 'stdio'],
    ['url', 'http'],
  ] as const
  const declared = selectors.filter(([field]) =>
    Object.prototype.hasOwnProperty.call(definition, field))
  for (const [field] of selectors) {
    if (
      Object.prototype.hasOwnProperty.call(definition, field) &&
      (typeof definition[field] !== 'string' || definition[field].trim().length === 0)
    ) {
      diagnostics.push(diagnosticAtPath(
        text,
        root,
        ['mcpServers', name, field],
        'MCP_TRANSPORT_VALUE_INVALID',
        `Server ${field} must be a non-empty string when present.`,
      ))
    }
  }
  const valid = selectors.filter(([field]) =>
    typeof definition[field] === 'string' && definition[field].trim().length > 0)
  const selected = valid.length === 1
    ? valid[0]
    : valid.length === 0 && declared.length === 1
      ? declared[0]
      : undefined
  const transport: McpConfigServer['transport'] = override ? 'override' : selected?.[1] ?? 'invalid'
  if ((!override && declared.length === 0) || valid.length > 1) {
    diagnostics.push(diagnosticAtPath(
      text,
      root,
      ['mcpServers', name],
      'MCP_TRANSPORT_INVALID',
      'A server must define exactly one non-empty command or URL.',
    ))
  }

  if (
    definition.args !== undefined &&
    (!Array.isArray(definition.args) || definition.args.some((value) => typeof value !== 'string'))
  ) {
    diagnostics.push(diagnosticAtPath(
      text,
      root,
      ['mcpServers', name, 'args'],
      'MCP_ARGS_INVALID',
      'Server args must be an array of strings.',
    ))
  }
  for (const field of ['env', 'headers'] as const) {
    const value = definition[field]
    if (
      value !== undefined &&
      (!isRecord(value) || Object.values(value).some((entry) => typeof entry !== 'string'))
    ) {
      diagnostics.push(diagnosticAtPath(
        text,
        root,
        ['mcpServers', name, field],
        `MCP_${field.toUpperCase()}_INVALID`,
        `Server ${field} must be an object of string values.`,
      ))
    }
  }
  const fieldError = (field: string, message: string) => diagnostics.push(diagnosticAtPath(
    text, root, ['mcpServers', name, ...field.split('.')], 'MCP_NATIVE_FIELD_INVALID', message,
  ))
  if (override) {
    for (const field of Object.keys(definition)) {
      if (!['enabled', 'exposure', 'toolExposure'].includes(field)) {
        fieldError(field, 'A project override can only set enabled, exposure, and toolExposure of a global server.')
      }
    }
  }
  if (definition.socket !== undefined) fieldError('socket', 'Native Pi MCP does not support Unix socket transport. Configure stdio or streamable HTTP instead.')
  if (definition.disabled !== undefined) fieldError('disabled', 'Native Pi uses enabled, not disabled. Convert this document to native JSON before saving.')
  for (const field of LEGACY_SERVER_FIELDS) {
    if (definition[field] !== undefined) fieldError(field, `Native Pi does not use the adapter field ${field}. Review or replace it explicitly before saving.`)
  }
  if (definition.type !== undefined && !['stdio', 'http', 'streamable-http'].includes(String(definition.type))) {
    fieldError('type', 'Native Pi supports stdio and streamable HTTP; legacy SSE is not supported.')
  } else if (definition.type !== undefined && (
    (transport === 'stdio' && definition.type !== 'stdio') ||
    (transport === 'http' && definition.type === 'stdio')
  )) fieldError('type', 'The transport type must match the command or URL.')
  if (transport === 'http' && typeof definition.url === 'string' && definition.url.trim()) {
    try {
      if (!['http:', 'https:'].includes(new URL(definition.url).protocol)) throw new Error()
    } catch { fieldError('url', 'Server URL must be an http or https URL.') }
  }
  if (definition.enabled !== undefined && typeof definition.enabled !== 'boolean') fieldError('enabled', 'Server enabled must be a boolean.')
  if (definition.description !== undefined && typeof definition.description !== 'string') fieldError('description', 'Server description must be a string.')
  if (definition.cwd !== undefined && typeof definition.cwd !== 'string') fieldError('cwd', 'Server cwd must be a string.')
  if (definition.timeout !== undefined && (typeof definition.timeout !== 'number' || !(definition.timeout > 0))) fieldError('timeout', 'Server timeout must be a positive number of seconds.')
  const isExposure = (value: unknown) => MCP_EXPOSURES.some((candidate) => candidate === value)
  if (definition.exposure !== undefined && !isExposure(definition.exposure)) fieldError('exposure', `Server exposure must be one of: ${MCP_EXPOSURES.join(', ')}.`)
  if (definition.toolExposure !== undefined && (!isRecord(definition.toolExposure) || Object.values(definition.toolExposure).some((value) => !isExposure(value)))) fieldError('toolExposure', 'toolExposure must map tool names or patterns to supported exposures.')
  if (definition.auth !== undefined) {
    if (scope === 'project') fieldError('auth', 'Provider authentication is only allowed in the global MCP configuration.')
    if (transport !== 'http') fieldError('auth', 'Provider authentication requires an HTTP server.')
    if (!isRecord(definition.auth) || typeof definition.auth.provider !== 'string' || !definition.auth.provider) {
      fieldError('auth.provider', 'Provider authentication must name a provider.')
    }
    try {
      const url = new URL(String(definition.url))
      if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error()
    } catch { fieldError('auth', 'Provider authentication requires HTTPS, or HTTP on a loopback host.') }
  }
  if (definition.oauth !== undefined) {
    const oauth = definition.oauth
    if (!isRecord(oauth)) fieldError('oauth', 'OAuth configuration must be an object.')
    else {
      for (const field of ['scopes', 'grantType', 'clientMetadataUrl', 'redirectUri', 'authorizationParams', 'authorizationUrl', 'tokenUrl', 'clientUri', 'logoUri', 'skipIssuerMetadataValidation']) {
        if (oauth[field] !== undefined) fieldError(`oauth.${field}`, `Native Pi does not use the adapter OAuth field ${field}. Review the native OAuth configuration before saving.`)
      }
      for (const key of ['clientId', 'clientSecret', 'scope']) {
        if (oauth[key] !== undefined && typeof oauth[key] !== 'string') fieldError(`oauth.${key}`, `OAuth ${key} must be a string.`)
      }
      if (oauth.clientName !== undefined && (typeof oauth.clientName !== 'string' || !oauth.clientName.trim())) fieldError('oauth.clientName', 'OAuth clientName must be a non-empty string.')
      const port = oauth.callbackPort
      if (port !== undefined && (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535)) fieldError('oauth.callbackPort', 'OAuth callbackPort must be between 1 and 65535.')
      if (oauth.callbackUrl !== undefined) {
        try {
          if (typeof oauth.callbackUrl !== 'string') throw new Error()
          const url = new URL(oauth.callbackUrl)
          if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.search || url.hash) throw new Error()
          if (url.port && port !== undefined && Number(url.port) !== port) fieldError('oauth.callbackUrl', 'OAuth callbackUrl and callbackPort must use the same port.')
        } catch { fieldError('oauth.callbackUrl', 'OAuth callbackUrl must be an HTTP loopback URL without a query or fragment.') }
      }
      if (oauth.clientRegistration !== undefined && oauth.clientRegistration !== 'dcr' && oauth.clientRegistration !== 'cimd') {
        fieldError('oauth.clientRegistration', 'OAuth clientRegistration must be dcr or cimd.')
      } else if (oauth.clientRegistration === 'cimd') {
        if (oauth.clientId !== undefined || oauth.clientName !== undefined) fieldError('oauth.clientRegistration', 'OAuth cimd registration cannot be combined with clientId or clientName.')
        if (typeof oauth.callbackUrl === 'string') {
          try {
            const callback = new URL(oauth.callbackUrl)
            if (callback.hostname === '[::1]' || callback.pathname !== '/callback') fieldError('oauth.callbackUrl', 'OAuth cimd registration requires a localhost or 127.0.0.1 callback with path /callback.')
          } catch { /* The callback URL diagnostic above already explains this value. */ }
        }
      }
      if (oauth.authServerMetadataUrl !== undefined) {
        try {
          if (typeof oauth.authServerMetadataUrl !== 'string') throw new Error()
          const url = new URL(oauth.authServerMetadataUrl)
          if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error()
        } catch { fieldError('oauth.authServerMetadataUrl', 'OAuth authServerMetadataUrl requires HTTPS, or HTTP on a loopback host.') }
      }
    }
  }
  return definition.socket !== undefined || definition.type === 'sse' ? 'invalid' : transport
}

function duplicateKeyDiagnostics(text: string) {
  const diagnostics: McpConfigDiagnostic[] = []
  const keysByObject = new Map<string, Set<string>>()
  visit(text, {
    onObjectProperty(property, offset, length, line, column, pathSupplier) {
      const objectPath = JSON.stringify(pathSupplier())
      const keys = keysByObject.get(objectPath) ?? new Set<string>()
      if (keys.has(property)) {
        diagnostics.push({
          code: 'MCP_DUPLICATE_KEY',
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

export function parseMcpConfigDocument(text: string, scope: McpConfigTarget['kind'] = 'global'): McpConfigDocument {
  const parseErrors: ParseError[] = []
  // Keep an editable projection of old JSONC, but never call it valid for Pi's JSON.parse reader.
  parseTree(text, parseErrors, NATIVE_PARSE_OPTIONS)
  const root = parseTree(text, [], PARSE_OPTIONS)
  const diagnostics = parseErrors.map((error) => diagnostic(
    text,
    `MCP_JSON_${printParseErrorCode(error.error).toUpperCase()}`,
    printParseErrorCode(error.error),
    error.offset,
    error.length,
  ))
  diagnostics.push(...duplicateKeyDiagnostics(text))
  const servers: McpConfigServer[] = []

  if (!root || root.type !== 'object') {
    if (parseErrors.length === 0) {
      diagnostics.push(diagnostic(
        text,
        'MCP_ROOT_INVALID',
        'The MCP configuration root must be an object.',
      ))
    }
  } else {
    const document = getNodeValue(root) as unknown
    if (!isRecord(document)) {
      diagnostics.push(diagnostic(text, 'MCP_ROOT_INVALID', 'The MCP configuration root must be an object.'))
    } else if (document.mcpServers !== undefined && !isRecord(document.mcpServers)) {
      diagnostics.push(diagnostic(
        text,
        'MCP_SERVERS_INVALID',
        'mcpServers must be an object.',
        0,
        0,
        'mcpServers',
      ))
    } else if (isRecord(document.mcpServers)) {
      for (const [name, value] of Object.entries(document.mcpServers)) {
        if (servers.length >= MCP_CONFIG_SERVER_LIMIT) {
          diagnostics.push(diagnostic(
            text,
            'MCP_SERVER_LIMIT',
            `At most ${MCP_CONFIG_SERVER_LIMIT} MCP servers are supported.`,
          ))
          break
        }
        if (name.length === 0 || name.length > 128 || !/^[A-Za-z0-9_-]+$/u.test(name)) {
          diagnostics.push(diagnostic(
            text,
            'MCP_SERVER_NAME_INVALID',
            'Server names must contain 1 to 128 letters, digits, underscores, or hyphens.',
            0,
            0,
            `mcpServers.${name}`,
          ))
          if (name.length === 0 || name.length > 128) continue
        }
        if (!isRecord(value)) {
          diagnostics.push(diagnostic(
            text,
            'MCP_SERVER_INVALID',
            'Each MCP server must be an object.',
            0,
            0,
            `mcpServers.${name}`,
          ))
          continue
        }
        const clash = servers.find((server) => server.name !== name && server.name.replace(/-/gu, '_') === name.replace(/-/gu, '_'))
        if (clash) diagnostics.push(diagnosticAtPath(text, root, ['mcpServers', name], 'MCP_SERVER_NAME_CONFLICT', `Server ${name} conflicts with ${clash.name} after namespace normalization.`))
        servers.push({
          name,
          transport: transportFor(text, root, name, value, diagnostics, scope),
          definition: value,
        })
      }
    }
    if (isRecord(document) && document.autoEnableCodemode !== undefined && typeof document.autoEnableCodemode !== 'boolean') {
      diagnostics.push(diagnosticAtPath(text, root, ['autoEnableCodemode'], 'MCP_NATIVE_FIELD_INVALID', 'autoEnableCodemode must be a boolean.'))
    }
    if (isRecord(document) && isRecord(document.settings)) {
      for (const field of ['auth', ...LEGACY_SERVER_FIELDS]) {
        if (document.settings[field] !== undefined) diagnostics.push(diagnosticAtPath(text, root, ['settings', field], 'MCP_LEGACY_SETTING_UNSUPPORTED', `Native Pi does not use adapter settings.${field}. Review its effect before saving.`))
      }
    }
  }

  return mcpConfigDocumentSchema.parse({
    servers,
    diagnostics: diagnostics.slice(0, MCP_CONFIG_DIAGNOSTIC_LIMIT),
    valid: diagnostics.length === 0,
  })
}

/** Explicit, previewable conversion only. Never writes or drops unsupported/unknown fields. */
export function convertMcpConfigToNativeJson(text: string): string {
  const errors: ParseError[] = []
  const root = parseTree(text, errors, PARSE_OPTIONS)
  if (!root || root.type !== 'object' || errors.length || duplicateKeyDiagnostics(text).length) {
    throw new Error('Fix invalid JSON syntax or duplicate keys before converting.')
  }
  const document = getNodeValue(root) as Record<string, unknown>
  if (isRecord(document.mcpServers)) {
    for (const definition of Object.values(document.mcpServers)) {
      if (!isRecord(definition) || typeof definition.disabled !== 'boolean') continue
      if (definition.enabled !== undefined && definition.enabled !== !definition.disabled) continue
      definition.enabled = !definition.disabled
      delete definition.disabled
    }
  }
  return `${JSON.stringify(document, null, 2)}\n`
}

export function validateMcpServerDefinition(name: string, definition: unknown, scope: McpConfigTarget['kind'] = 'global'): string | null {
  const parsed = parseMcpConfigDocument(JSON.stringify({ mcpServers: { [name]: definition } }), scope)
  return parsed.diagnostics[0]?.message ?? null
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
  const parsed = parseMcpConfigDocument(text)
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
 * Apply the smallest possible JSONC edits. Replacing a whole server object
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

export function upsertMcpServer(
  text: string,
  name: string,
  definition: Record<string, unknown>,
) {
  if (name.length === 0 || name.length > 128) {
    throw new Error('The MCP server name must contain 1 to 128 characters.')
  }
  const { parsed } = requireEditableDocument(text)
  const existing = parsed.servers.find((server) => server.name === name)
  if (!existing) return edit(text, ['mcpServers', name], definition)
  return applyValueDiff(text, ['mcpServers', name], existing.definition, definition)
}

export function removeMcpServer(text: string, name: string) {
  requireEditableDocument(text)
  return edit(text, ['mcpServers', name], undefined)
}

export function renameMcpServer(text: string, previousName: string, nextName: string) {
  if (nextName.length === 0 || nextName.length > 128) {
    throw new Error('The MCP server name must contain 1 to 128 characters.')
  }
  const { parsed, root } = requireEditableDocument(text)
  const server = parsed.servers.find((candidate) => candidate.name === previousName)
  if (!server) throw new Error('The MCP server no longer exists.')
  if (previousName !== nextName && parsed.servers.some((candidate) => candidate.name === nextName)) {
    throw new Error('An MCP server already uses that name.')
  }
  if (previousName === nextName) return text
  const serversNode = findNodeAtLocation(root, ['mcpServers'])
  const propertyNode = serversNode?.children?.find((candidate) => {
    if (candidate.type !== 'property') return false
    const keyNode = candidate.children?.[0]
    return keyNode !== undefined && getNodeValue(keyNode) === previousName
  })
  const keyNode = propertyNode?.children?.[0]
  if (!keyNode) throw new Error('The MCP server name could not be located.')
  return `${text.slice(0, keyNode.offset)}${JSON.stringify(nextName)}${text.slice(keyNode.offset + keyNode.length)}`
}

export function parseMcpServerJson(text: string) {
  const errors: ParseError[] = []
  const root: JsonNode | undefined = parseTree(text, errors, PARSE_OPTIONS)
  if (!root || root.type !== 'object' || errors.length > 0) {
    throw new Error('The advanced server JSON must be one valid object.')
  }
  const value = getNodeValue(root) as unknown
  if (!isRecord(value)) throw new Error('The advanced server JSON must be an object.')
  return value
}
