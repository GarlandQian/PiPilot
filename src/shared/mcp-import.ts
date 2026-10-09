import { parse as parseJsonc, type ParseError } from 'jsonc-parser'

/*
 * MCP servers written for other apps, turned into Pi's mcp.json shape (see
 * Pi's docs/mcp.md, "Set up servers"). Everything here only reads: what an
 * app's file says is converted, nothing is written back.
 */

export type McpImportFormat = 'mcpServers' | 'vscode' | 'opencode' | 'codex' | 'gemini' | 'windsurf' | 'single' | 'command'

export interface McpImportedServer {
  name: string
  definition: Record<string, unknown>
  /** What could not be carried over, as message keys with values. */
  notes: McpImportNote[]
}

export type McpImportNote =
  | { kind: 'sse' }
  | { kind: 'dropped'; fields: string[] }
  | { kind: 'input-variables' }
  | { kind: 'renamed'; from: string }

export interface McpImportResult {
  format: McpImportFormat
  servers: McpImportedServer[]
}

type JsonRecord = Record<string, unknown>

const isRecord = (value: unknown): value is JsonRecord => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Pi accepts letters, digits, _ and - in names (tools are mcp__<name>__<tool>). */
export function mcpServerName(raw: string) {
  return raw.trim().replace(/[^A-Za-z0-9_-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 128) || 'server'
}

const stringRecord = (value: unknown) => isRecord(value)
  ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  : undefined

const stringArray = (value: unknown) => Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : undefined

/** The fields every client shares, in Pi's names. */
function commonDefinition(raw: JsonRecord, notes: McpImportNote[], options: { url?: unknown; sseUrl?: unknown; timeoutMs?: boolean; known?: readonly string[] } = {}) {
  const definition: JsonRecord = {}
  const url = typeof options.url === 'string' ? options.url : typeof raw.url === 'string' ? raw.url : undefined
  const type = typeof raw.type === 'string' ? raw.type.toLowerCase() : undefined
  if (typeof raw.command === 'string' && raw.command.trim()) {
    definition.command = raw.command
    const args = stringArray(raw.args)
    if (args?.length) definition.args = args
    const env = stringRecord(raw.env)
    if (env && Object.keys(env).length) definition.env = env
    if (typeof raw.cwd === 'string' && raw.cwd) definition.cwd = raw.cwd
  } else if (url || typeof options.sseUrl === 'string') {
    definition.url = url ?? options.sseUrl
    // Pi speaks streamable HTTP only; most servers serve it too, often at /mcp.
    if (type === 'sse' || (!url && typeof options.sseUrl === 'string')) notes.push({ kind: 'sse' })
    const headers = stringRecord(raw.headers)
    if (headers && Object.keys(headers).length) definition.headers = headers
  }
  if (typeof raw.timeout === 'number' && raw.timeout > 0) definition.timeout = options.timeoutMs ? Math.max(1, Math.round(raw.timeout / 1000)) : raw.timeout
  if (raw.enabled === false || raw.disabled === true) definition.enabled = false
  if (typeof raw.description === 'string' && raw.description) definition.description = raw.description
  const used = new Set(['command', 'args', 'env', 'cwd', 'url', 'headers', 'type', 'timeout', 'enabled', 'disabled', 'description', ...(options.known ?? [])])
  const dropped = Object.keys(raw).filter((key) => !used.has(key))
  if (dropped.length) notes.push({ kind: 'dropped', fields: dropped })
  return definition
}

/** VS Code asks for `${input:id}` when starting; Pi reads `${ID}` from the environment. */
function replaceInputs(definition: JsonRecord, notes: McpImportNote[]) {
  let replaced = false
  const swap = (value: string) => value.replace(/\$\{input:([^}]+)\}/gu, (_, id: string) => {
    replaced = true
    return `\${${id.replace(/[^A-Za-z0-9_]+/gu, '_').toUpperCase()}}`
  })
  for (const field of ['env', 'headers'] as const) {
    const record = definition[field]
    if (isRecord(record)) definition[field] = Object.fromEntries(Object.entries(record).map(([key, value]) => [key, typeof value === 'string' ? swap(value) : value]))
  }
  if (Array.isArray(definition.args)) definition.args = definition.args.map((value) => typeof value === 'string' ? swap(value) : value)
  if (replaced) notes.push({ kind: 'input-variables' })
  return definition
}

