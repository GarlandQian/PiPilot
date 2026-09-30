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
import { validateMcpServerDefinition } from '../../shared/mcp-config-parser'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function canonicalDirectory(path: string) {
  let canonical = resolve(path)
  try { canonical = realpathSync.native(canonical) } catch { /* A new profile may not exist yet. */ }
  return process.platform === 'win32' ? canonical.toLowerCase() : canonical
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
  const targets = [
    { path: join(agentDir, 'mcp.json'), scope: 'global' as const },
    ...(projectTrusted
      ? [{ path: join(cwd, '.pi', 'mcp.json'), scope: 'project' as const }]
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
      const error = validateMcpServerDefinition(name, definition)
      if (error !== null) {
        // A malformed project override must not connect the global server of
        // the same name with a different address or previously enabled state.
        servers.delete(name)
        errors.push(`${path}: ${error}`)
        continue
      }
      servers.set(name, {
        name,
        config: definition as McpServerConfig,
        source: path,
        scope,
      })
    }
  }
  return {
    servers: [...servers.values()],
    errors,
    ...(autoEnableCodemode === undefined ? {} : { autoEnableCodemode }),
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
      factory: (pi) => {
        // The SDK currently exposes no public constructor for its OAuth
        // credential store; its default uses getAgentDir(), not loadConfig.
        // Refuse cross-directory credential access rather than silently using
        // the real profile when an isolated/custom Host was misconfigured.
        if (canonicalDirectory(getAgentDir()) !== canonicalDirectory(agentDir)) {
          throw new Error('Native MCP requires PI_CODING_AGENT_DIR to match the Host agent directory.')
        }
        return createMcpExtension({
          loadConfig: (context) => loadRuntimeMcpConfig(agentDir, context.cwd, context.isProjectTrusted()),
          logPath: join(agentDir, 'mcp.log'),
        })(pi)
      },
      builtin: true,
      replaceable: true,
    },
  ]
}
