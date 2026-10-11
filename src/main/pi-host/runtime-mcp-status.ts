import type { McpTransportFactory } from '@earendil-works/pi-coding-agent'
import type { LocalPiMcpServerStatus } from '../../shared/local-pi'

/**
 * Pi's own default transport factory (stdio, streamable HTTP), loaded from the
 * same module file Pi itself loads lazily, so its transport classes — and its
 * `instanceof StdioTransport` stderr handling — stay one and the same.
 */
let defaultTransports: Promise<McpTransportFactory> | null = null
export function loadDefaultMcpTransports() {
  defaultTransports ??= (async () => {
    const index = import.meta.resolve('@earendil-works/pi-coding-agent')
    const runtime = await import(/* @vite-ignore */ new URL('./extensions/mcp/runtime.js', index).href) as { createDefaultTransport?: McpTransportFactory }
    if (typeof runtime.createDefaultTransport !== 'function') throw new Error('Pi MCP transports are unavailable.')
    return runtime.createDefaultTransport
  })()
  return defaultTransports
}

type Transport = ReturnType<McpTransportFactory>
type Entry = Parameters<McpTransportFactory>[0]
type Message = { id?: unknown; method?: unknown; result?: unknown; error?: unknown }

const ERROR_LIMIT = 2_000
const STDERR_LIMIT = 4_000

interface ServerObservation {
  state: Exclude<LocalPiMcpServerStatus['state'], 'disabled' | 'starting'>
  tools: number
  error?: string
  transport: Transport
}

function messageOf(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, ERROR_LIMIT)
}

function needsSignIn(error: unknown) {
  const name = error instanceof Error ? error.name : ''
  return /Unauthorized/iu.test(name) || /\b401\b|requires sign-in|invalid_token/iu.test(messageOf(error))
}

/**
 * What one conversation's MCP connections are doing, learned from the
 * JSON-RPC traffic of each transport: connecting, initialized, how many tools
 * the server listed, and why a connection failed or closed.
 */
export class McpStatusTracker {
  private readonly servers = new Map<string, ServerObservation>()
  private readonly listeners = new Set<() => void>()

  subscribe(listener: () => void) {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  observation(name: string) {
    const server = this.servers.get(name)
    if (!server) return undefined
    const stderr = (server.transport as { stderr?: unknown }).stderr
    return {
      state: server.state,
      tools: server.tools,
      ...(server.error ? { error: server.error } : {}),
      ...(typeof stderr === 'string' && stderr.trim() ? { stderr: stderr.trim().slice(-STDERR_LIMIT) } : {}),
    }
  }

  names() { return [...this.servers.keys()] }

  constructor(private readonly createDefault: McpTransportFactory) {}

  readonly createTransport: McpTransportFactory = (entry: Entry, cwd, authProvider) => {
    const transport = this.createDefault(entry, cwd, authProvider)
    this.observe(entry.name, transport)
    return transport
  }

  private observe(name: string, transport: Transport) {
    const server: ServerObservation = { state: 'connecting', tools: 0, transport }
    this.servers.set(name, server)
    this.changed()
    const requests = new Map<unknown, string>()
    const current = () => this.servers.get(name) === server
    const fail = (error: unknown) => {
      if (!current()) return
      server.state = needsSignIn(error) ? 'needs-auth' : 'failed'
      server.error = messageOf(error)
      this.changed()
    }
    // Same object, two methods observed: Pi's `instanceof` checks still hold.
    const start = transport.start.bind(transport)
    transport.start = async () => {
      try { await start() } catch (error) { fail(error); throw error }
    }
    const send = transport.send.bind(transport)
    transport.send = async (message) => {
      const request = message as Message
      if (typeof request.method === 'string' && request.id !== undefined) requests.set(request.id, request.method)
      if (request.method === 'initialize') server.tools = 0
      try { await send(message) } catch (error) { if (request.method === 'initialize') fail(error); throw error }
    }
    transport.onMessage((message) => {
      const response = message as Message
      const method = requests.get(response.id)
      if (method === undefined || !current()) return
      requests.delete(response.id)
      if (response.error) {
        if (method === 'initialize') fail(new Error(typeof (response.error as { message?: unknown }).message === 'string' ? (response.error as { message: string }).message : 'Initialization failed'))
        return
      }
      if (method === 'initialize') {
        server.state = 'connected'
        server.error = undefined
        this.changed()
      } else if (method === 'tools/list') {
        const tools = (response.result as { tools?: unknown } | undefined)?.tools
        if (Array.isArray(tools)) {
          server.tools += tools.length
          this.changed()
        }
      }
    })
    transport.onError((error) => {
      if (!current()) return
      server.error = messageOf(error)
      if (server.state === 'connecting') server.state = needsSignIn(error) ? 'needs-auth' : 'failed'
      this.changed()
    })
    transport.onClose(() => {
      if (!current()) return
      if (server.state === 'connected' || server.state === 'connecting') server.state = 'disconnected'
      this.changed()
    })
  }

  private changed() {
    for (const listener of this.listeners) {
      try { listener() } catch { /* isolate observers */ }
    }
  }
}

/** Each open conversation's tracker, by Pi session id. */
const trackers = new Map<string, McpStatusTracker>()

export function registerMcpStatusTracker(sessionId: string, tracker: McpStatusTracker) {
  trackers.set(sessionId, tracker)
  return () => { if (trackers.get(sessionId) === tracker) trackers.delete(sessionId) }
}

export function mcpStatusTracker(sessionId: string) {
  return trackers.get(sessionId)
}