function fromEntries(record: JsonRecord, convert: (raw: JsonRecord, notes: McpImportNote[]) => JsonRecord | null): McpImportedServer[] {
  return Object.entries(record).flatMap(([rawName, raw]) => {
    if (!isRecord(raw)) return []
    const notes: McpImportNote[] = []
    const definition = convert(raw, notes)
    if (!definition || (!definition.command && !definition.url)) return []
    const name = mcpServerName(rawName)
    if (name !== rawName) notes.push({ kind: 'renamed', from: rawName })
    return [{ name, definition, notes }]
  })
}

const opencodeVariables = (value: string) => value.replace(/\{env:([A-Za-z_][A-Za-z0-9_]*)\}/gu, '${$1}')

function opencodeServer(raw: JsonRecord, notes: McpImportNote[]) {
  const definition: JsonRecord = {}
  if (raw.type === 'local' || Array.isArray(raw.command)) {
    const command = stringArray(raw.command) ?? []
    if (!command[0]) return null
    definition.command = command[0]
    if (command.length > 1) definition.args = command.slice(1).map(opencodeVariables)
    const env = stringRecord(raw.environment)
    if (env && Object.keys(env).length) definition.env = Object.fromEntries(Object.entries(env).map(([key, value]) => [key, opencodeVariables(value)]))
  } else if (typeof raw.url === 'string') {
    definition.url = raw.url
    const headers = stringRecord(raw.headers)
    if (headers && Object.keys(headers).length) definition.headers = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, opencodeVariables(value)]))
  } else return null
  if (raw.enabled === false) definition.enabled = false
  if (typeof raw.timeout === 'number' && raw.timeout > 0) definition.timeout = Math.max(1, Math.round(raw.timeout / 1000))
  const dropped = Object.keys(raw).filter((key) => !['type', 'command', 'environment', 'url', 'headers', 'enabled', 'timeout'].includes(key))
  if (dropped.length) notes.push({ kind: 'dropped', fields: dropped })
  return definition
}

function geminiServer(raw: JsonRecord, notes: McpImportNote[]) {
  // Gemini CLI: httpUrl is streamable HTTP, url is SSE; timeout is in milliseconds.
  return commonDefinition(raw, notes, { url: raw.httpUrl, sseUrl: raw.url, timeoutMs: true, known: ['httpUrl', 'trust'] })
}

function windsurfServer(raw: JsonRecord, notes: McpImportNote[]) {
  return commonDefinition(raw, notes, { url: raw.serverUrl ?? raw.url, known: ['serverUrl'] })
}

/* ------------------------------ Codex TOML ----------------------------- */

/**
 * Enough TOML for Codex's `[mcp_servers.<name>]` tables: strings, numbers,
 * booleans, arrays and inline tables, and `[mcp_servers.<name>.env]`
 * sub-tables. Other tables are skipped.
 */
