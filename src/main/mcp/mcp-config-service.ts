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
import type { PiRuntimeFrontend } from '../pi-host/pi-runtime-frontend'

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
  private readonly getActiveScope: () => ConversationScope
  private readonly scopeResolver: ConversationScopeResolver

  constructor(options: McpConfigServiceOptions) {
    if (!isAbsolute(options.homeDirectory)) {
      throw new Error('The MCP global configuration home must be absolute.')
    }
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
      return join(this.homeDirectory, '.pi', 'agent', 'mcp.json')
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
  private pendingRestartGeneration: number | null = null
  private pendingRestartTarget: McpConfigTarget | null = null
  private readonly unsubscribes: readonly (() => void)[]

  constructor(
    private readonly service: McpConfigService,
    private readonly runtimeHost: Pick<
      PiRuntimeFrontend,
      'getSnapshot' | 'restart' | 'subscribe' | 'subscribeEvents'
    >,
    private readonly restartTarget: (
      target: McpConfigTarget,
    ) => Promise<unknown> = () => runtimeHost.restart(),
  ) {
    const unsubscribeEvents = runtimeHost.subscribeEvents((event, generation) => {
      if (
        event.type !== 'agent_settled' ||
        this.pendingRestartGeneration !== generation ||
        generation !== runtimeHost.getSnapshot().generation
      ) return
      const target = this.pendingRestartTarget
      if (!target) return
      this.pendingRestartGeneration = null
      this.pendingRestartTarget = null
      void this.restartTarget(target).catch(() => {
        if (runtimeHost.getSnapshot().generation === generation) {
          this.pendingRestartGeneration = generation
          this.pendingRestartTarget = target
        }
      })
    })
    const unsubscribeRuntime = runtimeHost.subscribe((snapshot) => {
      if (
        this.pendingRestartGeneration !== null &&
        this.pendingRestartGeneration !== snapshot.generation
      ) {
        this.pendingRestartGeneration = null
        this.pendingRestartTarget = null
      }
    })
    this.unsubscribes = [unsubscribeEvents, unsubscribeRuntime]
  }

  load(target: McpConfigTarget) {
    return this.service.load(target)
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
    if (!this.service.isTargetActive(target)) {
      return mcpConfigSaveResultSchema.parse({ snapshot, apply: 'unavailable' })
    }
    const runtime = this.runtimeHost.getSnapshot()
    if (runtime.state !== 'ready') {
      return mcpConfigSaveResultSchema.parse({ snapshot, apply: 'unavailable' })
    }
    if (runtime.sessionState?.isStreaming || runtime.sessionState?.isCompacting) {
      this.pendingRestartGeneration = runtime.generation
      this.pendingRestartTarget = target
      return mcpConfigSaveResultSchema.parse({ snapshot, apply: 'pending' })
    }
    this.pendingRestartGeneration = null
    this.pendingRestartTarget = null
    try {
      await this.restartTarget(target)
      return mcpConfigSaveResultSchema.parse({ snapshot, apply: 'restarted' })
    } catch (error) {
      return mcpConfigSaveResultSchema.parse({
        snapshot,
        apply: 'failed',
        applyError: error instanceof Error ? error.message : 'Pi could not restart.',
      })
    }
  }

  async restart() {
    try {
      await this.runtimeHost.restart()
      this.pendingRestartGeneration = null
      this.pendingRestartTarget = null
      return { restarted: true as const }
    } catch (error) {
      return {
        restarted: false as const,
        error: error instanceof Error ? error.message : 'Pi could not restart.',
      }
    }
  }

  dispose() {
    for (const unsubscribe of this.unsubscribes) unsubscribe()
  }
}
