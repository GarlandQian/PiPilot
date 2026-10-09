import { isSecretName } from '../editor-page'
import { cloneJson, isLiteralSecret, isRecord, MASKED_SECRET, type JsonRecord } from '../models/provider-editor-model'

/*
 * The MCP server page edits the server's raw mcp.json definition: fields the
 * page does not show (oauth, toolExposure, type, anything newer) survive an
 * edit unchanged, and the JSON view says how many there are.
 */

export type McpTransport = 'stdio' | 'http'

const STDIO_FIELDS = ['command', 'args', 'env', 'cwd'] as const
const HTTP_FIELDS = ['url', 'headers'] as const
/** What the page shows; everything else is kept as it is. */
const PAGE_FIELDS = new Set<string>([...STDIO_FIELDS, ...HTTP_FIELDS, 'enabled', 'exposure', 'timeout', 'description'])

export function transportOf(definition: JsonRecord): McpTransport {
  return typeof definition.url === 'string' && typeof definition.command !== 'string' ? 'http' : 'stdio'
}

/** Fields the page leaves to the JSON view. */
export function preservedFields(definition: JsonRecord) {
  return Object.keys(definition).filter((key) => !PAGE_FIELDS.has(key))
}

/** Switch transport; the other side's fields are kept aside, so switching back restores them. */
export function withTransport(definition: JsonRecord, transport: McpTransport, stash: JsonRecord): { definition: JsonRecord; stash: JsonRecord } {
  const leaving = transport === 'http' ? STDIO_FIELDS : HTTP_FIELDS
  const arriving = transport === 'http' ? HTTP_FIELDS : STDIO_FIELDS
  const next = { ...definition }
  const nextStash = { ...stash }
  for (const field of leaving) {
    if (next[field] !== undefined) nextStash[field] = next[field]
    delete next[field]
  }
  for (const field of arriving) {
    if (nextStash[field] !== undefined && next[field] === undefined) next[field] = nextStash[field]
    delete nextStash[field]
  }
  if (transport === 'http' && typeof next.url !== 'string') next.url = ''
  if (transport === 'stdio' && typeof next.command !== 'string') next.command = ''
  // `type` must match the transport; Pi infers it anyway.
  if (next.type !== undefined) delete next.type
  return { definition: next, stash: nextStash }
}

/** Arguments one per line; blank lines dropped. */
export function argsFromLines(text: string) {
  return text.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean)
}

/* ------------------------------ secrets ------------------------------ */

function secretPaths(definition: JsonRecord) {
  const paths: [string, string][] = []
  for (const field of ['env', 'headers'] as const) {
    const record = definition[field]
    if (!isRecord(record)) continue
    for (const [name, value] of Object.entries(record)) {
      if (typeof value === 'string' && isSecretName(name) && isLiteralSecret(value) && !value.includes('${')) paths.push([field, name])
    }
  }
  return paths
}

export function maskMcpSecrets(definition: JsonRecord): JsonRecord {
  const masked = cloneJson(definition)
  for (const [field, name] of secretPaths(definition)) (masked[field] as JsonRecord)[name] = MASKED_SECRET
  return masked
}

/** A value still shown masked keeps the saved one; anything typed replaces it. */
export function restoreMcpSecrets(edited: JsonRecord, original: JsonRecord): JsonRecord {
  const restored = cloneJson(edited)
  for (const field of ['env', 'headers'] as const) {
    const record = restored[field]
    const previous = original[field]
    if (!isRecord(record)) continue
    for (const [name, value] of Object.entries(record)) {
      if (value === MASKED_SECRET) record[name] = isRecord(previous) && typeof previous[name] === 'string' ? previous[name] : ''
    }
  }
  return restored
}

/* ----------------------------- validation ---------------------------- */

export interface McpEditorIssues {
  name?: 'required' | 'invalid' | 'taken'
  command?: 'required'
  url?: 'required' | 'invalid'
  timeout?: 'invalid'
  json?: string
  /** What Pi itself says is wrong with the definition. */
  pi?: string
}

export function mcpEditorIssues(name: string, definition: JsonRecord, takenNames: readonly string[], piMessage: string | null, json?: string): McpEditorIssues {
  const issues: McpEditorIssues = {}
  const trimmed = name.trim()
  if (!trimmed) issues.name = 'required'
  else if (!/^[A-Za-z0-9_-]{1,128}$/u.test(trimmed)) issues.name = 'invalid'
  else if (takenNames.some((taken) => taken.toLowerCase() === trimmed.toLowerCase())) issues.name = 'taken'
  if (transportOf(definition) === 'stdio') {
    if (typeof definition.command !== 'string' || !definition.command.trim()) issues.command = 'required'
  } else {
    const url = typeof definition.url === 'string' ? definition.url.trim() : ''
    if (!url) issues.url = 'required'
    else {
      try {
        if (!['http:', 'https:'].includes(new URL(url).protocol)) issues.url = 'invalid'
      } catch {
        issues.url = 'invalid'
      }
    }
  }
  if (definition.timeout !== undefined && !(typeof definition.timeout === 'number' && definition.timeout > 0)) issues.timeout = 'invalid'
  if (json) issues.json = json
  if (piMessage && !issues.name && !issues.command && !issues.url && !issues.timeout) issues.pi = piMessage
  return issues
}

export const hasMcpIssues = (issues: McpEditorIssues) => Object.values(issues).some(Boolean)

/** The definition as saved: trimmed command and address, empty optional fields left out. */
export function preparedMcpDefinition(definition: JsonRecord): JsonRecord {
  const next = { ...definition }
  if (typeof next.command === 'string') next.command = next.command.trim()
  if (typeof next.url === 'string') next.url = next.url.trim()
  for (const field of ['args', 'env', 'headers'] as const) {
    const value = next[field]
    if ((Array.isArray(value) && value.length === 0) || (isRecord(value) && Object.keys(value).length === 0)) delete next[field]
  }
  for (const field of ['cwd', 'description'] as const) if (next[field] === '') delete next[field]
  return next
}

/** A name nobody uses yet: "playwright", then "playwright-2"… */
export function uniqueMcpName(base: string, taken: readonly string[]) {
  const occupied = new Set(taken.map((name) => name.toLowerCase()))
  let candidate = base
  for (let suffix = 2; occupied.has(candidate.toLowerCase()); suffix += 1) candidate = `${base}-${suffix}`
  return candidate
}
