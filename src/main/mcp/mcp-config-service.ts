import { createHash, randomUUID } from 'node:crypto'
import { open, mkdir, readFile, rename, stat, unlink } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import {
  MCP_CONFIG_CONTENT_LIMIT,
  mcpConfigSaveResultSchema,
  mcpConfigSnapshotSchema,
  mcpConfigTargetSchema,
  type McpConfigSaveResult,
  type McpConfigSnapshot,
  type McpConfigTarget,
} from '../../shared/mcp-config'
import { parseMcpConfigDocument } from '../../shared/mcp-config-parser'
import type { ConversationScope } from '../../shared/conversation-scope'
import type { ConversationScopeResolver } from '../conversations/conversation-scope-resolver'
import { configApplySaveFields, type ConfigApplyCoordinator } from '../config-apply/config-apply-coordinator'
import { displayPiAgentPath } from '../pi-agent-directory'

const DEFAULT_DOCUMENT = '{\n  "mcpServers": {}\n}\n'
const MISSING_FINGERPRINT = createHash('sha256')
  .update('pipilot:mcp-config:missing:v1')
  .digest('hex')

export type McpConfigErrorCode =
  | 'MCP_CONFIG_SCOPE_UNAVAILABLE'
  | 'MCP_CONFIG_TOO_LARGE'
  | 'MCP_CONFIG_INVALID'
  | 'MCP_CONFIG_CONFLICT'
  | 'MCP_CONFIG_READ_FAILED'
  | 'MCP_CONFIG_WRITE_FAILED'

export class McpConfigError extends Error {
  constructor(
    readonly code: McpConfigErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'McpConfigError'
  }
}

interface McpConfigServiceOptions {
  homeDirectory: string
  agentDirectory?: string
  getActiveScope(): ConversationScope
  scopeResolver: ConversationScopeResolver
}

function fingerprint(content: string | Buffer) {
  return createHash('sha256').update(content).digest('hex')
}

function isMissing(error: unknown) {
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
}

export class McpConfigService {
  private readonly homeDirectory: string
  private readonly agentDirectory: string
  private readonly getActiveScope: () => ConversationScope
  private readonly scopeResolver: ConversationScopeResolver

  constructor(options: McpConfigServiceOptions) {
    if (!isAbsolute(options.homeDirectory)) {
      throw new Error('The MCP global configuration home must be absolute.')
    }
    const agentDirectory = options.agentDirectory ?? join(options.homeDirectory, '.pi', 'agent')
    if (!isAbsolute(agentDirectory)) {
      throw new Error('The MCP global configuration Agent directory must be absolute.')
    }
    this.agentDirectory = resolve(agentDirectory)
    this.homeDirectory = resolve(options.homeDirectory)
    this.getActiveScope = options.getActiveScope
    this.scopeResolver = options.scopeResolver
  }

  async load(rawTarget: McpConfigTarget): Promise<McpConfigSnapshot> {
    const target = mcpConfigTargetSchema.parse(rawTarget)
    const targetPath = await this.resolveTargetPath(target)
    const disk = await this.readTarget(targetPath)
    await this.assertSameTarget(target, targetPath)
    return this.snapshot(target, targetPath, disk.exists, disk.content)
  }

  async save(
    rawTarget: McpConfigTarget,
    content: string,
    expectedFingerprint: string,
  ): Promise<McpConfigSnapshot> {
    const target = mcpConfigTargetSchema.parse(rawTarget)
    if (Buffer.byteLength(content, 'utf8') > MCP_CONFIG_CONTENT_LIMIT) {
      throw new McpConfigError(
        'MCP_CONFIG_TOO_LARGE',
        `MCP configuration cannot exceed ${MCP_CONFIG_CONTENT_LIMIT} bytes.`,
      )
    }
    const parsed = parseMcpConfigDocument(content)
    if (!parsed.valid) {
      throw new McpConfigError(
        'MCP_CONFIG_INVALID',
        parsed.diagnostics[0]?.message ?? 'The MCP configuration is invalid.',
      )
    }

    const targetPath = await this.resolveTargetPath(target)
    const current = await this.readTarget(targetPath)
    const currentFingerprint = current.exists
      ? fingerprint(current.content)
      : MISSING_FINGERPRINT
    if (currentFingerprint !== expectedFingerprint) {
      throw new McpConfigError(
        'MCP_CONFIG_CONFLICT',
        'The MCP configuration changed outside PiPilot. Reload it before saving.',
      )
    }
    await this.assertSameTarget(target, targetPath)
    await this.writeAtomically(targetPath, content, current.exists)
    return this.snapshot(target, targetPath, true, content)
  }

  isTargetActive(rawTarget: McpConfigTarget) {
    const target = mcpConfigTargetSchema.parse(rawTarget)
    if (target.kind === 'global') return true
    const activeScope = this.getActiveScope()
    return activeScope.kind === 'project' &&
      activeScope.workspaceId === target.workspaceId
  }

  private snapshot(
    target: McpConfigTarget,
    path: string,
    exists: boolean,
    content: string,
  ) {
    return mcpConfigSnapshotSchema.parse({
      target,
      path,
      displayPath: target.kind === 'global' ? displayPiAgentPath(path, this.homeDirectory) : path,
      exists,
      content,
      fingerprint: exists ? fingerprint(content) : MISSING_FINGERPRINT,
      ...parseMcpConfigDocument(content),
    })
  }