export function parseCodexMcpToml(text: string): JsonRecord {
  const servers: JsonRecord = {}
  let target: JsonRecord | null = null
  let index = 0
  const peek = () => text[index]
  const skipSpace = (newlines = false) => {
    for (;;) {
      const character = peek()
      if (character === ' ' || character === '\t' || character === '\r' || (newlines && character === '\n')) index += 1
      else if (character === '#') { while (index < text.length && peek() !== '\n') index += 1 }
      else return
    }
  }
  const fail = (): never => { throw new Error(`TOML syntax error near character ${index}`) }
  const readKey = () => {
    skipSpace()
    if (peek() === '"' || peek() === "'") return readString()
    const start = index
    while (index < text.length && /[A-Za-z0-9_-]/u.test(peek()!)) index += 1
    if (start === index) fail()
    return text.slice(start, index)
  }
  const readDottedKey = () => {
    const parts = [readKey()]
    skipSpace()
    while (peek() === '.') { index += 1; parts.push(readKey()); skipSpace() }
    return parts
  }
  const readString = (): string => {
    const quote = peek()!
    if (text.startsWith(quote.repeat(3), index)) {
      index += 3
      if (peek() === '\n') index += 1
      const end = text.indexOf(quote.repeat(3), index)
      if (end < 0) fail()
      const value = text.slice(index, end)
      index = end + 3
      return quote === '"' ? value.replace(/\\(["\\nt])/gu, (_, escaped: string) => escaped === 'n' ? '\n' : escaped === 't' ? '\t' : escaped) : value
    }
    index += 1
    let value = ''
    while (index < text.length && peek() !== quote) {
      if (peek() === '\n') fail()
      if (quote === '"' && peek() === '\\') {
        index += 1
        const escaped = peek()
        if (escaped === 'u' || escaped === 'U') {
          const length = escaped === 'u' ? 4 : 8
          value += String.fromCodePoint(Number.parseInt(text.slice(index + 1, index + 1 + length), 16))
          index += length + 1
          continue
        }
        value += ({ n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', '"': '"', '\\': '\\' } as Record<string, string>)[escaped!] ?? fail()
        index += 1
        continue
      }
      value += peek()
      index += 1
    }
    if (peek() !== quote) fail()
    index += 1
    return value
  }
  const readValue = (): unknown => {
    skipSpace()
    const character = peek()
    if (character === '"' || character === "'") return readString()
    if (character === '[') {
      index += 1
      const values: unknown[] = []
      for (;;) {
        skipSpace(true)
        if (peek() === ']') { index += 1; return values }
        values.push(readValue())
        skipSpace(true)
        if (peek() === ',') index += 1
        else if (peek() !== ']') fail()
      }
    }
    if (character === '{') {
      index += 1
      const table: JsonRecord = {}
      skipSpace()
      if (peek() === '}') { index += 1; return table }
      for (;;) {
        const key = readDottedKey()
        if (peek() !== '=') fail()
        index += 1
        assign(table, key, readValue())
        skipSpace()
        if (peek() === ',') { index += 1; continue }
        if (peek() === '}') { index += 1; return table }
        fail()
      }
    }
    const start = index
    while (index < text.length && !/[\s,\]}#]/u.test(peek()!)) index += 1
    const word = text.slice(start, index)
    if (word === 'true') return true
    if (word === 'false') return false
    const number = Number(word.replace(/_/gu, ''))
    if (word && Number.isFinite(number)) return number
    return fail()
  }
  const assign = (table: JsonRecord, path: readonly string[], value: unknown) => {
    let current = table
    for (const part of path.slice(0, -1)) {
      if (!isRecord(current[part])) current[part] = {}
      current = current[part] as JsonRecord
    }
    current[path[path.length - 1]!] = value
  }
  while (index < text.length) {
    skipSpace(true)
    if (index >= text.length) break
    if (peek() === '[') {
      const array = text.startsWith('[[', index)
      index += array ? 2 : 1
      const path = readDottedKey()
      if (!text.startsWith(array ? ']]' : ']', index)) fail()
      index += array ? 2 : 1
      target = !array && path[0] === 'mcp_servers' && path.length >= 2 ? (() => {
        if (!isRecord(servers[path[1]!])) servers[path[1]!] = {}
        let table = servers[path[1]!] as JsonRecord
        for (const part of path.slice(2)) {
          if (!isRecord(table[part])) table[part] = {}
          table = table[part] as JsonRecord
        }
        return table
      })() : null
      continue
    }
    const key = readDottedKey()
    if (peek() !== '=') fail()
    index += 1
    const value = readValue()
    if (target) assign(target, key, value)
    else if (key[0] === 'mcp_servers' && key.length >= 3) {
      if (!isRecord(servers[key[1]!])) servers[key[1]!] = {}
      assign(servers[key[1]!] as JsonRecord, key.slice(2), value)
    }
    skipSpace()
    if (index < text.length && peek() !== '\n') fail()
  }
  return servers
}

function codexServer(raw: JsonRecord, notes: McpImportNote[]) {
  const definition = commonDefinition(raw, notes, {
    known: ['bearer_token_env_var', 'http_headers', 'env_http_headers', 'startup_timeout_sec', 'startup_timeout_ms', 'tool_timeout_sec', 'enabled_tools', 'disabled_tools'],
  })
  if (definition.url) {
    const headers: Record<string, string> = { ...stringRecord(raw.http_headers) }
    for (const [header, variable] of Object.entries(stringRecord(raw.env_http_headers) ?? {})) headers[header] = `\${${variable}}`
    if (typeof raw.bearer_token_env_var === 'string') headers.Authorization = `Bearer \${${raw.bearer_token_env_var}}`
    if (Object.keys(headers).length) definition.headers = headers
  }
  if (typeof raw.tool_timeout_sec === 'number' && raw.tool_timeout_sec > 0) definition.timeout = raw.tool_timeout_sec
  const unsupported = ['enabled_tools', 'disabled_tools'].filter((key) => raw[key] !== undefined)
  if (unsupported.length) notes.push({ kind: 'dropped', fields: unsupported })
  return definition
}

/* ----------------------------- command line ---------------------------- */

/** "npx -y @playwright/mcp@latest" → command and arguments, quotes respected. */
export function splitCommandLine(line: string) {
  const words: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let started = false
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]!
    if (quote) {
      if (character === quote) quote = null
      else if (character === '\\' && quote === '"' && index + 1 < line.length) current += line[++index]
      else current += character
    } else if (character === '"' || character === "'") { quote = character; started = true }
    else if (/\s/u.test(character)) { if (started) words.push(current); current = ''; started = false }
    else if (character === '\\' && index + 1 < line.length) { current += line[++index]; started = true }
    else { current += character; started = true }
  }
  if (started) words.push(current)
  return words
}

/** A short name from the package or program: "@playwright/mcp@latest" → "playwright". */
function nameFromCommand(words: readonly string[]) {
  const target = words.slice(1).find((word) => !word.startsWith('-')) ?? words[0] ?? 'server'
  const base = target.replace(/@[^/@]*$/u, '').split('/').filter(Boolean)
  const scoped = base[0]?.startsWith('@') ? base[0].slice(1) : undefined
  const last = (base[base.length - 1] ?? target).replace(/^(mcp-server-|server-)/u, '').replace(/(-mcp|-mcp-server)$/u, '')
  return mcpServerName(last === 'mcp' && scoped ? scoped : last)
}

/* -------------------------------- detect ------------------------------- */

const LAUNCHERS = /^(npx|pnpx|bunx|uvx|uv|pipx|pnpm|yarn|npm|node|deno|bun|python3?|py|docker|podman|go|cargo|java|dotnet|ruby|php|cmd|powershell|pwsh)(\.exe|\.cmd)?$/iu

/** Servers from pasted text or an app's file: JSON in any client's shape, Codex TOML, or one command line. */
export function parseMcpImport(text: string, hint?: McpImportFormat): McpImportResult | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('{')) {
    const errors: ParseError[] = []
    const value: unknown = parseJsonc(trimmed, errors, { allowTrailingComma: true })
    if (errors.length || !isRecord(value)) return null
    if (hint === 'gemini' && isRecord(value.mcpServers)) return { format: 'gemini', servers: fromEntries(value.mcpServers, geminiServer) }
    if (hint === 'windsurf' && isRecord(value.mcpServers)) return { format: 'windsurf', servers: fromEntries(value.mcpServers, windsurfServer) }
    if (isRecord(value.mcpServers)) {
      // Gemini's httpUrl and Windsurf's serverUrl show which app wrote it.
      const entries = Object.values(value.mcpServers).filter(isRecord)
      const convert = entries.some((entry) => 'httpUrl' in entry) ? geminiServer : entries.some((entry) => 'serverUrl' in entry) ? windsurfServer : (raw: JsonRecord, notes: McpImportNote[]) => commonDefinition(raw, notes)
      return { format: 'mcpServers', servers: fromEntries(value.mcpServers, convert) }
    }
    const vscode = isRecord(value.servers) ? value.servers : isRecord(value.mcp) && isRecord(value.mcp.servers) ? value.mcp.servers : isRecord(value['mcp.servers']) ? value['mcp.servers'] : null
    if (vscode) return { format: 'vscode', servers: fromEntries(vscode, (raw, notes) => replaceInputs(commonDefinition(raw, notes, { known: ['envFile'] }), notes)) }
    if (isRecord(value.mcp) && Object.values(value.mcp).some((entry) => isRecord(entry) && (entry.type === 'local' || entry.type === 'remote'))) {
      return { format: 'opencode', servers: fromEntries(value.mcp, opencodeServer) }
    }
    if (typeof value.command === 'string' || typeof value.url === 'string') {
      const notes: McpImportNote[] = []
      const definition = commonDefinition(value, notes, { known: ['name'] })
      const words = typeof value.command === 'string' ? [value.command, ...(stringArray(value.args) ?? [])] : []
      const name = typeof value.name === 'string' ? mcpServerName(value.name)
        : words.length ? nameFromCommand(words) : mcpServerName(new URL(String(value.url), 'http://x').hostname.split('.').slice(-2, -1)[0] ?? 'server')
      return { format: 'single', servers: [{ name, definition, notes }] }
    }
    // A bare map of names to servers.
    const servers = fromEntries(value, (raw, notes) => commonDefinition(raw, notes))
    return servers.length ? { format: 'mcpServers', servers } : null
  }
  if (/^\s*\[mcp_servers\.|^\s*mcp_servers\./mu.test(trimmed) || hint === 'codex') {
    try {
      return { format: 'codex', servers: fromEntries(parseCodexMcpToml(trimmed), codexServer) }
    } catch {
      return null
    }
  }
  if (!trimmed.includes('\n')) {
    let words = splitCommandLine(trimmed)
    // "claude mcp add <name> -- npx …" and "pi mcp add <name> -- …"
    const separator = words.indexOf('--')
    let name: string | undefined
    if (/^(claude|pi|codex)$/u.test(words[0] ?? '') && words[1] === 'mcp' && words[2] === 'add' && separator > 3) {
      name = words.slice(3, separator).find((word) => !word.startsWith('-'))
      words = words.slice(separator + 1)
    }
    if (!words[0] || /[{}]/u.test(trimmed)) return null
    if (/^https?:\/\//u.test(words[0])) {
      return { format: 'command', servers: [{ name: mcpServerName(name ?? new URL(words[0]).hostname.split('.').slice(-2, -1)[0] ?? 'server'), definition: { url: words[0] }, notes: [] }] }
    }
    // A program people start MCP servers with, or a path to one; not just any sentence.
    if (!name && !LAUNCHERS.test(words[0]) && !/[\\/]/u.test(words[0])) return null
    return { format: 'command', servers: [{ name: name ? mcpServerName(name) : nameFromCommand(words), definition: { command: words[0], ...(words.length > 1 ? { args: words.slice(1) } : {}) }, notes: [] }] }
  }
  return null
}
