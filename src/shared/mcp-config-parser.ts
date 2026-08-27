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
  mcpConfigDocumentSchema,
  type McpConfigDiagnostic,
  type McpConfigDocument,
  type McpConfigServer,
} from './mcp-config'

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
): McpConfigServer['transport'] {
  const selectors = [
    ['command', 'stdio'],
    ['url', 'http'],
    ['socket', 'socket'],
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
  const transport: McpConfigServer['transport'] = selected?.[1] ?? 'invalid'
  if (declared.length === 0 || valid.length > 1) {
    diagnostics.push(diagnosticAtPath(
      text,
      root,
      ['mcpServers', name],
      'MCP_TRANSPORT_INVALID',
      'A server must define exactly one non-empty command, url, or socket.',
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
  return transport
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

export function parseMcpConfigDocument(text: string): McpConfigDocument {
  const parseErrors: ParseError[] = []
  const root = parseTree(text, parseErrors, PARSE_OPTIONS)
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
        if (name.length === 0 || name.length > 128) {
          diagnostics.push(diagnostic(
            text,
            'MCP_SERVER_NAME_INVALID',
            'Server names must contain 1 to 128 characters.',
            0,
            0,
            `mcpServers.${name}`,
          ))
          continue
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
        servers.push({
          name,
          transport: transportFor(text, root, name, value, diagnostics),
          definition: value,
        })
      }
    }
  }

  return mcpConfigDocumentSchema.parse({
    servers,
    diagnostics: diagnostics.slice(0, MCP_CONFIG_DIAGNOSTIC_LIMIT),
    valid: diagnostics.length === 0,
  })
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
