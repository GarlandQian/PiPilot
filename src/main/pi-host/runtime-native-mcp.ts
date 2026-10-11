import { readFileSync, realpathSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  createCodemodeExtension,
  createMcpExtension,
  createToolSearchExtension,
  getAgentDir,
  type InlineExtension,
  type LoadedMcpConfig,
  type McpServerConfig,
} from '@earendil-works/pi-coding-agent'
import { MCP_CONFIG_CONTENT_LIMIT } from '../../shared/mcp-config'
import type { LocalPiMcpServerStatus } from '../../shared/local-pi'
import { loadDefaultMcpTransports, McpStatusTracker, mcpStatusTracker, registerMcpStatusTracker } from './runtime-mcp-status'
import type { AgentSessionRuntime } from '@earendil-works/pi-coding-agent'
import { isMcpServerOverride, validateMcpServerDefinition } from '../../shared/mcp-config-parser'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function canonicalDirectory(path: string) {
  let canonical = resolve(path)
  try { canonical = realpathSync.native(canonical) } catch { /* A new profile may not exist yet. */ }
  return process.platform === 'win32' ? canonical.toLowerCase() : canonical
}

/** Pi 1.1 treats the old codemode-deferred exposure as an alias for codemode. */
function normalizeServerConfig(value: Record<string, unknown>): McpServerConfig {
  const exposure = (candidate: unknown) => candidate === 'codemode-deferred' ? 'codemode' : candidate
  return {
    ...value,
    ...(value.exposure !== undefined ? { exposure: exposure(value.exposure) } : {}),
    ...(isRecord(value.toolExposure) ? { toolExposure: Object.fromEntries(
      Object.entries(value.toolExposure).map(([name, setting]) => [name, exposure(setting)]),
    ) } : {}),
  } as McpServerConfig
}

/** Keep SDK sessions on their explicit agent directory, including isolated tests. */
export function loadRuntimeMcpConfig(
  agentDir: string,
  cwd: string,
  projectTrusted: boolean,
): LoadedMcpConfig {
  const servers = new Map<string, LoadedMcpConfig['servers'][number]>()
  const errors: string[] = []
  let autoEnableCodemode: boolean | undefined
  const projectConfig = projectTrusted ? join(cwd, '.pi', 'mcp.json') : undefined
  const targets = [
    { path: join(agentDir, 'mcp.json'), scope: 'global' as const },
    ...(projectTrusted
      ? [{ path: projectConfig!, scope: 'project' as const }]
      : []),
  ]
  for (const { path, scope } of targets) {
    let parsed: unknown
    try {
      const stat = statSync(path)
      if (!stat.isFile() || stat.size > MCP_CONFIG_CONTENT_LIMIT) {
        errors.push(`${path}: MCP configuration is not a readable, bounded file.`)
        continue
      }
      parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        // JSON.parse errors can contain credential-bearing source fragments.
        errors.push(`${path}: MCP configuration could not be read as JSON.`)
      }
      continue
    }
    if (!isRecord(parsed) || (parsed.mcpServers !== undefined && !isRecord(parsed.mcpServers))) {
      errors.push(`${path}: expected an object with an mcpServers object.`)
      continue
    }
    if (typeof parsed.autoEnableCodemode === 'boolean') {
      autoEnableCodemode = parsed.autoEnableCodemode
    } else if (parsed.autoEnableCodemode !== undefined) {
      errors.push(`${path}: autoEnableCodemode must be a boolean.`)
    }
    for (const [name, definition] of Object.entries(parsed.mcpServers ?? {})) {
      const error = validateMcpServerDefinition(name, definition, scope)
      if (error !== null) {
        // A malformed project override must not connect the global server of
        // the same name with a different address or previously enabled state.
        servers.delete(name)
        errors.push(`${path}: ${error}`)
        continue
      }
      if (scope === 'project' && isMcpServerOverride(definition)) {
        const base = servers.get(name)
        if (!base) {
          errors.push(`${path}: server "${name}" needs a global server to override.`)
          continue
        }
        servers.set(name, {
          ...base,
          config: normalizeServerConfig({ ...base.config, ...definition }),
          override: path,
        })
        continue
      }
      const clash = [...servers.keys()].find((other) => other !== name && other.replace(/-/gu, '_') === name.replace(/-/gu, '_'))
      if (clash) {
        errors.push(`${path}: server "${name}" conflicts with "${clash}".`)
        continue
      }
      servers.set(name, {
        name,
        config: normalizeServerConfig(definition as Record<string, unknown>),
        source: path,
        scope,
      })
    }
  }
  return {
    servers: [...servers.values()],
    errors,
    ...(autoEnableCodemode === undefined ? {} : { autoEnableCodemode }),
    ...(projectConfig ? { projectConfig } : {}),
  }
}