  private async readTarget(path: string) {
    let details
    try {
      details = await stat(path)
    } catch (error) {
      if (isMissing(error)) return { exists: false, content: DEFAULT_DOCUMENT }
      throw new McpConfigError('MCP_CONFIG_READ_FAILED', 'The MCP configuration could not be read.')
    }
    if (!details.isFile()) {
      throw new McpConfigError('MCP_CONFIG_READ_FAILED', 'The MCP configuration path is not a file.')
    }
    if (details.size > MCP_CONFIG_CONTENT_LIMIT) {
      throw new McpConfigError(
        'MCP_CONFIG_TOO_LARGE',
        `MCP configuration cannot exceed ${MCP_CONFIG_CONTENT_LIMIT} bytes.`,
      )
    }
    try {
      return { exists: true, content: await readFile(path, 'utf8') }
    } catch {
      throw new McpConfigError('MCP_CONFIG_READ_FAILED', 'The MCP configuration could not be read.')
    }
  }

  private async resolveTargetPath(target: McpConfigTarget) {
    if (target.kind === 'global') {
      return join(this.agentDirectory, 'mcp.json')
    }
    const activeScope = this.getActiveScope()
    if (
      activeScope.kind !== 'project' ||
      activeScope.workspaceId !== target.workspaceId
    ) {
      throw new McpConfigError(
        'MCP_CONFIG_SCOPE_UNAVAILABLE',
        'Project MCP configuration is available only for the active selected project.',
      )
    }
    try {
      const resolvedScope = await this.scopeResolver.resolve(activeScope)
      return join(resolvedScope.cwd, '.mcp.json')
    } catch {
      throw new McpConfigError(
        'MCP_CONFIG_SCOPE_UNAVAILABLE',
        'The selected project is unavailable.',
      )
    }
  }

  private async assertSameTarget(target: McpConfigTarget, path: string) {
    if (await this.resolveTargetPath(target) !== path) {
      throw new McpConfigError(
        'MCP_CONFIG_SCOPE_UNAVAILABLE',
        'The active MCP configuration scope changed during the operation.',
      )
    }
  }

  private async writeAtomically(path: string, content: string, existed: boolean) {
    const parent = dirname(path)
    const temporary = join(parent, `.${randomUUID()}.pipilot-mcp.tmp`)
    let mode = 0o600
    if (existed) {
      try {
        mode = (await stat(path)).mode & 0o777
      } catch (error) {
        if (!isMissing(error)) {
          throw new McpConfigError('MCP_CONFIG_WRITE_FAILED', 'The MCP configuration could not be saved.')
        }
      }
    }
    try {
      await mkdir(parent, { recursive: true })
      const handle = await open(temporary, 'wx', mode)
      try {
        await handle.writeFile(content, 'utf8')
        await handle.sync()
      } finally {
        await handle.close()
      }
      await rename(temporary, path)
    } catch (error) {
      await unlink(temporary).catch(() => undefined)
      if (error instanceof McpConfigError) throw error
      throw new McpConfigError('MCP_CONFIG_WRITE_FAILED', 'The MCP configuration could not be saved.')
    }
  }
}

export class McpConfigController {
  constructor(
    private readonly service: McpConfigService,
    private readonly applyCoordinator: ConfigApplyCoordinator,
    private readonly reloadDetection: () => Promise<void>,
  ) {}

  async load(target: McpConfigTarget) {
    const snapshot = await this.service.load(target)
    const applyStatus = this.applyCoordinator.getStatus(snapshot.path, snapshot.fingerprint)
    return { ...snapshot, ...(applyStatus ? { applyStatus } : {}) }
  }

  async save(
    target: McpConfigTarget,
    content: string,
    expectedFingerprint: string,
    restart = true,
  ): Promise<McpConfigSaveResult> {
    const snapshot = await this.service.save(target, content, expectedFingerprint)
    if (!restart) {
      return mcpConfigSaveResultSchema.parse({ snapshot, apply: 'saved' })
    }
    const applyStatus = await this.applyCoordinator.apply({
      path: snapshot.path,
      fingerprint: snapshot.fingerprint,
      ...(target.kind === 'project' ? { cwd: dirname(snapshot.path) } : {}),
    })
    return mcpConfigSaveResultSchema.parse({
      snapshot: { ...snapshot, applyStatus },
      ...configApplySaveFields(applyStatus),
    })
  }

  async restart() {
    try {
      const statuses = await this.applyCoordinator.retryPending()
      if (statuses.some((status) => status.state !== 'applied' && status.state !== 'unavailable')) {
        return { restarted: false, applied: false, error: 'Configuration application is pending or failed. No running work was interrupted.' }
      }
      if (statuses.length === 0) await this.reloadDetection()
      return { restarted: false, applied: true }
    } catch (error) {
      return {
        restarted: false as const,
        error: error instanceof Error ? error.message.slice(0, 1_000) : 'Pi configuration could not be applied.',
      }
    }
  }

}
