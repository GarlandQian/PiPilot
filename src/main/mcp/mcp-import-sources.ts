import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { posix, win32 } from 'node:path'
import { parseMcpImport, type McpImportFormat } from '../../shared/mcp-import'
import { MCP_IMPORT_APPS, mcpImportSourcesResultSchema, type McpImportApp, type McpImportSourcesResult } from '../../shared/mcp-config'

// ~/.claude.json also keeps Claude Code's history, so it can be large.
const FILE_LIMIT = 32 * 1024 * 1024

interface Candidate {
  app: McpImportApp
  path: string
  hint?: McpImportFormat
}

/** Where each app keeps its MCP servers on this platform. */
export function mcpImportCandidates(platform: NodeJS.Platform = process.platform, home = homedir(), environment: NodeJS.ProcessEnv = process.env): Candidate[] {
  const { join } = platform === 'win32' ? win32 : posix
  const appData = platform === 'win32' ? environment.APPDATA || join(home, 'AppData', 'Roaming')
    : platform === 'darwin' ? join(home, 'Library', 'Application Support')
      : environment.XDG_CONFIG_HOME || join(home, '.config')
  return [
    { app: 'claude-code', path: join(home, '.claude.json') },
    { app: 'claude-desktop', path: join(appData, 'Claude', 'claude_desktop_config.json') },
    { app: 'codex', path: join(environment.CODEX_HOME || join(home, '.codex'), 'config.toml'), hint: 'codex' },
    { app: 'cursor', path: join(home, '.cursor', 'mcp.json') },
    { app: 'gemini', path: join(home, '.gemini', 'settings.json'), hint: 'gemini' },
    { app: 'vscode', path: join(appData, 'Code', 'User', 'mcp.json') },
    { app: 'vscode', path: join(appData, 'Code', 'User', 'settings.json') },
    { app: 'windsurf', path: join(home, '.codeium', 'windsurf', 'mcp_config.json'), hint: 'windsurf' },
  ]
}

async function readCandidate(candidate: Candidate) {
  try {
    const details = await stat(candidate.path)
    if (!details.isFile()) return null
    if (details.size > FILE_LIMIT) return { app: candidate.app, path: candidate.path, servers: [], error: 'too-large' as const }
    const text = await readFile(candidate.path, 'utf8')
    const result = parseMcpImport(text, candidate.hint)
    if (!result) return { app: candidate.app, path: candidate.path, servers: [], error: 'unreadable' as const }
    return { app: candidate.app, path: candidate.path, servers: result.servers }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    return { app: candidate.app, path: candidate.path, servers: [], error: 'unreadable' as const }
  }
}

/** The MCP servers other apps on this computer have, read but never changed. */
export async function readMcpImportSources(candidates = mcpImportCandidates()): Promise<McpImportSourcesResult> {
  const found = (await Promise.all(candidates.map(readCandidate))).filter((source) => source !== null)
  // An app whose settings file has no servers is not worth listing.
  const sources = found.filter((source) => source.servers.length > 0 || (source.error && !source.path.endsWith('settings.json')))
  sources.sort((left, right) => MCP_IMPORT_APPS.indexOf(left.app) - MCP_IMPORT_APPS.indexOf(right.app))
  return mcpImportSourcesResultSchema.parse({ sources })
}