/**
 * Match the official CLI's built-in identities and replacement policy. A user
 * extension owning /mcp, codemode, or tool_search remains authoritative; no
 * package is installed, removed, or rewritten while a session is opened.
 */
export function createRuntimeNativeMcpExtensions(agentDir: string): InlineExtension[] {
  return [
    { name: 'codemode', factory: createCodemodeExtension(), builtin: true, replaceable: true },
    { name: 'tool-search', factory: createToolSearchExtension(), builtin: true, replaceable: true },
    {
      name: 'mcp',
      factory: async (pi) => {
        // The SDK currently exposes no public constructor for its OAuth
        // credential store; its default uses getAgentDir(), not loadConfig.
        // Refuse cross-directory credential access rather than silently using
        // the real profile when an isolated/custom Host was misconfigured.
        if (canonicalDirectory(getAgentDir()) !== canonicalDirectory(agentDir)) {
          throw new Error('Native MCP requires PI_CODING_AGENT_DIR to match the Host agent directory.')
        }
        // One tracker per conversation, found again by its Pi session id. If
        // Pi's transports cannot be loaded, MCP still runs, just unobserved.
        const createDefault = await loadDefaultMcpTransports().catch(() => null)
        const tracker = createDefault ? new McpStatusTracker(createDefault) : null
        let release: (() => void) | undefined
        pi.on('session_start', (_event, context) => {
          release?.()
          if (tracker) release = registerMcpStatusTracker(context.sessionManager.getSessionId(), tracker)
        })
        pi.on('session_shutdown', () => { release?.(); release = undefined })
        return createMcpExtension({
          loadConfig: (context) => loadRuntimeMcpConfig(agentDir, context.cwd, context.isProjectTrusted()),
          logPath: join(agentDir, 'mcp.log'),
          ...(tracker ? { createTransport: tracker.createTransport } : {}),
        })(pi)
      },
      builtin: true,
      replaceable: true,
    },
  ]
}

function usesOAuth(config: McpServerConfig) {
  if (!('url' in config) || (config as { auth?: unknown }).auth) return false
  return !Object.keys((config as { headers?: Record<string, unknown> }).headers ?? {}).some((header) => header.toLowerCase() === 'authorization')
}

/** Every MCP server this conversation knows of, with what its connection is doing now. */
export function runtimeMcpStatus(runtime: AgentSessionRuntime) {
  const { session } = runtime
  const config = loadRuntimeMcpConfig(runtime.services.agentDir, runtime.cwd, session.settingsManager.isProjectTrusted())
  const tracker = mcpStatusTracker(session.sessionId)
  const servers: LocalPiMcpServerStatus[] = config.servers.map((server) => {
    const enabled = (server.config as { enabled?: unknown }).enabled !== false
    const observed = enabled ? tracker?.observation(server.name) : undefined
    return {
      name: server.name.slice(0, 256),
      scope: server.scope ?? 'global',
      enabled,
      transport: 'url' in server.config ? 'http' as const : 'stdio' as const,
      state: !enabled ? 'disabled' as const : observed?.state ?? 'starting' as const,
      ...(observed?.state === 'connected' ? { tools: observed.tools } : {}),
      ...(observed?.error && observed.state !== 'connected' ? { error: observed.error } : {}),
      ...(observed?.stderr ? { stderr: observed.stderr } : {}),
      oauth: usesOAuth(server.config),
    }
  })
  // Servers that extensions registered connect too; they have no mcp.json entry.
  for (const name of tracker?.names() ?? []) {
    if (servers.some((server) => server.name === name)) continue
    const observed = tracker!.observation(name)!
    servers.push({ name: name.slice(0, 256), scope: 'extension', enabled: true, transport: 'stdio', state: observed.state,
      ...(observed.state === 'connected' ? { tools: observed.tools } : {}),
      ...(observed.error && observed.state !== 'connected' ? { error: observed.error } : {}),
      ...(observed.stderr ? { stderr: observed.stderr } : {}), oauth: false })
  }
  return { servers: servers.slice(0, 200), errors: config.errors.slice(0, 20).map((error) => error.slice(0, 2_000)) }
}
